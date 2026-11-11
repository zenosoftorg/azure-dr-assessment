import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { OVERRIDE_LEVELS } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const skill = path.join(root, "skills", "azure-dr-assessment");
const read = (...parts) => readFileSync(path.join(skill, ...parts), "utf8");
const STAGES = ["02-intake", "03-ingest", "04-as-is", "05-region-analysis", "05b-dr-options", "06-dr-design", "07-report"];

/** Every Markdown file of the skill folder. */
function markdownFiles(dir = skill) {
    return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) return markdownFiles(full);
        return name.endsWith(".md") ? [full] : [];
    });
}

test("SKILL.md has the front matter of a skill and stays a thin orchestrator", () => {
    const text = read("SKILL.md");
    assert.match(text, /^---\nname: azure-dr-assessment\ndescription: Use when [^\n]+\n---\n/);
    assert.ok(text.split("\n").length <= 100, "the stage detail lives in the references");
    assert.match(text, /## Precedence, per decision slot/);
    assert.match(text, /## Degraded modes/);
});

test("SKILL.md points to every stage reference and to the two reference files, and each exists", () => {
    const links = [...read("SKILL.md").matchAll(/\]\((references\/[^)#]+\.md)\)/g)].map((match) => match[1]).sort();
    assert.deepEqual(links, [...STAGES.map((stage) => `references/stages/${stage}.md`), "references/output-contract.md", "references/patterns.md"].sort());
    for (const link of links) assert.ok(existsSync(path.join(skill, link)), link);
});

test("the references folder holds the two reference files and the stages, and the v1 files are gone", () => {
    assert.deepEqual(readdirSync(path.join(skill, "references")).filter((name) => !name.startsWith(".")).sort(), ["output-contract.md", "patterns.md", "stages"]);
});

test("every relative link in the skill's Markdown resolves", () => {
    const broken = [];
    for (const file of markdownFiles()) {
        for (const match of readFileSync(file, "utf8").matchAll(/\]\(([^)\s]+)\)/g)) {
            const target = match[1].split("#")[0];
            if (!target || /^(https?:|mailto:)/.test(target)) continue;
            if (!existsSync(path.resolve(path.dirname(file), target))) broken.push(`${path.relative(root, file)} -> ${match[1]}`);
        }
    }
    assert.deepEqual(broken, []);
});

test("patterns.md names every override level, the pack and the way to test another pack", () => {
    const text = read("references", "patterns.md");
    for (const level of OVERRIDE_LEVELS) assert.ok(text.includes(`\`${level}\``), level);
    for (const needle of ["DR-TIER-001", "DR-DNS-001", "DR_PATTERNS_DIR", "--patterns-dir", "NON-DEFAULT PATTERN PACK", "documented exception", "cannot verify the approval", "patterns/README.md"]) {
        assert.ok(text.includes(needle), needle);
    }
    assert.match(text, /Application files, such as the inventory, `assessment\.yaml` and the user's folders, never carry patterns/);
    assert.match(text, /An override without an `alternative` waives the pattern for those slots and nothing replaces it\. The decision then keeps the source `override`, takes its content from Microsoft Learn/);
    assert.match(text, /Skip the Verification checks that test a waived slot and list each one in the report as `Not checked: waived by Override #<n>`; it is not a Gap/);
});

test("inline mode is defined in SKILL.md, patterns.md and the output contract: reasoning only, nothing written", () => {
    assert.match(read("SKILL.md"), /\| The user asks for no files, or no writable location exists \| Inline mode: the same reasoning-only run, and nothing is written/);
    assert.match(read("references", "patterns.md"), /Reasoning-only and inline runs have no scripts, so there is no `resolve-patterns`/);
    assert.match(read("references", "output-contract.md"), /^## Concise and inline answers$/m);
});

test("SKILL.md announces the first-use icon fetch and says that only the presentation build refuses without icons", () => {
    const text = read("SKILL.md");
    assert.match(text, /announce that you fetch Microsoft's official icons now, and run `node skills\/azure-dr-assessment\/scripts\/fetch-icons\.mjs` once/);
    assert.match(text, /The presentation build refuses \(exit 4, `zero-icons`\)\. The diagram files, the report, the DR establishment guide and the runbook are still produced/);
});

test("SKILL.md names the missing browser as a degraded mode: the check is NOT RUN and a presentation is never called verified", () => {
    assert.match(read("SKILL.md"), /\| No browser, or it did not start \| The browser check of the presentations is NOT RUN\. Say so, and never call a presentation verified\. \|/);
});

test("output-contract.md lists the sections of DR-TIER-001 in its order and every file the scripts write", () => {
    const tier = read("patterns", "DR-TIER-001.md");
    const block = tier.split(/^## Required response structure$/m)[1].split(/^## /m)[0];
    const sections = [...block.matchAll(/^\d\. \*\*(.+?)\*\*/gm)].map((match) => match[1]);
    const contract = read("references", "output-contract.md");
    assert.equal(sections.length, 7);
    assert.deepEqual([...contract.matchAll(/^\d\. \*\*(.+?)\.\*\*/gm)].map((match) => match[1]), sections);
    for (const file of [
        "assessment.yaml", "evidence/inventory.json", "evidence/ledger.json", "evidence/dr-options.json", "evidence/pattern-resolution.json", "evidence/fit.json",
        "architectures/{app}-current-state.arch.json", "architectures/{app}-proposed-dr.arch.json",
        "presentations/{app}-current-state.html", "presentations/{app}-proposed-dr.html", "reports/assessment.md", "reports/dr-establishment-guide.md", "reports/recovery-runbook.md",
    ]) {
        assert.ok(contract.includes(file), file);
    }
    assert.match(contract, /DRAFT: not an operational procedure until rehearsed and approved by the owner/);
    assert.match(contract, /each as `Not checked: waived by Override #<n>`/);
    assert.match(contract, /A slot that an override waives without an alternative shows the source `override` and cites the Microsoft Learn documents it took its content from/);
});

test("the stage 7 reference, 07-report.md, names the report and the runbook files", () => {
    const report = read("references", "stages", "07-report.md");
    for (const file of ["reports/assessment.md", "reports/dr-establishment-guide.md", "reports/recovery-runbook.md"]) assert.ok(report.includes(file), file);
});

test("SKILL.md describes only when to use it, and says what happens without Node, without a script host and without the Learn tools", () => {
    const text = read("SKILL.md");
    const description = /^description: (.+)$/m.exec(text)[1];
    assert.match(description, /^Use when asked to /);
    assert.doesNotMatch(description, /\b(then|stages?|writes|produces|builds)\b/i);
    assert.match(text, /\| No Node\.js 22 or later, or the host does not let you run scripts \| Reasoning-only: no script runs\./);
    assert.match(text, /If you cannot run it \(no Node 22, or the host does not let you run scripts\), go to Degraded modes/);
    assert.match(text, /If there is none, report the input as unreadable and name the alternatives: run where Node 22 is available, or give a live read\./);
    assert.doesNotMatch(text, /\bCSV\b/);
    assert.match(text, /Check that the Microsoft Learn tools \(`microsoft_docs_search`, `microsoft_docs_fetch`\) are in your tool list, and say so when they are not: the guidance is then Unverified/);
});

test("assessment.yaml is the only file a person edits, in SKILL.md and in the output contract, and the runbook carries the pack banner", () => {
    assert.match(read("SKILL.md"), /`assessment\.yaml` is the only file a person edits: everything else is generated and the next run overwrites it\./);
    const contract = read("references", "output-contract.md");
    assert.match(contract, /It is the only file a person edits: every other file is regenerated by a rerun\./);
    assert.match(contract, /When the pattern pack is not the company pack, the pack banner follows as a blockquote line\./);
});
