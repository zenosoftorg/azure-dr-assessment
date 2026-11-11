import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { writePlaybookDir, writePlaybooks } from "../helpers/playbook-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(root, "skills", "azure-dr-assessment", "scripts", "lint-playbooks.mjs");
const env = { DR_PLAYBOOKS_DIR: undefined };
const today = ["--today", "2026-11-09"];

test("a clean folder exits 0 and reports the result fields of the contracts 4.1", async () => {
    const dir = writePlaybooks([{ service: "alpha", arm_types: ["microsoft.test/alphas"] }, { service: "beta", arm_types: ["microsoft.test/betas"] }]);
    const r = await runScript(script, ["--playbooks-dir", dir, ...today], { env });
    assert.equal(r.code, 0);
    assert.deepEqual(r.json, { ok: true, script: "lint-playbooks", playbooksDir: dir, nonDefaultPlaybooks: true, playbooks: 2, findings: [] });
    assert.equal(r.stdout.trim().split("\n").length, 1);
});

test("a warning is reported on stderr but does not fail the run", async () => {
    const dir = writePlaybooks([{ verified_on: "2026-01-02" }]);
    const r = await runScript(script, ["--playbooks-dir", dir, ...today], { env });
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.findings.map((f) => [f.severity, f.rule, f.file, f.service]), [["warning", "verified-stale", "test-service.md", "test-service"]]);
    assert.match(r.stderr, /^warning: test-service\.md: \[verified-stale\] verified_on 2026-01-02 is 311 days before 2026-11-09/m);
});

test("--today moves the date the age is measured from", async () => {
    const dir = writePlaybooks([{ verified_on: "2026-01-02" }]);
    const r = await runScript(script, ["--playbooks-dir", dir, "--today", "2026-02-01"], { env });
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.findings, []);
});

test("an error finding exits 2 and the failure envelope carries the same fields", async () => {
    const dir = writePlaybooks([{ slot: "teleport" }]);
    const r = await runScript(script, ["--playbooks-dir", dir, ...today], { env });
    assert.equal(r.code, 2);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.code, 2);
    assert.equal(r.json.error, "1 playbook lint error");
    assert.deepEqual(r.json.details, ['test-service.md: [slot-unknown] slot "teleport" is not a slot id (see patterns/README.md)']);
    assert.equal(r.json.playbooksDir, dir);
    assert.equal(r.json.nonDefaultPlaybooks, true);
    assert.equal(r.json.playbooks, 1);
    assert.deepEqual(r.json.findings.map((f) => f.rule), ["slot-unknown"]);
    assert.match(r.stderr, /^error: test-service\.md: \[slot-unknown\]/m);
});

test("a file without front matter is reported, left out of the count and fails the run", async () => {
    const r = await runScript(script, ["--playbooks-dir", writePlaybookDir({ "notes.md": "# notes\n" }), ...today], { env });
    assert.equal(r.code, 2);
    assert.equal(r.json.playbooks, 0);
    assert.equal(r.json.findings[0].rule, "front-matter-missing");
});

test("DR_PLAYBOOKS_DIR selects the folder and the flag wins over it", async () => {
    const good = writePlaybooks([{}]);
    const bad = writePlaybooks([{ slot: "teleport" }]);
    const viaEnv = await runScript(script, today, { env: { DR_PLAYBOOKS_DIR: bad } });
    assert.equal(viaEnv.code, 2);
    assert.equal(viaEnv.json.playbooksDir, bad);
    assert.equal(viaEnv.json.nonDefaultPlaybooks, true);
    const flagWins = await runScript(script, ["--playbooks-dir", good, ...today], { env: { DR_PLAYBOOKS_DIR: bad } });
    assert.equal(flagWins.code, 0);
    assert.equal(flagWins.json.playbooksDir, good);
});

test("a missing folder exits 2 and still carries the folder fields", async () => {
    const missing = path.join(writePlaybookDir({}), "missing");
    const r = await runScript(script, ["--playbooks-dir", missing, ...today], { env });
    assert.equal(r.code, 2);
    assert.equal(r.json.error, `cannot read the playbook folder ${missing}`);
    assert.equal(r.json.playbooksDir, missing);
    assert.equal(r.json.nonDefaultPlaybooks, true);
});

test("a bad --today or an unknown flag exits 1, and --help prints the usage", async () => {
    const dir = writePlaybooks([{}]);
    const bad = await runScript(script, ["--playbooks-dir", dir, "--today", "2026-13-01"], { env });
    assert.equal(bad.code, 1);
    assert.equal(bad.json.error, "--today must be a date as YYYY-MM-DD");
    assert.equal((await runScript(script, ["--nope"], { env })).code, 1);
    const help = await runScript(script, ["--help"], { env });
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^lint-playbooks: /);
    assert.match(help.stdout, /--playbooks-dir/);
    assert.match(help.stdout, /--today/);
});

test("package.json runs the script as npm run lint:playbooks", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.scripts["lint:playbooks"], "node skills/azure-dr-assessment/scripts/lint-playbooks.mjs");
});
