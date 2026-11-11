import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { writeAssessmentFile } from "../helpers/resolve-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const repo = path.resolve(import.meta.dirname, "..", "..");
const scripts = path.join(repo, "skills", "azure-dr-assessment", "scripts");
const lintScript = path.join(scripts, "lint-patterns.mjs");
const resolveScript = path.join(scripts, "resolve-patterns.mjs");
const bundledDir = path.join(repo, "skills", "azure-dr-assessment", "patterns");
const fixture = (name) => path.join(repo, "tests", "fixtures", "patterns", name);
const noOverride = { DR_PATTERNS_DIR: undefined };
const complete = { justification: "Internet-facing only; no on-prem DNS dependency", owner_role: "Application owner", date: "2026-11-04" };
const approval = { approver_role: "Platform architecture board", approval_ref: "ARB-2026-114" };
const DNS_INPUTS = ["record_type", "ttl", "record_owner_role", "private_zone_integration"];

const lint = (dir, env = {}) => runScript(lintScript, dir ? ["--patterns-dir", dir] : [], { env: { ...noOverride, ...env } });

/** Run resolve-patterns against a pack for an assessment file, and read the resolution file back when there is one. */
async function resolveFile(file, { dir, args = [], env = {} } = {}) {
    const result = await runScript(resolveScript, ["--assessment", file, ...(dir ? ["--patterns-dir", dir] : []), ...args], { env: { ...noOverride, ...env } });
    const resolution = result.code === 0 && result.json.out ? JSON.parse(readFileSync(result.json.out, "utf8")) : null;
    return { ...result, file, resolution };
}

/** Write an assessment, then resolve it. */
async function resolveWith(fields, opts = {}) {
    const { root, file } = writeAssessmentFile(fields);
    return { ...(await resolveFile(file, opts)), root };
}

/** An assessment file whose overrides block is written by hand, so entries can be malformed in ways normalizeAssessment would hide. */
function assessmentWithOverrides(block) {
    const { file } = writeAssessmentFile();
    writeFileSync(file, readFileSync(file, "utf8").replace("overrides: []", block));
    return file;
}
const slot = (r, name) => r.resolution.slots.find((s) => s.slot === name);
const pattern = (id, version) => ({ source: "pattern", pattern: id, version, overrideIndex: null, alternative: null });

test("lint-patterns passes on the bundled pack, and the bundled pack has no banner", async () => {
    const r = await lint();
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json, {
        ok: true, script: "lint-patterns", packDir: "skills/azure-dr-assessment/patterns", nonDefaultPack: false, banner: null, patterns: 2, findings: [],
    });
});

for (const tier of [0, 1, 2, 3]) {
    test(`resolve-patterns on the bundled pack for tier ${tier}`, async () => {
        const r = await resolveWith({ objectives: { tier } });
        assert.equal(r.code, 0, r.stderr);
        assert.equal(r.json.nonDefaultPack, false);
        assert.equal(r.json.banner, null);
        assert.equal(r.json.gatesOpen, 0);
        assert.deepEqual(r.json.slots, { total: 17, candidate: 17, unresolved: 0 });
        assert.deepEqual(r.json.openInputs.map((i) => i.name), DNS_INPUTS);
        assert.equal(r.resolution.packDir, "skills/azure-dr-assessment/patterns");
        assert.equal(r.resolution.gates[0].detail, `tier ${tier} supplied`);
        assert.deepEqual(slot(r, "objectives").candidate, pattern("DR-TIER-001", 1));
        assert.deepEqual(slot(r, "traffic-dns").candidate, pattern("DR-DNS-001", 1));
        assert.equal(r.resolution.slots.filter((s) => s.candidate.source === "learn").length, 15);
    });
}

test("a missing tier opens tier-missing with the DR-TIER-001 question, and --gates-only writes nothing", async () => {
    const question = (await readPack(bundledDir)).pack.byId.get("DR-TIER-001").gate.question;
    const { root, file } = writeAssessmentFile({ objectives: { tier: null } });
    const r = await runScript(resolveScript, ["--assessment", file, "--gates-only"], { env: noOverride });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.gatesOpen, 1);
    assert.equal(r.json.gates[0].question, question);
    assert.equal(existsSync(path.join(root, "evidence")), false);
});

for (const [name, objectives, open] of [
    ["an RTO under 30 minutes on tier 1", { tier: 1, rto: "10m" }, true],
    ["a zero RPO on tier 1", { tier: 1, rpo: "0" }, true],
    ["an RPO under 1 hour on tier 2", { tier: 2, rpo: "30m" }, true],
    ["an RTO under 24 hours on tier 3", { tier: 3, rto: "12h" }, true],
    ["an RTO inside the tier 1 band", { tier: 1, rto: "45m" }, false],
    ["any target on tier 0", { tier: 0, rpo: "0", rto: "1s" }, false],
]) {
    test(`the target gate: ${name} ${open ? "opens" : "does not open"} target-stricter-than-tier`, async () => {
        const r = await resolveWith({ objectives });
        assert.equal(r.code, 0, r.stderr);
        assert.equal(r.json.gatesOpen, open ? 1 : 0);
        assert.equal(r.json.gates[1].status, open ? "open" : "satisfied");
    });
}

test("a recorded exception turns the open target gate into excepted and is documented", async () => {
    const exception = { what: "RTO 10m", approver_role: "CTO", date: "2026-11-04" };
    const r = await resolveWith({ objectives: { tier: 1, rto: "10m", exceptions: [exception] } });
    assert.equal(r.json.gatesOpen, 0);
    assert.equal(r.json.gates[1].status, "excepted");
    assert.deepEqual(r.resolution.documentedExceptions, [{ kind: "tier-exception", ...exception }]);
});

test("overridable level: a complete entry is applied and documented; stale, misdirected, draft and unknown ones are rejected", async () => {
    const dir = fixture("overridable");
    assert.equal((await lint(dir)).code, 0);
    const applied = await resolveWith({ overrides: [{ pattern: "DR-FAILOVER-001", ...complete, alternative: "Automatic failover with health probes" }] }, { dir });
    assert.equal(applied.code, 0, applied.stderr);
    assert.deepEqual(applied.json.rejectedOverrides, []);
    assert.deepEqual(slot(applied, "failover-approval").candidate, { source: "override", pattern: "DR-FAILOVER-001", version: 1, overrideIndex: 0, alternative: "Automatic failover with health probes" });
    assert.equal(applied.resolution.documentedExceptions.length, 1);
    assert.equal(applied.resolution.documentedExceptions[0].approvalVerified, false);

    const rejected = await resolveWith({
        overrides: [
            { pattern: "DR-FAILOVER-001", ...complete, pattern_version: 2 },
            { pattern: "DR-FAILOVER-001", ...complete, slots: ["compute"] },
            { pattern: "DR-FAILOVER-002", ...complete },
            { pattern: "DR-NOPE-001", ...complete },
        ],
    }, { dir });
    assert.deepEqual(rejected.json.rejectedOverrides.map((o) => [o.index, o.reason]), [
        [0, "stale override: it pins version 2 and DR-FAILOVER-001 is at version 1"],
        [1, "slots not decided by DR-FAILOVER-001: compute"],
        [2, "pattern DR-FAILOVER-002 is draft, not approved"],
        [3, "unknown pattern DR-NOPE-001"],
    ]);
    assert.deepEqual(slot(rejected, "failover-approval").candidate, pattern("DR-FAILOVER-001", 1));
    assert.deepEqual(rejected.resolution.documentedExceptions, []);
});

test("an entry without justification, owner role or date is rejected with the missing fields, listed, and the pattern keeps applying", async () => {
    const r = await resolveWith({ overrides: [{ pattern: "DR-FAILOVER-001", owner_role: "Application owner" }] }, { dir: fixture("overridable") });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.rejectedOverrides, [{ index: 0, pattern: "DR-FAILOVER-001", reason: "missing required fields: justification, date" }]);
    assert.deepEqual(r.resolution.overrides.map((o) => [o.index, o.outcome, o.reason]), [[0, "rejected", "missing required fields: justification, date"]]);
    assert.deepEqual(slot(r, "failover-approval").candidate, pattern("DR-FAILOVER-001", 1));
    assert.deepEqual(r.resolution.documentedExceptions, []);
});

test("malformed entries are rejected with their reasons and never stop the run", async () => {
    const file = assessmentWithOverrides([
        "overrides:",
        "  - pattern: DR-FAILOVER-001",
        "    justification: Needed for the pilot",
        "    owner_role: Application owner",
        "    date: soon",
        "    pattern_version: one",
        "  - just a string",
        "  - 5",
        "  - justification: Needed for the pilot",
        "    owner_role: Application owner",
        "    date: 2026-11-04",
    ].join("\n"));
    const r = await resolveFile(file, { dir: fixture("overridable") });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.rejectedOverrides, [
        { index: 0, pattern: "DR-FAILOVER-001", reason: "pattern_version must be an integer; date must be a date as YYYY-MM-DD" },
        { index: 1, pattern: "", reason: "missing required fields: pattern" },
        { index: 2, pattern: "", reason: "missing required fields: pattern" },
        { index: 3, pattern: "", reason: "missing required fields: pattern" },
    ]);
    assert.deepEqual(r.resolution.overrides.map((o) => o.outcome), ["rejected", "rejected", "rejected", "rejected"]);
    assert.deepEqual(slot(r, "failover-approval").candidate, pattern("DR-FAILOVER-001", 1));
    assert.deepEqual(r.resolution.documentedExceptions, []);
});

test("a list field that is not a list still ends the run with exit 2", async () => {
    const file = assessmentWithOverrides("overrides:\n  pattern: DR-FAILOVER-001\n  justification: Needed for the pilot");
    const r = await resolveFile(file, { dir: fixture("overridable") });
    assert.equal(r.code, 2);
    assert.deepEqual(r.json.details, ["overrides: must be a list"]);
});

test("an assessment without an environment still gets the production-only pattern, and the register says why", async () => {
    const dir = fixture("overridable");
    const unset = await resolveWith({ workload: { name: "checkout" } }, { dir });
    assert.equal(unset.code, 0, unset.stderr);
    assert.deepEqual(slot(unset, "failover-approval").candidate, pattern("DR-FAILOVER-001", 1));
    const entry = unset.resolution.patterns.find((p) => p.id === "DR-FAILOVER-001");
    assert.equal(entry.applied, true);
    assert.equal(entry.reason, "workload.environment is not set: applied because the pattern is restricted to environments [production]");
    const dev = await resolveWith({ workload: { name: "checkout", environment: "dev" } }, { dir });
    assert.equal(slot(dev, "failover-approval").candidate.source, "learn");
});

test("approval-required level: DR-DNS-001 needs the approver and the reference, and the approval stays unverified", async () => {
    const incomplete = await resolveWith({ overrides: [{ pattern: "DR-DNS-001", ...complete }] });
    assert.deepEqual(incomplete.json.rejectedOverrides, [{ index: 0, pattern: "DR-DNS-001", reason: "missing required fields: approver_role, approval_ref" }]);
    assert.deepEqual(slot(incomplete, "traffic-dns").candidate, pattern("DR-DNS-001", 1));

    const ok = await resolveWith({ overrides: [{ pattern: "DR-DNS-001", ...complete, ...approval, alternative: "Azure Front Door with health probes" }] });
    assert.deepEqual(ok.json.rejectedOverrides, []);
    assert.equal(ok.resolution.overrides[0].approvalVerified, false);
    assert.equal(slot(ok, "traffic-dns").candidate.source, "override");
    assert.deepEqual(ok.json.openInputs, []);
    assert.deepEqual(ok.resolution.documentedExceptions[0].approval_ref, "ARB-2026-114");
});

test("locked level: an override of DR-TIER-001 is rejected and the pattern keeps applying", async () => {
    const r = await resolveWith({ overrides: [{ pattern: "DR-TIER-001", ...complete, ...approval }] });
    assert.deepEqual(r.json.rejectedOverrides, [{ index: 0, pattern: "DR-TIER-001", reason: "locked pattern: change it through this repository" }]);
    assert.deepEqual(slot(r, "objectives").candidate, pattern("DR-TIER-001", 1));
    assert.deepEqual(r.resolution.documentedExceptions, []);
});

test("supersedes: the newer pattern displaces the older one on shared slots only", async () => {
    const dir = fixture("supersedes");
    assert.equal((await lint(dir)).code, 0);
    const r = await resolveWith({}, { dir });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(slot(r, "detection").candidate, pattern("DR-NEW-002", 2));
    assert.deepEqual(slot(r, "testing").candidate, pattern("DR-OLD-001", 1));
    assert.equal(r.json.slots.unresolved, 0);
});

test("collisions: lint fails with slot-collision, resolution leaves the slot unresolved and names both patterns", async () => {
    const dir = fixture("collisions");
    const linted = await lint(dir);
    assert.equal(linted.code, 2);
    assert.deepEqual(linted.json.findings.map((f) => f.rule), ["slot-collision"]);
    const r = await resolveWith({}, { dir });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.slots, { total: 17, candidate: 16, unresolved: 1 });
    assert.deepEqual(r.json.collisions, [{ slot: "failover-approval", patterns: ["DR-AUTO-001 v2", "DR-MANUAL-001 v1"] }]);
    assert.equal(slot(r, "failover-approval").status, "unresolved");
});

test("drafts: draft, deprecated and superseded patterns never apply", async () => {
    const dir = fixture("drafts");
    assert.equal((await lint(dir)).code, 0);
    const r = await resolveWith({ overrides: [{ pattern: "DR-DEPRECATED-001", ...complete }, { pattern: "DR-SUPERSEDED-001", ...complete }] }, { dir });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(slot(r, "compute").candidate.source, "learn");
    assert.deepEqual(slot(r, "identity").candidate, pattern("DR-LIVE-001", 1));
    assert.deepEqual(r.resolution.patterns.map((p) => [p.id, p.applied]), [
        ["DR-DEPRECATED-001", false], ["DR-DRAFT-001", false], ["DR-LIVE-001", true], ["DR-SUPERSEDED-001", false],
    ]);
    assert.equal(r.resolution.patterns[0].reason, "status is deprecated; only approved patterns apply");
    assert.deepEqual(r.json.rejectedOverrides.map((o) => [o.index, o.pattern, o.reason]), [
        [0, "DR-DEPRECATED-001", "pattern DR-DEPRECATED-001 is deprecated, not approved"],
        [1, "DR-SUPERSEDED-001", "pattern DR-SUPERSEDED-001 is superseded, not approved"],
    ]);
});

test("cycles: lint reports every pattern in the cycle and resolution refuses the pack", async () => {
    const dir = fixture("cycles");
    const linted = await lint(dir);
    assert.equal(linted.code, 2);
    assert.deepEqual(linted.json.findings.map((f) => [f.id, f.rule]), [["DR-CYCA-001", "supersedes-cycle"], ["DR-CYCB-001", "supersedes-cycle"]]);
    const r = await resolveWith({}, { dir });
    assert.equal(r.code, 2);
    assert.match(r.json.details[0], /\[supersedes-cycle\]/);
});

test("a non-default pack sets the banner in both scripts, through --patterns-dir and through DR_PATTERNS_DIR", async () => {
    const dir = fixture("collisions");
    const banner = "NON-DEFAULT PATTERN PACK: tests/fixtures/patterns/collisions (test or operator override, not the company pack)";
    const viaFlag = await resolveWith({}, { dir });
    assert.equal(viaFlag.json.nonDefaultPack, true);
    assert.equal(viaFlag.json.banner, banner);
    assert.equal(viaFlag.resolution.banner, banner);
    const viaEnv = await resolveWith({}, { env: { DR_PATTERNS_DIR: dir } });
    assert.equal(viaEnv.resolution.nonDefaultPack, true);
    assert.equal(viaEnv.resolution.banner, banner);
    const explicitDefault = await resolveWith({}, { dir: bundledDir });
    assert.deepEqual([explicitDefault.json.nonDefaultPack, explicitDefault.json.banner], [false, null]);

    // the collisions fixture fails the lint (exit 2), and the failure envelope still carries the banner
    const lintedViaFlag = await lint(dir);
    assert.equal(lintedViaFlag.code, 2);
    assert.deepEqual([lintedViaFlag.json.nonDefaultPack, lintedViaFlag.json.banner], [true, banner]);
    const lintedViaEnv = await lint(null, { DR_PATTERNS_DIR: dir });
    assert.deepEqual([lintedViaEnv.json.nonDefaultPack, lintedViaEnv.json.banner], [true, banner]);
    const lintedSupersedes = await lint(fixture("supersedes"));
    assert.equal(lintedSupersedes.code, 0);
    assert.equal(lintedSupersedes.json.banner, "NON-DEFAULT PATTERN PACK: tests/fixtures/patterns/supersedes (test or operator override, not the company pack)");
    const lintedDefault = await lint(bundledDir);
    assert.deepEqual([lintedDefault.json.nonDefaultPack, lintedDefault.json.banner], [false, null]);
});

test("an assessment cannot choose a pack: a patterns.paths key in assessment.yaml is ignored", async () => {
    const { file } = writeAssessmentFile();
    writeFileSync(file, `${readFileSync(file, "utf8")}patterns:\n  paths:\n    - ${fixture("collisions")}\n`);
    const r = await runScript(resolveScript, ["--assessment", file], { env: noOverride });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.nonDefaultPack, false);
    assert.deepEqual(r.json.collisions, []);
});

test("--validate accepts a completed resolution and checks cited ledger ids", async () => {
    const generated = await resolveWith({});
    const out = generated.json.out;
    const fresh = await runScript(resolveScript, ["--validate", out], { env: noOverride });
    assert.equal(fresh.code, 2);
    assert.equal(fresh.json.details.length, 17);

    const resolution = generated.resolution;
    for (const row of resolution.slots) {
        const c = row.candidate;
        row.decision = c.source === "pattern"
            ? { text: `Apply ${c.pattern} v${c.version}`, source: "pattern", ref: `${c.pattern} v${c.version}`, status: "Resolved", azureReality: "no veto", ledger: [], alternative: null }
            : { text: "Follow the Microsoft Learn guidance", source: "learn", ref: null, status: "Resolved", azureReality: "no veto", ledger: [], alternative: null };
    }
    writeFileSync(out, JSON.stringify(resolution));
    const valid = await runScript(resolveScript, ["--validate", out], { env: noOverride });
    assert.equal(valid.code, 0, valid.stderr);
    assert.equal(valid.json.valid, true);

    resolution.slots[0].decision.ledger = ["F-0001"];
    writeFileSync(out, JSON.stringify(resolution));
    writeFileSync(path.join(path.dirname(out), "ledger.json"), JSON.stringify({ schemaVersion: 1, entries: [{ id: "F-0002" }] }));
    const unknown = await runScript(resolveScript, ["--validate", out], { env: noOverride });
    assert.equal(unknown.code, 2);
    assert.deepEqual(unknown.json.details, ["slots[0].decision.ledger: F-0001 is not in the ledger"]);
});

test("exit codes: usage errors are 1, bad inputs are 2", async () => {
    assert.equal((await runScript(lintScript, ["--nope"], { env: noOverride })).code, 1);
    assert.equal((await runScript(resolveScript, ["--nope"], { env: noOverride })).code, 1);
    assert.equal((await runScript(resolveScript, [], { env: noOverride })).code, 1);
    assert.equal((await lint(path.join(fixture("drafts"), "missing"))).code, 2);
    const { root } = writeAssessmentFile();
    assert.equal((await runScript(resolveScript, ["--assessment", path.join(root, "missing.yaml")], { env: noOverride })).code, 2);
    assert.equal((await runScript(lintScript, ["--help"], { env: noOverride })).code, 0);
    assert.equal((await runScript(resolveScript, ["--help"], { env: noOverride })).code, 0);
});

test("the pack status table in the authoring guide matches the bundled pack", async () => {
    const guide = readFileSync(path.join(bundledDir, "README.md"), "utf8");
    const status = guide.split(/^## /m).find((s) => s.startsWith("Pack status\n"));
    const rows = [...status.matchAll(/^\|\s*`(DR-[A-Z]+-\d{3})`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)].map((m) => m.slice(1, 5));
    const { pack } = await readPack(bundledDir);
    const byId = (a, b) => a[0].localeCompare(b[0]);
    assert.deepEqual(rows.sort(byId), pack.patterns.map((p) => [p.id, p.slots.join(", "), p.override, p.status]).sort(byId));
});

test("package.json defines the lint:patterns script and keeps the Plan 1 constraints", () => {
    const pkg = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
    assert.equal(pkg.scripts["lint:patterns"], "node skills/azure-dr-assessment/scripts/lint-patterns.mjs");
    assert.equal(pkg.scripts.test, "node tests/run-all.mjs");
    assert.equal(pkg.engines.node, ">=22.0.0");
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
});
