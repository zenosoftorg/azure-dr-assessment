import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { readAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { GROUP_STYLES } from "../../skills/azure-dr-assessment/scripts/lib/diagram-style.mjs";
import { parsePlaybook } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { runPipeline, scriptPath } from "../helpers/stand-in-model.mjs";

const read = (file) => readFileSync(file, "utf8");
const TIER_SECTIONS = [
    "1. Selected landing zone tier and recovery objectives", "2. Assumptions and failure scope", "3. Proposed architecture", "4. Failover and failback sequence",
    "5. RPO/RTO feasibility assessment", "6. Landing zone versus workload-team actions", "7. Validation plan and next steps",
];
const SUPPORTING = ["A. Current-state architecture", "B. Evidence and unknowns", "C. Documentation sources", "D. Pattern register and documented exceptions"];
const OUTPUTS = [
    "assessment.yaml", "evidence/inventory.json", "evidence/ledger.json", "evidence/dr-options.json", "evidence/pattern-resolution.json", "evidence/.gitignore",
    "architectures/checkout-current-state.arch.json", "architectures/checkout-proposed-dr.arch.json", "reports/assessment.md", "reports/dr-establishment-guide.md",
    "reports/recovery-runbook.md",
];
const KV = "microsoft.keyvault/vaults";
const STORAGE = "microsoft.storage/storageaccounts";
/** The other in-scope types of the sample inventory: no playbook and no option, so their default is accept-gap. */
const DEFAULTED = ["microsoft.compute/virtualmachines", "microsoft.compute/disks", "microsoft.sql/servers/databases", "microsoft.web/sites"];

test("a generated ARI workbook, a tier and two regions become every output of the skill in one pass", async (t) => {
    const run = await runPipeline({ iconRoot: makeIconRoot() });

    assert.equal(run.preflight.mode, "full");
    assert.equal(run.preflight.checks.find((check) => check.id === "icons").status, "ok");
    assert.deepEqual([run.intake.announce, run.intake.complete, run.intake.gatesOpen], ["Output folder: dr-assessment/checkout/", true, 0]);
    assert.equal(run.ingest.regionCheck.status, "match");
    assert.equal(run.validation.valid, true);
    assert.deepEqual(run.ledgerCheck.errors, []);

    for (const file of [...OUTPUTS, "presentations/checkout-current-state.html", "presentations/checkout-proposed-dr.html"]) {
        assert.ok(existsSync(path.join(run.root, file)), file);
    }
    assert.deepEqual(readdirSync(run.cwd).sort(), ["ari-export.xlsx", "dr-assessment"], "nothing is written outside the output folder");
    assert.deepEqual(readdirSync(path.join(run.cwd, "dr-assessment")), ["checkout"]);

    for (const presentation of Object.values(run.presentations)) {
        assert.equal(presentation.result.code, 0, presentation.result.stderr);
        assert.ok(presentation.result.json.icons > 0, `${presentation.id} inlines icons`);
        assert.deepEqual(presentation.result.json.missingIcons, []);
        assert.ok(read(presentation.html).split("data:image/svg+xml;base64,").length - 1 >= presentation.result.json.icons, `${presentation.id} holds its icons`);
    }

    const report = read(run.report);
    assert.deepEqual([...report.matchAll(/^## (.+)$/gm)].map((match) => match[1]), [...TIER_SECTIONS, ...SUPPORTING]);
    assert.doesNotMatch(report, /<!-- fill:/);
    const after = (name) => report.split(`## ${name}`)[1];
    assert.match(after("D. Pattern register and documented exceptions"), /DR-DNS-001/);
    assert.match(after("C. Documentation sources").split("## D.")[0], /Unverified/);
    assert.match(read(run.runbook), /^> \*\*DRAFT: not an operational procedure until rehearsed and approved by the owner\.\*\*$/m);

    const dr = JSON.parse(read(path.join(run.root, "architectures", "checkout-proposed-dr.arch.json")));
    assert.ok(dr.edges.some((edge) => edge.label === "Change on-prem DNS record"), "the DR diagram shows the on-prem record change");
    assert.equal(dr.nodes.some((node) => /traffic manager|front door/i.test(node.label)), false, "Traffic Manager is not drawn");
    assert.ok(read(run.presentations.dr.html).includes("Change on-prem DNS record"), "the walkthrough tells the DNS step");

    // v3: the interview, the split-region choice on the diagram, the guide and runbook section 3.
    assert.ok(run.options.ask.includes(KV) && run.options.ask.includes(STORAGE), "the question asks about Key Vault and the storage account");
    assert.match(run.options.question, /^\*\*Azure Key Vault\*\* \(1 resource\)\. No native DR into swedencentral\.$/m);
    assert.deepEqual(run.choices.recorded, [{ type: KV, option: "paired-failover-split", chosen_by: "Application owner" }, { type: STORAGE, option: "object-replication", chosen_by: "Application owner" }]);
    assert.deepEqual([run.choices.defaulted, run.choices.openDecisions], [DEFAULTED, DEFAULTED]);
    assert.equal(run.choicesCheck.valid, true);
    const choices = (await readAssessment(path.join(run.root, "assessment.yaml"))).dr_choices;
    assert.deepEqual(choices.map((c) => [c.type, c.option, c.chosen_by]), [
        [KV, "paired-failover-split", "Application owner"], [STORAGE, "object-replication", "Application owner"], ...DEFAULTED.map((type) => [type, "accept-gap", "default"]),
    ]);
    const split = dr.groups.find((group) => group.label.startsWith("split: "));
    assert.deepEqual([split?.label, split?.border], ["split: Azure Key Vault only (northeurope)", GROUP_STYLES.split.border]);
    const vault = dr.nodes.find((node) => node.group === split.id);
    const across = dr.edges.find((edge) => edge.to === vault.id);
    assert.equal(across?.label, "Secrets across regions", "the DR region reads the vault across regions");
    assert.match(across.annotation, /\*\*Source:\*\* Service playbook/, "the slot was decided from the playbook");
    assert.ok(read(run.presentations.dr.html).includes("Establishing DR"), "the walkthrough tells the establishing chapter");

    const guide = read(run.guide.file);
    assert.deepEqual([...guide.matchAll(/^## Chapter \d+: .+ \((.+)\)$/gm)].map((m) => m[1]), [KV, DEFAULTED[2], STORAGE, DEFAULTED[0], DEFAULTED[1], DEFAULTED[3]], "chapters in build order: types without a playbook sort by the slot of their ARM namespace (M-5)");
    assert.deepEqual(run.guide.chapters.map((c) => [c.n, c.slot, c.anchor]), [
        [1, "secrets-keys", "key-vault"], [2, null, "microsoft-sql-servers-databases"], [3, "data-replication.storage", "microsoft-storage-storageaccounts"],
        [4, null, "microsoft-compute-virtualmachines"], [5, null, "microsoft-compute-disks"], [6, null, "microsoft-web-sites"],
    ]);
    assert.equal(guide.split("No playbook, derived from Learn this run.").length - 1, 5);
    assert.doesNotMatch(guide, /<!-- fill:/);
    const book = parsePlaybook(read(path.join(run.playbooks, "key-vault.md")), "key-vault.md").playbook;
    const criteria = book.tests.filter((t) => t.appliesTo.includes("paired-failover-split")).map((t) => `${t.id}: ${t.title}`);
    assert.ok(criteria.length > 0);
    // Besides the Key Vault criteria: the criterion the model writes for the Learn-derived storage chapter, and the "Gap recorded" row of each defaulted accept-gap chapter.
    const all = criteria.length + 1 + DEFAULTED.length;
    assert.deepEqual([run.guide.check.valid, run.guide.check.chapters, run.guide.check.criteria, run.guide.tables.criteria], [true, 6, all, all]);
    assert.equal(guide.split("<!-- dr-guide:test-plan -->")[0].split("| Gap recorded |").length - 1, DEFAULTED.length, "each defaulted accept-gap chapter records its gap");
    const plan = guide.split("<!-- dr-guide:test-plan -->")[1].split("<!-- /dr-guide:test-plan -->")[0];
    assert.deepEqual([...plan.matchAll(/^\| Azure Key Vault \| ([^|]+) \|/gm)].map((m) => m[1]), criteria, "the test plan has one row per criterion of the chosen option");

    const runbook = read(run.runbook);
    assert.equal(run.runbookSteps.services, 6);
    const section3 = runbook.split("<!-- dr-guide:runbook -->")[1].split("<!-- /dr-guide:runbook -->")[0];
    assert.match(section3, /^### 1\. Azure Key Vault$/m);
    assert.match(section3, /\| Point the consumers in swedencentral at the Azure Key Vault in northeurope \|/);
    assert.doesNotMatch(runbook, /<!-- fill:/);

    for (const presentation of Object.values(run.presentations)) {
        const check = await runScript(scriptPath("check-presentation"), ["--html", presentation.html], { cwd: run.cwd });
        if (check.code === 3) {
            t.diagnostic(`NOT RUN: the browser check of ${presentation.id}: ${check.json.error}`);
            continue;
        }
        assert.equal(check.code, 0, `${presentation.id}: ${JSON.stringify(check.json.details ?? check.json)}`);
        assert.equal(check.json.status, "passed");
        t.diagnostic(`the browser check of ${presentation.id} passed (${check.json.checks.length} checks)`);
    }
});

test("without an icon library only the presentation builds refuse, and the diagrams, the report and the runbook are still produced", async () => {
    const run = await runPipeline({ iconRoot: makeIconRoot({ withIcons: false }) });

    assert.notEqual(run.preflight.checks.find((check) => check.id === "icons").status, "ok", "preflight says that the icons are missing");
    assert.equal(run.preflight.mode, "full", "and it does not block the run");
    for (const presentation of Object.values(run.presentations)) {
        assert.equal(presentation.result.code, 4, presentation.id);
        assert.equal(presentation.result.json.reason, "zero-icons");
        assert.equal(existsSync(presentation.html), false, `${presentation.id} is not delivered`);
    }
    for (const diagram of Object.values(run.diagrams)) {
        assert.ok(diagram.warnings.some((warning) => warning.startsWith("no icon library found")), diagram.id);
    }
    for (const file of OUTPUTS) assert.ok(existsSync(path.join(run.root, file)), file);
    assert.deepEqual(run.ledgerCheck.errors, []);
    assert.equal(run.tables.injected, run.report);
    assert.deepEqual(Object.keys(run.tables.sections), ["evidence", "sources", "patterns"]);
});

test("preflight reports an unreachable Microsoft Learn as a degradation and never blocks the run", async () => {
    const result = await runScript(scriptPath("preflight"), ["--icon-root", makeIconRoot()], { env: { DR_LEARN_URL: "http://127.0.0.1:9/" } });
    assert.equal(result.code, 0, result.stderr);
    const learn = result.json.checks.find((check) => check.id === "learn-network");
    assert.notEqual(learn.status, "ok");
    assert.ok(result.json.degradations.some((entry) => entry.startsWith("learn-network:")), result.json.degradations.join("; "));
    assert.equal(result.json.mode, "full");
});
