import assert from "node:assert/strict";
import test from "node:test";
import {
    ACCEPT_GAP_TITLE, DR_PATHS, PATH_LABELS, VETO_DR_REGION, VETO_NO_MULTIREGION,
    classifyType, deciderOf, optionStatus, pairFacts, residencyOf, staleClaims,
} from "../../skills/azure-dr-assessment/scripts/lib/dr-options.mjs";
import { validateInventory } from "../../skills/azure-dr-assessment/scripts/lib/inventory.mjs";
import {
    DR, GADGETS, NATIVE_PLAYBOOK, NATIVES, NICS, PAIR, PRIMARY, TODAY, WIDGETS,
    claimInput, fixturePlaybook, geographyInput, inventoryFor, ledgerFrom, mechanismInput, optionInput, pairInput, standardInputs,
} from "../helpers/dr-options-fixture.mjs";

const UNPAIRED = { primary: PRIMARY, dr: DR, primaryPair: PAIR, paired: false };
const PAIRED = { ...UNPAIRED, paired: true };
const widget = fixturePlaybook();
const native = fixturePlaybook(NATIVE_PLAYBOOK);
const entriesOf = (inputs) => ledgerFrom(inputs).entries;
const STANDARD = entriesOf(standardInputs());
const classify = (fields) => classifyType({ count: 1, entries: STANDARD, regions: UNPAIRED, today: TODAY, ...fields });

test("the DR paths and their labels are those of the v3 contracts", () => {
    assert.deepEqual(DR_PATHS, ["native", "workaround", "split-region", "backup-restore", "none"]);
    assert.deepEqual(Object.values(PATH_LABELS), ["Native", "Workaround", "Split-region", "Backup-restore", "No path"]);
});

test("the fixture ledger validates and the fixture inventory is a valid inventory", () => {
    assert.deepEqual(ledgerFrom().validate(), { ok: true, errors: [] });
    assert.deepEqual(ledgerFrom(standardInputs({ learnReachable: false })).validate(), { ok: true, errors: [] });
    assert.deepEqual(validateInventory(inventoryFor()), { ok: true, errors: [] });
});

test("pairFacts reads the last pair entry of primary|dr, and paired needs a Verified entry", () => {
    assert.deepEqual(pairFacts(STANDARD, PRIMARY, DR), { regions: UNPAIRED, ledger: "R-0001" });
    const twice = entriesOf([standardInputs()[0], pairInput(), pairInput({ paired: true, primaryPair: DR })]);
    assert.deepEqual(pairFacts(twice, PRIMARY, DR), { regions: { primary: PRIMARY, dr: DR, primaryPair: DR, paired: true }, ledger: "R-0002" });
    const unverified = entriesOf([standardInputs()[0], pairInput({ paired: true, status: "Unverified" })]);
    assert.equal(pairFacts(unverified, PRIMARY, DR).regions.paired, false);
    assert.deepEqual(pairFacts([], PRIMARY, DR), { regions: { primary: PRIMARY, dr: DR, primaryPair: null, paired: false }, ledger: null });
    assert.equal(pairFacts(STANDARD, "westeurope", DR).ledger, null);
});

test("residencyOf: ok without a constraint, else the target's geography entry, unknown without one", () => {
    const entries = entriesOf([standardInputs()[0], geographyInput(DR, "Germany", "crosses"), geographyInput(PAIR, "Sweden", "ok")]);
    assert.equal(residencyOf(entries, DR, null), "ok");
    assert.equal(residencyOf(entries, DR, "EU only"), "crosses");
    assert.equal(residencyOf(entries, PAIR, "EU only"), "ok");
    assert.equal(residencyOf(entries, "westeurope", "EU only"), "unknown");
    assert.equal(residencyOf(entries, null, null), "unknown");
});

test("optionStatus follows the table of contracts 6.2.1 for a mechanism option", () => {
    const toDr = { id: "x", kind: "native", target: "dr-region", usesMechanism: "Test geo-replication", source: "playbook" };
    const toPair = { ...toDr, kind: "split-region", target: "pair-region" };
    const ledger = (cls, status = "Verified") => entriesOf([standardInputs()[0], mechanismInput(WIDGETS, "test GEO-replication", cls, status)]);
    const status = (option, entries, paired = false) => optionStatus(option, { type: WIDGETS, playbook: widget, entries, paired });
    assert.deepEqual(status(toDr, ledger("any-pair")), { status: "valid", vetoed: null, ledger: ["R-0001"] });
    assert.deepEqual(status(toDr, ledger("paired-only"), true), { status: "valid", vetoed: null, ledger: ["R-0001"] });
    assert.deepEqual(status(toDr, ledger("paired-only")), { status: "valid", vetoed: VETO_DR_REGION, ledger: ["R-0001"] });
    assert.deepEqual(status(toDr, ledger("none")), { status: "valid", vetoed: VETO_DR_REGION, ledger: ["R-0001"] });
    assert.deepEqual(status(toDr, ledger("any-pair", "Unverified")), { status: "unverified", vetoed: null, ledger: ["R-0001"] });
    assert.deepEqual(status(toDr, entriesOf([standardInputs()[0]])), { status: "unverified", vetoed: null, ledger: [] });
    assert.deepEqual(status(toPair, ledger("paired-only")), { status: "valid", vetoed: null, ledger: ["R-0001"] });
    assert.deepEqual(status(toPair, ledger("any-pair")), { status: "valid", vetoed: null, ledger: ["R-0001"] });
    assert.deepEqual(status(toPair, ledger("none")), { status: "valid", vetoed: VETO_NO_MULTIREGION, ledger: ["R-0001"] });
    assert.deepEqual(status(toPair, ledger("none", "Unverified")), { status: "unverified", vetoed: null, ledger: ["R-0001"] });
});

test("optionStatus: an option without a mechanism needs every constraint confirmed, a Learn option its entry, accept-gap nothing", () => {
    const own = { id: "second-copy", kind: "workaround", target: "dr-region", usesMechanism: "none", source: "playbook" };
    const claim = (status, agrees = true) => entriesOf([standardInputs()[0], claimInput(WIDGETS, "test-service", "Restores stay in the geography", agrees, status)]);
    const status = (entries, playbook = widget) => optionStatus(own, { type: WIDGETS, playbook, entries, paired: false });
    assert.deepEqual(status(claim("Verified")), { status: "valid", vetoed: null, ledger: ["R-0001"] });
    assert.deepEqual(status(claim("Verified", false)), { status: "valid", vetoed: null, ledger: ["R-0001"] });
    assert.deepEqual(status(claim("Unverified")), { status: "unverified", vetoed: null, ledger: ["R-0001"] });
    assert.deepEqual(status(entriesOf([standardInputs()[0], claimInput(WIDGETS, "other-service", "Restores stay in the geography")])), { status: "unverified", vetoed: null, ledger: [] });
    const learn = { id: "copy", source: "learn", entryStatus: "Unverified", ledger: ["R-0009"] };
    assert.deepEqual(optionStatus(learn, { type: GADGETS, entries: [], paired: false }), { status: "unverified", vetoed: null, ledger: ["R-0009"] });
    assert.deepEqual(optionStatus({ ...learn, entryStatus: "Verified" }, { type: GADGETS, entries: [], paired: false }).status, "valid");
    assert.deepEqual(optionStatus({ id: "accept-gap" }, { type: GADGETS, entries: [], paired: false }), { status: "valid", vetoed: null, ledger: [] });
});

test("staleClaims lists a mechanism whose class contradicts the playbook and a constraint Learn disagrees with", () => {
    assert.deepEqual(staleClaims({ type: WIDGETS, playbook: widget, entries: STANDARD }), []);
    assert.deepEqual(staleClaims({ type: GADGETS, playbook: null, entries: STANDARD }), []);
    const entries = entriesOf([
        standardInputs()[0],
        mechanismInput(WIDGETS, "Test geo-replication", "any-pair"),
        mechanismInput(WIDGETS, "Test geo-replication", "any-pair", "Unverified"),
        claimInput(WIDGETS, "test-service", "Restores stay in the geography", false),
    ]);
    assert.deepEqual(staleClaims({ type: WIDGETS, playbook: widget, entries }), [
        { kind: "mechanism", claim: "Test geo-replication", playbookSays: "Paired: yes, Nonpaired: no", learnSays: "Any-pair", ledger: ["R-0001"] },
        { kind: "constraint", claim: "Restores stay in the geography", playbookSays: "A restore works only within the same geography.", learnSays: "Learn on Restores stay in the geography", ledger: ["R-0003"] },
    ]);
});

test("classifyType writes the row of contracts 6.2 for a playbook type: workaround, verified, the split option to the pair", () => {
    const row = classify({ type: WIDGETS, count: 3, playbook: widget });
    assert.deepEqual(row, {
        type: WIDGETS, short: null, title: "Test Service", count: 3, slot: "compute", playbook: "test-service v1", verifiedOn: "2026-11-01", playbookStale: false,
        decidedBy: null, path: "workaround", verified: true, staleClaims: [],
        options: [
            {
                id: "second-copy", title: "Second copy in the DR region", kind: "workaround", target: "dr-region", targetRegion: DR,
                rpo: "15m (the copy interval the team sets)", rto: "30m (the switch-over time the team designs)", rpoSeconds: 900, rtoSeconds: 1800,
                source: "playbook", status: "valid", meetsTier: false, residency: "ok", givesUp: "platform-managed failover.", ledger: ["R-0006"],
            },
            {
                id: "pair-split", title: "Recover into the pair", kind: "split-region", target: "pair-region", targetRegion: PAIR,
                rpo: "unknown (no figure on Learn)", rto: "4h (fixture value)", rpoSeconds: null, rtoSeconds: 14400,
                source: "playbook", status: "valid", meetsTier: false, residency: "ok", givesUp: "a copy in the DR region.", ledger: ["R-0005"],
            },
            {
                id: "accept-gap", title: ACCEPT_GAP_TITLE, kind: "accept-gap", target: null, targetRegion: null, rpo: null, rto: null, rpoSeconds: null, rtoSeconds: null,
                source: "rule", status: "valid", meetsTier: false, residency: "ok", givesUp: "DR for this service", ledger: [],
            },
        ],
        vetoed: [], recommended: null, recommendationNote: null, ask: false, choice: null,
    });
});

test("classifyType: a native mechanism, a stale claim that vetoes an option, Learn options, and a type with nothing", () => {
    const nativeRow = classify({ type: NATIVES, count: 2, playbook: native });
    assert.deepEqual([nativeRow.path, nativeRow.verified, nativeRow.slot, nativeRow.options.map((o) => o.id)], ["native", true, "data-replication.relational", ["geo-replica", "accept-gap"]]);

    const learnSaysNone = entriesOf([standardInputs()[0], mechanismInput(WIDGETS, "Test geo-replication", "none")]);
    const stale = classify({ type: WIDGETS, playbook: widget, entries: learnSaysNone });
    assert.deepEqual(stale.vetoed, [{ id: "pair-split", reason: VETO_NO_MULTIREGION, ledger: ["R-0001"] }]);
    assert.deepEqual(stale.options.map((o) => [o.id, o.status]), [["second-copy", "unverified"], ["accept-gap", "valid"]]);
    assert.deepEqual([stale.path, stale.verified], ["workaround", false]);
    assert.deepEqual(stale.staleClaims.map((c) => [c.kind, c.claim, c.learnSays]), [["mechanism", "Test geo-replication", "No built-in multiregion"]]);

    const gadgets = classify({ type: GADGETS });
    assert.deepEqual([gadgets.title, gadgets.slot, gadgets.playbook, gadgets.verifiedOn, gadgets.path, gadgets.verified], ["Gadgets", "compute", null, null, "workaround", false]);
    assert.deepEqual(gadgets.options.map((o) => [o.id, o.kind, o.source, o.status, o.rpoSeconds, o.ledger]), [
        ["gadget-copy", "workaround", "learn", "unverified", 1800, ["R-0009"]],
        ["gadget-rebuild", "backup-restore", "learn", "valid", 86400, ["R-0008"]],
        ["accept-gap", "accept-gap", "rule", "valid", null, []],
    ]);

    const nics = classify({ type: NICS, count: 2 });
    assert.deepEqual([nics.title, nics.slot, nics.path, nics.verified, nics.options.map((o) => o.id)], ["Network Interface", null, "none", true, ["accept-gap"]]);
});

test("classifyType: with Learn unreachable nothing is native, and the residency and staleness of the playbook show", () => {
    const offline = entriesOf(standardInputs({ learnReachable: false }));
    const row = classify({ type: NATIVES, playbook: native, entries: offline });
    assert.deepEqual([row.path, row.verified, row.options[0].status], ["native", false, "unverified"]);

    const crosses = entriesOf(standardInputs({ residency: "crosses" }));
    const widgets = classify({ type: WIDGETS, playbook: widget, entries: crosses, dataResidency: "Data stays in Sweden" });
    assert.deepEqual(widgets.options.map((o) => [o.id, o.residency]), [["second-copy", "crosses"], ["pair-split", "ok"], ["accept-gap", "ok"]]);

    assert.equal(classify({ type: WIDGETS, playbook: widget, today: "2027-01-30" }).playbookStale, false);
    assert.equal(classify({ type: WIDGETS, playbook: widget, today: "2027-01-31" }).playbookStale, true);
    assert.equal(classify({ type: GADGETS, today: "2099-01-01" }).playbookStale, false);
    assert.deepEqual(classify({ type: WIDGETS, playbook: widget, decidedBy: { source: "pattern", ref: "DR-TEST-001 v1" } }).decidedBy, { source: "pattern", ref: "DR-TEST-001 v1" });
});

test("deciderOf: a pattern, an override with an alternative and a collision decide; Learn and a bare override do not", () => {
    assert.deepEqual(deciderOf({ candidate: { source: "pattern", pattern: "DR-TEST-001", version: 2 } }), { source: "pattern", ref: "DR-TEST-001 v2" });
    assert.deepEqual(deciderOf({ candidate: { source: "override", pattern: "DR-TEST-001", version: 1, overrideIndex: 0, alternative: "Azure Front Door" } }), { source: "override", ref: "Override #0 of DR-TEST-001" });
    assert.equal(deciderOf({ candidate: { source: "override", pattern: "DR-TEST-001", version: 1, overrideIndex: 0, alternative: null } }), null);
    assert.deepEqual(deciderOf({ candidate: { source: "collision" }, collision: ["DR-A-001 v1", "DR-B-001 v1"] }), { source: "collision", ref: "DR-A-001 v1 and DR-B-001 v1" });
    assert.equal(deciderOf({ candidate: { source: "learn" } }), null);
    assert.equal(deciderOf(undefined), null);
});

test("classifyType: the last option entry of an id decides its values; the position is that of the first entry; the ledger lists them all", () => {
    const entries = entriesOf([
        standardInputs()[0],
        optionInput(GADGETS, { id: "gadget-copy", title: "Copy to a second gadget", kind: "workaround", target: "dr-region", rpo: "30m", rto: "1h", givesUp: "managed failover" }, "Unverified"),
        optionInput(GADGETS, { id: "gadget-rebuild", title: "Rebuild from backup", kind: "backup-restore", target: "dr-region", rpo: "24h", rto: "8h", givesUp: "recent changes" }),
        optionInput(GADGETS, { id: "gadget-copy", title: "Copy to a second gadget", kind: "workaround", target: "dr-region", rpo: "10m", rto: "1h", givesUp: "managed failover" }),
    ]);
    const row = classify({ type: GADGETS, entries });
    assert.deepEqual(row.options.map((o) => [o.id, o.status, o.rpo, o.rpoSeconds, o.ledger]), [
        ["gadget-copy", "valid", "10m", 600, ["R-0001", "R-0003"]],
        ["gadget-rebuild", "valid", "24h", 86400, ["R-0002"]],
        ["accept-gap", "valid", null, null, []],
    ]);
});

test("the ledger subjects of a type, a pair and a region match without regard to case", () => {
    const upper = (input) => ({ ...input, subject: input.subject.toUpperCase() });
    const entries = entriesOf([
        standardInputs()[0],
        upper(pairInput({ paired: true, primaryPair: DR })),
        upper(geographyInput(DR, "Germany", "crosses")),
        { ...mechanismInput(WIDGETS, "Test geo-replication", "any-pair"), subject: "Microsoft.Test/Widgets" },
    ]);
    assert.deepEqual(pairFacts(entries, PRIMARY, DR).regions, { primary: PRIMARY, dr: DR, primaryPair: DR, paired: true });
    assert.equal(residencyOf(entries, DR, "EU only"), "crosses");
    assert.equal(residencyOf(entries, DR.toUpperCase(), "EU only"), "crosses");
    assert.deepEqual(classify({ type: WIDGETS, playbook: widget, entries }).options.map((o) => [o.id, o.status]), [["second-copy", "unverified"], ["pair-split", "valid"], ["accept-gap", "valid"]]);
});
