import assert from "node:assert/strict";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { MARKERS, evidenceSection, injectTables, patternsSection, sourcesSection } from "../../skills/azure-dr-assessment/scripts/lib/report-tables.mjs";

const fact = (id, strength, subject, claim, basis = null) => ({ id, kind: "fact", strength, subject, claim, basis });
const ledger = {
    entries: [
        fact("F-0001", "Observed", "ari:SQL DBs!3", "orders-db Zone Redundant is false"),
        fact("F-0002", "Inferred", "web->db", "web calls db", "connection string name matches"),
        fact("F-0003", "Unknown", "sheet:Overview", "Sheet Overview was not assessed: unstructured"),
        fact("F-0004", "Unknown", "x", "claim with a | pipe\nand a newline"),
        { id: "D-0001", kind: "doc", url: "https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support", title: "Azure services with multiregion support", retrievedAt: "2026-11-04T10:00:00.000Z", status: "Verified", supports: "mechanism rows" },
        { id: "D-0002", kind: "doc", url: null, title: "Model knowledge", retrievedAt: null, status: "Unverified", supports: "Key Vault failover" },
        { id: "R-0001", kind: "region", check: "mechanism", subject: "microsoft.sql/servers/databases", status: "Verified", class: "any-pair", doc: "D-0001", substitute: null },
        { id: "R-0002", kind: "region", check: "mechanism", subject: "microsoft.keyvault/vaults", status: "Verified", class: "paired-only", doc: "D-0001", substitute: { source: "customer-built", ref: "https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault#custom-multiregion-solutions-for-resiliency", label: "Proposed" } },
        { id: "R-0003", kind: "region", check: "mechanism", subject: "microsoft.web/sites", status: "Unverified", class: "none", doc: null, substitute: { source: "unmet", ref: null, label: "Unmet requirement" } },
    ],
};
const inventory = {
    source: { kind: "ari-xlsx", file: "ari-export.xlsx", sha256: "31bad595ceb833a86d908669b68850a84e06cdf89c4ef9985c45ac23d15c84c4", readAt: "2026-11-04T17:57:54.328Z" },
    scope: { applied: true, matched: 7, total: 12 },
    sheets: [
        { name: "Virtual Machines", assessed: true, reason: null },
        { name: "SQL DBs", assessed: true, reason: null },
        { name: "Advisor", assessed: false, reason: "not mapped to a resource type" },
        { name: "Overview", assessed: false, reason: "unstructured" },
    ],
    omissions: [{ what: "sheet:Overview", reason: "unstructured" }, { what: "subscription:3333", reason: "permission gap" }],
    warnings: ["sheet Disks was cut at 20000 rows"],
};
const resolution = {
    banner: null,
    gates: [
        { id: "tier-missing", pattern: "DR-TIER-001", status: "satisfied", detail: "tier 1 supplied", question: null },
        { id: "target-stricter-than-tier", pattern: "DR-TIER-001", status: "excepted", detail: "RTO 10m is below the tier 1 lower bound of 30m; recorded as an objectives.exceptions entry; one entry covers all", question: null },
    ],
    patterns: [
        { id: "DR-DNS-001", version: 1, status: "approved", override: "approval-required", applied: true, reason: "approved and applicable" },
        { id: "DR-TIER-001", version: 1, status: "approved", override: "locked", applied: true, reason: "approved and applicable" },
    ],
    overrides: [
        { index: 0, pattern: "DR-DNS-001", outcome: "applied", reason: "complete" },
        { index: 1, pattern: "DR-DNS-001", outcome: "rejected", reason: "missing required fields: justification, date" },
    ],
    openInputs: [{ pattern: "DR-DNS-001", name: "ttl", description: "The TTL of that record, in seconds" }],
    slots: [
        { slot: "objectives", candidate: { source: "pattern", pattern: "DR-TIER-001", version: 1 }, collision: null, status: "candidate", decision: { text: "Tier 1, Hot/Warm", source: "pattern", ref: "DR-TIER-001 v1", status: "Resolved" } },
        { slot: "traffic-dns", candidate: { source: "override", pattern: "DR-DNS-001", version: 1, overrideIndex: 0, alternative: "Azure Front Door" }, collision: null, status: "candidate", decision: null },
        { slot: "ingress", candidate: { source: "collision" }, collision: ["DR-A-001 v1", "DR-B-001 v2"], status: "unresolved", decision: null },
        { slot: "compute", candidate: { source: "learn" }, collision: null, status: "candidate", decision: { text: "", source: "azure-reality", ref: null, status: "Unmet requirement", azureReality: "no multiregion mechanism for App Service" } },
        { slot: "backup", candidate: { source: "override", pattern: "DR-BKP-001", version: 1, overrideIndex: 2, alternative: null }, collision: null, status: "candidate", decision: { text: "Backups are run by the platform team", source: "override", ref: "free text that is ignored", status: "Resolved" } },
    ],
    documentedExceptions: [
        { kind: "override", index: 0, pattern: "DR-DNS-001", slots: ["traffic-dns"], justification: "Internet-facing only", owner_role: "Application owner", date: "2026-11-04", approver_role: "Platform architecture board", approval_ref: "ARB-2026-114", approvalVerified: false, alternative: "Azure Front Door" },
        { kind: "override", index: 2, pattern: "DR-BKP-001", slots: ["backup"], justification: "Backups are run by the platform team", owner_role: "Platform owner", date: "2026-11-04", approver_role: null, approval_ref: null, approvalVerified: false, alternative: null },
        { kind: "tier-exception", what: "RTO 10m stays unmet by tier 1", approver_role: "CTO", date: "2026-11-04" },
    ],
};

test("the evidence section says what was read and what was not, and lists what is not Observed", () => {
    const text = evidenceSection({ ledger, inventory });
    assert.match(text, /^### What was read/);
    assert.match(text, /- Source: ARI workbook `ari-export\.xlsx` \(SHA-256 31bad595ceb8…, read 2026-11-04T17:57:54\.328Z\)\./);
    assert.match(text, /- Sheets or queries assessed: 2 of 4 \(Virtual Machines, SQL DBs\)\./);
    assert.match(text, /- Not assessed, so Unknown and never read as absent: Advisor \(not mapped to a resource type\), Overview \(unstructured\)\./);
    assert.match(text, /- Other gaps: subscription:3333 \(permission gap\)\./);
    assert.match(text, /- Resources in scope: 7 of 12 \(scope selector applied\)\./);
    assert.match(text, /- Warning: sheet Disks was cut at 20000 rows/);
    assert.match(text, /\| Observed \| 1 \|\n\| Inferred \| 1 \|\n\| Unknown \| 2 \|/);
    assert.match(text, /\| F-0002 \| Inferred \| web->db \| web calls db \| connection string name matches \|/);
    assert.match(text, /claim with a \\\| pipe and a newline/);
    assert.doesNotMatch(text, /F-0001 \| Observed/);
    assert.match(text, /### Region analysis/);
    assert.match(text, /\| R-0001 \| mechanism \| microsoft\.sql\/servers\/databases \| Verified \| Any-pair \| D-0001 \|  \|/);
    assert.match(text, /\| R-0002 \| mechanism \| microsoft\.keyvault\/vaults \| Verified \| Paired-only \| D-0001 \| Proposed: customer-built \(https:\/\/learn\.microsoft\.com\/en-us\/azure\/reliability\/reliability-key-vault#custom-multiregion-solutions-for-resiliency\) \|/);
    assert.match(text, /\| R-0003 \| mechanism \| microsoft\.web\/sites \| Unverified \| No built-in multiregion \|  \| Unmet requirement: unmet \|/);
});

test("the evidence section copes with no inventory and caps a long list", () => {
    const none = evidenceSection({ ledger: { entries: [] }, inventory: null });
    assert.match(none, /- No inventory was written, so nothing was read\./);
    assert.doesNotMatch(none, /### Inferred and Unknown/);
    const many = { entries: Array.from({ length: 5 }, (_, i) => fact(`F-000${i + 1}`, "Unknown", `s${i}`, `gap ${i}`)) };
    const capped = evidenceSection({ ledger: many, inventory: null, maxRows: 3 });
    assert.match(capped, /Showing 3 of 5\. The full list is in evidence\/ledger\.json\./);
    assert.match(capped, /F-0003/);
    assert.doesNotMatch(capped, /F-0004/);
});

test("the sources section lists every documentation entry and flags the Unverified ones", () => {
    const text = sourcesSection({ ledger });
    assert.match(text, /^\| Id \| Title \| URL \| Retrieved \| Status \| Supports \|/);
    assert.match(text, /\| D-0001 \| Azure services with multiregion support \| https:\/\/learn\.microsoft\.com\/en-us\/azure\/reliability\/regions-multiregion-support \| 2026-11-04T10:00:00\.000Z \| Verified \| mechanism rows \|/);
    assert.match(text, /\| D-0002 \| Model knowledge \| none \| not retrieved \| Unverified \| Key Vault failover \|/);
    assert.match(text, /Unverified sources were not retrieved in this run/);
    assert.equal(sourcesSection({ ledger: { entries: [] } }), "No documentation source was recorded. Guidance in this report is Unverified.");
});

test("the patterns section is the pattern register, the slot decisions and the documented exceptions", () => {
    const text = patternsSection({ resolution });
    assert.doesNotMatch(text, /NON-DEFAULT/);
    assert.match(text, /### Patterns/);
    assert.match(text, /\| DR-DNS-001 \| v1 \| approval-required \| Yes \| approved and applicable \|/);
    assert.match(text, /\| DR-TIER-001 \| v1 \| locked \| Yes \|/);
    assert.match(text, /### Decision per slot/);
    assert.match(text, /\| objectives \| Resolved \| Tier 1, Hot\/Warm \| DR-TIER-001 v1 \|/);
    assert.match(text, /\| traffic-dns \| Not yet decided \| Candidate: override #0 of DR-DNS-001 v1 \(Azure Front Door\) \|  \|/);
    assert.match(text, /\| ingress \| Unresolved \| Collision: DR-A-001 v1 and DR-B-001 v2\. Resolve it with a `supersedes` link on one of the two patterns \(pull request\) or a decision recorded in `assessment\.yaml`\. \|  \|/);
    assert.match(text, /\| compute \| Unmet requirement \| no multiregion mechanism for App Service \| Azure reality \|/);
    assert.match(text, /\| backup \| Resolved \| Backups are run by the platform team \| Override #2 of DR-BKP-001 \(documented exception\) \|/);
    assert.doesNotMatch(text, /free text that is ignored/);
    assert.match(text, /### Documented exceptions/);
    assert.match(text, /\| #0 \| DR-DNS-001 \| traffic-dns \| Azure Front Door \| Internet-facing only \| Application owner \| 2026-11-04 \| Platform architecture board \| ARB-2026-114 \| No: this skill cannot verify an approval \|/);
    assert.match(text, /\| #2 \| DR-BKP-001 \| backup \| none: Microsoft Learn applies \| Backups are run by the platform team \| Platform owner \| 2026-11-04 \|  \|  \| Not required \|/);
    assert.match(text, /\| RTO 10m stays unmet by tier 1 \| CTO \| 2026-11-04 \|/);
    assert.match(text, /### Rejected overrides/);
    assert.match(text, /\| #1 \| DR-DNS-001 \| missing required fields: justification, date \|/);
    assert.match(text, /A rejected override changes nothing: the pattern keeps applying\./);
    assert.match(text, /### Open inputs/);
    assert.match(text, /\| DR-DNS-001 \| ttl \| The TTL of that record, in seconds \|/);
});

test("an override without an alternative says that Microsoft Learn applies, and a candidate that is not recognized is Unknown", () => {
    const undecided = structuredClone(resolution);
    undecided.slots[4].decision = null;
    undecided.slots.push({ slot: "identity", candidate: { source: "mystery" }, collision: null, status: "candidate", decision: null });
    const text = patternsSection({ resolution: undecided });
    assert.match(text, /\| backup \| Not yet decided \| Candidate: override #2 of DR-BKP-001 v1 \(no alternative: Microsoft Learn applies\) \|  \|/);
    assert.match(text, /\| traffic-dns \| Not yet decided \| Candidate: override #0 of DR-DNS-001 v1 \(Azure Front Door\) \|  \|/);
    assert.match(text, /\| identity \| Not yet decided \| Candidate: Unknown \|  \|/);
});

test("a collision row still names both patterns after the model completed it, and quotes an owner decision", () => {
    const completed = structuredClone(resolution);
    completed.slots[2].decision = { text: "", source: null, ref: null, status: "Unresolved" };
    const bare = patternsSection({ resolution: completed });
    assert.match(bare, /\| ingress \| Unresolved \| Collision: DR-A-001 v1 and DR-B-001 v2\. Resolve it with a `supersedes` link on one of the two patterns \(pull request\) or a decision recorded in `assessment\.yaml`\. \|  \|/);

    completed.slots[2].decision.text = "Owner decision on file (Platform owner, 2026-11-05): follow DR-B-001 v2 until the pack is fixed.";
    const quoted = patternsSection({ resolution: completed });
    assert.match(quoted, /\| ingress \| Unresolved \| Collision: DR-A-001 v1 and DR-B-001 v2\. Resolve it with .* in `assessment\.yaml`\. Owner decision on file \(Platform owner, 2026-11-05\): follow DR-B-001 v2 until the pack is fixed\. \|  \|/);
});

test("a tier exception is followed by the gate detail, which names each excepted target and says that one entry covers all", () => {
    const text = patternsSection({ resolution });
    assert.match(text, /\| RTO 10m stays unmet by tier 1 \| CTO \| 2026-11-04 \|\n\nTier gate: RTO 10m is below the tier 1 lower bound of 30m; recorded as an objectives\.exceptions entry; one entry covers all\.\n/);
    assert.doesNotMatch(patternsSection({ resolution: { ...resolution, gates: undefined } }), /Tier gate:/);
    const open = structuredClone(resolution);
    open.gates[1] = { ...open.gates[1], status: "open", detail: "RTO 10m is below the tier 1 lower bound of 30m; change the tier or record an objectives.exceptions entry" };
    assert.doesNotMatch(patternsSection({ resolution: open }), /Tier gate:/);
});

test("the patterns section shows the non-default pack banner, says None, and copes with no resolution", () => {
    const banner = "NON-DEFAULT PATTERN PACK: tests/fixtures/patterns/collisions (test or operator override, not the company pack)";
    const text = patternsSection({ resolution: { ...resolution, banner, documentedExceptions: [], overrides: [], openInputs: [] } });
    assert.ok(text.startsWith(`> **${banner}**`));
    assert.match(text, /### Documented exceptions\n\nNone\./);
    assert.doesNotMatch(text, /### Rejected overrides|### Open inputs/);
    assert.equal(patternsSection({ resolution: null }), "No pattern resolution was produced, so no company pattern is recorded as applied.");
});

test("injectTables fills each marker pair, can run twice with the same result, and names a missing pair", () => {
    const sections = { evidence: "EVIDENCE", sources: "SOURCES", patterns: "PATTERNS" };
    const report = MARKERS.map((name) => `## ${name}\n<!-- dr-tables:${name} -->\nold ${name}\n<!-- /dr-tables:${name} -->\n`).join("\n");
    const once = injectTables(report, sections);
    assert.match(once, /<!-- dr-tables:evidence -->\nEVIDENCE\n<!-- \/dr-tables:evidence -->/);
    assert.match(once, /<!-- dr-tables:patterns -->\nPATTERNS\n<!-- \/dr-tables:patterns -->/);
    assert.doesNotMatch(once, /old /);
    assert.equal(injectTables(once, sections), once);

    const broken = report.replace("<!-- /dr-tables:sources -->", "");
    assert.throws(
        () => injectTables(broken, sections),
        (err) => err instanceof CliError && err.code === EXIT.INPUT && err.details.some((line) => line.includes("dr-tables:sources")),
    );
});

// GC-07: the secret-like values are built at run time from parts, so that no file or tool output holds one.
const KEY_LIKE = ["Account", "Key="].join("") + "a".repeat(30);
const SIG_TOKEN = "q".repeat(24);
const SIG_LIKE = `https://tickets.example.com/browse/ARB-2026-114?${["si", "g="].join("")}${SIG_TOKEN}`;
const echoes = (value) => [KEY_LIKE, "a".repeat(30), SIG_LIKE, SIG_TOKEN].some((part) => JSON.stringify(value).includes(part));
const REFUSED = "the pattern resolution holds text that looks like a secret, so the report tables were not built";
const refusalLine = (at) => `${at}: looks like a secret (key, token, password or connection string) and must not appear in a report`;

/** The CliError that patternsSection throws for a resolution. The test fails when it builds the section instead. */
function refusal(custom) {
    try {
        patternsSection({ resolution: custom });
    } catch (err) {
        return err;
    }
    return assert.fail("patternsSection built the section from a resolution that holds secret-like text");
}

// [what carries the text, how the value reaches a copy of the resolution, the path that the refusal names]
const SECRET_SITES = [
    ["an approval reference in a documented exception", (r) => { r.documentedExceptions[0].approval_ref = SIG_LIKE; }, "resolution.documentedExceptions[0].approval_ref"],
    ["a justification in a documented exception", (r) => { r.documentedExceptions[0].justification = `Agreed in a call, then ${KEY_LIKE}`; }, "resolution.documentedExceptions[0].justification"],
    ["an alternative in a documented exception", (r) => { r.documentedExceptions[0].alternative = KEY_LIKE; }, "resolution.documentedExceptions[0].alternative"],
    ["the text of a decision", (r) => { r.slots[0].decision.text = `Tier 1, reached with ${KEY_LIKE}`; }, "resolution.slots[0].decision.text"],
    ["the Azure reality note of a decision", (r) => { r.slots[3].decision.azureReality = KEY_LIKE; }, "resolution.slots[3].decision.azureReality"],
    ["what a tier exception accepts", (r) => { r.documentedExceptions[2].what = KEY_LIKE; }, "resolution.documentedExceptions[2].what"],
    ["the alternative of a candidate", (r) => { r.slots[1].candidate.alternative = KEY_LIKE; }, "resolution.slots[1].candidate.alternative"],
    ["the reason of a rejected override", (r) => { r.overrides[1].reason = KEY_LIKE; }, "resolution.overrides[1].reason"],
    ["the description of an open input", (r) => { r.openInputs[0].description = KEY_LIKE; }, "resolution.openInputs[0].description"],
    ["the banner", (r) => { r.banner = KEY_LIKE; }, "resolution.banner"],
    ["a string that the section does not print", (r) => { r.gates[0].question = KEY_LIKE; }, "resolution.gates[0].question"],
];

for (const [title, plant, at] of SECRET_SITES) {
    test(`refuses ${title} that looks like a secret, with the path and without the value`, () => {
        const custom = structuredClone(resolution);
        plant(custom);
        const err = refusal(custom);
        assert.ok(err instanceof CliError, String(err));
        assert.equal(err.code, EXIT.INPUT);
        assert.equal(err.message, REFUSED);
        assert.deepEqual(err.details, [refusalLine(at)]);
        assert.equal(echoes([err.message, err.details]), false);
    });
}

test("every secret-like string of the resolution is named, in document order, and the section is not built", () => {
    const custom = structuredClone(resolution);
    custom.documentedExceptions[0].approval_ref = SIG_LIKE;
    custom.slots[0].decision.text = KEY_LIKE;
    custom.documentedExceptions[2].what = KEY_LIKE;
    const err = refusal(custom);
    assert.deepEqual(err.details, [
        refusalLine("resolution.slots[0].decision.text"),
        refusalLine("resolution.documentedExceptions[0].approval_ref"),
        refusalLine("resolution.documentedExceptions[2].what"),
    ]);
    assert.equal(echoes([err.message, err.details]), false);
});

test("a key that is not a plain word is not printed in the path, even when it is the secret", () => {
    const custom = structuredClone(resolution);
    custom.slots[0].decision[KEY_LIKE] = KEY_LIKE;
    custom.documentedExceptions[1]["owner note"] = SIG_LIKE;
    const err = refusal(custom);
    assert.deepEqual(err.details, [refusalLine("resolution.slots[0].decision[?]"), refusalLine("resolution.documentedExceptions[1][?]")]);
    assert.equal(echoes([err.message, err.details]), false);
});

test("ordinary text passes the secret screen: a ticket link as approval reference builds the section as before", () => {
    const custom = structuredClone(resolution);
    custom.documentedExceptions[0].approval_ref = "https://tickets.example.com/browse/ARB-2026-114";
    const text = patternsSection({ resolution: custom });
    assert.match(text, /\| Platform architecture board \| https:\/\/tickets\.example\.com\/browse\/ARB-2026-114 \| No: this skill cannot verify an approval \|/);
});

test("the Source column shows the candidate that the engine chose, whatever source the decision names, and Unknown when the candidate is not recognized", () => {
    const custom = structuredClone(resolution);
    custom.slots[0].decision.source = "learn";
    custom.slots[4].decision.source = "learn";
    custom.slots.push({ slot: "identity", candidate: { source: "mystery" }, collision: null, status: "candidate", decision: { text: "Follow the platform default", source: "learn", ref: null, status: "Resolved" } });
    custom.slots.push({ slot: "network", candidate: { source: "constructor" }, collision: null, status: "candidate", decision: { text: "Follow the platform default", source: "constructor", ref: null, status: "Resolved" } });
    const text = patternsSection({ resolution: custom });
    assert.match(text, /\| objectives \| Resolved \| Tier 1, Hot\/Warm \| DR-TIER-001 v1 \|/);
    assert.match(text, /\| backup \| Resolved \| Backups are run by the platform team \| Override #2 of DR-BKP-001 \(documented exception\) \|/);
    assert.match(text, /\| identity \| Resolved \| Follow the platform default \| Unknown \|/);
    assert.match(text, /\| network \| Resolved \| Follow the platform default \| Unknown \|/);
    assert.doesNotMatch(text, /^\| (?:objectives|backup|identity|network) \|[^\n]*Microsoft Learn/m);
    assert.match(text, /\| compute \| Unmet requirement \| no multiregion mechanism for App Service \| Azure reality \|/);
});

/** Text of exactly `length` characters in words of nine letters, so that a cut is easy to see and the cell never ends with a space. */
const sentence = (length) => Array.from({ length }, (_, i) => (i % 10 === 9 && i < length - 1 ? " " : "x")).join("");

test("the formal record of a documented exception is not cut: justification, alternative, approval reference and tier exception print complete", () => {
    const long = sentence(294);
    const custom = structuredClone(resolution);
    Object.assign(custom.documentedExceptions[0], { alternative: long, justification: long, approval_ref: long });
    custom.documentedExceptions[2].what = long;
    const text = patternsSection({ resolution: custom });
    assert.ok(text.includes(`| #0 | DR-DNS-001 | traffic-dns | ${long} | ${long} | Application owner | 2026-11-04 | Platform architecture board | ${long} | No: this skill cannot verify an approval |`));
    assert.ok(text.includes(`| ${long} | CTO | 2026-11-04 |`));
});

test("a cell of a documented exception that is over its cap of 1000 characters still ends with the ellipsis", () => {
    const over = sentence(1100);
    const custom = structuredClone(resolution);
    custom.documentedExceptions[0].justification = over;
    custom.documentedExceptions[2].what = over;
    const text = patternsSection({ resolution: custom });
    assert.ok(text.includes(` ${over.slice(0, 999)}… |`));
    assert.equal(text.includes(over.slice(0, 1000)), false);
    assert.equal(text.split(`${over.slice(0, 999)}…`).length - 1, 2);
});

test("the reason of a rejected override is not cut below 400 characters, and a longer one ends with the ellipsis", () => {
    const custom = structuredClone(resolution);
    custom.overrides[1].reason = sentence(394);
    assert.ok(patternsSection({ resolution: custom }).includes(`| #1 | DR-DNS-001 | ${sentence(394)} |`));
    custom.overrides[1].reason = sentence(450);
    const text = patternsSection({ resolution: custom });
    assert.ok(text.includes(`| #1 | DR-DNS-001 | ${sentence(450).slice(0, 399)}… |`));
    assert.equal(text.includes(sentence(450).slice(0, 400)), false);
});

test("the claim of an Unknown or Inferred fact in section B is not cut below 400 characters, and a longer one ends with the ellipsis", () => {
    const withClaim = (claim) => evidenceSection({ ledger: { entries: [fact("F-0005", "Unknown", "sheet:Overview", claim), fact("F-0006", "Inferred", "web->db", claim, "basis")] }, inventory: null });
    const complete = withClaim(sentence(209));
    assert.ok(complete.includes(`| F-0005 | Unknown | sheet:Overview | ${sentence(209)} |  |`));
    assert.ok(complete.includes(`| F-0006 | Inferred | web->db | ${sentence(209)} | basis |`));
    const cut = withClaim(sentence(450));
    assert.ok(cut.includes(`| F-0005 | Unknown | sheet:Overview | ${sentence(450).slice(0, 399)}… |  |`));
    assert.equal(cut.includes(sentence(450).slice(0, 400)), false);
});

test("the cells that were already capped keep their caps: the decision text stays at 400 and the other tables at 200", () => {
    const custom = structuredClone(resolution);
    custom.slots[0].decision.text = sentence(450);
    custom.patterns[0].reason = sentence(250);
    const text = patternsSection({ resolution: custom });
    assert.ok(text.includes(`| objectives | Resolved | ${sentence(450).slice(0, 399)}… |`));
    assert.ok(text.includes(`| ${sentence(250).slice(0, 199)}… |`));
});
