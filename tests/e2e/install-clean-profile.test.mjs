import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const readJson = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const plugin = readJson(".claude-plugin/plugin.json");
const marketplace = readJson(".claude-plugin/marketplace.json");
const LEARN = { type: "http", url: "https://learn.microsoft.com/api/mcp" };

/** Whether the Copilot CLI runs, asked with a private HOME and COPILOT_HOME like every other call of it here. */
function cliIsInstalled() {
    const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-probe-")));
    try {
        return spawnSync("copilot", ["--version"], { env: { ...process.env, COPILOT_HOME: scratch, HOME: scratch }, encoding: "utf8", timeout: 30_000 }).status === 0;
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

const hasCli = cliIsInstalled();
const skip = !hasCli && "the Copilot CLI is not installed, so the install check is NOT RUN";

/** A throwaway Copilot home and a private HOME, so nothing of the real profile is read or changed. */
function profile(t) {
    const home = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-profile-")));
    const userHome = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-home-")));
    t.after(() => {
        rmSync(home, { recursive: true, force: true });
        rmSync(userHome, { recursive: true, force: true });
    });
    const copilot = (...args) => {
        const result = spawnSync("copilot", args, { env: { ...process.env, COPILOT_HOME: home, HOME: userHome }, encoding: "utf8", timeout: 120_000 });
        assert.equal(result.status, 0, `copilot ${args.join(" ")}: ${result.stdout}${result.stderr}`);
        return result.stdout;
    };
    copilot.home = home;
    return copilot;
}

test("a clean Copilot profile installs the plugin from this repository's marketplace: both skills and the Learn server", { skip }, (t) => {
    const copilot = profile(t);
    assert.match(copilot("plugin", "list"), /No plugins installed/, "the profile starts clean");

    copilot("plugin", "marketplace", "add", root);
    copilot("plugin", "install", `${plugin.name}@${marketplace.name}`);
    assert.ok(copilot("plugin", "list").includes(`${plugin.name}@${marketplace.name}`));

    const skills = JSON.parse(copilot("skill", "list", "--json"));
    for (const name of ["azure-dr-assessment", "architecture-presentation"]) {
        const found = skills.filter((skill) => skill.name === name);
        assert.deepEqual(found.map((skill) => skill.source), ["plugin"], `${name} is listed once, from the plugin`);
        assert.ok(found[0].path.endsWith(path.join("skills", name)), `${name} is the folder below skills/`);
    }

    const learn = JSON.parse(copilot("mcp", "list", "--json")).mcpServers["microsoft-learn"];
    assert.deepEqual([learn.type, learn.url, learn.source, learn.sourcePlugin], [LEARN.type, LEARN.url, "plugin", plugin.name]);
});

test("a second plugin that declares microsoft-learn, as microsoftdocs/mcp does, leaves one server of that name", { skip }, (t) => {
    const copilot = profile(t);
    const other = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-other-plugin-")));
    t.after(() => rmSync(other, { recursive: true, force: true }));
    mkdirSync(path.join(other, ".claude-plugin"));
    const description = "A stand-in for the microsoftdocs/mcp plugin";
    writeFileSync(path.join(other, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "other-docs-marketplace", owner: { name: "test" }, plugins: [{ name: "other-docs", source: "./", description }] }));
    writeFileSync(path.join(other, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "other-docs", description, version: "0.0.1" }));
    writeFileSync(path.join(other, ".mcp.json"), JSON.stringify({ mcpServers: { "microsoft-learn": LEARN } }));

    copilot("plugin", "marketplace", "add", other);
    copilot("plugin", "install", "other-docs@other-docs-marketplace");
    copilot("plugin", "marketplace", "add", root);
    copilot("plugin", "install", `${plugin.name}@${marketplace.name}`);

    const servers = JSON.parse(copilot("mcp", "list", "--json")).mcpServers;
    assert.deepEqual(Object.keys(servers).filter((name) => name === "microsoft-learn"), ["microsoft-learn"]);
    assert.equal(servers["microsoft-learn"].url, LEARN.url);
    assert.equal(servers["microsoft-learn"].type, LEARN.type);
});

test("a personal skill of the same name shadows the plugin's, and the scripts reach the vendored builder either way", { skip }, (t) => {
    const copilot = profile(t);
    const personal = path.join(copilot.home, "skills", "architecture-presentation");
    mkdirSync(personal, { recursive: true });
    writeFileSync(path.join(personal, "SKILL.md"), "---\nname: architecture-presentation\ndescription: A stand-in for a personal skill of the same name\n---\n\n# Stand-in\n");

    copilot("plugin", "marketplace", "add", root);
    copilot("plugin", "install", `${plugin.name}@${marketplace.name}`);

    const skills = JSON.parse(copilot("skill", "list", "--json"));
    const presentation = skills.filter((skill) => skill.name === "architecture-presentation");
    assert.deepEqual(presentation.map((skill) => skill.source), ["personal-copilot"], "the host lists the personal skill, not the plugin's");
    const assessment = skills.find((skill) => skill.name === "azure-dr-assessment");
    assert.equal(assessment.source, "plugin");
    assert.ok(existsSync(path.join(assessment.path, "..", "architecture-presentation", "scripts", "build-presentation.mjs")), "the scripts reach the vendored builder by path");
});
