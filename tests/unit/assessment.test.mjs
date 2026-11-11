import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import {
    normalizeAssessment, normalizeRegion, parseDuration, readAssessment, serializeAssessment, validateAssessment,
} from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { parseYaml } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";

const example = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "assets", "assessment.example.yaml");
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-assessment-"));

test("normalizeRegion produces ARM names", () => {
    assert.equal(normalizeRegion("Sweden Central"), "swedencentral");
    assert.equal(normalizeRegion("(Europe) West Europe"), "westeurope");
    assert.equal(normalizeRegion("East US 2"), "eastus2");
    assert.equal(normalizeRegion("  uksouth "), "uksouth");
});

test("parseDuration reads s, m, h, d and zero; anything else is null", () => {
    assert.equal(parseDuration("30m"), 1800);
    assert.equal(parseDuration("2h"), 7200);
    assert.equal(parseDuration("1d"), 86400);
    assert.equal(parseDuration("90s"), 90);
    assert.equal(parseDuration("1.5h"), 5400);
    assert.equal(parseDuration("0"), 0);
    assert.equal(parseDuration(null), null);
    assert.equal(parseDuration("near zero"), null);
    assert.equal(parseDuration("30"), null);
});

test("normalizeAssessment fills defaults, derives the app slug and coerces the tier and regions", () => {
    const a = normalizeAssessment({
        workload: { name: "Checkout App" },
        regions: { primary: "West Europe", dr: "Sweden Central" },
        objectives: { tier: "1", rto: 0 },
    });
    assert.equal(a.schema, 1);
    assert.equal(a.workload.app, "checkout-app");
    assert.equal(a.regions.primary, "westeurope");
    assert.equal(a.regions.dr, "swedencentral");
    assert.equal(a.regions.failure_scope, "regional");
    assert.equal(a.objectives.tier, 1);
    assert.equal(a.objectives.rto, "0");
    assert.deepEqual(a.overrides, []);
    assert.equal(a.options.pause_after_current_state, false);
    assert.equal(a.outputs.directory, "dr-assessment/checkout-app");
    assert.deepEqual(Object.keys(a), [
        "schema", "workload", "inputs", "scope", "regions", "objectives", "constraints",
        "pattern_inputs", "overrides", "decisions", "dr_choices", "drills", "options", "outputs",
    ]);
});

test("the example file is a complete, valid assessment", () => {
    const a = normalizeAssessment(parseYaml(readFileSync(example, "utf8")));
    assert.deepEqual(validateAssessment(a, { requireComplete: true }), { ok: true, errors: [] });
    assert.equal(a.regions.dr, "swedencentral");
});

test("validateAssessment reports every problem with its path", () => {
    const a = normalizeAssessment({
        workload: { name: "x" },
        regions: { primary: "westeurope", dr: "West Europe", failure_scope: "galaxy" },
        objectives: {
            tier: 7, rto: "near zero", rpo: "5m",
            exceptions: [{ what: "RTO 10m", approver_role: "", date: "2026-13-40" }],
        },
        scope: { tag: { name: "app" } },
        overrides: [{ pattern: "DR-DNS-001", justification: "", owner_role: "App owner", date: "soon", pattern_version: "one" }],
        decisions: [{ question: "q", answer: "", date: "2026-11-04" }],
        drills: [{ date: "2026-11-04", scenario: "regional", rpo: "5m" }],
        pattern_inputs: { "DR-DNS-001": "not a mapping" },
    });
    const { ok, errors } = validateAssessment(a);
    assert.equal(ok, false);
    const paths = errors.map((e) => e.path);
    for (const expected of [
        "regions.dr", "regions.failure_scope", "objectives.tier", "objectives.rto",
        "objectives.exceptions[0].approver_role", "objectives.exceptions[0].date", "scope.tag",
        "decisions[0].answer", "drills[0].reference", "pattern_inputs.DR-DNS-001",
    ]) {
        assert.ok(paths.includes(expected), `missing error for ${expected}; got ${paths.join(", ")}`);
    }
    assert.equal(paths.some((p) => p.startsWith("overrides")), false, "override entries are judged by validateOverrides, not here");
});

test("override entries are never a validation error here: a bad one is rejected later, with its reason", () => {
    const a = normalizeAssessment({
        workload: { name: "x" },
        overrides: [{ pattern: "DR-DNS-001", justification: "", owner_role: "App owner", date: "soon", pattern_version: "one" }, "not a mapping"],
    });
    assert.equal(a.overrides.length, 2);
    assert.deepEqual(validateAssessment(a), { ok: true, errors: [] });
});

test("pattern_inputs values must be scalars: a nested object is rejected", () => {
    const a = normalizeAssessment({ workload: { name: "x" }, pattern_inputs: { "DR-DNS-001": { ttl: { nested: 1 } } } });
    const { ok, errors } = validateAssessment(a);
    assert.equal(ok, false);
    assert.deepEqual(errors, [{ path: "pattern_inputs.DR-DNS-001.ttl", message: "must be a scalar: a string, number, boolean or null" }]);
});

test("pattern_inputs values must be scalars: an array is rejected", () => {
    const a = normalizeAssessment({ workload: { name: "x" }, pattern_inputs: { "DR-DNS-001": { record_type: ["A", "AAAA"] } } });
    const { ok, errors } = validateAssessment(a);
    assert.equal(ok, false);
    assert.deepEqual(errors, [{ path: "pattern_inputs.DR-DNS-001.record_type", message: "must be a scalar: a string, number, boolean or null" }]);
});

test("pattern_inputs accepts string, number, boolean and null scalars", () => {
    const a = normalizeAssessment({
        workload: { name: "x" },
        pattern_inputs: { "DR-DNS-001": { record_type: "A", ttl: 300, enabled: true, fallback: null } },
    });
    assert.deepEqual(validateAssessment(a), { ok: true, errors: [] });
});

test("requireComplete needs a tier, both regions and a source", () => {
    const a = normalizeAssessment({ workload: { name: "x" } });
    assert.equal(validateAssessment(a).ok, true);
    const paths = validateAssessment(a, { requireComplete: true }).errors.map((e) => e.path);
    assert.deepEqual(paths.sort(), ["inputs", "objectives.tier", "regions.dr", "regions.primary"]);
});

test("readAssessment returns a normalized assessment and maps problems to CliError(INPUT)", async () => {
    const dir = tmp();
    const good = path.join(dir, "assessment.yaml");
    writeFileSync(good, readFileSync(example, "utf8"));
    const a = await readAssessment(good, { requireComplete: true });
    assert.equal(a.workload.app, "checkout");

    const badYaml = path.join(dir, "bad.yaml");
    writeFileSync(badYaml, "workload:\n\tname: x\n");
    await assert.rejects(() => readAssessment(badYaml), (e) => e instanceof CliError && e.code === EXIT.INPUT && /line 2/.test(e.details[0]));

    const invalid = path.join(dir, "invalid.yaml");
    writeFileSync(invalid, "workload:\n  name: x\nobjectives:\n  tier: 9\n");
    await assert.rejects(() => readAssessment(invalid), (e) => e.code === EXIT.INPUT && e.details.some((d) => d.startsWith("objectives.tier:")));

    const notAList = path.join(dir, "not-a-list.yaml");
    writeFileSync(notAList, "workload:\n  name: x\noverrides:\n  pattern: DR-DNS-001\n  justification: none\nobjectives:\n  exceptions: nope\n");
    await assert.rejects(
        () => readAssessment(notAList),
        (e) => e.code === EXIT.INPUT && e.details.includes("overrides: must be a list") && e.details.includes("objectives.exceptions: must be a list"),
    );

    await assert.rejects(() => readAssessment(path.join(dir, "missing.yaml")), (e) => e.code === EXIT.INPUT);
});

test("serializeAssessment round-trips through the parser", () => {
    const a = normalizeAssessment({
        workload: { name: "checkout" },
        regions: { primary: "westeurope", dr: "swedencentral" },
        objectives: { tier: 2, exceptions: [{ what: "RTO 1h", approver_role: "CTO", date: "2026-11-04" }] },
        overrides: [{ pattern: "DR-DNS-001", slots: ["traffic-dns"], justification: "no on-prem DNS", owner_role: "App owner", date: "2026-11-04", approver_role: "ARB", approval_ref: "ARB-1" }],
        pattern_inputs: { "DR-DNS-001": { ttl: 300, record_type: "A" } },
    });
    const text = serializeAssessment(a);
    assert.deepEqual(normalizeAssessment(parseYaml(text)), a);
});
