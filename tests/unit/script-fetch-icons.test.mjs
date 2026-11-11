import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCanvasModules } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { writeZip } from "../helpers/zip-write.mjs";
import { SIG } from "../helpers/secret-shapes.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(root, "skills", "azure-dr-assessment", "scripts", "fetch-icons.mjs");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect width="18" height="18"/></svg>\n';
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-fetch-"));
const run = (args, env = {}) => runScript(script, args, { env: { ARCH_CANVAS_ICON_ROOT: undefined, DR_ICON_MIRROR: undefined, ...env } });

const AZURE_ZIP = writeZip([
    { name: "Azure_Public_Service_Icons/Azure_Icons_FAQ.pdf", data: "%PDF" },
    { name: "Azure_Public_Service_Icons/Icons/compute/10021-icon-service-Virtual-Machine.svg", data: SVG },
    { name: "Azure_Public_Service_Icons/Icons/general/10782-icon-service-All-Resources.svg", data: SVG },
    { name: "__MACOSX/Azure_Public_Service_Icons/Icons/compute/._10021-icon-service-Virtual-Machine.svg", data: "junk" },
]);

/** A mirror on 127.0.0.1. A route is a Buffer (200), or a number (that status). Anything else is 404. */
async function serve(routes) {
    const requests = [];
    const server = createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
        requests.push(`${req.method} ${pathname}`);
        const route = routes[pathname];
        if (route === undefined) res.writeHead(404).end("not found");
        else if (typeof route === "number") res.writeHead(route).end("error");
        else res.writeHead(200, { "content-type": "application/zip" }).end(route);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
        requests,
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => {
            server.closeAllConnections();
            return new Promise((resolve) => server.close(resolve));
        },
    };
}

async function withServer(routes, body) {
    const server = await serve(routes);
    try {
        return await body(server);
    } finally {
        await server.close();
    }
}

test("downloads the Azure set from a mirror, keeps only SVG files and writes the manifest", async () => {
    await withServer({ "/Azure_Public_Service_Icons_V24.zip": AZURE_ZIP }, async (server) => {
        const iconRoot = path.join(tmp(), "icons");
        const r = await run(["--root", iconRoot, "--mirror", server.base]);
        assert.equal(r.code, 0, r.stderr);
        assert.equal(r.stdout.trim().split("\n").length, 1);
        assert.equal(r.json.ok, true);
        assert.equal(r.json.root, iconRoot);
        assert.equal(r.json.dryRun, false);
        assert.equal(r.json.iconFiles, 2);
        assert.deepEqual(r.json.warnings, []);
        assert.match(r.json.hint, /^set ARCH_CANVAS_ICON_ROOT=/);
        const [azure] = r.json.sets;
        assert.deepEqual({ id: azure.id, status: azure.status, files: azure.files }, { id: "azure", status: "fetched", files: 2 });
        assert.equal(azure.dir, path.join(iconRoot, "Azure_Public_Service_Icons_V24"));
        assert.equal(azure.url, `${server.base}/Azure_Public_Service_Icons_V24.zip`);
        assert.deepEqual(readdirSync(iconRoot).sort(), [".fetch-manifest.json", "Azure_Public_Service_Icons_V24"]);
        const manifest = JSON.parse(readFileSync(path.join(iconRoot, ".fetch-manifest.json"), "utf8"));
        assert.equal(manifest.schemaVersion, 1);
        assert.match(manifest.sets.azure.sha256, /^[0-9a-f]{64}$/);
        assert.equal(manifest.sets.azure.files, 2);
        assert.equal(manifest.sets.azure.url, azure.url);
    });
});

test("the fetched layout is what the canvas catalog indexes", async () => {
    await withServer({ "/Azure_Public_Service_Icons_V24.zip": AZURE_ZIP }, async (server) => {
        const iconRoot = path.join(tmp(), "icons");
        const r = await run(["--root", iconRoot, "--mirror", server.base]);
        assert.equal(r.code, 0, r.stderr);
        const canvas = await loadCanvasModules();
        const catalog = await canvas.icons.buildCatalog(iconRoot);
        assert.deepEqual(catalog.icons.map((icon) => icon.id).sort(), ["azure:all-resources", "azure:virtual-machine"]);
    });
});

test("a second run finds the set present and makes no request; --force downloads again", async () => {
    await withServer({ "/Azure_Public_Service_Icons_V24.zip": AZURE_ZIP }, async (server) => {
        const args = ["--root", path.join(tmp(), "icons"), "--mirror", server.base];
        assert.equal((await run(args)).json.sets[0].status, "fetched");
        const again = await run(args);
        assert.equal(again.code, 0);
        assert.equal(again.json.sets[0].status, "present");
        assert.equal(again.json.sets[0].files, 2);
        assert.equal(server.requests.length, 1);
        const forced = await run([...args, "--force"]);
        assert.equal(forced.json.sets[0].status, "fetched");
        assert.equal(server.requests.length, 2);
    });
});

test("a failed refresh keeps the icons that are already there", async () => {
    const iconRoot = path.join(tmp(), "icons");
    await withServer({ "/Azure_Public_Service_Icons_V24.zip": AZURE_ZIP }, async (good) => {
        assert.equal((await run(["--root", iconRoot, "--mirror", good.base])).code, 0);
    });
    await withServer({ "/Azure_Public_Service_Icons_V24.zip": Buffer.from("not a zip archive") }, async (bad) => {
        const r = await run(["--root", iconRoot, "--mirror", bad.base, "--force"]);
        assert.equal(r.code, 2);
        assert.equal(r.json.sets[0].status, "failed");
        assert.equal(r.json.sets[0].files, 2);
    });
    assert.deepEqual(readdirSync(path.join(iconRoot, "Azure_Public_Service_Icons_V24", "Azure_Public_Service_Icons", "Icons")).sort(), ["compute", "general"]);
    assert.equal(existsSync(path.join(iconRoot, "Azure_Public_Service_Icons_V24.partial")), false);
});

test("--dry-run reports the plan and changes nothing", async () => {
    await withServer({ "/Azure_Public_Service_Icons_V24.zip": AZURE_ZIP }, async (server) => {
        const iconRoot = path.join(tmp(), "icons");
        const r = await run(["--root", iconRoot, "--mirror", server.base, "--dry-run"]);
        assert.equal(r.code, 0, r.stderr);
        assert.equal(r.json.dryRun, true);
        assert.equal(r.json.sets[0].status, "skipped");
        assert.match(r.json.sets[0].note, /dry run: would download/);
        assert.deepEqual(r.json.warnings, []);
        assert.equal(existsSync(iconRoot), false);
        assert.equal(server.requests.length, 0);
    });
});

test("without --root the target is ARCH_CANVAS_ICON_ROOT, else the cache below COPILOT_HOME", async () => {
    await withServer({ "/Azure_Public_Service_Icons_V24.zip": AZURE_ZIP }, async (server) => {
        const home = tmp();
        const viaHome = await run(["--mirror", server.base], { COPILOT_HOME: home });
        const cache = path.join(home, "extensions", "architecture-canvas", "Final SVG Icons");
        assert.equal(viaHome.code, 0, viaHome.stderr);
        assert.equal(viaHome.json.root, cache);
        assert.equal(viaHome.json.hint, null);
        assert.ok(existsSync(path.join(cache, "Azure_Public_Service_Icons_V24")));

        const elsewhere = path.join(tmp(), "elsewhere");
        const viaEnv = await run(["--mirror", server.base], { COPILOT_HOME: home, ARCH_CANVAS_ICON_ROOT: elsewhere });
        assert.equal(viaEnv.json.root, elsewhere);
        assert.equal(viaEnv.json.hint, null);
        assert.ok(existsSync(path.join(elsewhere, "Azure_Public_Service_Icons_V24")));
    });
});

test("DR_ICON_MIRROR is the default mirror and --url beats the mirror", async () => {
    await withServer({ "/Azure_Public_Service_Icons_V24.zip": AZURE_ZIP, "/custom/azure.zip": AZURE_ZIP }, async (server) => {
        const viaEnv = await run(["--root", path.join(tmp(), "a")], { DR_ICON_MIRROR: server.base });
        assert.equal(viaEnv.code, 0, viaEnv.stderr);
        assert.deepEqual(server.requests, ["GET /Azure_Public_Service_Icons_V24.zip"]);

        const viaUrl = await run(["--root", path.join(tmp(), "b"), "--mirror", server.base, "--url", `azure=${server.base}/custom/azure.zip`]);
        assert.equal(viaUrl.code, 0, viaUrl.stderr);
        assert.equal(server.requests.at(-1), "GET /custom/azure.zip");
    });
});

test("mirror file names are URL-encoded, and a mirror query string is kept but never printed", async () => {
    const fabricZip = writeZip([{ name: "Icons/add_pipeline_20_non-item.svg", data: SVG }]);
    const routes = { "/icons/Fabric Icons.zip": fabricZip, "/icons/Azure_Public_Service_Icons_V24.zip": AZURE_ZIP };
    await withServer(routes, async (server) => {
        const iconRoot = path.join(tmp(), "icons");
        const r = await run(["--root", iconRoot, "--sets", "azure,fabric", "--mirror", `${server.base}/icons?${SIG}=SECRET`]);
        assert.equal(r.code, 0, r.stderr);
        assert.deepEqual(r.json.sets.map((set) => set.status), ["fetched", "fetched"]);
        assert.ok(existsSync(path.join(iconRoot, "Fabric Icons")));
        assert.equal(r.json.sets[1].url, `${server.base}/icons/Fabric%20Icons.zip?…`);
        assert.doesNotMatch(r.stdout + r.stderr, /SECRET/);
        assert.doesNotMatch(readFileSync(path.join(iconRoot, ".fetch-manifest.json"), "utf8"), /SECRET/);
    });
});

test("a corrupt, unsafe or SVG-less Azure archive exits 2 and leaves nothing behind", async () => {
    const cases = {
        corrupt: Buffer.from("this is not a zip archive"),
        unsafe: writeZip([{ name: "../escape.svg", data: SVG }]),
        empty: writeZip([{ name: "README.txt", data: "no icons here" }]),
    };
    for (const [name, body] of Object.entries(cases)) {
        await withServer({ "/Azure_Public_Service_Icons_V24.zip": body }, async (server) => {
            const base = tmp();
            const iconRoot = path.join(base, "icons");
            const r = await run(["--root", iconRoot, "--mirror", server.base]);
            assert.equal(r.code, 2, `${name}: ${r.stderr}`);
            assert.equal(r.json.ok, false, name);
            assert.equal(r.json.sets[0].status, "failed", name);
            assert.ok(r.json.sets[0].error, name);
            assert.deepEqual(readdirSync(iconRoot), [], name);
            assert.equal(existsSync(path.join(base, "escape.svg")), false, name);
        });
    }
});

test("an HTTP error or an unreachable mirror exits 3 and names the problem", async () => {
    await withServer({ "/Azure_Public_Service_Icons_V24.zip": 404 }, async (server) => {
        const r = await run(["--root", path.join(tmp(), "icons"), "--mirror", server.base]);
        assert.equal(r.code, 3, r.stderr);
        assert.match(r.json.error, /Azure icon set is missing/);
        assert.match(r.json.sets[0].error, /HTTP 404/);
    });
    const closed = await serve({});
    const deadMirror = closed.base;
    await closed.close();
    const unreachable = await run(["--root", path.join(tmp(), "icons"), "--mirror", deadMirror]);
    assert.equal(unreachable.code, 3);
    assert.match(unreachable.json.sets[0].error, /cannot reach/);
});

test("a failing optional set only warns, and an optional set cannot stand in for the Azure set", async () => {
    const power = writeZip([{ name: "Power/CopilotStudio_scalable.svg", data: SVG }]);
    await withServer({ "/Azure_Public_Service_Icons_V24.zip": AZURE_ZIP, "/Power-Platform-icons-scalable.zip": power }, async (server) => {
        const mixed = await run(["--root", path.join(tmp(), "icons"), "--sets", "azure,power,fabric", "--mirror", server.base]);
        assert.equal(mixed.code, 0, mixed.stderr);
        assert.deepEqual(mixed.json.sets.map((set) => `${set.id}:${set.status}`), ["azure:fetched", "power:fetched", "fabric:failed"]);
        assert.equal(mixed.json.warnings.length, 1);
        assert.match(mixed.json.warnings[0], /^fabric: .*HTTP 404/);

        const noAzure = await run(["--root", path.join(tmp(), "icons2"), "--sets", "power", "--mirror", server.base]);
        assert.equal(noAzure.code, 3);
        assert.match(noAzure.json.error, /Azure icon set is missing/);
        assert.equal(noAzure.json.sets[0].status, "fetched");
    });
});

test("the m365 set has no official URL: it is skipped with a note unless --url or a mirror supplies one", async () => {
    const m365 = writeZip([{ name: "Microsoft Blue/Apps_List_Detail_Blue_Dark.svg", data: SVG }]);
    await withServer({ "/Azure_Public_Service_Icons_V24.zip": AZURE_ZIP, "/m365.zip": m365 }, async (server) => {
        const iconRoot = path.join(tmp(), "icons");
        const skipped = await run(["--root", iconRoot, "--sets", "azure,m365", "--url", `azure=${server.base}/Azure_Public_Service_Icons_V24.zip`]);
        assert.equal(skipped.code, 0, skipped.stderr);
        assert.equal(skipped.json.sets[1].status, "skipped");
        assert.equal(skipped.json.sets[1].url, null);
        assert.match(skipped.json.sets[1].note, /--url m365=<url>/);
        assert.match(skipped.json.warnings[0], /^m365:/);

        const fetched = await run(["--root", iconRoot, "--sets", "m365", "--url", `m365=${server.base}/m365.zip`]);
        assert.equal(fetched.code, 0, fetched.stderr);
        assert.equal(fetched.json.sets[0].status, "fetched");
        assert.ok(existsSync(path.join(iconRoot, "2024-microsoft-365-content-icons")));
    });
});

test("bad flags exit 1 before anything is created, and --help prints the usage", async () => {
    const iconRoot = path.join(tmp(), "icons");
    const badArgs = [["--sets", "azure,bogus"], ["--sets", ""], ["--url", "azure"], ["--url", "bogus=https://a.example/x.zip"], ["--mirror", "not a url"]];
    for (const args of badArgs) {
        const r = await run(["--root", iconRoot, ...args]);
        assert.equal(r.code, 1, args.join(" "));
        assert.equal(r.json.ok, false, args.join(" "));
    }
    assert.equal(existsSync(iconRoot), false);
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    for (const flag of ["--root", "--sets", "--mirror", "--url", "--force", "--dry-run"]) assert.ok(help.stdout.includes(flag), flag);
});

test("a --root that cannot be created exits 2", async () => {
    const file = path.join(tmp(), "afile");
    writeFileSync(file, "x");
    const r = await run(["--root", path.join(file, "icons")]);
    assert.equal(r.code, 2);
    assert.match(r.json.error, /cannot create the icon root/);
});
