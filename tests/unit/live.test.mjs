import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { assertReadOnly, collectFit, collectInventory, flattenResource, QUERIES, runAz } from "../../skills/azure-dr-assessment/scripts/lib/live.mjs";
import { defaultFixture, installFakeAz, isWindows, SUB_A, SUB_B, SUB_GAP, TENANT } from "../helpers/fake-az-env.mjs";
import { ACCOUNT_KEY, ADMIN_LOGIN_PASS_WORD, ADMIN_PASS_WORD, PASS_WORD, SIG } from "../helpers/secret-shapes.mjs";

const skip = isWindows ? "the fake az is a script with a shebang" : false;
const QUERY = QUERIES.resources;
const refused = (err) => err instanceof CliError && err.code === EXIT.REFUSED;

const ACCEPTED = [
    ["account", "show"],
    ["account", "show", "-o", "json"],
    ["account", "list", "--output", "json"],
    ["extension", "list", "-o", "json"],
    ["version"],
    ["graph", "query", "-q", QUERY, "--subscriptions", SUB_A, "--first", "1000", "-o", "json"],
    ["graph", "query", "-q", QUERY, "--subscriptions", SUB_A, SUB_B, "--first", "1", "--skip-token", "MTAwMA==", "--allow-partial-scopes", "-o", "json"],
    ["graph", "query", "-q", QUERIES.subscriptions, "--subscriptions", SUB_A, "--first", "500"],
    ["graph", "query", "-q", QUERIES.resourceGroups, "--subscriptions", SUB_A, "--first", "500"],
    ["vm", "list-skus", "--location", "swedencentral", "--resource-type", "virtualMachines", "--size", "Standard_D4s_v5", "-o", "json"],
    ["vm", "list-usage", "--location", "swedencentral", "-o", "json"],
];

const graph = (...extra) => ["graph", "query", "-q", QUERY, "--subscriptions", SUB_A, "--first", "10", ...extra];
const REFUSED = [
    ["group", "delete", "--name", "rg"],
    ["vm", "delete", "--name", "x"],
    ["vm", "start", "--name", "x"],
    ["vm", "list"],
    ["account", "set", "--subscription", SUB_A],
    ["login"],
    ["account"],
    ["account", "show", "--subscription", SUB_A],
    ["account", "show", "extra"],
    ["account", "list", "-o", "table"],
    ["graph", "query", "-q", QUERY, "--subscriptions", SUB_A],
    ["graph", "query", "--subscriptions", SUB_A, "--first", "10"],
    ["graph", "query", "-q", QUERY, "--first", "10"],
    ["graph", "query", "-q", QUERY, "--subscriptions", SUB_A, "--first", "1001"],
    ["graph", "query", "-q", QUERY, "--subscriptions", SUB_A, "--first", "0"],
    ["graph", "query", "-q", QUERY, "--subscriptions", SUB_A, "--first", "ten"],
    ["graph", "query", "-q", QUERY, "--subscriptions", "not-a-guid", "--first", "10"],
    graph("--management-groups", "mg"),
    graph("--first", "20"),
    graph("--skip-token", "a b"),
    graph("--skip-token", "abc;ls"),
    ["graph", "query", "-q", "resourcechanges | project id", "--subscriptions", SUB_A, "--first", "10"],
    ["graph", "query", "-q", "securityresources | project id", "--subscriptions", SUB_A, "--first", "10"],
    ["graph", "query", "-q", "ResourcesExtra | project id", "--subscriptions", SUB_A, "--first", "10"],
    ["graph", "query", "-q", "Resources | project id; Resources | take 1", "--subscriptions", SUB_A, "--first", "10"],
    ["graph", "query", "-q", "Resources | project id `whoami`", "--subscriptions", SUB_A, "--first", "10"],
    ["graph", "query", "-q", "Resources | project $(whoami)", "--subscriptions", SUB_A, "--first", "10"],
    ["graph", "query", "-q", "Resources | where name > 'a'", "--subscriptions", SUB_A, "--first", "10"],
    ["vm", "list-skus", "--location", "swedencentral", "--resource-type", "virtualMachines"],
    ["vm", "list-skus", "--location", "swedencentral", "--resource-type", "disks", "--size", "x"],
    ["vm", "list-skus", "--location", "sweden central", "--resource-type", "virtualMachines", "--size", "x"],
    ["vm", "list-skus", "--location", "swedencentral;ls", "--resource-type", "virtualMachines", "--size", "x"],
    ["vm", "list-skus", "--location", "swedencentral", "--resource-type", "virtualMachines", "--size", "x|y"],
    ["vm", "list-usage"],
    ["vm", "list-usage", "--location", "$(id)"],
    ["vm", "list-usage", "--location", "swedencentral", "--size", "x"],
    ["version", 3],
    [],
    "version",
    null,
];

test("assertReadOnly accepts exactly the allowlisted vectors of contracts 8.4 and the three bundled queries", () => {
    for (const args of ACCEPTED) assert.doesNotThrow(() => assertReadOnly(args), args.join(" "));
    assert.deepEqual(assertReadOnly(["account", "show"]), { command: "account show" });
    assert.deepEqual(assertReadOnly(ACCEPTED[5]), { command: "graph query" });
    assert.deepEqual(assertReadOnly(["version", "-o", "json"]), { command: "version" });
});

test("assertReadOnly refuses everything else: other commands, missing or extra flags, bad values, other tables and shell metacharacters", () => {
    for (const args of REFUSED) assert.throws(() => assertReadOnly(args), refused, JSON.stringify(args));
});

test("runAz refuses a command off the allowlist before anything is spawned", { skip }, async () => {
    const fake = installFakeAz();
    await assert.rejects(() => runAz(["group", "delete", "--name", "rg"], { env: fake.env }), refused);
    await assert.rejects(() => runAz(["graph", "query", "-q", "Resources | project id; ls", "--subscriptions", SUB_A, "--first", "1"], { env: fake.env }), refused);
    assert.deepEqual(fake.calls(), []);
});

test("runAz runs DR_AZ without a shell and returns the exit code, stdout and stderr", { skip }, async () => {
    const fixture = defaultFixture();
    fixture.failures = { "account list": { code: 3, stderr: "boom" } };
    const fake = installFakeAz(fixture);
    const ok = await runAz(["version", "-o", "json"], { env: fake.env });
    assert.equal(ok.code, 0);
    assert.equal(JSON.parse(ok.stdout)["azure-cli"], "2.70.0");
    const failed = await runAz(["account", "list"], { env: fake.env });
    assert.equal(failed.code, 3);
    assert.equal(failed.stderr.trim(), "boom");
    assert.deepEqual(fake.calls(), [["version", "-o", "json"], ["account", "list"]]);
});

test("runAz maps a missing executable and a timeout to CliError(ENVIRONMENT)", { skip }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-az-missing-"));
    await assert.rejects(() => runAz(["version"], { env: { DR_AZ: path.join(dir, "no-such-az") } }), (e) => e instanceof CliError && e.code === EXIT.ENVIRONMENT && /not found/.test(e.message));
    const slow = defaultFixture();
    slow.delayMs = { version: 3000 };
    const fake = installFakeAz(slow);
    await assert.rejects(() => runAz(["version"], { env: fake.env, timeoutMs: 200 }), (e) => e.code === EXIT.ENVIRONMENT && /did not answer/.test(e.message));
});

test("flattenResource flattens properties to three levels and drops secret-like names and values", () => {
    const { fields, droppedFields } = flattenResource({
        kind: "app", sku: { name: "P1v3", tier: "Premium" }, zones: ["1", "2"],
        properties: {
            zoneRedundant: false, nothing: null, name: "x", [ADMIN_LOGIN_PASS_WORD]: "pw",
            siteConfig: { alwaysOn: true, limits: { cpu: { time: 5 }, memory: 7 }, connectionStrings: [{ connectionString: `${ACCOUNT_KEY}=abc` }], tokens: { a: 1 } },
            hosts: ["a", "b"], endpoint: `?${SIG}=Zm9vYmFyZm9vYmFyZm9vYmFy`,
        },
    });
    assert.deepEqual(fields, {
        kind: "app",
        "sku.name": "P1v3",
        "sku.tier": "Premium",
        zones: "1, 2",
        "properties.hosts": '["a","b"]',
        "properties.name": "x",
        "properties.siteConfig.alwaysOn": true,
        "properties.siteConfig.limits.cpu": '{"time":5}',
        "properties.siteConfig.limits.memory": 7,
        "properties.zoneRedundant": false,
    });
    assert.deepEqual(droppedFields, [
        `properties.${ADMIN_LOGIN_PASS_WORD}`, "properties.endpoint", "properties.siteConfig.connectionStrings", "properties.siteConfig.tokens",
    ]);
    assert.deepEqual(Object.keys(fields), ["kind", "sku.name", "sku.tier", "zones", "properties.hosts", "properties.name", "properties.siteConfig.alwaysOn", "properties.siteConfig.limits.cpu", "properties.siteConfig.limits.memory", "properties.zoneRedundant"]);
    assert.equal(flattenResource({ properties: { long: "x".repeat(600) } }).fields["properties.long"].length, 501);
});

test("flattenResource drops a whole field when a secret hides past the flatten depth or inside an array (GC-07)", () => {
    const deep = flattenResource({ properties: { a: { b: { c: { [PASS_WORD.toLowerCase()]: "fixture-value-2" } } } } });
    assert.deepEqual(deep.fields, {});
    assert.deepEqual(deep.droppedFields, ["properties.a.b.c"]);
    assert.equal(JSON.stringify(deep).includes("fixture-value-2"), false);

    const arrayOfSecrets = flattenResource({ properties: { list: [{ [ADMIN_PASS_WORD]: "fixture-value-3" }] } });
    assert.deepEqual(arrayOfSecrets.fields, {});
    assert.deepEqual(arrayOfSecrets.droppedFields, ["properties.list"]);
    assert.equal(JSON.stringify(arrayOfSecrets).includes("fixture-value-3"), false);

    const appSettings = flattenResource({ properties: { appSettings: [{ name: "DB_PASSWORD", value: "fixture-value-4" }] } });
    assert.deepEqual(appSettings.fields, {});
    assert.deepEqual(appSettings.droppedFields, ["properties.appSettings"]);
    assert.equal(JSON.stringify(appSettings).includes("fixture-value-4"), false);

    const benign = flattenResource({ properties: { appSettings: [{ name: "WEBSITE_TIME_ZONE", value: "UTC" }] } });
    assert.deepEqual(benign.fields, { "properties.appSettings": '[{"name":"WEBSITE_TIME_ZONE","value":"UTC"}]' });
    assert.deepEqual(benign.droppedFields, []);
});

test("collectInventory runs the three queries, filters secrets, sorts rows and records names, tenant and time", { skip }, async () => {
    const fake = installFakeAz();
    const live = await collectInventory({ subscriptionIds: [SUB_A, SUB_B], env: fake.env });
    assert.equal(live.tenantId, TENANT);
    assert.match(live.collectedAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    assert.deepEqual(live.subscriptions, [{ id: SUB_A, name: "Sub A" }, { id: SUB_B, name: "Sub B" }]);
    assert.equal(live.queries, 3);
    assert.deepEqual(live.permissionGaps, []);
    assert.deepEqual(live.warnings, []);
    assert.deepEqual(live.resources.map((r) => r.name), ["web-vm-01", "orders-db", "stcheckoutprod", "web-checkout", "stbilling", "web-billing"]);
    const ids = live.resources.map((r) => r.id.toLowerCase());
    assert.deepEqual(ids, [...ids].sort());
    const db = live.resources.find((r) => r.name === "orders-db");
    assert.equal(db.type, "microsoft.sql/servers/databases");
    assert.equal(db.sku, "S1");
    assert.deepEqual(db.tags, { app: "checkout" });
    assert.deepEqual(db.droppedFields, [`properties.${ADMIN_LOGIN_PASS_WORD}`, "tags.sas token"]);
    assert.equal(db.fields["properties.zoneRedundant"], false);
    const vm = live.resources.find((r) => r.name === "web-vm-01");
    assert.equal(vm.sku, "Standard_D4s_v5");
    assert.equal(vm.zones, "1");
    assert.equal(vm.fields["properties.osProfile.adminUsername"], "azureadmin");
    assert.deepEqual(vm.droppedFields, [`properties.osProfile.${ADMIN_PASS_WORD}`]);
    const storage = live.resources.find((r) => r.name === "stcheckoutprod");
    assert.deepEqual(storage.droppedFields, ["properties.primaryEndpoints.sas"]);
    assert.equal(storage.fields["properties.secondaryLocation"], "northeurope");
    const site = live.resources.find((r) => r.name === "web-checkout");
    assert.equal(site.fields["properties.siteConfig.limits.cpu"], '{"time":5}');
    assert.deepEqual(site.droppedFields, ["properties.siteConfig.connectionStrings"]);
    assert.equal(JSON.stringify(live).includes("Fixture-Pw"), false);
    assert.equal(JSON.stringify(live).includes(`${ACCOUNT_KEY}=`), false);
    assert.deepEqual(live.resourceGroups, [
        { subscriptionId: SUB_A, name: "rg-checkout", location: "westeurope", tags: { app: "checkout" } },
        { subscriptionId: SUB_B, name: "rg-billing", location: "northeurope", tags: {} },
    ]);
});

test("collectInventory pages with the skip token (skip_token or skipToken) and runs only allowlisted commands", { skip }, async () => {
    for (const tokenKey of ["skip_token", "skipToken"]) {
        const fixture = defaultFixture();
        fixture.tokenKey = tokenKey;
        const fake = installFakeAz(fixture);
        const live = await collectInventory({ subscriptionIds: [SUB_A, SUB_B], first: 2, env: fake.env });
        assert.equal(live.resources.length, 6, tokenKey);
        assert.equal(live.queries, 3 + 1 + 1, `${tokenKey}: 3 pages of resources, one page each for subscriptions and resource groups`);
        const calls = fake.calls();
        assert.ok(calls.length >= 9);
        for (const argv of calls) assert.doesNotThrow(() => assertReadOnly(argv), argv.join(" "));
        const commands = new Set(calls.map((argv) => (argv[0] === "version" ? "version" : argv.slice(0, 2).join(" "))));
        assert.deepEqual([...commands].sort(), ["account list", "account show", "extension list", "graph query", "version"]);
        assert.ok(calls.filter((argv) => argv[0] === "graph").every((argv) => argv.includes("--allow-partial-scopes") && argv.includes("--first")));
    }
});

test("a subscription the account cannot see is a permission gap, a visible empty one only a warning", { skip }, async () => {
    const fake = installFakeAz();
    const gap = await collectInventory({ subscriptionIds: [SUB_A, SUB_GAP], env: fake.env });
    assert.deepEqual(gap.permissionGaps, [{ subscriptionId: SUB_GAP, reason: "not visible to the signed-in account and returned no resources" }]);
    assert.equal(gap.resources.every((r) => r.subscriptionId === SUB_A), true);
    assert.deepEqual(gap.subscriptions, [{ id: SUB_A, name: "Sub A" }, { id: SUB_GAP, name: null }]);

    const empty = defaultFixture();
    empty.graph.noAccess = [SUB_B];
    const quiet = await collectInventory({ subscriptionIds: [SUB_B], env: installFakeAz(empty).env });
    assert.deepEqual(quiet.permissionGaps, []);
    assert.deepEqual(quiet.warnings, [`subscription ${SUB_B} returned no resources`]);
    assert.deepEqual(quiet.resources, []);
});

test("collectInventory reports a missing login, a missing extension, a tenant mismatch and bad input as the right exit codes", { skip }, async () => {
    const env = (fixture) => installFakeAz(fixture).env;
    const notLoggedIn = defaultFixture();
    notLoggedIn.failures = { "account show": { code: 1, stderr: "ERROR: Please run 'az login' to setup account." } };
    await assert.rejects(() => collectInventory({ subscriptionIds: [SUB_A], env: env(notLoggedIn) }), (e) => e.code === EXIT.ENVIRONMENT && /az account show failed/.test(e.message) && e.details.some((d) => /az login/.test(d)));
    const noExtension = defaultFixture();
    noExtension.extensions = [{ name: "ssh", version: "1" }];
    await assert.rejects(() => collectInventory({ subscriptionIds: [SUB_A], env: env(noExtension) }), (e) => e.code === EXIT.ENVIRONMENT && /resource-graph/.test(e.message));
    await assert.rejects(() => collectInventory({ subscriptionIds: [SUB_A], tenantId: "00000000-0000-0000-0000-000000000000", env: env(defaultFixture()) }), (e) => e.code === EXIT.ENVIRONMENT && /tenant/.test(e.message));
    await assert.doesNotReject(() => collectInventory({ subscriptionIds: [SUB_A], tenantId: TENANT.toUpperCase(), env: env(defaultFixture()) }));
    await assert.rejects(() => collectInventory({ subscriptionIds: [], env: env(defaultFixture()) }), (e) => e.code === EXIT.USAGE);
    await assert.rejects(() => collectInventory({ subscriptionIds: ["x;rm"], env: env(defaultFixture()) }), (e) => e.code === EXIT.USAGE && e.details[0].includes("x;rm"));
    await assert.rejects(() => collectInventory({ subscriptionIds: [SUB_A], first: 5000, env: env(defaultFixture()) }), (e) => e.code === EXIT.USAGE);
    const broken = defaultFixture();
    broken.failures = { "graph query": { code: 1, stderr: "ERROR: Forbidden" } };
    await assert.rejects(() => collectInventory({ subscriptionIds: [SUB_A], env: env(broken) }), (e) => e.code === EXIT.ENVIRONMENT && e.details.includes("ERROR: Forbidden"));
});

test("collectFit reads vCPU usage and per-size availability in the default subscription", { skip }, async () => {
    const fake = installFakeAz();
    const fit = await collectFit({ location: "Sweden Central", sizes: ["Standard_M416s_v2", "Standard_D4s_v5", "Standard_D4s_v5", "Standard_Unknown_v9"], subscriptionIds: [SUB_A], env: fake.env });
    assert.equal(fit.location, "swedencentral");
    assert.deepEqual(fit.subscription, { id: SUB_A, name: "Sub A" });
    assert.equal(fit.tenantId, TENANT);
    assert.deepEqual(fit.usage, [
        { name: "cores", label: "Total Regional vCPUs", current: 12, limit: 100 },
        { name: "standardDSv5Family", label: "Standard DSv5 Family vCPUs", current: 8, limit: 20 },
    ]);
    assert.deepEqual(fit.skus, [
        { size: "Standard_D4s_v5", available: true, zones: ["1", "2"], restrictions: [{ type: "Zone", reasonCode: "NotAvailableForSubscription", zones: ["3"] }] },
        { size: "Standard_M416s_v2", available: false, zones: ["1"], restrictions: [{ type: "Location", reasonCode: "NotAvailableForSubscription", zones: [] }] },
        { size: "Standard_Unknown_v9", available: false, zones: [], restrictions: [] },
    ]);
    assert.equal(fit.queries, 4);
    assert.deepEqual(fit.warnings, []);
    const calls = fake.calls();
    for (const argv of calls) assert.doesNotThrow(() => assertReadOnly(argv), argv.join(" "));
    assert.ok(calls.some((argv) => argv.join(" ") === "vm list-skus --location swedencentral --resource-type virtualMachines --size Standard_D4s_v5 -o json"));

    const elsewhere = await collectFit({ location: "swedencentral", sizes: [], subscriptionIds: [SUB_B], env: installFakeAz().env });
    assert.deepEqual(elsewhere.skus, []);
    assert.deepEqual(elsewhere.warnings, [`the fit queries ran in the default subscription ${SUB_A}, which is not one of the requested subscriptions`]);
    await assert.rejects(() => collectFit({ location: "", env: fake.env }), (e) => e.code === EXIT.USAGE);
    await assert.rejects(() => collectFit({ location: "swedencentral", sizes: ["x;y"], env: fake.env }), refused);
});
