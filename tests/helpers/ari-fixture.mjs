import { writeXlsx } from "./xlsx-write.mjs";
import { ACCOUNT_KEY, FAKE_VM_PASS_WORD } from "./secret-shapes.mjs";

/**
 * One resource sheet in the shape ARI writes: a header row, then one row per tag of each resource.
 * The first row of a resource has Resource U = 1, the others 0. Untagged resources have empty tag cells.
 */
function resourceSheet(name, columns, resources) {
    const rows = [columns];
    for (const { values, tags = [] } of resources) {
        const tagRows = tags.length > 0 ? tags : [[null, null]];
        tagRows.forEach(([tagName, tagValue], i) => {
            rows.push(
                columns.map((column) => {
                    if (column === "Resource U") return i === 0 ? 1 : 0;
                    if (column === "Tag Name") return tagName;
                    if (column === "Tag Value") return tagValue;
                    return values[column] ?? null;
                }),
            );
        });
    }
    return { name, rows };
}

const B = { Subscription: "Sub B", Location: "northeurope" };

/** The sheets of the sample. The checkout workload (Sub A) runs in `primary`; its GRS account replicates to `pair`. */
function sheets(primary, pair) {
    const A = { Subscription: "Sub A", Location: primary };
    return [
        {
            name: "Overview",
            rows: [["Azure Resource Inventory"], [], ["Subscriptions", 2], ["Resource groups", 3], ["Resources", 12], ["Generated", { date: "2026-11-04" }]],
        },
        {
            name: "Subscriptions",
            rows: [
                ["Subscription", "Resource Group", "Location", "Resource Type", "Resources Count"],
                ["Sub A", "rg-checkout", primary, "microsoft.compute/virtualmachines", 2],
                ["Sub A", "rg-checkout", primary, "microsoft.compute/disks", 1],
                ["Sub A", "rg-checkout", primary, "microsoft.network/networkinterfaces", 3],
                ["Sub A", "rg-checkout", primary, "microsoft.storage/storageaccounts", 1],
                ["Sub A", "rg-checkout", primary, "microsoft.sql/servers/databases", 1],
                ["Sub A", "rg-checkout", primary, "microsoft.web/sites", 1],
                ["Sub A", "rg-checkout", primary, "microsoft.keyvault/vaults", 1],
                ["Sub A", "rg-shared", primary, "microsoft.compute/virtualmachines", 1],
                ["Sub A", "rg-shared", primary, "microsoft.storage/storageaccounts", 1],
                ["Sub B", "rg-billing", "northeurope", "microsoft.storage/storageaccounts", 1],
                ["Sub B", "rg-billing", "northeurope", "microsoft.sql/servers/databases", 1],
                ["Sub B", "rg-billing", "northeurope", "microsoft.web/sites", 1],
            ],
        },
        {
            name: "Advisor",
            rows: [
                ["Subscription", "Resource Group", "Resource Type", "Name", "Category", "Impact", "Description"],
                ["Sub A", "rg-checkout", "microsoft.storage/storageaccounts", "stcheckoutprod", "Reliability", "Medium", "Enable soft delete"],
                ["Sub B", "rg-billing", "microsoft.sql/servers/databases", "billing-db", "Security", "High", "Enable auditing"],
            ],
        },
        resourceSheet(
            "Virtual Machines",
            [
                "Subscription", "Resource Group", "VM Name", "VM Size", "Availability Zone", "Location", "Availability Set", "Virtual Network",
                "Subnet", "Admin Username", "Admin Password", "OS Disk Storage Type", "Power State", "Resource U", "Tag Name", "Tag Value",
            ],
            [
                {
                    values: { ...A, "Resource Group": "rg-checkout", "VM Name": "web-vm-01", "VM Size": "Standard_D4s_v5", "Availability Zone": "1", "Virtual Network": "vnet-checkout", Subnet: "snet-web", "Admin Username": "azureadmin", "Admin Password": `${FAKE_VM_PASS_WORD}-Fixture-1`, "OS Disk Storage Type": "Premium_LRS", "Power State": "VM running" },
                    tags: [["app", "checkout"], ["env", "prod"]],
                },
                {
                    values: { ...A, "Resource Group": "rg-checkout", "VM Name": "web-vm-02", "VM Size": "Standard_D4s_v5", "Availability Zone": "2", "Virtual Network": "vnet-checkout", Subnet: "snet-web", "Admin Username": "azureadmin", "Admin Password": `${FAKE_VM_PASS_WORD}-Fixture-1`, "OS Disk Storage Type": "Premium_LRS", "Power State": "VM running" },
                    tags: [["app", "checkout"], ["env", "prod"]],
                },
                {
                    values: { ...A, "Resource Group": "rg-shared", "VM Name": "jump-vm-01", "VM Size": "Standard_B2s", "Virtual Network": "vnet-shared", Subnet: "snet-mgmt", "Admin Username": "azureadmin", "Admin Password": `${FAKE_VM_PASS_WORD}-Fixture-2`, "OS Disk Storage Type": "Standard_LRS", "Power State": "VM deallocated" },
                    tags: [["app", "shared"]],
                },
            ],
        ),
        resourceSheet(
            "Storage Accounts",
            [
                "Subscription", "Resource Group", "Name", "Location", "Zone", "SKU", "Tier", "Storage Account Kind", "Secure Transfer Required",
                "Allow Storage Account Key Access", "Microsoft Entra Authorization", "Blob Soft Delete Days", "Primary Location",
                "Status Of Primary Location", "Secondary Location", "Status Of Secondary Location", "Notes", "Tag Name", "Tag Value", "Resource U",
            ],
            [
                {
                    values: { ...A, "Resource Group": "rg-checkout", Name: "stcheckoutprod", SKU: "Standard_GRS", Tier: "Standard", "Storage Account Kind": "StorageV2", "Secure Transfer Required": true, "Allow Storage Account Key Access": false, "Microsoft Entra Authorization": true, "Blob Soft Delete Days": 7, "Primary Location": primary, "Status Of Primary Location": "available", "Secondary Location": pair, "Status Of Secondary Location": "available", Notes: `DefaultEndpointsProtocol=https;AccountName=stcheckoutprod;${ACCOUNT_KEY}=${"Zm9vYmFy".repeat(3)}Zm9vYmFy==` },
                    tags: [["app", "checkout"]],
                },
                {
                    values: { ...A, "Resource Group": "rg-shared", Name: "stsharedlogs", SKU: "Standard_LRS", Tier: "Standard", "Storage Account Kind": "StorageV2", "Secure Transfer Required": true, "Allow Storage Account Key Access": true, "Microsoft Entra Authorization": false, "Primary Location": primary, "Status Of Primary Location": "available" },
                    tags: [["sas token", "st-secret-value"]],
                },
                {
                    values: { ...B, "Resource Group": "rg-billing", Name: "stbilling", SKU: "Standard_RAGRS", Tier: "Standard", "Storage Account Kind": "StorageV2", "Secure Transfer Required": true, "Allow Storage Account Key Access": false, "Microsoft Entra Authorization": true, "Primary Location": "northeurope", "Status Of Primary Location": "available", "Secondary Location": "westeurope", "Status Of Secondary Location": "available" },
                    tags: [["app", "billing"]],
                },
            ],
        ),
        resourceSheet(
            "SQL DBs",
            [
                "Subscription", "Resource Group", "Name", "Location", "Retiring Feature", "Database Server", "Default Secondary Location", "Status",
                "Availability Zone", "Service Tier", "Hardware Configuration", "Zone Redundant", "Read Replica Count", "Resource U", "Tag Name", "Tag Value",
            ],
            [
                {
                    values: { ...A, "Resource Group": "rg-checkout", Name: "orders-db", "Database Server": "sql-checkout-weu", Status: "Online", "Service Tier": "Standard", "Hardware Configuration": "S1", "Zone Redundant": false, "Read Replica Count": 0 },
                    tags: [["app", "checkout"]],
                },
                {
                    values: { ...B, "Resource Group": "rg-billing", Name: "billing-db", "Database Server": "sql-billing-neu", "Default Secondary Location": "westeurope", Status: "Online", "Service Tier": "Premium", "Hardware Configuration": "P1", "Zone Redundant": true, "Read Replica Count": 1 },
                    tags: [["app", "billing"]],
                },
            ],
        ),
        resourceSheet(
            "App Services",
            [
                "Subscription", "Resource Group", "Name", "SKU", "App Type", "Location", "zoneRedundant", "State", "HTTPS Only",
                "Client Cert Enabled", "Resource U", "Tag Name", "Tag Value",
            ],
            [
                {
                    values: { ...A, "Resource Group": "rg-checkout", Name: "web-checkout", SKU: "P1v3", "App Type": "app", zoneRedundant: false, State: "Running", "HTTPS Only": true, "Client Cert Enabled": false },
                    tags: [["app", "checkout"]],
                },
                {
                    values: { ...B, "Resource Group": "rg-billing", Name: "web-billing", SKU: "S1", "App Type": "app", zoneRedundant: false, State: "Running", "HTTPS Only": true, "Client Cert Enabled": false },
                    tags: [["app", "billing"]],
                },
            ],
        ),
        {
            name: "Key Vaults",
            rows: [
                ["Key Vaults in scope"],
                ["subscription", "RESOURCE GROUP", " Name ", "location", "Soft Delete Retention (days)", "Resource U"],
                ["Sub A", "rg-checkout", "kv-checkout", primary, 90, 1],
            ],
        },
        {
            ...resourceSheet(
                "Disks",
                ["Subscription", "Resource Group", "Disk Name", "Disk State", "Location", "Zone", "SKU", "Disk Size", "Resource U", "Tag Name", "Tag Value"],
                [{ values: { ...A, "Resource Group": "rg-checkout", "Disk Name": "web-vm-01_OsDisk", "Disk State": "Attached", Zone: "1", SKU: "Premium_LRS", "Disk Size": 128 } }],
            ),
            hidden: true,
        },
        { name: "Custom Tags", rows: [["Tag", "Owner"], ["app", "Platform"], ["env", "Platform"]] },
        { name: "Notes", rows: [["Prepared by the platform team"], ["Do not forward"]] },
    ];
}

/**
 * A generated ARI-style workbook. `omit` drops sheets by name; `extraSheets` appends more. `primary` is the region of
 * the checkout workload and `pair` the secondary of its GRS storage account.
 */
export function makeAriWorkbook({ omit = [], extraSheets = [], primary = "westeurope", pair = "northeurope" } = {}) {
    return writeXlsx([...sheets(primary, pair).filter((sheet) => !omit.includes(sheet.name)), ...extraSheets]);
}

/** The sheet names of the sample workbook, without extra sheets. */
export const SAMPLE_SHEETS = sheets("westeurope", "northeurope").map((sheet) => sheet.name);
