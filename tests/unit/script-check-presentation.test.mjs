import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { findBrowser } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { highlightDecision } from "../../skills/azure-dr-assessment/scripts/lib/presentation-check.mjs";
import { sampleDiagram } from "../helpers/diagram-fixture.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const checkScript = path.join(root, "skills", "azure-dr-assessment", "scripts", "check-presentation.mjs");
const builder = path.join(root, "skills", "architecture-presentation", "scripts", "build-presentation.mjs");
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-check-"));
const needsBrowser = { skip: findBrowser() === null && "no Chrome, Edge or Chromium found" };
const run = (args, env = {}) => runScript(checkScript, args, { env: { DR_BROWSER: undefined, ...env } });
const summary = (r) => r.json.checks.map((entry) => `${entry.id}:${entry.pass}`);
const profilesIn = (dir) => readdirSync(dir).filter((name) => name.startsWith("dr-browser-"));
/** A private temporary folder for one run. The browser profile is created inside it, so no other test's browser is ever counted. */
const privateTmp = () => {
    const dir = tmp();
    return { dir, env: { TMPDIR: dir, TEMP: dir, TMP: dir } };
};

const STORY = `
export const cover = { kicker: "Story", title: "Checkout", blurb: "A scratch story" };
export function buildStory(diagram, h) {
    return [
        { chapter: "Overture", title: "Everything", all: true, md: "Wide.\\n\\n| A | B |\\n|---|---|\\n| 1 | 2 |\\n\\n> said out loud" },
        { chapter: "Compute", title: "One node", nodes: [h.node("web-prod")], edges: [h.edge("Front Door", "web-prod")], md: "Focused." },
        { chapter: "Data", title: "The layer", groups: [h.group("Primary · westeurope")], md: "A group." },
    ];
}
`;

let built = null;
/** Build one presentation with the vendored builder and the fixture icons, once per test run. */
function presentation() {
    built ??= (async () => {
        const dir = tmp();
        const diagram = path.join(dir, "d.arch.json");
        const story = path.join(dir, "d.story.mjs");
        const out = path.join(dir, "d.html");
        writeFileSync(diagram, JSON.stringify(await sampleDiagram()));
        writeFileSync(story, STORY);
        const r = await runScript(builder, [diagram, story, out, "--icon-root", makeIconRoot(), "--json"]);
        assert.equal(r.code, 0, r.stderr);
        return out;
    })();
    return built;
}

test("a good presentation passes every check, in both themes", needsBrowser, async () => {
    const html = await presentation();
    const own = privateTmp();
    const plain = await run(["--html", html], own.env);
    assert.equal(plain.code, 0, plain.stdout + plain.stderr);
    assert.deepEqual(profilesIn(own.dir), [], "the browser's temporary profile is removed");
    assert.equal(plain.json.status, "passed");
    assert.equal(plain.json.scenes, 3);
    assert.equal(plain.json.theme, null);
    assert.deepEqual(summary(plain), ["cover:true", "begin:true", "camera:true", "highlight:true", "markdown:true", "flow:true", "console:true"]);
    assert.deepEqual(plain.json.consoleErrors, []);
    for (const theme of ["dark", "light"]) {
        const themed = await run(["--html", html, "--theme", theme]);
        assert.equal(themed.code, 0, themed.stdout + themed.stderr);
        assert.equal(themed.json.theme, theme);
        assert.deepEqual(summary(themed), ["cover:true", "begin:true", "theme:true", "camera:true", "highlight:true", "markdown:true", "flow:true", "console:true"]);
    }
});

test("a console error fails the console check and is reported", needsBrowser, async () => {
    const html = await presentation();
    const broken = path.join(tmp(), "broken.html");
    writeFileSync(broken, readFileSync(html, "utf8").replace("</body>", '<script>console.error("boom from the page")</script></body>'));
    const r = await run(["--html", broken]);
    assert.equal(r.code, 4);
    assert.equal(r.json.status, "failed");
    assert.equal(r.json.checks.find((entry) => entry.id === "console").pass, false);
    assert.ok(r.json.consoleErrors.some((line) => line.includes("boom from the page")));
    assert.match(r.json.details.join("\n"), /console:/);
});

test("a window resize on the cover is not an error", needsBrowser, async () => {
    const html = await presentation();
    const resized = path.join(tmp(), "resized.html");
    writeFileSync(resized, readFileSync(html, "utf8").replace("</body>", '<script>window.dispatchEvent(new Event("resize"))</script></body>'));
    const r = await run(["--html", resized]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(r.json.consoleErrors, []);
});

test("a page that is not a presentation fails cleanly instead of crashing", needsBrowser, async () => {
    const page = path.join(tmp(), "plain.html");
    writeFileSync(page, "<!doctype html><title>x</title><p>hello</p>");
    const r = await run(["--html", page]);
    assert.equal(r.code, 4);
    assert.deepEqual(summary(r), ["cover:false", "story:false", "console:true"]);
});

test("a page that hangs ends at the timeout and the browser is stopped", needsBrowser, async () => {
    const page = path.join(tmp(), "hang.html");
    writeFileSync(page, "<!doctype html><script>for (;;) {}</script>");
    const started = Date.now();
    const own = privateTmp();
    const r = await run(["--html", page, "--timeout", "3"], own.env);
    assert.equal(r.code, 4);
    const last = r.json.checks.at(-1);
    assert.equal(last.id, "browser");
    assert.equal(last.pass, false);
    assert.match(last.detail, /timed out after 3 s/);
    assert.ok(Date.now() - started < 30_000);
    assert.deepEqual(profilesIn(own.dir), [], "the hung browser was stopped and its profile removed");
});

test("a missing or unusable browser is reported as NOT RUN with exit 3", async () => {
    const html = path.join(tmp(), "any.html");
    writeFileSync(html, "<!doctype html><p>x</p>");
    const missing = await run(["--html", html], { DR_BROWSER: path.join(tmp(), "no-such-browser") });
    assert.equal(missing.code, 3);
    assert.equal(missing.json.status, "not-run");
    assert.match(missing.json.details.join("\n"), /DR_BROWSER points to a file that does not exist/);

    const notABrowser = await run(["--html", html], { DR_BROWSER: process.execPath });
    assert.equal(notABrowser.code, 3);
    assert.equal(notABrowser.json.status, "not-run");
    assert.match(notABrowser.json.details.join("\n"), /exited before it opened a debugging port/);
});

test("DR_BROWSER_FLAGS adds flags to the browser's command line", { skip: process.platform === "win32" && "the fake browser needs a shebang" }, async () => {
    const dir = tmp();
    const fake = path.join(dir, "fake-browser");
    const log = path.join(dir, "argv.json");
    writeFileSync(fake, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.FAKE_BROWSER_LOG, JSON.stringify(process.argv.slice(2)));\n');
    chmodSync(fake, 0o755);
    const html = path.join(dir, "any.html");
    writeFileSync(html, "<!doctype html><p>x</p>");
    const r = await run(["--html", html], { DR_BROWSER: fake, DR_BROWSER_FLAGS: "--no-sandbox --disable-dev-shm-usage", FAKE_BROWSER_LOG: log });
    assert.equal(r.code, 3, "the fake browser exits at once, so the check is NOT RUN");
    const argv = JSON.parse(readFileSync(log, "utf8"));
    for (const flag of ["--headless=new", "--remote-debugging-port=0", "--no-sandbox", "--disable-dev-shm-usage"]) assert.ok(argv.includes(flag), flag);
    assert.equal(argv.at(-1), "about:blank");
});

test("bad flags and an unreadable file fail before any browser starts", async () => {
    const html = path.join(tmp(), "any.html");
    writeFileSync(html, "<!doctype html><p>x</p>");
    assert.equal((await run([])).code, 1);
    assert.equal((await run(["--html", path.join(tmp(), "nope.html")])).code, 2);
    assert.equal((await run(["--html", html, "--theme", "blue"])).code, 1);
    assert.equal((await run(["--html", html, "--timeout", "0"])).code, 1);
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    for (const flag of ["--html", "--theme", "--timeout"]) assert.ok(help.stdout.includes(flag), flag);
});

test("highlightDecision requires dimming only in a scene that focuses a strict subset of the nodes", () => {
    const scene = (covered, dimNodes) => ({ covered, dimNodes });
    const exempt = highlightDecision({ totalNodes: 7, scenes: [scene(7, 0), scene(7, 0)] });
    assert.equal(exempt.pass, true, "a scene that covers every node cannot dim");
    assert.match(exempt.detail, /cover every node/);
    assert.equal(highlightDecision({ totalNodes: 7, scenes: [scene(7, 0), scene(2, 5)] }).pass, true);
    const broken = highlightDecision({ totalNodes: 7, scenes: [scene(7, 0), scene(2, 0)] });
    assert.equal(broken.pass, false, "a scene that focuses two of seven nodes and dims none is a defect");
    assert.match(broken.detail, /scene 2/);
    assert.equal(highlightDecision({ totalNodes: 7, scenes: [scene(2, 5), scene(3, 0)] }).pass, false, "every strict-subset scene must dim, not just one");
    assert.equal(highlightDecision({ totalNodes: 1, scenes: [scene(1, 0)] }).pass, true);
    assert.equal(highlightDecision({ totalNodes: 3, scenes: [] }).pass, true);
});

test("in a one-group presentation a scene that focuses one node still dims the rest and passes", needsBrowser, async () => {
    const dir = tmp();
    const diagram = await sampleDiagram();
    for (const node of diagram.nodes) node.group = "g_primary";
    writeFileSync(path.join(dir, "d.arch.json"), JSON.stringify(diagram));
    writeFileSync(path.join(dir, "d.story.mjs"), `
export const cover = { kicker: "Story", title: "One group", blurb: "Every node is in the group" };
export function buildStory(diagram, h) {
    return [
        { chapter: "Overture", title: "Everything", all: true, md: "Wide." },
        { chapter: "Region", title: "The region", groups: [h.group("Primary · westeurope")], md: "The only group." },
        { chapter: "Region", title: "The web tier", nodes: [h.node("web-prod")], md: "One node." },
    ];
}
`);
    const out = path.join(dir, "d.html");
    const built = await runScript(builder, [path.join(dir, "d.arch.json"), path.join(dir, "d.story.mjs"), out, "--icon-root", makeIconRoot(), "--json"]);
    assert.equal(built.code, 0, built.stderr);
    const r = await run(["--html", out]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.checks.find((entry) => entry.id === "highlight").pass, true);
});

test("a one-group presentation whose only focused scene is the group passes the highlight check", needsBrowser, async () => {
    const dir = tmp();
    const diagram = await sampleDiagram();
    for (const node of diagram.nodes) node.group = "g_primary";
    writeFileSync(path.join(dir, "d.arch.json"), JSON.stringify(diagram));
    writeFileSync(path.join(dir, "d.story.mjs"), `
export const cover = { kicker: "Story", title: "One group", blurb: "Every node is in the group" };
export function buildStory(diagram, h) {
    return [
        { chapter: "Overture", title: "Everything", all: true, md: "Wide." },
        { chapter: "Region", title: "The region", groups: [h.group("Primary · westeurope")], md: "The only group." },
    ];
}
`);
    const out = path.join(dir, "d.html");
    const built = await runScript(builder, [path.join(dir, "d.arch.json"), path.join(dir, "d.story.mjs"), out, "--icon-root", makeIconRoot(), "--json"]);
    assert.equal(built.code, 0, built.stderr);
    const r = await run(["--html", out]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const highlight = r.json.checks.find((entry) => entry.id === "highlight");
    assert.equal(highlight.pass, true);
    assert.match(highlight.detail, /cover every node/);
});
