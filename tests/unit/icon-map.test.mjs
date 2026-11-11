import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { GENERIC_ICON, resolveIcon } from "../../skills/azure-dr-assessment/scripts/lib/icon-map.mjs";
import { loadCanvasModules, resolveIconRootForRead } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { FIXTURE_ICONS, makeIconRoot } from "../helpers/icons-fixture.mjs";

const assets = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "assets");
const table = JSON.parse(readFileSync(path.join(assets, "arm-icon-map.json"), "utf8"));
const sheetMap = JSON.parse(readFileSync(path.join(assets, "ari-sheet-map.json"), "utf8"));

const canvas = await loadCanvasModules();
const fixture = await canvas.icons.buildCatalog(makeIconRoot());
const empty = await canvas.icons.buildCatalog(null);
const realRoot = resolveIconRootForRead(canvas, null);

const DR_TYPES = [
    "microsoft.network/frontdoors", "microsoft.cdn/profiles", "microsoft.network/trafficmanagerprofiles", "microsoft.network/dnszones",
    "microsoft.network/privatednszones", "microsoft.recoveryservices/vaults", "microsoft.keyvault/vaults", "microsoft.storage/storageaccounts",
    "microsoft.documentdb/databaseaccounts", "microsoft.servicebus/namespaces", "microsoft.eventhub/namespaces", "microsoft.web/sites",
    "microsoft.sql/servers/databases",
];

test("the table is well formed and covers every ARI primary type and the DR-relevant types", () => {
    assert.equal(table.schemaVersion, 1);
    const entries = Object.entries(table.types);
    assert.equal(entries.length, 80);
    for (const [type, id] of entries) {
        assert.match(type, /^microsoft\.[a-z0-9]+(\/[a-z0-9]+)+$/, `${type} must be a lower-case ARM type`);
        assert.match(id, /^(azure|fabric):[a-z0-9]+(-[a-z0-9]+)*$/, `${type} -> ${id} must look like azure:<slug> (fabric:<slug> for Purview)`);
    }
    assert.deepEqual(Object.keys(table.types), Object.keys(table.types).slice().sort(), "keys stay sorted");
    const primary = new Set(Object.values(sheetMap.resources).map((entry) => entry.armType));
    assert.equal(primary.size, 70);
    for (const type of [...primary, ...DR_TYPES]) assert.ok(table.types[type], `no icon for ${type}`);
    assert.equal(table.types["microsoft.network/frontdoors"], "azure:front-door-and-cdn-profiles");
    assert.equal(table.types["microsoft.web/sites"], "azure:app-services");
    assert.equal(table.types["microsoft.kusto/clusters"], "azure:azure-data-explorer-clusters");
});

test("explicit icons win: a catalog id, or a loose name the catalog resolves", () => {
    assert.deepEqual(resolveIcon({ icon: "azure:key-vaults", armType: "microsoft.web/sites" }, fixture), { iconId: "azure:key-vaults", how: "explicit" });
    assert.deepEqual(resolveIcon({ icon: "key vault" }, fixture), { iconId: "azure:key-vaults", how: "explicit" });
    assert.deepEqual(resolveIcon({ icon: "no-such-thing", armType: "microsoft.web/sites" }, fixture), { iconId: "azure:app-services", how: "mapped" });
    assert.deepEqual(resolveIcon({ icon: "no-such-thing" }, fixture), { iconId: GENERIC_ICON, how: "generic" });
});

test("a mapped ARM type resolves through the table, in any letter case", () => {
    assert.deepEqual(resolveIcon({ armType: "microsoft.sql/servers/databases" }, fixture), { iconId: "azure:sql-database", how: "mapped" });
    assert.deepEqual(resolveIcon({ armType: "Microsoft.Storage/storageAccounts" }, fixture), { iconId: "azure:storage-accounts", how: "mapped" });
    assert.deepEqual(resolveIcon({ armType: "microsoft.network/frontdoors", icon: null }, fixture), { iconId: "azure:front-door-and-cdn-profiles", how: "mapped" });
});

test("a type the table does not know falls back to the closest catalog match, annotated, then to the generic icon", () => {
    assert.deepEqual(resolveIcon({ armType: "microsoft.example/keyvaults" }, fixture), { iconId: "azure:key-vaults", how: "closest" });
    assert.deepEqual(resolveIcon({ armType: "microsoft.example/storageAccounts" }, fixture), { iconId: "azure:storage-accounts", how: "closest" });
    assert.deepEqual(resolveIcon({ armType: "microsoft.example/widgets" }, fixture), { iconId: "azure:all-resources", how: "generic" });
    assert.deepEqual(resolveIcon({}, fixture), { iconId: "azure:all-resources", how: "generic" });
    assert.deepEqual(resolveIcon({ armType: null, icon: null }, fixture), { iconId: "azure:all-resources", how: "generic" });
    assert.ok(FIXTURE_ICONS[GENERIC_ICON], "the fixture catalog has the generic icon");
});

test("a table entry whose icon is missing from the catalog does not produce a broken icon id", () => {
    assert.ok(table.types["microsoft.cache/redis"]);
    assert.equal(fixture.get(table.types["microsoft.cache/redis"]), null);
    assert.deepEqual(resolveIcon({ armType: "microsoft.cache/redis" }, fixture), { iconId: "azure:all-resources", how: "generic" });
});

test("without an icon library the table is used unchecked and everything else is generic", () => {
    assert.equal(empty.size, 0);
    assert.deepEqual(resolveIcon({ armType: "microsoft.web/sites" }, empty), { iconId: "azure:app-services", how: "mapped" });
    assert.deepEqual(resolveIcon({ icon: "azure:function-apps" }, empty), { iconId: "azure:function-apps", how: "explicit" });
    assert.deepEqual(resolveIcon({ icon: "key vault" }, empty), { iconId: GENERIC_ICON, how: "generic" });
    assert.deepEqual(resolveIcon({ armType: "microsoft.example/widgets" }, empty), { iconId: GENERIC_ICON, how: "generic" });
    assert.deepEqual(resolveIcon({ armType: "microsoft.web/sites" }, null), { iconId: "azure:app-services", how: "mapped" });
});

test("every mapped icon id exists in the real icon catalog, for the icon sets that are installed", { skip: realRoot ? false : "no icon library: run fetch-icons or set ARCH_CANVAS_ICON_ROOT" }, async () => {
    const catalog = await canvas.icons.buildCatalog(realRoot);
    const installed = new Set(catalog.collections().map((collection) => collection.id));
    assert.ok(installed.has("azure"), "the Azure set is always installed");
    const checked = Object.entries(table.types).filter(([, id]) => installed.has(id.split(":")[0]));
    const missing = checked.filter(([, id]) => !catalog.get(id));
    assert.deepEqual(missing, [], "these table entries name an icon the catalog does not have");
    for (const id of [GENERIC_ICON, "azure:information", "azure:function-apps"]) assert.ok(catalog.get(id), id);
    for (const [type, id] of checked) assert.deepEqual(resolveIcon({ armType: type }, catalog), { iconId: id, how: "mapped" }, type);
});
