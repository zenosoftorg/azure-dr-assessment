import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
    classifySheet, columnFinder, findHeader, normalizeHeader, normalizeSheetName,
} from "../../skills/azure-dr-assessment/scripts/lib/ari-sheets.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const map = JSON.parse(readFileSync(path.join(root, "skills", "azure-dr-assessment", "assets", "ari-sheet-map.json"), "utf8"));
const rows = (...lists) => lists.map((values, i) => ({ row: i + 1, values }));

test("the sheet map records its provenance and covers the 86 ARI modules", () => {
    assert.equal(map.schemaVersion, 1);
    assert.equal(map.source.project, "microsoft/ARI");
    assert.equal(map.source.commit, "4cc602c36f64ad26eb2bad920a9cae04ac0dd43e");
    assert.equal(map.source.license, "MIT");
    assert.equal(map.source.modules, 86);
    const apiReportModules = 4;
    assert.equal(Object.keys(map.resources).length + apiReportModules, map.source.modules);
});

test("every resource entry is keyed by its normalized sheet name and names a lowercase ARM type", () => {
    for (const [key, entry] of Object.entries(map.resources)) {
        assert.equal(normalizeSheetName(entry.sheet), key, `${entry.sheet} is filed under ${key}`);
        assert.match(entry.armType, /^microsoft\.[a-z0-9]+(\/[a-z0-9]+)+$/, key);
        for (const field of Object.keys(entry.columns ?? {})) {
            assert.ok(["subscription", "resourceGroup", "name", "location"].includes(field), `${key}: unknown column override ${field}`);
        }
    }
});

test("the 13 sheets whose names ARI sets through $SheetName are mapped to their primary types", () => {
    const expected = {
        "Event Hubs": "microsoft.eventhub/namespaces", PostgreSQL: "microsoft.dbforpostgresql/servers", MySQL: "microsoft.dbformysql/servers",
        "Redis Cache": "microsoft.cache/redis", "Storage Accounts": "microsoft.storage/storageaccounts", "App Gateway": "microsoft.network/applicationgateways",
        "Public IPs": "microsoft.network/publicipaddresses", "Load Balancers": "microsoft.network/loadbalancers", "Virtual Networks": "microsoft.network/virtualnetworks",
        AKS: "microsoft.containerservice/managedclusters", Disks: "microsoft.compute/disks", "Virtual Machines": "microsoft.compute/virtualmachines",
        "Virtual Machine Scale Sets": "microsoft.compute/virtualmachinescalesets",
    };
    for (const [sheet, armType] of Object.entries(expected)) {
        assert.deepEqual(classifySheet(sheet).armType, armType, sheet);
    }
});

test("the sheets whose rows are not the named resource carry column overrides", () => {
    assert.deepEqual(classifySheet("AKS").columns, { name: "Clusters" });
    assert.deepEqual(classifySheet("Disks").columns, { name: "Disk Name" });
    assert.deepEqual(classifySheet("Stream Analytics Jobs").columns, {
        subscription: "Job Subscription", resourceGroup: "Job Resource Group", name: "Job Name", location: "Job Location",
    });
    assert.deepEqual(classifySheet("Virtual Machines").columns, {});
});

test("special sheets follow the contract's kinds", () => {
    assert.deepEqual(map.report.slice().sort(), [
        "advisor", "advisorscore", "outages", "policy", "quotausage", "reservationadvisor", "securitycenter", "supporttickets",
    ]);
    for (const name of ["Advisor", "Policy", "SecurityCenter", "Quota Usage", "Reservation Advisor", "Outages", "Support Tickets", "AdvisorScore"]) {
        assert.equal(classifySheet(name).kind, "report", name);
    }
    assert.equal(classifySheet("Subscriptions").kind, "summary");
    assert.equal(classifySheet("Overview").kind, "unstructured");
    assert.equal(classifySheet("Something New").kind, "unmapped");
    assert.equal(classifySheet("SQL DBs").kind, "resource");
    assert.equal(classifySheet("sql dbs").armType, "microsoft.sql/servers/databases");
    assert.equal(classifySheet("Managed Identity").kind, "resource");
    for (const key of [...map.report, ...map.summary, ...map.unstructured]) assert.equal(map.resources[key], undefined, key);
});

test("findHeader takes the first of the first ten rows with two or more cells that are all strings", () => {
    assert.deepEqual(findHeader(rows(["Name", "SKU", null, " Zone "], ["a", "b"])), { index: 0, row: 1, headers: ["Name", "SKU", "", "Zone"] });
    assert.deepEqual(findHeader(rows(["Title only"], ["Name", "SKU"])), { index: 1, row: 2, headers: ["Name", "SKU"] });
    assert.equal(findHeader(rows(["Count", 3], ["Total", 5])), null, "a row with a number is not a header");
    assert.equal(findHeader(rows(["only one cell"])), null);
    assert.equal(findHeader([]), null);
    const late = [...Array.from({ length: 10 }, (_, i) => ({ row: i + 1, values: [i] })), { row: 11, values: ["Name", "SKU"] }];
    assert.equal(findHeader(late), null, "only the first ten rows are examined");
    assert.deepEqual(findHeader([{ row: 4, values: ["A", "B"] }]), { index: 0, row: 4, headers: ["A", "B"] }, "row is the Excel row number");
});

test("columnFinder ignores case and spacing and tries the names in order", () => {
    const find = columnFinder(["Subscription", "resource  GROUP", " Name ", "VM Name"]);
    assert.equal(find("Resource Group"), 1);
    assert.equal(find("Name", "VM Name"), 2);
    assert.equal(find("VM Name", "Name"), 3);
    assert.equal(find(undefined, "Name"), 2);
    assert.equal(find("Missing"), -1);
    assert.equal(normalizeHeader("  Tag   Name "), "tag name");
});

test("NOTICE.md records that the sheet map is derived from microsoft/ARI under the MIT licence", () => {
    const notice = readFileSync(path.join(root, "NOTICE.md"), "utf8");
    assert.match(notice, /## Derived data: ARI sheet map/);
    assert.match(notice, /microsoft\/ARI/);
    assert.match(notice, /4cc602c36f64ad26eb2bad920a9cae04ac0dd43e/);
    assert.match(notice, /MIT License/);
    assert.match(notice, /Copyright \(c\) 2020 RenatoGregio/);
});
