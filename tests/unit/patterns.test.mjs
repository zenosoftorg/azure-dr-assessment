import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import {
    SLOT_IDS, applies, firstBlockquote, loadPack, packBanner, packDisplayDir, rangesOverlap, splitSections, supersedesIndex,
} from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { defaultPatternsDir, repoRoot } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { FIXED_BODIES, patternMarkdown, writePack } from "../helpers/pack-fixture.mjs";

test("SLOT_IDS is the slot vocabulary of contracts 7.6, in order", () => {
    assert.deepEqual(SLOT_IDS, [
        "objectives", "traffic-dns", "ingress", "compute",
        "data-replication.relational", "data-replication.nosql", "data-replication.storage",
        "data-replication.messaging", "data-replication.vm-disks", "data-replication.cache",
        "secrets-keys", "identity", "backup", "connectivity", "detection", "failover-approval", "testing",
    ]);
});

test("loadPack reads every pattern file except README.md into a Pattern", async () => {
    const dir = writePack({
        "README.md": "# Authoring guide\n",
        "notes.txt": "not a pattern",
        "DR-DNS-001.md": patternMarkdown({
            id: "DR-DNS-001",
            version: 2,
            slots: ["traffic-dns"],
            override: "approval-required",
            applies_to: { tiers: [1, 2], environments: ["production"] },
            supersedes: ["DR-OLD-001"],
            inputs: [{ name: "ttl", description: "TTL in seconds", required: true }],
            parameters: { limit: 5 },
        }),
    });
    const pack = await loadPack(dir);
    assert.equal(pack.dir, dir);
    assert.equal(pack.isDefault, false);
    assert.deepEqual(pack.findings, []);
    assert.equal(pack.patterns.length, 1);
    const p = pack.byId.get("DR-DNS-001");
    assert.equal(p, pack.patterns[0]);
    assert.equal(p.version, 2);
    assert.equal(p.status, "approved");
    assert.deepEqual(p.slots, ["traffic-dns"]);
    assert.equal(p.override, "approval-required");
    assert.deepEqual(p.applies_to, { environments: ["production"], tiers: [1, 2] });
    assert.deepEqual(p.supersedes, ["DR-OLD-001"]);
    assert.equal(p.owner_role, "Platform architecture");
    assert.deepEqual(p.inputs, [{ name: "ttl", description: "TTL in seconds", required: true }]);
    assert.deepEqual(p.parameters, { limit: 5 });
    assert.equal(p.file, "DR-DNS-001.md");
    assert.deepEqual(Object.keys(p.sections), FIXED_BODIES.map(([title]) => title));
    assert.equal(p.sections.Rationale, "The company requires it.");
    assert.equal(p.gate, null);
});

test("loadPack honors an explicit isDefault and sorts patterns by file name", async () => {
    const dir = writePack({
        "DR-B-001.md": patternMarkdown({ id: "DR-B-001" }),
        "DR-A-001.md": patternMarkdown({ id: "DR-A-001" }),
    });
    const pack = await loadPack(dir, { isDefault: true });
    assert.equal(pack.isDefault, true);
    assert.deepEqual(pack.patterns.map((p) => p.id), ["DR-A-001", "DR-B-001"]);
});

test("the gate is the first blockquote of Mandatory first step, with blank quote lines kept", async () => {
    const question = "**Which tier applies?**\n\n- **Tier 0:** near zero\n\nReply with **0, 1, 2, or 3**.";
    const quoted = question.split("\n").map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
    const dir = writePack({
        "DR-GATE-001.md": patternMarkdown({
            id: "DR-GATE-001",
            sections: [...FIXED_BODIES, ["Mandatory first step", `Ask this first.\n\n${quoted}\n\nAfter the answer, restate it.\n\n> A second quote`]],
        }),
        "DR-NOQUOTE-001.md": patternMarkdown({
            id: "DR-NOQUOTE-001",
            sections: [...FIXED_BODIES, ["Mandatory first step", "Ask something, but quote nothing."]],
        }),
        "DR-NOGATE-001.md": patternMarkdown({ id: "DR-NOGATE-001" }),
    });
    const pack = await loadPack(dir);
    assert.deepEqual(pack.byId.get("DR-GATE-001").gate, { question });
    assert.equal(pack.byId.get("DR-NOQUOTE-001").gate, null);
    assert.equal(pack.byId.get("DR-NOGATE-001").gate, null);
});

test("loadPack turns unreadable or invalid files into findings instead of throwing", async () => {
    const dir = writePack({
        "DR-OK-001.md": patternMarkdown({ id: "DR-OK-001" }),
        "DR-NOFM-001.md": "# no front matter\n",
        "DR-YAML-001.md": "---\nid: DR-YAML-001\n\tbad: 1\n---\n",
        "DR-LIST-001.md": "---\n- a\n- b\n---\n",
    });
    mkdirSync(path.join(dir, "DR-DIR-001.md"));
    const pack = await loadPack(dir);
    assert.deepEqual(pack.patterns.map((p) => p.id), ["DR-OK-001"]);
    const byFile = Object.fromEntries(pack.findings.map((f) => [f.file, f]));
    assert.deepEqual(Object.keys(byFile).sort(), ["DR-DIR-001.md", "DR-LIST-001.md", "DR-NOFM-001.md", "DR-YAML-001.md"]);
    assert.equal(byFile["DR-NOFM-001.md"].rule, "front-matter-missing");
    assert.equal(byFile["DR-YAML-001.md"].rule, "front-matter-invalid");
    assert.match(byFile["DR-YAML-001.md"].message, /line 3/);
    assert.equal(byFile["DR-LIST-001.md"].rule, "front-matter-invalid");
    assert.equal(byFile["DR-DIR-001.md"].rule, "unreadable-file");
    for (const finding of pack.findings) {
        assert.equal(finding.severity, "error");
        assert.equal(finding.id, null);
    }
});

test("loadPack throws CliError(INPUT) when the folder cannot be read", async () => {
    const missing = path.join(writePack({}), "missing");
    await assert.rejects(() => loadPack(missing), (e) => e instanceof CliError && e.code === EXIT.INPUT);
});

test("wrong-typed front matter normalizes instead of throwing", async () => {
    const dir = writePack({
        "DR-ODD-001.md": [
            "---", "id: DR-ODD-001", "version: one", "status: 7", "slots: compute", "override: []", "supersedes: x",
            "owner_role: 5", "applies_to: nope", "inputs: 3", "parameters: 4", "---", "", "## Rationale", "", "text", "",
        ].join("\n"),
    });
    const [p] = (await loadPack(dir)).patterns;
    assert.equal(p.id, "DR-ODD-001");
    assert.deepEqual(
        { version: p.version, status: p.status, slots: p.slots, override: p.override, supersedes: p.supersedes },
        { version: 0, status: "", slots: [], override: "", supersedes: [] },
    );
    assert.deepEqual(
        { owner_role: p.owner_role, applies_to: p.applies_to, inputs: p.inputs, parameters: p.parameters },
        { owner_role: "", applies_to: {}, inputs: [], parameters: {} },
    );
});

test("splitSections splits on ## headings only and ignores headings inside code fences", () => {
    const fence = "`".repeat(3);
    const body = ["# Title", "", "## One", "", "text", "", `${fence}md`, "## not a heading", fence, "", "### Sub", "", "more", "", "## Two", "", "end", ""].join("\n");
    const sections = splitSections(body, 10);
    assert.deepEqual(sections.map((s) => [s.title, s.line]), [["One", 12], ["Two", 24]]);
    assert.ok(sections[0].text.includes("## not a heading"));
    assert.ok(sections[0].text.includes("### Sub"));
    assert.equal(sections[1].text, "end");
});

test("firstBlockquote strips the quote markers and joins the lines", () => {
    assert.equal(firstBlockquote("intro\n\n> a\n>\n> b\n\nnext\n\n> other"), "a\n\nb");
    assert.equal(firstBlockquote("no quote here"), null);
    assert.equal(firstBlockquote(">"), null);
});

const assessment = (overrides = {}) => normalizeAssessment({
    workload: { name: "Checkout App", environment: "Production" },
    objectives: { tier: 1 },
    regions: { failure_scope: "regional" },
    ...overrides,
});
const pattern = (fields = {}) => ({ id: "DR-A-001", status: "approved", applies_to: {}, ...fields });

test("applies: only approved patterns apply, and a pattern without applies_to applies to everything", () => {
    assert.deepEqual(applies(pattern(), assessment()), { applies: true, reason: "approved and applicable" });
    for (const status of ["draft", "deprecated", "superseded"]) {
        assert.deepEqual(applies(pattern({ status }), assessment()), { applies: false, reason: `status is ${status}; only approved patterns apply` });
    }
});

test("applies: workloads match the name or the app slug, case-insensitively", () => {
    assert.equal(applies(pattern({ applies_to: { workloads: ["checkout app"] } }), assessment()).applies, true);
    assert.equal(applies(pattern({ applies_to: { workloads: ["Checkout-App"] } }), assessment()).applies, true);
    assert.deepEqual(applies(pattern({ applies_to: { workloads: ["billing"] } }), assessment()), {
        applies: false,
        reason: "workloads [billing] do not include Checkout App",
    });
});

test("applies: environments, tiers and scenarios must match when present", () => {
    assert.equal(applies(pattern({ applies_to: { environments: ["production"] } }), assessment()).applies, true);
    assert.deepEqual(applies(pattern({ applies_to: { environments: ["dev"] } }), assessment()), {
        applies: false,
        reason: "environments [dev] do not include Production",
    });
    assert.equal(applies(pattern({ applies_to: { tiers: [1, 2] } }), assessment()).applies, true);
    assert.equal(applies(pattern({ applies_to: { tiers: [2, 3] } }), assessment()).reason, "tiers [2, 3] do not include tier 1");
    assert.equal(applies(pattern({ applies_to: { scenarios: ["regional", "wider"] } }), assessment()).applies, true);
    assert.equal(applies(pattern({ applies_to: { scenarios: ["zonal"] } }), assessment()).reason, "scenarios [zonal] do not include regional");
});

test("applies: a tier restriction does not apply while the tier is null, because the tier gate stops the run first", () => {
    assert.deepEqual(applies(pattern({ applies_to: { tiers: [1] } }), assessment({ objectives: { tier: null } })), {
        applies: false,
        reason: "applies only to tiers [1]; objectives.tier is not set",
    });
});

test("applies: an unknown workload name or environment never switches a binding pattern off", () => {
    const noEnvironment = assessment({ workload: { name: "x" } });
    const noName = assessment({ workload: { name: "", environment: "Production" } });
    const neither = assessment({ workload: { name: "" } });
    assert.deepEqual(applies(pattern({ applies_to: { environments: ["production", "staging"] } }), noEnvironment), {
        applies: true,
        reason: "workload.environment is not set: applied because the pattern is restricted to environments [production, staging]",
    });
    assert.deepEqual(applies(pattern({ applies_to: { workloads: ["checkout"] } }), noName), {
        applies: true,
        reason: "workload.name is not set: applied because the pattern is restricted to workloads [checkout]",
    });
    assert.deepEqual(applies(pattern({ applies_to: { workloads: ["checkout"], environments: ["production"] } }), neither), {
        applies: true,
        reason: "workload.name is not set: applied because the pattern is restricted to workloads [checkout]; workload.environment is not set: applied because the pattern is restricted to environments [production]",
    });
    // a known value that does not match, or any other key that does not match, still switches the pattern off
    assert.equal(applies(pattern({ applies_to: { environments: ["staging"] } }), assessment()).applies, false);
    assert.equal(applies(pattern({ applies_to: { workloads: ["billing"] } }), noEnvironment).applies, false);
    assert.equal(applies(pattern({ applies_to: { environments: ["production"], tiers: [3] } }), noEnvironment).reason, "tiers [3] do not include tier 1");
    assert.equal(applies(pattern({ status: "draft", applies_to: { environments: ["production"] } }), noEnvironment).applies, false);
});

test("applies: every present key must match", () => {
    const both = pattern({ applies_to: { workloads: ["checkout app"], tiers: [3] } });
    assert.equal(applies(both, assessment()).applies, false);
    assert.equal(applies(both, assessment({ objectives: { tier: 3 } })).applies, true);
});

test("rangesOverlap: keys present in both must intersect and an omitted key means all", () => {
    assert.equal(rangesOverlap({}, { tiers: [1] }), true);
    assert.equal(rangesOverlap({ tiers: [1, 2] }, { tiers: [2, 3] }), true);
    assert.equal(rangesOverlap({ tiers: [0] }, { tiers: [1] }), false);
    assert.equal(rangesOverlap({ tiers: [0], environments: ["prod"] }, { tiers: [0], environments: ["dev"] }), false);
    assert.equal(rangesOverlap({ workloads: ["Checkout"] }, { workloads: ["checkout"] }), true);
    assert.equal(rangesOverlap({ tiers: [1] }, { environments: ["prod"] }), true);
});

test("supersedesIndex follows chains and reports cycles", () => {
    const graph = supersedesIndex([
        { id: "A", supersedes: ["B"] },
        { id: "B", supersedes: ["C", "GHOST"] },
        { id: "C", supersedes: [] },
        { id: "X", supersedes: ["Y"] },
        { id: "Y", supersedes: ["X"] },
    ]);
    assert.equal(graph.reaches("A", "B"), true);
    assert.equal(graph.reaches("A", "C"), true);
    assert.equal(graph.reaches("C", "A"), false);
    assert.equal(graph.reaches("A", "A"), false);
    assert.equal(graph.reaches("X", "X"), true);
    assert.deepEqual([...graph.reachable("A")].sort(), ["B", "C", "GHOST"]);
});

test("packDisplayDir is repository-relative inside the repository and absolute elsewhere", () => {
    assert.equal(packDisplayDir(defaultPatternsDir()), "skills/azure-dr-assessment/patterns");
    assert.equal(packDisplayDir(path.join(repoRoot(), "tests", "fixtures", "patterns", "x")), "tests/fixtures/patterns/x");
    const outside = writePack({});
    assert.equal(packDisplayDir(outside), outside.split(path.sep).join("/"));
});

test("packBanner is the contracts 7.6 text for a non-default pack and null for the bundled pack", () => {
    const outside = writePack({});
    assert.equal(
        packBanner({ dir: outside, isDefault: false }),
        `NON-DEFAULT PATTERN PACK: ${outside.split(path.sep).join("/")} (test or operator override, not the company pack)`,
    );
    assert.equal(
        packBanner({ dir: path.join(repoRoot(), "tests", "fixtures", "patterns", "x"), isDefault: false }),
        "NON-DEFAULT PATTERN PACK: tests/fixtures/patterns/x (test or operator override, not the company pack)",
    );
    assert.equal(packBanner({ dir: defaultPatternsDir(), isDefault: true }), null);
});
