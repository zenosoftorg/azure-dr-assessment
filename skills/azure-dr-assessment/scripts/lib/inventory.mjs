import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeRegion } from "./assessment.mjs";
import { writeFileAtomic } from "./atomic.mjs";
import { CliError, EXIT } from "./cli.mjs";
import { QUERIES } from "./live.mjs";
import { buildSummary, matchesScope, selectorFromScope, selectorIsSet } from "./scope.mjs";
import { isSecretName, isSecretValue } from "./secrets.mjs";

const SHEET_KINDS = ["resource", "summary", "report", "table", "unstructured", "query"];
const SOURCE_KINDS = ["ari-xlsx", "live"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const SHA256 = /^[0-9a-f]{64}$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isFilled = (value) => typeof value === "string" && value.trim() !== "";
const stringOrNull = (value) => value === null || typeof value === "string";
const isCount = (value) => Number.isInteger(value) && value >= 0;
const stringList = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

function each(errors, name, value, check) {
    if (!Array.isArray(value)) {
        errors.push({ path: name, message: "must be a list" });
        return;
    }
    value.forEach((item, i) => check(item, `${name}[${i}]`));
}

/** Check an inventory against contracts 7.2. A secret-like field name or value is an error. */
export function validateInventory(inv) {
    const errors = [];
    const err = (at, message) => errors.push({ path: at, message });
    if (!isObject(inv)) return { ok: false, errors: [{ path: "", message: "must be an object" }] };
    if (inv.schemaVersion !== 1) err("schemaVersion", "must be 1");

    const source = inv.source;
    if (!isObject(source)) {
        err("source", "must be an object");
    } else {
        if (!SOURCE_KINDS.includes(source.kind)) err("source.kind", `must be ${SOURCE_KINDS.join(" or ")}`);
        if (!stringOrNull(source.file)) err("source.file", "must be a string or null");
        if (!(source.sha256 === null || SHA256.test(source.sha256 ?? ""))) err("source.sha256", "must be a 64-character hex digest or null");
        if (!(source.readAt === null || ISO.test(source.readAt ?? ""))) err("source.readAt", "must be an ISO 8601 UTC timestamp or null");
        if (!stringOrNull(source.tenantId)) err("source.tenantId", "must be a string or null");
        if (!Array.isArray(source.subscriptions) || !source.subscriptions.every((s) => isObject(s) && stringOrNull(s.id) && stringOrNull(s.name))) {
            err("source.subscriptions", "must be a list of { id, name }");
        }
    }

    const scope = inv.scope;
    if (!isObject(scope)) {
        err("scope", "must be an object");
    } else {
        if (typeof scope.applied !== "boolean") err("scope.applied", "must be true or false");
        const selector = scope.selector;
        const tagOk = selector?.tag === null || (isObject(selector?.tag) && isFilled(selector.tag.name) && isFilled(selector.tag.value));
        if (!isObject(selector) || !stringList(selector.resourceGroups) || !stringList(selector.subscriptions) || !tagOk) {
            err("scope.selector", "must be { resourceGroups, tag, subscriptions }");
        }
        if (!isCount(scope.matched)) err("scope.matched", "must be a whole number");
        if (!isCount(scope.total) || (isCount(scope.matched) && scope.matched > scope.total)) err("scope.total", "must be a whole number of at least scope.matched");
    }

    each(errors, "sheets", inv.sheets, (sheet, at) => {
        if (!isObject(sheet)) return err(at, "must be an object");
        if (!isFilled(sheet.name)) err(`${at}.name`, "must be a non-empty string");
        if (typeof sheet.hidden !== "boolean") err(`${at}.hidden`, "must be true or false");
        if (!SHEET_KINDS.includes(sheet.kind)) err(`${at}.kind`, `must be one of ${SHEET_KINDS.join(", ")}`);
        if (!stringOrNull(sheet.armType)) err(`${at}.armType`, "must be a string or null");
        if (!(sheet.headerRow === null || isCount(sheet.headerRow))) err(`${at}.headerRow`, "must be a row number or null");
        if (!stringList(sheet.headers)) err(`${at}.headers`, "must be a list of strings");
        if (!isCount(sheet.rowCount)) err(`${at}.rowCount`, "must be a whole number");
        if (typeof sheet.assessed !== "boolean") err(`${at}.assessed`, "must be true or false");
        if (!stringOrNull(sheet.reason)) err(`${at}.reason`, "must be a string or null");
        return undefined;
    });
    each(errors, "summary", inv.summary, (row, at) => {
        if (!isObject(row)) return err(at, "must be an object");
        for (const key of ["subscription", "resourceGroup", "location", "armType"]) if (!stringOrNull(row[key])) err(`${at}.${key}`, "must be a string or null");
        if (!Number.isInteger(row.count) || row.count < 1) err(`${at}.count`, "must be a whole number of at least 1");
        return undefined;
    });

    const refs = new Set();
    each(errors, "resources", inv.resources, (resource, at) => {
        if (!isObject(resource)) return err(at, "must be an object");
        if (!isFilled(resource.ref)) err(`${at}.ref`, "must be a non-empty string");
        else if (refs.has(resource.ref)) err(`${at}.ref`, `duplicate ref ${resource.ref}`);
        else refs.add(resource.ref);
        if (!isFilled(resource.name)) err(`${at}.name`, "must be a non-empty string");
        for (const key of ["armType", "resourceGroup", "subscription", "subscriptionId", "location", "sku", "zones"]) {
            if (!stringOrNull(resource[key])) err(`${at}.${key}`, "must be a string or null");
        }
        if (!isObject(resource.tags) || !Object.values(resource.tags).every((value) => typeof value === "string")) {
            err(`${at}.tags`, "must map tag names to strings");
        } else {
            for (const [name, value] of Object.entries(resource.tags)) {
                if (isSecretName(name) || isSecretValue(value)) err(`${at}.tags.${name}`, "a secret-like tag must be dropped");
            }
        }
        if (!isObject(resource.fields)) {
            err(`${at}.fields`, "must be an object");
        } else {
            for (const [name, value] of Object.entries(resource.fields)) {
                if (isSecretName(name)) err(`${at}.fields.${name}`, "a secret-like property must be dropped and listed in droppedFields");
                else if (isSecretValue(value)) err(`${at}.fields.${name}`, "a secret-like value must be dropped");
            }
        }
        if (!stringList(resource.droppedFields)) err(`${at}.droppedFields`, "must be a list of strings");
        return undefined;
    });
    each(errors, "omissions", inv.omissions, (omission, at) => {
        if (!isObject(omission) || !isFilled(omission.what) || !isFilled(omission.reason)) err(at, "must be { what, reason } with both set");
    });
    if (!stringList(inv.warnings)) err("warnings", "must be a list of strings");
    return { ok: errors.length === 0, errors };
}

export async function readInventory(file) {
    let raw;
    try {
        raw = await readFile(file, "utf8");
    } catch (err) {
        throw new CliError(EXIT.INPUT, `cannot read ${file}`, [err.message]);
    }
    let inventory;
    try {
        inventory = JSON.parse(raw);
    } catch (err) {
        throw new CliError(EXIT.INPUT, `${file} is not valid JSON`, [err.message]);
    }
    const { ok, errors } = validateInventory(inventory);
    if (!ok) throw new CliError(EXIT.INPUT, `${file} is not a valid inventory`, errors.map((e) => `${e.path}: ${e.message}`));
    return inventory;
}

export async function writeInventory(file, inventory) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, `${JSON.stringify(inventory, null, 2)}\n`);
}

const projected = (query) => query.split("| project ")[1].split(",").map((name) => name.trim());

/** The inventory of contracts 7.2 for a live collection. Refs are arg:<ARM id, lower-cased>. */
export function inventoryFromLive(live, { scope } = {}) {
    const names = new Map(live.subscriptions.map((s) => [s.id.toLowerCase(), s.name]));
    const all = live.resources.map((r) => ({
        ref: `arg:${r.id.toLowerCase()}`,
        armType: r.type || null,
        name: r.name,
        resourceGroup: r.resourceGroup,
        subscription: names.get(String(r.subscriptionId).toLowerCase()) ?? null,
        subscriptionId: r.subscriptionId,
        location: r.location ? normalizeRegion(r.location) || null : null,
        sku: r.sku,
        zones: r.zones,
        tags: r.tags,
        fields: r.fields,
        droppedFields: r.droppedFields,
    }));
    const selector = selectorFromScope(scope);
    const applied = selectorIsSet(selector);
    const inScope = applied ? all.filter((resource) => matchesScope(resource, selector)) : all;
    const warnings = [...live.warnings];
    if (applied && inScope.length === 0) warnings.push(`the scope selector matched none of the ${all.length} resources`);
    const query = (name, headers, rowCount) => ({ name, hidden: false, kind: "query", armType: null, headerRow: null, headers, rowCount, assessed: true, reason: null });
    return {
        schemaVersion: 1,
        source: { kind: "live", file: null, sha256: null, readAt: live.collectedAt, tenantId: live.tenantId, subscriptions: live.subscriptions.map(({ id, name }) => ({ id, name })) },
        scope: { applied, selector, matched: inScope.length, total: all.length },
        sheets: [
            query("query:resources", projected(QUERIES.resources), all.length),
            query("query:subscriptions", projected(QUERIES.subscriptions), live.subscriptions.length),
            query("query:resourceGroups", projected(QUERIES.resourceGroups), live.resourceGroups.length),
        ],
        summary: buildSummary(all),
        resources: inScope,
        omissions: live.permissionGaps.map((gap) => ({ what: `subscription:${gap.subscriptionId}`, reason: gap.reason })),
        warnings,
    };
}

/** Compare the declared primary region with the regions of the resources; global and empty locations are ignored. */
export function checkPrimaryRegion(resources, declared) {
    const counts = new Map();
    for (const resource of resources) {
        if (resource.location && resource.location !== "global") counts.set(resource.location, (counts.get(resource.location) ?? 0) + 1);
    }
    const observed = [...counts]
        .map(([region, count]) => ({ region, resources: count }))
        .sort((a, b) => b.resources - a.resources || (a.region < b.region ? -1 : 1));
    let status = "unknown";
    if (declared && observed.length > 0) status = observed.some((entry) => entry.region === declared) ? "match" : "mismatch";
    return { declared: declared ?? null, observed, status };
}
