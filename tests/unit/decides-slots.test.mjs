import assert from "node:assert/strict";
import test from "node:test";
import { buildDrOptions, classifyType } from "../../skills/azure-dr-assessment/scripts/lib/dr-options.mjs";
import { lintPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbook-lint.mjs";
import { OPTIONAL_OPTION_FIELDS, parsePlaybook, readPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { tierBands } from "../../skills/azure-dr-assessment/scripts/lib/tiers.mjs";
import { DR, PAIR, PRIMARY, TODAY, WIDGETS, fixtureAssessment, inventoryFor, ledgerFrom, standardInputs, writeFixturePack } from "../helpers/dr-options-fixture.mjs";
import { PLAYBOOK_BODIES, playbookMarkdown, writePlaybooks } from "../helpers/playbook-fixture.mjs";

const OPTIONS = PLAYBOOK_BODIES.find(([title]) => title === "Non-paired options")[1];
const decides = (value) => ({ "Non-paired options": OPTIONS.replace("- Recommended when: the DR region is not the pair.", `- Recommended when: the DR region is not the pair.\n- Decides slots: ${value}`) });
const UNPAIRED = { primary: PRIMARY, dr: DR, primaryPair: PAIR, paired: false };
const DNS = { slot: "traffic-dns", candidate: { source: "pattern", pattern: "DR-TEST-DNS", version: 1 } };

test("an option may name the slots it decides itself; the field is optional and parsed as a list", () => {
    assert.deepEqual(OPTIONAL_OPTION_FIELDS, ["Decides slots"]);
    const { playbook, problems } = parsePlaybook(playbookMarkdown({ sections: decides("traffic-dns, ingress") }), "test-service.md");
    assert.deepEqual(problems, []);
    assert.deepEqual(playbook.options.map((o) => [o.id, o.decidesSlots]), [["second-copy", ["traffic-dns", "ingress"]], ["pair-split", []]]);
});

test("the lint refuses a Decides slots value that is not a slot id", async () => {
    const findings = lintPlaybooks(await readPlaybooks(writePlaybooks([{ sections: decides("traffic-dns, teleport") }])), { today: TODAY });
    assert.deepEqual(findings.map((f) => [f.rule, f.message]), [["option-field", 'option "second-copy": Decides slots names "teleport", which is not a slot id (see patterns/README.md)']]);
});

test("an option that decides a slot that a company pattern decides is vetoed, so the next option is recommended (GC-11)", async () => {
    const { set } = await readPlaybooks(writePlaybooks([{ sections: decides("traffic-dns") }]));
    const playbook = set.byType.get(WIDGETS);
    const entries = ledgerFrom(standardInputs()).entries;
    const free = classifyType({ type: WIDGETS, count: 1, playbook, entries, regions: UNPAIRED, today: TODAY });
    assert.deepEqual(free.vetoed, []);
    const ruled = classifyType({ type: WIDGETS, count: 1, playbook, entries, regions: UNPAIRED, today: TODAY, decidedSlots: { "traffic-dns": { source: "pattern", ref: "DR-TEST-DNS v1" } } });
    assert.deepEqual(ruled.vetoed.map(({ id, reason }) => ({ id, reason })), [{ id: "second-copy", reason: "DR-TEST-DNS v1 decides the slot traffic-dns, which this option would decide too" }]);
    assert.deepEqual(ruled.options.map((o) => o.id), ["pair-split", "accept-gap"]);
    const doc = buildDrOptions({
        assessment: fixtureAssessment(), resources: inventoryFor().resources, entries, playbooks: set, slots: [DNS],
        bands: tierBands(await loadPack(writeFixturePack())), today: TODAY, generatedAt: "2026-11-09T12:00:00.000Z",
    });
    assert.deepEqual(doc.types.find((row) => row.type === WIDGETS).vetoed.map((v) => v.id), ["second-copy"]);
});
