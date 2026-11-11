import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { validateOverrides } from "../../skills/azure-dr-assessment/scripts/lib/overrides.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { writePatterns } from "../helpers/pack-fixture.mjs";

const pack = () => loadPack(writePatterns([
    { id: "DR-OVR-001", version: 2, slots: ["ingress", "compute"], override: "overridable" },
    { id: "DR-APR-001", slots: ["traffic-dns"], override: "approval-required" },
    { id: "DR-LCK-001", slots: ["objectives"], override: "locked" },
    { id: "DR-DRF-001", slots: ["testing"], override: "overridable", status: "draft" },
]));
const complete = { justification: "No on-prem DNS dependency", owner_role: "Application owner", date: "2026-11-04" };
const approval = { approver_role: "Platform architecture board", approval_ref: "ARB-2026-114" };
const assess = (...overrides) => normalizeAssessment({ workload: { name: "checkout" }, overrides });

test("a complete overridable entry is applied and defaults to every slot the pattern decides", async () => {
    const a = assess({ pattern: "DR-OVR-001", ...complete });
    const { applied, rejected } = validateOverrides(a, await pack());
    assert.deepEqual(rejected, []);
    assert.deepEqual(applied, [{
        index: 0,
        pattern: "DR-OVR-001",
        level: "overridable",
        slots: ["ingress", "compute"],
        outcome: "applied",
        reason: "complete",
        approvalVerified: false,
        entry: a.overrides[0],
    }]);
});

test("an overridable entry without all required fields is rejected, and the reason lists them", async () => {
    const a = assess({ pattern: "DR-OVR-001", owner_role: "Application owner" });
    const { applied, rejected } = validateOverrides(a, await pack());
    assert.deepEqual(applied, []);
    assert.equal(rejected[0].outcome, "rejected");
    assert.equal(rejected[0].reason, "missing required fields: justification, date");
    assert.equal(rejected[0].approvalVerified, false);
});

test("an approval-required entry is applied with the approver and the reference, and the approval stays unverified", async () => {
    const a = assess({ pattern: "DR-APR-001", ...complete, ...approval });
    const { applied, rejected } = validateOverrides(a, await pack());
    assert.deepEqual(rejected, []);
    assert.equal(applied[0].level, "approval-required");
    assert.deepEqual(applied[0].slots, ["traffic-dns"]);
    assert.equal(applied[0].reason, "complete");
    assert.equal(applied[0].approvalVerified, false);
});

test("an approval-required entry needs the approver role and the approval reference", async () => {
    const noApproval = validateOverrides(assess({ pattern: "DR-APR-001", ...complete }), await pack());
    assert.equal(noApproval.rejected[0].reason, "missing required fields: approver_role, approval_ref");
    const noReference = validateOverrides(assess({ pattern: "DR-APR-001", ...complete, approver_role: "Platform architecture board" }), await pack());
    assert.equal(noReference.rejected[0].reason, "missing required fields: approval_ref");
});

test("a locked pattern rejects every entry, even a complete one", async () => {
    const { applied, rejected } = validateOverrides(assess({ pattern: "DR-LCK-001", ...complete, ...approval }), await pack());
    assert.deepEqual(applied, []);
    assert.equal(rejected[0].level, "locked");
    assert.equal(rejected[0].reason, "locked pattern: change it through this repository");
    assert.deepEqual(rejected[0].slots, ["objectives"]);
});

test("an unknown pattern id, a missing id and a pattern that is not approved are rejected", async () => {
    const { rejected } = validateOverrides(assess(
        { pattern: "DR-NOPE-001", ...complete, slots: ["compute"] },
        { pattern: "", ...complete },
        { pattern: "DR-DRF-001", ...complete },
    ), await pack());
    assert.deepEqual(rejected.map((r) => [r.index, r.level, r.reason]), [
        [0, "unknown", "unknown pattern DR-NOPE-001"],
        [1, "unknown", "missing required fields: pattern"],
        [2, "overridable", "pattern DR-DRF-001 is draft, not approved"],
    ]);
    assert.deepEqual(rejected[0].slots, ["compute"]);
});

test("an entry may name some of the slots the pattern decides, but not others", async () => {
    const ok = validateOverrides(assess({ pattern: "DR-OVR-001", ...complete, slots: ["compute", "compute"] }), await pack());
    assert.deepEqual(ok.applied[0].slots, ["compute"]);
    const bad = validateOverrides(assess({ pattern: "DR-OVR-001", ...complete, slots: ["compute", "traffic-dns", "backup"] }), await pack());
    assert.equal(bad.rejected[0].reason, "slots not decided by DR-OVR-001: traffic-dns, backup");
    assert.deepEqual(bad.rejected[0].slots, ["compute", "traffic-dns", "backup"]);
});

test("an explicitly empty slots list is rejected, because a mistyped scalar normalizes to it", async () => {
    const a = assess({ pattern: "DR-OVR-001", ...complete, slots: "compute" });
    assert.deepEqual(a.overrides[0].slots, []);
    const { applied, rejected } = validateOverrides(a, await pack());
    assert.deepEqual(applied, []);
    assert.equal(rejected[0].reason, "slots is empty: list the slots this entry waives, or omit slots to waive every slot the pattern decides");
    assert.deepEqual(rejected[0].slots, []);
    const omitted = validateOverrides(assess({ pattern: "DR-OVR-001", ...complete }), await pack());
    assert.deepEqual(omitted.applied[0].slots, ["ingress", "compute"]);
});

test("a pinned version that differs from the pattern's version is a stale override", async () => {
    const stale = validateOverrides(assess({ pattern: "DR-OVR-001", ...complete, pattern_version: 1 }), await pack());
    assert.equal(stale.rejected[0].reason, "stale override: it pins version 1 and DR-OVR-001 is at version 2");
    const current = validateOverrides(assess({ pattern: "DR-OVR-001", ...complete, pattern_version: 2 }), await pack());
    assert.equal(current.applied.length, 1);
});

test("a pinned version that is not an integer is rejected, whatever its value", async () => {
    for (const pin of ["one", "2", 2.5, true]) {
        const { applied, rejected } = validateOverrides(assess({ pattern: "DR-OVR-001", ...complete, pattern_version: pin }), await pack());
        assert.deepEqual(applied, [], String(pin));
        assert.equal(rejected[0].reason, "pattern_version must be an integer", String(pin));
    }
});

test("a date that is not a real YYYY-MM-DD date is rejected", async () => {
    for (const date of ["soon", "2026-13-40", "2026-02-30", "2026-2-3", "04/11/2026", "20261104"]) {
        const { applied, rejected } = validateOverrides(assess({ pattern: "DR-OVR-001", ...complete, date }), await pack());
        assert.deepEqual(applied, [], date);
        assert.equal(rejected[0].reason, "date must be a date as YYYY-MM-DD", date);
    }
    const leapDay = validateOverrides(assess({ pattern: "DR-OVR-001", ...complete, date: "2024-02-29" }), await pack());
    assert.equal(leapDay.applied.length, 1);
});

test("every entry-level problem is listed in one reason, in a fixed order", async () => {
    const { rejected } = validateOverrides(assess({ pattern: "DR-OVR-001", pattern_version: 1, slots: ["backup"], owner_role: "Application owner" }), await pack());
    assert.equal(
        rejected[0].reason,
        "stale override: it pins version 1 and DR-OVR-001 is at version 2; slots not decided by DR-OVR-001: backup; missing required fields: justification, date",
    );
    const all = validateOverrides(assess({ pattern: "DR-OVR-001", pattern_version: "one", slots: ["backup"], owner_role: "Application owner", date: "soon" }), await pack());
    assert.equal(
        all.rejected[0].reason,
        "pattern_version must be an integer; slots not decided by DR-OVR-001: backup; missing required fields: justification; date must be a date as YYYY-MM-DD",
    );
});

test("an entry that is not a mapping, or names no pattern, cannot be attributed and is rejected", async () => {
    const a = normalizeAssessment({
        workload: { name: "checkout" },
        overrides: ["not a mapping", 5, null, { ...complete, alternative: "Use Front Door" }],
    });
    assert.deepEqual(a.overrides[0], { pattern: "", justification: "", owner_role: "", date: "" });
    const { applied, rejected } = validateOverrides(a, await pack());
    assert.deepEqual(applied, []);
    assert.deepEqual(rejected.map((r) => [r.index, r.pattern, r.level, r.slots, r.reason]), [
        [0, "", "unknown", [], "missing required fields: pattern"],
        [1, "", "unknown", [], "missing required fields: pattern"],
        [2, "", "unknown", [], "missing required fields: pattern"],
        [3, "", "unknown", [], "missing required fields: pattern"],
    ]);
    assert.ok(rejected.every((r) => r.outcome === "rejected" && r.approvalVerified === false));
});

test("entries keep their position and each list keeps the entry order", async () => {
    const a = assess(
        { pattern: "DR-OVR-001", ...complete },
        { pattern: "DR-LCK-001", ...complete },
        { pattern: "DR-APR-001", ...complete, ...approval },
    );
    const { applied, rejected } = validateOverrides(a, await pack());
    assert.deepEqual(applied.map((o) => o.index), [0, 2]);
    assert.deepEqual(rejected.map((o) => o.index), [1]);
    assert.equal(rejected[0].entry, a.overrides[1]);
});

test("no overrides give empty lists", async () => {
    assert.deepEqual(validateOverrides(assess(), await pack()), { applied: [], rejected: [] });
});
