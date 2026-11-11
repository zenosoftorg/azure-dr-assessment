import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { quoteArg } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { writeZip } from "../helpers/zip-write.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(root, "skills", "azure-dr-assessment", "scripts", "fetch-icons.mjs");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect width="18" height="18"/></svg>\n';
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-fetchlimits-"));
const run = (args, env = {}) => runScript(script, args, { env: { ARCH_CANVAS_ICON_ROOT: undefined, DR_ICON_MIRROR: undefined, DR_ICON_MAX_DOWNLOAD_MB: undefined, ...env } });

/** A mirror on 127.0.0.1 whose handler decides the whole response, whatever the path. */
async function withMirror(handler, body) {
    const requests = [];
    const server = createServer((req, res) => {
        requests.push(req.url);
        handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        return await body({ base: `http://127.0.0.1:${server.address().port}`, requests });
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
}
const serveZip = (zip) => (req, res) => res.writeHead(200, { "content-type": "application/zip" }).end(zip);
const ONE_ICON = writeZip([{ name: "Icons/a.svg", data: SVG }]);

test("a NUL byte in an entry name is an unsafe archive: exit 2, not 5, and nothing is left behind", async () => {
    await withMirror(serveZip(writeZip([{ name: "Icons/a\0b.svg", data: SVG }])), async (mirror) => {
        const iconRoot = path.join(tmp(), "icons");
        const r = await run(["--root", iconRoot, "--mirror", mirror.base]);
        assert.equal(r.code, 2, r.stderr);
        assert.match(r.json.sets[0].error, /^unsafe path in archive: "Icons\/a\\u0000b\.svg"$/);
        assert.deepEqual(readdirSync(iconRoot), []);
    });
});

test("a download whose Content-Length is over the limit is refused before the body is read (exit 3)", { timeout: 30_000 }, async () => {
    const handler = (req, res) => {
        res.writeHead(200, { "content-type": "application/zip", "content-length": String(5 * 1024 * 1024) });
        res.flushHeaders();
    };
    await withMirror(handler, async (mirror) => {
        const r = await run(["--root", path.join(tmp(), "icons"), "--mirror", mirror.base], { DR_ICON_MAX_DOWNLOAD_MB: "1" });
        assert.equal(r.code, 3, r.stderr);
        assert.match(r.json.sets[0].error, /is larger than 1 MB$/);
        assert.equal(mirror.requests.length, 1);
    });
});

test("a download that streams past the limit without a Content-Length is stopped (exit 3)", { timeout: 30_000 }, async () => {
    const handler = (req, res) => {
        res.writeHead(200, { "content-type": "application/zip" });
        const chunk = Buffer.alloc(64 * 1024, 1);
        const timer = setInterval(() => res.write(chunk), 1);
        res.on("close", () => clearInterval(timer));
    };
    await withMirror(handler, async (mirror) => {
        const r = await run(["--root", path.join(tmp(), "icons"), "--mirror", mirror.base], { DR_ICON_MAX_DOWNLOAD_MB: "1" });
        assert.equal(r.code, 3, r.stderr);
        assert.match(r.json.sets[0].error, /is larger than 1 MB$/);
    });
});

test("an unusable DR_ICON_MAX_DOWNLOAD_MB falls back to the default limit", async () => {
    await withMirror(serveZip(ONE_ICON), async (mirror) => {
        for (const value of ["abc", "0", "-5"]) {
            const r = await run(["--root", path.join(tmp(), "icons"), "--mirror", mirror.base], { DR_ICON_MAX_DOWNLOAD_MB: value });
            assert.equal(r.code, 0, `${value}: ${r.stderr}`);
        }
    });
});

test("--dry-run warns about a set that has no download URL, and not about one that has", async () => {
    const iconRoot = path.join(tmp(), "icons");
    const none = await run(["--root", iconRoot, "--sets", "m365", "--dry-run"]);
    assert.equal(none.code, 0, none.stderr);
    assert.equal(none.json.sets[0].status, "skipped");
    assert.deepEqual(none.json.warnings, ["m365: no verified download URL for m365; pass --url m365=<url> or --mirror <url>"]);
    const withUrl = await run(["--root", iconRoot, "--sets", "m365", "--url", "m365=http://127.0.0.1:9/m365.zip", "--dry-run"]);
    assert.equal(withUrl.code, 0, withUrl.stderr);
    assert.deepEqual(withUrl.json.warnings, []);
    assert.equal(existsSync(iconRoot), false);
});

test("the hint quotes an icon root that has spaces", async () => {
    await withMirror(serveZip(ONE_ICON), async (mirror) => {
        const iconRoot = path.join(tmp(), "My Icons");
        const r = await run(["--root", iconRoot, "--mirror", mirror.base]);
        assert.equal(r.code, 0, r.stderr);
        assert.equal(r.json.hint, `set ARCH_CANVAS_ICON_ROOT=${quoteArg(iconRoot)} so the scripts and the canvas read this library`);
        assert.match(r.json.hint, /ARCH_CANVAS_ICON_ROOT=["'].*My Icons["'] so /);
    });
});

test("it says so when it creates the architecture-canvas folder for the icons, and only then", async () => {
    await withMirror(serveZip(ONE_ICON), async (mirror) => {
        const home = tmp();
        const folder = path.join(home, "extensions", "architecture-canvas");
        const first = await run(["--mirror", mirror.base], { COPILOT_HOME: home });
        assert.equal(first.code, 0, first.stderr);
        assert.equal(first.json.warnings.length, 1);
        assert.ok(first.json.warnings[0].startsWith(`${folder} did not exist and was created`), first.json.warnings[0]);
        assert.match(first.json.warnings[0], /extension is not installed there/);
        assert.ok(existsSync(path.join(folder, "Final SVG Icons", "Azure_Public_Service_Icons_V24")));

        const second = await run(["--mirror", mirror.base], { COPILOT_HOME: home });
        assert.deepEqual(second.json.warnings, []);

        const installed = tmp();
        mkdirSync(path.join(installed, "extensions", "architecture-canvas"), { recursive: true });
        writeFileSync(path.join(installed, "extensions", "architecture-canvas", "extension.mjs"), "// the canvas\n");
        const third = await run(["--mirror", mirror.base], { COPILOT_HOME: installed });
        assert.deepEqual(third.json.warnings, []);

        const elsewhere = await run(["--root", path.join(tmp(), "icons"), "--mirror", mirror.base]);
        assert.deepEqual(elsewhere.json.warnings, []);
    });
});

test("without DR_ICON_MAX_DOWNLOAD_MB, and with an unusable value, the limit is 100 MB", { timeout: 30_000 }, async () => {
    const handler = (req, res) => {
        res.writeHead(200, { "content-type": "application/zip", "content-length": String(100 * 1024 * 1024 + 1) });
        res.flushHeaders();
        // a missing cap would wait for the rest of the body: drop the socket so that this fails after 1 s, not after 120 s
        const timer = setTimeout(() => res.destroy(), 1000);
        res.on("close", () => clearTimeout(timer));
    };
    await withMirror(handler, async (mirror) => {
        for (const value of [undefined, "abc", "0", "-5"]) {
            const r = await run(["--root", path.join(tmp(), "icons"), "--mirror", mirror.base], { DR_ICON_MAX_DOWNLOAD_MB: value });
            assert.equal(r.code, 3, `${value}: ${r.stderr}`);
            assert.match(r.json.sets[0].error, /is larger than 100 MB$/, String(value));
        }
    });
});

test("an HTTP error whose body is large does not keep the process waiting (exit 3)", { timeout: 30_000 }, async () => {
    const handler = (req, res) => {
        // the body never comes: only a cancelled response lets the process end
        res.writeHead(500, { "content-length": String(5 * 1024 * 1024) });
        res.flushHeaders();
    };
    await withMirror(handler, async (mirror) => {
        const r = await run(["--root", path.join(tmp(), "icons"), "--mirror", mirror.base]);
        assert.equal(r.code, 3, r.stderr);
        assert.match(r.json.sets[0].error, /answered HTTP 500$/);
    });
});
