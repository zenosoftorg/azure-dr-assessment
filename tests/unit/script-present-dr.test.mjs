import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { GOLDEN_DR_DIAGRAM, drStoryData, drStoryWorkspace } from "../helpers/dr-story-fixture.mjs";

const repo = path.resolve(import.meta.dirname, "..", "..");
const present = path.join(repo, "skills", "azure-dr-assessment", "scripts", "present.mjs");
const STORY = path.join("presentations", "checkout-proposed-dr.story.mjs");
const run = (workspace) => runScript(present, ["--story", STORY, "--icon-root", makeIconRoot()], { cwd: workspace.cwd });

test("builds presentation #2 from the proposed-dr diagram, with the ten steps, the two establishing scenes and the exceptions", async () => {
    const w = drStoryWorkspace();
    const r = await run(w);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.out, w.html);
    assert.deepEqual([r.json.icons, r.json.scenes, r.json.missingIcons], [5, 12, []]);
    const html = readFileSync(w.html, "utf8");
    assert.match(html, /<h1>checkout · disaster recovery<\/h1>/);
    for (const text of ["Healthy state", "Establishing DR", "Data replication", "Failing over, step by step", "Documented exceptions", "on-prem record change at failover", "DR-DNS-001 v1"]) {
        assert.ok(html.includes(text), text);
    }
});

test("without the Documented exceptions group the presentation has eleven scenes", async () => {
    const diagram = JSON.parse(readFileSync(GOLDEN_DR_DIAGRAM, "utf8"));
    diagram.groups = diagram.groups.filter((g) => g.id !== "g_documented_exceptions");
    diagram.nodes = diagram.nodes.filter((n) => n.group !== "g_documented_exceptions");
    const w = drStoryWorkspace();
    writeFileSync(w.diagram, `${JSON.stringify(diagram, null, 2)}\n`);
    const r = await run(w);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.scenes, 11);
});

test("labels that are not in the diagram are all listed, with exit 4 and unresolved-labels", async () => {
    const data = drStoryData();
    data.steps[1].groups = ["Nope"];
    data.steps[4].nodes = ["web-dr", "ghost"];
    const w = drStoryWorkspace({ data });
    const r = await run(w);
    assert.equal(r.code, 4);
    assert.equal(r.json.reason, "unresolved-labels");
    assert.deepEqual(r.json.unresolved, ['group "Nope"', 'node "ghost"']);
    assert.equal(existsSync(w.html), false);
});

test("a data file that leaves out a step exits 2 and names the step", async () => {
    const data = drStoryData();
    data.steps = data.steps.filter((s) => s.step !== "failback");
    const w = drStoryWorkspace({ data });
    const r = await run(w);
    assert.equal(r.code, 2);
    assert.match(r.json.error, /steps is missing: failback/);
    assert.equal(existsSync(w.html), false);
});

// GC-07: the story text is written by the model and ends up in a customer-facing file, so present screens it before the
// build. The secret-like values are built at run time from parts, so that no file or tool output holds one.
const KEY_PART = ["Account", "Key="].join("");
const KEY_LIKE = KEY_PART + "a".repeat(30);
const NEVER_PRINTED = [KEY_LIKE, KEY_PART, "a".repeat(30)];
const printed = (r) => NEVER_PRINTED.filter((part) => r.stdout.includes(part) || r.stderr.includes(part)).length;
const secretLine = (at) => `checkout-proposed-dr.story-data.json: ${at} looks like a secret (key, token, password or connection string) and must not appear in a presentation`;

test("narration that looks like a secret is refused with exit 2 and its path, nothing is built and the value is never printed", async () => {
    const data = drStoryData();
    data.steps[1].md = `The primary region is lost. The replica is reached with ${KEY_LIKE}`;
    const w = drStoryWorkspace({ data });
    const r = await run(w);
    assert.equal(r.code, 2);
    assert.equal(r.json.ok, false);
    assert.match(r.json.error, /story data holds text that looks like a secret/);
    assert.deepEqual(r.json.details, [secretLine("steps[1].md")]);
    assert.equal(existsSync(w.html), false);
    assert.equal(printed(r), 0);
});

test("every secret-like string of the story data is listed with its path, at any depth and in document order", async () => {
    const data = drStoryData();
    data.cover.blurb = `How the workload fails over. ${KEY_LIKE}`;
    data.steps[1].md = `The primary region is lost. ${KEY_LIKE}`;
    data.steps[4].edges[0][1] = KEY_LIKE;
    data[KEY_LIKE] = KEY_LIKE;
    const w = drStoryWorkspace({ data });
    const r = await run(w);
    assert.equal(r.code, 2);
    assert.deepEqual(r.json.details, [secretLine("cover.blurb"), secretLine("steps[1].md"), secretLine("steps[4].edges[0][1]"), secretLine("[?]")]);
    assert.equal(existsSync(w.html), false);
    assert.equal(printed(r), 0);
});

test("narration that talks about keys, tokens and passwords in words is not refused", async () => {
    const data = drStoryData();
    data.steps[4].md = "Read the storage account key and the access token from Key Vault, then reset the admin password. No connection string is repeated here.";
    const w = drStoryWorkspace({ data });
    const r = await run(w);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(readFileSync(w.html, "utf8").includes("storage account key"));
});
