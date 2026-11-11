import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { OVERRIDE_LEVELS } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const headings = [...readme.matchAll(/^(#{1,3}) (.+)$/gm)].map((match) => `${match[1]} ${match[2]}`);

test("the README has the sections of spec section 13, in order", () => {
    assert.deepEqual(headings, [
        "# azure-dr-assessment", "## Install", "### The plugin (recommended)", "### From a clone", "### The canvas (optional)", "### Icons",
        "## Use", "## What you get", "## Data handling", "## Company patterns and overrides", "## This repository",
    ]);
});

test("the install steps are the ones that were checked against the Copilot CLI", () => {
    const manifest = JSON.parse(readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"));
    const marketplace = JSON.parse(readFileSync(path.join(root, ".claude-plugin", "marketplace.json"), "utf8"));
    const spec = `${manifest.name}@${marketplace.name}`;
    assert.equal(marketplace.plugins[0].name, manifest.name, "the marketplace offers the plugin of the manifest");
    assert.equal(marketplace.plugins[0].source, "./", "the plugin is the repository root");
    for (const command of [
        "copilot plugin marketplace add zenosoftorg/azure-dr-assessment", `copilot plugin install ${spec}`, "copilot plugin list", "copilot plugin marketplace update",
        `copilot plugin update ${spec}`, "copilot mcp list", "git clone https://github.com/zenosoftorg/azure-dr-assessment.git", "copilot skill add <clone>/skills",
    ]) {
        assert.ok(readme.includes(command), command);
    }
    assert.ok(readme.includes("copilot plugin install zenosoftorg/azure-dr-assessment` also works today, but the CLI calls direct installs deprecated"));
    assert.ok(readme.includes("is listed instead of the plugin's"), "the README says what a personal skill of the same name does");
    assert.ok(readme.includes("https://github.com/zenosoftorg/azure-dr-assessment/tree/main/extensions/architecture-canvas"));
    assert.ok(manifest.repository.includes("zenosoftorg/azure-dr-assessment"), "the install path names the repository of the manifest");
});

test("the README names the icon settings, the output folder, the data rules and the test commands", () => {
    for (const needle of ["fetch-icons.mjs", "preflight.mjs", "ARCH_CANVAS_ICON_ROOT", "DR_ICON_MIRROR", "DR_ICON_MAX_DOWNLOAD_MB", "COPILOT_HOME", "dr-assessment/checkout/", "evidence/.gitignore", "npm test", "npm run lint:patterns", "Node 22 or later"]) {
        assert.ok(readme.includes(needle), needle);
    }
    for (const level of OVERRIDE_LEVELS) assert.ok(readme.includes(`\`${level}\``), level);
    assert.match(readme, /The bundled patterns are examples of a company pattern pack; a company replaces or extends them in its own copy or fork\. The repository holds no customer data and no secrets/);
    assert.match(readme, /\/azure-dr-assessment on ari-export\.xlsx\. Tier 1, primary region westeurope, DR region swedencentral\./);
});

test("the README names the requirements, says that assessment.yaml is the only file to edit, and keeps live mode to macOS, Linux and WSL", () => {
    assert.match(readme, /`assessment\.yaml` is the only file you edit: every other file is generated, and a rerun overwrites it\./);
    assert.match(readme, /You need Node 22 or later and network access, for Microsoft Learn and for the first icon download\./);
    assert.match(readme, /A live read also needs the Azure CLI \(`az`\) with the `resource-graph` extension, a signed-in account with Reader access on the subscriptions, and macOS, Linux or WSL: on native Windows, give an ARI export instead\./);
});

test("the README keeps nothing of v1: no copy-to-skills fallback, no assessment-project layout, no customer patterns folder", () => {
    for (const gone of ["~/.copilot/skills", "Assessment project layout", "my-app-dr", "inputs/ari-export", "patterns/           #", "Prerequisites"]) {
        assert.equal(readme.includes(gone), false, gone);
    }
});

test("RELEASING.md and the README give the same install steps, and the install test that RELEASING.md names exists", () => {
    const releasing = readFileSync(path.join(root, "RELEASING.md"), "utf8");
    for (const step of ["copilot plugin marketplace add zenosoftorg/azure-dr-assessment", "copilot plugin install azure-dr-assessment@azure-dr-assessment-marketplace"]) {
        assert.ok(releasing.includes(step), `RELEASING.md: ${step}`);
        assert.ok(readme.includes(step), `README.md: ${step}`);
    }
    assert.ok(releasing.includes("tests/e2e/install-clean-profile.test.mjs"));
    assert.ok(existsSync(path.join(root, "tests", "e2e", "install-clean-profile.test.mjs")));
});

test("every relative link in the README resolves", () => {
    const targets = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]).filter((target) => !/^(https?:|mailto:|#)/.test(target));
    assert.ok(targets.length >= 4);
    for (const target of targets) assert.ok(existsSync(path.join(root, target.split("#")[0])), target);
});

test("the README says that the clone route does not bring the microsoft-learn server, and how to add it", () => {
    const clone = readme.split("### From a clone")[1].split("### The canvas (optional)")[0];
    assert.match(clone, /does not bring the `microsoft-learn` MCP server \(only the plugin declares it\)/);
    assert.match(clone, /the Microsoft Learn guidance falls back to Unverified unless the Learn CLI fallback works/);
    assert.match(clone, /use the plugin route above/);
    assert.match(clone, /`copilot plugin install microsoftdocs\/mcp`/);
    assert.match(clone, /copilot mcp add --transport http microsoft-learn https:\/\/learn\.microsoft\.com\/api\/mcp/);
});
