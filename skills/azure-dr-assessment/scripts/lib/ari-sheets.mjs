import { readFileSync } from "node:fs";
import path from "node:path";
import { skillRoot } from "./paths.mjs";

const MAP = JSON.parse(readFileSync(path.join(skillRoot(), "assets", "ari-sheet-map.json"), "utf8"));
const SUMMARY = new Set(MAP.summary);
const REPORT = new Set(MAP.report);
const UNSTRUCTURED = new Set(MAP.unstructured);
const HEADER_SEARCH_ROWS = 10;

/** "SQL DBs" and "sql dbs" both become "sqldbs". */
export const normalizeSheetName = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Header comparison ignores case and spacing. */
export const normalizeHeader = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** What the sheet map says about a worksheet name: resource, summary, report, unstructured or unmapped. */
export function classifySheet(name) {
    const key = normalizeSheetName(name);
    if (UNSTRUCTURED.has(key)) return { kind: "unstructured" };
    if (SUMMARY.has(key)) return { kind: "summary" };
    if (REPORT.has(key)) return { kind: "report" };
    const entry = MAP.resources[key];
    if (entry) return { kind: "resource", armType: entry.armType, columns: entry.columns ?? {} };
    return { kind: "unmapped" };
}

const isEmpty = (value) => value === null || (typeof value === "string" && value.trim() === "");

/**
 * The header row: the first of the first ten rows with at least two non-empty cells where every
 * non-empty cell is a string. `row` is the Excel row number, `headers` lines up with the columns.
 */
export function findHeader(rows) {
    for (let index = 0; index < Math.min(HEADER_SEARCH_ROWS, rows.length); index++) {
        const filled = rows[index].values.filter((value) => !isEmpty(value));
        if (filled.length >= 2 && filled.every((value) => typeof value === "string")) {
            return {
                index,
                row: rows[index].row,
                headers: rows[index].values.map((value) => (typeof value === "string" ? value.trim() : "")),
            };
        }
    }
    return null;
}

/** A lookup from header names to column indexes: the first name that exists wins, -1 when none does. */
export function columnFinder(headers) {
    const normalized = headers.map(normalizeHeader);
    return (...names) => {
        for (const name of names) {
            if (!name) continue;
            const index = normalized.indexOf(normalizeHeader(name));
            if (index >= 0) return index;
        }
        return -1;
    };
}
