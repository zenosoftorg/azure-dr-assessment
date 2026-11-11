import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ZIP_LIMITS, ZipError, extractZip, readZip } from "../../skills/azure-dr-assessment/scripts/lib/zip.mjs";
import { writeZip } from "../helpers/zip-write.mjs";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>\n';
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-ziplimits-"));
const isZipError = (pattern) => (e) => e instanceof ZipError && pattern.test(e.message);
const files = (names, size = 60) => writeZip(names.map((name) => ({ name, data: "x".repeat(size) })));

test("the default limits are generous for the icon archives", () => {
    assert.deepEqual({ ...ZIP_LIMITS }, { maxEntries: 20000, maxEntryBytes: 33554432, maxTotalBytes: 268435456 });
});

test("an entry that carries a zip64 marker is refused with a clear message", () => {
    // offsets in the central directory record: compressed size 20, size 24, local header offset 42
    for (const [field, at] of [["compressed size", 20], ["size", 24], ["local header offset", 42]]) {
        const zip = Buffer.from(writeZip([{ name: "big.svg", data: SVG, store: true }]));
        zip.writeUInt32LE(0xffffffff, zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + at);
        assert.throws(() => readZip(zip), isZipError(/^"big\.svg" uses zip64, which is not supported$/), field);
    }
});

test("a control character in an entry name is an unsafe path, and nothing is written", async () => {
    for (const name of ["icons/a\0b.svg", "icons/a\nb.svg"]) {
        const dest = path.join(tmp(), "out");
        await assert.rejects(
            () => extractZip(writeZip([{ name, data: SVG }]), dest),
            (e) => e instanceof ZipError && e.message === `unsafe path in archive: ${JSON.stringify(name)}`,
        );
        assert.equal(existsSync(dest), false);
    }
});

test("DEL and the C1 control characters in an entry name are an unsafe path, and nothing is written", async () => {
    for (const code of [0x7f, 0x80, 0x85, 0x9f]) {
        const name = `icons/a${String.fromCharCode(code)}b.svg`;
        const dest = path.join(tmp(), "out");
        await assert.rejects(
            () => extractZip(writeZip([{ name, data: SVG }]), dest),
            (e) => e instanceof ZipError && e.message === `unsafe path in archive: ${JSON.stringify(name)}`,
            `U+${code.toString(16).padStart(4, "0")}`,
        );
        assert.equal(existsSync(dest), false);
    }
});

test("the characters next to the control ranges are not control characters: ~, a no-break space and a letter with an accent", async () => {
    const names = ["icons/a~b.svg", "icons/a\u00a0b.svg", "icons/caf\u00e9.svg"];
    const dest = path.join(tmp(), "out");
    const result = await extractZip(writeZip(names.map((name) => ({ name, data: SVG }))), dest);
    assert.deepEqual(result.files.sort(), [...names].sort());
    assert.equal(readdirSync(path.join(dest, "icons")).length, 3);
});

test("extractZip refuses more files than the limit before it writes anything", async () => {
    const dest = path.join(tmp(), "out");
    await assert.rejects(() => extractZip(files(["a.svg", "b.svg", "c.svg"]), dest, { maxEntries: 2 }), isZipError(/holds 3 files to extract, more than the limit of 2/));
    assert.equal(existsSync(dest), false);
    const wanted = await extractZip(files(["a.svg", "b.svg", "c.txt"]), dest, { maxEntries: 2, filter: (name) => name.endsWith(".svg") });
    assert.deepEqual(wanted.files.sort(), ["a.svg", "b.svg"]);
});

test("extractZip refuses a file that is declared larger than the per-file limit", async () => {
    const dest = path.join(tmp(), "out");
    await assert.rejects(() => extractZip(files(["big.svg"], 200), dest, { maxEntryBytes: 100 }), isZipError(/^big\.svg is 200 bytes, more than the limit of 100 bytes per file$/));
    assert.equal(existsSync(dest), false);
    assert.deepEqual((await extractZip(files(["ok.svg"], 100), dest, { maxEntryBytes: 100 })).files, ["ok.svg"]);
});

test("extractZip refuses files that add up to more than the total limit, and accepts exactly the limit", async () => {
    const dest = path.join(tmp(), "out");
    const zip = files(["a.svg", "b.svg", "c.svg"]);
    await assert.rejects(() => extractZip(zip, dest, { maxTotalBytes: 179 }), isZipError(/add up to more than the limit of 179 bytes/));
    assert.equal(existsSync(dest), false);
    const result = await extractZip(zip, dest, { maxTotalBytes: 180 });
    assert.equal(result.bytes, 180);
    assert.deepEqual(readdirSync(dest).sort(), ["a.svg", "b.svg", "c.svg"]);
});

test("ZIP_LIMITS is frozen", () => {
    assert.ok(Object.isFrozen(ZIP_LIMITS));
});

test("extractZip applies the default limits when none are passed", async () => {
    const dest = path.join(tmp(), "out");
    const many = writeZip(Array.from({ length: ZIP_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `f${i}.svg`, data: "x" })));
    await assert.rejects(() => extractZip(many, dest), isZipError(/more than the limit of 20000/));
    assert.equal(existsSync(dest), false);
    const big = writeZip([{ name: "big.svg", data: Buffer.alloc(ZIP_LIMITS.maxEntryBytes + 1) }]);
    await assert.rejects(() => extractZip(big, dest), isZipError(/more than the limit of 33554432 bytes per file/));
    assert.equal(existsSync(dest), false);
    const full = Buffer.alloc(ZIP_LIMITS.maxEntryBytes);
    const nine = writeZip(Array.from({ length: 9 }, (_, i) => ({ name: `part${i}.svg`, data: full })));
    await assert.rejects(() => extractZip(nine, dest), isZipError(/add up to more than the limit of 268435456 bytes/));
    assert.equal(existsSync(dest), false);
});

// One archive per default limit, each over that limit only. Big before deflating, small after; built once.
let overDefaults;
const overDefault = () =>
    (overDefaults ??= {
        maxEntries: writeZip(Array.from({ length: ZIP_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `f${i}.svg`, data: "x" }))),
        maxEntryBytes: writeZip([{ name: "big.svg", data: Buffer.alloc(ZIP_LIMITS.maxEntryBytes + 1) }]),
        maxTotalBytes: writeZip(Array.from({ length: 9 }, (_, i) => ({ name: `part${i}.svg`, data: Buffer.alloc(ZIP_LIMITS.maxEntryBytes) }))),
    });
const DEFAULT_REFUSAL = {
    maxEntries: /more than the limit of 20000$/,
    maxEntryBytes: /more than the limit of 33554432 bytes per file$/,
    maxTotalBytes: /add up to more than the limit of 268435456 bytes$/,
};

for (const [label, bad] of [["undefined", undefined], ["NaN", NaN], ["null", null], ["a string", "5"], ["a negative number", -1], ["Infinity", Infinity]]) {
    test(`extractZip keeps the default limits when a limit option is ${label}`, async () => {
        for (const [option, pattern] of Object.entries(DEFAULT_REFUSAL)) {
            const dest = path.join(tmp(), "out");
            await assert.rejects(() => extractZip(overDefault()[option], dest, { [option]: bad }), isZipError(pattern), option);
            assert.equal(existsSync(dest), false, option);
        }
    });
}

test("extractZip takes a limit of 0 from the options: 0 is a limit, not a missing value", async () => {
    const dest = path.join(tmp(), "out");
    const zip = files(["a.svg"]);
    await assert.rejects(() => extractZip(zip, dest, { maxEntries: 0 }), isZipError(/holds 1 files to extract, more than the limit of 0$/));
    await assert.rejects(() => extractZip(zip, dest, { maxEntryBytes: 0 }), isZipError(/^a\.svg is 60 bytes, more than the limit of 0 bytes per file$/));
    await assert.rejects(() => extractZip(zip, dest, { maxTotalBytes: 0 }), isZipError(/add up to more than the limit of 0 bytes$/));
    assert.equal(existsSync(dest), false);
});
