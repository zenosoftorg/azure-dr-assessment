import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeAri } from "../../skills/azure-dr-assessment/scripts/lib/ari.mjs";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import {
    checkPrimaryRegion, inventoryFromLive, readInventory, validateInventory, writeInventory,
} from "../../skills/azure-dr-assessment/scripts/lib/inventory.mjs";
import { collectInventory } from "../../skills/azure-dr-assessment/scripts/lib/live.mjs";
import { readWorkbook } from "../../skills/azure-dr-assessment/scripts/lib/xlsx.mjs";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { installFakeAz, isWindows, SUB_A, SUB_B, SUB_GAP, TENANT } from "../helpers/fake-az-env.mjs";
import { ACCOUNT_KEY, PASS_WORD } from "../helpers/secret-shapes.mjs";

const NO_SCOPE = { resource_groups: [], tag: null, subscriptions: [] };
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-inventory-"));
const ariInventory = (scope = NO_SCOPE) => normalizeAri(readWorkbook(makeAriWorkbook()), { maxRowsPerSheet: 20000, scope });
const clone = (value) => JSON.parse(JSON.stringify(value));
const paths = (inventory) => validateInventory(inventory).errors.map((e) => e.path);

test("an inventory from the ARI normalizer is valid, also after ingest fills the source", () => {
    const inventory = ariInventory();
    assert.deepEqual(validateInventory(inventory), { ok: true, errors: [] });
    Object.assign(inventory.source, { file: "ari-export.xlsx", sha256: "a".repeat(64), readAt: "2026-11-04T10:00:00.000Z" });
    assert.equal(validateInventory(inventory).ok, true);
});

const BROKEN = [
    ["schemaVersion", (i) => { i.schemaVersion = 2; }, "schemaVersion"],
    ["source kind", (i) => { i.source.kind = "csv"; }, "source.kind"],
    ["sha256", (i) => { i.source.sha256 = "abc"; }, "source.sha256"],
    ["readAt", (i) => { i.source.readAt = "yesterday"; }, "source.readAt"],
    ["subscriptions", (i) => { i.source.subscriptions = [{ id: 1 }]; }, "source.subscriptions"],
    ["scope.applied", (i) => { i.scope.applied = "yes"; }, "scope.applied"],
    ["scope.selector", (i) => { i.scope.selector.tag = { name: "app" }; }, "scope.selector"],
    ["scope.matched above total", (i) => { i.scope.matched = 99; }, "scope.total"],
    ["sheets not a list", (i) => { i.sheets = {}; }, "sheets"],
    ["sheet kind", (i) => { i.sheets[0].kind = "other"; }, "sheets[0].kind"],
    ["sheet assessed", (i) => { i.sheets[1].assessed = "yes"; }, "sheets[1].assessed"],
    ["sheet headers", (i) => { i.sheets[1].headers = [1]; }, "sheets[1].headers"],
    ["summary count", (i) => { i.summary[0].count = 0; }, "summary[0].count"],
    ["resource without a name", (i) => { i.resources[0].name = ""; }, "resources[0].name"],
    ["duplicate ref", (i) => { i.resources[1].ref = i.resources[0].ref; }, "resources[1].ref"],
    ["resource location type", (i) => { i.resources[0].location = 5; }, "resources[0].location"],
    ["tags with a non-string value", (i) => { i.resources[0].tags = { a: 1 }; }, "resources[0].tags"],
    ["tag with a secret-like name", (i) => { i.resources[0].tags = { [PASS_WORD.toLowerCase()]: "x" }; }, "resources[0].tags.password"],
    ["field with a secret-like name", (i) => { i.resources[0].fields["Admin Password"] = "x"; }, "resources[0].fields.Admin Password"],
    ["field with a secret-like value", (i) => { i.resources[0].fields.Notes = `${ACCOUNT_KEY}=abc`; }, "resources[0].fields.Notes"],
    ["droppedFields", (i) => { i.resources[0].droppedFields = "Admin Password"; }, "resources[0].droppedFields"],
    ["omissions", (i) => { i.omissions = [{ what: 1 }]; }, "omissions[0]"],
    ["warnings", (i) => { i.warnings = [1]; }, "warnings"],
];

test("validateInventory names the path of every kind of problem", () => {
    for (const [label, mutate, expected] of BROKEN) {
        const inventory = clone(ariInventory());
        mutate(inventory);
        assert.ok(paths(inventory).includes(expected), `${label}: expected ${expected}, got ${paths(inventory).join(", ")}`);
    }
    assert.deepEqual(validateInventory(null).errors, [{ path: "", message: "must be an object" }]);
    assert.ok(paths({}).includes("schemaVersion"));
});

test("writeInventory and readInventory round-trip, and readInventory maps problems to CliError(INPUT)", async () => {
    const dir = tmp();
    const file = path.join(dir, "evidence", "inventory.json");
    const inventory = ariInventory();
    await writeInventory(file, inventory);
    assert.deepEqual(await readInventory(file), inventory);

    await assert.rejects(() => readInventory(path.join(dir, "missing.json")), (e) => e instanceof CliError && e.code === EXIT.INPUT);
    mkdirSync(path.join(dir, "bad"));
    writeFileSync(path.join(dir, "bad", "inventory.json"), "{ nope");
    await assert.rejects(() => readInventory(path.join(dir, "bad", "inventory.json")), (e) => e.code === EXIT.INPUT && /not valid JSON/.test(e.message));
    writeFileSync(path.join(dir, "empty.json"), JSON.stringify({ schemaVersion: 1 }));
    await assert.rejects(() => readInventory(path.join(dir, "empty.json")), (e) => e.code === EXIT.INPUT && e.details.some((d) => d.startsWith("source:")));
});

test("checkPrimaryRegion compares the declared region with the regions of the resources", () => {
    const at = (location, n = 1) => Array.from({ length: n }, () => ({ location }));
    assert.deepEqual(checkPrimaryRegion([...at("westeurope", 3), ...at("northeurope")], "westeurope"), {
        declared: "westeurope", observed: [{ region: "westeurope", resources: 3 }, { region: "northeurope", resources: 1 }], status: "match",
    });
    assert.equal(checkPrimaryRegion(at("northeurope", 2), "westeurope").status, "mismatch");
    assert.deepEqual(checkPrimaryRegion([...at("global", 2), ...at(null)], "westeurope"), { declared: "westeurope", observed: [], status: "unknown" });
    assert.equal(checkPrimaryRegion(at("westeurope"), null).status, "unknown");
    assert.deepEqual(checkPrimaryRegion([...at("b"), ...at("a")], null).observed.map((o) => o.region), ["a", "b"]);
});

test("inventoryFromLive builds refs, names, query sheets and omissions, applies the scope and passes validation", { skip: isWindows ? "the fake az is a script" : false }, async () => {
    const fake = installFakeAz();
    const live = await collectInventory({ subscriptionIds: [SUB_A, SUB_B, SUB_GAP], env: fake.env });
    const inventory = inventoryFromLive(live, { scope: NO_SCOPE });
    assert.deepEqual(validateInventory(inventory), { ok: true, errors: [] });
    assert.equal(inventory.source.kind, "live");
    assert.equal(inventory.source.file, null);
    assert.equal(inventory.source.sha256, null);
    assert.equal(inventory.source.readAt, live.collectedAt);
    assert.equal(inventory.source.tenantId, TENANT);
    assert.deepEqual(inventory.source.subscriptions, [{ id: SUB_A, name: "Sub A" }, { id: SUB_B, name: "Sub B" }, { id: SUB_GAP, name: null }]);
    assert.equal(inventory.resources.length, 6);
    const db = inventory.resources.find((r) => r.name === "orders-db");
    assert.equal(db.ref, `arg:/subscriptions/${SUB_A}/resourcegroups/rg-checkout/providers/microsoft.sql/servers/sql-checkout-weu/databases/orders-db`);
    assert.equal(db.armType, "microsoft.sql/servers/databases");
    assert.equal(db.subscription, "Sub A");
    assert.equal(db.subscriptionId, SUB_A);
    assert.equal(db.location, "westeurope");
    assert.equal(db.sku, "S1");
    assert.deepEqual(db.tags, { app: "checkout" });
    assert.deepEqual(Object.keys(db), ["ref", "armType", "name", "resourceGroup", "subscription", "subscriptionId", "location", "sku", "zones", "tags", "fields", "droppedFields"]);
    assert.deepEqual(inventory.sheets.map((s) => [s.name, s.kind, s.assessed, s.rowCount]), [
        ["query:resources", "query", true, 6], ["query:subscriptions", "query", true, 3], ["query:resourceGroups", "query", true, 2],
    ]);
    assert.deepEqual(inventory.sheets[0].headers.slice(0, 3), ["id", "name", "type"]);
    assert.deepEqual(inventory.omissions, [{ what: `subscription:${SUB_GAP}`, reason: "not visible to the signed-in account and returned no resources" }]);
    assert.equal(inventory.summary.reduce((sum, row) => sum + row.count, 0), 6);
    assert.deepEqual(inventory.scope, { applied: false, selector: { resourceGroups: [], tag: null, subscriptions: [] }, matched: 6, total: 6 });

    const scoped = inventoryFromLive(live, { scope: { resource_groups: ["RG-BILLING"], tag: null, subscriptions: [] } });
    assert.deepEqual(scoped.resources.map((r) => r.name), ["stbilling", "web-billing"]);
    assert.deepEqual(scoped.scope, { applied: true, selector: { resourceGroups: ["RG-BILLING"], tag: null, subscriptions: [] }, matched: 2, total: 6 });
    const byName = inventoryFromLive(live, { scope: { resource_groups: [], tag: null, subscriptions: ["sub b"] } });
    assert.equal(byName.resources.length, 2);
    const none = inventoryFromLive(live, { scope: { resource_groups: ["nope"], tag: null, subscriptions: [] } });
    assert.ok(none.warnings.some((w) => /matched none of the 6 resources/.test(w)));
});
