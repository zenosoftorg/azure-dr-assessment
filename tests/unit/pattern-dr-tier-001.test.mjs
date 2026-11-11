import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { normalizeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { lintPack } from "../../skills/azure-dr-assessment/scripts/lib/pattern-lint.mjs";
import { defaultPatternsDir } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { loadPack, readPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { evaluateGates } from "../../skills/azure-dr-assessment/scripts/lib/resolve.mjs";
import { checkTargets, tierBands } from "../../skills/azure-dr-assessment/scripts/lib/tiers.mjs";
import { writePatterns } from "../helpers/pack-fixture.mjs";
import { tierSpec } from "../helpers/tier-fixture.mjs";

const loaded = await readPack(defaultPatternsDir());
const pack = loaded.pack;
const tier = pack.byId.get("DR-TIER-001");
const assess = (objectives) => normalizeAssessment({ workload: { name: "checkout" }, objectives });

const LZ_QUESTION = [
    "**Which landing zone DR tier applies to this application?**",
    "",
    "- **Tier 0 — Active/Active:** RPO **near zero**; RTO **near zero**. Mission-critical workloads.",
    "- **Tier 1 — Hot/Warm (Active/Passive):** RPO **seconds–minutes**; RTO **30 minutes–2 hours**. Business-critical workloads.",
    "- **Tier 2 — Hot/Cold (minimal secondary compute; Azure Site Recovery where appropriate):** RPO **1–4 hours**; RTO **4–12 hours**. Important, cost-conscious workloads.",
    "- **Tier 3 — Cold (Backup/Restore):** RPO **24+ hours**; RTO **24–72 hours**. Low-criticality workloads.",
    "",
    "Reply with **0, 1, 2, or 3**. If you are unsure, describe the business impact of data loss and downtime, and we can determine the appropriate tier together.",
].join("\n");

test("the bundled pack lints clean and holds DR-TIER-001", () => {
    assert.equal(pack.isDefault, true);
    assert.deepEqual(lintPack(loaded), []);
    assert.ok(tier, "DR-TIER-001 is missing from the bundled pack");
});

test("front matter: approved, locked, deciding objectives only and applying to every tier", () => {
    assert.deepEqual(
        {
            id: tier.id, version: tier.version, status: tier.status, override: tier.override, slots: tier.slots,
            applies_to: tier.applies_to, supersedes: tier.supersedes, owner_role: tier.owner_role, inputs: tier.inputs,
        },
        {
            id: "DR-TIER-001", version: 1, status: "approved", override: "locked", slots: ["objectives"],
            applies_to: {}, supersedes: [], owner_role: "landing zone platform architecture", inputs: [],
        },
    );
});

test("the gate question is the company tier question, verbatim", () => {
    assert.equal(tier.gate.question, LZ_QUESTION);
});

test("the response structure has the seven tier sections, in order", () => {
    const names = [...tier.sections["Required response structure"].matchAll(/^\d\.\s+\*\*(.+?)\*\*/gm)].map((m) => m[1]);
    assert.deepEqual(names, [
        "Selected landing zone tier and recovery objectives",
        "Assumptions and failure scope",
        "Proposed architecture",
        "Failover and failback sequence",
        "RPO/RTO feasibility assessment",
        "Landing zone versus workload-team actions",
        "Validation plan and next steps",
    ]);
});

const UNIT = { second: 1, seconds: 1, minute: 60, minutes: 60, hour: 3600, hours: 3600 };
/** "30 minutes–2 hours", "1–4 hours" or "24+ hours" in seconds; null for words such as "Near zero". */
function bandFromText(text) {
    let m = /^(\d+)\+ (\w+)$/.exec(text);
    if (m) return { min: Number(m[1]) * UNIT[m[2]], max: null };
    m = /^(\d+)(?: (\w+))?–(\d+) (\w+)$/.exec(text);
    if (m) return { min: Number(m[1]) * UNIT[m[2] ?? m[4]], max: Number(m[3]) * UNIT[m[4]] };
    return null;
}

test("the tier table in the markdown and parameters.tiers agree", () => {
    const rows = tier.sections["Required behavior"].split("\n").filter((line) => /^\|\s*\*\*Tier \d\*\*/.test(line))
        .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/\*\*/g, "")));
    assert.equal(rows.length, 4);
    const bands = tierBands(pack);
    rows.forEach(([label, patternName, rpoText, rtoText, cost], index) => {
        const raw = tier.parameters.tiers[index];
        assert.equal(label, `Tier ${index}`);
        assert.equal(patternName, raw.pattern);
        assert.equal(rpoText, raw.rpo.text);
        assert.equal(rtoText, raw.rto.text);
        assert.equal(cost, raw.cost);
        for (const [metric, text] of [["rpo", rpoText], ["rto", rtoText]]) {
            const fromText = bandFromText(text);
            if (fromText === null) {
                if (index === 0) assert.deepEqual(bands[index][metric], { minSeconds: null, maxSeconds: null });
            } else {
                assert.deepEqual(bands[index][metric], { minSeconds: fromText.min, maxSeconds: fromText.max }, `tier ${index} ${metric}`);
            }
        }
    });
});

test("tierBands equals the test double the other tests use", async () => {
    const double = await loadPack(writePatterns([tierSpec()]));
    assert.deepEqual(tierBands(pack), tierBands(double));
    assert.equal(tierBands(pack).length, 4);
});

test("Diagram elements, Runbook steps and Verification are marked as derived", () => {
    for (const title of ["Diagram elements", "Runbook steps", "Verification"]) {
        assert.equal(tier.sections[title].split("\n")[0], "Derived by this repository from the rules above.", title);
    }
    assert.ok(!tier.sections["Required behavior"].includes("Derived by this repository"));
});

test("the tier file wording is kept in the sections that carry it", () => {
    const behavior = tier.sections["Required behavior"];
    for (const text of [
        "### Scope and responsibility",
        "### Landing zone DR tier reference: authoritative planning targets",
        "### Discovery after tier selection",
        "### Design rules by tier",
        "#### Tier 0 — Active/Active",
        "#### Tier 1 — Hot/Warm (Active/Passive)",
        "#### Tier 2 — Hot/Cold (minimal secondary compute)",
        "#### Tier 3 — Cold (Backup/Restore)",
        "### Required architecture assessment",
        "The company landing zone (LZ) provides shared Azure platform foundations. **Workload teams remain responsible for designing, implementing, operating, and testing DR for their own applications** using one of the four patterns below.",
        "**Definitions:** RPO = maximum acceptable data loss measured in time. RTO = maximum acceptable time to restore required business functionality. These are **planning objectives, not Azure service guarantees**.",
        "For 'near zero,' request explicit measurable business thresholds before claiming any target is achievable. Near zero is not automatically zero data loss or zero interruption.",
        "- Do not label a design 'near-zero RPO/RTO' without an explicit validation plan and measured evidence.",
        "- Do not downgrade the secondary to on-demand infrastructure while still calling it Tier 1.",
        "- Show how the backup schedule supports **24+ hours RPO** and rehearsed restore procedures support **24–72 hours RTO**.",
        "A replicated database or powered-on VM is not necessarily a recovered application.",
    ]) {
        assert.ok(behavior.includes(text), `Required behavior lost: ${text}`);
    }
    assert.ok(tier.sections["Mandatory first step"].includes("Do not infer or silently assign a tier from application names or perceived importance."));
    assert.ok(tier.sections["Mandatory first step"].includes("After a selection, restate the chosen pattern and its RTO/RPO targets, then ask only the most consequential missing discovery questions."));
    assert.ok(tier.sections["Required response structure"].includes("If the business target is not feasible with the selected design, **say so explicitly** and offer design changes or a revised tier rather than masking the gap."));
});

test("the sections in the tier file wording are pinned: a tier file change needs a pull request that updates this digest", () => {
    const joined = ["Required behavior", "Mandatory first step", "Required response structure"].map((title) => tier.sections[title]).join("\n<section>\n");
    assert.equal(createHash("sha256").update(joined).digest("hex"), "d248c7d967112c698cf1fbc3bbb0740cd05267ec1147889677e0a10643cff95f");
});

test("checkTargets: RTO 10m on tier 1 is stricter, 45m is not, a zero RPO on tier 2 is stricter, tier 0 has no band", () => {
    assert.deepEqual(checkTargets(assess({ tier: 1, rto: "10m" }), pack).stricter, [{ metric: "rto", targetSeconds: 600, tierMinSeconds: 1800 }]);
    assert.deepEqual(checkTargets(assess({ tier: 1, rto: "45m" }), pack).stricter, []);
    assert.deepEqual(checkTargets(assess({ tier: 2, rpo: "0" }), pack).stricter, [{ metric: "rpo", targetSeconds: 0, tierMinSeconds: 3600 }]);
    assert.deepEqual(checkTargets(assess({ tier: 0, rpo: "0", rto: "1s" }), pack).stricter, []);
});

test("evaluateGates: a missing tier, a stricter target and a recorded exception", () => {
    const missing = evaluateGates(assess({ tier: null }), pack);
    assert.deepEqual(missing.map((g) => [g.id, g.status]), [["tier-missing", "open"], ["target-stricter-than-tier", "satisfied"]]);
    assert.equal(missing[0].question, LZ_QUESTION);

    const stricter = evaluateGates(assess({ tier: 1, rto: "10m" }), pack);
    assert.deepEqual(stricter.map((g) => g.status), ["satisfied", "open"]);

    const exception = { what: "RTO 10m", approver_role: "CTO", date: "2026-11-04" };
    const excepted = evaluateGates(assess({ tier: 1, rto: "10m", exceptions: [exception] }), pack);
    assert.deepEqual(excepted.map((g) => g.status), ["satisfied", "excepted"]);
});
