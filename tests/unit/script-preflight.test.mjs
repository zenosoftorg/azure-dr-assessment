import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { quoteArg } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const scriptsDir = path.join(root, "skills", "azure-dr-assessment", "scripts");
const script = path.join(scriptsDir, "preflight.mjs");
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-preflight-"));
const fetchCommand = (scripts) => `node ${quoteArg(path.join(scripts, "fetch-icons.mjs"))}`;

/** A clean environment: a private COPILOT_HOME, no az, a browser that exists, and the Learn probe switched off. */
const baseEnv = () => ({
    COPILOT_HOME: tmp(),
    ARCH_CANVAS_ICON_ROOT: undefined,
    DR_AZ: undefined,
    DR_BROWSER: process.execPath,
    DR_LEARN_URL: undefined,
    DR_NO_NETWORK: "1",
});
const run = (args, env = {}, file = script) => runScript(file, args, { env: { ...baseEnv(), ...env } });
const check = (r, id) => r.json.checks.find((entry) => entry.id === id);
const online = (url) => ({ DR_NO_NETWORK: undefined, DR_LEARN_URL: url });

async function learnServer(status) {
    const requests = [];
    const server = createServer((req, res) => {
        requests.push(req.method);
        res.writeHead(status).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
        requests,
        url: `http://127.0.0.1:${server.address().port}/api/mcp`,
        close: () => {
            server.closeAllConnections();
            return new Promise((resolve) => server.close(resolve));
        },
    };
}

const FAKE_AZ = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (process.env.FAKE_AZ_LOG) appendFileSync(process.env.FAKE_AZ_LOG, args.join(" ") + "\\n");
const mode = process.env.FAKE_AZ_MODE || "ok";
if (args[0] === "version") {
    const extensions = mode === "no-extension" ? { account: "0.2.5" } : { account: "0.2.5", "resource-graph": "2.1.1" };
    console.log(JSON.stringify({ "azure-cli": "2.83.0", extensions }));
} else if (args[0] === "account" && args[1] === "show") {
    if (mode === "logged-out") {
        console.error("ERROR: Please run 'az login' to setup account.");
        process.exit(1);
    }
    console.log(JSON.stringify({ name: "Test subscription" }));
} else {
    console.error("unexpected command: " + args.join(" "));
    process.exit(2);
}
`;

function fakeAz() {
    const dir = tmp();
    const file = path.join(dir, "az");
    writeFileSync(file, FAKE_AZ);
    chmodSync(file, 0o755);
    return { file, log: path.join(dir, "calls.log") };
}

test("a healthy environment reports mode full with every check ok", async () => {
    const learn = await learnServer(405);
    try {
        const r = await run(["--icon-root", makeIconRoot()], online(learn.url));
        assert.equal(r.code, 0, r.stderr);
        assert.equal(r.stdout.trim().split("\n").length, 1);
        assert.equal(r.json.ok, true);
        assert.equal(r.json.mode, "full");
        assert.deepEqual(r.json.node, { version: process.versions.node, ok: true });
        assert.deepEqual(
            r.json.checks.map((entry) => `${entry.id}:${entry.status}`),
            ["node:ok", "canvas-library:ok", "icons:ok", "learn-network:ok", "browser:ok"],
        );
        assert.deepEqual(r.json.degradations, []);
        assert.deepEqual(r.json.nextActions, []);
        assert.match(check(r, "icons").detail, /^7 Azure icon files in /);
        assert.match(check(r, "learn-network").detail, /answered HTTP 405/);
        assert.deepEqual(learn.requests, ["HEAD"]);
    } finally {
        await learn.close();
    }
});

test("a missing icon library degrades the report and names the fetch command, without blocking", async () => {
    const empty = tmp();
    const r = await run(["--icon-root", empty]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.mode, "full");
    assert.equal(check(r, "icons").status, "missing");
    assert.match(r.json.degradations.join("\n"), /icons: presentations are refused \(zero icons\) until the icons are fetched; diagram files are still built, with their icon ids unchecked/);
    assert.deepEqual(r.json.nextActions, [`${fetchCommand(scriptsDir)} --root ${quoteArg(empty)}`]);

    const folderOnly = await run(["--icon-root", makeIconRoot({ withIcons: false })]);
    assert.equal(check(folderOnly, "icons").status, "missing");
});

test("--strict turns any check that is not ok into exit 3 and keeps the report", async () => {
    const failing = await run(["--icon-root", tmp(), "--strict"]);
    assert.equal(failing.code, 3);
    assert.equal(failing.json.ok, false);
    assert.equal(failing.json.code, 3);
    assert.equal(failing.json.mode, "full");
    assert.equal(check(failing, "icons").status, "missing");

    const learn = await learnServer(200);
    try {
        const passing = await run(["--icon-root", makeIconRoot(), "--strict"], online(learn.url));
        assert.equal(passing.code, 0, passing.stderr);
    } finally {
        await learn.close();
    }
});

test("--offline and DR_NO_NETWORK skip the Learn probe and say what degrades", async () => {
    const learn = await learnServer(200);
    try {
        const flagged = await run(["--icon-root", makeIconRoot(), "--offline"], online(learn.url));
        const variable = await run(["--icon-root", makeIconRoot()], { DR_LEARN_URL: learn.url });
        for (const r of [flagged, variable]) {
            assert.equal(r.code, 0, r.stderr);
            assert.equal(check(r, "learn-network").status, "degraded");
            assert.match(r.json.degradations.join("\n"), /learn-network: Microsoft Learn guidance is labelled Unverified/);
        }
        assert.deepEqual(learn.requests, []);
    } finally {
        await learn.close();
    }
});

test("the Learn probe treats any answer below 500 as reachable; errors and credentials in the URL are safe", async () => {
    for (const [status, expected] of [[200, "ok"], [404, "ok"], [503, "degraded"]]) {
        const learn = await learnServer(status);
        try {
            const r = await run(["--icon-root", makeIconRoot()], online(learn.url));
            assert.equal(check(r, "learn-network").status, expected, String(status));
        } finally {
            await learn.close();
        }
    }
    const closed = await learnServer(200);
    const deadUrl = closed.url;
    await closed.close();
    const down = await run(["--icon-root", makeIconRoot()], online(deadUrl));
    assert.equal(check(down, "learn-network").status, "degraded");
    assert.match(check(down, "learn-network").detail, /is not reachable: ECONNREFUSED/);

    const secret = await run(["--icon-root", makeIconRoot()], online("http://user:SECRET@127.0.0.1:9/api/mcp?key=SECRET"));
    assert.equal(check(secret, "learn-network").status, "degraded");
    assert.doesNotMatch(secret.stdout + secret.stderr, /SECRET/);
});

test("without the canvas library the mode is reasoning-only, and the icon check still works", async () => {
    const tree = tmp();
    cpSync(scriptsDir, path.join(tree, "skills", "azure-dr-assessment", "scripts"), { recursive: true });
    const copy = path.join(tree, "skills", "azure-dr-assessment", "scripts", "preflight.mjs");
    const home = path.join(tree, "home");

    const r = await run(["--icon-root", makeIconRoot()], { COPILOT_HOME: home }, copy);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.mode, "reasoning-only");
    assert.equal(check(r, "canvas-library").status, "missing");
    assert.match(check(r, "canvas-library").effect, /Markdown and Mermaid/);
    assert.match(r.json.nextActions.join("\n"), /restore extensions\/architecture-canvas/);
    assert.equal(check(r, "icons").status, "ok");

    const none = await run([], { COPILOT_HOME: home }, copy);
    assert.equal(check(none, "icons").status, "missing");
    assert.equal(check(none, "icons").detail, "no icon library found");
    assert.ok(none.json.nextActions.includes(fetchCommand(realpathSync(path.dirname(copy)))), none.json.nextActions.join("\n"));

    const cache = path.join(home, "extensions", "architecture-canvas", "Final SVG Icons", "Azure_Public_Service_Icons_V24");
    mkdirSync(cache, { recursive: true });
    writeFileSync(path.join(cache, "00001-icon-service-Test.svg"), "<svg/>");
    const cached = await run([], { COPILOT_HOME: home }, copy);
    assert.equal(check(cached, "icons").status, "ok");
});

test("--live adds the az check: no CLI, no extension and signed out are all missing", { skip: process.platform === "win32" && "the fake az needs a shebang" }, async () => {
    const fake = fakeAz();
    const live = (mode) => run(["--icon-root", makeIconRoot(), "--live"], { DR_AZ: fake.file, FAKE_AZ_MODE: mode, FAKE_AZ_LOG: fake.log });

    const ok = await live("ok");
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(check(ok, "az").status, "ok");
    assert.match(check(ok, "az").detail, /resource-graph 2\.1\.1, signed in/);
    assert.deepEqual(readFileSync(fake.log, "utf8").trim().split("\n"), ["version", "account show"]);
    assert.deepEqual(ok.json.checks.map((entry) => entry.id), ["node", "canvas-library", "icons", "learn-network", "az", "browser"]);

    const noExtension = await live("no-extension");
    assert.equal(check(noExtension, "az").status, "missing");
    assert.match(noExtension.json.nextActions.join("\n"), /az extension add --name resource-graph/);

    const signedOut = await live("logged-out");
    assert.equal(check(signedOut, "az").status, "missing");
    assert.match(signedOut.json.nextActions.join("\n"), /az login/);
    assert.equal(signedOut.json.mode, "full");

    const absent = await run(["--icon-root", makeIconRoot(), "--live"], { DR_AZ: path.join(tmp(), "no-such-az") });
    assert.equal(check(absent, "az").status, "missing");
    assert.match(check(absent, "az").detail, /was not found/);
    assert.match(check(absent, "az").effect, /ARI workbook/);
});

test("--help lists every flag and an unknown flag exits 1", async () => {
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    for (const flag of ["--live", "--offline", "--strict", "--icon-root"]) assert.ok(help.stdout.includes(flag), flag);
    assert.equal((await run(["--bogus"])).code, 1);
});
