import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { crc32, extractZip, readZip, ZipError } from "../../skills/azure-dr-assessment/scripts/lib/zip.mjs";
import { writeZip } from "../helpers/zip-write.mjs";

const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-zip-"));

test("crc32 matches the standard check value", () => {
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("writeZip and readZip round-trip stored and deflated entries", () => {
    const big = "A".repeat(5000);
    const zip = readZip(writeZip([
        { name: "a.txt", data: "hello" },
        { name: "dir/", data: "" },
        { name: "dir/b.bin", data: Buffer.from([0, 1, 2, 3]), store: true },
        { name: "dir/big.txt", data: big },
    ]));
    assert.deepEqual(zip.entries.map((e) => e.name), ["a.txt", "dir/", "dir/b.bin", "dir/big.txt"]);
    assert.equal(zip.entries[1].isDirectory, true);
    assert.equal(zip.has("a.txt"), true);
    assert.equal(zip.has("nope"), false);
    assert.equal(zip.text("a.txt"), "hello");
    assert.deepEqual([...zip.read("dir/b.bin")], [0, 1, 2, 3]);
    assert.equal(zip.text("dir/big.txt"), big);
    assert.equal(zip.text("nope"), null);
});

test("readZip rejects non-zip data, truncation and corrupted content", () => {
    assert.throws(() => readZip(Buffer.from("not a zip at all, just some text")), ZipError);
    const good = writeZip([{ name: "a.txt", data: "hello world", store: true }]);
    assert.throws(() => readZip(good.subarray(0, good.length - 10)), ZipError);
    const corrupt = Buffer.from(good);
    corrupt[30 + "a.txt".length] ^= 0xff;
    assert.throws(() => readZip(corrupt).read("a.txt"), (e) => e instanceof ZipError && /CRC/.test(e.message));
});

test("readZip refuses a deflated entry whose real size exceeds its declared size", () => {
    const zip = Buffer.from(writeZip([{ name: "bomb.txt", data: "A".repeat(64 * 1024) }]));
    const declared = 100;
    zip.writeUInt32LE(declared, zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04])) + 22);
    zip.writeUInt32LE(declared, zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    const archive = readZip(zip);
    assert.equal(archive.entries[0].size, declared);
    assert.throws(() => archive.read("bomb.txt"), (e) => e instanceof ZipError && /bomb\.txt/.test(e.message) && /wrong size/.test(e.message) && /exceeds the declared size/.test(e.message));
});

test("extractZip writes files below the destination and skips directories and filtered names", async () => {
    const dest = tmp();
    const zip = writeZip([
        { name: "Top/", data: "" },
        { name: "Top/Icons/one.svg", data: "<svg/>" },
        { name: "Top/readme.txt", data: "skip me" },
    ]);
    const result = await extractZip(zip, dest, { filter: (name) => name.endsWith(".svg") });
    assert.deepEqual(result.files, ["Top/Icons/one.svg"]);
    assert.equal(result.bytes, 6);
    assert.equal(readFileSync(path.join(dest, "Top", "Icons", "one.svg"), "utf8"), "<svg/>");
    assert.equal(existsSync(path.join(dest, "Top", "readme.txt")), false);
});

test("extractZip refuses unsafe paths and writes nothing", async () => {
    for (const name of ["../evil.txt", "/abs.txt", "a/../../evil.txt", "C:/win.txt"]) {
        const dest = tmp();
        const zip = writeZip([{ name: "ok.txt", data: "fine" }, { name, data: "bad" }]);
        await assert.rejects(() => extractZip(zip, dest), (e) => e instanceof ZipError && /unsafe/.test(e.message), name);
        assert.deepEqual(readdirSync(dest), []);
    }
});

test("readZip reads an archive made by the system zip tool", { skip: spawnSync("zip", ["-v"]).status !== 0 }, () => {
    const src = tmp();
    mkdirSync(path.join(src, "sub"));
    writeFileSync(path.join(src, "sub", "x.txt"), "x".repeat(2000));
    writeFileSync(path.join(src, "y.txt"), "why");
    const out = path.join(tmp(), "made.zip");
    execFileSync("zip", ["-q", "-r", out, "."], { cwd: src });
    const zip = readZip(readFileSync(out));
    assert.equal(zip.text("y.txt"), "why");
    assert.equal(zip.text("sub/x.txt"), "x".repeat(2000));
});
