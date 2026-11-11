import assert from "node:assert/strict";
import test from "node:test";
import {
    buildDrOptions, choiceStatus, classifyType, finishRows, questionText, tierLimits, typeCounts,
} from "../../skills/azure-dr-assessment/scripts/lib/dr-options.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { readPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { resolveSlots } from "../../skills/azure-dr-assessment/scripts/lib/resolve.mjs";
import { tierBands } from "../../skills/azure-dr-assessment/scripts/lib/tiers.mjs";
import {
    DR, GADGETS, NATIVES, NICS, PAIR, PRIMARY, TODAY, WIDGETS,
    claimInput, fixtureAssessment, fixturePlaybook, inventoryFor, ledgerFrom, mechanismInput, standardInputs, writeFixturePack, writeFixturePlaybooks,
} from "../helpers/dr-options-fixture.mjs";

const pack = await loadPack(writeFixturePack());
const bands = tierBands(pack);
const { set } = await readPlaybooks(writeFixturePlaybooks(), { isDefault: false });
const REGIONS = { primary: PRIMARY, dr: DR, primaryPair: PAIR, paired: false };
const STANDARD = ledgerFrom().entries;
const widget = fixturePlaybook();
const ROW_KEYS = [
    "type", "short", "title", "count", "slot", "playbook", "verifiedOn", "playbookStale", "decidedBy", "path", "verified", "staleClaims",
    "options", "vetoed", "recommended", "recommendationNote", "ask", "choice",
];
const OPTION_KEYS = ["id", "title", "kind", "target", "targetRegion", "rpo", "rto", "rpoSeconds", "rtoSeconds", "source", "status", "meetsTier", "residency", "givesUp", "ledger"];
const choice = (type, option, chosen_by = "Application owner") => ({ type, option, chosen_by, date: TODAY, recommended: false });
const build = (fields = {}) => {
    const assessment = fields.assessment ?? fixtureAssessment();
    return buildDrOptions({
        assessment, resources: inventoryFor().resources, entries: STANDARD, playbooks: set, slots: resolveSlots(assessment, pack).slots, bands,
        today: TODAY, generatedAt: "2026-11-09T12:00:00.000Z", playbooksDir: "playbooks", nonDefaultPlaybooks: true, ...fields,
    });
};

test("typeCounts counts the types in lower case, most frequent first, ties by code unit", () => {
    const resources = [{ armType: "B/x" }, { armType: "a/y" }, { armType: "b/x" }, { armType: "c/z" }, { armType: null }, {}];
    assert.deepEqual(typeCounts(resources), [["b/x", 2], ["a/y", 1], ["c/z", 1]]);
});

test("choiceStatus: a known option is valid; a vetoed or unknown option and a type out of scope are invalid with the problem", () => {
    const row = classifyType({ type: WIDGETS, count: 1, playbook: widget, entries: STANDARD, regions: REGIONS, today: TODAY });
    assert.deepEqual(choiceStatus(choice(WIDGETS, "pair-split"), row), { status: "valid", problem: null });
    assert.deepEqual(choiceStatus(choice(WIDGETS, "accept-gap"), row), { status: "valid", problem: null });
    assert.deepEqual(choiceStatus(choice(WIDGETS, "third-copy"), row), {
        status: "invalid", problem: "third-copy is not an option of microsoft.test/widgets (options: second-copy, pair-split, accept-gap)",
    });
    const vetoed = classifyType({ type: WIDGETS, count: 1, playbook: widget, entries: ledgerFrom([standardInputs()[0], { ...standardInputs()[5], class: "none" }]).entries, regions: REGIONS, today: TODAY });
    assert.deepEqual(choiceStatus(choice(WIDGETS, "pair-split"), vetoed), {
        status: "invalid", problem: "pair-split is vetoed in this run: the mechanism has no multiregion replication",
    });
    assert.deepEqual(choiceStatus(choice(GADGETS, "gadget-copy"), undefined), { status: "invalid", problem: "microsoft.example/gadgets is not an in-scope type of this run" });
});

test("finishRows sets the short names, the recommendation, the recorded choice and ask", () => {
    const rows = [[WIDGETS, widget], [NICS, null], [GADGETS, null]].map(([type, playbook]) => classifyType({ type, count: 1, playbook, entries: STANDARD, regions: REGIONS, today: TODAY }));
    const limits = tierLimits({ tier: 1, bands });
    const plain = finishRows(rows, { limits });
    assert.deepEqual(plain.map((r) => [r.short, r.recommended, r.ask, r.choice]), [["TS", "second-copy", true, null], ["NIC", "accept-gap", true, null], ["GA", "gadget-copy", true, null]]);
    assert.deepEqual(plain.map((r) => Object.keys(r)), [ROW_KEYS, ROW_KEYS, ROW_KEYS]);

    const chosen = finishRows(rows, { limits, choices: [choice(WIDGETS, "pair-split"), choice(GADGETS, "gadget-gone", "default")] });
    assert.deepEqual(chosen[0].choice, { option: "pair-split", chosen_by: "Application owner", date: TODAY, recommended: false, status: "valid", problem: null });
    assert.equal(chosen[0].ask, false);
    assert.deepEqual([chosen[2].choice.status, chosen[2].choice.problem, chosen[2].ask], ["invalid", "gadget-gone is not an option of microsoft.example/gadgets (options: gadget-copy, gadget-rebuild, accept-gap)", true]);

    const decided = rows.map((r) => ({ ...r, decidedBy: { source: "pattern", ref: "DR-TEST-001 v1" } }));
    assert.deepEqual(finishRows(decided, { limits }).map((r) => r.ask), [false, false, false]);
    assert.deepEqual(finishRows(decided, { limits, askTypes: [GADGETS] }).map((r) => r.ask), [false, false, true]);

    const native = classifyType({ type: NATIVES, count: 1, playbook: set.byType.get(NATIVES), entries: STANDARD, regions: REGIONS, today: TODAY });
    const offline = classifyType({ type: NATIVES, count: 1, playbook: set.byType.get(NATIVES), entries: ledgerFrom(standardInputs({ learnReachable: false })).entries, regions: REGIONS, today: TODAY });
    assert.deepEqual(finishRows([native, offline], { limits }).map((r) => [r.path, r.verified, r.ask]), [["native", true, false], ["native", false, true]]);
});

test("buildDrOptions writes the document of contracts 6.2 for the fixture run", () => {
    const doc = build();
    assert.deepEqual(Object.keys(doc), ["schemaVersion", "generatedAt", "assessment", "tier", "regions", "playbooksDir", "nonDefaultPlaybooks", "types", "question", "warnings"]);
    assert.deepEqual(
        { ...doc, types: undefined, question: undefined },
        {
            schemaVersion: 1, generatedAt: "2026-11-09T12:00:00.000Z", assessment: "assessment.yaml", tier: 1, regions: REGIONS,
            playbooksDir: "playbooks", nonDefaultPlaybooks: true, types: undefined, question: undefined, warnings: [],
        },
    );
    assert.deepEqual(doc.types.map((r) => [r.type, r.count, r.short, r.slot, r.playbook, r.path, r.verified, r.recommended, r.ask]), [
        [WIDGETS, 3, "TS", "compute", "test-service v1", "workaround", true, "second-copy", true],
        [NICS, 2, "NIC", null, null, "none", true, "accept-gap", true],
        [NATIVES, 2, "TN", "data-replication.relational", "test-native v1", "native", true, "geo-replica", false],
        [GADGETS, 1, "GA", "compute", null, "workaround", false, "gadget-copy", true],
    ]);
    for (const row of doc.types) {
        assert.deepEqual(Object.keys(row), ROW_KEYS);
        for (const option of row.options) assert.deepEqual(Object.keys(option), OPTION_KEYS);
    }
    assert.equal(doc.question, questionText(doc.types, { dr: DR }));
    assert.match(doc.question, /\n\nNo DR option found, recorded as open gaps: Network Interface\.\n\nReply e\.g\. TS 1, GA 2, or accept recommendations\.$/);
    assert.ok(!doc.question.includes("**Network Interface**"));
});

test("buildDrOptions: a pattern decides a slot, --ask-type asks anyway, and the warnings name what is missing or old", async () => {
    const withPattern = await loadPack(writeFixturePack([{ id: "DR-TEST-001", slots: ["compute"] }]));
    const assessment = fixtureAssessment();
    const doc = build({
        assessment, slots: resolveSlots(assessment, withPattern).slots, askTypes: [GADGETS, "microsoft.test/missing"], today: "2027-02-15",
        entries: ledgerFrom(standardInputs().filter((input) => input.check !== "pair")).entries,
    });
    assert.deepEqual(doc.types.map((r) => [r.type, r.decidedBy, r.ask]), [
        [WIDGETS, { source: "pattern", ref: "DR-TEST-001 v1" }, false],
        [NICS, null, true],
        [NATIVES, null, false],
        [GADGETS, { source: "pattern", ref: "DR-TEST-001 v1" }, true],
    ]);
    assert.deepEqual(doc.regions, { primary: PRIMARY, dr: DR, primaryPair: null, paired: false });
    assert.match(doc.question, /\*\*Gadgets\*\* \(1 resource\)\. No native DR into germanywestcentral\. Decided by DR-TEST-001 v1, which Azure reality vetoes\.\n/);
    assert.deepEqual(doc.warnings, [
        "the ledger has no pair entry for swedencentral|germanywestcentral: the DR region counts as not paired and the pair region is unknown",
        "--ask-type microsoft.test/missing is not an in-scope type of this run",
        "playbook test-service v1 was verified on 2026-11-01, more than 90 days before 2027-02-15",
        "playbook test-native v1 was verified on 2026-11-01, more than 90 days before 2027-02-15",
    ]);
    assert.deepEqual(doc.types.filter((r) => r.playbookStale).map((r) => r.type), [WIDGETS, NATIVES]);
});

test("buildDrOptions warns about a mechanism entry that names no mechanism of the playbook, or none", () => {
    const entries = ledgerFrom([
        ...standardInputs(),
        mechanismInput(WIDGETS, "Geo-replication by another name", "any-pair"),
        { ...mechanismInput(WIDGETS, "x", "any-pair", "Unverified"), result: {} },
        mechanismInput(NICS, "A mechanism of a type without a playbook", "none"),
    ]).entries;
    const doc = build({ entries });
    assert.deepEqual(doc.warnings, [
        "ledger entry R-0010 is a mechanism of microsoft.test/widgets that names no mechanism of playbook test-service v1",
        "ledger entry R-0011 is a mechanism of microsoft.test/widgets that names no mechanism of playbook test-service v1",
    ]);
    assert.equal(doc.types[0].path, "workaround");
});

test("buildDrOptions warns about a playbook-claim entry whose claim is no constraint of the playbook, or of another playbook", () => {
    const entries = ledgerFrom([
        ...standardInputs(),
        claimInput(WIDGETS, "test-service", "A constraint the playbook does not have"),
        claimInput(WIDGETS, "other-service", "Restores stay in the geography"),
        claimInput(WIDGETS, "test-service", "restores stay in the geography", true, "Unverified"),
    ]).entries;
    const doc = build({ entries });
    assert.deepEqual(doc.warnings, [
        "ledger entry R-0010 is a playbook-claim of microsoft.test/widgets that names no constraint of playbook test-service v1",
        "ledger entry R-0011 is a playbook-claim of microsoft.test/widgets that names playbook other-service, not test-service v1",
        "ledger entry R-0012 is a playbook-claim of microsoft.test/widgets that names no constraint of playbook test-service v1",
    ]);
});

test("buildDrOptions: mixed-case ledger subjects still match, and warn about nothing", () => {
    const mixed = (input) => {
        if (input.check === "mechanism") return { ...input, subject: input.subject.replace("test/", "Test/") };
        if (input.check === "pair" || input.check === "geography") return { ...input, subject: input.subject.toUpperCase() };
        return input;
    };
    const doc = build({ entries: ledgerFrom(standardInputs().map(mixed)).entries });
    assert.deepEqual(doc.warnings, []);
    assert.deepEqual(doc.regions, build().regions);
    assert.deepEqual(doc.types.map((r) => [r.type, r.path, r.verified]), build().types.map((r) => [r.type, r.path, r.verified]));
    assert.equal(doc.types[0].options[0].status, "valid");
});
