import assert from "node:assert/strict";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import {
    RUNBOOK_MARKERS, TEST_PLAN_HEADER, checkGuide, guideSkeleton, injectBetween, injectGuideTables, parseGuide, testPlanTable,
} from "../../skills/azure-dr-assessment/scripts/lib/guide.mjs";
import { GADGETS, NATIVES, NICS, WIDGETS } from "../helpers/dr-options-fixture.mjs";
import { MINI_TEMPLATE, PLAYBOOKS, choice, fillGuide, fixtureDoc } from "../helpers/guide-fixture.mjs";

const DOC = fixtureDoc({ choices: [choice(WIDGETS, "second-copy")] });
/** The skeleton with every fill marker replaced and a criterion in each empty Validate table, as the model leaves it, and its test plan built. */
function filledGuide(doc = DOC) {
    const { text } = guideSkeleton({ doc, playbooks: PLAYBOOKS, template: MINI_TEMPLATE });
    return injectGuideTables(fillGuide(text)).text;
}
const GUIDE = filledGuide();
const PLAN = [
    "| Service | Criterion | Pass condition | Frequency | Owner role |",
    "|---|---|---|---|---|",
    "| Test Native | TC-1: The replica is current | the replication lag stays below the Estimated RPO for 7 days. | monthly | Platform engineer |",
    "| Test Service | TC-1: The second copy is current | the copy lag stays below the Estimated RPO for 7 days. | monthly | Platform engineer |",
    "| Gadgets | The copy is current | the copy lag stays below the Estimated RPO for 7 days | monthly | Platform engineer |",
    "| Network Interface | Gap recorded | The type is listed in report section D as a documented exception (owner's choice) or as an open decision (default) | Each assessment run | Platform engineer |",
].join("\n");

test("parseGuide reads the chapters, their parts and their Validate rows, and ignores headings in code fences", () => {
    const fenced = GUIDE.replace("### Open inputs", "```text\n## Chapter 9: Fake (microsoft.fake/type)\n### Build\n```\n\n### Open inputs");
    const chapters = parseGuide(fenced);
    assert.deepEqual(chapters.map((c) => [c.n, c.title, c.type]), [[1, "Test Native", NATIVES], [2, "Test Service", WIDGETS], [3, "Gadgets", GADGETS], [4, "Network Interface", NICS]]);
    const validate = chapters[1].parts.find((p) => p.name === "Validate");
    assert.deepEqual(validate.header, ["Criterion", "Pass condition", "How to measure", "Evidence", "Frequency", "Owner role"]);
    assert.deepEqual(validate.rows.map((r) => r.cells), [["TC-1: The second copy is current", "the copy lag stays below the Estimated RPO for 7 days.", "compare the copy job's timestamps.", "the job log.", "monthly", "Platform engineer"]]);
    assert.deepEqual(chapters[2].parts.find((p) => p.name === "Validate").rows.map((r) => r.cells[0]), ["The copy is current"]);
    const piped = parseGuide(GUIDE.replace("| the job log. |", "| the job log \\| the export |"));
    assert.equal(piped[1].parts.find((p) => p.name === "Validate").rows[0].cells[3], "the job log | the export");
});

test("testPlanTable has one row per Validate row in chapter order, and injectGuideTables puts it between its markers", () => {
    assert.deepEqual(TEST_PLAN_HEADER, ["Service", "Criterion", "Pass condition", "Frequency", "Owner role"]);
    assert.equal(testPlanTable(parseGuide(GUIDE)), PLAN);
    assert.ok(GUIDE.includes(`<!-- dr-guide:test-plan -->\n${PLAN}\n<!-- /dr-guide:test-plan -->`));
    const again = injectGuideTables(GUIDE);
    assert.deepEqual([again.text, again.criteria], [GUIDE, 4], "rebuilding gives the same text");
    assert.equal(testPlanTable([]), "| Service | Criterion | Pass condition | Frequency | Owner role |\n|---|---|---|---|---|");
});

test("a missing marker pair is refused with exit 2 and nothing is built", () => {
    for (const broken of [GUIDE.replace("<!-- /dr-guide:test-plan -->", ""), GUIDE.replace("<!-- dr-guide:test-plan -->", "")]) {
        assert.throws(() => injectGuideTables(broken), (err) => err instanceof CliError && err.code === EXIT.INPUT
            && err.message === "the guide is missing its markers, so nothing was written" && err.details[0] === "<!-- dr-guide:test-plan --> ... <!-- /dr-guide:test-plan -->");
    }
    assert.equal(injectBetween(`a\n${RUNBOOK_MARKERS[0]}\nold\n${RUNBOOK_MARKERS[1]}\nb`, RUNBOOK_MARKERS, "new", "runbook"), `a\n${RUNBOOK_MARKERS[0]}\nnew\n${RUNBOOK_MARKERS[1]}\nb`);
    assert.throws(() => injectBetween("a", RUNBOOK_MARKERS, "new", "runbook"), /the runbook is missing its markers, so nothing was written/);
});

test("a complete guide passes the check, also with a commands block that closes a chapter", () => {
    assert.deepEqual(checkGuide(GUIDE, DOC), []);
    const commands = GUIDE.replace("## Chapter 2:", "### Commands (untested, Bicep)\n\n```bicep\nresource vault 'x' = {}\n```\n\n## Chapter 2:");
    assert.deepEqual(checkGuide(commands, DOC), []);
});

const swap = (text, a, b) => text.replace(a, "\u0000").replace(b, a).replace("\u0000", b);
const chapterOf = (text, type) => {
    const start = text.indexOf(`<a id="chapter-${type}"></a>`);
    const next = text.indexOf("<a id=", start + 1);
    return text.slice(start, next < 0 ? text.indexOf("## Consolidated test plan") : next);
};
const REFUSALS = [
    ["a missing chapter", (t) => injectGuideTables(t.replace(chapterOf(t, "microsoft-network-networkinterfaces"), "")).text, ["the chapter of microsoft.network/networkinterfaces is missing"]],
    ["an extra chapter", (t) => injectGuideTables(t.replace("## Consolidated test plan", `${chapterOf(t, "microsoft-network-networkinterfaces").replace(/networkinterfaces/g, "publicips").replace("Chapter 4", "Chapter 5")}## Consolidated test plan`)).text, ["the chapter of microsoft.network/publicips is not a type of evidence/dr-options.json"]],
    ["chapters out of build order", (t) => swap(t, chapterOf(t, "test-native"), chapterOf(t, "test-service")), [
        `the chapters are out of build order; the order is ${NATIVES}, ${WIDGETS}, ${GADGETS}, ${NICS}`,
        `Chapter 2 (${WIDGETS}) is chapter 1: number the chapters 1, 2, 3 in order`,
        `Chapter 1 (${NATIVES}) is chapter 2: number the chapters 1, 2, 3 in order`,
        "the consolidated test plan differs from the Validate rows: run establishment-guide --tables",
    ]],
    ["a missing part", (t) => t.replace(chapterOf(t, "test-service"), chapterOf(t, "test-service").replace("### Cut-over\n\n1. Point the DR configuration at the second instance.\n\n", "")), [`Chapter 2 (${WIDGETS}): the part "Cut-over" is missing`]],
    ["parts out of order", (t) => t.replace("### Today\n\nPlatform engineer\n\n### Target", "### Target\n\nPlatform engineer\n\n### Today"), [`Chapter 1 (${NATIVES}): the parts are out of order; the order is Today, Target, Prerequisites, Build, Validate, Cut-over, Decommission the paired setup, Failover and failback, Open inputs`,
        ...[
            ["Option", "- Option: Replica in the DR region (`geo-replica`): Native, target germanywestcentral."],
            ["Source", "- Source: playbook test-native v1."],
            ["Chosen by", "- Chosen by: Not asked: the native path rests on a Verified mechanism, so the recommendation applies."],
            ["Estimated RPO", "- Estimated RPO: 5s (fixture value). Estimated RTO: 1h (fixture value)."],
            ["Tier 1", "- Tier 1: met by the Estimated RPO and RTO."],
        ].map(([label, line]) => `Chapter 1 (${NATIVES}): the Target line "${label}" is written by establishment-guide and is missing or changed; restore it: ${line}`),
    ]],
    ["an unknown part", (t) => t.replace("### Open inputs\n\nPlatform engineer\n\n<a id=\"chapter-test-service\">", "### Notes\n\nx\n\n### Open inputs\n\nPlatform engineer\n\n<a id=\"chapter-test-service\">"), [`Chapter 1 (${NATIVES}): the part "Notes" is not a part of a chapter (a block "Commands (untested, <form>)" may only close it)`]],
    ["a fill marker left", (t) => t.replace("### Today\n\nPlatform engineer", "### Today\n\n<!-- fill: today -->"), ["line 18: a fill marker is left"]],
    ["a Validate row with an empty cell", (t) => injectGuideTables(t.replace("| the job log. |", "|  |")).text, [`Chapter 2 (${WIDGETS}): Validate row 1 (line 104) needs 6 non-empty cells: Criterion, Pass condition, How to measure, Evidence, Frequency, Owner role`]],
    ["a Validate part without its table", (t) => injectGuideTables(t.replace("| Criterion | Pass condition | How to measure | Evidence | Frequency | Owner role |\n|---|---|---|---|---|---|\n| TC-1: The replica", "| Criterion | Pass | How | Evidence | Frequency | Owner |\n|---|---|---|---|---|---|\n| TC-1: The replica")).text, [`Chapter 1 (${NATIVES}): the Validate part needs the table | Criterion | Pass condition | How to measure | Evidence | Frequency | Owner role |`]],
    ["a Validate table without a row", (t) => injectGuideTables(t.replace("| The copy is current | the copy lag stays below the Estimated RPO for 7 days | compare the copy timestamps | the copy log | monthly | Platform engineer |\n", "")).text, ["chapter 3: Validate has no criterion"]],
    ["a test plan that differs from the Validate rows", (t) => t.replace("| Test Service | TC-1: The second copy is current | the copy lag stays below the Estimated RPO for 7 days. | monthly | Platform engineer |\n", ""), ["the consolidated test plan differs from the Validate rows: run establishment-guide --tables"]],
    ["missing test plan markers", (t) => t.replace("<!-- dr-guide:test-plan -->", ""), ["the consolidated test plan markers are missing: <!-- dr-guide:test-plan --> ... <!-- /dr-guide:test-plan -->"]],
    ["an RPO with a number and no label", (t) => t.replace("### Today\n\nPlatform engineer", "### Today\n\nThe replica gives an RPO of 5 minutes today."), ["line 18: an RPO or RTO with a number is not labelled Estimated or Demonstrated"]],
    ["the banned words", (t) => t.replace("### Today\n\nPlatform engineer", "### Today\n\nThe setup is Compliant and the RTO was achieved; nothing is guaranteed."), [
        'line 18: the word "compliant" is not used: nothing is compliant without a drill record',
        'line 18: the word "achieved" is not used: nothing is achieved without a drill record',
        'line 18: the word "guaranteed" is not used: nothing is guaranteed without a drill record',
    ]],
];

for (const [title, change, expected] of REFUSALS) {
    test(`the check refuses ${title}`, () => {
        const text = change(GUIDE);
        assert.notEqual(text, GUIDE, "the change applies");
        assert.deepEqual(checkGuide(text, DOC), expected);
    });
}

test("labelled times and the words in other forms pass the check", () => {
    const text = GUIDE.replace("### Today\n\nPlatform engineer", "### Today\n\nThe Estimated RPO is 15m and the Demonstrated RTO was 25m in the drill of 2026-10-01. Compliance is the owner's call.");
    assert.deepEqual(checkGuide(text, DOC), []);
});

test("the check refuses a chapter whose script-written Target lines are missing or changed, and names the chapter and the line", () => {
    const at = `Chapter 2 (${WIDGETS})`;
    const lines = [
        "- Option: Second copy in the DR region (`second-copy`): Workaround, target germanywestcentral.",
        "- Source: playbook test-service v1.",
        "- Chosen by: Application owner on 2026-11-09 (the recommendation was second-copy).",
    ];
    const refused = (label, line) => `${at}: the Target line "${label}" is written by establishment-guide and is missing or changed; restore it: ${line}`;
    const prose = GUIDE.replace(lines.join("\n"), "Option second-copy, playbook test-service v1, accepted by the Application owner on 2026-11-09.");
    assert.deepEqual(checkGuide(prose, DOC), [refused("Option", lines[0]), refused("Source", lines[1]), refused("Chosen by", lines[2])]);
    const estimate = "- Estimated RPO: 15m (the copy interval the team sets). Estimated RTO: 30m (the switch-over time the team designs).";
    assert.deepEqual(checkGuide(GUIDE.replace(estimate, "- Estimated RPO: 5m. Estimated RTO: 30m."), DOC), [refused("Estimated RPO", estimate)]);
    const tier = "- Tier 1: met by the Estimated RPO and RTO.\n- Gives up: platform-managed failover.";
    assert.deepEqual(checkGuide(GUIDE.replace(tier, "- Gives up: platform-managed failover."), DOC), [refused("Tier 1", "- Tier 1: met by the Estimated RPO and RTO.")]);
    const moved = GUIDE.replace(`${lines[1]}\n`, "").replace("### Prerequisites\n\nA second instance", `### Prerequisites\n\n${lines[1]}\n\nA second instance`);
    assert.deepEqual(checkGuide(moved, DOC), [refused("Source", lines[1])], "a Target line counts only inside the Target part");
    const added = GUIDE.replace(lines[2], `${lines[2]}\n- Note: the owner confirmed it in the review.`);
    assert.deepEqual(checkGuide(added, DOC), [], "text the model adds next to the script's lines is accepted");
});
