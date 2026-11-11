import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import {
    DEFAULT_SET_IDS,
    ICON_SETS,
    countSvgs,
    displayUrl,
    parseSetList,
    parseUrlOverrides,
    resolveSetUrl,
    setById,
} from "../../skills/azure-dr-assessment/scripts/lib/icon-sets.mjs";
import { SIG } from "../helpers/secret-shapes.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const usage = (err) => err instanceof CliError && err.code === EXIT.USAGE;

test("the set table names the collection folders the canvas catalog recognizes", () => {
    const catalog = readFileSync(path.join(root, "extensions", "architecture-canvas", "lib", "icons.mjs"), "utf8");
    for (const set of ICON_SETS) {
        assert.ok(catalog.includes(`dir: ${JSON.stringify(set.dir)}, id: ${JSON.stringify(set.id)}`), `${set.id}: ${set.dir}`);
    }
    assert.equal(new Set(ICON_SETS.map((set) => set.id)).size, ICON_SETS.length);
    assert.deepEqual(DEFAULT_SET_IDS, ["azure"]);
    assert.equal(setById("azure").url, "https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip");
    assert.equal(setById("m365").url, null);
    assert.equal(setById("nope"), null);
});

test("parseSetList accepts ids, removes duplicates and expands all", () => {
    assert.deepEqual(parseSetList("azure"), ["azure"]);
    assert.deepEqual(parseSetList(" Azure , fabric,azure "), ["azure", "fabric"]);
    assert.deepEqual(parseSetList("all"), ["azure", "entra", "power", "dynamics", "fabric", "m365"]);
    for (const bad of ["", " , ", "azure,bogus"]) assert.throws(() => parseSetList(bad), usage, JSON.stringify(bad));
    assert.throws(() => parseSetList("azure,bogus"), /unknown icon set: bogus/);
});

test("resolveSetUrl prefers an explicit URL, then the mirror, then the official download", () => {
    const azure = setById("azure");
    const fabric = setById("fabric");
    assert.equal(resolveSetUrl(azure), azure.url);
    assert.equal(resolveSetUrl(azure, { mirror: "https://mirror.example/icons/" }), "https://mirror.example/icons/Azure_Public_Service_Icons_V24.zip");
    assert.equal(resolveSetUrl(fabric, { mirror: "https://mirror.example/icons" }), "https://mirror.example/icons/Fabric%20Icons.zip");
    assert.equal(resolveSetUrl(fabric, { mirror: "https://mirror.example/icons?sig=abc" }), "https://mirror.example/icons/Fabric%20Icons.zip?sig=abc");
    assert.equal(
        resolveSetUrl(fabric, { mirror: "https://mirror.example/icons", overrides: { fabric: "https://other.example/f.zip" } }),
        "https://other.example/f.zip",
    );
    assert.equal(resolveSetUrl(setById("m365")), null);
    assert.equal(resolveSetUrl(setById("m365"), { mirror: "https://mirror.example" }), "https://mirror.example/2024-microsoft-365-content-icons.zip");
});

test("resolveSetUrl rejects a mirror or override that is not an http(s) URL", () => {
    const azure = setById("azure");
    assert.throws(() => resolveSetUrl(azure, { mirror: "not a url" }), usage);
    assert.throws(() => resolveSetUrl(azure, { mirror: "ftp://mirror.example" }), /http or https/);
    assert.throws(() => resolveSetUrl(azure, { overrides: { azure: "file:///etc/passwd" } }), /http or https/);
    assert.throws(
        () => resolveSetUrl(azure, { mirror: "https://user:SECRET@mirror.example" }),
        (err) => usage(err) && /user name or password/.test(err.message) && !err.message.includes("SECRET"),
    );
});

test("parseUrlOverrides maps set ids to URLs and never echoes a value in an error", () => {
    assert.deepEqual(parseUrlOverrides([]), {});
    assert.deepEqual(parseUrlOverrides(["azure=https://a.example/x.zip", "m365=http://b.example/m.zip"]), {
        azure: "https://a.example/x.zip",
        m365: "http://b.example/m.zip",
    });
    const badEntries = [
        "azure",
        "=https://a.example",
        "bogus=https://a.example/x.zip?sig=SECRET",
        "azure=ftp://a.example/x.zip?sig=SECRET",
        "azure=https://user:SECRET@a.example/x.zip",
        "azure=not a url",
    ];
    for (const bad of badEntries) {
        assert.throws(() => parseUrlOverrides([bad]), (err) => usage(err) && !err.message.includes("SECRET"), bad);
    }
});

test("displayUrl hides credentials, queries and fragments", () => {
    assert.equal(displayUrl(`https://${["user", "SECRET"].join(":")}@mirror.example/a/b.zip?sv=1&${SIG}=SECRET#frag`), "https://mirror.example/a/b.zip?…");
    assert.equal(displayUrl("https://mirror.example/a/b.zip"), "https://mirror.example/a/b.zip");
    assert.equal(displayUrl("nonsense"), "(invalid URL)");
});

test("countSvgs counts .svg files recursively and tolerates a missing folder", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-svgs-"));
    mkdirSync(path.join(dir, "a", "b"), { recursive: true });
    writeFileSync(path.join(dir, "one.svg"), "12345");
    writeFileSync(path.join(dir, "a", "b", "TWO.SVG"), "123");
    writeFileSync(path.join(dir, "a", "note.txt"), "ignored");
    assert.deepEqual(countSvgs(dir), { files: 2, bytes: 8 });
    assert.deepEqual(countSvgs(path.join(dir, "missing")), { files: 0, bytes: 0 });
});
