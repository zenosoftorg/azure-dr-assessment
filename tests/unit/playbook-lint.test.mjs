import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { formatPlaybookFinding, lintPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbook-lint.mjs";
import { readPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { FIXTURE_SOURCE, PLAYBOOK_BODIES, playbookMarkdown, writePlaybookDir, writePlaybooks } from "../helpers/playbook-fixture.mjs";

const TODAY = "2026-11-09";

async function lintDir(dir, today = TODAY) {
    return lintPlaybooks(await readPlaybooks(dir), { today });
}
const lintSpecs = (specs, today) => lintDir(writePlaybooks(specs), today);
const lintFiles = (files) => lintDir(writePlaybookDir(files));
const brief = (findings) => findings.map((f) => [f.severity, f.rule, f.message]);

/** The fixture text of one section with one exact piece replaced. */
function swap(title, from, to) {
    const text = PLAYBOOK_BODIES.find(([t]) => t === title)[1];
    assert.ok(text.includes(from), `${title} holds ${from}`);
    return { [title]: text.replace(from, to) };
}

test("a complete playbook has no finding, and the finding format is <file>: [<rule>] <message>", async () => {
    assert.deepEqual(await lintSpecs([{}]), []);
    assert.equal(formatPlaybookFinding({ severity: "error", rule: "slot-unknown", file: "a.md", service: "a", message: "m" }), "a.md: [slot-unknown] m");
});

test("lintPlaybooks needs today as a date", async () => {
    const loaded = await readPlaybooks(writePlaybooks([{}]));
    assert.throws(() => lintPlaybooks(loaded, {}), /today as YYYY-MM-DD/);
    assert.throws(() => lintPlaybooks(loaded, { today: "2026-13-01" }), /today as YYYY-MM-DD/);
});

test("unreadable-file", async () => {
    const dir = writePlaybookDir({});
    mkdirSync(path.join(dir, "folder.md"));
    const findings = await lintDir(dir);
    assert.deepEqual(findings.map((f) => [f.severity, f.rule, f.file, f.service]), [["error", "unreadable-file", "folder.md", null]]);
    assert.match(findings[0].message, /^cannot read the file: /);
});

test("front-matter-missing", async () => {
    assert.deepEqual(brief(await lintFiles({ "notes.md": "# notes\n" })), [["error", "front-matter-missing", "the file has no front matter (a leading --- block)"]]);
});

test("front-matter-invalid", async () => {
    const findings = await lintFiles({ "a.md": "---\ntag: { name: app }\n---\n", "b.md": "---\n- a\n---\n" });
    assert.deepEqual(findings.map((f) => [f.rule, f.file]), [["front-matter-invalid", "a.md"], ["front-matter-invalid", "b.md"]]);
    assert.equal(findings[1].message, "front matter must be a mapping of fields");
});

test("field-missing", async () => {
    assert.deepEqual(brief(await lintSpecs([{ omit: ["title", "learn_sources"] }])), [
        ["error", "field-missing", 'missing front matter field "title"'],
        ["error", "field-missing", 'missing front matter field "learn_sources"'],
    ]);
});

test("field-invalid", async () => {
    const findings = await lintSpecs([{
        file: "test-service.md",
        service: "Test_Service",
        title: "",
        arm_types: ["Microsoft.Test/Widgets"],
        version: 0,
        verified_on: "2026-02-30",
        extra: { owner: "someone" },
    }]);
    assert.deepEqual(brief(findings.filter((f) => f.rule === "field-invalid")), [
        ["error", "field-invalid", 'unknown front matter field "owner"; the fields are service, title, arm_types, slot, version, verified_on, learn_sources'],
        ["error", "field-invalid", 'service "Test_Service" must be a kebab-case slug such as key-vault'],
        ["error", "field-invalid", "title must be a non-empty string"],
        ["error", "field-invalid", "arm_types must be a non-empty list of lowercase ARM types such as microsoft.keyvault/vaults"],
        ["error", "field-invalid", "version 0 must be an integer of at least 1"],
        ["error", "field-invalid", 'verified_on "2026-02-30" must be a date as YYYY-MM-DD'],
    ]);
    const lists = await lintSpecs([{ arm_types: ["microsoft.test/a", "microsoft.test/a"], learn_sources: [FIXTURE_SOURCE, FIXTURE_SOURCE], slot: "" }]);
    assert.deepEqual(brief(lists), [
        ["error", "field-invalid", "arm_types lists a type twice"],
        ["error", "field-invalid", "slot must be a slot id such as secrets-keys"],
        ["error", "field-invalid", "learn_sources lists a URL twice"],
    ]);
});

test("file-name", async () => {
    assert.deepEqual(brief(await lintSpecs([{ service: "key-vault", file: "keyvault.md" }])), [["error", "file-name", "service key-vault must equal the file name keyvault"]]);
});

test("service-duplicate", async () => {
    const findings = await lintSpecs([
        { service: "dup", file: "a.md", arm_types: ["microsoft.test/a"] },
        { service: "dup", file: "b.md", arm_types: ["microsoft.test/b"] },
    ]);
    assert.deepEqual(findings.filter((f) => f.rule === "service-duplicate").map((f) => [f.file, f.message]), [["b.md", "service dup is already used by a.md"]]);
});

test("slot-unknown", async () => {
    assert.deepEqual(brief(await lintSpecs([{ slot: "teleport" }])), [["error", "slot-unknown", 'slot "teleport" is not a slot id (see patterns/README.md)']]);
});

test("arm-type-duplicate", async () => {
    const findings = await lintSpecs([
        { service: "alpha", arm_types: ["microsoft.test/shared"] },
        { service: "beta", arm_types: ["microsoft.test/shared", "microsoft.test/beta"] },
    ]);
    assert.deepEqual(findings.map((f) => [f.rule, f.file, f.service, f.message]), [
        ["arm-type-duplicate", "beta.md", "beta", "ARM type microsoft.test/shared is already covered by alpha.md"],
    ]);
});

test("section-missing", async () => {
    assert.deepEqual(brief(await lintSpecs([{ sections: { Constraints: null } }])), [["error", "section-missing", 'missing section "## Constraints"']]);
});

test("section-order", async () => {
    const swapped = [...PLAYBOOK_BODIES];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    assert.deepEqual(brief(await lintSpecs([{ sections: swapped }])), [
        ["error", "section-order", "sections are out of order; expected Mechanisms, Constraints, Non-paired options, Migration from a paired setup, Failover and failback, Test criteria but found Constraints, Mechanisms, Non-paired options, Migration from a paired setup, Failover and failback, Test criteria"],
    ]);
    const twice = await lintSpecs([{ sections: [...PLAYBOOK_BODIES, ["Test criteria", PLAYBOOK_BODIES[5][1]]] }]);
    assert.deepEqual(twice.map((f) => f.rule), ["section-order"]);
    assert.match(twice[0].message, /^section "Test criteria" appears twice \(line \d+\)$/);
});

test("section-unknown", async () => {
    const findings = await lintSpecs([{ sections: [...PLAYBOOK_BODIES, ["Notes", "extra"]] }]);
    assert.deepEqual(findings.map((f) => [f.severity, f.rule]), [["error", "section-unknown"]]);
    assert.match(findings[0].message, /^unknown section "Notes" \(line \d+\); the sections are Mechanisms, /);
});

test("mechanism-field", async () => {
    const findings = await lintSpecs([{
        sections: swap("Mechanisms", "- Failover: customer-managed\n- Estimated RPO: 5m (fixture value)", "- Failover: automatic\n- Estimated RPO: soon\n- Notes: x"),
    }]);
    assert.deepEqual(brief(findings), [
        ["error", "mechanism-field", 'mechanism "Test geo-replication" has the unknown field "Notes"; the fields are Replicates, Paired, Nonpaired, Failover, Estimated RPO, Estimated RTO, Source'],
        ["error", "mechanism-field", 'mechanism "Test geo-replication": Failover must be one of Microsoft-managed, customer-managed, manual, not applicable'],
        ["error", "mechanism-field", 'mechanism "Test geo-replication": Estimated RPO must start with a duration such as 30m or with unknown'],
    ]);
    const empty = await lintSpecs([{ sections: { Mechanisms: "No mechanism." } }]);
    assert.deepEqual(brief(empty).slice(0, 1), [["error", "mechanism-field", "the Mechanisms section has no mechanism (### <mechanism name>)"]]);
});

test("constraint-source", async () => {
    const findings = await lintSpecs([{ sections: swap("Constraints", `- Source: ${FIXTURE_SOURCE}`, "") }]);
    assert.deepEqual(brief(findings), [["error", "constraint-source", 'constraint "Restores stay in the geography" has no "- Source: <url>" line']]);
});

test("option-id", async () => {
    const findings = await lintSpecs([{
        sections: swap("Non-paired options", "### pair-split: Recover into the pair", "### Pair_Split: Recover into the pair"),
    }]);
    assert.deepEqual(brief(findings).filter(([, rule]) => rule === "option-id"), [["error", "option-id", 'option id "Pair_Split" must be a kebab-case slug']]);
    const reserved = await lintSpecs([{ sections: swap("Non-paired options", "### pair-split: Recover into the pair", "### accept-gap: Accept it") }]);
    assert.ok(brief(reserved).some(([, rule, message]) => rule === "option-id" && message === 'option id "accept-gap" is reserved for accepting the gap'));
    const twice = await lintSpecs([{ sections: swap("Non-paired options", "### pair-split: Recover into the pair", "### second-copy: Again") }]);
    assert.ok(brief(twice).some(([, rule, message]) => rule === "option-id" && message === 'option id "second-copy" appears twice'));
    const noTitle = await lintSpecs([{ sections: swap("Non-paired options", "### pair-split: Recover into the pair", "### pair-split") }]);
    assert.ok(brief(noTitle).some(([, rule, message]) => rule === "option-id" && message === 'option heading "pair-split" must be "<option id>: <option title>"'));
});

test("option-field", async () => {
    const findings = await lintSpecs([{ sections: swap("Non-paired options", "- Cost notes: a second instance; no price.\n", "- Cost notes:\n- Gives up: twice\n") }]);
    assert.deepEqual(brief(findings), [
        ["error", "option-field", 'option "second-copy" has an empty "Cost notes" field'],
        ["error", "option-field", 'option "second-copy" has the field "Gives up" twice'],
    ]);
});

test("option-kind", async () => {
    const findings = await lintSpecs([{ sections: swap("Non-paired options", "- Kind: workaround", "- Kind: magic") }]);
    assert.deepEqual(brief(findings), [["error", "option-kind", 'option "second-copy": Kind "magic" must be one of native, workaround, split-region, backup-restore']]);
});

test("option-target", async () => {
    const unknown = await lintSpecs([{ sections: swap("Non-paired options", "- Target: dr-region", "- Target: anywhere") }]);
    assert.deepEqual(brief(unknown), [["error", "option-target", 'option "second-copy": Target "anywhere" must be one of dr-region, pair-region']]);
    const split = await lintSpecs([{ sections: swap("Non-paired options", "- Target: pair-region", "- Target: dr-region") }]);
    assert.deepEqual(brief(split), [["error", "option-target", 'option "pair-split": a split-region option targets pair-region']]);
    const other = await lintSpecs([{ sections: swap("Non-paired options", "- Target: dr-region", "- Target: pair-region") }]);
    assert.deepEqual(brief(other), [["error", "option-target", 'option "second-copy": a workaround option targets dr-region']]);
});

test("option-mechanism", async () => {
    const findings = await lintSpecs([{ sections: swap("Non-paired options", "- Uses mechanism: Test geo-replication", "- Uses mechanism: Teleport") }]);
    assert.deepEqual(brief(findings), [["error", "option-mechanism", 'option "pair-split": Uses mechanism "Teleport" is not a mechanism of this playbook (or none)']]);
    const anyCase = await lintSpecs([{ sections: swap("Non-paired options", "- Uses mechanism: Test geo-replication", "- Uses mechanism: test GEO-replication") }]);
    assert.deepEqual(anyCase, []);
});

test("option-estimate", async () => {
    const findings = await lintSpecs([{ sections: swap("Non-paired options", "- Estimated RTO: 4h (fixture value)", "- Estimated RTO: a few hours") }]);
    assert.deepEqual(brief(findings), [["error", "option-estimate", 'option "pair-split": Estimated RTO must start with a duration such as 30m or with unknown']]);
});

test("option-untested", async () => {
    const findings = await lintSpecs([{ sections: swap("Test criteria", "- Applies to: pair-split", "- Applies to: second-copy") }]);
    assert.deepEqual(brief(findings), [["error", "option-untested", 'option "pair-split" is in the Applies to of no test criterion']]);
});

test("part-missing", async () => {
    const findings = await lintSpecs([{ sections: swap("Migration from a paired setup", "### Validate\n1. Run TC-1.\n", "### Validate\nRun the criteria.\n") }]);
    assert.deepEqual(brief(findings), [["error", "part-missing", 'part "### Validate" needs a numbered list (1. <step>)']]);
    const gone = await lintSpecs([{ sections: swap("Migration from a paired setup", "### Keep until cut-over\nThe replica in the pair.", "") }]);
    assert.deepEqual(brief(gone), [["error", "part-missing", 'missing part "### Keep until cut-over" in Migration from a paired setup']]);
});

test("steps-table", async () => {
    const header = await lintSpecs([{ sections: swap("Failover and failback", "| # | Step | Role | Estimated duration | Verification | Abort condition |\n|---|---|---|---|---|---|\n| 1 | Switch to", "| # | Step | Owner | Estimated duration | Verification | Abort condition |\n|---|---|---|---|---|---|\n| 1 | Switch to") }]);
    assert.deepEqual(brief(header), [["error", "steps-table", "the Failover table must have exactly the header | # | Step | Role | Estimated duration | Verification | Abort condition |"]]);
    const cell = await lintSpecs([{ sections: swap("Failover and failback", "| Platform engineer | Estimated 10m | The application reads from it | The second", "|  | 10m | The application reads from it | The second") }]);
    assert.deepEqual(brief(cell), [
        ["error", "steps-table", 'the Failover table, row 1: the cell "Role" is empty'],
        ["error", "steps-table", "the Failover table, row 1: the Estimated duration must start with the word Estimated"],
    ]);
    const missing = await lintSpecs([{ sections: { "Failover and failback": PLAYBOOK_BODIES[4][1].split("### Failback")[0] } }]);
    assert.deepEqual(brief(missing), [["error", "steps-table", 'missing part "### Failback" in Failover and failback']]);
});

test("test-field", async () => {
    const findings = await lintSpecs([{ sections: swap("Test criteria", "- Evidence: the job log.\n", "") }]);
    assert.deepEqual(brief(findings), [["error", "test-field", 'test criterion "TC-1" has no "Evidence" field']]);
});

test("test-option", async () => {
    const findings = await lintSpecs([{ sections: swap("Test criteria", "- Applies to: pair-split", "- Applies to: pair-split, teleport") }]);
    assert.deepEqual(brief(findings), [["error", "test-option", 'TC-2: Applies to names "teleport", which is not an option of this playbook']]);
});

test("test-numbering", async () => {
    const gap = await lintSpecs([{ sections: swap("Test criteria", "### TC-2: The pair is reachable", "### TC-3: The pair is reachable") }]);
    assert.deepEqual(brief(gap), [["error", "test-numbering", "TC-3 is criterion 2; number the criteria 1, 2, 3 without gaps"]]);
    const bad = await lintSpecs([{ sections: swap("Test criteria", "### TC-2: The pair is reachable", "### Second test") }]);
    assert.deepEqual(brief(bad), [["error", "test-numbering", 'test criterion heading "Second test" must be "TC-<n>: <title>"']]);
});

test("source-not-learn", async () => {
    const findings = await lintSpecs([{
        learn_sources: [FIXTURE_SOURCE, "https://example.com/dr"],
        sections: swap("Constraints", `- Source: ${FIXTURE_SOURCE}`, "- Source: https://example.com/dr"),
    }]);
    assert.deepEqual(brief(findings), [
        ["error", "source-not-learn", "learn_sources entry https://example.com/dr must be one URL that starts with https://learn.microsoft.com/"],
        ["error", "source-not-learn", 'constraint "Restores stay in the geography": Source https://example.com/dr must be one URL that starts with https://learn.microsoft.com/'],
    ]);
});

test("source-unlisted, and a fragment is compared without it", async () => {
    const other = "https://learn.microsoft.com/en-us/azure/reliability/reliability-other";
    const findings = await lintSpecs([{ sections: swap("Constraints", `- Source: ${FIXTURE_SOURCE}`, `- Source: ${other}`) }]);
    assert.deepEqual(brief(findings), [["error", "source-unlisted", `constraint "Restores stay in the geography": Source ${other} is not in learn_sources`]]);
    const fragment = await lintSpecs([{ sections: swap("Constraints", `- Source: ${FIXTURE_SOURCE}`, `- Source: ${FIXTURE_SOURCE}#backup`) }]);
    assert.deepEqual(fragment, []);
});

test("secret: the message names the place, never the value", async () => {
    const value = ["Account", "Key=", "abc123"].join("");
    const findings = await lintSpecs([{ sections: swap("Non-paired options", "- Prerequisites: a second instance in the DR region.", `- Prerequisites: ${value}`) }]);
    assert.deepEqual(brief(findings), [["error", "secret", 'secret-like text in section "Non-paired options": a playbook holds generic Azure know-how only']]);
    assert.equal(JSON.stringify(findings).includes(value), false);
    const cell = ["Pass", "word=", "fixture-value-2"].join("");
    const inTable = await lintSpecs([{ sections: swap("Failover and failback", "| Switch to the second instance |", `| ${cell} |`) }]);
    assert.deepEqual(inTable.map((f) => f.rule), ["secret"]);
    const front = await lintSpecs([{ title: ["Shared", "AccessSignature=", "x"].join("") }]);
    assert.deepEqual(brief(front), [["error", "secret", "secret-like text in front matter title: a playbook holds generic Azure know-how only"]]);
});

test("step-number: a cross-reference to a step by its number is refused, a reference by what the step does is not", async () => {
    const message = (section, ref) => ["error", "step-number", `section "${section}": "${ref}" refers to a step by its number; the guide and the runbook drop the steps of other options and renumber the rest, so name the step by its part and what it does`];
    const build = await lintSpecs([{ sections: swap("Migration from a paired setup", "### Validate\n1. Run TC-1.", "### Validate\n1. Run TC-1 on the instance of Build step 1.\n2. Repeat steps 1 and 2 of Failover, then Cut over 1.") }]);
    assert.deepEqual(brief(build), [
        message("Migration from a paired setup", "Build step 1"),
        message("Migration from a paired setup", "steps 1 and 2"),
        message("Migration from a paired setup", "Cut over 1"),
    ]);
    const table = await lintSpecs([{ sections: swap("Failover and failback", "| Switch to the second instance |", "| Switch to the second instance; if it fails, go to step 1 |") }]);
    assert.deepEqual(brief(table), [message("Failover and failback", "step 1")]);
    const criteria = await lintSpecs([{ sections: swap("Test criteria", "- Pass condition: the copy lag stays below the Estimated RPO for 7 days.", "- Pass condition: Failback 1 leaves the copy lag below the Estimated RPO for 7 days.") }]);
    assert.deepEqual(brief(criteria), [message("Test criteria", "Failback 1")]);
    const words = await lintSpecs([{ sections: swap("Migration from a paired setup", "### Validate\n1. Run TC-1.", "### Validate\n1. Run TC-1 on the instance that the Build step \"Create the second instance\" created, every 5 minutes for 2 days, at Tier 1.") }]);
    assert.deepEqual(words, []);
});

test("option-text: an unlabelled step that names some but not all options is refused; a label or every option passes", async () => {
    const build = await lintSpecs([{ sections: swap("Migration from a paired setup", "1. Create the second instance in the DR region.", "1. Create the second instance in the DR region, and for pair-split a reader in the pair.") }]);
    assert.deepEqual(brief(build), [["error", "option-text", 'Build step 1 names pair-split but carries no option label: write it once per option it applies to, each copy starting with "<option id>: ", or word it for every option']]);
    const row = await lintSpecs([{ sections: swap("Failover and failback", "| The second instance is not reachable |", "| The second instance of second-copy is not reachable |") }]);
    assert.deepEqual(brief(row), [["error", "option-text", 'Failover row 1 names second-copy but carries no option label: write it once per option it applies to, each copy starting with "<option id>: ", or word it for every option']]);
    const pair = await lintSpecs([{ sections: swap("Migration from a paired setup", "### Validate\n1. Run TC-1.", "### Validate\n1. second-copy, pair-split: run TC-1.") }]);
    assert.deepEqual(brief(pair), [], "a step that names every option applies to every option");
    const labelled = await lintSpecs([{ sections: swap("Migration from a paired setup", "### Cut over\n1. Point", "### Cut over\n1. pair-split: keep the reader of second-copy.\n2. Point") }]);
    assert.deepEqual(labelled, [], "a labelled step may name another option");
});

test("verified-stale is a warning after 90 days", async () => {
    assert.deepEqual(await lintSpecs([{ verified_on: "2026-08-11" }]), []);
    const findings = await lintSpecs([{ verified_on: "2026-08-10" }]);
    assert.deepEqual(brief(findings), [["warning", "verified-stale", "verified_on 2026-08-10 is 91 days before 2026-11-09; re-verify the playbook against Learn"]]);
});

test("every finding carries severity, rule, file, service and message", async () => {
    const findings = await lintSpecs([{ slot: "teleport" }]);
    assert.deepEqual(findings, [{ severity: "error", rule: "slot-unknown", file: "test-service.md", service: "test-service", message: 'slot "teleport" is not a slot id (see patterns/README.md)' }]);
    assert.equal(playbookMarkdown().includes("teleport"), false);
});
