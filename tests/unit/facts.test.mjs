import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAri } from "../../skills/azure-dr-assessment/scripts/lib/ari.mjs";
import { addInventoryFacts, DR_FIELD } from "../../skills/azure-dr-assessment/scripts/lib/facts.mjs";
import { inventoryFromLive } from "../../skills/azure-dr-assessment/scripts/lib/inventory.mjs";
import { Ledger } from "../../skills/azure-dr-assessment/scripts/lib/ledger.mjs";
import { collectInventory } from "../../skills/azure-dr-assessment/scripts/lib/live.mjs";
import { readWorkbook } from "../../skills/azure-dr-assessment/scripts/lib/xlsx.mjs";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { installFakeAz, isWindows, SUB_A, SUB_GAP } from "../helpers/fake-az-env.mjs";
import { FAKE_VM_PASS_WORD } from "../helpers/secret-shapes.mjs";

const NO_SCOPE = { resource_groups: [], tag: null, subscriptions: [] };
const ariInventory = (options = {}) => normalizeAri(readWorkbook(makeAriWorkbook()), { maxRowsPerSheet: 20000, scope: NO_SCOPE, ...options });
const CONTRACT_REGEX = /(sku|tier|zone|redundan|replica|replication|secondary|backup|geo|failover|availability|state|retention|soft delete|capacity|kind)/i;

function facts(inventory) {
    const ledger = Ledger.empty();
    const added = addInventoryFacts(ledger, inventory);
    return { ledger, added };
}

test("the DR field pattern is the one in contracts 8.11", () => {
    assert.equal(DR_FIELD.source, CONTRACT_REGEX.source);
    assert.equal(DR_FIELD.flags, "i");
});

test("every in-scope resource gets identity facts and DR-relevant field facts, each citing its ref", () => {
    const inventory = ariInventory();
    const { ledger, added } = facts(inventory);
    assert.equal(added, ledger.entries.length);
    const first = ledger.entries[0];
    assert.equal(first.id, "F-0001");
    assert.deepEqual(
        { strength: first.strength, subject: first.subject, claim: first.claim, property: first.property, value: first.value, source: first.source, basis: first.basis },
        { strength: "Observed", subject: "ari:Virtual Machines!2", claim: "web-vm-01 is present in the inventory", property: "name", value: "web-vm-01", source: { type: "ari-xlsx", ref: "ari:Virtual Machines!2", detail: "resource name" }, basis: null },
    );

    const orders = ledger.entries.filter((e) => e.subject === "ari:SQL DBs!2");
    assert.deepEqual(orders.map((e) => e.property), ["name", "type", "resourceGroup", "location", "Service Tier", "Zone Redundant", "Read Replica Count"]);
    const redundant = orders.find((e) => e.property === "Zone Redundant");
    assert.deepEqual(
        { strength: redundant.strength, claim: redundant.claim, value: redundant.value, source: redundant.source },
        { strength: "Observed", claim: "orders-db Zone Redundant is false", value: false, source: { type: "ari-xlsx", ref: "ari:SQL DBs!2", detail: "column Zone Redundant" } },
    );
    assert.equal(orders.find((e) => e.property === "type").claim, "orders-db type is microsoft.sql/servers/databases");
    assert.equal(orders.find((e) => e.property === "location").value, "westeurope");

    const refs = new Set(inventory.resources.map((r) => r.ref));
    for (const entry of ledger.entries.filter((e) => e.strength === "Observed")) assert.ok(refs.has(entry.source.ref), entry.id);
    assert.deepEqual(ledger.validate({ inventory }), { ok: true, errors: [] });

    const expected = inventory.resources.reduce(
        (n, r) => n + 1 + [r.armType, r.resourceGroup, r.location].filter(Boolean).length + Object.keys(r.fields).filter((key) => CONTRACT_REGEX.test(key)).length,
        0,
    );
    assert.equal(ledger.entries.filter((e) => e.strength === "Observed").length, expected);
});

test("empty cells, secrets and fields outside the pattern produce no facts", () => {
    const { ledger } = facts(ariInventory());
    const text = JSON.stringify(ledger.entries);
    assert.equal(text.includes(FAKE_VM_PASS_WORD), false);
    assert.equal(text.includes("AccountKey"), false);
    assert.equal(ledger.entries.some((e) => e.property === "Admin Password" || e.property === "Notes"), false);
    assert.equal(ledger.entries.some((e) => e.property === "VM Size" || e.property === "Admin Username"), false, "not DR-relevant by the pattern");
    assert.equal(ledger.entries.some((e) => e.subject === "ari:SQL DBs!2" && e.property === "Default Secondary Location"), false, "an empty cell is not a fact");
    const logs = ledger.entries.filter((e) => e.claim.startsWith("stsharedlogs"));
    assert.equal(logs.some((e) => e.property === "Secondary Location"), false);
});

test("sheets that were not assessed, or only partly read, become Unknown facts after the resource facts", () => {
    const inventory = ariInventory({ maxRowsPerSheet: 2 });
    const { ledger } = facts(inventory);
    const unknown = ledger.entries.filter((e) => e.strength === "Unknown");
    assert.deepEqual(unknown.map((e) => e.subject), [
        "sheet:Overview", "sheet:Advisor", "sheet:Virtual Machines", "sheet:Storage Accounts", "sheet:Custom Tags", "sheet:Notes",
    ]);
    const byName = Object.fromEntries(unknown.map((e) => [e.subject, e]));
    assert.equal(byName["sheet:Overview"].claim, "Sheet Overview was not assessed: unstructured");
    assert.equal(byName["sheet:Advisor"].claim, "Sheet Advisor was not assessed: not mapped to a resource type");
    assert.equal(byName["sheet:Virtual Machines"].claim, "Sheet Virtual Machines was only partly read: truncated to the first 2 rows");
    for (const entry of unknown) {
        assert.equal(entry.value, null);
        assert.equal(entry.property, null);
        assert.equal(entry.source.type, "ari-xlsx");
        assert.equal(entry.source.ref, entry.subject);
    }
    assert.ok(ledger.entries.findIndex((e) => e.strength === "Unknown") > ledger.entries.findLastIndex((e) => e.strength === "Observed"));
    assert.equal(ledger.validate({ inventory }).ok, true);
});

test("facts are deterministic: the same inventory gives the same ids and claims", () => {
    const strip = (ledger) => ledger.entries.map(({ recordedAt, ...rest }) => rest);
    assert.deepEqual(strip(facts(ariInventory()).ledger), strip(facts(ariInventory()).ledger));
});

test("live facts cite arg refs and properties, and a permission gap becomes an Unknown fact", { skip: isWindows ? "the fake az is a script" : false }, async () => {
    const fake = installFakeAz();
    const inventory = inventoryFromLive(await collectInventory({ subscriptionIds: [SUB_A, SUB_GAP], env: fake.env }), { scope: NO_SCOPE });
    const { ledger } = facts(inventory);
    const db = inventory.resources.find((r) => r.name === "orders-db");
    const zone = ledger.entries.find((e) => e.subject === db.ref && e.property === "properties.zoneRedundant");
    assert.deepEqual(
        { claim: zone.claim, value: zone.value, source: zone.source },
        { claim: "orders-db properties.zoneRedundant is false", value: false, source: { type: "live", ref: db.ref, detail: "property properties.zoneRedundant" } },
    );
    assert.ok(ledger.entries.some((e) => e.subject === db.ref && e.property === "sku.tier" && e.value === "Standard"));
    assert.equal(ledger.entries.some((e) => /Fixture-Pw/.test(JSON.stringify(e))), false);
    const gap = ledger.entries.find((e) => e.subject === `subscription:${SUB_GAP}`);
    assert.equal(gap.strength, "Unknown");
    assert.equal(gap.claim, `Resources of subscription ${SUB_GAP} were not collected: not visible to the signed-in account and returned no resources`);
    assert.equal(gap.source.type, "live");
    assert.equal(ledger.entries.filter((e) => e.strength === "Unknown").length, 1, "the query sheets are assessed");
    assert.equal(ledger.validate({ inventory }).ok, true);
});
