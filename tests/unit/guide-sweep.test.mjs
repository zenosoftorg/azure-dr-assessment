import assert from "node:assert/strict";
import test from "node:test";
import { checkGuide, guideSkeleton, injectGuideTables, parseGuide, runbookSkeleton } from "../../skills/azure-dr-assessment/scripts/lib/guide.mjs";
import { defaultPlaybooksDir } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { readPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { MINI_TEMPLATE, fillGuide, minimalDoc, playbookRow } from "../helpers/guide-fixture.mjs";

const { set } = await readPlaybooks(defaultPlaybooksDir());
const STEP_PARTS = ["Build", "Validate", "Cut-over", "Decommission the paired setup"];

/** The lines of one part of one chapter of a guide. */
function partLines(text, chapter, name) {
    const body = text.split(`## Chapter ${chapter.n}: `)[1].split(/^## /m)[0];
    return body.split(new RegExp(`^### ${name}$`, "m"))[1].split(/^### |^<a id=/m)[0].split("\n");
}

test("every option of every bundled playbook, as the target of all its types, gives a guide that passes the check once filled, with no option label left", () => {
    assert.ok(set.byService.size >= 22, "the bundled playbooks are read");
    const cases = [];
    for (const playbook of set.byService.values()) {
        for (const id of [...playbook.options.map((o) => o.id), "accept-gap"]) cases.push([playbook, id]);
    }
    const problems = [];
    for (const [playbook, id] of cases) {
        const at = `${playbook.service} ${id}`;
        const doc = minimalDoc(playbook.armTypes.map((type) => playbookRow(playbook, type, id)));
        const { text, chapters } = guideSkeleton({ doc, playbooks: set.byService, template: MINI_TEMPLATE });
        if (chapters.length !== playbook.armTypes.length) problems.push(`${at}: ${chapters.length} chapters for ${playbook.armTypes.length} types`);
        const filled = injectGuideTables(fillGuide(text)).text;
        problems.push(...checkGuide(filled, doc).map((problem) => `${at}: ${problem}`));

        const label = new RegExp(`^\\d+\\. (?:${playbook.options.map((o) => o.id).join("|")}):`);
        for (const chapter of chapters) {
            for (const name of STEP_PARTS) {
                for (const line of partLines(text, chapter, name).filter((l) => label.test(l))) problems.push(`${at}: chapter ${chapter.n} ${name} keeps a label: ${line.slice(0, 60)}`);
            }
        }
        if (id !== "accept-gap") {
            if (parseGuide(text)[0].parts.find((p) => p.name === "Validate").rows.length === 0) problems.push(`${at}: no criterion is prefilled`);
            if (!partLines(text, chapters[0], "Build").some((line) => /^\d+\. /.test(line))) problems.push(`${at}: the playbook's build steps are not written`);
        }
        const plan = filled.split("<!-- dr-guide:test-plan -->")[1].split("\n").filter((line) => /^\| [^|]+ \| TC-\d+:/.test(line)).map((line) => line.split(" | ")[1]);
        if (new Set(plan).size !== plan.length) problems.push(`${at}: the test plan repeats a criterion`);
        const runbook = runbookSkeleton({ doc, playbooks: set.byService }).text;
        if (runbook.split(/^### \d+\. /m).length - 1 !== playbook.armTypes.length) problems.push(`${at}: the runbook has another number of subsections than types`);
        const steps = runbook.split("\n").filter((line) => /^\| (?:Failover|Failback) \d+ \| /.test(line)).map((line) => line.split(" | ")[1]);
        for (const step of steps.filter((s) => playbook.options.some((o) => s.startsWith(`${o.id}: `)))) problems.push(`${at}: a runbook step keeps a label: ${step.slice(0, 60)}`);
    }
    assert.deepEqual(problems, []);
    assert.ok(cases.length >= 60, `${cases.length} cases`);
});

test("M-7: the split runbook of the key-vault playbook names no DR vault, which that option does not build", () => {
    const playbook = set.byService.get("key-vault");
    const doc = minimalDoc(playbook.armTypes.map((type) => playbookRow(playbook, type, "paired-failover-split")));
    const rows = runbookSkeleton({ doc, playbooks: set.byService }).text.split("\n").filter((line) => /^\| Failback \d+ \| /.test(line));
    assert.ok(rows.length > 0);
    assert.deepEqual(rows.filter((row) => /DR vault/.test(row)), []);
});
