import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { isDefaultChoice } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { applyChoices, buildDrOptions, withChoices } from "../../skills/azure-dr-assessment/scripts/lib/dr-options.mjs";
import { MINI_TEMPLATE, PLAYBOOKS, fixtureDoc } from "../helpers/guide-fixture.mjs";
import { guideSkeleton } from "../../skills/azure-dr-assessment/scripts/lib/guide.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { readPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { resolveSlots } from "../../skills/azure-dr-assessment/scripts/lib/resolve.mjs";
import { tierBands } from "../../skills/azure-dr-assessment/scripts/lib/tiers.mjs";
import { TODAY, WIDGETS, fixtureAssessment, inventoryFor, ledgerFrom, standardInputs, writeFixturePack, writeFixturePlaybooks } from "../helpers/dr-options-fixture.mjs";
import { dnsSpec, sampleAssessment } from "../helpers/resolve-fixture.mjs";
import { writePatterns } from "../helpers/pack-fixture.mjs";
import { tierSpec } from "../helpers/tier-fixture.mjs";

const skill = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment");
const flat = (text) => text.replace(/\s+/g, " ");

test("isDefaultChoice reads chosen_by default in any case and with surrounding space; a role is not a default", () => {
    for (const by of ["default", "Default", " DEFAULT "]) assert.equal(isDefaultChoice(by), true, by);
    for (const by of ["Application owner", "defaults", "", null, undefined]) assert.equal(isDefaultChoice(by), false, String(by));
});

test("a Default accept-gap entry is not a documented exception, whatever its case", async () => {
    const choice = (chosen_by) => ({ type: "microsoft.storage/storageaccounts", option: "accept-gap", chosen_by, date: "2026-11-09", recommended: true });
    const pack = await loadPack(writePatterns([tierSpec(), dnsSpec()]));
    for (const by of ["Default", "DEFAULT"]) {
        assert.deepEqual(resolveSlots(sampleAssessment({ dr_choices: [choice(by)] }), pack).documentedExceptions, [], by);
    }
});

test("--defaults refreshes a stale Default entry and lists it as an open decision; the guide says Default", async () => {
    const pack = await loadPack(writeFixturePack());
    const { set } = await readPlaybooks(writeFixturePlaybooks(), { isDefault: false });
    const assessment = fixtureAssessment();
    const doc = buildDrOptions({
        assessment, resources: inventoryFor().resources, entries: ledgerFrom(standardInputs()).entries, playbooks: set, slots: resolveSlots(assessment, pack).slots,
        bands: tierBands(pack), today: TODAY, generatedAt: "2026-11-09T12:00:00.000Z",
    });
    const stale = [{ type: WIDGETS, option: "pair-split", chosen_by: "Default", date: "2026-11-01", recommended: true }];
    const r = applyChoices({ choices: stale, doc: withChoices(doc, stale), today: TODAY, defaults: true });
    assert.deepEqual(r.refreshed, [{ type: WIDGETS, from: "pair-split", to: "second-copy" }]);
    assert.ok(r.openDecisions.includes(WIDGETS));

    const guideDoc = fixtureDoc({ choices: [{ type: WIDGETS, option: "second-copy", chosen_by: "DEFAULT", date: TODAY, recommended: true }] });
    const { text } = guideSkeleton({ doc: guideDoc, playbooks: PLAYBOOKS, template: MINI_TEMPLATE });
    assert.match(text, /^- Chosen by: Default: nobody chose, so the recommendation of 2026-11-09 applies\. It is an open decision for the owner\.$/m);
});

test("--defaults refreshes a stale default even when the question asks nothing, and stage 5 always runs the record step of stage 5b", async () => {
    const pack = await loadPack(writeFixturePack());
    const { set } = await readPlaybooks(writeFixturePlaybooks(), { isDefault: false });
    const assessment = fixtureAssessment();
    const doc = buildDrOptions({
        assessment, resources: inventoryFor().resources, entries: ledgerFrom(standardInputs()).entries, playbooks: set, slots: resolveSlots(assessment, pack).slots,
        bands: tierBands(pack), today: TODAY, generatedAt: "2026-11-09T12:00:00.000Z",
    });
    const recorded = doc.types.map((row) => ({ type: row.type, option: row.recommended, chosen_by: "default", date: "2026-11-01", recommended: true }));
    recorded[recorded.findIndex((c) => c.type === WIDGETS)].option = "pair-split";
    const quiet = withChoices({ ...doc, types: doc.types.map((row) => ({ ...row, ask: false })) }, recorded);
    assert.ok(quiet.types.every((row) => !row.ask), "nothing is asked");
    assert.deepEqual(applyChoices({ choices: recorded, doc: quiet, today: TODAY, defaults: true }).refreshed, [{ type: WIDGETS, from: "pair-split", to: "second-copy" }]);

    const stage5 = flat(readFileSync(path.join(skill, "references", "stages", "05-region-analysis.md"), "utf8"));
    assert.match(stage5, /Then go to \[stage 5b\]\(05b-dr-options\.md\) in every run: when `ask` is empty it asks nothing and only runs its record step \(`--record --defaults`\), which refreshes a default whose recommendation changed\./);
    assert.ok(!stage5.includes("when `ask` is not empty, otherwise to stage 6"));
});
