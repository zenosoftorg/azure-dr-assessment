import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { BUILD_ORDER_SLOT, CHAPTERS_SLOT, RUNBOOK_MARKERS, TEST_PLAN_MARKERS } from "../../skills/azure-dr-assessment/scripts/lib/guide.mjs";
import { MARKERS, injectTables } from "../../skills/azure-dr-assessment/scripts/lib/report-tables.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const templates = path.join(root, "skills", "azure-dr-assessment", "assets", "templates");
const report = readFileSync(path.join(templates, "report.md"), "utf8");
const runbook = readFileSync(path.join(templates, "runbook.md"), "utf8");
const guide = readFileSync(path.join(templates, "dr-establishment-guide.md"), "utf8");
const tierPattern = readFileSync(path.join(root, "skills", "azure-dr-assessment", "patterns", "DR-TIER-001.md"), "utf8");
const headings = (text) => [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

/** The seven section names of the tier response structure, read from DR-TIER-001. */
function tierSections() {
    const block = tierPattern.split(/^## Required response structure$/m)[1].split(/^## /m)[0];
    return [...block.matchAll(/^\d\. \*\*(.+?)\*\*/gm)].map((match) => match[1]);
}

test("the report template follows the tier response structure, then the four supporting sections", () => {
    const sections = tierSections();
    assert.equal(sections.length, 7);
    assert.deepEqual(headings(report), [
        ...sections.map((name, i) => `${i + 1}. ${name}`),
        "A. Current-state architecture",
        "B. Evidence and unknowns",
        "C. Documentation sources",
        "D. Pattern register and documented exceptions",
    ]);
});

test("the report template carries each table marker pair once, and injection leaves the markers in place", () => {
    for (const name of MARKERS) {
        assert.equal(report.split(`<!-- dr-tables:${name} -->`).length - 1, 1, name);
        assert.equal(report.split(`<!-- /dr-tables:${name} -->`).length - 1, 1, name);
    }
    const filled = injectTables(report, { evidence: "EVIDENCE TABLES", sources: "SOURCE TABLES", patterns: "PATTERN TABLES" });
    assert.match(filled, /<!-- dr-tables:sources -->\nSOURCE TABLES\n<!-- \/dr-tables:sources -->/);
    assert.equal(injectTables(filled, { evidence: "EVIDENCE TABLES", sources: "SOURCE TABLES", patterns: "PATTERN TABLES" }), filled);
});

test("the report template tells the model what to fill and states the draft and no-guarantee rules", () => {
    assert.match(report, /\*\*Draft for the owner's review\.\*\*/);
    assert.match(report, /RTO and RPO are objectives, not guarantees/);
    assert.match(report, /compliant or achieved without test evidence/);
    const fills = report.match(/<!-- fill:/g) ?? [];
    assert.ok(fills.length >= 10, `${fills.length} fill instructions`);
    for (const word of ["Any-pair", "Paired-only", "No built-in multiregion", "Proposed", "Estimated", "Demonstrated", "Unverified", "pattern ID", "DR-DNS-001"]) {
        assert.ok(report.includes(word), word);
    }
    assert.match(report, /A slot that an override waives without an alternative follows Microsoft Learn: cite the documents and name the override\./);
    assert.match(report, /`Not checked: waived by Override #<n>`, with the pattern ID and version/);
});

test("the runbook template is marked DRAFT and has the contents the spec lists", () => {
    assert.match(runbook, /^# Recovery runbook\n\n> \*\*DRAFT: not an operational procedure until rehearsed and approved by the owner\.\*\*/);
    assert.deepEqual(headings(runbook), [
        "1. Preconditions and decision authority",
        "2. Detection and triggers",
        "3. Recovery steps by component",
        "4. Traffic switch",
        "5. Business verification",
        "6. Failback and resynchronization",
        "7. Return to steady state",
        "8. Test plan",
    ]);
    const recovery = runbook.split("## 3. Recovery steps by component")[1].split("## 4.")[0];
    assert.ok(recovery.includes("<!-- dr-guide:runbook -->\n<!-- /dr-guide:runbook -->"), "section 3 holds the markers that establishment-guide --inject-runbook fills");
    for (const marker of RUNBOOK_MARKERS) assert.equal(runbook.split(marker).length - 1, 1, marker);
    assert.doesNotMatch(runbook, /\| Order \| Component \|/);
    assert.match(runbook, /on-prem DNS record/);
    assert.match(runbook, /TTL wait counts toward RTO/);
    assert.match(runbook, /Estimated until a drill record shows it as Demonstrated/);
    assert.match(runbook, /only when asked, and label them untested/);
});

test("the guide template opens with the DRAFT line of the runbook and carries its generator slots and test plan markers once", () => {
    const draft = (text) => text.split("\n")[2];
    assert.equal(guide.split("\n")[0], "# DR establishment guide");
    assert.equal(draft(guide), draft(runbook));
    assert.deepEqual(headings(guide), ["Target picture", "Build order", "Transition plan", "Consolidated test plan", "DR readiness checklist"]);
    for (const marker of [BUILD_ORDER_SLOT, CHAPTERS_SLOT, ...TEST_PLAN_MARKERS]) assert.equal(guide.split(marker).length - 1, 1, marker);
    assert.ok(guide.indexOf(BUILD_ORDER_SLOT) < guide.indexOf("## Transition plan") && guide.indexOf(CHAPTERS_SLOT) < guide.indexOf("## Consolidated test plan"));
    assert.match(guide, /Every time is Estimated until a drill record shows it as Demonstrated\./);
    assert.match(guide, /labelled untested/);
    assert.doesNotMatch(guide, /\b(compliant|achieved|guaranteed)\b/i);
});
