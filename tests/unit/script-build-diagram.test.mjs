import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { makeFixtureLedger, readFixtureSpec } from "../helpers/diagram-ledger.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { loadCanvasModules } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";

const canvas = await loadCanvasModules();
const repo = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(repo, "skills", "azure-dr-assessment", "scripts", "build-diagram.mjs");
const guard = path.join(repo, "extensions", "architecture-canvas", "scripts", "verify-layout.mjs");
const golden = path.join(repo, "tests", "fixtures", "golden", "checkout-current-state.arch.json");
const FROZEN_UPDATED_AT = "2026-01-01T00:00:00.000Z";
const ARGS = ["--spec", "architectures/checkout-current-state.spec.json", "--ledger", "evidence/ledger.json"];
const BUILT = path.join("architectures", "checkout-current-state.arch.json");

/** A working folder as the earlier steps leave it: architectures/<id>.spec.json and evidence/ledger.json. */
async function workspace(edit = () => {}) {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-diagram-")));
    const spec = readFixtureSpec();
    edit(spec);
    mkdirSync(path.join(cwd, "architectures"));
    writeFileSync(path.join(cwd, "architectures", "checkout-current-state.spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
    await makeFixtureLedger().save(path.join(cwd, "evidence", "ledger.json"));
    return cwd;
}
const run = (cwd, extra = []) => runScript(script, [...ARGS, ...extra], { cwd });

test("builds the diagram beside the spec, and the result is the golden file", async () => {
    const cwd = await workspace();
    const r = await run(cwd, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.equal(r.json.out, path.join(cwd, BUILT));
    assert.deepEqual(
        { id: r.json.id, kind: r.json.kind, nodes: r.json.nodes, edges: r.json.edges, groups: r.json.groups },
        { id: "checkout-current-state", kind: "current-state", nodes: 6, edges: 5, groups: 2 },
    );
    assert.deepEqual(r.json.genericIcons, ["orders-queue"]);
    assert.deepEqual(r.json.closestIcons, []);
    assert.deepEqual(r.json.warnings, []);

    const text = readFileSync(r.json.out, "utf8");
    const diagram = JSON.parse(text);
    assert.equal(text, `${JSON.stringify(diagram, null, 2)}\n`, "written the way the canvas store writes it");
    assert.match(diagram.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const renormalized = canvas.store.normalizeDiagram(diagram);
    renormalized.updatedAt = diagram.updatedAt;
    assert.deepEqual(renormalized, diagram, "the vendored normalizeDiagram leaves the built diagram unchanged");
    diagram.updatedAt = FROZEN_UPDATED_AT;
    assert.equal(`${JSON.stringify(diagram, null, 2)}\n`, readFileSync(golden, "utf8"));
});

test("the vendored layout guard accepts the golden diagram in both directions", async () => {
    const r = await runScript(guard, [golden]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ok {3}checkout-current-state LR/);
    assert.match(r.stdout, /ok {3}checkout-current-state TB/);
    assert.match(r.stdout, /^PASS$/m);
});

test("--out writes elsewhere and creates the folders", async () => {
    const cwd = await workspace();
    const r = await run(cwd, ["--out", "deep/er/checkout.arch.json", "--icon-root", makeIconRoot()]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.out, path.join(cwd, "deep", "er", "checkout.arch.json"));
    assert.ok(existsSync(r.json.out));
    assert.equal(existsSync(path.join(cwd, BUILT)), false);
});

test("an invalid spec exits 2 with every problem and writes nothing", async () => {
    const cwd = await workspace((spec) => {
        spec.nodes[1].evidence = [];
        spec.nodes[2].label = "web-prod";
        spec.edges[0].to = "nowhere";
    });
    const r = await run(cwd, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 2);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, "the diagram spec is invalid");
    assert.deepEqual(r.json.details.map((d) => d.split(":")[0]), ["nodes[1].evidence", "nodes[2].label", "edges[0].to"]);
    assert.equal(existsSync(path.join(cwd, BUILT)), false);
});

test("--resolution carries nonDefaultPack into the title, and a resolution that is not an object is refused", async () => {
    const cwd = await workspace();
    writeFileSync(path.join(cwd, "pattern-resolution.json"), JSON.stringify({ schemaVersion: 1, nonDefaultPack: true }));
    const r = await run(cwd, ["--resolution", "pattern-resolution.json", "--icon-root", makeIconRoot()]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(r.json.out, "utf8")).title, "checkout · current state (westeurope) [NON-DEFAULT PATTERN PACK]");
    writeFileSync(path.join(cwd, "bad.json"), "[1]");
    const bad = await run(cwd, ["--resolution", "bad.json", "--icon-root", makeIconRoot()]);
    assert.equal(bad.code, 2);
    assert.match(bad.json.error, /pattern resolution/);
});

test("a missing ledger and a spec that is not JSON exit 2; a missing --spec exits 1", async () => {
    const cwd = await workspace();
    const noLedger = await runScript(script, ["--spec", ARGS[1], "--ledger", "evidence/none.json"], { cwd });
    assert.equal(noLedger.code, 2);
    writeFileSync(path.join(cwd, "architectures", "broken.spec.json"), "{ nope");
    const broken = await runScript(script, ["--spec", "architectures/broken.spec.json", "--ledger", ARGS[3]], { cwd });
    assert.equal(broken.code, 2);
    assert.match(broken.json.error, /not valid JSON/);
    const usage = await runScript(script, ["--ledger", ARGS[3]], { cwd });
    assert.equal(usage.code, 1);
    assert.match(usage.json.error, /--spec/);
});

test("without an icon library the diagram still builds and says so", async () => {
    const cwd = await workspace();
    const r = await run(cwd, ["--icon-root", mkdtempSync(path.join(tmpdir(), "dr-noicons-"))]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.json.warnings[0], /no icon library/);
    const diagram = JSON.parse(readFileSync(r.json.out, "utf8"));
    assert.deepEqual(diagram.nodes.map((n) => n.iconId).slice(0, 2), ["azure:front-door-and-cdn-profiles", "azure:app-services"]);
});

test("a group that holds nothing is built and reported", async () => {
    const cwd = await workspace((spec) => {
        spec.groups.push({ key: "spare", label: "Spare", parent: null, style: "neutral", evidence: [], annotation: "" });
    });
    const r = await run(cwd, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.groups, 3);
    assert.deepEqual(r.json.warnings, ['group "Spare" holds no node']);
});

test("refuses to write inside the skill or plugin directory", async () => {
    const cwd = await workspace();
    const plugin = mkdtempSync(path.join(tmpdir(), "dr-plugin-"));
    mkdirSync(path.join(plugin, ".claude-plugin"));
    writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "azure-dr-assessment" }));
    const target = path.join(plugin, "architectures", "x.arch.json");
    const r = await run(cwd, ["--out", target, "--icon-root", makeIconRoot()]);
    assert.equal(r.code, 4);
    assert.equal(existsSync(target), false);
});
