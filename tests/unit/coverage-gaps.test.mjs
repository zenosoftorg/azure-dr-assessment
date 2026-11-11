import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { skillRoot } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { storyWorkspace } from "../helpers/story-fixture.mjs";

const buildDiagram = path.join(skillRoot(), "scripts", "build-diagram.mjs");

/** A folder with an empty ledger, outside any plugin tree, for the build-diagram runs below. */
function work(t) {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-coverage-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(path.join(dir, "ledger.json"), `${JSON.stringify({ schemaVersion: 1, entries: [] })}\n`);
    return dir;
}

test("build-diagram exits 3 when the architecture-canvas library cannot be found", async (t) => {
    const dir = work(t);
    const tree = mkdtempSync(path.join(tmpdir(), "dr-nocanvas-"));
    t.after(() => rmSync(tree, { recursive: true, force: true }));
    const skill = path.join(tree, "skills", "azure-dr-assessment");
    mkdirSync(skill, { recursive: true });
    for (const folder of ["scripts", "assets"]) cpSync(path.join(skillRoot(), folder), path.join(skill, folder), { recursive: true });
    writeFileSync(path.join(dir, "checkout.spec.json"), "{}\n");
    const r = await runScript(
        path.join(skill, "scripts", "build-diagram.mjs"),
        ["--spec", path.join(dir, "checkout.spec.json"), "--ledger", path.join(dir, "ledger.json"), "--out", path.join(dir, "checkout.arch.json")],
        { env: { COPILOT_HOME: dir } },
    );
    assert.equal(r.code, 3, r.stderr);
    assert.equal(r.json.error, "architecture-canvas library not found");
});

test("build-diagram reports a spec file that does not exist as an input error that names the file", async (t) => {
    const dir = work(t);
    const r = await runScript(buildDiagram, ["--spec", path.join(dir, "absent.spec.json"), "--ledger", path.join(dir, "ledger.json"), "--out", path.join(dir, "absent.arch.json")]);
    assert.equal(r.code, 2, r.stderr);
    assert.equal(r.json.error, "cannot read the diagram spec");
    assert.ok(r.json.details[0].includes("absent.spec.json"), r.json.details[0]);
});

test("the as-is story says so when a group holds no component, and still names the group", async () => {
    const workspace = storyWorkspace({ data: { schemaVersion: 1, cover: { title: "T", blurb: "B" } } });
    const story = await import(pathToFileURL(workspace.story).href);
    const h = { node: (label) => `node:${label}`, group: (label) => `group:${label}`, edge: (from, to) => `edge:${from}>${to}` };
    const scenes = story.buildStory({ groups: [{ id: "g_spare", label: "Spare region", parent: null }], nodes: [], edges: [] }, h);
    const scene = scenes.find((candidate) => candidate.chapter === "Spare region");
    assert.equal(scene.md, "This group holds no component.");
    assert.deepEqual(scene.groups, ["g_spare"]);
    rmSync(workspace.cwd, { recursive: true, force: true });
});
