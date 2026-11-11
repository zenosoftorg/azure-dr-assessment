import assert from "node:assert/strict";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import {
    BUILD_ORDER, GUIDE_PARTS, NO_PLAYBOOK_LINE, TEST_PLAN_MARKERS, chapterPlan, checkGuide, fillMarker, guideSkeleton, injectGuideTables, orderTypes, parseGuide, runbookSkeleton,
} from "../../skills/azure-dr-assessment/scripts/lib/guide.mjs";
import { SLOT_IDS } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { defaultPlaybooksDir } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { readPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { FIXTURE_SOURCE, PLAYBOOK_BODIES } from "../helpers/playbook-fixture.mjs";
import { GADGETS, NATIVES, NICS, WIDGETS, WIDGET_PLAYBOOK, fixturePlaybook, standardInputs } from "../helpers/dr-options-fixture.mjs";
import { MINI_TEMPLATE, PLAYBOOKS, choice, fillGuide, fixtureDoc, minimalDoc, playbookRow } from "../helpers/guide-fixture.mjs";

const skeleton = (doc, playbooks = PLAYBOOKS) => guideSkeleton({ doc, playbooks, template: MINI_TEMPLATE });
/** The text of one part of one chapter of a guide. */
function part(text, type, name) {
    const chapter = text.split(new RegExp(`^## Chapter \\d+: .+ \\(${type.replace(/[./]/g, "\\$&")}\\)$`, "m"))[1].split(/^## /m)[0];
    return chapter.split(new RegExp(`^### ${name}$`, "m"))[1].split(/^### |^<a id=/m)[0].trim();
}

test("BUILD_ORDER places every slot of a service and leaves out the slots that hold no service", () => {
    assert.deepEqual(BUILD_ORDER.filter((slot) => !SLOT_IDS.includes(slot)), []);
    assert.deepEqual(SLOT_IDS.filter((slot) => !BUILD_ORDER.includes(slot)), ["objectives", "failover-approval", "testing"]);
    assert.deepEqual([BUILD_ORDER[0], BUILD_ORDER.at(-2), BUILD_ORDER.at(-1)], ["connectivity", "ingress", "traffic-dns"]);
});

test("orderTypes sorts by the build order, puts a null or other slot between ingress and traffic-dns, and keeps the file order within a slot", () => {
    const rows = [
        ["a", "traffic-dns"], ["b", null], ["c", "compute"], ["d", "connectivity"], ["e", "objectives"], ["f", "compute"], ["g", "ingress"], ["h", "secrets-keys"],
    ].map(([type, slot]) => ({ type, slot }));
    assert.deepEqual(orderTypes(rows).map((r) => r.type), ["d", "h", "c", "f", "g", "b", "e", "a"]);
});

test("chapterPlan numbers the chapters in build order and anchors each by its playbook, else by its ARM type, with a suffix on a clash", () => {
    const doc = fixtureDoc();
    assert.deepEqual(chapterPlan(doc).map(({ n, type, anchor, playbook }) => [n, type, anchor, playbook]), [
        [1, NATIVES, "test-native", "test-native v1"],
        [2, WIDGETS, "test-service", "test-service v1"],
        [3, GADGETS, "microsoft-example-gadgets", null],
        [4, NICS, "microsoft-network-networkinterfaces", null],
    ]);
    const twice = { ...doc, types: [...doc.types, { ...doc.types[0], type: "microsoft.test/widgets2" }] };
    assert.deepEqual(chapterPlan(twice).map((c) => c.anchor), ["test-native", "test-service", "microsoft-example-gadgets", "test-service-2", "microsoft-network-networkinterfaces"]);
});

test("the skeleton has the build order, then one chapter per type with its anchor and the nine parts in order, and keeps the test plan markers", () => {
    const { text, chapters } = skeleton(fixtureDoc());
    assert.deepEqual(chapters, [
        { n: 1, type: NATIVES, title: "Test Native", slot: "data-replication.relational", playbook: "test-native v1", anchor: "test-native" },
        { n: 2, type: WIDGETS, title: "Test Service", slot: "compute", playbook: "test-service v1", anchor: "test-service" },
        { n: 3, type: GADGETS, title: "Gadgets", slot: "compute", playbook: null, anchor: "microsoft-example-gadgets" },
        { n: 4, type: NICS, title: "Network Interface", slot: null, playbook: null, anchor: "microsoft-network-networkinterfaces" },
    ]);
    assert.deepEqual([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]), [
        "Build order", "Transition plan",
        `Chapter 1: Test Native (${NATIVES})`, `Chapter 2: Test Service (${WIDGETS})`, `Chapter 3: Gadgets (${GADGETS})`, `Chapter 4: Network Interface (${NICS})`,
        "Consolidated test plan",
    ]);
    for (const anchor of ["test-native", "test-service", "microsoft-example-gadgets"]) assert.ok(text.includes(`<a id="chapter-${anchor}"></a>\n\n## Chapter`), anchor);
    for (const chapter of text.split(/^## Chapter /m).slice(1)) {
        assert.deepEqual([...chapter.split(/^## /m)[0].matchAll(/^### (.+)$/gm)].map((m) => m[1]), GUIDE_PARTS);
    }
    assert.match(text, /^1\. \[Test Native\]\(#chapter-test-native\) \(`microsoft\.test\/natives`\): slot `data-replication\.relational`; Native: Replica in the DR region\.$/m);
    assert.match(text, /^4\. \[Network Interface\]\(#chapter-microsoft-network-networkinterfaces\) \(`microsoft\.network\/networkinterfaces`\): slot `none`; Accept the gap: Accept the gap and record it as an exception\.$/m);
    assert.match(text, /<!-- dr-guide:test-plan -->\n<!-- \/dr-guide:test-plan -->/);
    assert.doesNotMatch(text, /dr-guide:build-order|dr-guide:chapters/);
    assert.equal(text.split(NO_PLAYBOOK_LINE).length - 1, 2, "the two types without a playbook say so");
    assert.ok(text.includes(`## Chapter 3: Gadgets (${GADGETS})\n\n${NO_PLAYBOOK_LINE}\n\n### Today`));
});

test("the Target of a chosen option names it, its source, who chose it, its estimates, the tier fit, its trade-off and residency", () => {
    const text = skeleton(fixtureDoc({ choices: [choice(WIDGETS, "pair-split")] })).text;
    assert.equal(part(text, WIDGETS, "Target"), [
        "- Option: Recover into the pair (`pair-split`): Split-region, target swedensouth.",
        "- Source: playbook test-service v1.",
        "- Chosen by: Application owner on 2026-11-09 (the recommendation was second-copy).",
        "- Estimated RPO: unknown (no figure on Learn). Estimated RTO: 4h (fixture value).",
        "- Tier 1: not met: a Gap that names microsoft.test/widgets and pair-split.",
        "- Gives up: a copy in the DR region.",
        "- Residency: ok.",
        "",
        "<!-- fill: why this option fits the workload, in one or two sentences -->",
    ].join("\n"));
    const native = part(text, NATIVES, "Target");
    assert.match(native, /^- Chosen by: Not asked: the native path rests on a Verified mechanism, so the recommendation applies\.$/m);
    assert.match(native, /^- Tier 1: met by the Estimated RPO and RTO\.$/m);
});

test("without a valid owner choice the Target says Default: a default entry, no entry or an invalid entry", () => {
    const defaulted = skeleton(fixtureDoc({ choices: [choice(WIDGETS, "second-copy", "default", true)] })).text;
    assert.match(part(defaulted, WIDGETS, "Target"), /^- Chosen by: Default: nobody chose, so the recommendation of 2026-11-09 applies\. It is an open decision for the owner\.$/m);
    const none = skeleton(fixtureDoc()).text;
    assert.match(part(none, WIDGETS, "Target"), /^- Option: Second copy in the DR region \(`second-copy`\): Workaround, target germanywestcentral\.$/m);
    assert.match(part(none, WIDGETS, "Target"), /^- Chosen by: Default: no valid choice is recorded, so the recommendation applies\.$/m);
    const invalid = skeleton(fixtureDoc({ choices: [choice(WIDGETS, "third-copy")] })).text;
    assert.match(part(invalid, WIDGETS, "Target"), /^- Chosen by: Default: no valid choice is recorded, so the recommendation applies\. The recorded choice third-copy is invalid: third-copy is not an option of microsoft\.test\/widgets \(options: second-copy, pair-split, accept-gap\)\.$/m);
});

test("a playbook option prefills prerequisites, build, cut-over, decommission and one Validate row per criterion that applies to it", () => {
    const text = skeleton(fixtureDoc({ choices: [choice(WIDGETS, "second-copy")] })).text;
    assert.equal(part(text, WIDGETS, "Prerequisites"), "A second instance in the DR region.");
    assert.equal(part(text, WIDGETS, "Build"), "1. Create the second instance in the DR region.");
    assert.equal(part(text, WIDGETS, "Cut-over"), "1. Point the DR configuration at the second instance.");
    assert.equal(part(text, WIDGETS, "Decommission the paired setup"), "Only after every criterion of Validate has passed.\n\n1. Remove the replica in the pair.\n\nKeep until cut-over: The replica in the pair.");
    assert.equal(part(text, WIDGETS, "Validate"), [
        "1. Run TC-1.",
        "",
        "| Criterion | Pass condition | How to measure | Evidence | Frequency | Owner role |",
        "|---|---|---|---|---|---|",
        "| TC-1: The second copy is current | the copy lag stays below the Estimated RPO for 7 days. | compare the copy job's timestamps. | the job log. | monthly | <!-- fill: owner role --> |",
    ].join("\n"));
    assert.match(part(text, WIDGETS, "Today"), /^<!-- fill: today's DR setup of the 3 resources from the inventory, citing F- ids .* How to recognise it: The inventory shows a replica in the pair\. -->$/);
    assert.equal(part(text, WIDGETS, "Failover and failback"), "See [subsection 2 of section 3 of the recovery runbook](recovery-runbook.md#runbook-test-service).\n\n<!-- fill: a summary of the failover and failback of this service -->");
    assert.match(part(text, WIDGETS, "Open inputs"), /^<!-- fill: [^\n]+ -->$/);
});

/** Migration lists labelled per option, in the grammar of the playbooks README. */
const LABELLED_MIGRATION = [
    "### Recognise today's setup", "The inventory shows a replica in the pair.", "",
    "### Build", "1. All options: check the quota first.", "2. second-copy: create the second instance in the DR region.", "3. pair-split: build nothing in the service.", "",
    "### Validate", "1. second-copy: run TC-1 daily for 7 days.", "2. pair-split: run TC-2 in every drill.", "3. A time that a drill measured is Demonstrated.", "",
    "### Cut over", "1. pair-split: read from the pair.", "2. second-copy: point the DR configuration at the second instance.", "",
    "### Decommission", "1. second-copy: remove the replica in the pair.", "2. pair-split: keep the replica in the pair.", "3. Close the change record.", "",
    "### Keep until cut-over", "The replica in the pair.",
].join("\n");
/** The fixture playbooks with the widget playbook's migration replaced. */
const withMigration = (migration) => new Map(PLAYBOOKS).set("test-service", fixturePlaybook({
    ...WIDGET_PLAYBOOK, sections: { ...Object.fromEntries(PLAYBOOK_BODIES), "Migration from a paired setup": migration },
}));

test("a split-region target takes the playbook's own split steps, and asks for the cross-region path and the residency result after Build", () => {
    const text = skeleton(fixtureDoc({ choices: [choice(WIDGETS, "pair-split")] }), withMigration(LABELLED_MIGRATION)).text;
    assert.equal(part(text, WIDGETS, "Build"), [
        "1. All options: check the quota first.",
        "2. Build nothing in the service.",
        "",
        "<!-- fill: the network path from the consumers in germanywestcentral to the service in swedensouth, and the residency result of reading across regions -->",
    ].join("\n"));
    assert.equal(part(text, WIDGETS, "Cut-over"), "1. Read from the pair.");
    assert.equal(part(text, WIDGETS, "Decommission the paired setup"), "Only after every criterion of Validate has passed.\n\n1. Keep the replica in the pair.\n2. Close the change record.\n\nKeep until cut-over: The replica in the pair.");
    assert.equal(part(text, WIDGETS, "Prerequisites"), "A network path from the DR region to the pair.");
    assert.match(part(text, WIDGETS, "Validate"), /\| TC-2: The pair is reachable \|/);
    assert.doesNotMatch(part(text, WIDGETS, "Validate"), /TC-1/);
});

test("a migration list that is empty after filtering gets a fill marker: the cross-region steps of a split, what to remove otherwise", () => {
    const sparse = LABELLED_MIGRATION
        .replace("1. pair-split: read from the pair.\n2. second-copy: point", "1. second-copy: point")
        .replace("1. second-copy: remove the replica in the pair.\n2. pair-split: keep the replica in the pair.\n3. Close the change record.", "1. pair-split: keep the replica in the pair.");
    const playbooks = withMigration(sparse);
    const split = skeleton(fixtureDoc({ choices: [choice(WIDGETS, "pair-split")] }), playbooks).text;
    assert.equal(part(split, WIDGETS, "Cut-over"), "<!-- fill: the cut-over steps: the split-region option keeps the paired setup of this service, so write the cross-region steps (the network path from germanywestcentral to swedensouth and the residency check) -->");
    assert.equal(part(split, WIDGETS, "Decommission the paired setup"), "Only after every criterion of Validate has passed.\n\n1. Keep the replica in the pair.\n\nKeep until cut-over: The replica in the pair.");
    const copy = skeleton(fixtureDoc({ choices: [choice(WIDGETS, "second-copy")] }), playbooks).text;
    assert.equal(part(copy, WIDGETS, "Decommission the paired setup"), "Only after every criterion of Validate has passed.\n\n<!-- fill: what to remove of the paired setup, if anything -->\n\nKeep until cut-over: The replica in the pair.");
});

test("the Validate part opens with the playbook's validate procedure of the option, numbered, above the criteria table", () => {
    const playbooks = withMigration(LABELLED_MIGRATION);
    const split = part(skeleton(fixtureDoc({ choices: [choice(WIDGETS, "pair-split")] }), playbooks).text, WIDGETS, "Validate");
    assert.ok(split.startsWith("1. Run TC-2 in every drill.\n2. A time that a drill measured is Demonstrated.\n\n| Criterion | Pass condition |"), split);
    const copy = part(skeleton(fixtureDoc({ choices: [choice(WIDGETS, "second-copy")] }), playbooks).text, WIDGETS, "Validate");
    assert.ok(copy.startsWith("1. Run TC-1 daily for 7 days.\n2. A time that a drill measured is Demonstrated.\n\n| Criterion |"), copy);
    const doc = fixtureDoc({ choices: [choice(WIDGETS, "second-copy")] });
    const chapters = parseGuide(skeleton(doc, playbooks).text);
    assert.deepEqual(chapters.find((c) => c.type === WIDGETS).parts.find((p) => p.name === "Validate").rows.map((r) => r.cells[0]), ["TC-1: The second copy is current"]);
});

test("an accept-gap target builds nothing, keeps today's paired setup and has one Validate row that the gap is recorded", () => {
    const text = skeleton(fixtureDoc({ choices: [choice(WIDGETS, "accept-gap")] })).text;
    for (const type of [WIDGETS, NICS]) {
        assert.equal(part(text, type, "Prerequisites"), "None.", type);
        assert.equal(part(text, type, "Build"), "None: the gap is accepted, nothing is built in the DR region.", type);
        assert.equal(part(text, type, "Cut-over"), "None: nothing moves.", type);
        assert.equal(part(text, type, "Decommission the paired setup"), "Keep today's paired setup: it stays the only recovery path of this type.", type);
        assert.equal(part(text, type, "Validate"), [
            "| Criterion | Pass condition | How to measure | Evidence | Frequency | Owner role |",
            "|---|---|---|---|---|---|",
            "| Gap recorded | The type is listed in report section D as a documented exception (owner's choice) or as an open decision (default) | Read report sections 2 and D | The report | Each assessment run | <!-- fill: owner role --> |",
        ].join("\n"), type);
        assert.match(part(text, type, "Today"), /^<!-- fill: today's DR setup/, type);
    }
    assert.match(part(text, WIDGETS, "Target"), /^- Option: Accept the gap and record it as an exception \(`accept-gap`\): Accept the gap, target none\.$/m);
    assert.match(part(text, NICS, "Target"), /^<!-- fill: the target: .*\(accept-gap, Accept the gap\)/);
    const filled = injectGuideTables(fillGuide(text)).text;
    assert.deepEqual(checkGuide(filled, fixtureDoc({ choices: [choice(WIDGETS, "accept-gap")] })), [], "the accept-gap text passes the check");
});

test("a type without a playbook gets fill markers in every part, the Target marker naming the Learn option, and an empty Validate table", () => {
    const text = skeleton(fixtureDoc({ choices: [choice(GADGETS, "gadget-copy", "default", true)] })).text;
    assert.equal(part(text, GADGETS, "Target"), "<!-- fill: the target: Copy to a second gadget (gadget-copy, Workaround) from Microsoft Learn this run (R-0009); chosen by: Default: nobody chose, so the recommendation of 2026-11-09 applies. It is an open decision for the owner. Give the Estimated RPO (30m) and RTO (1h), the tier fit, what it gives up and why it fits; write Unknown for what Learn does not support -->");
    assert.match(part(text, NICS, "Target"), /\(accept-gap, Accept the gap\) from rule: every type can accept the gap; .* Say that the type stays an Unmet requirement and what that leaves uncovered -->$/);
    for (const name of GUIDE_PARTS.filter((n) => n !== "Validate" && n !== "Failover and failback")) assert.match(part(text, GADGETS, name), /^<!-- fill: [^\n]+ -->$/, name);
    assert.equal(part(text, GADGETS, "Failover and failback"), "See [subsection 3 of section 3 of the recovery runbook](recovery-runbook.md#runbook-microsoft-example-gadgets).\n\n<!-- fill: a summary of the failover and failback of this service -->");
    assert.match(part(text, GADGETS, "Validate"), /^<!-- fill: one row per test criterion[^\n]+ -->\n\n\| Criterion \| Pass condition \| How to measure \| Evidence \| Frequency \| Owner role \|\n\|---\|---\|---\|---\|---\|---\|$/);
});

test("the Target shows the stale claims of the row: Learn read in the run wins over the playbook", () => {
    const inputs = standardInputs();
    inputs[5] = { ...inputs[5], class: "any-pair" };
    inputs[6] = { ...inputs[6], result: { ...inputs[6].result, agrees: false }, quote: "Learn says a restore can cross the geography" };
    const target = part(skeleton(fixtureDoc({ inputs })).text, WIDGETS, "Target");
    assert.match(target, /^- Playbook claim stale: Test geo-replication\. Learn read on 2026-11-09 says Any-pair; the playbook says Paired: yes, Nonpaired: no \(R-0005\)\. Learn wins\.$/m);
    assert.match(target, /^- Playbook claim stale: Restores stay in the geography\. Learn read on 2026-11-09 says Learn says a restore can cross the geography; the playbook says A restore works only within the same geography \(R-0006\)\. Learn wins\.$/m);
});

test("a type that a pattern decides points at the pattern and leaves the steps to the model", () => {
    const doc = fixtureDoc();
    doc.types = doc.types.map((row) => (row.type === WIDGETS ? { ...row, decidedBy: { source: "pattern", ref: "DR-TEST-001 v1" }, ask: false } : row));
    const text = skeleton(doc).text;
    assert.equal(part(text, WIDGETS, "Target"), "- Decided by DR-TEST-001 v1 (pattern): it governs this slot, see report section D.\n\n<!-- fill: the target that DR-TEST-001 v1 gives this type, and why -->");
    for (const name of ["Prerequisites", "Build", "Cut-over"]) assert.match(part(text, WIDGETS, name), /^<!-- fill: [^\n]+ -->$/, name);
    assert.match(text, /^2\. \[Test Service\]\(#chapter-test-service\) \(`microsoft\.test\/widgets`\): slot `compute`; decided by DR-TEST-001 v1\.$/m);
});

test("a playbook that the folder does not hold in the classified version, and a template without its slots, are refused with exit 2", () => {
    const other = new Map(PLAYBOOKS);
    other.set("test-service", { ...PLAYBOOKS.get("test-service"), version: 2 });
    const refused = (fn, message) => assert.throws(fn, (err) => err instanceof CliError && err.code === EXIT.INPUT && message.test(err.message) && err.details.length > 0);
    refused(() => skeleton(fixtureDoc(), other), /classified with other playbooks than this folder holds/);
    refused(() => runbookSkeleton({ doc: fixtureDoc(), playbooks: new Map() }), /classified with other playbooks/);
    refused(() => guideSkeleton({ doc: fixtureDoc(), playbooks: PLAYBOOKS, template: "# Guide\n" }), /the guide template is missing a generator slot/);
});

test("fillMarker never closes its comment early", () => {
    assert.equal(fillMarker("a --> b\n c"), "<!-- fill: a -> b c -->");
});

test("the runbook skeleton has one subsection per chapter with the playbook's rows of the chosen option, the split row, and fill rows without a playbook", () => {
    const failover = [
        "### Failover",
        "| # | Step | Role | Estimated duration | Verification | Abort condition |",
        "|---|---|---|---|---|---|",
        "| 1 | Declare DR | Incident manager | Estimated: measured in the first drill | The declaration is recorded | The primary answers again |",
        "| 2 | second-copy: switch to the second instance | Platform engineer | Estimated 10m | The application reads from it | The second instance is not reachable |",
        "| 3 | pair-split: wait for the failover to the pair | Platform engineer | Estimated 4h | The service answers in the pair | Microsoft does not fail over |",
        "",
        "### Failback",
        "| # | Step | Role | Estimated duration | Verification | Abort condition |",
        "|---|---|---|---|---|---|",
        "| 1 | pair-split: move the consumers back | Platform engineer | Estimated: unknown | A write succeeds | Writes still fail |",
    ].join("\n");
    const sections = Object.fromEntries(PLAYBOOK_BODIES);
    const prefixed = fixturePlaybook({ ...WIDGET_PLAYBOOK, sections: { ...sections, "Failover and failback": failover } });
    assert.equal(prefixed.learnSources[0], FIXTURE_SOURCE);
    const playbooks = new Map(PLAYBOOKS).set("test-service", prefixed);

    const split = runbookSkeleton({ doc: fixtureDoc({ choices: [choice(WIDGETS, "pair-split")] }), playbooks });
    assert.equal(split.services, 4);
    const widgets = split.text.split(/^<a id="runbook-/m).find((block) => block.startsWith("test-service\"></a>\n### 2. Test Service"));
    assert.equal(widgets.trim(), [
        "test-service\"></a>",
        "### 2. Test Service",
        "",
        "Target: Recover into the pair (`pair-split`). See [chapter 2 of the DR establishment guide](dr-establishment-guide.md#chapter-test-service).",
        "",
        "| Order | Step | Owner role | Estimated duration | Verification | Abort condition |",
        "|---|---|---|---|---|---|",
        "| Failover 1 | Declare DR | Incident manager | Estimated: measured in the first drill | The declaration is recorded | The primary answers again |",
        "| Failover 2 | Wait for the failover to the pair | Platform engineer | Estimated 4h | The service answers in the pair | Microsoft does not fail over |",
        "| Failover 3 | Point the consumers in germanywestcentral at the Test Service in swedensouth | <!-- fill: owner role --> | Estimated: measured in the first drill | the consumers read from swedensouth | A consumer cannot read from swedensouth |",
        "| Failback 1 | Move the consumers back | Platform engineer | Estimated: unknown | A write succeeds | Writes still fail |",
    ].join("\n"));
    assert.deepEqual([...split.text.matchAll(/^### (.+)$/gm)].map((m) => m[1]), ["1. Test Native", "2. Test Service", "3. Gadgets", "4. Network Interface"]);
    assert.deepEqual([...split.text.matchAll(/^<a id="runbook-([^"]+)"><\/a>\n### \d+\. /gm)].map((m) => m[1]), ["test-native", "test-service", "microsoft-example-gadgets", "microsoft-network-networkinterfaces"], "each subsection has the anchor of its chapter on the line before");

    const copy = runbookSkeleton({ doc: fixtureDoc({ choices: [choice(WIDGETS, "second-copy")] }), playbooks }).text;
    assert.match(copy, /^\| Failover 2 \| Switch to the second instance \| Platform engineer \| Estimated 10m \|/m);
    assert.doesNotMatch(copy, /Point the consumers|Wait for the failover/);
    const fills = "| <!-- fill: order --> | <!-- fill: step --> | <!-- fill: owner role --> | <!-- fill: Estimated duration --> | <!-- fill: verification --> | <!-- fill: abort condition --> |";
    assert.equal(copy.split(fills).length - 1, 2, "gadgets and network interfaces have no playbook steps");
});

test("the migration lists keep the steps of no option and of the chosen option without its label, and drop the steps of other options", () => {
    const sections = Object.fromEntries(PLAYBOOK_BODIES);
    const migration = [
        "### Recognise today's setup", "The inventory shows a replica in the pair.", "",
        "### Build", "1. All options: check the quota first.", "2. second-copy: create the second instance in the DR region.", "3. pair-split: build nothing in the service.", "",
        "### Validate", "1. Run TC-1.", "",
        "### Cut over", "1. pair-split: read from the pair.", "2. second-copy: point the DR configuration at the second instance.", "",
        "### Decommission", "1. second-copy: remove the replica in the pair.", "2. pair-split: keep the replica in the pair.", "3. Close the change record.", "",
        "### Keep until cut-over", "The replica in the pair.",
    ].join("\n");
    const labelled = fixturePlaybook({ ...WIDGET_PLAYBOOK, sections: { ...sections, "Migration from a paired setup": migration } });
    const text = skeleton(fixtureDoc({ choices: [choice(WIDGETS, "second-copy")] }), new Map(PLAYBOOKS).set("test-service", labelled)).text;
    assert.equal(part(text, WIDGETS, "Build"), "1. All options: check the quota first.\n2. Create the second instance in the DR region.");
    assert.equal(part(text, WIDGETS, "Cut-over"), "1. Point the DR configuration at the second instance.");
    assert.equal(part(text, WIDGETS, "Decommission the paired setup"), "Only after every criterion of Validate has passed.\n\n1. Remove the replica in the pair.\n2. Close the change record.\n\nKeep until cut-over: The replica in the pair.");
    assert.doesNotMatch(text, /pair-split: |build nothing in the service|read from the pair|keep the replica/);
});

test("the migration lists of the bundled key-vault playbook carry no option label under the secondary-vault-sync target", async () => {
    const { set } = await readPlaybooks(defaultPlaybooksDir());
    const playbook = set.byService.get("key-vault");
    const option = playbook.options.find((o) => o.id === "secondary-vault-sync");
    const doc = fixtureDoc();
    const row = doc.types.find((r) => r.type === WIDGETS);
    row.playbook = `key-vault v${playbook.version}`;
    row.options = [{ ...row.options[0], id: option.id, title: option.title, kind: option.kind, source: "playbook" }];
    row.recommended = option.id;
    row.choice = { status: "valid", option: option.id, chosen_by: "Application owner", date: "2026-11-09", recommended: true };
    row.decidedBy = null;
    const text = skeleton(doc, new Map(PLAYBOOKS).set("key-vault", playbook)).text;
    for (const name of ["Build", "Cut-over", "Decommission the paired setup"]) {
        const lines = part(text, WIDGETS, name).split("\n").filter((line) => /^\d+\. /.test(line));
        assert.ok(lines.length > 0, name);
        assert.deepEqual(lines.filter((line) => /^\d+\. (paired-failover-split|secondary-vault-sync):/.test(line)), [], name);
    }
    assert.match(part(text, WIDGETS, "Build"), /^\d+\. Take the inventory of every secret/m);
    assert.doesNotMatch(part(text, WIDGETS, "Build"), /no vault is built and no data is copied/);
});

test("two rows with the same title get the last segment of their ARM type in the title: the plan, the chapter headings and the runbook subsections", () => {
    const doc = fixtureDoc();
    doc.types = [...doc.types, { ...doc.types.find((r) => r.type === WIDGETS), type: "microsoft.test/disks" }];
    assert.deepEqual(chapterPlan(doc).map((c) => [c.type, c.title]), [
        [NATIVES, "Test Native"], [WIDGETS, "Test Service (widgets)"], [GADGETS, "Gadgets"], ["microsoft.test/disks", "Test Service (disks)"], [NICS, "Network Interface"],
    ]);
    const { text, chapters } = skeleton(doc);
    assert.deepEqual(chapters.map((c) => c.title), ["Test Native", "Test Service (widgets)", "Gadgets", "Test Service (disks)", "Network Interface"]);
    assert.deepEqual([...text.matchAll(/^## Chapter \d+: (.+) \(/gm)].map((m) => m[1]), ["Test Native", "Test Service (widgets)", "Gadgets", "Test Service (disks)", "Network Interface"]);
    assert.match(text, /^2\. \[Test Service \(widgets\)\]\(#chapter-test-service\) /m);
    assert.match(text, /^4\. \[Test Service \(disks\)\]\(#chapter-test-service-2\) /m);
    assert.deepEqual([...runbookSkeleton({ doc, playbooks: PLAYBOOKS }).text.matchAll(/^### (.+)$/gm)].map((m) => m[1]), [
        "1. Test Native", "2. Test Service (widgets)", "3. Gadgets", "4. Test Service (disks)", "5. Network Interface",
    ]);
});

const DISKS = "microsoft.test/disks";
/** The fixture document with a second type of the widget playbook after the gadgets; `option` replaces its target. */
function twoTypeDoc(option = null) {
    const doc = fixtureDoc({ choices: [choice(WIDGETS, "second-copy")] });
    const widgets = doc.types.find((r) => r.type === WIDGETS);
    const disks = { ...widgets, type: DISKS, choice: option ? { ...widgets.choice, option } : widgets.choice };
    doc.types = [...doc.types, disks];
    return doc;
}

test("a later type of the same playbook and target option is a pointer chapter to the first one: no duplicated steps or criteria", () => {
    const doc = twoTypeDoc();
    const { text, chapters } = skeleton(doc);
    assert.deepEqual(chapters.map((c) => [c.n, c.type, c.title, c.anchor]), [
        [1, NATIVES, "Test Native", "test-native"], [2, WIDGETS, "Test Service (widgets)", "test-service"], [3, GADGETS, "Gadgets", "microsoft-example-gadgets"],
        [4, DISKS, "Test Service (disks)", "test-service-2"], [5, NICS, "Network Interface", "microsoft-network-networkinterfaces"],
    ]);
    assert.match(part(text, DISKS, "Target"), /^- Option: Second copy in the DR region \(`second-copy`\): Workaround, target germanywestcentral\.$/m);
    assert.ok(part(text, DISKS, "Target").endsWith("\n\nBuilt with chapter 2 (Test Service (widgets)): the same playbook and option cover this type.\n\n<!-- fill: why this option fits the workload, in one or two sentences -->"));
    for (const name of ["Prerequisites", "Build", "Cut-over", "Decommission the paired setup"]) assert.equal(part(text, DISKS, name), "See chapter 2.", name);
    assert.equal(part(text, DISKS, "Validate"), [
        "| Criterion | Pass condition | How to measure | Evidence | Frequency | Owner role |",
        "|---|---|---|---|---|---|",
        "| Covered by chapter 2 | Every criterion of chapter 2 passes for the resources of this type too | The measurements of chapter 2, run on this type's resources | The evidence of chapter 2 | As chapter 2 | <!-- fill: owner role --> |",
    ].join("\n"));
    assert.match(part(text, DISKS, "Today"), /^<!-- fill: today's DR setup of the 3 resources/);
    assert.equal(part(text, DISKS, "Failover and failback"), "See [subsection 4 of section 3 of the recovery runbook](recovery-runbook.md#runbook-test-service-2).\n\n<!-- fill: a summary of the failover and failback of this service -->");
    assert.equal(part(text, WIDGETS, "Build"), "1. Create the second instance in the DR region.", "the first chapter stays full");
    const plan = injectGuideTables(fillGuide(text)).text.split(TEST_PLAN_MARKERS[0])[1];
    assert.equal(plan.split("TC-1: The second copy is current").length - 1, 1, "the criterion is in the test plan once");
    assert.match(plan, /^\| Test Service \(disks\) \| Covered by chapter 2 \| Every criterion of chapter 2 passes for the resources of this type too \| As chapter 2 \| Platform engineer \|$/m);

    const runbook = runbookSkeleton({ doc, playbooks: PLAYBOOKS }).text;
    const disks = runbook.split("### 4. Test Service (disks)\n")[1].split("<a id=")[0].trim();
    assert.equal(disks, [
        "Target: Second copy in the DR region (`second-copy`). See [chapter 4 of the DR establishment guide](dr-establishment-guide.md#chapter-test-service-2).",
        "",
        "| Order | Step | Owner role | Estimated duration | Verification | Abort condition |",
        "|---|---|---|---|---|---|",
        "| With 2 | Recovered by the steps of subsection 2; no steps of its own | <!-- fill: owner role --> | Estimated: included in subsection 2 | the criteria of chapter 2 pass for this type | As subsection 2 |",
    ].join("\n"));
    const once = runbookSkeleton({ doc: fixtureDoc({ choices: [choice(WIDGETS, "second-copy")] }), playbooks: PLAYBOOKS }).text;
    assert.equal(runbook.split("Switch to the second instance").length, once.split("Switch to the second instance").length, "the second type adds no failover step");
});

test("two types of the same playbook with different target options get two full chapters", () => {
    const doc = twoTypeDoc("pair-split");
    const { text } = skeleton(doc);
    assert.equal(part(text, WIDGETS, "Build"), "1. Create the second instance in the DR region.");
    assert.match(part(text, DISKS, "Build"), /^1\. Create the second instance in the DR region\.\n\n<!-- fill: the network path from the consumers in germanywestcentral/);
    assert.doesNotMatch(text, /Built with chapter|See chapter|Covered by chapter/);
    assert.doesNotMatch(runbookSkeleton({ doc, playbooks: PLAYBOOKS }).text, /\| With \d/);
});

test("the bundled virtual-machines playbook gives one full chapter for the VMs and a pointer chapter for their disks", async () => {
    const { set } = await readPlaybooks(defaultPlaybooksDir());
    const vm = set.byService.get("virtual-machines");
    assert.deepEqual(vm.armTypes, ["microsoft.compute/virtualmachines", "microsoft.compute/disks"]);
    const doc = minimalDoc([playbookRow(vm, "microsoft.compute/virtualmachines", "site-recovery"), playbookRow(vm, "microsoft.compute/disks", "site-recovery")]);
    const { text, chapters } = guideSkeleton({ doc, playbooks: set.byService, template: MINI_TEMPLATE });
    assert.deepEqual(chapters.map((c) => [c.n, c.type, c.anchor]), [[1, "microsoft.compute/virtualmachines", "virtual-machines"], [2, "microsoft.compute/disks", "virtual-machines-2"]]);
    const build = part(text, "microsoft.compute/virtualmachines", "Build").split("\n").filter((line) => /^\d+\. /.test(line));
    assert.equal(build.length, 13);
    assert.equal(part(text, "microsoft.compute/disks", "Build"), "See chapter 1.");
    assert.match(part(text, "microsoft.compute/disks", "Target"), new RegExp(`Built with chapter 1 \\(${chapters[0].title.replace(/[()]/g, "\\$&")}\\): the same playbook and option cover this type\\.`));
    const filled = injectGuideTables(fillGuide(text)).text;
    assert.deepEqual(checkGuide(filled, doc), []);
    const plan = filled.split(TEST_PLAN_MARKERS[0])[1];
    const ids = [...plan.matchAll(/^\| [^|]+ \| (TC-\d+):/gm)].map((m) => m[1]);
    assert.ok(ids.length > 0);
    assert.deepEqual(ids, [...new Set(ids)], "no criterion is listed twice");
    const runbook = runbookSkeleton({ doc, playbooks: set.byService }).text;
    const [first, second] = runbook.split(/^<a id="runbook-/m).slice(1);
    assert.ok((first.match(/^\| Failover \d+ \|/gm) ?? []).length > 0);
    assert.deepEqual(second.split("\n").filter((line) => /^\| (?!Order|---)/.test(line)).map((line) => line.split(" | ")[0]), ["| With 1"]);
});

test("two types of the same playbook that both accept the gap get two full chapters, each with its own Gap recorded row", () => {
    const doc = twoTypeDoc();
    for (const row of doc.types.filter((r) => r.type === WIDGETS || r.type === DISKS)) row.choice = { ...row.choice, option: "accept-gap" };
    const { text } = skeleton(doc);
    for (const type of [WIDGETS, DISKS]) {
        assert.equal(part(text, type, "Build"), "None: the gap is accepted, nothing is built in the DR region.", type);
        assert.match(part(text, type, "Validate"), /^\| Gap recorded \| /m, type);
    }
    assert.doesNotMatch(text, /Built with chapter|See chapter|Covered by chapter/);
    assert.doesNotMatch(runbookSkeleton({ doc, playbooks: PLAYBOOKS }).text, /\| With \d/);
});
