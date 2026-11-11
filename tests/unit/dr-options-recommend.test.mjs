import assert from "node:assert/strict";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import {
    classifyType, meetsTier, parseReply, questionText, recommend, shortNames, tierLimits,
} from "../../skills/azure-dr-assessment/scripts/lib/dr-options.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { tierBands } from "../../skills/azure-dr-assessment/scripts/lib/tiers.mjs";
import {
    DR, GADGETS, NICS, PAIR, PRIMARY, TODAY, WIDGETS,
    claimInput, fixturePlaybook, ledgerFrom, mechanismInput, standardInputs, writeFixturePack,
} from "../helpers/dr-options-fixture.mjs";

const bands = tierBands(await loadPack(writeFixturePack()));
const REGIONS = { primary: PRIMARY, dr: DR, primaryPair: PAIR, paired: false };
const widget = fixturePlaybook();
const STANDARD = ledgerFrom().entries;
const row = (fields) => classifyType({ count: 1, entries: STANDARD, regions: REGIONS, today: TODAY, ...fields });
const limits = (tier, objectives) => tierLimits({ tier, bands, objectives });
const asked = (r, short) => ({ ...r, short, ask: true });

test("tierLimits takes the band maximum, a stricter owner target, and makes Tier 0 testable only with both targets", () => {
    assert.deepEqual(limits(1), { tier: 1, maxRpo: 3540, maxRto: 7200, testable: true });
    assert.deepEqual(limits(1, { rpo: "10m", rto: "4h" }), { tier: 1, maxRpo: 600, maxRto: 7200, testable: true });
    assert.deepEqual(limits(3), { tier: 3, maxRpo: null, maxRto: 259200, testable: true });
    assert.deepEqual(limits(3, { rpo: "48h", rto: null }), { tier: 3, maxRpo: 172800, maxRto: 259200, testable: true });
    assert.deepEqual(limits(0), { tier: 0, maxRpo: null, maxRto: null, testable: false });
    assert.deepEqual(limits(0, { rpo: "0" }), { tier: 0, maxRpo: 0, maxRto: null, testable: false });
    assert.deepEqual(limits(0, { rpo: "1m", rto: "5m" }), { tier: 0, maxRpo: 60, maxRto: 300, testable: true });
    assert.throws(() => tierLimits({ tier: 2, bands: [] }), /no tier band for tier 2/);
});

test("meetsTier needs a valid option with both estimates numeric and within the maxima; null accepts any duration", () => {
    const option = { id: "x", status: "valid", rpoSeconds: 900, rtoSeconds: 1800 };
    assert.equal(meetsTier(option, limits(1)), true);
    assert.equal(meetsTier({ ...option, status: "unverified" }, limits(1)), false);
    assert.equal(meetsTier({ ...option, rpoSeconds: null }, limits(1)), false);
    assert.equal(meetsTier({ ...option, rtoSeconds: 7201 }, limits(1)), false);
    assert.equal(meetsTier({ ...option, rpoSeconds: 999999, rtoSeconds: 3600 }, limits(3)), true);
    assert.equal(meetsTier(option, limits(0)), false);
    assert.equal(meetsTier({ ...option, id: "accept-gap" }, limits(3)), false);
});

test("recommend takes the first option that meets the tier with residency ok", () => {
    const r = recommend(row({ type: WIDGETS, playbook: widget }), limits(1));
    assert.deepEqual([r.recommended, r.recommendationNote], ["second-copy", "meets Tier 1"]);
    assert.deepEqual(r.options.map((o) => [o.id, o.meetsTier]), [["second-copy", true], ["pair-split", false], ["accept-gap", false]]);
});

test("recommend falls back to the first option with residency ok, marked does not meet, Unverified or near zero", () => {
    const crosses = ledgerFrom(standardInputs({ residency: "crosses" })).entries;
    const widgets = recommend(row({ type: WIDGETS, playbook: widget, entries: crosses, dataResidency: "Data stays in Sweden" }), limits(1));
    assert.deepEqual([widgets.recommended, widgets.recommendationNote], ["pair-split", "does not meet Tier 1"]);
    assert.equal(widgets.options[0].meetsTier, true);

    const stricter = recommend(row({ type: WIDGETS, playbook: widget }), limits(1, { rpo: "10m" }));
    assert.deepEqual([stricter.recommended, stricter.recommendationNote], ["second-copy", "does not meet Tier 1"]);

    const gadgets = recommend(row({ type: GADGETS }), limits(1));
    assert.deepEqual([gadgets.recommended, gadgets.recommendationNote], ["gadget-copy", "does not meet Tier 1 (Unverified)"]);
    assert.deepEqual([recommend(row({ type: GADGETS }), limits(3)).recommended, recommend(row({ type: GADGETS }), limits(3)).recommendationNote], ["gadget-rebuild", "meets Tier 3"]);

    const tier0 = recommend(row({ type: WIDGETS, playbook: widget }), limits(0));
    assert.deepEqual([tier0.recommended, tier0.recommendationNote], ["second-copy", "near zero cannot be tested"]);
    const owned = recommend(row({ type: WIDGETS, playbook: widget }), limits(0, { rpo: "15m", rto: "30m" }));
    assert.deepEqual([owned.recommended, owned.recommendationNote], ["second-copy", "meets Tier 0"]);
});

test("recommend takes accept-gap when no option respects residency or none is left", () => {
    const everywhere = ledgerFrom([
        ...standardInputs({ residency: "crosses" }).slice(0, 4),
        { ...standardInputs()[4], result: { region: PAIR, geography: "Sweden", residency: "crosses" } },
        ...standardInputs().slice(5),
    ]).entries;
    const blocked = recommend(row({ type: WIDGETS, playbook: widget, entries: everywhere, dataResidency: "Data stays in Sweden" }), limits(2));
    assert.deepEqual([blocked.recommended, blocked.recommendationNote], ["accept-gap", "does not meet Tier 2"]);
    const nothing = recommend(row({ type: NICS }), limits(1));
    assert.deepEqual([nothing.recommended, nothing.recommendationNote], ["accept-gap", "does not meet Tier 1"]);
});

test("shortNames: initials without a leading Azure, two letters for one word, a number on a clash", () => {
    const titles = ["Azure Key Vault", "Azure Redis", "Redis", "Key Vault", "Azure", "networkinterfaces", "Azure Database for PostgreSQL flexible server"];
    assert.deepEqual(shortNames(titles.map((title) => ({ title }))), ["KV", "RE", "RE2", "KV2", "AZ", "NE", "DFPFS"]);
    assert.deepEqual(shortNames([]), []);
});

test("questionText prints one block per asked row in the exact shape of contracts 6.2.3, then the reply line", () => {
    const widgets = asked(recommend(row({ type: WIDGETS, playbook: widget, count: 3 }), limits(1)), "TS");
    const gadgets = asked(recommend(row({ type: GADGETS }), limits(1)), "GA");
    const nics = { ...recommend(row({ type: NICS }), limits(1)), short: "NE", ask: false };
    assert.equal(questionText([widgets, nics, gadgets], { dr: DR }), [
        "**Test Service** (3 resources). No native DR into germanywestcentral.",
        "1. Second copy in the DR region. Estimated RPO: 15m; RTO: 30m. Gives up: platform-managed failover. **Recommended (meets Tier 1).**",
        "2. Recover into the pair. Estimated RPO: unknown; RTO: 4h. Gives up: a copy in the DR region.",
        "3. Accept the gap and record it as an exception.",
        "",
        "**Gadgets** (1 resource). No native DR into germanywestcentral.",
        "1. Copy to a second gadget. Estimated RPO: 30m; RTO: 1h. Gives up: managed failover. **Recommended (does not meet Tier 1 (Unverified)).**",
        "2. Rebuild from backup in the DR region. Estimated RPO: 24h; RTO: 8h. Gives up: recent changes.",
        "3. Accept the gap and record it as an exception.",
        "",
        "Reply e.g. TS 1, GA 2, or accept recommendations.",
    ].join("\n"));
    assert.equal(questionText([nics], { dr: DR }), null);
});

test("questionText names stale claims and a vetoed decider; one block gives one reply example; a gap-only row is not asked", () => {
    const entries = ledgerFrom([
        standardInputs()[0],
        mechanismInput(WIDGETS, "Test geo-replication", "none"),
        claimInput(WIDGETS, "test-service", "Restores stay in the geography", false),
    ]).entries;
    const stale = asked(recommend(row({ type: WIDGETS, playbook: widget, entries, decidedBy: { source: "pattern", ref: "DR-TEST-001 v1" } }), limits(1)), "TS");
    assert.equal(questionText([stale], { dr: DR }), [
        "**Test Service** (1 resource). No native DR into germanywestcentral. Playbook claim stale: Test geo-replication (Learn says No built-in multiregion). Playbook claim stale: Restores stay in the geography (Learn says Learn on Restores stay in the geography). Decided by DR-TEST-001 v1, which Azure reality vetoes.",
        "1. Second copy in the DR region. Estimated RPO: 15m; RTO: 30m. Gives up: platform-managed failover. **Recommended (meets Tier 1).**",
        "2. Accept the gap and record it as an exception.",
        "",
        "Reply e.g. TS 1, or accept recommendations.",
    ].join("\n"));
    const nics = asked(recommend(row({ type: NICS, count: 2 }), limits(1)), "NE");
    assert.equal(questionText([nics], { dr: DR }), null);
});

test("parseReply maps short names and numbers to option ids, case-insensitively, or accepts every recommendation", () => {
    const rows = [
        asked(recommend(row({ type: WIDGETS, playbook: widget }), limits(1)), "TS"),
        asked(recommend(row({ type: GADGETS }), limits(1)), "GA"),
        { ...recommend(row({ type: NICS }), limits(1)), short: "NE", ask: false },
    ];
    assert.deepEqual(parseReply("TS 2, ga 1", rows), [{ type: WIDGETS, option: "pair-split" }, { type: GADGETS, option: "gadget-copy" }]);
    assert.deepEqual(parseReply("ga 3;\nTs 1\n", rows), [{ type: GADGETS, option: "accept-gap" }, { type: WIDGETS, option: "second-copy" }]);
    assert.deepEqual(parseReply("TS 1", rows), [{ type: WIDGETS, option: "second-copy" }]);
    const all = [{ type: WIDGETS, option: "second-copy" }, { type: GADGETS, option: "gadget-copy" }];
    assert.deepEqual(parseReply("Accept recommendations", rows), all);
    assert.deepEqual(parseReply("  accept. ", rows), all);
});

test("parseReply refuses the whole reply with every problem listed", () => {
    const rows = [
        asked(recommend(row({ type: WIDGETS, playbook: widget }), limits(1)), "TS"),
        asked(recommend(row({ type: GADGETS }), limits(1)), "GA"),
        { ...recommend(row({ type: NICS }), limits(1)), short: "NE", ask: false },
    ];
    const refused = (text, details) => assert.throws(() => parseReply(text, rows), (e) => {
        assert.ok(e instanceof CliError);
        assert.equal(e.code, EXIT.INPUT);
        assert.equal(e.message, "the reply could not be read, so nothing was recorded");
        assert.deepEqual(e.details, details);
        return true;
    });
    refused("TS 4, NE 1, KV 1, ts 2, GA two, GA 0", [
        "TS 4: choose a number from 1 to 3",
        "NE is not a service of the question (TS, GA)",
        "KV is not a service of the question (TS, GA)",
        "TS is answered twice",
        "\"GA two\" is not a short name and a number, such as TS 1",
        "GA 0: choose a number from 1 to 3",
    ]);
    refused(" , ;", ["the reply names no service: answer with a short name and a number, or accept recommendations"]);
    refused("accept all", ["\"accept all\" is not a short name and a number, such as TS 1"]);
});

test("parseReply never echoes an item that looks like a secret: it names the item by its number", () => {
    const rows = [asked(recommend(row({ type: WIDGETS, playbook: widget }), limits(1)), "TS")];
    const secret = ["Account", "Key=", "abc123"].join("");
    assert.throws(() => parseReply(`TS 1, ${secret}`, rows), (e) => {
        assert.deepEqual(e.details, ["item 2 is not a short name and a number, such as TS 1"]);
        assert.ok(!JSON.stringify(e.details).includes(secret) && !e.message.includes(secret));
        return true;
    });
});
