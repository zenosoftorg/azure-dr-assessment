import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseYaml } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { defaultFixture, installFakeAz, isWindows, SUB_A, TENANT } from "../helpers/fake-az-env.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(root, "skills", "azure-dr-assessment", "scripts", "intake.mjs");
const workspace = () => realpathSync(mkdtempSync(path.join(tmpdir(), "dr-intake-")));
const run = (args, { cwd, env = {} } = {}) => runScript(script, args, { cwd, env: { DR_PATTERNS_DIR: undefined, DR_AZ: undefined, ...env } });
const ALL = ["--app", "Checkout Shop", "--tier", "1", "--primary", "West Europe", "--dr", "Sweden Central", "--ari", "ari-export.xlsx"];

function withWorkbook() {
    const cwd = workspace();
    writeFileSync(path.join(cwd, "ari-export.xlsx"), makeAriWorkbook());
    return cwd;
}

test("the first run writes dr-assessment/<app>/assessment.yaml, announces the folder and reports what is missing", async () => {
    const cwd = workspace();
    const r = await run(["--app", "Checkout Shop", "--tier", "1", "--primary", "West Europe", "--dr", "Sweden Central"], { cwd });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    const file = path.join(cwd, "dr-assessment", "checkout-shop", "assessment.yaml");
    assert.equal(r.json.assessment, file);
    assert.equal(r.json.app, "checkout-shop");
    assert.equal(r.json.outputRoot, path.dirname(file));
    assert.equal(r.json.announce, "Output folder: dr-assessment/checkout-shop/");
    assert.equal(r.json.written, true);
    assert.deepEqual(r.json.changes, ["workload.name", "objectives.tier", "regions.primary", "regions.dr"]);
    assert.equal(r.json.complete, false);
    assert.deepEqual(r.json.missing.map((item) => item.field), ["inputs"]);
    assert.equal(r.json.gatesOpen, 0);
    assert.equal(r.json.needsScope, null);
    assert.deepEqual(r.json.candidates, []);
    const saved = parseYaml(readFileSync(file, "utf8"));
    assert.equal(saved.workload.name, "Checkout Shop");
    assert.equal(saved.workload.app, "checkout-shop");
    assert.equal(saved.regions.primary, "westeurope");
    assert.equal(saved.regions.dr, "swedencentral");
    assert.equal(saved.objectives.tier, 1);
    assert.equal(saved.outputs.directory, "dr-assessment/checkout-shop");
});

test("a missing tier stops the run with the exact tier question, and nothing the user said is lost", async () => {
    const cwd = withWorkbook();
    const r = await run(["--app", "checkout", "--primary", "westeurope", "--dr", "swedencentral", "--ari", "ari-export.xlsx"], { cwd });
    assert.equal(r.code, 4, r.stdout + r.stderr);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.gatesOpen, 1);
    assert.equal(r.json.gates[0].id, "tier-missing");
    assert.equal(r.json.gates[0].status, "open");
    assert.match(r.json.gates[0].question, /^\*\*Which landing zone DR tier applies to this application\?\*\*/);
    assert.deepEqual(r.json.missing.map((item) => item.field), ["objectives.tier"]);
    assert.equal(r.json.needsScope, null, "the ingest summary waits until the tier is settled");
    assert.ok(existsSync(path.join(cwd, "dr-assessment", "checkout", "assessment.yaml")));
    assert.equal(parseYaml(readFileSync(path.join(cwd, "dr-assessment", "checkout", "assessment.yaml"), "utf8")).inputs.ari_file, "ari-export.xlsx");
});

test("a rerun from the file asks nothing and writes nothing", async () => {
    const cwd = withWorkbook();
    const first = await run(["--scope-resource-group", "rg-checkout", ...ALL], { cwd });
    assert.equal(first.code, 0, first.stdout + first.stderr);
    assert.equal(first.json.complete, true);
    const file = first.json.assessment;

    const again = await run(["--assessment", file], { cwd });
    assert.equal(again.code, 0, again.stdout + again.stderr);
    assert.equal(again.json.complete, true);
    assert.deepEqual(again.json.missing, []);
    assert.equal(again.json.written, false);
    assert.deepEqual(again.json.changes, []);
    assert.equal(again.json.needsScope, false);
});

test("flags override the file and everything else in it stays", async () => {
    const cwd = withWorkbook();
    const first = await run(["--scope-resource-group", "rg-checkout", ...ALL], { cwd });
    const file = first.json.assessment;
    const r = await run(["--assessment", file, "--tier", "2", "--rto", "4h", "--pause-after-current-state"], { cwd });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(r.json.changes, ["objectives.tier", "objectives.rto", "options.pause_after_current_state"]);
    const saved = parseYaml(readFileSync(file, "utf8"));
    assert.equal(saved.objectives.tier, 2);
    assert.equal(saved.objectives.rto, "4h");
    assert.equal(saved.options.pause_after_current_state, true);
    assert.equal(saved.regions.primary, "westeurope");
    assert.deepEqual(saved.scope.resource_groups, ["rg-checkout"]);
});

test("a rerun that repeats --app updates the assessment it finds and keeps what the file holds", async () => {
    for (const where of [[], ["--out", "custom/place"]]) {
        const cwd = workspace();
        const first = await run(["--app", "Checkout Shop", "--tier", "1", "--primary", "westeurope", "--dr", "swedencentral", ...where], { cwd });
        assert.equal(first.code, 0, first.stdout + first.stderr);
        const file = first.json.assessment;
        writeFileSync(file, readFileSync(file, "utf8").replace("decisions: []", "decisions:\n  - question: Which database tier?\n    answer: Keep S1\n    date: 2026-11-04"));

        const again = await run(["--app", "Checkout Shop", "--tier", "2", ...where], { cwd });
        assert.equal(again.code, 0, again.stdout + again.stderr);
        assert.equal(again.json.assessment, file);
        assert.deepEqual(again.json.changes, ["objectives.tier"], again.stdout);
        const saved = parseYaml(readFileSync(file, "utf8"));
        assert.equal(saved.workload.name, "Checkout Shop");
        assert.equal(saved.objectives.tier, 2);
        assert.equal(saved.regions.primary, "westeurope");
        assert.equal(saved.regions.dr, "swedencentral");
        assert.equal(saved.decisions[0].answer, "Keep S1");
    }
});

test("a rerun that repeats --app on an existing default assessment.yaml that is not valid exits 2 and leaves the file as it was", async () => {
    const cwd = workspace();
    const dir = path.join(cwd, "dr-assessment", "x");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "assessment.yaml");
    const invalid = "workload:\n  name: x\noverrides:\n  pattern: DR-DNS-001\n";
    writeFileSync(file, invalid);

    const r = await run(["--app", "x", "--tier", "1"], { cwd });
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.ok(r.json.details.includes("overrides: must be a list"), r.stdout);
    assert.deepEqual(readFileSync(file), Buffer.from(invalid));
    assert.deepEqual(readdirSync(dir), ["assessment.yaml"]);
    assert.deepEqual(readdirSync(path.join(cwd, "dr-assessment")), ["x"]);
});

test("the ARI summary pass says whether the inventory holds more than one workload", async () => {
    const cwd = withWorkbook();
    const r = await run(ALL, { cwd });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.complete, true);
    assert.equal(r.json.needsScope, true);
    assert.ok(r.json.candidates.length >= 3, `${r.json.candidates.length} candidates`);
    for (const candidate of r.json.candidates) {
        for (const field of ["key", "subscriptions", "resourceGroups", "resources"]) assert.ok(field in candidate, field);
    }
    assert.ok(r.json.candidates.some((candidate) => candidate.resourceGroups.includes("rg-checkout")));

    const scoped = await run(["--assessment", r.json.assessment, "--scope-resource-group", "rg-checkout"], { cwd });
    assert.equal(scoped.code, 0, scoped.stdout + scoped.stderr);
    assert.equal(scoped.json.needsScope, false);
    assert.deepEqual(scoped.json.changes, ["scope.resource_groups"]);
});

test("an unreadable workbook or a live source without az stops with the right exit code", async () => {
    const cwd = workspace();
    writeFileSync(path.join(cwd, "broken.xlsx"), "this is not a workbook");
    const unreadable = await run(["--app", "checkout", "--tier", "1", "--primary", "westeurope", "--dr", "swedencentral", "--ari", "broken.xlsx"], { cwd });
    assert.equal(unreadable.code, 2, unreadable.stdout + unreadable.stderr);
    assert.match(unreadable.json.error, /workbook|xlsx/i);

    const live = await run(["--app", "live", "--tier", "1", "--primary", "westeurope", "--dr", "swedencentral", "--subscriptions", "11111111-1111-1111-1111-111111111111"], {
        cwd,
        env: { DR_AZ: path.join(cwd, "no-such-az") },
    });
    assert.equal(live.code, 3, live.stdout + live.stderr);
});

const LIVE = ["--app", "live", "--tier", "1", "--primary", "westeurope", "--dr", "swedencentral", "--subscriptions", SUB_A];
const ANNOUNCEMENT = `Live collection (read-only): tenant ${TENANT}, subscriptions ${SUB_A}`;

test("the live-read announcement of the ingest summary pass reaches the stderr of intake, and stdout stays one envelope", { skip: isWindows ? "the fake az is a script" : false }, async () => {
    const cwd = workspace();
    const fake = installFakeAz();
    const r = await run(LIVE, { cwd, env: fake.env });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.ok(r.stderr.includes(ANNOUNCEMENT), r.stderr);
    assert.equal(typeof r.json.needsScope, "boolean", "the summary pass ran");
    assert.ok(fake.calls().length > 0);
});

test("the stderr of a sibling that failed is forwarded too", { skip: isWindows ? "the fake az is a script" : false }, async () => {
    const cwd = workspace();
    const fixture = defaultFixture();
    fixture.failures = { "graph query": { stderr: "ERROR: the Resource Graph service is not reachable", code: 1 } };
    const r = await run(LIVE, { cwd, env: installFakeAz(fixture).env });
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.equal(r.json.ok, false);
    assert.match(r.json.error, /az graph query failed/);
    assert.ok(r.stderr.includes(ANNOUNCEMENT), r.stderr);
});

test("an output folder inside the skill or plugin directory is refused", async () => {
    const r = await run(["--app", "checkout", "--tier", "1"], { cwd: root });
    assert.equal(r.code, 4);
    assert.match(r.json.error, /inside the skill or plugin directory/);
    assert.equal(existsSync(path.join(root, "dr-assessment")), false);
});

test("--out and --assessment choose where the file goes, and the folder is recorded", async () => {
    const cwd = workspace();
    const out = await run(["--app", "checkout", "--tier", "1", "--out", "custom/place"], { cwd });
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.equal(out.json.announce, "Output folder: custom/place/");
    assert.equal(parseYaml(readFileSync(path.join(cwd, "custom", "place", "assessment.yaml"), "utf8")).outputs.directory, "custom/place");

    const explicit = await run(["--assessment", "other/dir/assessment.yaml", "--app", "checkout", "--tier", "1"], { cwd });
    assert.equal(explicit.code, 0, explicit.stdout + explicit.stderr);
    assert.equal(explicit.json.announce, "Output folder: other/dir/");
    assert.ok(existsSync(path.join(cwd, "other", "dir", "assessment.yaml")));
});

test("bad input fails before anything is written", async () => {
    const cwd = workspace();
    const noName = await run(["--tier", "1"], { cwd });
    assert.equal(noName.code, 1);
    assert.match(noName.json.error, /--app is required the first time/);
    assert.equal((await run(["--app", "x", "--tier", "7"], { cwd })).code, 1);
    assert.equal((await run(["--app", "x", "--rto", "near zero"], { cwd })).code, 1);
    assert.equal((await run(["--app", "x", "--scope-tag", "nonsense"], { cwd })).code, 1);
    const same = await run(["--app", "x", "--primary", "westeurope", "--dr", "West Europe"], { cwd });
    assert.equal(same.code, 2);
    assert.ok(same.json.details.some((line) => line.startsWith("regions.dr:")));
    assert.equal(existsSync(path.join(cwd, "dr-assessment")), false);

    const bad = path.join(cwd, "bad");
    mkdirSync(bad);
    writeFileSync(path.join(bad, "assessment.yaml"), "workload:\n  name: x\noverrides:\n  pattern: DR-DNS-001\n");
    const notAList = await run(["--assessment", path.join(bad, "assessment.yaml")], { cwd });
    assert.equal(notAList.code, 2);
    assert.ok(notAList.json.details.includes("overrides: must be a list"));
});

test("--help lists every flag", async () => {
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    for (const flag of [
        "--assessment", "--app", "--tier", "--primary", "--dr", "--ari", "--subscriptions", "--tenant", "--rto", "--rpo", "--failure-scope",
        "--environment", "--scope-resource-group", "--scope-tag", "--scope-subscription", "--pause-after-current-state", "--out", "--patterns-dir",
    ]) {
        assert.ok(help.stdout.includes(flag), flag);
    }
});
