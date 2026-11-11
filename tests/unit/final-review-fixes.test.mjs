import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment, serializeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { validateDiagramSpec } from "../../skills/azure-dr-assessment/scripts/lib/diagram-spec.mjs";
import { Ledger, LedgerError } from "../../skills/azure-dr-assessment/scripts/lib/ledger.mjs";
import { collectFit, collectInventory, flattenResource } from "../../skills/azure-dr-assessment/scripts/lib/live.mjs";
import { isSecretName, isSecretValue } from "../../skills/azure-dr-assessment/scripts/lib/secrets.mjs";
import { makeFixtureLedger, readFixtureSpec } from "../helpers/diagram-ledger.mjs";
import { defaultFixture, installFakeAz, isWindows, SUB_A, SUB_B, TENANT } from "../helpers/fake-az-env.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { goldenStoryData, storyWorkspace } from "../helpers/story-fixture.mjs";
import { validateInventory } from "../../skills/azure-dr-assessment/scripts/lib/inventory.mjs";
import { PASS_WORD, P_WD, USER_ID } from "../helpers/secret-shapes.mjs";

const skip = isWindows ? "the fake az is a script with a shebang" : false;
const repo = path.resolve(import.meta.dirname, "..", "..");
const skillDir = path.join(repo, "skills", "azure-dr-assessment");
const scripts = path.join(skillDir, "scripts");
const collectLive = path.join(scripts, "collect-live.mjs");
const ledgerScript = path.join(scripts, "ledger.mjs");
const ingest = path.join(scripts, "ingest.mjs");
const present = path.join(scripts, "present.mjs");
const buildDiagram = path.join(scripts, "build-diagram.mjs");
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-final-fix-"));
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

// Fake secret-like values are assembled from parts so that no fixture holds a real-looking secret.
const FAKE_CONNECTION = `Account${"Key"}=${"ZmFrZQ"}==`;
const FAKE_PASSWORD_STRING = `Server=tcp:db;${USER_ID}=a;${PASS_WORD}=fake-value`;

/** A unique folder inside the skill directory that must never be created; removed in `finally` as a safety net. */
function insideSkill(name) {
    const dir = path.join(skillDir, `zz-final-fix-${process.pid}-${name}`);
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function liveWorkspace(fixtureAssessment) {
    const cwd = mkdtempSync(path.join(tmpdir(), "dr-final-fix-ws-"));
    const root = path.join(cwd, "dr-assessment", "checkout");
    mkdirSync(root, { recursive: true });
    const normalized = normalizeAssessment({
        workload: { name: "checkout" }, inputs: { ari_file: null, live: { subscription_ids: [SUB_A] } },
        regions: { primary: "westeurope", dr: "swedencentral" }, objectives: { tier: 1 }, ...fixtureAssessment,
    });
    writeFileSync(path.join(root, "assessment.yaml"), serializeAssessment(normalized));
    return { cwd, root, evidence: path.join(root, "evidence"), file: path.join("dr-assessment", "checkout", "assessment.yaml") };
}

/** The default fixture plus one resource whose secret-like names only show up in the full path. */
function fixtureWithPathSecrets() {
    const fixture = defaultFixture();
    fixture.graph.resources.push({
        id: `/subscriptions/${SUB_A}/resourceGroups/rg-checkout/providers/Microsoft.Web/sites/web-extra`, name: "web-extra", type: "microsoft.web/sites",
        location: "westeurope", resourceGroup: "rg-checkout", subscriptionId: SUB_A, sku: null, zones: null, kind: "app", tags: {},
        properties: { state: "Running", access: { key: "plain-a" }, connection: { string: "plain-b" }, primaryMasterKey: "plain-c" },
    });
    return fixture;
}

// --- item 1: GC-09 for collect-live --out and ledger --ledger ---------------------------------------------

test("collect-live refuses --out inside the skill directory before any az call and writes nothing", { skip }, async () => {
    const fake = installFakeAz();
    const target = insideSkill("collect");
    try {
        const r = await runScript(collectLive, ["--subscriptions", SUB_A, "--out", path.join(target.dir, "live.json")], { env: fake.env });
        assert.equal(r.code, 4);
        assert.match(r.json.error, /--out/);
        assert.equal(existsSync(target.dir), false);
        assert.deepEqual(fake.calls(), []);
        const fit = await runScript(collectLive, ["--mode", "fit", "--location", "swedencentral", "--out", path.join(target.dir, "fit.json")], { env: fake.env });
        assert.equal(fit.code, 4);
        assert.deepEqual(fake.calls(), []);
    } finally {
        target.cleanup();
    }
});

test("ledger add-* refuses --ledger inside the skill directory and writes nothing", async () => {
    const target = insideSkill("ledger");
    try {
        const file = path.join(target.dir, "ledger.json");
        const fact = await runScript(ledgerScript, ["add-fact", "--ledger", file, "--strength", "Inferred", "--subject", "web", "--claim", "web calls db", "--source-type", "owner", "--basis", "owner"]);
        assert.equal(fact.code, 4);
        assert.match(fact.json.error, /--ledger/);
        const doc = await runScript(ledgerScript, ["add-doc", "--ledger", file, "--title", "t", "--status", "Unverified", "--supports", "s", "--tool", "none"]);
        assert.equal(doc.code, 4);
        const region = await runScript(ledgerScript, ["add-region", "--ledger", file, "--check", "pair", "--subject", "westeurope", "--status", "Unverified"]);
        assert.equal(region.code, 4);
        assert.equal(existsSync(target.dir), false);
    } finally {
        target.cleanup();
    }
});

// --- item 2: secret-like model text ------------------------------------------------------------------------

test("Ledger.add rejects secret-like text in fact, doc and region fields without echoing it", () => {
    const base = { kind: "fact", strength: "Inferred", subject: "web", claim: "web calls db", source: { type: "owner" }, basis: "owner" };
    const bad = [
        { ...base, claim: `uses ${FAKE_CONNECTION}` },
        { ...base, claim: `${FAKE_CONNECTION}` },
        { ...base, property: FAKE_CONNECTION },
        { ...base, value: { nested: [FAKE_CONNECTION] } },
        { ...base, basis: FAKE_CONNECTION },
        { ...base, source: { type: "owner", detail: FAKE_CONNECTION } },
        { ...base, source: { type: "owner", ref: FAKE_CONNECTION } },
        { kind: "doc", url: "https://learn.microsoft.com/x", title: "t", status: "Unverified", supports: FAKE_CONNECTION, tool: "none" },
        { kind: "doc", url: "https://learn.microsoft.com/x", title: "t", status: "Unverified", supports: "s", query: FAKE_CONNECTION, tool: "none" },
        { kind: "region", check: "pair", subject: "westeurope", status: "Unverified", quote: FAKE_CONNECTION },
        { kind: "region", check: "pair", subject: "westeurope", status: "Unverified", result: { a: FAKE_CONNECTION } },
        { kind: "region", check: "pair", subject: "westeurope", status: "Unverified", substitute: { source: "pattern", ref: FAKE_CONNECTION, label: "Proposed" } },
    ];
    for (const entry of bad) {
        const ledger = Ledger.empty();
        assert.throws(() => ledger.add(entry), (err) => err instanceof LedgerError && err.errors.length > 0 && !JSON.stringify(err.errors).includes("ZmFrZQ"), JSON.stringify(entry).slice(0, 80));
        assert.equal(ledger.entries.length, 0);
    }
});

test("Ledger.validate reports a secret-like value already in a ledger file with its path", () => {
    const ledger = new Ledger([
        { id: "F-0001", kind: "fact", strength: "Inferred", subject: "web", claim: FAKE_CONNECTION, property: null, value: null, source: { type: "owner", ref: null, detail: null }, basis: "owner", recordedAt: "2026-11-04T09:00:00.000Z" },
    ]);
    const { ok, errors } = ledger.validate();
    assert.equal(ok, false);
    assert.deepEqual(errors.map((e) => e.path), ["entries[0].claim"]);
    assert.equal(JSON.stringify(errors).includes("ZmFrZQ"), false);
});

test("ledger add-fact with a connection-string claim exits 1 and saves nothing", async () => {
    const dir = tmp();
    const file = path.join(dir, "ledger.json");
    const r = await runScript(ledgerScript, ["add-fact", "--ledger", file, "--strength", "Inferred", "--subject", "web", "--claim", `web uses ${FAKE_CONNECTION}`, "--source-type", "owner", "--basis", "owner"]);
    assert.equal(r.code, 1);
    assert.equal(r.json.ok, false);
    assert.match(r.json.details.join(" "), /claim/);
    assert.equal(r.stdout.includes("ZmFrZQ"), false);
    assert.equal(existsSync(file), false);
});

test("validateDiagramSpec rejects secret-like label, sublabel, annotation and basis text with the JSON path", () => {
    const ctx = { ledger: makeFixtureLedger(), kind: "current-state" };
    assert.equal(validateDiagramSpec(readFixtureSpec(), ctx).ok, true);
    const edit = (change) => {
        const spec = readFixtureSpec();
        change(spec);
        return validateDiagramSpec(spec, ctx).errors.map((e) => e.path);
    };
    assert.deepEqual(edit((spec) => (spec.nodes[0].annotation = `see ${FAKE_CONNECTION}`)), ["nodes[0].annotation"]);
    assert.deepEqual(edit((spec) => (spec.nodes[0].sublabel = FAKE_CONNECTION)), ["nodes[0].sublabel"]);
    assert.ok(edit((spec) => (spec.nodes[0].label = FAKE_CONNECTION)).includes("nodes[0].label"));
    assert.ok(edit((spec) => (spec.groups[0].annotation = FAKE_CONNECTION)).includes("groups[0].annotation"));
    assert.ok(edit((spec) => (spec.groups[0].label = FAKE_CONNECTION)).includes("groups[0].label"));
    assert.ok(edit((spec) => (spec.edges[0].label = FAKE_CONNECTION)).includes("edges[0].label"));
    assert.ok(edit((spec) => (spec.edges[0].annotation = FAKE_CONNECTION)).includes("edges[0].annotation"));
    assert.ok(edit((spec) => (spec.edges[0].basis = FAKE_CONNECTION)).includes("edges[0].basis"));
    const message = validateDiagramSpec(Object.assign(readFixtureSpec(), { nodes: readFixtureSpec().nodes.map((n, i) => (i === 0 ? { ...n, annotation: FAKE_CONNECTION } : n)) }), ctx);
    assert.equal(JSON.stringify(message.errors).includes("ZmFrZQ"), false);
});

// --- item 3: live flattening agrees with validateInventory --------------------------------------------------

test("flattenResource drops fields whose full path reads as secret and lists them", () => {
    const { fields, droppedFields } = flattenResource({ properties: { state: "Running", access: { key: "x" }, connection: { string: "plain" } } });
    assert.deepEqual(fields, { "properties.state": "Running" });
    assert.deepEqual(droppedFields, ["properties.access.key", "properties.connection.string"]);
    const rich = flattenResource({ sku: { name: "S1" }, properties: { a: { b: { c: 1 } }, shared: { key: "x" }, sas: { url: "u" }, primary: { key: "k" } } });
    for (const name of Object.keys(rich.fields)) assert.equal(isSecretName(name), false, name);
});

test("a live ingest and collect-live --out no longer carry or crash on path-level secret names", { skip }, async () => {
    const fake = installFakeAz(fixtureWithPathSecrets());
    const w = liveWorkspace();
    const r = await runScript(ingest, ["--assessment", w.file], { cwd: w.cwd, env: fake.env });
    assert.equal(r.code, 0, r.stderr);
    const inventory = read(path.join(w.evidence, "inventory.json"));
    assert.equal(validateInventory(inventory).ok, true);
    const extra = inventory.resources.find((x) => x.name === "web-extra");
    assert.ok(extra.droppedFields.includes("properties.access.key"));
    assert.ok(extra.droppedFields.includes("properties.connection.string"));
    assert.equal(Object.keys(extra.fields).some((name) => /access|connection|master/i.test(name)), false);

    const out = path.join(tmp(), "live.json");
    const c = await runScript(collectLive, ["--subscriptions", SUB_A, "--out", out], { env: installFakeAz(fixtureWithPathSecrets()).env });
    assert.equal(c.code, 0, c.stderr);
    const saved = read(out);
    for (const resource of saved.resources) {
        for (const [name, value] of Object.entries(resource.fields)) assert.equal(isSecretName(name) || isSecretValue(value), false, name);
    }
    const savedExtra = saved.resources.find((x) => x.name === "web-extra");
    assert.ok(savedExtra.droppedFields.includes("properties.access.key"));
});

// --- item 4: secrets.mjs ----------------------------------------------------------------------------------

test("isSecretValue treats connection-string passwords as secret", () => {
    const pw = PASS_WORD;
    for (const value of [`${pw}=abc`, `Server=a;${pw}=abc`, `Server=a; ${pw.toLowerCase()}=abc;`, `Server=a;${P_WD}=abc`, `${P_WD.toUpperCase()}=abc`, FAKE_PASSWORD_STRING]) {
        assert.equal(isSecretValue(value), true, value.replace(/=.*/, "="));
    }
    for (const value of [`${pw}=`, `${pw}=;Server=a`, `Server=a;${pw}Policy=strict`, `Use a ${pw}=none setting`, `${P_WD}x=1`, `No${P_WD}=1`, `${pw} is required`]) {
        assert.equal(isSecretValue(value), false, value);
    }
});

test("isSecretName matches all-caps acronym spellings and master keys, and still leaves the protected names alone", () => {
    for (const name of ["SASToken", "SASUrl", "SAS_URL", "SAS_TOKEN", "primaryMasterKey", "secondaryMasterKey", "Primary Master Key", "APIKey", "HTTPSToken"]) {
        assert.equal(isSecretName(name), true, name);
    }
    for (const name of ["Allow Storage Account Key Access", "Admin Username", "Secure Transfer Required", "Client Cert Enabled", "Microsoft Entra Authorization", "Sassy Setting", "Passage", "Tokenizer", "Access Tier", "HTTPSOnly", "SASSY"]) {
        assert.equal(isSecretName(name), false, name);
    }
});

// --- item 5: ingest refuses before collecting --------------------------------------------------------------

test("a live ingest into the skill or plugin directory is refused before any az query", { skip }, async () => {
    const fake = installFakeAz();
    const w = liveWorkspace();
    const plugin = path.join(w.cwd, "plugin");
    mkdirSync(path.join(plugin, ".claude-plugin"), { recursive: true });
    writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "azure-dr-assessment" }));
    const r = await runScript(ingest, ["--assessment", w.file, "--out", "plugin/evidence"], { cwd: w.cwd, env: fake.env });
    assert.equal(r.code, 4);
    assert.deepEqual(fake.calls(), []);
    assert.equal(existsSync(path.join(plugin, "evidence")), false);
});

// --- item 6: --out must not overwrite an input -------------------------------------------------------------

test("present refuses an --out that is the story or the diagram", async () => {
    const w = storyWorkspace({ data: goldenStoryData() });
    const story = readFileSync(w.story, "utf8");
    const diagram = readFileSync(w.diagram, "utf8");
    const relStory = path.join("presentations", `${w.id}.story.mjs`);
    const overStory = await runScript(present, ["--story", relStory, "--out", relStory], { cwd: w.cwd });
    assert.equal(overStory.code, 1);
    assert.match(overStory.json.error, /overwrite/);
    const overDiagram = await runScript(present, ["--story", relStory, "--out", w.diagram], { cwd: w.cwd });
    assert.equal(overDiagram.code, 1);
    assert.equal(readFileSync(w.story, "utf8"), story);
    assert.equal(readFileSync(w.diagram, "utf8"), diagram);
});

test("build-diagram refuses an --out that is the spec or the ledger", async () => {
    const cwd = tmp();
    mkdirSync(path.join(cwd, "architectures"));
    mkdirSync(path.join(cwd, "evidence"));
    const specFile = path.join(cwd, "architectures", "checkout-current-state.spec.json");
    const ledgerFile = path.join(cwd, "evidence", "ledger.json");
    writeFileSync(specFile, `${JSON.stringify(readFixtureSpec(), null, 2)}\n`);
    await makeFixtureLedger().save(ledgerFile);
    const before = [readFileSync(specFile, "utf8"), readFileSync(ledgerFile, "utf8")];
    const overSpec = await runScript(buildDiagram, ["--spec", specFile, "--ledger", ledgerFile, "--out", specFile], { cwd });
    assert.equal(overSpec.code, 1);
    assert.match(overSpec.json.error, /overwrite/);
    const overLedger = await runScript(buildDiagram, ["--spec", specFile, "--ledger", ledgerFile, "--out", path.join(cwd, "evidence", "..", "evidence", "ledger.json")], { cwd });
    assert.equal(overLedger.code, 1);
    assert.deepEqual([readFileSync(specFile, "utf8"), readFileSync(ledgerFile, "utf8")], before);
});

// --- item 7: fit mode honors --tenant ---------------------------------------------------------------------

test("collectFit and collect-live --mode fit detect a tenant mismatch like inventory mode", { skip }, async () => {
    const other = "00000000-0000-0000-0000-000000000000";
    await assert.rejects(() => collectFit({ location: "swedencentral", tenantId: other, env: installFakeAz().env }), (e) => e.code === 3 && /tenant/.test(e.message));
    await assert.doesNotReject(() => collectFit({ location: "swedencentral", tenantId: TENANT.toUpperCase(), env: installFakeAz().env }));

    const fake = installFakeAz();
    const out = path.join(tmp(), "fit.json");
    const r = await runScript(collectLive, ["--mode", "fit", "--location", "swedencentral", "--tenant", other, "--out", out], { env: fake.env });
    assert.equal(r.code, 3);
    assert.match(r.json.error, /tenant/);
    assert.equal(existsSync(out), false);
    assert.equal(fake.calls().some((argv) => argv[0] === "vm"), false, "no fit query runs after the mismatch");
    const ok = await runScript(collectLive, ["--mode", "fit", "--location", "swedencentral", "--tenant", TENANT, "--out", out], { env: installFakeAz().env });
    assert.equal(ok.code, 0, ok.stderr);
});

// --- item 8: deterministic collect-live output ------------------------------------------------------------

test("collect-live --out is identical for shuffled az row order, apart from the timestamp", { skip }, async () => {
    const forward = defaultFixture();
    forward.graph.resourceGroups.push({ subscriptionId: SUB_A, name: "rg-Alpha", location: "westeurope", tags: {} }, { subscriptionId: SUB_B, name: "rg-aaa", location: "northeurope", tags: {} });
    const shuffled = structuredClone(forward);
    shuffled.graph.resources.reverse();
    shuffled.graph.resourceGroups.reverse();
    shuffled.graph.subscriptions.reverse();
    const run = async (fixture) => {
        const out = path.join(tmp(), "live.json");
        const r = await runScript(collectLive, ["--subscriptions", `${SUB_A},${SUB_B}`, "--out", out], { env: installFakeAz(fixture).env });
        assert.equal(r.code, 0, r.stderr);
        const saved = read(out);
        delete saved.collectedAt;
        return saved;
    };
    const a = await run(forward);
    const b = await run(shuffled);
    assert.deepEqual(a, b);
    assert.equal(a.resourceGroups.length, 4);
    const keys = a.resourceGroups.map((g) => `${g.subscriptionId}/${g.name}`.toLowerCase());
    assert.deepEqual(keys, [...keys].sort());

    const live = await collectInventory({ subscriptionIds: [SUB_A, SUB_B], env: installFakeAz(shuffled).env });
    assert.deepEqual(live.resourceGroups.map((g) => g.name), a.resourceGroups.map((g) => g.name));
});
