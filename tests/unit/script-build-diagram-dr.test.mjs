import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCanvasModules } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { makeDrLedger, makeDrResolution, readDrSpec } from "../helpers/dr-diagram-fixture.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { SIG } from "../helpers/secret-shapes.mjs";

const canvas = await loadCanvasModules();
const repo = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(repo, "skills", "azure-dr-assessment", "scripts", "build-diagram.mjs");
const guard = path.join(repo, "extensions", "architecture-canvas", "scripts", "verify-layout.mjs");
const golden = path.join(repo, "tests", "fixtures", "golden", "checkout-proposed-dr.arch.json");
const FROZEN_UPDATED_AT = "2026-01-01T00:00:00.000Z";
const ARGS = ["--spec", "architectures/checkout-proposed-dr.spec.json", "--ledger", "evidence/ledger.json", "--resolution", "evidence/pattern-resolution.json"];
const BUILT = path.join("architectures", "checkout-proposed-dr.arch.json");

/** A working folder as stage 6 leaves it: the spec, the ledger and a completed pattern resolution. */
async function workspace({ edit = () => {}, resolution = makeDrResolution({ tierException: true }) } = {}) {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-diagram-dr-")));
    const spec = readDrSpec();
    edit(spec);
    mkdirSync(path.join(cwd, "architectures"));
    writeFileSync(path.join(cwd, "architectures", "checkout-proposed-dr.spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
    await makeDrLedger().save(path.join(cwd, "evidence", "ledger.json"));
    writeFileSync(path.join(cwd, "evidence", "pattern-resolution.json"), JSON.stringify(resolution));
    return cwd;
}
const run = (cwd, extra = [], args = ARGS) => runScript(script, [...args, ...extra], { cwd });

test("builds the proposed-dr diagram beside the spec, and the result is the golden file", async () => {
    const cwd = await workspace();
    const r = await run(cwd, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.out, path.join(cwd, BUILT));
    assert.deepEqual(
        { id: r.json.id, kind: r.json.kind, nodes: r.json.nodes, edges: r.json.edges, groups: r.json.groups },
        { id: "checkout-proposed-dr", kind: "proposed-dr", nodes: 7, edges: 5, groups: 4 },
    );
    assert.deepEqual(r.json.genericIcons, ["On-prem DNS"]);
    assert.deepEqual(r.json.warnings, []);

    const diagram = JSON.parse(readFileSync(r.json.out, "utf8"));
    const renormalized = canvas.store.normalizeDiagram(diagram);
    renormalized.updatedAt = diagram.updatedAt;
    assert.deepEqual(renormalized, diagram, "the vendored normalizeDiagram leaves the built diagram unchanged");
    diagram.updatedAt = FROZEN_UPDATED_AT;
    const normalized = `${JSON.stringify(diagram, null, 2)}\n`;
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(golden, normalized);
    assert.equal(normalized, readFileSync(golden, "utf8"));
});

test("the vendored layout guard accepts the golden proposed-dr diagram in both directions", async () => {
    const r = await runScript(guard, [golden]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ok {3}checkout-proposed-dr LR/);
    assert.match(r.stdout, /ok {3}checkout-proposed-dr TB/);
    assert.match(r.stdout, /^PASS$/m);
});

test("a proposed-dr spec without --resolution exits 2 and writes nothing", async () => {
    const cwd = await workspace();
    const r = await run(cwd, ["--icon-root", makeIconRoot()], ARGS.slice(0, 4));
    assert.equal(r.code, 2);
    assert.equal(r.json.error, "a proposed-dr spec needs --resolution");
    assert.equal(existsSync(path.join(cwd, BUILT)), false);
});

test("a resolution that is not complete stops the build and lists what is missing", async () => {
    const resolution = makeDrResolution();
    resolution.slots[0].decision = null;
    resolution.slots[3].decision = null;
    const cwd = await workspace({ resolution });
    const r = await run(cwd, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 2);
    assert.equal(r.json.error, "the pattern resolution is not complete");
    assert.deepEqual(r.json.details, ["slots[0].decision: objectives has no decision yet", "slots[3].decision: compute has no decision yet"]);
    assert.equal(existsSync(path.join(cwd, BUILT)), false);
});

test("a decision that ignores the engine's candidate stops the build, so Learn cannot replace a company pattern", async () => {
    const resolution = makeDrResolution();
    const dns = resolution.slots.find((s) => s.slot === "traffic-dns");
    dns.decision = { text: "Use Traffic Manager", source: "learn", ref: null, status: "Resolved", azureReality: "", ledger: [], alternative: null };
    const cwd = await workspace({ resolution });
    const r = await run(cwd, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 2);
    assert.equal(r.json.details.length, 1);
    assert.match(r.json.details[0], /^slots\[1\]\.decision\.source: traffic-dns: the engine's candidate comes from pattern, so a decision from learn would ignore it/);
    assert.equal(existsSync(path.join(cwd, BUILT)), false);
});

test("a decision that cites a ledger id that is not there stops the build", async () => {
    const resolution = makeDrResolution();
    resolution.slots[0].decision.ledger = ["F-0042"];
    const cwd = await workspace({ resolution });
    const r = await run(cwd, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 2);
    assert.deepEqual(r.json.details, ["slots[0].decision.ledger: F-0042 is not in the ledger"]);
});

test("an invalid spec exits 2 with every problem and writes nothing", async () => {
    const cwd = await workspace({
        edit: (spec) => {
            spec.nodes[1].evidence = [];
            spec.edges[3].mechanism = "";
            spec.edges[0].decisions = ["nowhere"];
        },
    });
    const r = await run(cwd, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 2);
    assert.equal(r.json.error, "the diagram spec is invalid");
    assert.deepEqual(r.json.details.map((d) => d.split(":")[0]), ["nodes[1].evidence", "edges[0].decisions[0]", "edges[0].evidence", "edges[3].mechanism"]);
    assert.equal(existsSync(path.join(cwd, BUILT)), false);
});

test("an override and a non-default pack show on the diagram: the exceptions group, the source line and the title suffix", async () => {
    const cwd = await workspace({ resolution: makeDrResolution({ dnsOverride: true, tierException: true, nonDefaultPack: true }) });
    const r = await run(cwd, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.nodes, 8);
    const diagram = JSON.parse(readFileSync(r.json.out, "utf8"));
    assert.match(diagram.title, / \[NON-DEFAULT PATTERN PACK\]$/);
    assert.match(diagram.nodes.find((n) => n.id === "n_dns").annotation, /Override #0 of DR-DNS-001 \(documented exception\)/);
    assert.deepEqual(diagram.nodes.filter((n) => n.group === "g_documented_exceptions").map((n) => n.label), [
        "Exception: DR-DNS-001 traffic-dns",
        "Exception: DR-TIER-001 objectives",
    ]);
});

test("--out that is the spec, the ledger or the pattern resolution is refused with exit 1, and nothing is written", async () => {
    const cwd = await workspace();
    const inputs = [
        ["spec", path.join("architectures", "checkout-proposed-dr.spec.json")],
        ["ledger", path.join("evidence", "ledger.json")],
        ["resolution", path.join("evidence", "pattern-resolution.json")],
    ];
    const snapshot = () => inputs.map(([, file]) => readFileSync(path.join(cwd, file), "utf8"));
    const before = snapshot();
    for (const [name, file] of inputs) {
        for (const out of [file, `.${path.sep}${file}`, path.join(cwd, file)]) {
            const r = await run(cwd, ["--out", out, "--icon-root", makeIconRoot()]);
            assert.equal(r.code, 1, `${out}: ${r.stdout}${r.stderr}`);
            assert.equal(r.json.error, "--out would overwrite an input");
            assert.deepEqual(r.json.details, [`${path.join(cwd, file)} is the ${name} file; choose another output path`]);
            assert.deepEqual(snapshot(), before, out);
            assert.equal(existsSync(path.join(cwd, BUILT)), false);
        }
    }
    assert.deepEqual(readdirSync(path.join(cwd, "architectures")), ["checkout-proposed-dr.spec.json"]);
});

// GC-07: the secret-like values are built at run time from parts, so that no file or tool output holds one.
const KEY_LIKE = ["Account", "Key="].join("") + "a".repeat(30);
const SIG_TOKEN = "q".repeat(24);
const SIG_LIKE = `https://tickets.example.com/browse/ARB-2026-114?${SIG}=${SIG_TOKEN}`;
const NEVER_PRINTED = [KEY_LIKE, "a".repeat(30), SIG_LIKE, SIG_TOKEN];
const printed = (r) => NEVER_PRINTED.filter((part) => r.stdout.includes(part) || r.stderr.includes(part)).length;

test("a secret-like approval reference in an exception stops the build: exit 2, nothing written, the value on neither stream", async () => {
    const resolution = makeDrResolution({ dnsOverride: true, tierException: true });
    resolution.documentedExceptions[0].approval_ref = SIG_LIKE;
    const cwd = await workspace({ resolution });
    const r = await run(cwd, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 2);
    assert.equal(r.json.error, "the diagram spec is invalid");
    assert.equal(r.json.details.length, 1);
    assert.match(r.json.details[0], /^resolution\.documentedExceptions\[0\]\.approval_ref: looks like a secret/);
    assert.equal(existsSync(path.join(cwd, BUILT)), false);
    assert.deepEqual(readdirSync(path.join(cwd, "architectures")), ["checkout-proposed-dr.spec.json"]);
    assert.equal(printed(r), 0);
});

test("a mechanism on a node stops the build with a pointer to the link, writes nothing and does not print a secret-like value", async () => {
    const cwd = await workspace({ edit: (spec) => { spec.nodes[1].mechanism = KEY_LIKE; } });
    const r = await run(cwd, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 2);
    assert.equal(r.json.error, "the diagram spec is invalid");
    assert.deepEqual(r.json.details.map((d) => d.split(":")[0]), ["nodes[1].mechanism"]);
    assert.match(r.json.details[0], /put the mechanism on the link/);
    assert.equal(existsSync(path.join(cwd, BUILT)), false);
    assert.deepEqual(readdirSync(path.join(cwd, "architectures")), ["checkout-proposed-dr.spec.json"]);
    assert.equal(printed(r), 0);
});
