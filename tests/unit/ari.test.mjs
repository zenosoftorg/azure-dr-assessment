import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_MAX_ROWS_PER_SHEET, normalizeAri, summarizeAri } from "../../skills/azure-dr-assessment/scripts/lib/ari.mjs";
import { readWorkbook } from "../../skills/azure-dr-assessment/scripts/lib/xlsx.mjs";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { ACCOUNT_KEY, FAKE_VM_PASS_WORD } from "../helpers/secret-shapes.mjs";

const NO_SCOPE = { resource_groups: [], tag: null, subscriptions: [] };
const load = (options) => readWorkbook(makeAriWorkbook(options));
const normalize = (options = {}, workbookOptions) =>
    normalizeAri(load(workbookOptions), { maxRowsPerSheet: DEFAULT_MAX_ROWS_PER_SHEET, scope: NO_SCOPE, ...options });
const byName = (inventory, name) => inventory.resources.find((r) => r.name === name);

test("sheets are classified: resource, summary, report, table and unstructured", () => {
    const inv = normalize();
    assert.deepEqual(inv.sheets.map((s) => [s.name, s.kind, s.assessed]), [
        ["Overview", "unstructured", false], ["Subscriptions", "summary", true], ["Advisor", "report", false],
        ["Virtual Machines", "resource", true], ["Storage Accounts", "resource", true], ["SQL DBs", "resource", true],
        ["App Services", "resource", true], ["Key Vaults", "resource", true], ["Disks", "resource", true],
        ["Custom Tags", "table", false], ["Notes", "unstructured", false],
    ]);
    const sheet = (name) => inv.sheets.find((s) => s.name === name);
    assert.deepEqual(sheet("Virtual Machines"), {
        name: "Virtual Machines", hidden: false, kind: "resource", armType: "microsoft.compute/virtualmachines", headerRow: 1,
        headers: sheet("Virtual Machines").headers, rowCount: 5, assessed: true, reason: null,
    });
    assert.equal(sheet("Virtual Machines").headers[2], "VM Name");
    assert.equal(sheet("Advisor").reason, "not mapped to a resource type");
    assert.equal(sheet("Advisor").armType, null);
    assert.equal(sheet("Custom Tags").reason, "not mapped to a resource type");
    assert.equal(sheet("Overview").headerRow, null);
    assert.equal(sheet("Overview").reason, "unstructured");
    assert.equal(sheet("Key Vaults").headerRow, 2);
    assert.equal(sheet("Disks").hidden, true);
    assert.deepEqual(inv.omissions, [{ what: "sheet:Overview", reason: "unstructured" }, { what: "sheet:Notes", reason: "unstructured" }]);
    assert.deepEqual(inv.warnings, []);
});

test("an inventory has the contract's top-level shape and one resource per merged row group", () => {
    const inv = normalize();
    assert.deepEqual(Object.keys(inv), ["schemaVersion", "source", "scope", "sheets", "summary", "resources", "omissions", "warnings"]);
    assert.equal(inv.schemaVersion, 1);
    assert.deepEqual(inv.source, {
        kind: "ari-xlsx", file: null, sha256: null, readAt: null, tenantId: null,
        subscriptions: [{ id: null, name: "Sub A" }, { id: null, name: "Sub B" }],
    });
    assert.deepEqual(inv.scope, { applied: false, selector: { resourceGroups: [], tag: null, subscriptions: [] }, matched: 12, total: 12 });
    assert.equal(inv.resources.length, 12);
    assert.deepEqual(Object.keys(inv.resources[0]), [
        "ref", "armType", "name", "resourceGroup", "subscription", "subscriptionId", "location", "sku", "zones", "tags", "fields", "droppedFields",
    ]);
});

test("rows of one resource merge, tags fold into tags and the ref is the first row's Excel row", () => {
    const inv = normalize();
    const vm1 = byName(inv, "web-vm-01");
    assert.equal(vm1.ref, "ari:Virtual Machines!2");
    assert.equal(vm1.armType, "microsoft.compute/virtualmachines");
    assert.equal(vm1.resourceGroup, "rg-checkout");
    assert.equal(vm1.subscription, "Sub A");
    assert.equal(vm1.subscriptionId, null);
    assert.equal(vm1.location, "westeurope");
    assert.equal(vm1.sku, "Standard_D4s_v5");
    assert.equal(vm1.zones, "1");
    assert.deepEqual(vm1.tags, { app: "checkout", env: "prod" });
    assert.equal(byName(inv, "web-vm-02").ref, "ari:Virtual Machines!4");
    const jump = byName(inv, "jump-vm-01");
    assert.equal(jump.ref, "ari:Virtual Machines!6");
    assert.equal(jump.zones, null);
    assert.deepEqual(jump.tags, { app: "shared" });
    assert.deepEqual(byName(inv, "orders-db").tags, { app: "checkout" });
    assert.deepEqual(byName(inv, "kv-checkout").tags, {});
});

test("fields hold the first row's non-empty cells without identity, tag and Resource U columns", () => {
    const vm1 = byName(normalize(), "web-vm-01");
    assert.equal(vm1.fields["Virtual Network"], "vnet-checkout");
    assert.equal(vm1.fields["Admin Username"], "azureadmin");
    assert.equal(vm1.fields["Power State"], "VM running");
    for (const identity of ["Subscription", "Resource Group", "VM Name", "Location", "Resource U", "Tag Name", "Tag Value", "Availability Set"]) {
        assert.equal(identity in vm1.fields, false, `${identity} must not be a field`);
    }
    const db = byName(normalize(), "orders-db");
    assert.equal(db.fields["Zone Redundant"], false);
    assert.equal(db.fields["Read Replica Count"], 0);
    assert.equal(db.sku, "Standard");
    assert.equal("Default Secondary Location" in db.fields, false, "an empty cell is not a field");
});

test("secret-like columns and values are dropped, and only the property name is kept", () => {
    const inv = normalize();
    const vm1 = byName(inv, "web-vm-01");
    assert.equal("Admin Password" in vm1.fields, false);
    assert.deepEqual(vm1.droppedFields, ["Admin Password"]);
    assert.equal(vm1.fields["Admin Username"], "azureadmin");
    const prod = byName(inv, "stcheckoutprod");
    assert.deepEqual(prod.droppedFields, ["Notes"]);
    assert.equal("Notes" in prod.fields, false);
    assert.equal(prod.fields["Allow Storage Account Key Access"], false);
    assert.equal(prod.fields["Secure Transfer Required"], true);
    assert.equal(prod.fields["Microsoft Entra Authorization"], true);
    assert.equal(prod.fields["Secondary Location"], "northeurope");
    const logs = byName(inv, "stsharedlogs");
    assert.deepEqual(logs.tags, {});
    assert.deepEqual(logs.droppedFields, ["tags.sas token"]);
    assert.equal(JSON.stringify(inv).includes(FAKE_VM_PASS_WORD), false);
    assert.equal(JSON.stringify(inv).includes(`${ACCOUNT_KEY}=Zm9v`), false);
    assert.equal(JSON.stringify(inv).includes("st-secret-value"), false);
});

test("a title row above the header, odd header spelling and column overrides still read", () => {
    const inv = normalize();
    const kv = byName(inv, "kv-checkout");
    assert.equal(kv.ref, "ari:Key Vaults!3");
    assert.equal(kv.subscription, "Sub A");
    assert.equal(kv.resourceGroup, "rg-checkout");
    assert.equal(kv.location, "westeurope");
    assert.equal(kv.fields["Soft Delete Retention (days)"], 90);
    const disk = byName(inv, "web-vm-01_OsDisk");
    assert.equal(disk.armType, "microsoft.compute/disks");
    assert.equal(disk.ref, "ari:Disks!2");
    assert.equal(disk.zones, "1");
    assert.equal(disk.sku, "Premium_LRS");
    assert.equal("Disk Name" in disk.fields, false);
});

test("the summary comes from the Subscriptions sheet when present, else it is computed", () => {
    const fromSheet = normalize();
    assert.equal(fromSheet.summary.length, 12);
    assert.deepEqual(fromSheet.summary[0], { subscription: "Sub A", resourceGroup: "rg-checkout", location: "westeurope", armType: "microsoft.compute/disks", count: 1 });
    assert.ok(fromSheet.summary.some((row) => row.armType === "microsoft.network/networkinterfaces" && row.count === 3), "types without a resource sheet stay in the summary");
    const computed = normalize({}, { omit: ["Subscriptions"] });
    assert.equal(computed.summary.length, 11);
    assert.equal(computed.summary.reduce((sum, row) => sum + row.count, 0), 12);
    assert.equal(computed.sheets.some((s) => s.name === "Subscriptions"), false);

    const noCounts = normalize({}, { omit: ["Subscriptions"], extraSheets: [{ name: "Subscriptions", rows: [["Subscription", "Resource Group", "Location", "Resource Type", "Cost"], ["Sub A", "rg", "westeurope", "microsoft.web/sites", 3]] }] });
    assert.equal(noCounts.summary.length, 11);
    assert.ok(noCounts.warnings.some((w) => /Subscriptions sheet has no Resource Type and Resources Count/.test(w)));
});

test("the scope selector cuts the resources, counts what it matched and warns when it matches nothing", () => {
    const scope = (overrides) => ({ ...NO_SCOPE, ...overrides });
    const run = (overrides) => normalize({ scope: scope(overrides) });
    const checkout = run({ resource_groups: ["RG-Checkout"] });
    assert.equal(checkout.resources.length, 7);
    assert.deepEqual(checkout.scope, { applied: true, selector: { resourceGroups: ["RG-Checkout"], tag: null, subscriptions: [] }, matched: 7, total: 12 });
    assert.equal(run({ subscriptions: ["sub b"] }).resources.length, 3);
    assert.equal(run({ tag: { name: "APP", value: "Checkout" } }).resources.length, 5);
    assert.equal(run({ resource_groups: ["rg-checkout"], tag: { name: "app", value: "checkout" } }).resources.length, 5);
    assert.equal(run({ resource_groups: ["rg-shared"], tag: { name: "app", value: "checkout" } }).resources.length, 0);
    const none = run({ resource_groups: ["rg-checkout"], subscriptions: ["Sub B"] });
    assert.equal(none.resources.length, 0);
    assert.ok(none.warnings.some((w) => /matched none of the 12 resources/.test(w)));
    assert.equal(checkout.summary.length, 12, "the summary describes the whole workbook");
});

test("summarizeAri returns the sheets, the whole-workbook summary and the candidate workloads", () => {
    const { sheets, summary, candidates } = summarizeAri(load());
    assert.equal(sheets.length, 11);
    assert.equal(summary.length, 12);
    assert.deepEqual(candidates, [
        { key: "rg:Sub A/rg-checkout", subscriptions: ["Sub A"], resourceGroups: ["rg-checkout"], resources: 7 },
        { key: "rg:Sub A/rg-shared", subscriptions: ["Sub A"], resourceGroups: ["rg-shared"], resources: 2 },
        { key: "rg:Sub B/rg-billing", subscriptions: ["Sub B"], resourceGroups: ["rg-billing"], resources: 3 },
        { key: "tag:app=billing", subscriptions: ["Sub B"], resourceGroups: ["rg-billing"], resources: 3 },
        { key: "tag:app=checkout", subscriptions: ["Sub A"], resourceGroups: ["rg-checkout"], resources: 5 },
    ]);
});

test("a sheet over maxRowsPerSheet is truncated with a warning", () => {
    const inv = normalize({ maxRowsPerSheet: 2 });
    const vms = inv.sheets.find((s) => s.name === "Virtual Machines");
    assert.equal(vms.rowCount, 5);
    assert.equal(vms.assessed, true);
    assert.equal(vms.reason, "truncated to the first 2 rows");
    assert.deepEqual(inv.resources.filter((r) => r.armType === "microsoft.compute/virtualmachines").map((r) => r.name), ["web-vm-01"]);
    assert.ok(inv.warnings.includes("sheet Virtual Machines has 5 rows; only the first 2 were read"));
    assert.equal(normalize({ maxRowsPerSheet: 100 }).warnings.length, 0);
});

test("a mapped sheet without a name column is omitted, duplicate headers keep both columns and a new Resource U starts a new resource", () => {
    const extraSheets = [
        { name: "Public DNS", rows: [["Subscription", "Resource Group", "Zone Count"], ["Sub A", "rg-checkout", 1]] },
        {
            name: "Registries",
            rows: [
                ["Subscription", "Resource Group", "Name", "Location", "Name", "Resource U", "Tag Name", "Tag Value"],
                ["Sub A", "rg-checkout", "acrone", "westeurope", "second name column", 1, "a", "1"],
                ["Sub A", "rg-checkout", "acrone", "westeurope", "second name column", 0, "b", "2"],
                ["Sub A", "rg-checkout", "acrone", "westeurope", "another registry", 1, null, null],
                [null, null, null, null, null, 1, null, null],
            ],
        },
    ];
    const inv = normalize({}, { extraSheets });
    const dns = inv.sheets.find((s) => s.name === "Public DNS");
    assert.equal(dns.assessed, false);
    assert.equal(dns.reason, "no name column (Name, VM Name, Resource Name)");
    assert.ok(inv.omissions.some((o) => o.what === "sheet:Public DNS" && o.reason === dns.reason));
    const registries = inv.resources.filter((r) => r.armType === "microsoft.containerregistry/registries");
    assert.equal(registries.length, 2);
    assert.deepEqual(registries[0].tags, { a: "1", b: "2" });
    assert.equal(registries[0].fields["Name (2)"], "second name column");
    assert.equal(registries[1].fields["Name (2)"], "another registry");
    assert.equal(registries[1].ref, "ari:Registries!4");
});

test("a sample export from the owner parses with at least one mapped sheet", { skip: process.env.DR_ARI_SAMPLE ? false : "set DR_ARI_SAMPLE to the sanitized ARI export" }, () => {
    const inv = normalizeAri(readWorkbook(readFileSync(process.env.DR_ARI_SAMPLE)), { maxRowsPerSheet: DEFAULT_MAX_ROWS_PER_SHEET, scope: NO_SCOPE });
    assert.ok(inv.sheets.some((s) => s.kind === "resource" && s.assessed), "no mapped resource sheet: extend assets/ari-sheet-map.json");
    assert.ok(inv.resources.length > 0);
});
