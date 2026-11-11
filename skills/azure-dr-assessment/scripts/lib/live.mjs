import { execFile } from "node:child_process";
import { normalizeRegion } from "./assessment.mjs";
import { CliError, EXIT, log } from "./cli.mjs";
import { assertReadOnly, GUID } from "./live-allowlist.mjs";
import { filterTags, isSecretName, isSecretValue } from "./secrets.mjs";

export { assertReadOnly };

/** The three Resource Graph queries of contracts 8.4. */
export const QUERIES = Object.freeze({
    resources: "Resources | project id, name, type, location, resourceGroup, subscriptionId, sku, zones, kind, tags, properties",
    subscriptions: "ResourceContainers | where type =~ 'microsoft.resources/subscriptions' | project subscriptionId, name",
    resourceGroups: "ResourceContainers | where type =~ 'microsoft.resources/subscriptions/resourcegroups' | project subscriptionId, name, location, tags",
});

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
const FLATTEN_DEPTH = 3;
const MAX_VALUE_LENGTH = 500;
const SIGN_IN_HINT = "check that the Azure CLI is signed in: az login";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Run one allowlisted az command. `env` entries are merged over process.env; DR_AZ names the executable.
 * A non-zero exit code is returned; a missing executable, a timeout, too much output or native Windows
 * without DR_AZ is CliError(ENVIRONMENT). On native Windows az is a .cmd file, which Node cannot start without
 * a shell, and the scripts never use a shell (contracts 8.13, D19).
 */
export async function runAz(args, { env = {}, timeoutMs = TIMEOUT_MS, maxBufferBytes = MAX_OUTPUT_BYTES, platform = process.platform } = {}) {
    assertReadOnly(args);
    const merged = { ...process.env, ...env };
    if (platform === "win32" && !merged.DR_AZ) {
        throw new CliError(EXIT.ENVIRONMENT, "live mode is not supported on native Windows", [
            "az is a .cmd file there, and the scripts never start a program through a shell",
            "run the skill in WSL, or give an ARI export",
        ]);
    }
    const executable = merged.DR_AZ || "az";
    return new Promise((resolve, reject) => {
        execFile(executable, args, { env: merged, timeout: timeoutMs, maxBuffer: maxBufferBytes, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
            if (!error) return resolve({ code: 0, stdout, stderr });
            if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
                return reject(
                    new CliError(EXIT.ENVIRONMENT, `az printed more than ${Math.round(maxBufferBytes / 1024 / 1024)} MB`, [
                        `az ${args.slice(0, 2).join(" ")}`,
                        "narrow the query: fewer subscriptions, or a scope selector",
                    ]),
                );
            }
            if (error.killed || error.signal) {
                return reject(new CliError(EXIT.ENVIRONMENT, `az did not answer within ${Math.round(timeoutMs / 1000)} s`, [`az ${args.slice(0, 2).join(" ")}`]));
            }
            if (typeof error.code === "string") {
                const missing = error.code === "ENOENT";
                return reject(
                    new CliError(EXIT.ENVIRONMENT, missing ? "the Azure CLI (az) was not found" : `cannot run the Azure CLI (${error.code})`, [
                        `tried ${executable}`,
                        "install it from https://learn.microsoft.com/cli/azure/install-azure-cli and run az login",
                    ]),
                );
            }
            return resolve({ code: typeof error.code === "number" ? error.code : 1, stdout, stderr });
        });
    });
}

async function azJson(args, env) {
    const result = await runAz(args, { env });
    const name = `az ${args[0] === "version" ? "version" : args.slice(0, 2).join(" ")}`;
    if (result.code !== 0) {
        const reason = result.stderr.split("\n").find((line) => line.trim()) ?? `exit code ${result.code}`;
        throw new CliError(EXIT.ENVIRONMENT, `${name} failed`, [reason.trim(), SIGN_IN_HINT]);
    }
    try {
        return JSON.parse(result.stdout);
    } catch {
        throw new CliError(EXIT.ENVIRONMENT, `${name} returned output that is not JSON`);
    }
}

/**
 * Recursively checks whether an object or array, about to be serialised as JSON text, still hides a
 * secret (GC-07): a secret-like key at any depth, a `name`/`key` property whose own string value reads
 * as secret-like (the Azure app-settings `{ name, value }` pair), or a secret-looking string leaf. Used
 * right before a value deeper than FLATTEN_DEPTH or an array is turned into field text, so the whole
 * field is dropped instead of leaking the secret inside the serialised JSON.
 */
function hasHiddenSecret(value) {
    if (typeof value === "string") return isSecretValue(value);
    if (Array.isArray(value)) return value.some(hasHiddenSecret);
    if (!isPlainObject(value)) return false;
    for (const [key, nested] of Object.entries(value)) {
        if (isSecretName(key)) return true;
        if ((key === "name" || key === "key") && typeof nested === "string" && isSecretName(nested)) return true;
        if (hasHiddenSecret(nested)) return true;
    }
    return false;
}

/**
 * A Resource Graph row as flat, secret-free fields: kind, sku.* and zones, then properties flattened to
 * three levels (deeper values and arrays become JSON text). Secret-like names and values are dropped.
 */
export function flattenResource(row) {
    const fields = {};
    const dropped = [];
    const leaf = (path, value) => {
        if (value === null || value === undefined) return;
        if (isSecretName(path)) {
            dropped.push(path);
            return;
        }
        if (typeof value === "object" && hasHiddenSecret(value)) {
            dropped.push(path);
            return;
        }
        const scalar = typeof value === "object" ? JSON.stringify(value) : value;
        if (typeof scalar === "string" && isSecretValue(scalar)) {
            dropped.push(path);
            return;
        }
        fields[path] = typeof scalar === "string" && scalar.length > MAX_VALUE_LENGTH ? `${scalar.slice(0, MAX_VALUE_LENGTH)}…` : scalar;
    };
    const walk = (object, prefix, depth) => {
        for (const key of Object.keys(object).sort(byText)) {
            const path = `${prefix}.${key}`;
            if (isSecretName(key) || isSecretName(path)) dropped.push(path);
            else if (isPlainObject(object[key]) && depth < FLATTEN_DEPTH) walk(object[key], path, depth + 1);
            else leaf(path, object[key]);
        }
    };
    if (typeof row.kind === "string" && row.kind) leaf("kind", row.kind);
    if (isPlainObject(row.sku)) walk(row.sku, "sku", 1);
    if (Array.isArray(row.zones) && row.zones.length > 0) leaf("zones", row.zones.join(", "));
    if (isPlainObject(row.properties)) walk(row.properties, "properties", 1);
    return { fields, droppedFields: [...new Set(dropped)].sort(byText) };
}

function liveResource(row) {
    const { fields, droppedFields } = flattenResource(row);
    const { tags, dropped } = filterTags(isPlainObject(row.tags) ? row.tags : {});
    const sku = row.sku?.name ?? row.sku?.tier ?? row.properties?.hardwareProfile?.vmSize ?? null;
    return {
        id: row.id,
        name: row.name,
        type: String(row.type ?? "").toLowerCase(),
        location: row.location ?? null,
        resourceGroup: row.resourceGroup ?? null,
        subscriptionId: row.subscriptionId ?? null,
        sku: sku === null ? null : String(sku),
        zones: Array.isArray(row.zones) && row.zones.length > 0 ? row.zones.join(", ") : null,
        kind: typeof row.kind === "string" && row.kind ? row.kind : null,
        tags,
        fields,
        droppedFields: [...droppedFields, ...dropped].sort(byText),
    };
}

/** Run one Resource Graph query to the end, following the skip token. */
async function queryAll(az, query, subscriptionIds, first) {
    const rows = [];
    const warnings = [];
    const tokens = new Set();
    let token = null;
    let calls = 0;
    do {
        const page = await az(["graph", "query", "-q", query, "--subscriptions", ...subscriptionIds, "--first", String(first), ...(token ? ["--skip-token", token] : []), "--allow-partial-scopes"]);
        calls++;
        if (Array.isArray(page?.data)) rows.push(...page.data);
        token = page?.skip_token ?? page?.skipToken ?? null;
        if (token && tokens.has(token)) {
            warnings.push("Resource Graph repeated a skip token; the result may be incomplete");
            break;
        }
        if (token) tokens.add(token);
    } while (token);
    return { rows, calls, warnings };
}

function assertGuids(ids) {
    const bad = ids.filter((id) => !GUID.test(id));
    if (bad.length > 0) throw new CliError(EXIT.USAGE, "subscription ids must be GUIDs", bad.map((id) => `not a subscription id: ${id}`));
}

/**
 * Collect the inventory of the named subscriptions with read-only Resource Graph queries. The tenant and
 * subscriptions are announced on stderr before the first query. Rows come back sorted by lower-cased id.
 */
export async function collectInventory({ subscriptionIds, tenantId = null, first = 1000, env } = {}) {
    const ids = [...new Set((subscriptionIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (ids.length === 0) throw new CliError(EXIT.USAGE, "at least one subscription id is needed");
    assertGuids(ids);
    if (!Number.isInteger(first) || first < 1 || first > 1000) throw new CliError(EXIT.USAGE, "the page size must be between 1 and 1000");
    const az = (args) => azJson([...args, "-o", "json"], env);

    await az(["version"]);
    const account = await az(["account", "show"]);
    if (tenantId && account.tenantId && account.tenantId.toLowerCase() !== tenantId.toLowerCase()) {
        throw new CliError(EXIT.ENVIRONMENT, `signed in to tenant ${account.tenantId}, not ${tenantId}`, [`run: az login --tenant ${tenantId}`]);
    }
    log(`Live collection (read-only): tenant ${account.tenantId}, subscriptions ${ids.join(", ")}`);
    const extensions = await az(["extension", "list"]);
    if (!Array.isArray(extensions) || !extensions.some((extension) => extension.name === "resource-graph")) {
        throw new CliError(EXIT.ENVIRONMENT, "the Azure CLI extension resource-graph is not installed", ["install it with: az extension add --name resource-graph"]);
    }
    const accounts = await az(["account", "list"]);

    const resources = await queryAll(az, QUERIES.resources, ids, first);
    const containers = await queryAll(az, QUERIES.subscriptions, ids, first);
    const groups = await queryAll(az, QUERIES.resourceGroups, ids, first);

    const names = new Map(accounts.map((entry) => [entry.id.toLowerCase(), entry.name]));
    for (const row of containers.rows) if (!names.has(row.subscriptionId.toLowerCase())) names.set(row.subscriptionId.toLowerCase(), row.name);
    const visible = new Set(accounts.map((entry) => entry.id.toLowerCase()));
    const withRows = new Set(resources.rows.map((row) => String(row.subscriptionId).toLowerCase()));
    const permissionGaps = [];
    const warnings = [...resources.warnings, ...containers.warnings, ...groups.warnings];
    for (const id of ids) {
        if (withRows.has(id.toLowerCase())) continue;
        if (visible.has(id.toLowerCase())) warnings.push(`subscription ${id} returned no resources`);
        else permissionGaps.push({ subscriptionId: id, reason: "not visible to the signed-in account and returned no resources" });
    }

    return {
        collectedAt: new Date().toISOString(),
        tenantId: account.tenantId,
        subscriptions: ids.map((id) => ({ id, name: names.get(id.toLowerCase()) ?? null })),
        queries: resources.calls + containers.calls + groups.calls,
        resources: resources.rows.map(liveResource).sort((a, b) => byText(a.id.toLowerCase(), b.id.toLowerCase())),
        resourceGroups: groups.rows
            .map((row) => ({
                subscriptionId: row.subscriptionId,
                name: row.name,
                location: row.location ?? null,
                tags: filterTags(isPlainObject(row.tags) ? row.tags : {}).tags,
            }))
            .sort((a, b) => byText(`${a.subscriptionId}/${a.name}`.toLowerCase(), `${b.subscriptionId}/${b.name}`.toLowerCase())),
        permissionGaps,
        warnings,
    };
}

function interpretSku(size, region, list) {
    const entry = (Array.isArray(list) ? list : []).find((sku) => String(sku.name).toLowerCase() === size.toLowerCase());
    if (!entry) return { size, available: false, zones: [], restrictions: [] };
    const restrictions = Array.isArray(entry.restrictions) ? entry.restrictions : [];
    const blockedZones = restrictions.filter((r) => r.type === "Zone").flatMap((r) => r.restrictionInfo?.zones ?? []);
    const info = (entry.locationInfo ?? []).find((item) => normalizeRegion(item.location) === region);
    return {
        size,
        available: !restrictions.some((r) => r.type === "Location"),
        zones: (info?.zones ?? []).filter((zone) => !blockedZones.includes(zone)),
        restrictions: restrictions.map((r) => ({ type: r.type, reasonCode: r.reasonCode, zones: r.restrictionInfo?.zones ?? [] })),
    };
}

/**
 * Fit checks for one region: vCPU usage and, per VM size, availability and zone restrictions. The az
 * commands carry no --subscription (contracts 8.4), so they run in the default subscription.
 */
export async function collectFit({ location, sizes = [], subscriptionIds = [], tenantId = null, env } = {}) {
    const region = normalizeRegion(location);
    if (!region) throw new CliError(EXIT.USAGE, "a location is needed");
    const az = (args) => azJson([...args, "-o", "json"], env);
    await az(["version"]);
    const account = await az(["account", "show"]);
    if (tenantId && account.tenantId && account.tenantId.toLowerCase() !== tenantId.toLowerCase()) {
        throw new CliError(EXIT.ENVIRONMENT, `signed in to tenant ${account.tenantId}, not ${tenantId}`, [`run: az login --tenant ${tenantId}`]);
    }
    const usage = await az(["vm", "list-usage", "--location", region]);
    const skus = [];
    for (const size of [...new Set(sizes)].sort(byText)) {
        skus.push(interpretSku(size, region, await az(["vm", "list-skus", "--location", region, "--resource-type", "virtualMachines", "--size", size])));
    }
    const warnings = [];
    if (subscriptionIds.length > 0 && !subscriptionIds.some((id) => id.toLowerCase() === String(account.id).toLowerCase())) {
        warnings.push(`the fit queries ran in the default subscription ${account.id}, which is not one of the requested subscriptions`);
    }
    return {
        collectedAt: new Date().toISOString(),
        tenantId: account.tenantId,
        location: region,
        subscription: { id: account.id, name: account.name ?? null },
        usage: usage.map((row) => ({ name: row.name?.value ?? null, label: row.name?.localizedValue ?? null, current: row.currentValue, limit: row.limit })),
        skus,
        queries: 1 + skus.length,
        warnings,
    };
}
