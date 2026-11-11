import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkDocs, commandsIn, helpFlags, markdownFilesUnder } from "../helpers/docs-commands.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const scriptsDir = path.join(root, "skills", "azure-dr-assessment", "scripts");
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-docs-"));

test("commandsIn finds commands, their flags and their line numbers, and joins continuation lines", () => {
    const markdown = [
        "Run it:",
        "",
        "```bash",
        "node skills/azure-dr-assessment/scripts/preflight.mjs --live --offline",
        "node skills/azure-dr-assessment/scripts/fetch-icons.mjs \\",
        "  --sets azure --force",
        "```",
        "",
        "Inline: `node skills/azure-dr-assessment/scripts/preflight.mjs --strict` and prose about --not-a-command-flag.",
    ].join("\n");
    assert.deepEqual(commandsIn(markdown), [
        { script: "preflight", flags: ["--live", "--offline"], line: 4 },
        { script: "fetch-icons", flags: ["--sets", "--force"], line: 5 },
        { script: "preflight", flags: ["--strict"], line: 9 },
    ]);
    assert.deepEqual(commandsIn("no commands here, only node scripts/other.mjs --flag"), []);
});

test("helpFlags reads the flags a script lists, and returns null for a script that does not exist", () => {
    const flags = helpFlags(scriptsDir, "preflight");
    for (const flag of ["--live", "--offline", "--strict", "--icon-root", "--help"]) assert.ok(flags.has(flag), flag);
    assert.equal(flags.has("--bogus"), false);
    assert.equal(helpFlags(scriptsDir, "no-such-script"), null);
});

test("checkDocs reports an unknown script and an unknown flag with their file and line", () => {
    const dir = tmp();
    const doc = path.join(dir, "guide.md");
    writeFileSync(
        doc,
        [
            "node skills/azure-dr-assessment/scripts/preflight.mjs --live",
            "node skills/azure-dr-assessment/scripts/preflight.mjs --bogus",
            "node skills/azure-dr-assessment/scripts/no-such-script.mjs --live",
            "",
        ].join("\n"),
    );
    assert.deepEqual(checkDocs([doc], scriptsDir), [
        `${doc}:2: preflight.mjs has no flag --bogus`,
        `${doc}:3: no-such-script.mjs does not exist`,
    ]);
    assert.deepEqual(checkDocs([], scriptsDir), []);
});

test("markdownFilesUnder keeps existing markdown files, searches folders and skips everything else", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "refs", "stages"), { recursive: true });
    writeFileSync(path.join(dir, "README.md"), "x");
    writeFileSync(path.join(dir, "refs", "a.md"), "x");
    writeFileSync(path.join(dir, "refs", "stages", "b.md"), "x");
    writeFileSync(path.join(dir, "refs", "notes.txt"), "x");
    const found = markdownFilesUnder([path.join(dir, "README.md"), path.join(dir, "refs"), path.join(dir, "missing.md")]);
    assert.deepEqual(found.map((file) => path.relative(dir, file)).sort(), ["README.md", path.join("refs", "a.md"), path.join("refs", "stages", "b.md")]);
});

test("the repository's own documentation only mentions real scripts and real flags", () => {
    const files = markdownFilesUnder([
        path.join(root, "README.md"),
        path.join(root, "RELEASING.md"),
        path.join(root, "skills", "azure-dr-assessment", "SKILL.md"),
        path.join(root, "skills", "azure-dr-assessment", "references"),
        path.join(root, "skills", "azure-dr-assessment", "patterns", "README.md"),
        path.join(root, "skills", "azure-dr-assessment", "playbooks", "README.md"),
        path.join(root, "tests", "scenarios.md"),
    ]);
    assert.deepEqual(checkDocs(files, scriptsDir), []);
});
