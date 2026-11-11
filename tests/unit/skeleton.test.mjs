import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("package.json pins Node 22, has no dependencies and defines npm test", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.engines.node, ">=22.0.0");
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
    assert.equal(pkg.scripts.test, "node tests/run-all.mjs");
});

test("plugin manifest names the plugin and carries the fields of the superpowers manifest", () => {
    const manifest = JSON.parse(read(".claude-plugin/plugin.json"));
    assert.equal(manifest.name, "azure-dr-assessment");
    for (const key of ["description", "version", "author", "homepage", "repository", "keywords"]) {
        assert.ok(manifest[key], `plugin.json is missing ${key}`);
    }
});

test("package.json and the plugin manifest carry the same semantic version", () => {
    const pkg = JSON.parse(read("package.json"));
    const manifest = JSON.parse(read(".claude-plugin/plugin.json"));
    assert.match(manifest.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    assert.equal(pkg.version, manifest.version, "set the same version in package.json and .claude-plugin/plugin.json");
});

test(".mcp.json declares the Microsoft Learn MCP server", () => {
    const mcp = JSON.parse(read(".mcp.json"));
    assert.deepEqual(mcp.mcpServers["microsoft-learn"], { type: "http", url: "https://learn.microsoft.com/api/mcp" });
});

test(".gitignore keeps the v1 entries and adds the v2 ones", () => {
    const lines = new Set(read(".gitignore").split("\n").map((l) => l.trim()));
    const wanted = [
        "/assessment.yaml", "/patterns/", "/inputs/", "/evidence/", "/reports/", "/architectures/",
        "*.xlsx", "*.xls", ".env", ".DS_Store",
        "/dr-assessment/", "Final SVG Icons/", "node_modules/", "/tests/.tmp/",
    ];
    for (const entry of wanted) assert.ok(lines.has(entry), `.gitignore is missing ${entry}`);
});

test("NOTICE.md carries the Microsoft icon terms", () => {
    assert.match(read("NOTICE.md"), /Microsoft permits the use of these icons in architectural diagrams/);
});
