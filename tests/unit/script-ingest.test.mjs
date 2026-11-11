import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment, serializeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { installFakeAz, isWindows, SUB_A, SUB_GAP } from "../helpers/fake-az-env.mjs";
import { ACCOUNT_KEY, FAKE_VM_PASS_WORD } from "../helpers/secret-shapes.mjs";

const scripts = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "scripts");
const ingest = path.join(scripts, "ingest.mjs");
const ledgerScript = path.join(scripts, "ledger.mjs");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const DR = /(sku|tier|zone|redundan|replica|replication|secondary|backup|geo|failover|availability|state|retention|soft delete|capacity|kind)/i;
const ALTERNATIVES = /\.xlsx workbook or a live subscription/;

/** A working folder with ari-export.xlsx and dr-assessment/checkout/assessment.yaml, as intake leaves them. */
function workspace({ ari = true, workbook, assessment = {} } = {}) {
    const cwd = mkdtempSync(path.join(tmpdir(), "dr-ingest-"));
    const root = path.join(cwd, "dr-assessment", "checkout");
    mkdirSync(root, { recursive: true });
    if (ari) writeFileSync(path.join(cwd, "ari-export.xlsx"), workbook ?? makeAriWorkbook());
    const normalized = normalizeAssessment({
        workload: { name: "checkout" }, inputs: { ari_file: ari ? "ari-export.xlsx" : null },
        regions: { primary: "westeurope", dr: "swedencentral" }, objectives: { tier: 1 }, ...assessment,
    });
    writeFileSync(path.join(root, "assessment.yaml"), serializeAssessment(normalized));
    return { cwd, root, evidence: path.join(root, "evidence"), file: path.join("dr-assessment", "checkout", "assessment.yaml") };
}
const run = (w, args, env = {}) => runScript(ingest, args, { cwd: w.cwd, env });

test("--summary-only prints the workbook summary and the candidate workloads and writes nothing", async () => {
    const w = workspace({ ari: true });
    const r = await run(w, ["--ari", "ari-export.xlsx", "--summary-only"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.equal(r.json.mode, "summary");
    assert.equal(r.json.source.kind, "ari-xlsx");
    assert.equal(r.json.source.file, "ari-export.xlsx");
    assert.match(r.json.source.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(r.json.sheets, { total: 11, assessed: 7, omitted: 4 });
    assert.deepEqual(r.json.resources, { total: 12, inScope: 12 });
    assert.deepEqual(r.json.candidates.map((c) => [c.key, c.resources]), [
        ["rg:Sub A/rg-checkout", 7], ["rg:Sub A/rg-shared", 2], ["rg:Sub B/rg-billing", 3], ["tag:app=billing", 3], ["tag:app=checkout", 5],
    ]);
    assert.deepEqual(Object.keys(r.json.candidates[0]), ["key", "subscriptions", "resourceGroups", "resources"]);
    assert.equal(r.json.needsScope, true);
    assert.equal(r.json.facts, 0);
    assert.deepEqual(r.json.outputs, []);
    assert.deepEqual(r.json.warnings, []);
    assert.deepEqual(r.json.omittedSheets.map((s) => s.name), ["Overview", "Advisor", "Custom Tags", "Notes"]);
    assert.equal(existsSync(path.join(w.root, "evidence")), false);
    assert.deepEqual(readdirSync(w.cwd).sort(), ["ari-export.xlsx", "dr-assessment"]);
});

test("--summary-only also works from an assessment, and a workbook with one candidate does not need a scope", async () => {
    const w = workspace();
    const viaAssessment = await run(w, ["--assessment", w.file, "--summary-only"]);
    assert.equal(viaAssessment.code, 0, viaAssessment.stderr);
    assert.equal(viaAssessment.json.resources.total, 12);
    const two = workspace({ workbook: makeAriWorkbook({ omit: ["Storage Accounts", "SQL DBs", "App Services", "Key Vaults", "Disks"] }) });
    const vms = await run(two, ["--ari", "ari-export.xlsx", "--summary-only"]);
    assert.equal(vms.json.resources.total, 3);
    assert.equal(vms.json.candidates.length, 2);
    assert.equal(vms.json.needsScope, true, "two resource groups remain");
    const one = workspace({ workbook: makeAriWorkbook({ omit: ["Virtual Machines", "Storage Accounts", "SQL DBs", "App Services", "Disks"] }) });
    const vault = await run(one, ["--ari", "ari-export.xlsx", "--summary-only"]);
    assert.equal(vault.json.resources.total, 1);
    assert.deepEqual(vault.json.candidates.map((c) => c.key), ["rg:Sub A/rg-checkout"]);
    assert.equal(vault.json.needsScope, false);
});

test("a full ingest applies the scope, writes the evidence files and the ignore rule, and reports the summary", async () => {
    const w = workspace({ assessment: { scope: { resource_groups: ["rg-checkout"] } } });
    const r = await run(w, ["--assessment", w.file]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.mode, "full");
    assert.deepEqual(r.json.resources, { total: 12, inScope: 7 });
    assert.deepEqual(r.json.scope, { applied: true, matched: 7, total: 12 });
    assert.deepEqual(r.json.candidates.map((c) => c.key), ["rg:Sub A/rg-checkout", "tag:app=checkout"]);
    assert.equal(r.json.needsScope, false, "a selector was applied");
    assert.deepEqual(r.json.regionCheck, { declared: "westeurope", observed: [{ region: "westeurope", resources: 7 }], status: "match" });
    assert.deepEqual(r.json.outputs, [
        "dr-assessment/checkout/evidence/inventory.json", "dr-assessment/checkout/evidence/ledger.json", "dr-assessment/checkout/evidence/.gitignore",
    ]);
    assert.equal(readFileSync(path.join(w.evidence, ".gitignore"), "utf8"), "*\n!.gitignore\n");

    const inventory = read(path.join(w.evidence, "inventory.json"));
    assert.equal(inventory.schemaVersion, 1);
    assert.equal(inventory.source.file, "ari-export.xlsx");
    assert.equal(inventory.source.sha256, r.json.source.sha256);
    assert.match(inventory.source.readAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    assert.equal(inventory.resources.length, 7);
    assert.equal(inventory.scope.total, 12);
    assert.equal(inventory.summary.length, 12);

    const ledger = read(path.join(w.evidence, "ledger.json"));
    assert.equal(ledger.schemaVersion, 1);
    assert.equal(ledger.entries.length, r.json.facts);
    assert.equal(ledger.entries[0].id, "F-0001");
    const unknown = ledger.entries.filter((e) => e.strength === "Unknown");
    assert.equal(unknown.length, 4);
    const expected = inventory.resources.reduce((n, res) => n + 1 + [res.armType, res.resourceGroup, res.location].filter(Boolean).length + Object.keys(res.fields).filter((k) => DR.test(k)).length, 0);
    assert.equal(r.json.facts, expected + 4);

    const validated = await runScript(ledgerScript, ["validate", "--ledger", path.join(w.evidence, "ledger.json")], { cwd: w.cwd });
    assert.equal(validated.code, 0, validated.stdout);
    for (const file of ["inventory.json", "ledger.json"]) {
        const text = readFileSync(path.join(w.evidence, file), "utf8");
        for (const secret of [FAKE_VM_PASS_WORD, `${ACCOUNT_KEY}=Zm9v`, "st-secret-value"]) assert.equal(text.includes(secret), false, `${file} must not hold ${secret}`);
    }
});

test("a full ingest without a scope keeps every resource and asks for one; a scope on another region reports the mismatch", async () => {
    const all = workspace();
    const r = await run(all, ["--assessment", all.file]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.resources, { total: 12, inScope: 12 });
    assert.equal(r.json.needsScope, true);
    assert.deepEqual(r.json.scope, { applied: false, matched: 12, total: 12 });
    assert.equal(r.json.regionCheck.status, "match");

    const other = workspace({ assessment: { scope: { subscriptions: ["Sub B"] } } });
    const mismatch = await run(other, ["--assessment", other.file]);
    assert.equal(mismatch.json.resources.inScope, 3);
    assert.deepEqual(mismatch.json.regionCheck, { declared: "westeurope", observed: [{ region: "northeurope", resources: 3 }], status: "mismatch" });
});

test("--out moves the evidence folder, a rerun starts a new ledger, and --max-rows-per-sheet truncates with an Unknown fact", async () => {
    const w = workspace();
    const out = path.join(w.cwd, "elsewhere");
    const first = await run(w, ["--assessment", w.file, "--out", out, "--max-rows-per-sheet", "2"]);
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(first.json.outputs, ["elsewhere/inventory.json", "elsewhere/ledger.json", "elsewhere/.gitignore"]);
    assert.equal(existsSync(w.evidence), false);
    assert.ok(first.json.warnings.includes("sheet Virtual Machines has 5 rows; only the first 2 were read"));
    const ledger = read(path.join(out, "ledger.json"));
    assert.ok(ledger.entries.some((e) => e.subject === "sheet:Virtual Machines" && /only partly read/.test(e.claim)));
    const second = await run(w, ["--assessment", w.file, "--out", out, "--max-rows-per-sheet", "2"]);
    assert.equal(second.json.facts, first.json.facts);
    assert.equal(read(path.join(out, "ledger.json")).entries[0].id, "F-0001");
});

test("an --out that is reached through a symlink is still shown relative to the working directory", async () => {
    const w = workspace();
    const link = `${w.cwd}-link`;
    symlinkSync(w.cwd, link, "junction");
    const r = await run(w, ["--assessment", w.file, "--out", path.join(link, "via-link")]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.outputs, ["via-link/inventory.json", "via-link/ledger.json", "via-link/.gitignore"]);
    assert.ok(existsSync(path.join(w.cwd, "via-link", "ledger.json")));
});

test("an input file that is a symlink keeps the name it was given", { skip: isWindows && "file symlinks need a privilege on Windows" }, async () => {
    const w = workspace();
    const target = mkdtempSync(path.join(tmpdir(), "dr-ingest-target-"));
    writeFileSync(path.join(target, "export.xlsx"), makeAriWorkbook());
    symlinkSync(path.join(target, "export.xlsx"), path.join(w.cwd, "linked.xlsx"));
    const r = await run(w, ["--ari", "linked.xlsx", "--summary-only"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.source.file, "linked.xlsx");
});

test("a missing, unsupported or unreadable inventory exits 2 and names the alternatives", async () => {
    const w = workspace();
    writeFileSync(path.join(w.cwd, "legacy.xls"), Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]));
    writeFileSync(path.join(w.cwd, "export.csv"), "Subscription,Name\nSub A,x\n");
    for (const file of ["missing.xlsx", "legacy.xls", "export.csv"]) {
        const r = await run(w, ["--ari", file, "--summary-only"]);
        assert.equal(r.code, 2, file);
        assert.equal(r.json.ok, false);
        assert.match([r.json.error, ...r.json.details].join(" "), ALTERNATIVES, file);
    }
    const full = workspace({ assessment: { inputs: { ari_file: "missing.xlsx" } } });
    const r = await run(full, ["--assessment", full.file]);
    assert.equal(r.code, 2);
    assert.equal(existsSync(full.evidence), false, "nothing is written when the inventory cannot be read");
    const none = workspace({ ari: false });
    const noSource = await run(none, ["--assessment", none.file]);
    assert.equal(noSource.code, 2);
    assert.match(noSource.json.details.join(" "), /inputs\.ari_file or inputs\.live\.subscription_ids/);
});

test("usage errors exit 1 and an invalid assessment exits 2", async () => {
    const w = workspace();
    assert.equal((await run(w, [])).code, 1);
    assert.equal((await run(w, ["--ari", "ari-export.xlsx"])).code, 1, "a full ingest needs --assessment");
    assert.equal((await run(w, ["--assessment", w.file, "--max-rows-per-sheet", "0"])).code, 1);
    assert.equal((await run(w, ["--assessment", w.file, "--max-rows-per-sheet", "many"])).code, 1);
    assert.equal((await run(w, ["--assessment", "dr-assessment/nope/assessment.yaml"])).code, 2);
    writeFileSync(path.join(w.cwd, "bad.yaml"), "workload:\n  name: x\nobjectives:\n  tier: 9\n");
    assert.equal((await run(w, ["--assessment", "bad.yaml"])).code, 2);
});

test("an evidence folder inside the skill or plugin is refused and nothing is written", async () => {
    const w = workspace();
    const plugin = path.join(w.cwd, "plugin");
    mkdirSync(path.join(plugin, ".claude-plugin"), { recursive: true });
    mkdirSync(path.join(plugin, "dr"), { recursive: true });
    writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "azure-dr-assessment" }));
    writeFileSync(path.join(plugin, "dr", "assessment.yaml"), readFileSync(path.join(w.root, "assessment.yaml")));
    const inside = await run(w, ["--assessment", "plugin/dr/assessment.yaml"]);
    assert.equal(inside.code, 4);
    assert.equal(existsSync(path.join(plugin, "dr", "evidence")), false);
    const viaOut = await run(w, ["--assessment", w.file, "--out", "plugin/evidence"]);
    assert.equal(viaOut.code, 4);
    assert.equal(existsSync(path.join(plugin, "evidence")), false);
});

test("an assessment whose outputs.directory points elsewhere is a warning, and both sources set means the ARI file wins", { skip: isWindows ? "the fake az is a script" : false }, async () => {
    const fake = installFakeAz();
    const w = workspace({ assessment: { outputs: { directory: "somewhere/else" }, inputs: { ari_file: "ari-export.xlsx", live: { subscription_ids: [SUB_A] } } } });
    const r = await run(w, ["--assessment", w.file], fake.env);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.source.kind, "ari-xlsx");
    assert.deepEqual(fake.calls(), [], "az is not used when an ARI file is given");
    assert.ok(r.json.warnings.some((x) => /both an ARI file and live subscriptions are set/.test(x)));
    assert.ok(r.json.warnings.some((x) => /outputs\.directory somewhere\/else does not match/.test(x)));
    assert.ok(read(path.join(w.evidence, "inventory.json")).warnings.length >= 2);
});

test("a live source collects through az, keeps permission gaps as Unknown facts and needs az", { skip: isWindows ? "the fake az is a script" : false }, async () => {
    const fake = installFakeAz();
    const w = workspace({ ari: false, assessment: { inputs: { ari_file: null, live: { subscription_ids: [SUB_A, SUB_GAP] } }, scope: { resource_groups: ["rg-checkout"] } } });
    const r = await run(w, ["--assessment", w.file], fake.env);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.source, { kind: "live", file: null, sha256: null });
    assert.deepEqual(r.json.resources, { total: 4, inScope: 4 });
    assert.deepEqual(r.json.sheets, { total: 3, assessed: 3, omitted: 0 });
    assert.match(r.stderr, /Live collection \(read-only\)/);
    const inventory = read(path.join(w.evidence, "inventory.json"));
    assert.equal(inventory.source.kind, "live");
    assert.ok(inventory.resources.every((x) => x.ref.startsWith("arg:/subscriptions/")));
    assert.deepEqual(inventory.omissions.map((o) => o.what), [`subscription:${SUB_GAP}`]);
    const ledger = read(path.join(w.evidence, "ledger.json"));
    assert.ok(ledger.entries.some((e) => e.strength === "Unknown" && e.subject === `subscription:${SUB_GAP}`));
    assert.ok(ledger.entries.every((e) => e.strength !== "Observed" || e.source.type === "live"));
    assert.equal((await runScript(ledgerScript, ["validate", "--ledger", path.join(w.evidence, "ledger.json")], { cwd: w.cwd })).code, 0);

    const noAz = workspace({ ari: false, assessment: { inputs: { ari_file: null, live: { subscription_ids: [SUB_A] } } } });
    const missing = await run(noAz, ["--assessment", noAz.file], { DR_AZ: path.join(noAz.cwd, "no-such-az") });
    assert.equal(missing.code, 3);
    assert.equal(existsSync(noAz.evidence), false);
});
