import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(root, "skills", "azure-dr-assessment", "scripts", "canvas-link.mjs");
const tmp = () => realpathSync(mkdtempSync(path.join(tmpdir(), "dr-link-")));
const run = (args, { env = {}, cwd } = {}) =>
    runScript(script, args, { env: { ARCH_CANVAS_DIAGRAM_DIR: undefined, COPILOT_WORKSPACE_PATH: undefined, ...env }, cwd });

const SOURCES = {
    "checkout-current-state.arch.json": '{"version":1,"title":"as-is"}\n',
    "checkout-current-state.spec.json": '{"not":"a diagram"}\n',
    "checkout-proposed-dr.arch.json": '{"version":1,"title":"dr"}\n',
};
const DR = "checkout-proposed-dr.arch.json";

/** <tmp>/dr-assessment/checkout, with architectures/ holding the given files. */
function outputRoot(files = SOURCES) {
    const dir = path.join(tmp(), "dr-assessment", "checkout");
    mkdirSync(path.join(dir, "architectures"), { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, "architectures", name), text);
    return dir;
}
const statuses = (r) => r.json.linked.map((entry) => `${entry.id}:${entry.status}`);

test("copies every diagram into the canvas folder, keeps the originals and ignores other files", async () => {
    const out = outputRoot();
    const canvas = path.join(tmp(), "canvas");
    const r = await run(["--root", out, "--canvas-dir", canvas]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.canvasDir, canvas);
    assert.equal(r.json.note, null);
    assert.deepEqual(statuses(r), ["checkout-current-state:copied", "checkout-proposed-dr:copied"]);
    assert.deepEqual(r.json.warnings, []);
    assert.deepEqual(readdirSync(canvas).sort(), [".dr-assessment-link.json", "checkout-current-state.arch.json", DR]);
    assert.equal(readFileSync(path.join(canvas, DR), "utf8"), SOURCES[DR]);
    assert.ok(existsSync(path.join(out, "architectures", DR)));
    assert.equal(r.json.linked[0].from, path.join(out, "architectures", "checkout-current-state.arch.json"));
    assert.equal(r.json.linked[0].to, path.join(canvas, "checkout-current-state.arch.json"));

    const manifest = JSON.parse(readFileSync(path.join(canvas, ".dr-assessment-link.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert.match(manifest.files[DR].sha256, /^[0-9a-f]{64}$/);
});

test("the default folder is the one the canvas lists: ARCH_CANVAS_DIAGRAM_DIR, else <workspace>/architectures", async () => {
    const out = outputRoot();
    const listed = path.join(tmp(), "listed");
    const viaEnv = await run(["--root", out], { env: { ARCH_CANVAS_DIAGRAM_DIR: listed } });
    assert.equal(viaEnv.json.canvasDir, listed);
    assert.ok(existsSync(path.join(listed, "checkout-current-state.arch.json")));

    const workspace = tmp();
    const viaWorkspace = await run(["--root", out], { env: { COPILOT_WORKSPACE_PATH: workspace } });
    assert.equal(viaWorkspace.json.canvasDir, path.join(workspace, "architectures"));

    const cwd = tmp();
    const viaCwd = await run(["--root", out], { cwd });
    assert.equal(viaCwd.json.canvasDir, path.join(cwd, "architectures"));
});

test("a rerun updates untouched copies, keeps edited ones and says so, and --force overwrites", async () => {
    const out = outputRoot();
    const canvas = path.join(tmp(), "canvas");
    const args = ["--root", out, "--canvas-dir", canvas];
    assert.equal((await run(args)).code, 0);

    assert.deepEqual(statuses(await run(args)), ["checkout-current-state:unchanged", "checkout-proposed-dr:unchanged"]);

    writeFileSync(path.join(out, "architectures", DR), '{"version":1,"title":"dr v2"}\n');
    const updated = await run(args);
    assert.deepEqual(statuses(updated), ["checkout-current-state:unchanged", "checkout-proposed-dr:updated"]);
    assert.equal(readFileSync(path.join(canvas, DR), "utf8"), '{"version":1,"title":"dr v2"}\n');

    writeFileSync(path.join(canvas, DR), '{"version":1,"title":"edited in the canvas"}\n');
    writeFileSync(path.join(out, "architectures", DR), '{"version":1,"title":"dr v3"}\n');
    const kept = await run(args);
    assert.deepEqual(statuses(kept), ["checkout-current-state:unchanged", "checkout-proposed-dr:kept"]);
    assert.match(kept.json.warnings[0], /^checkout-proposed-dr\.arch\.json: the canvas copy was edited after it was linked/);
    assert.match(kept.json.warnings[0], /use --force to overwrite/);
    assert.match(readFileSync(path.join(canvas, DR), "utf8"), /edited in the canvas/);

    const forced = await run([...args, "--force"]);
    assert.deepEqual(statuses(forced), ["checkout-current-state:unchanged", "checkout-proposed-dr:updated"]);
    assert.match(readFileSync(path.join(canvas, DR), "utf8"), /dr v3/);
    assert.deepEqual((await run(args)).json.warnings, []);
});

test("a canvas folder that is the source folder needs no copy", async () => {
    const out = outputRoot();
    const source = path.join(out, "architectures");
    const r = await run(["--root", out, "--canvas-dir", source]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.linked, []);
    assert.match(r.json.note, /already lists this folder/);
    assert.equal(readdirSync(source).includes(".dr-assessment-link.json"), false);
});

test("bad flags and missing diagrams fail with exit codes 1 and 2", async () => {
    assert.equal((await run([])).code, 1);
    const empty = path.join(tmp(), "empty");
    mkdirSync(empty);
    const noFolder = await run(["--root", empty, "--canvas-dir", path.join(tmp(), "canvas")]);
    assert.equal(noFolder.code, 2);
    assert.match(noFolder.json.error, /no diagrams to link/);
    const noDiagrams = await run(["--root", outputRoot({ "notes.spec.json": "{}" }), "--canvas-dir", path.join(tmp(), "canvas")]);
    assert.equal(noDiagrams.code, 2);
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    for (const flag of ["--root", "--canvas-dir", "--force"]) assert.ok(help.stdout.includes(flag), flag);
});
