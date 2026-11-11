import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { validateOverrides } from "../../skills/azure-dr-assessment/scripts/lib/overrides.mjs";
import { lintPack } from "../../skills/azure-dr-assessment/scripts/lib/pattern-lint.mjs";
import { defaultPatternsDir } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { readPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { resolveSlots } from "../../skills/azure-dr-assessment/scripts/lib/resolve.mjs";
import { parseYaml } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";
import { sampleAssessment } from "../helpers/resolve-fixture.mjs";

const loaded = await readPack(defaultPatternsDir());
const pack = loaded.pack;
const dns = pack.byId.get("DR-DNS-001");
const INPUTS = ["record_type", "ttl", "record_owner_role", "private_zone_integration"];
const supplied = { record_type: "CNAME", ttl: 300, record_owner_role: "DNS operations", private_zone_integration: "conditional forwarding" };
const complete = { justification: "Internet-facing only; no on-prem DNS dependency", owner_role: "Application owner", date: "2026-11-04" };
const approval = { approver_role: "Platform architecture board", approval_ref: "ARB-2026-114" };
const missing = "not supplied by the application team";

test("the bundled pack lints clean and holds DR-DNS-001", () => {
    assert.ok(dns, "DR-DNS-001 is missing from the bundled pack");
    assert.deepEqual(lintPack(loaded), []);
});

test("front matter: approved, approval-required, deciding traffic-dns for every tier", () => {
    assert.deepEqual(
        { id: dns.id, version: dns.version, status: dns.status, override: dns.override, slots: dns.slots, applies_to: dns.applies_to, supersedes: dns.supersedes },
        { id: "DR-DNS-001", version: 1, status: "approved", override: "approval-required", slots: ["traffic-dns"], applies_to: {}, supersedes: [] },
    );
});

test("the application team supplies the record type, the TTL, the record owner and the private zone integration", () => {
    assert.deepEqual(dns.inputs.map((i) => i.name), INPUTS);
    for (const input of dns.inputs) {
        assert.equal(input.required, true, input.name);
        assert.ok(input.description.length > 10, input.name);
    }
});

test("the text keeps on-prem DNS authoritative, Traffic Manager as a documented alternative, and invents no values", () => {
    const behavior = dns.sections["Required behavior"];
    assert.match(behavior, /on-prem DNS is authoritative/);
    assert.match(behavior, /changing the on-prem DNS record/);
    assert.match(behavior, /Azure Traffic Manager appears only as a documented alternative, labeled not applied/);
    assert.match(behavior, /The TTL wait counts toward RTO/);
    assert.ok(behavior.includes(missing));
    assert.ok(dns.sections["Runbook steps"].includes(missing));
    assert.ok(dns.sections["Diagram elements"].includes(missing));
    assert.ok(dns.sections["Verification"].includes(missing));
    assert.match(dns.sections["Runbook steps"], /on-prem DNS record/);
    assert.match(dns.sections["Runbook steps"], /TTL wait/);
    assert.match(dns.sections["Diagram elements"], /Do not draw Azure Traffic Manager as part of the design/);
});

test("the boundaries state the Tier 0 limit and that the pattern authorizes nothing", () => {
    const boundaries = dns.sections.Boundaries;
    assert.match(boundaries, /A Tier 0 design cannot reach near-zero RTO through a manual record change/);
    assert.match(boundaries, /the weakest link, a Gap, instead of overriding the tier/);
    assert.match(boundaries, /does not authorize running the record change, a failover or any Azure change/);
    assert.match(dns.sections.Verification, /Tier 0: a manual record change cannot reach near-zero RTO/);
});

test("traffic-dns resolves to DR-DNS-001 v1 for every tier, with all four inputs open until they are supplied", () => {
    for (const tier of [0, 1, 2, 3]) {
        const r = resolveSlots(sampleAssessment({ objectives: { tier } }), pack);
        const slot = r.slots.find((s) => s.slot === "traffic-dns");
        assert.deepEqual(slot.candidate, { source: "pattern", pattern: "DR-DNS-001", version: 1, overrideIndex: null, alternative: null }, `tier ${tier}`);
        assert.deepEqual(r.openInputs.map((i) => [i.pattern, i.name]), INPUTS.map((name) => ["DR-DNS-001", name]));
        assert.equal(r.nonDefaultPack, false);
        assert.equal(r.banner, null);
    }
});

test("no input is open once the application team supplies all four", () => {
    const r = resolveSlots(sampleAssessment({ pattern_inputs: { "DR-DNS-001": supplied } }), pack);
    assert.deepEqual(r.openInputs, []);
    const partial = resolveSlots(sampleAssessment({ pattern_inputs: { "DR-DNS-001": { ...supplied, ttl: null, record_owner_role: "" } } }), pack);
    assert.deepEqual(partial.openInputs.map((i) => i.name), ["ttl", "record_owner_role"]);
});

test("an override of DR-DNS-001 needs the approver role and the approval reference", () => {
    const a = normalizeAssessment({
        workload: { name: "checkout" },
        overrides: [
            { pattern: "DR-DNS-001", ...complete },
            { pattern: "DR-DNS-001", ...complete, ...approval, alternative: "Azure Front Door with health probes" },
        ],
    });
    const { applied, rejected } = validateOverrides(a, pack);
    assert.deepEqual(rejected.map((o) => [o.index, o.reason]), [[0, "missing required fields: approver_role, approval_ref"]]);
    assert.deepEqual(applied.map((o) => [o.index, o.level, o.slots, o.approvalVerified]), [[1, "approval-required", ["traffic-dns"], false]]);
});

test("an override of the locked DR-TIER-001 is rejected, and DR-TIER-001 keeps deciding objectives", () => {
    const a = sampleAssessment({ overrides: [{ pattern: "DR-TIER-001", ...complete, ...approval }] });
    const { applied, rejected } = validateOverrides(a, pack);
    assert.deepEqual(applied, []);
    assert.equal(rejected[0].reason, "locked pattern: change it through this repository");
    const objectives = resolveSlots(a, pack).slots.find((s) => s.slot === "objectives");
    assert.equal(objectives.candidate.pattern, "DR-TIER-001");
});

test("the override example in the authoring guide is accepted for DR-DNS-001", () => {
    const guide = readFileSync(path.join(defaultPatternsDir(), "README.md"), "utf8");
    const blocks = [...guide.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map((m) => parseYaml(m[1]));
    const example = blocks.find((b) => b?.overrides);
    const a = normalizeAssessment({ workload: { name: "checkout" }, overrides: example.overrides });
    const { applied, rejected } = validateOverrides(a, pack);
    assert.deepEqual(rejected, []);
    assert.equal(applied[0].pattern, "DR-DNS-001");
});
