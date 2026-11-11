import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { goldenStoryData, storyWorkspace } from "../helpers/story-fixture.mjs";

const repo = path.resolve(import.meta.dirname, "..", "..");
const present = path.join(repo, "skills", "azure-dr-assessment", "scripts", "present.mjs");
const STORY = path.join("presentations", "checkout-current-state.story.mjs");
const run = (workspace, extra = [], opts = {}) => runScript(present, ["--story", STORY, ...extra], { cwd: workspace.cwd, ...opts });
const dataUris = (html) => html.split("data:image/svg+xml;base64,").length - 1;

test("builds presentation #1 with the diagram and the output derived from the story name", async () => {
    const w = storyWorkspace();
    const r = await run(w, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.equal(r.json.out, w.html);
    assert.deepEqual([r.json.icons, r.json.scenes, r.json.missingIcons], [6, 6, []]);
    assert.equal(r.json.bytes, statSync(w.html).size);
    const html = readFileSync(w.html, "utf8");
    assert.ok(dataUris(html) >= r.json.icons, "the icons are inlined");
    assert.match(html, /<h1>checkout · current state<\/h1>/);
    assert.ok(html.includes("What we inferred, and why"));
    assert.match(r.stderr, /inlined 6 icons/, "the builder's progress reaches stderr");
});

test("--diagram and --out override the defaults, for example to rebuild from a canvas copy", async () => {
    const w = storyWorkspace();
    const copy = path.join(w.cwd, "canvas", "copy.arch.json");
    mkdirSync(path.dirname(copy));
    cpSync(w.diagram, copy);
    const out = path.join(w.cwd, "elsewhere", "story.html");
    const r = await run(w, ["--diagram", copy, "--out", out, "--icon-root", makeIconRoot()]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.out, out);
    assert.ok(existsSync(out));
    assert.equal(existsSync(w.html), false);
});

test("an icon library without icons refuses with exit 4 and zero-icons, and writes nothing", async () => {
    const w = storyWorkspace();
    const r = await run(w, ["--icon-root", makeIconRoot({ withIcons: false })]);
    assert.equal(r.code, 4);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.reason, "zero-icons");
    assert.ok(r.json.missingIcons.length > 0);
    assert.match(r.json.error, /no icon could be read/);
    assert.equal(typeof r.json.iconRoot, "string");
    assert.equal(existsSync(w.html), false);
});

test("labels that are not in the diagram are all listed, with exit 4 and unresolved-labels", async () => {
    const data = goldenStoryData({ groups: [{ group: "Nope" }, { group: "Primary · westeurope", nodes: ["ghost"] }] });
    const w = storyWorkspace({ data });
    const r = await run(w, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 4);
    assert.equal(r.json.reason, "unresolved-labels");
    assert.deepEqual(r.json.unresolved, ['group "Nope"', 'node "ghost"']);
    assert.deepEqual(r.json.details, ['group "Nope"', 'node "ghost"']);
    assert.match(r.json.error, /labels that are not in the diagram/);
    assert.equal(existsSync(w.html), false);
});

test("a missing or invalid story data file exits 2 with the template's message", async () => {
    const missing = storyWorkspace({ data: null });
    const r = await run(missing, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 2);
    assert.match(r.json.error, /cannot read inputs: story data checkout-current-state\.story-data\.json: cannot read it/);
    const invalid = storyWorkspace({ data: { schemaVersion: 1, cover: { title: "T" } } });
    const bad = await run(invalid, ["--icon-root", makeIconRoot()]);
    assert.equal(bad.code, 2);
    assert.match(bad.json.error, /cover needs a title and a blurb/);
});

// GC-07: the story text is written by the model and ends up in a customer-facing file, so present screens it before the
// build. The secret-like values are built at run time from parts, so that no file or tool output holds one.
const KEY_PART = ["Account", "Key="].join("");
const KEY_LIKE = KEY_PART + "a".repeat(30);
const NEVER_PRINTED = [KEY_LIKE, KEY_PART, "a".repeat(30)];
const printed = (r) => NEVER_PRINTED.filter((part) => r.stdout.includes(part) || r.stderr.includes(part)).length;
const secretLine = (at) => `checkout-current-state.story-data.json: ${at} looks like a secret (key, token, password or connection string) and must not appear in a presentation`;

test("narration that looks like a secret is refused with exit 2 and its path, nothing is built and the value is never printed", async () => {
    const data = goldenStoryData();
    data.groups[1].md = `The data stores, reached with ${KEY_LIKE}`;
    const w = storyWorkspace({ data });
    const r = await run(w, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 2);
    assert.equal(r.json.ok, false);
    assert.match(r.json.error, /story data holds text that looks like a secret/);
    assert.deepEqual(r.json.details, [secretLine("groups[1].md")]);
    assert.equal(existsSync(w.html), false);
    assert.equal(printed(r), 0);
});

test("a data file that is not valid JSON is left to the template: exit 2 with its message, nothing is built", async () => {
    const w = storyWorkspace({ data: null });
    writeFileSync(w.data, "{ \"schemaVersion\": 1, \"cover\": ");
    const r = await run(w, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 2);
    assert.match(r.json.error, /cannot read inputs: story data checkout-current-state\.story-data\.json: cannot read it/);
    assert.equal(existsSync(w.html), false);
});

test("a custom story module with no data file beside it is not screened and builds as before", async () => {
    const w = storyWorkspace({ data: null });
    writeFileSync(w.story, "export function buildStory() { return [{ chapter: \"All\", title: \"Everything\", all: true, md: \"The whole architecture.\" }]; }\n");
    const r = await run(w, ["--icon-root", makeIconRoot()]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.scenes, 1);
    assert.ok(existsSync(w.html));
});

test("a missing diagram exits 2", async () => {
    const w = storyWorkspace();
    const r = await run(w, ["--diagram", path.join(w.cwd, "architectures", "nope.arch.json"), "--icon-root", makeIconRoot()]);
    assert.equal(r.code, 2);
    assert.match(r.json.error, /cannot read inputs/);
});

test("a missing --story exits 1, and a story with another name needs --diagram", async () => {
    const w = storyWorkspace();
    const none = await runScript(present, [], { cwd: w.cwd });
    assert.equal(none.code, 1);
    assert.match(none.json.error, /--story/);
    writeFileSync(path.join(w.cwd, "presentations", "odd.mjs"), "export function buildStory() { return []; }\n");
    const odd = await runScript(present, ["--story", path.join("presentations", "odd.mjs")], { cwd: w.cwd });
    assert.equal(odd.code, 1);
    assert.match(odd.json.error, /pass --diagram/);
});

test("refuses to write inside the skill or plugin directory", async () => {
    const w = storyWorkspace();
    const plugin = mkdtempSync(path.join(tmpdir(), "dr-plugin-"));
    mkdirSync(path.join(plugin, ".claude-plugin"));
    writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "azure-dr-assessment" }));
    const out = path.join(plugin, "presentations", "x.html");
    const r = await run(w, ["--out", out, "--icon-root", makeIconRoot()]);
    assert.equal(r.code, 4);
    assert.equal(existsSync(out), false);
});

/** A copy of skills/ with no canvas library anywhere, so the builder cannot find it; `builder` replaces the builder's code when given. */
function isolatedTree(builder = null) {
    const tree = mkdtempSync(path.join(tmpdir(), "dr-tree-"));
    cpSync(path.join(repo, "skills"), path.join(tree, "skills"), { recursive: true });
    if (builder) writeFileSync(path.join(tree, "skills", "architecture-presentation", "scripts", "build-presentation.mjs"), builder);
    return { script: path.join(tree, "skills", "azure-dr-assessment", "scripts", "present.mjs"), home: path.join(tree, "home") };
}

test("a builder that cannot find the canvas library gives exit 3", async () => {
    const w = storyWorkspace();
    const tree = isolatedTree();
    const r = await runScript(tree.script, ["--story", STORY], { cwd: w.cwd, env: { COPILOT_HOME: tree.home } });
    assert.equal(r.code, 3);
    assert.match(r.json.error, /architecture-canvas library not found/);
});

test("a builder that dies without a report gives exit 5 with its last output", async () => {
    const w = storyWorkspace();
    const tree = isolatedTree("console.error('builder exploded'); process.exit(7);\n");
    const r = await runScript(tree.script, ["--story", STORY], { cwd: w.cwd });
    assert.equal(r.code, 5);
    assert.equal(r.json.error, "the presentation builder failed without a report");
    assert.deepEqual(r.json.details, ["exit code 7", "builder exploded"]);
});
