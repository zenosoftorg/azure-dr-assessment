import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ACCOUNT_KEY, ADMIN_LOGIN_PASS_WORD, ADMIN_PASS_WORD, SIG } from "./secret-shapes.mjs";

export const isWindows = process.platform === "win32";
export const SUB_A = "11111111-1111-1111-1111-111111111111";
export const SUB_B = "22222222-2222-2222-2222-222222222222";
export const SUB_GAP = "33333333-3333-3333-3333-333333333333";
export const TENANT = "99999999-9999-9999-9999-999999999999";

const armId = (sub, group, type, name) => `/subscriptions/${sub}/resourceGroups/${group}/providers/${type}/${name}`;

function resources() {
    return [
        {
            id: armId(SUB_A, "rg-checkout", "Microsoft.Web/sites", "web-checkout"), name: "web-checkout", type: "microsoft.web/sites", location: "westeurope",
            resourceGroup: "rg-checkout", subscriptionId: SUB_A, sku: null, zones: null, kind: "app", tags: { app: "checkout", env: "prod" },
            properties: {
                state: "Running", httpsOnly: true, zoneRedundant: false, hostNames: ["web-checkout.azurewebsites.net"],
                siteConfig: {
                    alwaysOn: true, ftpsState: "Disabled", limits: { cpu: { time: 5 } },
                    connectionStrings: [{ name: "db", connectionString: `Server=sql;${ACCOUNT_KEY}=Zm9vYmFyZm9vYmFy==` }],
                },
            },
        },
        {
            id: armId(SUB_A, "rg-checkout", "Microsoft.Sql/servers/sql-checkout-weu/databases", "orders-db"), name: "orders-db", type: "microsoft.sql/servers/databases",
            location: "westeurope", resourceGroup: "rg-checkout", subscriptionId: SUB_A, sku: { name: "S1", tier: "Standard" }, zones: null, kind: "v12.0,user",
            tags: { app: "checkout", "sas token": "fixture-secret" },
            properties: { zoneRedundant: false, requestedServiceObjectiveName: "S1", [ADMIN_LOGIN_PASS_WORD]: "Fixture-Pw-1", readReplicaCount: 0 },
        },
        {
            id: armId(SUB_A, "rg-checkout", "Microsoft.Compute/virtualMachines", "web-vm-01"), name: "web-vm-01", type: "microsoft.compute/virtualmachines",
            location: "westeurope", resourceGroup: "rg-checkout", subscriptionId: SUB_A, sku: null, zones: ["1"], kind: null, tags: { app: "checkout" },
            properties: { hardwareProfile: { vmSize: "Standard_D4s_v5" }, osProfile: { adminUsername: "azureadmin", [ADMIN_PASS_WORD]: "Fixture-Pw-2" }, provisioningState: "Succeeded" },
        },
        {
            id: armId(SUB_A, "rg-checkout", "Microsoft.Storage/storageAccounts", "stcheckoutprod"), name: "stcheckoutprod", type: "microsoft.storage/storageaccounts",
            location: "westeurope", resourceGroup: "rg-checkout", subscriptionId: SUB_A, sku: { name: "Standard_GRS", tier: "Standard" }, zones: null, kind: "StorageV2",
            tags: {},
            properties: {
                primaryLocation: "westeurope", secondaryLocation: "northeurope", supportsHttpsTrafficOnly: true,
                primaryEndpoints: { blob: "https://stcheckoutprod.blob.core.windows.net/", sas: `?sv=2022-11-02&${SIG}=Zm9vYmFyZm9vYmFyZm9vYmFy` },
            },
        },
        {
            id: armId(SUB_B, "rg-billing", "Microsoft.Storage/storageAccounts", "stbilling"), name: "stbilling", type: "microsoft.storage/storageaccounts",
            location: "northeurope", resourceGroup: "rg-billing", subscriptionId: SUB_B, sku: { name: "Standard_RAGRS", tier: "Standard" }, zones: null, kind: "StorageV2",
            tags: { app: "billing" }, properties: { primaryLocation: "northeurope", secondaryLocation: "westeurope" },
        },
        {
            id: armId(SUB_B, "rg-billing", "Microsoft.Web/sites", "web-billing"), name: "web-billing", type: "microsoft.web/sites", location: "northeurope",
            resourceGroup: "rg-billing", subscriptionId: SUB_B, sku: null, zones: null, kind: "app", tags: { app: "billing" }, properties: { state: "Running" },
        },
    ];
}

/** Canned answers for the fake az: two visible subscriptions and one the signed-in account cannot see. */
export function defaultFixture() {
    return {
        version: { "azure-cli": "2.70.0", extensions: { "resource-graph": "2.1.0" } },
        account: {
            show: { id: SUB_A, name: "Sub A", tenantId: TENANT, isDefault: true, state: "Enabled", user: { name: "tester@example.com", type: "user" } },
            list: [
                { id: SUB_A, name: "Sub A", tenantId: TENANT, state: "Enabled", isDefault: true },
                { id: SUB_B, name: "Sub B", tenantId: TENANT, state: "Enabled", isDefault: false },
            ],
        },
        extensions: [{ name: "resource-graph", version: "2.1.0" }],
        graph: {
            resources: resources(),
            subscriptions: [{ subscriptionId: SUB_A, name: "Sub A" }, { subscriptionId: SUB_B, name: "Sub B" }],
            resourceGroups: [
                { subscriptionId: SUB_A, name: "rg-checkout", location: "westeurope", tags: { app: "checkout" } },
                { subscriptionId: SUB_B, name: "rg-billing", location: "northeurope", tags: null },
            ],
            noAccess: [SUB_GAP],
        },
        skus: {
            Standard_D4s_v5: [{
                name: "Standard_D4s_v5", resourceType: "virtualMachines", locations: ["swedencentral"],
                locationInfo: [{ location: "swedencentral", zones: ["1", "2", "3"] }],
                restrictions: [{ type: "Zone", reasonCode: "NotAvailableForSubscription", restrictionInfo: { locations: ["swedencentral"], zones: ["3"] } }],
            }],
            Standard_M416s_v2: [{
                name: "Standard_M416s_v2", resourceType: "virtualMachines", locations: ["swedencentral"],
                locationInfo: [{ location: "swedencentral", zones: ["1"] }],
                restrictions: [{ type: "Location", reasonCode: "NotAvailableForSubscription", restrictionInfo: { locations: ["swedencentral"], zones: [] } }],
            }],
            Standard_Unknown_v9: [],
        },
        usage: [
            { currentValue: 12, limit: 100, name: { value: "cores", localizedValue: "Total Regional vCPUs" } },
            { currentValue: 8, limit: 20, name: { value: "standardDSv5Family", localizedValue: "Standard DSv5 Family vCPUs" } },
        ],
    };
}

/**
 * Put the fake az in a temp folder (as az.mjs, so Node reads it as a module) and make it executable.
 * `env` is what a script needs to find it; `calls()` returns every argv the fake received.
 */
export function installFakeAz(fixture = defaultFixture()) {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-fake-az-"));
    const az = path.join(dir, "az.mjs");
    copyFileSync(path.join(import.meta.dirname, "fake-az.mjs"), az);
    chmodSync(az, 0o755);
    const fixtureFile = path.join(dir, "fixture.json");
    const logFile = path.join(dir, "calls.log");
    writeFileSync(fixtureFile, JSON.stringify(fixture));
    return {
        az,
        dir,
        env: { DR_AZ: az, FAKE_AZ_FIXTURE: fixtureFile, FAKE_AZ_LOG: logFile },
        calls: () => (existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []),
    };
}
