import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { BUILD_ORDER, GUIDE_PARTS } from "../../skills/azure-dr-assessment/scripts/lib/guide.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const skill = path.join(root, "skills", "azure-dr-assessment");
const read = (...parts) => readFileSync(path.join(skill, ...parts), "utf8");
const flat = (text) => text.replace(/\s+/g, " ");
const section = (text, heading) => text.split(new RegExp(`^${heading}$`, "m"))[1].split(/^## /m)[0];
const stage7 = read("references", "stages", "07-report.md");
const GUIDE_COMMAND = "node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root dr-assessment/checkout";

test("stage 7 writes the guide skeleton, its text, its test plan and its check, then the runbook, the report and report-tables last", () => {
    assert.match(stage7, /^# Stage 7: Report, establishment guide and runbook$/m);
    assert.match(flat(stage7), /Work in this order: the guide skeleton, the guide text, the runbook, the report, and `report-tables` last\./);
    const at = (needle) => {
        const i = stage7.indexOf(needle);
        assert.ok(i >= 0, needle);
        return i;
    };
    const order = [`${GUIDE_COMMAND} --write`, `${GUIDE_COMMAND} --tables`, `${GUIDE_COMMAND} --check`, `${GUIDE_COMMAND} --inject-runbook dr-assessment/checkout/reports/recovery-runbook.md`, "report-tables.mjs --root"];
    order.reduce((last, needle) => {
        const i = at(needle);
        assert.ok(i > last, `${needle} comes after the step before it`);
        return i;
    }, -1);
    const guide = flat(section(stage7, "## The establishment guide"));
    for (const part of GUIDE_PARTS) assert.ok(guide.includes(part), part);
    assert.match(guide, /"No playbook, derived from Learn this run\." takes its target and steps from the `option` entries of the ledger, citing their `D-` ids, and says Unknown where Learn does not support a part/);
    assert.match(guide, /Never delete a "Playbook claim stale" line: Learn wins/);
    assert.match(guide, /pass the same `--playbooks-dir`, and name the folder in report section C and in the summary/);
    assert.match(flat(section(stage7, "## Before you finish")), /`node skills\/azure-dr-assessment\/scripts\/establishment-guide\.mjs --root dr-assessment\/checkout --check` exits 0\./);
});

test("stage 7 gives commands only on request, after asking the form, and never runs them", () => {
    const commands = flat(section(stage7, "## Commands \\(only when the owner asks\\)"));
    assert.match(commands, /first ask which form, unless the request names it: Azure CLI, Bicep, Terraform, Azure PowerShell or portal steps/);
    assert.match(commands, /headed `Commands \(untested, <form>\)`/);
    assert.match(commands, /Never run them\./);
});

test("the chat summary names the interview choices and the defaulted types and never cuts them; a default is never an owner decision", () => {
    const summary = flat(section(stage7, "## Tell the owner"));
    assert.match(summary, /- the DR options interview: each choice in `dr_choices` with its type, its option and who chose it, and how many were defaulted, naming every defaulted type: a default is an open decision of the owner, not an owner's decision;/);
    assert.match(summary, /- the playbook folder, when it is not the bundled one \(`nonDefaultPlaybooks: true`\);/);
    assert.match(summary, /where the files are: the guide, the report, the runbook, the two presentations and the two diagrams/);
    assert.match(summary, /The decisions, the interview choices and the retry command are never cut/);
    assert.match(flat(section(stage7, "## Never")), /Call a default DR choice an owner decision, or leave a defaulted type out of the summary\./);
});

test("the report template links the guide chapters, references the test plan and lists the default choices as open decisions", () => {
    const report = read("assets", "templates", "report.md");
    const fill = (heading) => section(report, `## ${heading}`);
    assert.match(fill("2\\. Assumptions and failure scope"), /List every DR choice that nobody made \(`chosen_by: default` in `dr_choices`\) as an open decision, with its type and option\./);
    assert.match(fill("3\\. Proposed architecture"), /Link each component to its chapter of the establishment guide \(dr-establishment-guide\.md#chapter-<anchor>\)\./);
    assert.match(fill("7\\. Validation plan and next steps"), /reference the consolidated test plan of reports\/dr-establishment-guide\.md instead of repeating it/);
    assert.match(fill("7\\. Validation plan and next steps"), /every default DR choice among them as an open decision/);
});

test("stage 6 tells the establishing scenes in the build order of the guide", () => {
    const presentation = flat(section(read("references", "stages", "06-dr-design.md"), "## Presentation 2: the DR walkthrough"));
    assert.match(presentation, /Write one scene per build-order group that holds a type of `evidence\/dr-options\.json`, in the build order of the establishment guide: connectivity, identity, detection, secrets and keys, the data-replication slots and backup, compute, ingress, the types without a slot, then the traffic switch\./);
    assert.match(presentation, /Each scene's `md` names today's setup, the target \(the chosen option, or the default, said as such\) and the test criterion that proves it/);
    assert.match(presentation, /The template refuses an `establishing` entry without a scene: exit 2 with `scenes must be a non-empty list`\./);
    assert.deepEqual([BUILD_ORDER[0], BUILD_ORDER[3], BUILD_ORDER.at(-1)], ["connectivity", "secrets-keys", "traffic-dns"], "the order stage 6 names is the order of lib/guide.mjs");
});

test("the output contract, SKILL.md and the README name the guide, its chapters, the interview and the new files", () => {
    const contract = read("references", "output-contract.md");
    assert.match(contract, /^\| `evidence\/dr-options\.json` \| `dr-options` \|/m);
    assert.match(contract, /^\| `reports\/dr-establishment-guide\.md` \| `establishment-guide`, you \| The DR establishment guide below\. \|$/m);
    assert.match(contract, /^## The establishment guide$/m);
    assert.match(flat(contract), /section 3, one subsection per service in build order from its playbook/);
    assert.match(flat(contract), /Healthy state, establishing DR \(one scene per build-order group: today's setup, the target and the test that proves it\), disaster/);
    assert.match(read("SKILL.md"), /^\| 7 \| Report, guide and runbook \| Write the DR establishment guide, the draft runbook and the report, then summarize\. \|/m);
    const readme = flat(readFileSync(path.join(root, "README.md"), "utf8"));
    assert.match(readme, /the DR options interview: for every service with no native DR into the DR region, its options with Estimated RPO and RTO, what each gives up, and a recommendation\. Reply with a short name and a number, such as `KV 2`, or accept the recommendations\./);
    assert.match(readme, /reports\/ assessment\.md, dr-establishment-guide\.md and recovery-runbook\.md \(DRAFTs\)/);
    assert.match(readme, /The DR establishment guide takes each service from today's setup/);
    assert.match(readme, /Commands are given only when you ask, in the form you choose \(Azure CLI, Bicep, Terraform, Azure PowerShell or portal steps\), and are labelled untested\./);
});

test("stage 7 describes the skeleton as the generator writes it, names the empty-Validate refusal and warns that --inject-runbook discards section 3", () => {
    const guide = flat(section(stage7, "## The establishment guide"));
    assert.match(guide, /A split-region target gets the playbook's own split steps, plus one fill comment after Build for the network path/);
    assert.match(guide, /"Built with chapter <n>", "See chapter <n>\." in the step parts, and one Validate row "Covered by chapter <n>"/);
    assert.match(guide, /An accept-gap target builds nothing, keeps today's paired setup and has one Validate row, "Gap recorded"\./);
    assert.match(guide, /`recovery-runbook\.md#runbook-<anchor>`/);
    assert.match(guide, /a fill comment left, a Validate table without a row, a Validate row with an empty cell/);
    assert.match(flat(section(stage7, "## The runbook")), /`--inject-runbook` replaces everything between the section 3 markers: run it before you fill the owner roles there, because a rerun discards what was filled between them\./);
});

test("the release scenarios DR-13, DR-14 and DR-18 hold the guide to the stage 5b question, the outputs and a criterion per chapter", () => {
    const scenarios = readFileSync(path.join(root, "tests", "scenarios.md"), "utf8");
    const scenario = (id) => flat(scenarios.split(new RegExp(`^## ${id}: `, "m"))[1].split(/^## /m)[0]);
    assert.match(scenario("DR-13"), /without a further question, except the DR options question of stage 5b, answered `accept recommendations`/);
    assert.match(scenario("DR-14"), /`evidence\/dr-options\.json`.*`reports\/dr-establishment-guide\.md`/);
    assert.match(scenario("DR-14"), /No `fill` comment is left in the guide: `node skills\/azure-dr-assessment\/scripts\/establishment-guide\.mjs --root dr-assessment\/rg-checkout --check` exits 0\./);
    assert.match(scenario("DR-18"), /Its Validate part has at least one row, every row is measurable/);
});

test("stages 6 and 7 say that the script owns the Target lines of a chapter and that --check refuses a changed one", () => {
    const guide = flat(section(stage7, "## The establishment guide"));
    assert.match(guide, /The Target lines `- Option:`, `- Source:`, `- Chosen by:`, `- Estimated RPO:` and `- Tier <n>:` \(or `- Decided by`\) belong to the script: keep each one exactly as written and put a qualification on a line of your own below them\./);
    assert.match(guide, /a Target line of the script that is missing or changed/);
    const stage6 = flat(read("references", "stages", "06-dr-design.md"));
    assert.match(stage6, /a check that fails goes on a line of its own under the script's Target lines: `establishment-guide` writes the Option, Source, Chosen by, Estimated RPO and RTO, and Tier lines from `evidence\/dr-options\.json`, and they stay as written \(stage 7\)\./);
});

test("stage 6 says that a pattern-decided slot vetoes the playbook options that would decide it, and names the App Service DNS option under DR-DNS-001", () => {
    const stage6 = flat(read("references", "stages", "06-dr-design.md"));
    assert.match(stage6, /\*\*A slot that a pattern decides\.\*\* An option that names the slot in its `Decides slots` is vetoed by `dr-options --classify` \(GC-11\): it is in the row's `vetoed` list, never its target\./);
    assert.match(stage6, /When DR-DNS-001 decides `traffic-dns`, App Service's `secondary-app` \(Front Door\) is vetoed and `secondary-app-dns` is the recommendation: the second app behind the company's DNS, whose traffic switch is the on-prem record change with the TTL counting toward the RTO\. The guide takes that option's steps\./);
});

test("stage 7 says that --check screens the filled guide and runbook for secrets and names the place, never the text (GC-07)", () => {
    const guide = flat(section(stage7, "## The establishment guide"));
    assert.match(guide, /Exit 2 from `--check` with "the guide or the runbook holds text that looks like a secret" names the file, the line and the chapter or runbook subsection, never the text: name where the secret is kept instead\./);
});

test("stage 7 says that a type without a slot sorts by the slot of its ARM namespace (M-5)", () => {
    assert.match(flat(section(stage7, "## The establishment guide")), /a type without a slot of its own sorts by the slot of its ARM namespace, so a virtual network comes first, and only a namespace the script does not know goes after ingress/);
});
