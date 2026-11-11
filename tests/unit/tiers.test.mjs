import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { checkTargets, formatSeconds, tierBands } from "../../skills/azure-dr-assessment/scripts/lib/tiers.mjs";
import { writePatterns } from "../helpers/pack-fixture.mjs";
import { TIER_PARAMETERS, tierSpec } from "../helpers/tier-fixture.mjs";

const packWith = (fields) => loadPack(writePatterns([tierSpec(fields)]));
const assess = (objectives) => normalizeAssessment({ workload: { name: "checkout" }, objectives });

test("tierBands reads parameters.tiers of DR-TIER-001 into seconds", async () => {
    assert.deepEqual(tierBands(await packWith()), [
        { tier: 0, pattern: "Active/Active", rpo: { minSeconds: null, maxSeconds: null }, rto: { minSeconds: null, maxSeconds: null }, cost: "~2.2×–2.5×" },
        { tier: 1, pattern: "Hot/Warm (Active/Passive)", rpo: { minSeconds: 1, maxSeconds: 3540 }, rto: { minSeconds: 1800, maxSeconds: 7200 }, cost: "~2.2×–2.5×" },
        { tier: 2, pattern: "Hot/Cold — minimal secondary compute (ASR)", rpo: { minSeconds: 3600, maxSeconds: 14400 }, rto: { minSeconds: 14400, maxSeconds: 43200 }, cost: "~1.3×–1.6×" },
        { tier: 3, pattern: "Cold (Backup/Restore)", rpo: { minSeconds: 86400, maxSeconds: null }, rto: { minSeconds: 86400, maxSeconds: 259200 }, cost: "~1.05×–1.3×" },
    ]);
});

test("tierBands is empty when the pack has no DR-TIER-001", async () => {
    const pack = await loadPack(writePatterns([{ id: "DR-OTHER-001" }]));
    assert.deepEqual(tierBands(pack), []);
});

test("tierBands rejects malformed parameters with one detail per problem", async () => {
    const broken = structuredClone(TIER_PARAMETERS);
    delete broken.tiers[2];
    broken.tiers[0].cost = "";
    broken.tiers[1].rto.min = "soon";
    broken.tiers[3].rpo.min = null;
    broken.tiers[3].rto.max = "1h";
    await assert.rejects(
        async () => tierBands(await packWith({ parameters: broken })),
        (e) => {
            assert.ok(e instanceof CliError);
            assert.equal(e.code, EXIT.INPUT);
            assert.deepEqual(e.details, [
                "parameters.tiers.0.cost: must be a non-empty string",
                'parameters.tiers.1.rto.min: expected a duration such as 30m, or null, got "soon"',
                "parameters.tiers.2: missing",
                "parameters.tiers.3.rpo.min: tiers 1 to 3 need a lower bound",
                "parameters.tiers.3.rto: min is above max",
            ]);
            return true;
        },
    );
    await assert.rejects(async () => tierBands(await packWith({ parameters: { source: "none" } })), (e) => e.code === EXIT.INPUT && /parameters\.tiers: must be a mapping/.test(e.details[0]));
});

test("checkTargets: a target below the tier's lower bound is stricter, the bound itself is not", async () => {
    const pack = await packWith();
    const stricter = (objectives) => checkTargets(assess(objectives), pack).stricter;
    assert.deepEqual(stricter({ tier: 1, rto: "10m" }), [{ metric: "rto", targetSeconds: 600, tierMinSeconds: 1800 }]);
    assert.deepEqual(stricter({ tier: 1, rto: "45m" }), []);
    assert.deepEqual(stricter({ tier: 1, rto: "30m" }), []);
    assert.deepEqual(stricter({ tier: 1, rto: "1d" }), []);
    assert.deepEqual(stricter({ tier: 1, rpo: "10s" }), []);
    assert.deepEqual(stricter({ tier: 2, rpo: "30m" }), [{ metric: "rpo", targetSeconds: 1800, tierMinSeconds: 3600 }]);
    assert.deepEqual(stricter({ tier: 3, rto: "12h" }), [{ metric: "rto", targetSeconds: 43200, tierMinSeconds: 86400 }]);
});

test("checkTargets: a zero RPO is stricter for tiers 1 to 3", async () => {
    const pack = await packWith();
    assert.deepEqual(checkTargets(assess({ tier: 1, rpo: "0" }), pack).stricter, [{ metric: "rpo", targetSeconds: 0, tierMinSeconds: 1 }]);
    assert.deepEqual(checkTargets(assess({ tier: 2, rpo: "0" }), pack).stricter, [{ metric: "rpo", targetSeconds: 0, tierMinSeconds: 3600 }]);
    assert.equal(checkTargets(assess({ tier: 3, rpo: "0" }), pack).stricter.length, 1);
});

test("checkTargets: nothing is stricter than tier 0, and an unset tier or target checks nothing", async () => {
    const pack = await packWith();
    assert.deepEqual(checkTargets(assess({ tier: 0, rpo: "0", rto: "1s" }), pack).stricter, []);
    assert.deepEqual(checkTargets(assess({ tier: null, rpo: "0", rto: "1s" }), pack).stricter, []);
    assert.deepEqual(checkTargets(assess({ tier: 1 }), pack).stricter, []);
});

test("checkTargets lists rpo before rto when both are stricter", async () => {
    const stricter = checkTargets(assess({ tier: 3, rto: "12h", rpo: "12h" }), await packWith()).stricter;
    assert.deepEqual(stricter.map((s) => s.metric), ["rpo", "rto"]);
});

test("checkTargets reports whether an exception is recorded", async () => {
    const pack = await packWith();
    const exception = { what: "RTO 10m", approver_role: "CTO", date: "2026-11-04" };
    assert.equal(checkTargets(assess({ tier: 1, rto: "10m" }), pack).excepted, false);
    const excepted = checkTargets(assess({ tier: 1, rto: "10m", exceptions: [exception] }), pack);
    assert.equal(excepted.excepted, true);
    assert.equal(excepted.stricter.length, 1);
});

test("checkTargets finds nothing to check in a pack without DR-TIER-001", async () => {
    const pack = await loadPack(writePatterns([{ id: "DR-OTHER-001" }]));
    assert.deepEqual(checkTargets(assess({ tier: 1, rto: "1m" }), pack), { stricter: [], excepted: false });
});

test("formatSeconds uses whole hours or minutes, else seconds", () => {
    assert.deepEqual([0, 1, 90, 600, 1800, 3540, 7200, 86400].map(formatSeconds), ["0", "1s", "90s", "10m", "30m", "59m", "2h", "24h"]);
});
