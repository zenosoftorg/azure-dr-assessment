import { normalizeRegion } from "./assessment.mjs";
import { classifySheet, columnFinder, findHeader } from "./ari-sheets.mjs";
import { buildCandidates, buildSummary, matchesScope, selectorFromScope, selectorIsSet, sortSummary } from "./scope.mjs";
import { filterTags, isSecretName, isSecretValue } from "./secrets.mjs";

export const DEFAULT_MAX_ROWS_PER_SHEET = 20000;

const NAME_COLUMNS = ["Name", "VM Name", "Resource Name"];
const SKU_COLUMNS = ["SKU", "VM Size", "Service Tier"];
const ZONE_COLUMNS = ["Zone", "Availability Zone", "Zones"];

function text(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return s === "" ? null : s;
}

const region = (value) => (value === null ? null : normalizeRegion(value) || null);

function firstText(row, indexes) {
    for (const index of indexes) {
        const value = text(row.values[index]);
        if (value !== null) return value;
    }
    return null;
}

/** The first row of a resource: identity, sku, zones and every other non-empty cell as a field. */
function newResource({ sheet, armType, row, headers, fieldKeys, index, name }) {
    const get = (i) => (i >= 0 ? (row.values[i] ?? null) : null);
    const fields = {};
    const droppedFields = [];
    headers.forEach((header, i) => {
        const value = row.values[i] ?? null;
        if (!header || value === null || index.skip.has(i)) return;
        if (isSecretName(header) || isSecretValue(value)) {
            if (!droppedFields.includes(header)) droppedFields.push(header);
            return;
        }
        fields[fieldKeys[i]] = value;
    });
    return {
        ref: `ari:${sheet}!${row.row}`,
        armType,
        name,
        resourceGroup: text(get(index.resourceGroup)),
        subscription: text(get(index.subscription)),
        subscriptionId: null,
        location: region(text(get(index.location))),
        sku: firstText(row, index.sku),
        zones: firstText(row, index.zones),
        tags: {},
        fields,
        droppedFields,
    };
}

/** Turn the data rows of one mapped sheet into resources: rows of one resource merge and their tags fold into tags. */
function readResources({ sheet, cls, header, dataRows, warnings }) {
    const col = columnFinder(header.headers);
    const index = {
        subscription: col(cls.columns.subscription, "Subscription"),
        resourceGroup: col(cls.columns.resourceGroup, "Resource Group"),
        name: col(cls.columns.name, ...NAME_COLUMNS),
        location: col(cls.columns.location, "Location"),
        resourceU: col("Resource U"),
        tagName: col("Tag Name"),
        tagValue: col("Tag Value"),
        sku: SKU_COLUMNS.map((name) => col(name)).filter((i) => i >= 0),
        zones: ZONE_COLUMNS.map((name) => col(name)).filter((i) => i >= 0),
    };
    index.skip = new Set([index.subscription, index.resourceGroup, index.name, index.location, index.resourceU, index.tagName, index.tagValue]);
    // A repeated header keeps every column: the second "Name" column becomes the field "Name (2)".
    const seen = new Map();
    const fieldKeys = header.headers.map((h) => {
        const n = (seen.get(h) ?? 0) + 1;
        seen.set(h, n);
        return n === 1 ? h : `${h} (${n})`;
    });

    const resources = [];
    const latest = new Map();
    let unnamed = 0;
    for (const row of dataRows) {
        const name = text(row.values[index.name]);
        if (name === null) {
            unnamed++;
            continue;
        }
        const get = (i) => (i >= 0 ? (row.values[i] ?? null) : null);
        const key = [sheet, text(get(index.subscription)), text(get(index.resourceGroup)), name].join("\u0000");
        const startsNew = index.resourceU >= 0 && Number(get(index.resourceU)) === 1;
        let resource = latest.get(key);
        if (!resource || startsNew) {
            resource = newResource({ sheet, armType: cls.armType, row, headers: header.headers, fieldKeys, index, name });
            latest.set(key, resource);
            resources.push(resource);
        }
        const tagName = text(get(index.tagName));
        if (tagName !== null) resource.tags[tagName] = text(get(index.tagValue)) ?? "";
    }
    for (const resource of resources) {
        const { tags, dropped } = filterTags(resource.tags);
        resource.tags = tags;
        resource.droppedFields.push(...dropped);
    }
    if (unnamed > 0) warnings.push(`sheet ${sheet}: ${unnamed} row(s) without a name were skipped`);
    return resources;
}

function readSummary(col, dataRows, warnings) {
    const index = {
        subscription: col("Subscription"), resourceGroup: col("Resource Group"), location: col("Location"),
        type: col("Resource Type"), count: col("Resources Count"),
    };
    if (index.type < 0 || index.count < 0) {
        warnings.push("the Subscriptions sheet has no Resource Type and Resources Count columns, so the summary is computed from the resource sheets");
        return null;
    }
    const rows = [];
    for (const row of dataRows) {
        const armType = text(row.values[index.type]);
        const count = Number(row.values[index.count]);
        if (armType === null || !Number.isFinite(count)) continue;
        rows.push({
            subscription: text(row.values[index.subscription]),
            resourceGroup: text(row.values[index.resourceGroup]),
            location: region(text(row.values[index.location])),
            armType: armType.toLowerCase(),
            count,
        });
    }
    return sortSummary(rows);
}

/** Read every sheet: classify it, find its header and, for mapped resource sheets, build the resources. */
function readAri(workbook, maxRowsPerSheet) {
    const sheets = [];
    const resources = [];
    const omissions = [];
    const warnings = [];
    let summary = null;
    for (const sheet of workbook.sheets) {
        const cls = classifySheet(sheet.name);
        const header = cls.kind === "unstructured" ? null : findHeader(sheet.rows);
        const info = {
            name: sheet.name, hidden: sheet.hidden, kind: "unstructured", armType: null, headerRow: null, headers: [],
            rowCount: sheet.rows.length, assessed: false, reason: "unstructured",
        };
        sheets.push(info);
        if (!header) {
            omissions.push({ what: `sheet:${sheet.name}`, reason: "unstructured" });
            continue;
        }
        const dataRows = sheet.rows.slice(header.index + 1);
        Object.assign(info, { headerRow: header.row, headers: header.headers, rowCount: dataRows.length, reason: null });
        if (cls.kind === "summary") {
            info.kind = "summary";
            info.assessed = true;
            summary = readSummary(columnFinder(header.headers), dataRows, warnings);
        } else if (cls.kind === "resource") {
            info.kind = "resource";
            info.armType = cls.armType;
            const nameColumns = [cls.columns.name, ...NAME_COLUMNS].filter(Boolean);
            if (columnFinder(header.headers)(...nameColumns) < 0) {
                info.reason = `no name column (${nameColumns.join(", ")})`;
                omissions.push({ what: `sheet:${sheet.name}`, reason: info.reason });
                continue;
            }
            info.assessed = true;
            const rows = dataRows.slice(0, maxRowsPerSheet);
            if (rows.length < dataRows.length) {
                info.reason = `truncated to the first ${maxRowsPerSheet} rows`;
                warnings.push(`sheet ${sheet.name} has ${dataRows.length} rows; only the first ${maxRowsPerSheet} were read`);
            }
            resources.push(...readResources({ sheet: sheet.name, cls, header, dataRows: rows, warnings }));
        } else {
            info.kind = cls.kind === "report" ? "report" : "table";
            info.reason = "not mapped to a resource type";
        }
    }
    return { sheets, resources, omissions, warnings, summary };
}

/** The intake pass: what the workbook holds, counted by subscription, resource group and type, and the candidate workloads. */
export function summarizeAri(workbook, { maxRowsPerSheet = DEFAULT_MAX_ROWS_PER_SHEET } = {}) {
    const read = readAri(workbook, maxRowsPerSheet);
    return { sheets: read.sheets, summary: read.summary ?? buildSummary(read.resources), candidates: buildCandidates(read.resources) };
}

/** The inventory of contracts 7.2 for an ARI workbook, cut by the scope selector. `ingest` fills source.file, sha256 and readAt. */
export function normalizeAri(workbook, { maxRowsPerSheet = DEFAULT_MAX_ROWS_PER_SHEET, scope } = {}) {
    const read = readAri(workbook, maxRowsPerSheet);
    const selector = selectorFromScope(scope);
    const applied = selectorIsSet(selector);
    const inScope = applied ? read.resources.filter((resource) => matchesScope(resource, selector)) : read.resources;
    const summary = read.summary ?? buildSummary(read.resources);
    const names = new Set((read.summary ? read.summary.map((row) => row.subscription) : read.resources.map((r) => r.subscription)).filter(Boolean));
    const warnings = [...read.warnings];
    if (applied && inScope.length === 0) warnings.push(`the scope selector matched none of the ${read.resources.length} resources`);
    return {
        schemaVersion: 1,
        source: {
            kind: "ari-xlsx", file: null, sha256: null, readAt: null, tenantId: null,
            subscriptions: [...names].sort().map((name) => ({ id: null, name })),
        },
        scope: { applied, selector, matched: inScope.length, total: read.resources.length },
        sheets: read.sheets,
        summary,
        resources: inScope,
        omissions: read.omissions,
        warnings,
    };
}
