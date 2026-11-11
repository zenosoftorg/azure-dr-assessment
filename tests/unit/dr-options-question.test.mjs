import assert from "node:assert/strict";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import {
    applyChoices, classifyType, parseReply, questionText, recommend, tierLimits,
} from "../../skills/azure-dr-assessment/scripts/lib/dr-options.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { tierBands } from "../../skills/azure-dr-assessment/scripts/lib/tiers.mjs";
import {
    DR, GADGETS, NICS, PAIR, PRIMARY, TODAY, WIDGETS,
    claimInput, fixturePlaybook, ledgerFrom, standardInputs, writeFixturePack,
} from "../helpers/dr-options-fixture.mjs";

const bands = tierBands(await loadPack(writeFixturePack()));
const REGIONS = { primary: PRIMARY, dr: DR, primaryPair: PAIR, paired: false };
const DISKS = "microsoft.test/widgetdisks";
const widget = fixturePlaybook();
const STANDARD = ledgerFrom().entries;
const limits = tierLimits({ tier: 1, bands });
const row = (fields) => recommend(classifyType({ count: 1, entries: STANDARD, regions: REGIONS, today: TODAY, ...fields }), limits);
const asked = (r, short) => ({ ...r, short, ask: true });
const refusal = (fn) => {
    try {
        fn();
    } catch (e) {
        assert.ok(e instanceof CliError);
        assert.equal(e.code, EXIT.INPUT);
        return e.details;
    }
    return assert.fail("expected a CliError");
};

const widgets = (count = 3) => asked(row({ type: WIDGETS, playbook: widget, count }), "TS");
const disks = (count = 2, fields = {}) => ({ ...asked(row({ type: DISKS, playbook: widget, count }), "TS2"), ...fields });
const gadgets = () => asked(row({ type: GADGETS }), "GA");
const nics = (count = 2) => asked(row({ type: NICS, count }), "NE");
const publicIps = () => asked(row({ type: "microsoft.network/publicipaddresses", count: 1 }), "PIA");

test("a gap-only row is not a block: it appears in one open-gaps line before the reply line", () => {
    const text = questionText([widgets(), nics(), gadgets(), publicIps()], { dr: DR });
    assert.ok(!text.includes("**Network Interface**") && !text.includes("**Public IPs**"));
    assert.equal(text.split("\n\n").length, 4);
    assert.equal(text.split("\n\n").at(-2), "No DR option found, recorded as open gaps: Network Interface, Public IPs.");
    assert.equal(text.split("\n\n").at(-1), "Reply e.g. TS 1, GA 2, or accept recommendations.");
});

test("when every asked row is gap-only the question is null: the defaults step records them", () => {
    assert.equal(questionText([nics(), publicIps()], { dr: DR }), null);
    assert.equal(questionText([nics(), { ...widgets(), ask: false }], { dr: DR }), null);
});

test("a gap-only row is skipped by accept recommendations and refused by name", () => {
    const rows = [widgets(), nics(), gadgets()];
    assert.deepEqual(parseReply("accept recommendations", rows), [
        { type: WIDGETS, option: "second-copy" }, { type: GADGETS, option: "gadget-copy" },
    ]);
    assert.deepEqual(refusal(() => parseReply("NE 1", rows)), ["NE is not a service of the question (TS, GA)"]);
    assert.deepEqual(parseReply("accept", [nics()]), []);
});

test("a gap-only row is recorded as a default by the defaults step, never as an owner choice", () => {
    const doc = { types: [widgets(), nics()].map((r) => ({ ...r, decidedBy: null, ask: true })) };
    const result = applyChoices({ choices: [], doc, picks: parseReply("accept recommendations", doc.types), by: "Application owner", today: TODAY, defaults: true });
    assert.deepEqual(result.recorded.map((r) => r.type), [WIDGETS]);
    assert.deepEqual(result.defaulted, [NICS]);
    assert.deepEqual(result.choices.find((c) => c.type === NICS), { type: NICS, option: "accept-gap", chosen_by: "default", date: TODAY, recommended: true });
});

test("a playbook that covers two types gives one block with the summed count and both types", () => {
    const text = questionText([widgets(3), disks(2), gadgets()], { dr: DR });
    const blocks = text.split("\n\n");
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].split("\n")[0], "**Test Service** (5 resources: microsoft.test/widgets, microsoft.test/widgetdisks). No native DR into germanywestcentral.");
    assert.equal(blocks[0].split("\n").length, 4);
    assert.match(blocks[1], /^\*\*Gadgets\*\* \(1 resource\)\. /);
    assert.equal(blocks[2], "Reply e.g. TS 1, GA 2, or accept recommendations.");
    assert.equal(text.split("\n\n")[0].split("\n")[1], "1. Second copy in the DR region. Estimated RPO: 15m; RTO: 30m. Gives up: platform-managed failover. **Recommended (meets Tier 1).**");
});

test("the group's short name answers for every type; the other short is an alias; naming the group twice is refused", () => {
    const rows = [widgets(), disks(), gadgets()];
    assert.deepEqual(parseReply("TS 2, ga 1", rows), [
        { type: WIDGETS, option: "pair-split" }, { type: DISKS, option: "pair-split" }, { type: GADGETS, option: "gadget-copy" },
    ]);
    assert.deepEqual(parseReply("ts2 1", rows), [{ type: WIDGETS, option: "second-copy" }, { type: DISKS, option: "second-copy" }]);
    assert.deepEqual(refusal(() => parseReply("TS 1, TS2 1", rows)), ["TS2 is answered twice"]);
    assert.deepEqual(refusal(() => parseReply("TS2 1, TS 2", rows)), ["TS is answered twice"]);
    assert.deepEqual(refusal(() => parseReply("TS 9", rows)), ["TS 9: choose a number from 1 to 3"]);
    assert.deepEqual(parseReply("accept recommendations", rows).map((p) => p.type), [WIDGETS, DISKS, GADGETS]);
});

test("rows of one playbook stay separate blocks when their options, recommendation or stale claims differ", () => {
    const base = [widgets(), disks()];
    assert.equal(questionText(base, { dr: DR }).split("\n\n").length, 2);

    const fewer = disks(2, { options: disks().options.slice(1) });
    const options = questionText([widgets(), fewer], { dr: DR });
    assert.equal(options.split("\n\n").length, 3);
    assert.match(options, /^\*\*Test Service\*\* \(3 resources\)\. [^]*\n\n\*\*Test Service\*\* \(2 resources\)\. /);

    const other = disks(2, { recommended: "pair-split" });
    assert.equal(questionText([widgets(), other], { dr: DR }).split("\n\n").length, 3);

    const entries = ledgerFrom([standardInputs()[0], claimInput(DISKS, "test-service", "Restores stay in the geography", false)]).entries;
    const stale = asked(row({ type: DISKS, playbook: widget, entries, count: 2 }), "TS2");
    assert.ok(stale.staleClaims.length > 0);
    assert.equal(questionText([widgets(), stale], { dr: DR }).split("\n\n").length, 3);

    const separate = [widgets(), fewer];
    assert.deepEqual(parseReply("TS 1, TS2 1", separate), [{ type: WIDGETS, option: "second-copy" }, { type: DISKS, option: "pair-split" }]);
});

test("rows without a playbook are never grouped", () => {
    const a = { ...gadgets(), short: "GA" };
    const b = { ...gadgets(), type: "microsoft.example/gizmos", title: "gizmos", short: "GI" };
    const text = questionText([a, b], { dr: DR });
    assert.equal(text.split("\n\n").length, 3);
    assert.match(text, /^\*\*Gadgets\*\* \(1 resource\)\. /);
});

test("the reply example never names a number above a block's option count", () => {
    const small = (r) => ({ ...r, options: [r.options[0], r.options.at(-1)], recommended: r.options[0].id });
    const text = questionText([small(gadgets()), small(widgets())], { dr: DR });
    assert.equal(text.split("\n\n").at(-1), "Reply e.g. GA 1, TS 2, or accept recommendations.");
    for (const block of text.split("\n\n").slice(0, 2)) assert.equal(block.split("\n").length, 3);
    assert.equal(questionText([widgets(), gadgets()], { dr: DR }).split("\n\n").at(-1), "Reply e.g. TS 1, GA 2, or accept recommendations.");
});

test("with one block the reply example has one example", () => {
    assert.equal(questionText([widgets(), nics()], { dr: DR }).split("\n\n").at(-1), "Reply e.g. TS 1, or accept recommendations.");
    assert.equal(questionText([widgets(), disks()], { dr: DR }).split("\n\n").at(-1), "Reply e.g. TS 1, or accept recommendations.");
});

test("a trailing period after an item is accepted", () => {
    const rows = [widgets(), gadgets()];
    assert.deepEqual(parseReply("TS 1.", rows), [{ type: WIDGETS, option: "second-copy" }]);
    assert.deepEqual(parseReply("TS 1, GA 2.", rows), [{ type: WIDGETS, option: "second-copy" }, { type: GADGETS, option: "gadget-rebuild" }]);
    assert.deepEqual(refusal(() => parseReply("TS one.", rows)), ["\"TS one.\" is not a short name and a number, such as TS 1"]);
});
