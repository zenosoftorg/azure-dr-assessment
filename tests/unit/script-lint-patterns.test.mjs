import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { FIXED_BODIES, writePack, writePatterns } from "../helpers/pack-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const script = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "scripts", "lint-patterns.mjs");
const env = { DR_PATTERNS_DIR: undefined };

test("a clean pack exits 0 and reports the summary fields, with the non-default pack banner", async () => {
    const dir = writePatterns([{ id: "DR-A-001" }, { id: "DR-B-001", slots: ["identity"] }]);
    const r = await runScript(script, ["--patterns-dir", dir], { env });
    assert.equal(r.code, 0);
    assert.deepEqual(r.json, {
        ok: true,
        script: "lint-patterns",
        packDir: dir,
        nonDefaultPack: true,
        banner: `NON-DEFAULT PATTERN PACK: ${dir} (test or operator override, not the company pack)`,
        patterns: 2,
        findings: [],
    });
    assert.equal(r.stdout.trim().split("\n").length, 1);
});

test("warnings are reported but do not fail the run", async () => {
    const dir = writePatterns([{ id: "DR-A-001", sections: [...FIXED_BODIES, ["Notes", "extra"]] }]);
    const r = await runScript(script, ["--patterns-dir", dir], { env });
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.findings.map((f) => [f.severity, f.rule, f.file, f.id]), [["warning", "section-unknown", "DR-A-001.md", "DR-A-001"]]);
    assert.match(r.stderr, /warning: DR-A-001\.md: \[section-unknown\]/);
});

test("an error finding exits 2 and the failure envelope carries the findings", async () => {
    const dir = writePatterns([{ id: "DR-A-001", slots: ["teleport"] }]);
    const r = await runScript(script, ["--patterns-dir", dir], { env });
    assert.equal(r.code, 2);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.code, 2);
    assert.equal(r.json.error, "1 pattern lint error");
    assert.deepEqual(r.json.details, ['DR-A-001.md: [slot-unknown] slot "teleport" is not in the slot vocabulary (see patterns/README.md)']);
    assert.equal(r.json.patterns, 1);
    assert.equal(r.json.nonDefaultPack, true);
    assert.equal(r.json.banner, `NON-DEFAULT PATTERN PACK: ${dir} (test or operator override, not the company pack)`);
    assert.equal(r.json.findings[0].rule, "slot-unknown");
    assert.match(r.stderr, /error: DR-A-001\.md: \[slot-unknown\]/);
});

test("a file without front matter is reported and fails the run", async () => {
    const dir = writePack({ "NOTES.md": "# just notes\n" });
    const r = await runScript(script, ["--patterns-dir", dir], { env });
    assert.equal(r.code, 2);
    assert.equal(r.json.patterns, 0);
    assert.equal(r.json.findings[0].rule, "front-matter-missing");
});

test("DR_PATTERNS_DIR selects the pack and the flag wins over it", async () => {
    const good = writePatterns([{ id: "DR-A-001" }]);
    const bad = writePatterns([{ id: "DR-B-001", status: "final" }]);
    const viaEnv = await runScript(script, [], { env: { DR_PATTERNS_DIR: bad } });
    assert.equal(viaEnv.code, 2);
    assert.equal(viaEnv.json.nonDefaultPack, true);
    assert.equal(viaEnv.json.banner, `NON-DEFAULT PATTERN PACK: ${bad} (test or operator override, not the company pack)`);
    const flagWins = await runScript(script, ["--patterns-dir", good], { env: { DR_PATTERNS_DIR: bad } });
    assert.equal(flagWins.code, 0);
    assert.equal(flagWins.json.banner, `NON-DEFAULT PATTERN PACK: ${good} (test or operator override, not the company pack)`);
});

test("a missing pack folder exits 2", async () => {
    const r = await runScript(script, ["--patterns-dir", path.join(writePatterns([]), "missing")], { env });
    assert.equal(r.code, 2);
    assert.match(r.json.error, /cannot read the pattern pack/);
});

test("an unreadable pack folder still carries the non-default pack banner", async () => {
    const missing = path.join(writePatterns([]), "missing");
    const r = await runScript(script, ["--patterns-dir", missing], { env });
    assert.equal(r.code, 2);
    assert.match(r.json.error, /cannot read the pattern pack/);
    assert.equal(r.json.nonDefaultPack, true);
    assert.equal(r.json.banner, `NON-DEFAULT PATTERN PACK: ${missing} (test or operator override, not the company pack)`);
});

test("an unknown flag exits 1 and --help prints the usage", async () => {
    assert.equal((await runScript(script, ["--nope"], { env })).code, 1);
    const help = await runScript(script, ["--help"], { env });
    assert.equal(help.code, 0);
    assert.match(help.stdout, /--patterns-dir/);
});
