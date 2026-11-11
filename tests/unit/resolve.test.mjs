import assert from "node:assert/strict";
import test from "node:test";
import { SLOT_IDS, loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { resolveSlots, validateResolution } from "../../skills/azure-dr-assessment/scripts/lib/resolve.mjs";
import { writePatterns } from "../helpers/pack-fixture.mjs";
import { dnsSpec, sampleAssessment } from "../helpers/resolve-fixture.mjs";
import { TIER_QUESTION, tierSpec } from "../helpers/tier-fixture.mjs";

const complete = { justification: "No on-prem DNS dependency", owner_role: "Application owner", date: "2026-11-04" };
const approval = { approver_role: "Platform architecture board", approval_ref: "ARB-2026-114" };
const resolveWith = async (specs, fields = {}) => resolveSlots(sampleAssessment(fields), await loadPack(writePatterns(specs)));
const row = (resolution, slot) => resolution.slots.find((s) => s.slot === slot);
const learn = { source: "learn", pattern: null, version: null, overrideIndex: null, alternative: null };

test("resolveSlots lists every slot: the pattern where one decides it, Learn elsewhere", async () => {
    const r = await resolveWith([tierSpec(), dnsSpec()]);
    assert.deepEqual(Object.keys(r), [
        "schemaVersion", "generatedAt", "assessment", "packDir", "nonDefaultPack", "banner",
        "gates", "patterns", "overrides", "openInputs", "slots", "documentedExceptions",
    ]);
    assert.equal(r.schemaVersion, 1);
    assert.equal(new Date(r.generatedAt).toISOString(), r.generatedAt);
    assert.equal(r.assessment, "assessment.yaml");
    assert.deepEqual(r.slots.map((s) => s.slot), SLOT_IDS);
    assert.deepEqual(row(r, "objectives"), {
        slot: "objectives",
        candidate: { source: "pattern", pattern: "DR-TIER-001", version: 1, overrideIndex: null, alternative: null },
        collision: null,
        status: "candidate",
        decision: null,
    });
    assert.deepEqual(row(r, "traffic-dns").candidate, { source: "pattern", pattern: "DR-DNS-001", version: 1, overrideIndex: null, alternative: null });
    assert.deepEqual(row(r, "compute"), { slot: "compute", candidate: learn, collision: null, status: "candidate", decision: null });
    assert.equal(r.slots.filter((s) => s.candidate.source === "learn").length, SLOT_IDS.length - 2);
    assert.deepEqual(r.overrides, []);
    assert.deepEqual(r.documentedExceptions, []);
});

test("the register lists every pattern with whether it applies and why", async () => {
    const r = await resolveWith([
        tierSpec(),
        dnsSpec({ applies_to: { tiers: [0] } }),
        { id: "DR-DRF-001", status: "draft", slots: ["testing"] },
    ]);
    assert.deepEqual(r.patterns, [
        { id: "DR-DNS-001", version: 1, status: "approved", override: "approval-required", applied: false, reason: "tiers [0] do not include tier 1" },
        { id: "DR-DRF-001", version: 1, status: "draft", override: "overridable", applied: false, reason: "status is draft; only approved patterns apply" },
        { id: "DR-TIER-001", version: 1, status: "approved", override: "locked", applied: true, reason: "approved and applicable" },
    ]);
    assert.deepEqual(row(r, "traffic-dns").candidate, learn);
    assert.deepEqual(row(r, "testing").candidate, learn);
});

test("a pattern restricted to environments still decides its slot while the environment is unset, and the register says why", async () => {
    const specs = [{ id: "DR-PROD-001", slots: ["detection"], override: "locked", applies_to: { environments: ["production", "staging"] } }];
    const unset = await resolveWith(specs, { workload: { name: "checkout" } });
    assert.deepEqual(row(unset, "detection").candidate, { source: "pattern", pattern: "DR-PROD-001", version: 1, overrideIndex: null, alternative: null });
    assert.deepEqual(unset.patterns.map((p) => [p.id, p.applied, p.reason]), [
        ["DR-PROD-001", true, "workload.environment is not set: applied because the pattern is restricted to environments [production, staging]"],
    ]);
    const known = await resolveWith(specs, { workload: { name: "checkout", environment: "dev" } });
    assert.deepEqual(row(known, "detection").candidate, learn);
    assert.equal(known.patterns[0].reason, "environments [production, staging] do not include dev");
});

test("draft, deprecated and superseded patterns never decide a slot", async () => {
    const r = await resolveWith(["draft", "deprecated", "superseded"].map((status) => ({ id: `DR-${status.toUpperCase()}-001`, status, slots: ["compute"] })));
    assert.deepEqual(row(r, "compute").candidate, learn);
    assert.equal(r.patterns.every((p) => p.applied === false), true);
});

test("a non-default pack sets nonDefaultPack and the banner; the bundled pack does not", async () => {
    const dir = writePatterns([tierSpec()]);
    const other = resolveSlots(sampleAssessment(), await loadPack(dir));
    assert.equal(other.nonDefaultPack, true);
    assert.equal(other.packDir, dir);
    assert.equal(other.banner, `NON-DEFAULT PATTERN PACK: ${dir} (test or operator override, not the company pack)`);
    const bundled = resolveSlots(sampleAssessment(), await loadPack(dir, { isDefault: true }));
    assert.deepEqual([bundled.nonDefaultPack, bundled.banner], [false, null]);
});

test("the resolution carries the two gates", async () => {
    const r = await resolveWith([tierSpec()], { objectives: { tier: null } });
    assert.deepEqual(r.gates.map((g) => [g.id, g.status]), [["tier-missing", "open"], ["target-stricter-than-tier", "satisfied"]]);
    assert.equal(r.gates[0].question, TIER_QUESTION);
});

test("openInputs lists the required inputs the application team has not supplied", async () => {
    const pack = await loadPack(writePatterns([tierSpec(), dnsSpec()]));
    const open = (pattern_inputs) => resolveSlots(sampleAssessment({ pattern_inputs }), pack).openInputs;
    assert.deepEqual(open({}), [
        { pattern: "DR-DNS-001", name: "record_type", description: "DNS record type" },
        { pattern: "DR-DNS-001", name: "ttl", description: "TTL in seconds" },
    ]);
    assert.deepEqual(open({ "DR-DNS-001": { record_type: "A", ttl: 300 } }), []);
    assert.deepEqual(open({ "DR-DNS-001": { record_type: "A", ttl: null } }).map((i) => i.name), ["ttl"]);
    assert.deepEqual(open({ "DR-DNS-001": { record_type: "  ", ttl: 0 } }).map((i) => i.name), ["record_type"]);
});

test("a pattern that does not apply asks for no inputs", async () => {
    const r = await resolveWith([dnsSpec({ applies_to: { tiers: [0] } })]);
    assert.deepEqual(r.openInputs, []);
});

test("a valid override is the candidate for the slots it covers and waives the pattern's inputs", async () => {
    const entry = { pattern: "DR-DNS-001", ...complete, ...approval, alternative: "Azure Front Door with health probes" };
    const r = await resolveWith([tierSpec(), dnsSpec()], { overrides: [entry] });
    assert.deepEqual(row(r, "traffic-dns"), {
        slot: "traffic-dns",
        candidate: { source: "override", pattern: "DR-DNS-001", version: 1, overrideIndex: 0, alternative: "Azure Front Door with health probes" },
        collision: null,
        status: "candidate",
        decision: null,
    });
    assert.deepEqual(r.overrides.map((o) => [o.index, o.outcome, o.reason, o.approvalVerified]), [[0, "applied", "complete", false]]);
    assert.deepEqual(r.documentedExceptions, [{
        kind: "override",
        index: 0,
        pattern: "DR-DNS-001",
        slots: ["traffic-dns"],
        justification: "No on-prem DNS dependency",
        owner_role: "Application owner",
        date: "2026-11-04",
        approver_role: "Platform architecture board",
        approval_ref: "ARB-2026-114",
        approvalVerified: false,
        alternative: "Azure Front Door with health probes",
    }]);
    assert.deepEqual(r.openInputs, []);
    assert.equal(r.patterns.find((p) => p.id === "DR-DNS-001").applied, true);
});

test("an override without an alternative waives the pattern and leaves the slot to Learn", async () => {
    const r = await resolveWith([dnsSpec()], { overrides: [{ pattern: "DR-DNS-001", ...complete, ...approval }] });
    assert.deepEqual(row(r, "traffic-dns").candidate, { source: "override", pattern: "DR-DNS-001", version: 1, overrideIndex: 0, alternative: null });
    assert.equal(r.documentedExceptions[0].alternative, null);
});

test("an override that names some slots waives the pattern only there", async () => {
    const r = await resolveWith([{ id: "DR-A-001", slots: ["ingress", "compute"] }], {
        overrides: [{ pattern: "DR-A-001", ...complete, slots: ["compute"], alternative: "Scale sets" }],
    });
    assert.equal(row(r, "compute").candidate.source, "override");
    assert.deepEqual(row(r, "ingress").candidate, { source: "pattern", pattern: "DR-A-001", version: 1, overrideIndex: null, alternative: null });
});

test("a rejected override changes nothing", async () => {
    const r = await resolveWith([tierSpec(), dnsSpec()], {
        overrides: [
            { pattern: "DR-TIER-001", ...complete },
            { pattern: "DR-DNS-001", ...complete },
        ],
    });
    assert.deepEqual(r.overrides.map((o) => [o.index, o.outcome]), [[0, "rejected"], [1, "rejected"]]);
    assert.equal(row(r, "objectives").candidate.source, "pattern");
    assert.equal(row(r, "traffic-dns").candidate.source, "pattern");
    assert.deepEqual(r.documentedExceptions, []);
    assert.equal(r.openInputs.length, 2);
});

test("a pattern that supersedes another displaces it on shared slots only", async () => {
    const r = await resolveWith([
        { id: "DR-OLD-001", slots: ["detection", "testing"] },
        { id: "DR-NEW-002", slots: ["detection"], supersedes: ["DR-OLD-001"] },
    ]);
    assert.equal(row(r, "detection").candidate.pattern, "DR-NEW-002");
    assert.equal(row(r, "testing").candidate.pattern, "DR-OLD-001");
    assert.ok(r.slots.every((s) => s.status === "candidate"));
});

test("supersedes works through a chain, even when the middle pattern is inactive", async () => {
    const r = await resolveWith([
        { id: "DR-A-001", slots: ["compute"] },
        { id: "DR-B-001", status: "draft", slots: ["identity"], supersedes: ["DR-A-001"] },
        { id: "DR-C-001", slots: ["compute"], supersedes: ["DR-B-001"] },
    ]);
    assert.equal(row(r, "compute").candidate.pattern, "DR-C-001");
    assert.equal(row(r, "compute").status, "candidate");
});

test("two approved patterns on one slot with no supersedes link collide, whatever their version", async () => {
    const r = await resolveWith([
        { id: "DR-MANUAL-001", slots: ["failover-approval"] },
        { id: "DR-AUTO-001", version: 2, slots: ["failover-approval"] },
    ]);
    assert.deepEqual(row(r, "failover-approval"), {
        slot: "failover-approval",
        candidate: { source: "collision", pattern: null, version: null, overrideIndex: null, alternative: null },
        collision: ["DR-AUTO-001 v2", "DR-MANUAL-001 v1"],
        status: "unresolved",
        decision: null,
    });
    assert.equal(r.slots.filter((s) => s.status === "unresolved").length, 1);
});

test("a collision needs both patterns to apply, and three patterns are all named", async () => {
    const notApplicable = await resolveWith([
        { id: "DR-A-001", slots: ["compute"] },
        { id: "DR-B-001", slots: ["compute"], applies_to: { tiers: [3] } },
    ]);
    assert.equal(row(notApplicable, "compute").candidate.pattern, "DR-A-001");
    const three = await resolveWith(["A", "B", "C"].map((letter) => ({ id: `DR-${letter}-001`, slots: ["compute"] })));
    assert.deepEqual(row(three, "compute").collision, ["DR-A-001 v1", "DR-B-001 v1", "DR-C-001 v1"]);
});

test("patterns that supersede each other are a cycle and displace nobody", async () => {
    const r = await resolveWith([
        { id: "DR-A-001", supersedes: ["DR-B-001"] },
        { id: "DR-B-001", supersedes: ["DR-A-001"] },
    ]);
    assert.deepEqual(row(r, "compute").collision, ["DR-A-001 v1", "DR-B-001 v1"]);
});

test("an override that waives one of two colliding patterns leaves the other in force", async () => {
    const specs = [{ id: "DR-A-001", slots: ["compute"] }, { id: "DR-B-001", slots: ["compute"] }];
    const one = await resolveWith(specs, { overrides: [{ pattern: "DR-A-001", ...complete }] });
    assert.deepEqual(row(one, "compute").candidate, { source: "pattern", pattern: "DR-B-001", version: 1, overrideIndex: null, alternative: null });
    assert.equal(row(one, "compute").status, "candidate");
    const both = await resolveWith(specs, { overrides: [{ pattern: "DR-B-001", ...complete }, { pattern: "DR-A-001", ...complete, alternative: "x" }] });
    assert.deepEqual(row(both, "compute").candidate, { source: "override", pattern: "DR-B-001", version: 1, overrideIndex: 0, alternative: null });
});

test("an override for a displaced pattern cannot take the slot from the pattern that supersedes it", async () => {
    const r = await resolveWith([
        { id: "DR-OLD-001", slots: ["compute"] },
        { id: "DR-NEW-002", slots: ["compute"], supersedes: ["DR-OLD-001"], override: "locked" },
    ], { overrides: [{ pattern: "DR-OLD-001", ...complete, alternative: "Bypass" }] });
    assert.equal(r.overrides[0].outcome, "applied");
    assert.deepEqual(row(r, "compute").candidate, { source: "pattern", pattern: "DR-NEW-002", version: 1, overrideIndex: null, alternative: null });
});

test("an override of an approved pattern that does not apply cannot take the slot, but is still listed", async () => {
    const r = await resolveWith([dnsSpec({ applies_to: { tiers: [0] } })], {
        overrides: [{ pattern: "DR-DNS-001", ...complete, ...approval, alternative: "Azure Front Door" }],
    });
    assert.deepEqual(r.patterns.map((p) => [p.id, p.applied]), [["DR-DNS-001", false]]);
    assert.deepEqual(r.overrides.map((o) => [o.index, o.pattern, o.outcome]), [[0, "DR-DNS-001", "applied"]]);
    assert.deepEqual(row(r, "traffic-dns"), { slot: "traffic-dns", candidate: learn, collision: null, status: "candidate", decision: null });
});

test("when the superseded and the superseding pattern both have a valid override, the override of the survivor takes the slot", async () => {
    const r = await resolveWith([
        { id: "DR-OLD-001", slots: ["compute"] },
        { id: "DR-NEW-002", version: 2, slots: ["compute"], supersedes: ["DR-OLD-001"] },
    ], {
        overrides: [
            { pattern: "DR-OLD-001", ...complete, slots: ["compute"], alternative: "Bypass" },
            { pattern: "DR-NEW-002", ...complete, slots: ["compute"], alternative: "Better" },
        ],
    });
    assert.deepEqual(r.overrides.map((o) => [o.index, o.pattern, o.outcome]), [[0, "DR-OLD-001", "applied"], [1, "DR-NEW-002", "applied"]]);
    assert.deepEqual(row(r, "compute"), {
        slot: "compute",
        candidate: { source: "override", pattern: "DR-NEW-002", version: 2, overrideIndex: 1, alternative: "Better" },
        collision: null,
        status: "candidate",
        decision: null,
    });
});

test("two valid overrides of the same pattern for one slot: the lowest index takes it", async () => {
    const r = await resolveWith([{ id: "DR-A-001", slots: ["compute"] }], {
        overrides: [
            { pattern: "DR-A-001", ...complete, slots: ["compute"], alternative: "First" },
            { pattern: "DR-A-001", ...complete, slots: ["compute"], alternative: "Second" },
        ],
    });
    assert.deepEqual(r.overrides.map((o) => [o.index, o.outcome]), [[0, "applied"], [1, "applied"]]);
    assert.deepEqual(row(r, "compute").candidate, { source: "override", pattern: "DR-A-001", version: 1, overrideIndex: 0, alternative: "First" });
});

test("tier exceptions are documented after the overrides", async () => {
    const exception = { what: "RTO 10m", approver_role: "CTO", date: "2026-11-04" };
    const r = await resolveWith([tierSpec(), dnsSpec()], {
        objectives: { tier: 1, rto: "10m", exceptions: [exception] },
        overrides: [{ pattern: "DR-DNS-001", ...complete, ...approval }],
    });
    assert.deepEqual(r.documentedExceptions.map((e) => e.kind), ["override", "tier-exception"]);
    assert.deepEqual(r.documentedExceptions[1], { kind: "tier-exception", ...exception });
    assert.equal(r.gates[1].status, "excepted");
});

async function engineOutput() {
    return resolveWith([
        { id: "DR-MANUAL-001", slots: ["failover-approval"] },
        { id: "DR-AUTO-001", slots: ["failover-approval"] },
        dnsSpec(),
    ]);
}

/** Fill every decision the way the model must: follow the engine's candidate, and record a collision as Unresolved. */
function decide(resolution) {
    const copy = structuredClone(resolution);
    for (const slot of copy.slots) {
        const c = slot.candidate;
        if (slot.status === "unresolved") {
            slot.decision = { text: "Two patterns collide", source: "pattern", ref: null, status: "Unresolved", azureReality: "", ledger: [], alternative: null };
        } else if (c.source === "pattern") {
            slot.decision = { text: `Apply ${c.pattern} v${c.version}`, source: "pattern", ref: `${c.pattern} v${c.version}`, status: "Resolved", azureReality: "no veto", ledger: [], alternative: null };
        } else if (c.source === "override") {
            slot.decision = { text: `Apply the override: ${c.alternative ?? "the pattern is waived"}`, source: "override", ref: `Override #${c.overrideIndex} of ${c.pattern}`, status: "Resolved", azureReality: "no veto", ledger: [], alternative: null };
        } else {
            slot.decision = { text: "Use the documented default", source: "learn", ref: null, status: "Resolved", azureReality: "no veto", ledger: [], alternative: null };
        }
    }
    return copy;
}
const errorPaths = (resolution, opts) => validateResolution(resolution, opts).errors.map((e) => e.path);
const index = (resolution, slot) => resolution.slots.findIndex((s) => s.slot === slot);

test("validateResolution: the engine's own output has no decisions yet", async () => {
    const result = validateResolution(await engineOutput());
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, SLOT_IDS.length);
    assert.deepEqual(result.errors[0], { path: "slots[0].decision", message: "objectives has no decision yet" });
});

test("validateResolution: a completed resolution is valid", async () => {
    assert.deepEqual(validateResolution(decide(await engineOutput())), { ok: true, errors: [] });
});

test("validateResolution: a Resolved decision needs text, a source and, unless the source is learn, a ref", async () => {
    const r = decide(await engineOutput());
    const i = index(r, "traffic-dns");
    r.slots[i].decision = { text: "", source: "pattern", ref: null, status: "Resolved", azureReality: "", ledger: [], alternative: null };
    assert.deepEqual(errorPaths(r), [`slots[${i}].decision.text`, `slots[${i}].decision.ref`]);
    r.slots[i].decision = { text: "Change the on-prem record", source: null, status: "Resolved" };
    assert.deepEqual(errorPaths(r), [`slots[${i}].decision.source`]);
    r.slots[i].decision = { text: "Change the on-prem record", source: "pattern", ref: "DR-DNS-001 v1", status: "Resolved" };
    assert.equal(validateResolution(r).ok, true);
});

test("validateResolution: a collision slot can only be Unresolved", async () => {
    const r = decide(await engineOutput());
    const i = index(r, "failover-approval");
    assert.equal(validateResolution(r).ok, true);
    r.slots[i].decision = { text: "Pick one", source: "learn", status: "Resolved" };
    assert.deepEqual(errorPaths(r), [`slots[${i}].decision.status`]);
    r.slots[i].decision = { text: "x", source: "learn", status: "Unmet requirement", azureReality: "x" };
    assert.deepEqual(errorPaths(r), [`slots[${i}].decision.status`]);
});

for (const [kind, bad] of [["a string", "DR-AUTO-001 v1, DR-MANUAL-001 v1"], ["a number", 2], ["an object", { patterns: ["DR-AUTO-001 v1"] }]]) {
    test(`validateResolution: a collision list that is ${kind} is reported at the slot, never thrown`, async () => {
        const r = decide(await engineOutput());
        const i = index(r, "failover-approval");
        r.slots[i].collision = bad;
        r.slots[i].decision = { text: "Pick one", source: "learn", status: "Resolved" };
        let result;
        assert.doesNotThrow(() => {
            result = validateResolution(r);
        });
        assert.equal(result.ok, false);
        assert.deepEqual(result.errors, [{
            path: `slots[${i}].decision.status`,
            message: "failover-approval has a pattern collision (): it can only be recorded as Unresolved",
        }]);
    });
}

test("validateResolution: every slot row keeps the engine's candidate object with a known source", async () => {
    const r = decide(await engineOutput());
    const i = index(r, "traffic-dns");
    const kept = r.slots[i].candidate;
    assert.equal(r.slots[i].decision.source, "pattern");
    assert.equal(validateResolution(r).ok, true);
    delete r.slots[i].candidate;
    assert.deepEqual(validateResolution(r).errors, [{
        path: `slots[${i}].candidate`,
        message: "traffic-dns has no candidate object: keep the engine's candidate as resolve-patterns wrote it",
    }]);
    for (const bad of [null, "pattern", ["pattern"]]) {
        r.slots[i].candidate = bad;
        assert.deepEqual(errorPaths(r), [`slots[${i}].candidate`]);
    }
    for (const bad of [{}, { source: null }, { source: "guess" }]) {
        r.slots[i].candidate = bad;
        assert.deepEqual(validateResolution(r).errors, [{ path: `slots[${i}].candidate.source`, message: "must be one of override, pattern, learn, collision" }]);
    }
    r.slots[i].candidate = kept;
    assert.deepEqual(validateResolution(r), { ok: true, errors: [] });
});

test("validateResolution: relabeling a candidate as a collision does not switch the source rule off", async () => {
    const r = decide(await engineOutput());
    const i = index(r, "traffic-dns");
    assert.equal(validateResolution(r).ok, true);
    r.slots[i].candidate.source = "collision";
    r.slots[i].decision = { text: "Use Traffic Manager", source: "learn", ref: null, status: "Resolved", azureReality: "", ledger: [], alternative: null };
    assert.deepEqual(validateResolution(r), {
        ok: false,
        errors: [
            {
                path: `slots[${i}].status`,
                message: "traffic-dns: status \"candidate\" contradicts the candidate from collision; a collision is status \"unresolved\" with a collision candidate, so keep both as resolve-patterns wrote them",
            },
            { path: `slots[${i}].decision.status`, message: "traffic-dns has a pattern collision (): it can only be recorded as Unresolved" },
        ],
    });
});

test("validateResolution: rewriting the status of a collision slot does not let a decision pick a pattern", async () => {
    const r = decide(await engineOutput());
    const i = index(r, "failover-approval");
    assert.deepEqual([r.slots[i].status, r.slots[i].candidate.source], ["unresolved", "collision"]);
    assert.equal(validateResolution(r).ok, true);
    const unresolved = r.slots[i].decision;
    const collisionError = {
        path: `slots[${i}].decision.status`,
        message: "failover-approval has a pattern collision (DR-AUTO-001 v1, DR-MANUAL-001 v1): it can only be recorded as Unresolved",
    };
    r.slots[i].decision = { text: "Pick the automatic one", source: "pattern", ref: "DR-AUTO-001 v1", status: "Resolved", azureReality: "", ledger: [], alternative: null };
    assert.deepEqual(validateResolution(r).errors, [collisionError]);

    r.slots[i].status = "candidate";
    assert.deepEqual(validateResolution(r).errors, [
        {
            path: `slots[${i}].status`,
            message: "failover-approval: status \"candidate\" contradicts the candidate from collision; a collision is status \"unresolved\" with a collision candidate, so keep both as resolve-patterns wrote them",
        },
        collisionError,
    ]);

    for (const gone of ["resolved", null, undefined]) {
        if (gone === undefined) delete r.slots[i].status;
        else r.slots[i].status = gone;
        assert.deepEqual(validateResolution(r).errors, [{ path: `slots[${i}].status`, message: "must be one of candidate, unresolved" }, collisionError]);
    }

    r.slots[i].status = "unresolved";
    r.slots[i].decision = unresolved;
    assert.deepEqual(validateResolution(r), { ok: true, errors: [] });
});

test("validateResolution: an unresolved status on a slot whose candidate is no collision is an error", async () => {
    const r = decide(await engineOutput());
    const i = index(r, "traffic-dns");
    r.slots[i].status = "unresolved";
    r.slots[i].decision = { text: "Still open", source: "pattern", ref: null, status: "Unresolved", azureReality: "", ledger: [], alternative: null };
    const result = validateResolution(r);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((e) => e.path), [`slots[${i}].status`]);
    assert.match(result.errors[0].message, /^traffic-dns: status "unresolved" contradicts the candidate from pattern;/);
    r.slots[i].status = "candidate";
    assert.deepEqual(validateResolution(r), { ok: true, errors: [] });
});

test("validateResolution: an Unmet requirement needs an alternative or an azureReality note", async () => {
    const r = decide(await engineOutput());
    const i = index(r, "compute");
    r.slots[i].decision = { text: "Zero data loss", source: "azure-reality", ref: "R-0001", status: "Unmet requirement", azureReality: "", alternative: null };
    assert.deepEqual(errorPaths(r), [`slots[${i}].decision.alternative`]);
    r.slots[i].decision.azureReality = "The service has no synchronous cross-region mode";
    assert.equal(validateResolution(r).ok, true);
    r.slots[i].decision.azureReality = "";
    r.slots[i].decision.alternative = "Use geo-replication";
    assert.equal(validateResolution(r).ok, true);
});

test("validateResolution: a decision cannot ignore the engine's candidate; only azure-reality can overrule it", async () => {
    const r = decide(await engineOutput());
    const i = index(r, "traffic-dns");
    assert.equal(r.slots[i].candidate.source, "pattern");
    r.slots[i].decision = { text: "Use Traffic Manager", source: "learn", ref: null, status: "Resolved", azureReality: "", ledger: [], alternative: null };
    assert.deepEqual(validateResolution(r).errors, [{
        path: `slots[${i}].decision.source`,
        message: "traffic-dns: the engine's candidate comes from pattern, so a decision from learn would ignore it; only azure-reality can overrule a candidate",
    }]);
    r.slots[i].decision = { text: "The DR region has no on-prem resolver", source: "azure-reality", ref: "R-0001", status: "Unmet requirement", azureReality: "no resolver reaches the DR region", ledger: [], alternative: null };
    assert.equal(validateResolution(r).ok, true);
    r.slots[i].decision = { text: "Still open", source: "learn", ref: null, status: "Unresolved", azureReality: "", ledger: [], alternative: null };
    assert.equal(validateResolution(r).ok, true);

    const j = index(r, "ingress");
    assert.equal(r.slots[j].candidate.source, "learn");
    r.slots[j].decision = { text: "Apply DR-DNS-001", source: "pattern", ref: "DR-DNS-001 v1", status: "Resolved", azureReality: "", ledger: [], alternative: null };
    assert.deepEqual(errorPaths(r), [`slots[${j}].decision.source`]);
});

test("validateResolution: a decision from an override needs the engine's override candidate", async () => {
    const withOverride = decide(await resolveWith([dnsSpec()], { overrides: [{ pattern: "DR-DNS-001", ...complete, ...approval, alternative: "Azure Front Door" }] }));
    const i = index(withOverride, "traffic-dns");
    assert.equal(withOverride.slots[i].candidate.source, "override");
    assert.equal(withOverride.slots[i].decision.source, "override");
    assert.equal(validateResolution(withOverride).ok, true);
    withOverride.slots[i].decision = { text: "Apply the pattern anyway", source: "pattern", ref: "DR-DNS-001 v1", status: "Resolved", azureReality: "", ledger: [], alternative: null };
    assert.deepEqual(errorPaths(withOverride), [`slots[${i}].decision.source`]);

    const noOverride = decide(await resolveWith([dnsSpec()]));
    const k = index(noOverride, "traffic-dns");
    noOverride.slots[k].decision = { text: "Use the override", source: "override", ref: "Override #0 of DR-DNS-001", status: "Resolved", azureReality: "", ledger: [], alternative: null };
    assert.deepEqual(errorPaths(noOverride), [`slots[${k}].decision.source`]);
});

test("validateResolution: cited ledger ids must exist when the ledger ids are supplied", async () => {
    const r = decide(await engineOutput());
    const i = index(r, "compute");
    r.slots[i].decision.ledger = ["F-0001", "F-9999"];
    assert.equal(validateResolution(r).ok, true);
    const result = validateResolution(r, { ledgerIds: new Set(["F-0001"]) });
    assert.deepEqual(result.errors, [{ path: `slots[${i}].decision.ledger`, message: "F-9999 is not in the ledger" }]);
    r.slots[i].decision.ledger = "F-0001";
    assert.deepEqual(errorPaths(r), [`slots[${i}].decision.ledger`]);
});

test("validateResolution: the file shape is checked", async () => {
    const r = decide(await engineOutput());
    assert.deepEqual(validateResolution(null).errors, [{ path: "$", message: "must be a JSON object" }]);
    assert.deepEqual(validateResolution({ schemaVersion: 1 }).errors, [{ path: "slots", message: "must be an array of slot rows" }]);
    const bad = structuredClone(r);
    bad.schemaVersion = 2;
    bad.slots[0].slot = "teleport";
    bad.slots[1].slot = "ingress";
    bad.slots[3].decision.status = "Done";
    bad.slots[4].decision.source = "guess";
    assert.deepEqual(errorPaths(bad), ["schemaVersion", "slots[0].slot", "slots[2].slot", "slots[3].decision.status", "slots[4].decision.source", "slots", "slots"]);
    assert.deepEqual(validateResolution(bad).errors.slice(-2).map((e) => e.message), ["slot objectives is missing", "slot traffic-dns is missing"]);
});
