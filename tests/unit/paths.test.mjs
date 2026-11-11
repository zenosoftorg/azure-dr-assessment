import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import {
    browserCandidates, canvasRoot, copilotHome, defaultPatternsDir, findBrowser, iconRootTarget,
    isInsideSkillOrPlugin, loadCanvasModules, outputRootFor, patternsDir, repoRoot, skillRoot, slugify,
} from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";

const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-paths-"));
function write(file, text = "") {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
}
function stubCanvas(root) {
    for (const rel of ["lib/store.mjs", "lib/icons.mjs", "lib/config.mjs", "web/layout.mjs", "web/edge-route.mjs"]) {
        write(path.join(root, rel), `export const marker = ${JSON.stringify(rel)};\n`);
    }
}

test("roots resolve from the library location", () => {
    assert.ok(skillRoot().endsWith(path.join("skills", "azure-dr-assessment")));
    assert.equal(path.dirname(path.dirname(skillRoot())), repoRoot());
    assert.equal(defaultPatternsDir(), path.join(skillRoot(), "patterns"));
});

test("copilotHome honors COPILOT_HOME", () => {
    assert.equal(copilotHome({ COPILOT_HOME: "/x/y" }), "/x/y");
    assert.ok(copilotHome({}).endsWith(".copilot"));
});

test("patternsDir prefers the flag, then DR_PATTERNS_DIR, then the bundled pack", () => {
    assert.deepEqual(patternsDir({}, null), { dir: defaultPatternsDir(), isDefault: true });
    assert.deepEqual(patternsDir({ DR_PATTERNS_DIR: "/tmp/pack-a" }), { dir: "/tmp/pack-a", isDefault: false });
    assert.deepEqual(patternsDir({ DR_PATTERNS_DIR: "/tmp/pack-a" }, "/tmp/pack-b"), { dir: "/tmp/pack-b", isDefault: false });
    assert.equal(patternsDir({}, defaultPatternsDir()).isDefault, true);
});

test("canvasRoot prefers the repository copy, then COPILOT_HOME, then null", () => {
    const repo = tmp();
    const home = tmp();
    assert.equal(canvasRoot({ COPILOT_HOME: home }, repo), null);
    stubCanvas(path.join(home, "extensions", "architecture-canvas"));
    assert.equal(canvasRoot({ COPILOT_HOME: home }, repo), path.join(home, "extensions", "architecture-canvas"));
    stubCanvas(path.join(repo, "extensions", "architecture-canvas"));
    assert.equal(canvasRoot({ COPILOT_HOME: home }, repo), path.join(repo, "extensions", "architecture-canvas"));
});

test("loadCanvasModules imports the five library modules and fails with ENVIRONMENT when absent", async () => {
    const root = tmp();
    stubCanvas(root);
    const modules = await loadCanvasModules(root);
    assert.equal(modules.root, root);
    assert.equal(modules.store.marker, "lib/store.mjs");
    assert.equal(modules.route.marker, "web/edge-route.mjs");
    await assert.rejects(() => loadCanvasModules(null), (e) => e instanceof CliError && e.code === EXIT.ENVIRONMENT);
});

test("iconRootTarget uses ARCH_CANVAS_ICON_ROOT or the default cache below COPILOT_HOME", () => {
    assert.equal(iconRootTarget({ ARCH_CANVAS_ICON_ROOT: "/icons" }), "/icons");
    assert.equal(
        iconRootTarget({ COPILOT_HOME: "/home/x" }),
        path.join("/home/x", "extensions", "architecture-canvas", "Final SVG Icons"),
    );
});

test("slugify lowercases, trims, caps the length and falls back", () => {
    assert.equal(slugify("Checkout App (Prod)!"), "checkout-app-prod");
    assert.equal(slugify("---"), "workload");
    assert.equal(slugify("", 40, "x"), "x");
    assert.equal(slugify("a".repeat(80)).length, 40);
    assert.equal(slugify("abc-" + "d".repeat(60), 4), "abc");
});

test("isInsideSkillOrPlugin recognizes the plugin manifest and the skill file", () => {
    const plugin = tmp();
    write(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "azure-dr-assessment" }));
    assert.equal(isInsideSkillOrPlugin(path.join(plugin, "deep", "er")), true);

    const other = tmp();
    write(path.join(other, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "something-else" }));
    assert.equal(isInsideSkillOrPlugin(path.join(other, "sub")), false);

    const skill = tmp();
    write(path.join(skill, "SKILL.md"), "---\nname: azure-dr-assessment\ndescription: x\n---\n");
    assert.equal(isInsideSkillOrPlugin(path.join(skill, "scripts")), true);

    const presentation = tmp();
    write(path.join(presentation, "SKILL.md"), "---\nname: architecture-presentation\n---\n");
    assert.equal(isInsideSkillOrPlugin(presentation), false);
});

test("outputRootFor announces dr-assessment/{app}/ and refuses folders inside the plugin", () => {
    const cwd = tmp();
    const result = outputRootFor({ cwd, app: "checkout" });
    assert.equal(result.dir, path.join(cwd, "dr-assessment", "checkout"));
    assert.equal(result.announce, "Output folder: dr-assessment/checkout/");

    const custom = outputRootFor({ cwd, app: "checkout", override: "out/dr" });
    assert.equal(custom.dir, path.join(cwd, "out", "dr"));
    assert.equal(custom.announce, "Output folder: out/dr/");

    const plugin = tmp();
    write(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "azure-dr-assessment" }));
    assert.throws(() => outputRootFor({ cwd: plugin, app: "checkout" }), (e) => e instanceof CliError && e.code === EXIT.REFUSED);
    assert.throws(() => outputRootFor({ cwd, app: "checkout", override: path.join(plugin, "out") }), (e) => e.code === EXIT.REFUSED);
});

test("findBrowser honors DR_BROWSER and otherwise scans the candidates", () => {
    const dir = tmp();
    const fake = path.join(dir, "chrome");
    write(fake);
    assert.equal(findBrowser({ DR_BROWSER: fake }, []), fake);
    assert.equal(findBrowser({}, [path.join(dir, "missing"), fake]), fake);
    assert.equal(findBrowser({ DR_BROWSER: path.join(dir, "missing") }, []), null);
    assert.equal(findBrowser({ DR_BROWSER: path.join(dir, "missing") }, [fake]), null);
    assert.ok(browserCandidates("darwin", {}).some((p) => p.includes("Google Chrome")));
    assert.ok(browserCandidates("linux", { PATH: "/usr/bin" }).includes(path.join("/usr/bin", "chromium")));
    assert.ok(browserCandidates("win32", { ProgramFiles: "C:\\Program Files" }).some((p) => p.endsWith("chrome.exe")));
});
