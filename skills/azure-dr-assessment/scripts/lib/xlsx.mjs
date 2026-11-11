import { readZip, ZipError } from "./zip.mjs";

const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const DAY = 86400000;
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const BUILT_IN_DATE_FORMATS = new Set([
    14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);
const NAMED_ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** The file is not a workbook this reader can use. The message always names the alternatives. */
export class XlsxError extends Error {
    constructor(reason) {
        super(`${reason}. Supported inputs: an .xlsx workbook or a live subscription`);
        this.name = "XlsxError";
    }
}

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body) => {
        if (body[0] === "#") {
            const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return NAMED_ENTITIES[body] ?? whole;
    });
}

/** Entities plus Excel's _xHHHH_ escape for characters XML cannot carry. */
const decodeText = (text) => decodeEntities(text).replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

function attributes(tag) {
    const out = {};
    for (const match of tag.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        out[match[1]] = decodeEntities(match[2] ?? match[3]);
    }
    return out;
}

/** The text of a shared-string item or an inline string: all runs, no phonetic guides. */
function runsText(fragment) {
    const clean = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    let text = "";
    for (const match of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) text += decodeText(match[1] ?? "");
    return text;
}

function sharedStrings(xml) {
    if (!xml) return [];
    return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((match) => runsText(match[1] ?? ""));
}

function isDateFormatCode(code) {
    const stripped = code
        .replace(/"[^"]*"/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\\./g, "")
        .replace(/[_*]./g, "");
    return /[dmyhs]/i.test(stripped);
}

/** The indexes of the cell styles (cellXfs) whose number format is a date or time. */
function dateStyles(xml) {
    const styles = new Set();
    if (!xml) return styles;
    const formats = new Map();
    for (const match of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
        const a = attributes(match[1]);
        formats.set(Number(a.numFmtId), a.formatCode ?? "");
    }
    const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (!block) return styles;
    let index = 0;
    for (const match of block[1].matchAll(/<xf\b([^>]*?)\/?>/g)) {
        const id = Number(attributes(match[1]).numFmtId ?? 0);
        if (BUILT_IN_DATE_FORMATS.has(id) || (formats.has(id) && isDateFormatCode(formats.get(id)))) styles.add(index);
        index++;
    }
    return styles;
}

/** An Excel serial number as an ISO 8601 string: a date, a date-time, or a time of day. */
function serialToIso(serial, date1904) {
    if (!(serial >= 0)) return null;
    const whole = Math.floor(serial);
    const seconds = Math.round((serial - whole) * 86400);
    if (serial > 0 && serial < 1) return new Date(seconds * 1000).toISOString().slice(11, 19);
    // The 1900 system counts a 29 February 1900 that never existed, so serials below 61 sit one day later.
    const base = date1904 ? EPOCH_1904 : serial >= 61 ? EPOCH_1900 : EPOCH_1900 + DAY;
    const ms = base + whole * DAY + seconds * 1000;
    const iso = new Date(ms).toISOString();
    return ms % DAY === 0 ? iso.slice(0, 10) : `${iso.slice(0, 19)}Z`;
}

function columnIndex(ref) {
    const letters = /^[A-Za-z]+/.exec(ref)?.[0];
    if (!letters) return -1;
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

/** The part path a relationship target points to, from xl/. */
function resolveTarget(target) {
    if (target.startsWith("/")) return target.slice(1);
    const out = [];
    for (const part of ["xl", ...target.split("/")]) {
        if (part === "..") out.pop();
        else if (part !== "." && part !== "") out.push(part);
    }
    return out.join("/");
}

function relationships(xml) {
    const out = [];
    for (const match of xml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
        const a = attributes(match[1]);
        if (a.TargetMode === "External" || !a.Id || !a.Target) continue;
        out.push({ id: a.Id, type: a.Type ?? "", path: resolveTarget(a.Target) });
    }
    return out;
}

function cellValue(cell, inner, context) {
    const type = cell.t ?? "n";
    if (type === "inlineStr") {
        const match = /<is\b[^>]*?(?:\/>|>([\s\S]*?)<\/is>)/.exec(inner);
        const text = match ? runsText(match[1] ?? "") : "";
        return text === "" ? null : text;
    }
    const v = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(inner);
    const raw = v?.[1];
    if (raw === undefined || raw === "") return null;
    switch (type) {
        case "s": {
            const index = Number(raw);
            if (!Number.isInteger(index) || index < 0 || index >= context.shared.length) {
                throw new XlsxError(`shared string ${raw} does not exist in sheet ${context.sheet}`);
            }
            return context.shared[index] === "" ? null : context.shared[index];
        }
        case "str":
        case "e":
        case "d": {
            const text = decodeText(raw);
            return text === "" ? null : text;
        }
        case "b":
            return raw.trim() === "1" || raw.trim().toLowerCase() === "true";
        default: {
            const number = Number(raw);
            if (!Number.isFinite(number)) return decodeText(raw);
            return context.dates.has(Number(cell.s)) ? (serialToIso(number, context.date1904) ?? number) : number;
        }
    }
}

function parseSheet(xml, context) {
    if (/<[A-Za-z0-9_]+:sheetData\b/.test(xml)) {
        throw new XlsxError(`sheet ${context.sheet} uses namespace-prefixed XML, which this reader does not support`);
    }
    const data = /<sheetData\b[^>]*?(?:\/>|>([\s\S]*?)<\/sheetData>)/.exec(xml);
    if (!data?.[1]) return [];
    const rows = [];
    let nextRow = 1;
    for (const rowMatch of data[1].matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const rowNumber = Number(attributes(rowMatch[1]).r) || nextRow;
        nextRow = rowNumber + 1;
        const values = [];
        let nextColumn = 0;
        for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const cell = attributes(cellMatch[1]);
            let column = cell.r ? columnIndex(cell.r) : nextColumn;
            if (column < 0) column = nextColumn;
            nextColumn = column + 1;
            const value = cellValue(cell, cellMatch[2] ?? "", context);
            if (value === null) continue;
            while (values.length < column) values.push(null);
            values[column] = value;
        }
        if (values.length > 0) rows.push({ row: rowNumber, values });
    }
    return rows;
}

function parseWorkbook(zip) {
    const workbookXml = zip.text("xl/workbook.xml");
    if (workbookXml === null) throw new XlsxError("xl/workbook.xml is missing, so this is not an OOXML workbook");
    const rels = relationships(zip.text("xl/_rels/workbook.xml.rels") ?? "");
    const byId = new Map(rels.map((rel) => [rel.id, rel]));
    const sharedPath = rels.find((rel) => rel.type.endsWith("/sharedStrings"))?.path ?? "xl/sharedStrings.xml";
    const stylesPath = rels.find((rel) => rel.type.endsWith("/styles"))?.path ?? "xl/styles.xml";
    const shared = sharedStrings(zip.text(sharedPath));
    const dates = dateStyles(zip.text(stylesPath));
    const pr = attributes(/<workbookPr\b([^>]*?)\/?>/.exec(workbookXml)?.[1] ?? "");
    const date1904 = pr.date1904 === "1" || pr.date1904 === "true";

    const sheets = [];
    for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
        const a = attributes(match[1]);
        const name = a.name ?? "";
        const rid = a["r:id"] ?? Object.entries(a).find(([key]) => key.endsWith(":id"))?.[1];
        const rel = byId.get(rid);
        if (!rel) throw new XlsxError(`sheet ${name} has no relationship ${rid}`);
        const xml = zip.text(rel.path);
        if (xml === null) throw new XlsxError(`sheet ${name} points to ${rel.path}, which is missing`);
        sheets.push({
            name,
            hidden: a.state === "hidden" || a.state === "veryHidden",
            rows: parseSheet(xml, { sheet: name, shared, dates, date1904 }),
        });
    }
    return { sheets };
}

/** Read every worksheet of an .xlsx held in memory. Throws XlsxError when the file cannot be used. */
export function readWorkbook(buffer) {
    if (!Buffer.isBuffer(buffer)) throw new TypeError("readWorkbook expects a Buffer");
    if (buffer.length >= OLE2.length && buffer.subarray(0, OLE2.length).equals(OLE2)) {
        throw new XlsxError("this is an OLE2 container: an encrypted or password-protected workbook, or a legacy .xls file");
    }
    try {
        return parseWorkbook(readZip(buffer));
    } catch (err) {
        if (err instanceof ZipError) throw new XlsxError(`this is not a readable .xlsx container (${err.message})`);
        throw err;
    }
}
