import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sampleDiagram } from "../helpers/diagram-fixture.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const builder = path.join(root, "skills", "architecture-presentation", "scripts", "build-presentation.mjs");
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-pres-"));

async function workspace(mutate = (d) => d) {
    const dir = tmp();
    const diagram = path.join(dir, "d.arch.json");
    writeFileSync(diagram, JSON.stringify(mutate(await sampleDiagram())));
    return { dir, diagram, out: path.join(dir, "out.html") };
}

function story(dir, name, source) {
    const file = path.join(dir, `${name}.story.mjs`);
    writeFileSync(file, source);
    return file;
}

const GOOD_STORY = `
export const cover = { kicker: "Story", title: "Checkout", blurb: "Blurb" };
export function buildStory(diagram, h) {
    return [
        { chapter: "Overture", title: "Everything", all: true, md: "Wide.\\n\\n| A | B |\\n|---|---|\\n| 1 | 2 |\\n\\n> out loud" },
        { chapter: "Compute", title: "One node", nodes: [h.node("web-prod")], edges: [h.edge("Front Door", "web-prod")], md: "Focused." },
    ];
}
`;

const BAD_STORY = `
export function buildStory(diagram, h) {
    return [
        { chapter: "A", title: "t1", nodes: [h.node("nope-1")], md: "x" },
        { chapter: "A", title: "t2", groups: [h.group("Missing group")], edges: [h.edge("Front Door", "ghost")], md: "y" },
    ];
}
`;

const DOLLAR_STORY = `
export function buildStory() {
    return [{ chapter: "A", title: "t", all: true, md: "Price: $$5 and $& and $' end." }];
}
`;

const LEGACY_STORY = (label) => `
export function buildStory(diagram) {
    const node = (l) => {
        const n = diagram.nodes.find((x) => x.label === l);
        if (!n) throw new Error('story: no node "' + l + '"');
        return n.id;
    };
    return [{ chapter: "A", title: "t", nodes: [node(${JSON.stringify(label)})], md: "ok" }];
}
`;

const SCENES_BAD = `
export function buildStory() {
    return [{ chapter: "A", title: "t", nodes: ["n_missing"], md: "x" }];
}
`;

test("a build inlines the icons and prints one JSON summary line", async () => {
    const w = await workspace();
    const r = await runScript(builder, [w.diagram, story(w.dir, "good", GOOD_STORY), w.out, "--icon-root", makeIconRoot(), "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.icons, 4);
    assert.equal(r.json.scenes, 2);
    assert.deepEqual(r.json.missingIcons, []);
    const html = readFileSync(w.out, "utf8");
    assert.ok(html.split("data:image/svg+xml;base64,").length - 1 >= 4);
    assert.match(html, /<h1>Checkout<\/h1>/);
});

test("a build that cannot read any icon refuses with zero-icons and writes nothing", async () => {
    const w = await workspace();
    const r = await runScript(builder, [w.diagram, story(w.dir, "good", GOOD_STORY), w.out, "--icon-root", makeIconRoot({ withIcons: false }), "--json"]);
    assert.equal(r.code, 4);
    assert.equal(r.json.reason, "zero-icons");
    assert.equal(r.json.missingIcons.length, 4);
    assert.equal(existsSync(w.out), false);
});

test("a missing icon only warns while at least one icon is read", async () => {
    const w = await workspace((d) => {
        d.nodes.push({ id: "n_x", iconId: "azure:does-not-exist", variant: 0, label: "ghost", sublabel: "", x: 0, y: 0, group: null, annotation: "" });
        return d;
    });
    const r = await runScript(builder, [w.diagram, story(w.dir, "good", GOOD_STORY), w.out, "--icon-root", makeIconRoot(), "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.icons, 4);
    assert.deepEqual(r.json.missingIcons, ["azure:does-not-exist"]);
});

test("ARCH_CANVAS_ICON_ROOT is honored when --icon-root is absent", async () => {
    const w = await workspace();
    const r = await runScript(builder, [w.diagram, story(w.dir, "good", GOOD_STORY), w.out, "--json"], { env: { ARCH_CANVAS_ICON_ROOT: makeIconRoot() } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.icons, 4);
});

test("unresolved story labels are all listed and the build refuses", async () => {
    const w = await workspace();
    const r = await runScript(builder, [w.diagram, story(w.dir, "bad", BAD_STORY), w.out, "--icon-root", makeIconRoot(), "--json"]);
    assert.equal(r.code, 4);
    assert.equal(r.json.reason, "unresolved-labels");
    assert.deepEqual(r.json.unresolved, ['node "nope-1"', 'group "Missing group"', 'edge "Front Door" -> "ghost"']);
    assert.equal(existsSync(w.out), false);
});

test("story text with $ replacement patterns survives literally", async () => {
    const w = await workspace();
    const r = await runScript(builder, [w.diagram, story(w.dir, "dollar", DOLLAR_STORY), w.out, "--icon-root", makeIconRoot(), "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(readFileSync(w.out, "utf8").includes("Price: $$5 and $& and $' end."));
});

test("a story with its own helpers (the vendored SKILL.md format) still builds", async () => {
    const w = await workspace();
    const r = await runScript(builder, [w.diagram, story(w.dir, "legacy", LEGACY_STORY("web-prod")), w.out, "--icon-root", makeIconRoot(), "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.scenes, 1);
});

test("a throw inside a story with its own helpers is reported as unresolved labels", async () => {
    const w = await workspace();
    const r = await runScript(builder, [w.diagram, story(w.dir, "legacy-bad", LEGACY_STORY("ghost")), w.out, "--icon-root", makeIconRoot(), "--json"]);
    assert.equal(r.code, 4);
    assert.match(r.json.unresolved[0], /story module threw: story: no node "ghost"/);
});

test("scenes that name ids missing from the diagram are rejected with exit 2", async () => {
    const w = await workspace();
    const r = await runScript(builder, [w.diagram, story(w.dir, "scenes", SCENES_BAD), w.out, "--icon-root", makeIconRoot(), "--json"]);
    assert.equal(r.code, 2);
    assert.deepEqual(r.json.details, ['scene 1: nodes id "n_missing" is not in the diagram']);
});

test("missing arguments exit 1 and an unreadable diagram exits 2", async () => {
    const usage = await runScript(builder, ["only-one"]);
    assert.equal(usage.code, 1);
    assert.match(usage.stderr, /usage:/);
    const usageJson = await runScript(builder, ["only-one", "--json"]);
    assert.deepEqual(usageJson.json, { ok: false, code: 1, error: "usage" });

    const w = await workspace();
    const missing = await runScript(builder, [path.join(w.dir, "nope.arch.json"), story(w.dir, "good", GOOD_STORY), w.out, "--icon-root", makeIconRoot(), "--json"]);
    assert.equal(missing.code, 2);
    assert.match(missing.json.error, /cannot read inputs/);
});

test("without the canvas library the builder exits 3", async () => {
    const w = await workspace();
    const tree = tmp();
    const scripts = path.join(tree, "skills", "architecture-presentation", "scripts");
    mkdirSync(scripts, { recursive: true });
    cpSync(builder, path.join(scripts, "build-presentation.mjs"));
    const r = await runScript(
        path.join(scripts, "build-presentation.mjs"),
        [w.diagram, story(w.dir, "good", GOOD_STORY), w.out, "--json"],
        { env: { COPILOT_HOME: path.join(tree, "home") } },
    );
    assert.equal(r.code, 3);
    assert.match(r.json.error, /architecture-canvas library not found/);
});

test("the vendored SKILL.md documents the on-disk icon flow", () => {
    const text = readFileSync(path.join(root, "skills", "architecture-presentation", "SKILL.md"), "utf8");
    assert.match(text, /--icon-root/);
    assert.match(text, /zero-icons/);
    assert.match(text, /h\.node\(label\)/);
    assert.doesNotMatch(text, /canvas port/);
});

test("NOTICE.md records the vendored presentation skill", () => {
    assert.match(readFileSync(path.join(root, "NOTICE.md"), "utf8"), /## Vendored: architecture-presentation skill/);
});
