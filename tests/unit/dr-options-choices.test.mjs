import assert from "node:assert/strict";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { applyChoices, buildDrOptions, validateChoices, withChoices } from "../../skills/azure-dr-assessment/scripts/lib/dr-options.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { readPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { resolveSlots } from "../../skills/azure-dr-assessment/scripts/lib/resolve.mjs";
import { tierBands } from "../../skills/azure-dr-assessment/scripts/lib/tiers.mjs";
import {
    DR, GADGETS, NATIVES, NICS, PAIR, TODAY, WIDGETS,
    fixtureAssessment, inventoryFor, ledgerFrom, standardInputs, writeFixturePack, writeFixturePlaybooks,
} from "../helpers/dr-options-fixture.mjs";

const pack = await loadPack(writeFixturePack());
const { set } = await readPlaybooks(writeFixturePlaybooks(), { isDefault: false });
const docFor = ({ assessment = fixtureAssessment(), inputs = standardInputs(), slots = resolveSlots(assessment, pack).slots } = {}) => buildDrOptions({
    assessment, resources: inventoryFor().resources, entries: ledgerFrom(inputs).entries, playbooks: set, slots, bands: tierBands(pack),
    today: TODAY, generatedAt: "2026-11-09T12:00:00.000Z",
});
const DOC = docFor();
const entry = (type, option, chosen_by = "Application owner", fields = {}) => ({ type, option, chosen_by, date: "2026-11-01", recommended: false, ...fields });
const refused = (fn, details) => assert.throws(fn, (e) => {
    assert.ok(e instanceof CliError);
    assert.equal(e.code, EXIT.INPUT);
    assert.equal(e.message, "the choices could not be recorded, so nothing was written");
    assert.deepEqual(e.details, details);
    return true;
});

test("validateChoices names a duplicate, an unknown type, an unknown and a vetoed option, and warns on residency", () => {
    const crosses = docFor({ inputs: standardInputs({ residency: "crosses" }), assessment: fixtureAssessment({ constraints: { data_residency: "EU only" } }) });
    assert.deepEqual(validateChoices([entry(WIDGETS, "second-copy"), entry(GADGETS, "gadget-copy")], crosses), {
        problems: [],
        residencyWarnings: [{ type: WIDGETS, option: "second-copy", targetRegion: DR }, { type: GADGETS, option: "gadget-copy", targetRegion: DR }],
    });
    const vetoed = docFor({ inputs: standardInputs().map((input) => (input.check === "mechanism" && input.subject === WIDGETS ? { ...input, class: "none" } : input)) });
    assert.deepEqual(validateChoices([
        entry(WIDGETS, "pair-split"), entry(WIDGETS, "second-copy"), entry("microsoft.test/gone", "x"), entry(GADGETS, "gadget-gone"),
    ], vetoed).problems, [
        { index: 0, type: WIDGETS, option: "pair-split", problem: "pair-split is vetoed in this run: the mechanism has no multiregion replication" },
        { index: 1, type: WIDGETS, option: "second-copy", problem: "microsoft.test/widgets already has an entry (dr_choices[0])" },
        { index: 2, type: "microsoft.test/gone", option: "x", problem: "microsoft.test/gone is not an in-scope type of this run" },
        { index: 3, type: GADGETS, option: "gadget-gone", problem: "gadget-gone is not an option of microsoft.example/gadgets (options: gadget-copy, gadget-rebuild, accept-gap)" },
    ]);
    assert.deepEqual(validateChoices([], DOC), { problems: [], residencyWarnings: [] });
});

test("applyChoices records the owner's picks with the role, the date and whether each was the recommendation", () => {
    const r = applyChoices({ choices: [entry(NICS, "accept-gap", "default", { recommended: true })], doc: DOC, picks: [{ type: WIDGETS, option: "second-copy" }, { type: NICS, option: "accept-gap" }], by: "Application owner", today: TODAY });
    assert.deepEqual(r, {
        choices: [
            { type: NICS, option: "accept-gap", chosen_by: "Application owner", date: TODAY, recommended: true },
            { type: WIDGETS, option: "second-copy", chosen_by: "Application owner", date: TODAY, recommended: true },
        ],
        recorded: [{ type: WIDGETS, option: "second-copy", chosen_by: "Application owner" }, { type: NICS, option: "accept-gap", chosen_by: "Application owner" }],
        defaulted: [], refreshed: [], replaced: [], openDecisions: [],
    });
});

test("applyChoices refuses every bad pick at once and records nothing", async () => {
    const patterned = await loadPack(writeFixturePack([{ id: "DR-TEST-001", slots: ["compute"] }]));
    const assessment = fixtureAssessment();
    const decided = docFor({ assessment, slots: resolveSlots(assessment, patterned).slots });
    refused(() => applyChoices({
        choices: [], doc: decided, by: "Owner", today: TODAY,
        picks: [{ type: WIDGETS, option: "pair-split" }, { type: NICS, option: "gone" }, { type: NICS, option: "accept-gap" }, { type: "microsoft.test/gone", option: "x" }],
    }), [
        "microsoft.test/widgets is decided by DR-TEST-001 v1; the interview does not override it",
        "gone is not an option of microsoft.network/networkinterfaces (options: accept-gap)",
        "microsoft.network/networkinterfaces is answered twice",
        "microsoft.test/gone is not an in-scope type of this run",
    ]);
});

test("applyChoices --defaults fills every asked type, refreshes a changed default, replaces an invalid entry and keeps an owner's choice", () => {
    const r = applyChoices({
        choices: [
            entry(WIDGETS, "pair-split", "default", { recommended: true }),
            entry(GADGETS, "gadget-gone", "Application owner"),
            entry("microsoft.test/gone", "x", "default"),
            entry(NATIVES, "geo-replica", "Data owner"),
        ],
        doc: DOC, today: TODAY, defaults: true,
    });
    assert.deepEqual(r.choices, [
        { type: WIDGETS, option: "second-copy", chosen_by: "default", date: TODAY, recommended: true },
        { type: GADGETS, option: "gadget-copy", chosen_by: "default", date: TODAY, recommended: true },
        { type: NATIVES, option: "geo-replica", chosen_by: "Data owner", date: "2026-11-01", recommended: false },
        { type: NICS, option: "accept-gap", chosen_by: "default", date: TODAY, recommended: true },
    ]);
    assert.deepEqual(r.recorded, []);
    assert.deepEqual(r.defaulted, [NICS]);
    assert.deepEqual(r.refreshed, [{ type: WIDGETS, from: "pair-split", to: "second-copy" }]);
    assert.deepEqual(r.replaced, [
        { type: "microsoft.test/gone", option: null, problem: "microsoft.test/gone is not an in-scope type of this run" },
        { type: GADGETS, option: "gadget-copy", problem: "gadget-gone is not an option of microsoft.example/gadgets (options: gadget-copy, gadget-rebuild, accept-gap)" },
    ]);
    assert.deepEqual(r.openDecisions, [WIDGETS, GADGETS, NICS]);
});

test("applyChoices: answers come first and --defaults fills the rest; an unchanged default keeps its date", () => {
    const first = applyChoices({ choices: [], doc: DOC, picks: [{ type: GADGETS, option: "gadget-rebuild" }], by: "Application owner", today: TODAY, defaults: true });
    assert.deepEqual(first.choices.map((c) => [c.type, c.option, c.chosen_by, c.recommended]), [
        [GADGETS, "gadget-rebuild", "Application owner", false],
        [WIDGETS, "second-copy", "default", true],
        [NICS, "accept-gap", "default", true],
    ]);
    assert.deepEqual([first.defaulted, first.openDecisions], [[WIDGETS, NICS], [WIDGETS, NICS]]);
    const kept = [entry(WIDGETS, "second-copy", "default", { recommended: true })];
    const again = applyChoices({ choices: kept, doc: withChoices(DOC, kept), today: TODAY, defaults: true });
    assert.deepEqual(again.choices[0], kept[0]);
    assert.deepEqual(again.refreshed, []);
});

test("withChoices sets every row's choice from dr_choices and leaves the rest of the document", () => {
    const doc = withChoices(DOC, [entry(WIDGETS, "pair-split"), entry(GADGETS, "gadget-gone")]);
    assert.deepEqual(doc.types.map((row) => row.choice?.status ?? null), ["valid", null, null, "invalid"]);
    assert.deepEqual(doc.types[0].choice, { option: "pair-split", chosen_by: "Application owner", date: "2026-11-01", recommended: false, status: "valid", problem: null });
    assert.deepEqual({ ...doc, types: null }, { ...DOC, types: null });
    assert.deepEqual(DOC.types.map((row) => row.choice), [null, null, null, null]);
    assert.equal(PAIR, DOC.regions.primaryPair);
});
