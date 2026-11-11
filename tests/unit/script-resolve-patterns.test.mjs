import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writePatterns } from "../helpers/pack-fixture.mjs";
import { dnsSpec, writeAssessmentFile } from "../helpers/resolve-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { TIER_QUESTION, tierSpec } from "../helpers/tier-fixture.mjs";

const script = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "scripts", "resolve-patterns.mjs");
const env = { DR_PATTERNS_DIR: undefined };
const run = (args, extraEnv = {}) => runScript(script, args, { env: { ...env, ...extraEnv } });
const complete = { justification: "No on-prem DNS dependency", owner_role: "Application owner", date: "2026-11-04" };
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const bothModes = [[], ["--gates-only"]];
const assertBanner = (r, pack) => {
    assert.equal(r.json.nonDefaultPack, true);
    assert.equal(r.json.banner, `NON-DEFAULT PATTERN PACK: ${pack} (test or operator override, not the company pack)`);
};

test("generate mode writes evidence/pattern-resolution.json next to the assessment and summarizes it", async () => {
    const pack = writePatterns([tierSpec(), dnsSpec()]);
    const { root, file } = writeAssessmentFile();
    const r = await run(["--assessment", file, "--patterns-dir", pack]);
    assert.equal(r.code, 0, r.stderr);
    const out = path.join(root, "evidence", "pattern-resolution.json");
    assert.equal(r.json.out, out);
    assert.deepEqual(Object.keys(r.json), ["ok", "script", "out", "nonDefaultPack", "banner", "gates", "gatesOpen", "slots", "collisions", "openInputs", "rejectedOverrides"]);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.nonDefaultPack, true);
    assert.equal(r.json.banner, `NON-DEFAULT PATTERN PACK: ${pack} (test or operator override, not the company pack)`);
    assert.equal(r.json.gatesOpen, 0);
    assert.deepEqual(r.json.gates.map((g) => g.status), ["satisfied", "satisfied"]);
    assert.deepEqual(r.json.slots, { total: 17, candidate: 17, unresolved: 0 });
    assert.deepEqual(r.json.collisions, []);
    assert.deepEqual(r.json.openInputs.map((i) => i.name), ["record_type", "ttl"]);
    assert.deepEqual(r.json.rejectedOverrides, []);
    const written = readJson(out);
    assert.equal(written.schemaVersion, 1);
    assert.equal(written.assessment, "assessment.yaml");
    assert.equal(written.packDir, pack);
    assert.equal(written.slots.length, 17);
    assert.ok(written.slots.every((s) => s.decision === null));
});

test("--out chooses the file and creates its folders", async () => {
    const pack = writePatterns([tierSpec()]);
    const { root, file } = writeAssessmentFile();
    const out = path.join(root, "nested", "deeper", "resolution.json");
    const r = await run(["--assessment", file, "--patterns-dir", pack, "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.out, out);
    assert.equal(readJson(out).schemaVersion, 1);
    assert.equal(existsSync(path.join(root, "evidence")), false);
});

test("--gates-only evaluates the gates and writes nothing", async () => {
    const pack = writePatterns([tierSpec()]);
    const { root, file } = writeAssessmentFile({ objectives: { tier: null } });
    const r = await run(["--assessment", file, "--patterns-dir", pack, "--gates-only"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.out, null);
    assert.deepEqual(Object.keys(r.json), ["ok", "script", "out", "nonDefaultPack", "banner", "gates", "gatesOpen"]);
    assert.equal(r.json.gatesOpen, 1);
    assert.equal(r.json.gates[0].id, "tier-missing");
    assert.equal(r.json.gates[0].question, TIER_QUESTION);
    assert.equal(existsSync(path.join(root, "evidence")), false);
});

test("a stricter target is an open gate in the summary, not a failure", async () => {
    const pack = writePatterns([tierSpec()]);
    const { file } = writeAssessmentFile({ objectives: { tier: 1, rto: "10m" } });
    const r = await run(["--assessment", file, "--patterns-dir", pack]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.gatesOpen, 1);
    assert.equal(r.json.gates[1].status, "open");
});

test("rejected overrides and collisions are summarized", async () => {
    const pack = writePatterns([
        tierSpec(),
        { id: "DR-MANUAL-001", slots: ["failover-approval"] },
        { id: "DR-AUTO-001", version: 2, slots: ["failover-approval"] },
    ]);
    const { file } = writeAssessmentFile({ overrides: [{ pattern: "DR-TIER-001", ...complete }] });
    const r = await run(["--assessment", file, "--patterns-dir", pack]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.rejectedOverrides, [{ index: 0, pattern: "DR-TIER-001", reason: "locked pattern: change it through this repository" }]);
    assert.deepEqual(r.json.collisions, [{ slot: "failover-approval", patterns: ["DR-AUTO-001 v2", "DR-MANUAL-001 v1"] }]);
    assert.deepEqual(r.json.slots, { total: 17, candidate: 16, unresolved: 1 });
});

test("an invalid assessment, a broken pack and a missing pack folder exit 2", async () => {
    const pack = writePatterns([tierSpec()]);
    const { root, file } = writeAssessmentFile();
    const bad = path.join(root, "bad.yaml");
    writeFileSync(bad, "workload:\n  name: x\nobjectives:\n  tier: 9\n");
    const invalid = await run(["--assessment", bad, "--patterns-dir", pack]);
    assert.equal(invalid.code, 2);
    assert.ok(invalid.json.details.some((d) => d.startsWith("objectives.tier:")));

    const broken = await run(["--assessment", file, "--patterns-dir", writePatterns([{ id: "DR-A-001", status: "final" }])]);
    assert.equal(broken.code, 2);
    assert.match(broken.json.details[0], /\[status-invalid\]/);

    const missing = await run(["--assessment", file, "--patterns-dir", path.join(pack, "missing")]);
    assert.equal(missing.code, 2);
});

test("a malformed tier table in DR-TIER-001 exits 2 with the problems", async () => {
    const pack = writePatterns([tierSpec({ parameters: { source: "none" } })]);
    const { file } = writeAssessmentFile();
    const r = await run(["--assessment", file, "--patterns-dir", pack]);
    assert.equal(r.code, 2);
    assert.match(r.json.details[0], /parameters\.tiers: must be a mapping/);
});

test("a pack with lint errors exits 2 and the failure carries the non-default pack banner", async () => {
    const pack = writePatterns([tierSpec(), { id: "DR-A-001", status: "final" }]);
    const { file } = writeAssessmentFile();
    for (const mode of bothModes) {
        const r = await run(["--assessment", file, "--patterns-dir", pack, ...mode]);
        assert.equal(r.code, 2, r.stderr);
        assert.match(r.json.details[0], /\[status-invalid\]/);
        assertBanner(r, pack);
    }
});

test("a malformed tier table exits 2 in both modes and the failure carries the non-default pack banner", async () => {
    const pack = writePatterns([tierSpec({ parameters: { source: "none" } })]);
    const { file } = writeAssessmentFile();
    for (const mode of bothModes) {
        const r = await run(["--assessment", file, "--patterns-dir", pack, ...mode]);
        assert.equal(r.code, 2, r.stderr);
        assert.match(r.json.details[0], /parameters\.tiers: must be a mapping/);
        assertBanner(r, pack);
    }
});

test("an unreadable pack folder exits 2 and the failure carries the non-default pack banner", async () => {
    const missing = path.join(writePatterns([tierSpec()]), "missing");
    const { file } = writeAssessmentFile();
    for (const mode of bothModes) {
        const r = await run(["--assessment", file, "--patterns-dir", missing, ...mode]);
        assert.equal(r.code, 2, r.stderr);
        assert.match(r.json.error, /cannot read the pattern pack/);
        assertBanner(r, missing);
    }
});

test("an invalid or unreadable assessment exits 2 and the failure carries the banner of the requested pack", async () => {
    const pack = writePatterns([tierSpec()]);
    const { root } = writeAssessmentFile();
    const bad = path.join(root, "bad.yaml");
    writeFileSync(bad, "workload:\n  name: x\nobjectives:\n  tier: 9\n");
    for (const assessment of [bad, path.join(root, "missing.yaml")]) {
        const r = await run(["--assessment", assessment, "--patterns-dir", pack]);
        assert.equal(r.code, 2, r.stderr);
        assertBanner(r, pack);
    }
});

test("a pack with a misspelled or missing override level exits 2 before any override is checked", async () => {
    // Without the lint, validateOverrides would fall back to the overridable rules and accept this entry without an approver.
    const { file } = writeAssessmentFile({ overrides: [{ pattern: "DR-DNS-001", ...complete }] });
    const misspelled = await run(["--assessment", file, "--patterns-dir", writePatterns([tierSpec(), dnsSpec({ override: "approval_required" })])]);
    assert.equal(misspelled.code, 2, misspelled.stderr);
    assert.equal(misspelled.json.details.length, 1);
    assert.match(misspelled.json.details[0], /\[override-invalid\]/);
    const missing = await run(["--assessment", file, "--patterns-dir", writePatterns([tierSpec(), dnsSpec({ omit: ["override"] })])]);
    assert.equal(missing.code, 2, missing.stderr);
    assert.equal(missing.json.details.length, 1);
    assert.match(missing.json.details[0], /\[front-matter-missing-field\] missing front matter field "override"/);
});

test("DR_PATTERNS_DIR selects the pack", async () => {
    const pack = writePatterns([tierSpec(), dnsSpec()]);
    const { file } = writeAssessmentFile();
    const r = await run(["--assessment", file], { DR_PATTERNS_DIR: pack });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.nonDefaultPack, true);
    assert.equal(r.json.openInputs.length, 2);
});

test("flag errors exit 1", async () => {
    const neither = await run([]);
    assert.equal(neither.code, 1);
    assert.match(neither.json.error, /--assessment \(or --validate\)/);
    const mixed = await run(["--validate", "x.json", "--gates-only"]);
    assert.equal(mixed.code, 1);
    const withPack = await run(["--validate", "x.json", "--patterns-dir", writePatterns([tierSpec()])]);
    assert.equal(withPack.code, 1);
    assert.match(withPack.json.error, /--validate cannot be combined with --assessment, --patterns-dir, --out or --gates-only/);
    const withAssessment = await run(["--validate", "x.json", "--assessment", "assessment.yaml"]);
    assert.equal(withAssessment.code, 1);
    assert.match(withAssessment.json.error, /--validate cannot be combined with --assessment, --patterns-dir, --out or --gates-only/);
    const withOut = await run(["--validate", "x.json", "--out", "resolution.json"]);
    assert.equal(withOut.code, 1);
    assert.match(withOut.json.error, /--validate cannot be combined with --assessment, --patterns-dir, --out or --gates-only/);
    assert.equal((await run(["--nope"])).code, 1);
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /--validate/);
});

test("the missing --assessment usage error names the pack in effect", async () => {
    const pack = writePatterns([tierSpec()]);
    const custom = await run(["--patterns-dir", pack]);
    assert.equal(custom.code, 1);
    assertBanner(custom, pack);
    const bundled = await run([]);
    assert.equal(bundled.code, 1);
    assert.equal(bundled.json.nonDefaultPack, false);
    assert.equal(bundled.json.banner, null);
});

test("it refuses to write inside the skill or plugin directory", async () => {
    const pack = writePatterns([tierSpec()]);
    const { file } = writeAssessmentFile();
    const plugin = mkdtempSync(path.join(tmpdir(), "dr-plugin-"));
    mkdirSync(path.join(plugin, ".claude-plugin"));
    writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "azure-dr-assessment" }));
    const out = path.join(plugin, "evidence", "pattern-resolution.json");
    const r = await run(["--assessment", file, "--patterns-dir", pack, "--out", out]);
    assert.equal(r.code, 4);
    assert.equal(existsSync(out), false);
});

test("the refusal to write inside the skill or plugin directory carries the non-default pack banner and leaves nothing behind", async () => {
    const pack = writePatterns([tierSpec()]);
    const { file } = writeAssessmentFile();
    const plugin = mkdtempSync(path.join(tmpdir(), "dr-plugin-"));
    mkdirSync(path.join(plugin, ".claude-plugin"));
    writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "azure-dr-assessment" }));
    const r = await run(["--assessment", file, "--patterns-dir", pack, "--out", path.join(plugin, "evidence", "pattern-resolution.json")]);
    assert.equal(r.code, 4, r.stderr);
    assertBanner(r, pack);
    assert.equal(existsSync(path.join(plugin, "evidence")), false);
});

function complete17(resolution) {
    for (const slot of resolution.slots) {
        const c = slot.candidate;
        slot.decision = c.source === "pattern"
            ? { text: `Apply ${c.pattern} v${c.version}`, source: "pattern", ref: `${c.pattern} v${c.version}`, status: "Resolved", azureReality: "no veto", ledger: [], alternative: null }
            : { text: "Use the documented default", source: "learn", ref: null, status: "Resolved", azureReality: "no veto", ledger: [], alternative: null };
    }
    return resolution;
}

test("--validate checks a completed resolution, and the ledger next to it when there is one", async () => {
    const pack = writePatterns([tierSpec()]);
    const { root, file } = writeAssessmentFile();
    const generated = await run(["--assessment", file, "--patterns-dir", pack]);
    const out = generated.json.out;

    const fresh = await run(["--validate", out]);
    assert.equal(fresh.code, 2);
    assert.equal(fresh.json.details.length, 17);
    assert.equal(fresh.json.details[0], "slots[0].decision: objectives has no decision yet");

    writeFileSync(out, JSON.stringify(complete17(readJson(out))));
    const valid = await run(["--validate", out]);
    assert.equal(valid.code, 0, valid.stderr);
    assert.deepEqual({ valid: valid.json.valid, file: valid.json.file, slots: valid.json.slots, ledgerChecked: valid.json.ledgerChecked }, { valid: true, file: out, slots: 17, ledgerChecked: false });

    const cited = readJson(out);
    cited.slots[3].decision.ledger = ["F-0001"];
    writeFileSync(out, JSON.stringify(cited));
    writeFileSync(path.join(root, "evidence", "ledger.json"), JSON.stringify({ schemaVersion: 1, entries: [{ id: "F-0001" }] }));
    const ok = await run(["--validate", out]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(ok.json.ledgerChecked, true);

    cited.slots[3].decision.ledger = ["F-0001", "F-0002"];
    writeFileSync(out, JSON.stringify(cited));
    const missing = await run(["--validate", out]);
    assert.equal(missing.code, 2);
    assert.deepEqual(missing.json.details, ["slots[3].decision.ledger: F-0002 is not in the ledger"]);
});

test("--validate reports an unreadable or non-JSON file with exit 2", async () => {
    const { root } = writeAssessmentFile();
    assert.equal((await run(["--validate", path.join(root, "missing.json")])).code, 2);
    const text = path.join(root, "text.json");
    writeFileSync(text, "not json");
    assert.equal((await run(["--validate", text])).code, 2);
});
