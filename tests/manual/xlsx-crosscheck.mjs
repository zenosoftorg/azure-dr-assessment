import { readFileSync } from "node:fs";
import { readWorkbook } from "../../skills/azure-dr-assessment/scripts/lib/xlsx.mjs";

// Manual check, not part of npm test: read the workbook LibreOffice produced from
// tests/manual/xlsx-crosscheck.csv and compare every cell with the values below.
const file = process.argv[2];
if (!file) {
    console.error("usage: node tests/manual/xlsx-crosscheck.mjs <workbook.xlsx>");
    process.exit(1);
}

const EXPECTED = [
    ["text", "number", "flag", "date", "datetime", "empty", "notes"],
    ["plain", 1, true, "2026-11-04", "2026-11-04T13:45:00Z", null, "first"],
    ["with, comma", -2.5, false, "2024-02-29", "2024-02-29", null, 'say "hi"'],
    ["tom & jerry <b>", 1000000, true, "1900-03-01", "1999-12-31T23:59:59Z", null, "multi\nline"],
    ["héllo 日本", 0.1, false, "2038-01-19", "2038-01-19T03:14:07Z", null, "unicode"],
];

const sheet = readWorkbook(readFileSync(file)).sheets[0];
let failures = 0;
EXPECTED.forEach((expected, i) => {
    const actual = sheet.rows[i];
    const same = actual !== undefined && actual.row === i + 1 && JSON.stringify(actual.values) === JSON.stringify(expected);
    if (!same) failures++;
    console.log(`${same ? "ok  " : "FAIL"} row ${i + 1}: ${JSON.stringify(actual?.values)}`);
});
if (sheet.rows.length !== EXPECTED.length) {
    failures++;
    console.log(`FAIL expected ${EXPECTED.length} rows, read ${sheet.rows.length}`);
}
console.log(failures === 0 ? "PASS: the LibreOffice workbook reads as expected" : `FAIL: ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
