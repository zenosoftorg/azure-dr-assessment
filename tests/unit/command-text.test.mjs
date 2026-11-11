import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { outputRootFor, quoteArg, scriptCommand, skillRoot } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const scripts = path.join(root, "skills", "azure-dr-assessment", "scripts");
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-cmdtext-"));

test("quoteArg leaves safe words alone and quotes the rest for the platform's shell", () => {
    assert.equal(quoteArg("--root", "linux"), "--root");
    assert.equal(quoteArg("/usr/local/bin/node", "linux"), "/usr/local/bin/node");
    assert.equal(quoteArg("/a b/Final SVG Icons", "linux"), "'/a b/Final SVG Icons'");
    assert.equal(quoteArg("it's", "linux"), "'it'\\''s'");
    assert.equal(quoteArg("", "linux"), "''");
    assert.equal(quoteArg("$HOME;x", "darwin"), "'$HOME;x'");
    assert.equal(quoteArg("C:\\a b", "linux"), "'C:\\a b'");
    assert.equal(quoteArg("C:\\Users\\me\\icons", "win32"), "C:\\Users\\me\\icons");
    assert.equal(quoteArg("C:\\Program Files\\x", "win32"), '"C:\\Program Files\\x"');
    assert.equal(quoteArg('say "hi"', "win32"), '"say ""hi"""');
});

test("quoteArg quotes a word that starts with =, which zsh expands to a path, and leaves = elsewhere alone", () => {
    for (const platform of ["linux", "darwin"]) {
        assert.equal(quoteArg("=cmd", platform), "'=cmd'", platform);
        assert.equal(quoteArg("==x", platform), "'==x'", platform);
        assert.equal(quoteArg("=", platform), "'='", platform);
        assert.equal(quoteArg("--root=x", platform), "--root=x", platform);
        assert.equal(quoteArg("a=b", platform), "a=b", platform);
    }
    assert.equal(quoteArg("=cmd", "win32"), '"=cmd"');
    assert.equal(quoteArg("=", "win32"), '"="');
    assert.equal(quoteArg("--root=x", "win32"), "--root=x");
    assert.equal(quoteArg("C:\\a=b", "win32"), "C:\\a=b");
});

test("scriptCommand names a script of this skill by its absolute path and quotes its arguments", () => {
    const file = path.join(skillRoot(), "scripts", "fetch-icons.mjs");
    assert.ok(path.isAbsolute(file) && existsSync(file));
    assert.equal(scriptCommand("fetch-icons.mjs"), `node ${quoteArg(file)}`);
    assert.equal(
        scriptCommand("fetch-icons.mjs", ["--root", "/a b/icons", "--force"], "linux"),
        `${scriptCommand("fetch-icons.mjs", [], "linux")} --root '/a b/icons' --force`,
    );
});

test("outputRootFor announces exactly one trailing slash, also for a root folder", () => {
    const cwd = tmp();
    assert.equal(outputRootFor({ cwd, app: "checkout" }).announce, "Output folder: dr-assessment/checkout/");
    const top = outputRootFor({ cwd, app: "checkout", override: path.parse(cwd).root }).announce;
    assert.ok(top.endsWith("/"), top);
    assert.doesNotMatch(top, /\/\/$/);
    if (path.sep === "/") assert.equal(top, "Output folder: /");
});

test("preflight names the fetch command with an absolute script path and a quoted icon root", async () => {
    const iconRoot = path.join(tmp(), "My Icons");
    const env = { COPILOT_HOME: tmp(), ARCH_CANVAS_ICON_ROOT: undefined, DR_AZ: undefined, DR_BROWSER: process.execPath, DR_NO_NETWORK: "1" };
    const r = await runScript(path.join(scripts, "preflight.mjs"), ["--icon-root", iconRoot], { env });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json.nextActions, [`node ${quoteArg(path.join(scripts, "fetch-icons.mjs"))} --root ${quoteArg(iconRoot)}`]);
    assert.match(r.json.nextActions[0], /--root ["'].*My Icons["']$/);
});
