import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import {
    STALE_AFTER_DAYS,
    articleUrl,
    catalogueAge,
    defaultMapFile,
    loadLearnMap,
    lookupServices,
    typeHints,
    validateLearnMap,
} from "../../skills/azure-dr-assessment/scripts/lib/learn-map.mjs";

const map = loadLearnMap();
const clone = () => structuredClone(map);
const messages = (result) => result.errors.map((error) => `${error.path}: ${error.message}`);

test("the shipped catalogue is valid, sorted and dated", () => {
    assert.equal(defaultMapFile().endsWith(path.join("skills", "azure-dr-assessment", "assets", "learn-service-map.json")), true);
    assert.deepEqual(validateLearnMap(map), { ok: true, errors: [] });
    assert.match(map.verifiedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(map.reference, "https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support");
    const keys = Object.keys(map.types);
    assert.deepEqual(keys, [...keys].sort());
    assert.ok(keys.length >= 55, `${keys.length} types`);
});

test("the catalogue covers the DR-relevant types of every mechanism class", () => {
    const expected = {
        "microsoft.sql/servers/databases": "built-in",
        "microsoft.documentdb/databaseaccounts": "built-in",
        "microsoft.keyvault/vaults": "built-in",
        "microsoft.storage/storageaccounts": "built-in",
        "microsoft.servicebus/namespaces": "built-in",
        "microsoft.eventhub/namespaces": "built-in",
        "microsoft.containerregistry/registries": "built-in",
        "microsoft.recoveryservices/vaults": "built-in",
        "microsoft.compute/virtualmachines": "built-in",
        "microsoft.containerservice/managedclusters": "built-in",
        "microsoft.network/trafficmanagerprofiles": "built-in",
        "microsoft.cdn/profiles": "built-in",
        "microsoft.network/dnszones": "built-in",
        "microsoft.network/applicationgateways": "none",
        "microsoft.network/azurefirewalls": "none",
        "microsoft.network/virtualnetworks": "none",
        "microsoft.network/virtualnetworkgateways": "none",
        "microsoft.compute/virtualmachinescalesets": "none",
        "microsoft.compute/disks": "none",
        "microsoft.cache/redis": "not-listed",
    };
    for (const [armType, tab] of Object.entries(expected)) {
        assert.ok(map.types[armType], armType);
        assert.ok(map.types[armType].some((entry) => entry.tab === tab), `${armType} has a ${tab} entry`);
    }
});

test("lookupServices is case-insensitive, expands shared types and returns nothing for an unknown type", () => {
    const sql = lookupServices(map, "Microsoft.SQL/servers/databases");
    assert.equal(sql.length, 1);
    assert.equal(sql[0].service, "Azure SQL Database");
    assert.equal(sql[0].articleUrl, "https://learn.microsoft.com/en-us/azure/reliability/reliability-sql-database");
    assert.equal(sql[0].customSolutionsUrl, null);

    const storage = lookupServices(map, "microsoft.storage/storageaccounts");
    assert.deepEqual(storage.map((entry) => entry.service), [
        "Azure Blob Storage",
        "Azure Files",
        "Azure Queue Storage",
        "Azure Table Storage",
        "Azure Data Lake Storage Gen2 (hierarchical namespaces)",
    ]);
    assert.equal(
        storage[1].customSolutionsUrl,
        "https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-files#custom-multiregion-solutions-for-resiliency",
    );

    const vault = lookupServices(map, "microsoft.keyvault/vaults")[0];
    assert.equal(vault.tab, "built-in");
    assert.match(vault.customSolutionsUrl, /reliability-key-vault#custom-multiregion-solutions-for-resiliency$/);

    const gateways = lookupServices(map, "microsoft.network/virtualnetworkgateways");
    assert.deepEqual(gateways.map((entry) => entry.service), ["Azure VPN Gateway", "Azure ExpressRoute"]);
    assert.match(gateways[0].customSolutionsUrl, /reliability-virtual-network-gateway\?pivots=vpn#custom-multiregion-solutions-for-resiliency$/);

    assert.deepEqual(lookupServices(map, "microsoft.example/unknown"), []);
});

test("articleUrl builds a URL from a slug, an /en-us/ path or null", () => {
    assert.equal(articleUrl("reliability-key-vault"), "https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault");
    assert.equal(articleUrl("reliability-virtual-network-gateway?pivots=vpn"), "https://learn.microsoft.com/en-us/azure/reliability/reliability-virtual-network-gateway?pivots=vpn");
    assert.equal(articleUrl("/en-us/fabric/security/reliability-fabric"), "https://learn.microsoft.com/en-us/fabric/security/reliability-fabric");
    assert.equal(articleUrl(null), null);
});

test("catalogueAge says how old the hints are and when they stop being trustworthy", () => {
    assert.equal(STALE_AFTER_DAYS, 90);
    const dated = { ...map, verifiedOn: "2026-11-04" };
    assert.deepEqual(catalogueAge(dated, new Date("2026-11-04T12:00:00Z")), { verifiedOn: "2026-11-04", ageDays: 0, stale: false });
    assert.deepEqual(catalogueAge(dated, new Date("2027-02-02T00:00:00Z")), { verifiedOn: "2026-11-04", ageDays: 90, stale: false });
    assert.deepEqual(catalogueAge(dated, new Date("2027-02-03T00:00:00Z")), { verifiedOn: "2026-11-04", ageDays: 91, stale: true });
});

test("typeHints counts distinct types, most frequent first, and marks the ones the catalogue does not know", () => {
    const resources = [
        { armType: "microsoft.web/sites" },
        { armType: "Microsoft.SQL/servers/databases" },
        { armType: "microsoft.web/sites" },
        { armType: "microsoft.web/sites" },
        { armType: "microsoft.example/unknown" },
        { armType: "microsoft.sql/servers/databases" },
        { armType: null },
    ];
    const hints = typeHints(resources, map);
    assert.deepEqual(hints.map((hint) => [hint.armType, hint.count, hint.mapped]), [
        ["microsoft.web/sites", 3, true],
        ["microsoft.sql/servers/databases", 2, true],
        ["microsoft.example/unknown", 1, false],
    ]);
    assert.equal(hints[0].learn[0].service, "Azure App Service");
    assert.deepEqual(hints[2].learn, []);
});

test("lookupServices knows only the types of the catalogue, never a key that every object inherits", () => {
    for (const name of ["constructor", "__proto__", "CONSTRUCTOR"]) {
        assert.deepEqual(lookupServices(map, name), [], name);
    }
    assert.equal(lookupServices(map, "Microsoft.SQL/servers/databases").length, 1);
});

test("typeHints lists a resource type named like an inherited key as unmapped", () => {
    const hints = typeHints([{ armType: "constructor" }, { armType: "__proto__" }, { armType: "Constructor" }], map);
    assert.deepEqual(hints.map((hint) => [hint.armType, hint.count, hint.mapped, hint.learn]), [
        ["constructor", 2, false, []],
        ["__proto__", 1, false, []],
    ]);
});

test("typeHints breaks a tie by code unit, so the order of the worklist does not depend on the machine's locale", () => {
    const resources = [{ armType: "microsoft.example/ä" }, { armType: "microsoft.example/z" }, { armType: "microsoft.example/a" }];
    assert.deepEqual(typeHints(resources, map).map((hint) => hint.armType), ["microsoft.example/a", "microsoft.example/z", "microsoft.example/ä"]);
    assert.deepEqual(typeHints([...resources].reverse(), map).map((hint) => hint.armType), ["microsoft.example/a", "microsoft.example/z", "microsoft.example/ä"]);
});

test("validateLearnMap reports every problem with its path", () => {
    const bad = clone();
    bad.schemaVersion = 2;
    bad.verifiedOn = "yesterday";
    bad.reference = "http://example.com";
    bad.types["Microsoft.Bad/Type"] = [{ service: "x", tab: "built-in", article: null }];
    bad.types["microsoft.example/empty"] = [];
    bad.types["microsoft.example/entries"] = [
        { service: "", tab: "sometimes", article: "https://elsewhere.example/page" },
        { service: "Same", tab: "none", article: null },
        { service: "Same", tab: "none", article: null, customAnchor: true },
        { service: "Listed", tab: "not-listed", article: "reliability-listed" },
        { service: "Hint", tab: "none", article: null, when: 5 },
    ];
    const result = validateLearnMap(bad);
    assert.equal(result.ok, false);
    const text = messages(result).join("\n");
    for (const expected of [
        "schemaVersion: must be 1",
        "verifiedOn: must be a YYYY-MM-DD date",
        "reference: must be a learn.microsoft.com URL",
        "types.Microsoft.Bad/Type: key must be a lowercase ARM resource type",
        "types.microsoft.example/empty: must be a non-empty array",
        "types.microsoft.example/entries[0].service: must be the Service name as the reference page shows it",
        "types.microsoft.example/entries[0].tab: must be one of built-in, none, not-listed",
        "types.microsoft.example/entries[0].article: must be null, a reliability-<name> slug",
        'types.microsoft.example/entries[2].service: duplicate service "Same"',
        "types.microsoft.example/entries[2].customAnchor: needs an article",
        "types.microsoft.example/entries[3].article: a not-listed service has no reliability article",
        "types.microsoft.example/entries[4].when: must be a non-empty string",
    ]) {
        assert.ok(text.includes(expected), expected);
    }
    assert.equal(validateLearnMap(null).ok, false);
    assert.equal(validateLearnMap({ ...map, types: [] }).ok, false);
});

test("loadLearnMap rejects an unreadable or invalid file with exit code 2", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-learn-map-"));
    const invalid = path.join(dir, "invalid.json");
    writeFileSync(invalid, JSON.stringify({ schemaVersion: 1 }));
    const notJson = path.join(dir, "not.json");
    writeFileSync(notJson, "{");
    for (const file of [invalid, notJson, path.join(dir, "missing.json")]) {
        assert.throws(() => loadLearnMap(file), (err) => err instanceof CliError && err.code === EXIT.INPUT, file);
    }
});
