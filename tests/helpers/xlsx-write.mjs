import { writeZip } from "./zip-write.mjs";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const DAY = 86400000;

const escapeText = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text) => escapeText(text).replace(/"/g, "&quot;");

function columnLetters(index) {
    let n = index + 1;
    let letters = "";
    while (n > 0) {
        letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
        n = Math.floor((n - 1) / 26);
    }
    return letters;
}

/** Excel serial number of an ISO date or date-time in the 1900 or the 1904 date system. */
function dateSerial(text, date1904) {
    const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text);
    if (!Number.isFinite(ms)) throw new Error(`writeXlsx: not a date: ${text}`);
    if (date1904) return (ms - Date.UTC(1904, 0, 1)) / DAY;
    const days = (ms - Date.UTC(1899, 11, 30)) / DAY;
    return days >= 61 ? days : days - 1;
}

/**
 * Build a minimal .xlsx in memory: shared strings, one date number format, a workbook with
 * relationships and one part per sheet. Cells: string, number, boolean, null (left out) or { date }.
 */
export function writeXlsx(sheets, { date1904 = false } = {}) {
    const strings = [];
    const indexOf = new Map();
    const shared = (text) => {
        if (!indexOf.has(text)) {
            indexOf.set(text, strings.length);
            strings.push(text);
        }
        return indexOf.get(text);
    };

    const sheetXml = (sheet) => {
        const rows = sheet.rows.map((cells, r) => {
            const out = [];
            cells.forEach((cell, c) => {
                if (cell === null || cell === undefined) return;
                const ref = `${columnLetters(c)}${r + 1}`;
                if (typeof cell === "string") {
                    out.push(`<c r="${ref}" t="s"><v>${shared(cell)}</v></c>`);
                } else if (typeof cell === "number") {
                    if (!Number.isFinite(cell)) throw new Error(`writeXlsx: not a finite number at ${ref}`);
                    out.push(`<c r="${ref}"><v>${cell}</v></c>`);
                } else if (typeof cell === "boolean") {
                    out.push(`<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`);
                } else if (typeof cell === "object" && typeof cell.date === "string") {
                    out.push(`<c r="${ref}" s="1"><v>${dateSerial(cell.date, date1904)}</v></c>`);
                } else {
                    throw new Error(`writeXlsx: unsupported cell at ${ref}: ${JSON.stringify(cell)}`);
                }
            });
            return out.length > 0 ? `<row r="${r + 1}">${out.join("")}</row>` : "";
        });
        return `${XML}<worksheet xmlns="${MAIN}"><sheetData>${rows.join("")}</sheetData></worksheet>`;
    };

    // Sheets are rendered first because rendering fills the shared string table.
    const sheetParts = sheets.map(sheetXml);
    const n = sheets.length;
    const entries = [
        {
            name: "[Content_Types].xml",
            data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
                .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
                .join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
        },
        {
            name: "_rels/.rels",
            data: `${XML}<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        },
        {
            name: "xl/workbook.xml",
            data: `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><workbookPr${date1904 ? ' date1904="1"' : ""}/><sheets>${sheets
                .map((s, i) => `<sheet name="${escapeAttr(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`)
                .join("")}</sheets></workbook>`,
        },
        {
            name: "xl/_rels/workbook.xml.rels",
            data: `${XML}<Relationships xmlns="${PACKAGE_REL}">${sheets
                .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
                .join("")}<Relationship Id="rId${n + 1}" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId${n + 2}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
        },
        {
            name: "xl/styles.xml",
            data: `${XML}<styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`,
        },
        {
            name: "xl/sharedStrings.xml",
            data: `${XML}<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings
                .map((s) => `<si><t xml:space="preserve">${escapeText(s)}</t></si>`)
                .join("")}</sst>`,
        },
        ...sheetParts.map((data, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data })),
    ];
    return writeZip(entries);
}
