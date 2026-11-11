import assert from "node:assert/strict";
import test from "node:test";
import { readWorkbook, XlsxError } from "../../skills/azure-dr-assessment/scripts/lib/xlsx.mjs";
import { writeXlsx } from "../helpers/xlsx-write.mjs";
import { writeZip } from "../helpers/zip-write.mjs";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

/** A one-sheet workbook assembled by hand, so each test controls the exact XML. */
function handmade({ rows = "", shared = null, styles = null, workbookPr = "" } = {}) {
    const entries = [
        { name: "[Content_Types].xml", data: "<Types/>" },
        {
            name: "xl/workbook.xml",
            data: `<workbook xmlns="${MAIN}" xmlns:r="${REL}">${workbookPr}<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        },
        {
            name: "xl/_rels/workbook.xml.rels",
            data: `<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
        },
        { name: "xl/worksheets/sheet1.xml", data: `<worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData></worksheet>` },
    ];
    if (shared !== null) entries.push({ name: "xl/sharedStrings.xml", data: `<sst xmlns="${MAIN}">${shared}</sst>` });
    if (styles !== null) entries.push({ name: "xl/styles.xml", data: `<styleSheet xmlns="${MAIN}">${styles}</styleSheet>` });
    return writeZip(entries);
}

const firstRow = (buffer) => readWorkbook(buffer).sheets[0].rows[0];

test("writeXlsx and readWorkbook round-trip strings, numbers, booleans, nulls and row numbers", () => {
    const buffer = writeXlsx([
        { name: "First", rows: [["name", "count", "ok"], ["a & b <c>", 3, true], [], ["  padded  ", -2.5, false, null, "tail"]] },
        { name: "Second", hidden: true, rows: [[null, "only second column"]] },
    ]);
    const book = readWorkbook(buffer);
    assert.deepEqual(book.sheets.map((s) => [s.name, s.hidden]), [["First", false], ["Second", true]]);
    assert.deepEqual(book.sheets[0].rows, [
        { row: 1, values: ["name", "count", "ok"] },
        { row: 2, values: ["a & b <c>", 3, true] },
        { row: 4, values: ["  padded  ", -2.5, false, null, "tail"] },
    ]);
    assert.deepEqual(book.sheets[1].rows, [{ row: 1, values: [null, "only second column"] }]);
});

test("every cell type is read: s, str, inlineStr, b, n, default, e, d, empty strings and styled empties", () => {
    const rows = `<row r="1">
        <c r="A1" t="s"><v>0</v></c>
        <c r="B1" t="str"><v>formula &amp; text</v></c>
        <c r="C1" t="inlineStr"><is><t>inline</t></is></c>
        <c r="D1" t="b"><v>1</v></c>
        <c r="E1" t="b"><v>0</v></c>
        <c r="F1" t="n"><v>2.5</v></c>
        <c r="G1"><v>-7</v></c>
        <c r="H1" t="e"><v>#DIV/0!</v></c>
        <c r="I1" t="d"><v>2026-11-04T00:00:00Z</v></c>
        <c r="J1" t="s"><v>1</v></c>
        <c r="K1" s="0"/>
        <c r="L1" t="n"><f>SUM(F1:G1)</f><v>-4.5</v></c>
        <c r="M1" t="s"><v>0</v></c>
    </row>`;
    const row = firstRow(handmade({ rows, shared: "<si><t>shared</t></si><si><t></t></si>" }));
    assert.deepEqual(row.values, [
        "shared", "formula & text", "inline", true, false, 2.5, -7, "#DIV/0!", "2026-11-04T00:00:00Z", null, null, -4.5, "shared",
    ]);
});

test("shared strings: rich-text runs are joined, phonetic runs ignored, entities and escapes decoded, spaces kept", () => {
    const shared = [
        "<si><r><rPr><b/></rPr><t>Hello </t></r><r><t>wor</t></r><r><t>ld</t></r></si>",
        '<si><t>kanji</t><rPh sb="0" eb="1"><t>PHONETIC</t></rPh><phoneticPr fontId="1"/></si>',
        '<si><t xml:space="preserve">  lead and trail  </t></si>',
        "<si><t>a &amp; b &lt;c&gt; &quot;q&quot; &apos;s&apos; &#65;&#x42; line&#10;break</t></si>",
        "<si><t>cr_x000D_lf_x000A_ and _x005F_x0041_</t></si>",
        "<si/>",
    ].join("");
    const rows = `<row r="1">${[0, 1, 2, 3, 4, 5].map((i) => `<c r="${"ABCDEF"[i]}1" t="s"><v>${i}</v></c>`).join("")}<c r="G1" t="inlineStr"><is><r><t>in</t></r><r><t>line</t></r></is></c></row>`;
    const row = firstRow(handmade({ rows, shared }));
    assert.deepEqual(row.values, [
        "Hello world",
        "kanji",
        "  lead and trail  ",
        "a & b <c> \"q\" 's' AB line\nbreak",
        "cr\rlf\n and _x0041_",
        null,
        "inline",
    ]);
});

test("sparse rows are padded with null, columns past Z work, and rows or cells without r follow their predecessor", () => {
    const rows = `<row r="2"><c r="C2" t="n"><v>3</v></c><c r="AA2" t="n"><v>27</v></c></row>
        <row><c t="n"><v>1</v></c><c t="n"><v>2</v></c></row>
        <row r="9"><c r="B9" t="n"/><c r="XFD9" t="n"><v>16384</v></c></row>
        <row r="10"/>`;
    const book = readWorkbook(handmade({ rows }));
    const [second, third, ninth] = book.sheets[0].rows;
    assert.equal(book.sheets[0].rows.length, 3);
    assert.equal(second.row, 2);
    assert.deepEqual(second.values, [null, null, 3, ...new Array(23).fill(null), 27]);
    assert.deepEqual(third, { row: 3, values: [1, 2] });
    assert.equal(ninth.row, 9);
    assert.equal(ninth.values.length, 16384);
    assert.equal(ninth.values[16383], 16384);
});

test("dates in the 1900 system: built-in and custom formats, the 1900 leap-day gap, times and non-date formats", () => {
    const styles = `<numFmts count="6">
            <numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/>
            <numFmt numFmtId="165" formatCode="[$-409]mmm d, yyyy"/>
            <numFmt numFmtId="166" formatCode="0.00"/>
            <numFmt numFmtId="167" formatCode="&quot;day&quot; 0"/>
            <numFmt numFmtId="168" formatCode="[Red]#,##0.00_);(#,##0.00)"/>
            <numFmt numFmtId="169" formatCode="General"/>
        </numFmts>
        <cellXfs count="9">
            <xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="166"/>
            <xf numFmtId="167"/><xf numFmtId="168"/><xf numFmtId="169"/><xf numFmtId="20"/>
        </cellXfs>`;
    const cells = [
        ["A1", 1, 46330], ["B1", 2, 46330.5729166667], ["C1", 3, 46330], ["D1", 4, 46330], ["E1", 5, 46330],
        ["F1", 6, 46330], ["G1", 7, 46330], ["H1", 0, 46330], ["I1", 1, 61], ["J1", 1, 59], ["K1", 1, 1],
        ["L1", 8, 0.5], ["M1", 2, 36525.9999884259],
    ];
    const rows = `<row r="1">${cells.map(([ref, s, v]) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`).join("")}</row>`;
    assert.deepEqual(firstRow(handmade({ rows, styles })).values, [
        "2026-11-04", "2026-11-04T13:45:00Z", "2026-11-04", 46330, 46330, 46330, 46330, 46330,
        "1900-03-01", "1900-02-28", "1900-01-01", "12:00:00", "1999-12-31T23:59:59Z",
    ]);
});

test("dates in the 1904 system and through writeXlsx in both systems", () => {
    const styles = '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>';
    const rows = '<row r="1"><c r="A1" s="1"><v>0</v></c><c r="B1" s="1"><v>46330</v></c></row>';
    const book1904 = handmade({ rows, styles, workbookPr: '<workbookPr date1904="1"/>' });
    assert.deepEqual(firstRow(book1904).values, ["1904-01-01", "2030-11-05"]);
    const spelled = handmade({ rows, styles, workbookPr: '<workbookPr date1904="true"/>' });
    assert.deepEqual(firstRow(spelled).values, ["1904-01-01", "2030-11-05"]);
    const off = handmade({ rows: '<row r="1"><c r="A1" s="1"><v>46330</v></c></row>', styles, workbookPr: '<workbookPr date1904="false"/>' });
    assert.deepEqual(firstRow(off).values, ["2026-11-04"]);

    // The 1904 system has no dates before 1904-01-01, so 1900-03-01 only round-trips in the 1900 system.
    const common = ["2026-11-04", "2026-11-04T13:45:00Z", "2038-01-19T03:14:07Z"];
    for (const date1904 of [false, true]) {
        const expected = date1904 ? common : ["1900-03-01", ...common];
        const cells = expected.map((date) => ({ date }));
        const book = readWorkbook(writeXlsx([{ name: "D", rows: [cells] }], { date1904 }));
        assert.deepEqual(book.sheets[0].rows[0].values, expected, `date1904=${date1904}`);
    }
});

test("workbook structure: sheet order follows workbook.xml, targets may be relative or absolute, missing optional parts are fine", () => {
    const sheet = (value) => `<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="n"><v>${value}</v></c></row></sheetData></worksheet>`;
    const buffer = writeZip([
        {
            name: "xl/workbook.xml",
            data: `<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="Zed &amp; Co" sheetId="7" r:id="rId9"/><sheet name="Hidden" state="hidden" r:id="rId2"/><sheet name="Very" state="veryHidden" r:id="rId3"/><sheet name="Chart" r:id="rId4"/></sheets></workbook>`,
        },
        {
            name: "xl/_rels/workbook.xml.rels",
            data: `<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Type="${REL}/worksheet" Target="/xl/worksheets/sheet9.xml"/><Relationship Id="rId3" Type="${REL}/worksheet" Target="../xl/worksheets/sheet3.xml"/><Relationship Id="rId4" Type="${REL}/chartsheet" Target="chartsheets/sheet1.xml"/><Relationship Id="rId5" Type="${REL}/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`,
        },
        { name: "xl/worksheets/sheet1.xml", data: sheet(1) },
        { name: "xl/worksheets/sheet3.xml", data: sheet(3) },
        { name: "xl/worksheets/sheet9.xml", data: sheet(9) },
        { name: "xl/chartsheets/sheet1.xml", data: `<chartsheet xmlns="${MAIN}"/>` },
    ]);
    const book = readWorkbook(buffer);
    assert.deepEqual(book.sheets.map((s) => [s.name, s.hidden, s.rows.map((r) => r.values[0])]), [
        ["Zed & Co", false, [9]],
        ["Hidden", true, [1]],
        ["Very", true, [3]],
        ["Chart", false, []],
    ]);
});

test("a worksheet is read in reasonable time and memory", () => {
    const rows = [["id", "name", "tag"]];
    for (let i = 1; i <= 20000; i++) rows.push([i, `resource-${i}`, i % 2 === 0 ? "even" : null]);
    const started = Date.now();
    const book = readWorkbook(writeXlsx([{ name: "Big", rows }]));
    assert.equal(book.sheets[0].rows.length, 20001);
    assert.deepEqual(book.sheets[0].rows[20000], { row: 20001, values: [20000, "resource-20000", "even"] });
    assert.ok(Date.now() - started < 20000, "reading 20000 rows should take seconds, not minutes");
});

test("inputs that are not workbooks fail with XlsxError and name the alternatives", () => {
    const alternatives = /\.xlsx workbook or a live subscription/;
    const good = writeXlsx([{ name: "A", rows: [["x"]] }]);
    const noWorkbook = writeZip([{ name: "hello.txt", data: "hi" }]);
    const ole2 = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    const missingPart = writeZip([
        { name: "xl/workbook.xml", data: `<workbook xmlns:r="${REL}"><sheets><sheet name="A" r:id="rId1"/></sheets></workbook>` },
        { name: "xl/_rels/workbook.xml.rels", data: `<Relationships><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    ]);
    const noRelationship = writeZip([
        { name: "xl/workbook.xml", data: `<workbook xmlns:r="${REL}"><sheets><sheet name="A" r:id="rId7"/></sheets></workbook>` },
    ]);
    const badIndex = handmade({ rows: '<row r="1"><c r="A1" t="s"><v>5</v></c></row>', shared: "<si><t>only</t></si>" });
    const prefixed = writeZip([
        { name: "xl/workbook.xml", data: `<workbook xmlns:r="${REL}"><sheets><sheet name="A" r:id="rId1"/></sheets></workbook>` },
        { name: "xl/_rels/workbook.xml.rels", data: `<Relationships><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
        { name: "xl/worksheets/sheet1.xml", data: `<x:worksheet xmlns:x="${MAIN}"><x:sheetData><x:row r="1"/></x:sheetData></x:worksheet>` },
    ]);
    const cases = {
        "plain text": Buffer.from("name,count\na,1\n"),
        "truncated archive": good.subarray(0, good.length - 30),
        "zip without a workbook": noWorkbook,
        "OLE2 container": ole2,
        "missing sheet part": missingPart,
        "missing relationship": noRelationship,
        "bad shared string index": badIndex,
        "namespace-prefixed worksheet": prefixed,
    };
    for (const [label, buffer] of Object.entries(cases)) {
        assert.throws(() => readWorkbook(buffer), (err) => err instanceof XlsxError && alternatives.test(err.message), label);
    }
    assert.throws(() => readWorkbook(ole2), /OLE2 container/);
    assert.throws(() => readWorkbook(noWorkbook), /xl\/workbook\.xml is missing/);
    assert.throws(() => readWorkbook("not a buffer"), TypeError);
    const corrupt = Buffer.from(good);
    corrupt[Math.floor(corrupt.length / 3)] ^= 0xff;
    assert.throws(() => readWorkbook(corrupt), (err) => err instanceof XlsxError && alternatives.test(err.message));
});
