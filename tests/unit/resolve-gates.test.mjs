import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { evaluateGates } from "../../skills/azure-dr-assessment/scripts/lib/resolve.mjs";
import { writePatterns } from "../helpers/pack-fixture.mjs";
import { TIER_QUESTION, tierSpec } from "../helpers/tier-fixture.mjs";

const assess = (objectives) => normalizeAssessment({ workload: { name: "checkout" }, objectives });
const exception = { what: "RTO 10m", approver_role: "CTO", date: "2026-11-04" };
const gateOf = (id, gates) => gates.find((g) => g.id === id);

test("a missing tier opens tier-missing with the DR-TIER-001 question verbatim", async () => {
    const pack = await loadPack(writePatterns([tierSpec()]));
    assert.equal(pack.byId.get("DR-TIER-001").gate.question, TIER_QUESTION);
    assert.deepEqual(evaluateGates(assess({ tier: null }), pack), [
        { id: "tier-missing", pattern: "DR-TIER-001", status: "open", detail: "no tier supplied; ask the tier question alone and first", question: TIER_QUESTION },
        { id: "target-stricter-than-tier", pattern: "DR-TIER-001", status: "satisfied", detail: "no tier supplied; numeric targets are checked once a tier is set", question: null },
    ]);
});

test("a supplied tier satisfies tier-missing and a target inside the band satisfies the other gate", async () => {
    const pack = await loadPack(writePatterns([tierSpec()]));
    assert.deepEqual(evaluateGates(assess({ tier: 1, rto: "45m" }), pack), [
        { id: "tier-missing", pattern: "DR-TIER-001", status: "satisfied", detail: "tier 1 supplied", question: null },
        { id: "target-stricter-than-tier", pattern: "DR-TIER-001", status: "satisfied", detail: "no numeric target is stricter than tier 1", question: null },
    ]);
});

test("a stricter target opens target-stricter-than-tier until an exception is recorded", async () => {
    const pack = await loadPack(writePatterns([tierSpec()]));
    const open = gateOf("target-stricter-than-tier", evaluateGates(assess({ tier: 1, rto: "10m" }), pack));
    assert.deepEqual(open, {
        id: "target-stricter-than-tier",
        pattern: "DR-TIER-001",
        status: "open",
        detail: "RTO 10m is below the tier 1 lower bound of 30m; change the tier or record an objectives.exceptions entry",
        question: null,
    });
    const excepted = gateOf("target-stricter-than-tier", evaluateGates(assess({ tier: 1, rto: "10m", exceptions: [exception] }), pack));
    assert.equal(excepted.status, "excepted");
    assert.equal(excepted.detail, "RTO 10m is below the tier 1 lower bound of 30m; recorded as an objectives.exceptions entry; one entry covers all");
});

test("every stricter target is named in the detail, and one exception covers all of them", async () => {
    const pack = await loadPack(writePatterns([tierSpec()]));
    const gate = gateOf("target-stricter-than-tier", evaluateGates(assess({ tier: 3, rpo: "12h", rto: "12h" }), pack));
    assert.equal(
        gate.detail,
        "RPO 12h is below the tier 3 lower bound of 24h; RTO 12h is below the tier 3 lower bound of 24h; change the tier or record an objectives.exceptions entry",
    );
    const excepted = gateOf("target-stricter-than-tier", evaluateGates(assess({ tier: 3, rpo: "12h", rto: "12h", exceptions: [exception] }), pack));
    assert.equal(excepted.status, "excepted");
    assert.equal(
        excepted.detail,
        "RPO 12h is below the tier 3 lower bound of 24h; RTO 12h is below the tier 3 lower bound of 24h; recorded as an objectives.exceptions entry; one entry covers all",
    );
});

test("tier 0 has no numeric band, so no target opens the gate", async () => {
    const pack = await loadPack(writePatterns([tierSpec()]));
    const gates = evaluateGates(assess({ tier: 0, rpo: "0", rto: "1s" }), pack);
    assert.deepEqual(gates.map((g) => g.status), ["satisfied", "satisfied"]);
});

test("an exception without a stricter target leaves the gate satisfied", async () => {
    const pack = await loadPack(writePatterns([tierSpec()]));
    assert.equal(gateOf("target-stricter-than-tier", evaluateGates(assess({ tier: 1, rto: "2h", exceptions: [exception] }), pack)).status, "satisfied");
});

test("a pack without DR-TIER-001 still evaluates the gates, with no question", async () => {
    const pack = await loadPack(writePatterns([{ id: "DR-OTHER-001" }]));
    const gates = evaluateGates(assess({ tier: null }), pack);
    assert.equal(gates[0].status, "open");
    assert.equal(gates[0].question, null);
});
