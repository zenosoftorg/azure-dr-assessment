import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { CliError, EXIT, parseFlags, usageText } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const fixture = path.resolve(import.meta.dirname, "..", "helpers", "fixture-script.mjs");
const spec = {
    name: { type: "string", help: "Name", required: true },
    tag: { type: "string", help: "Tag", multiple: true },
    force: { type: "boolean", help: "Force" },
};

test("parseFlags returns typed values, repeated flags and positionals", () => {
    const { values, positionals, help } = parseFlags(["--name", "a", "--tag", "x", "--tag", "y", "--force", "rest"], spec);
    assert.equal(help, false);
    assert.equal(values.name, "a");
    assert.deepEqual(values.tag, ["x", "y"]);
    assert.equal(values.force, true);
    assert.deepEqual(positionals, ["rest"]);
});

test("parseFlags reports --help without requiring other flags", () => {
    assert.equal(parseFlags(["--help"], spec).help, true);
});

test("parseFlags rejects unknown flags and missing required flags with USAGE", () => {
    assert.throws(() => parseFlags(["--name", "a", "--nope"], spec), (e) => e instanceof CliError && e.code === EXIT.USAGE);
    assert.throws(() => parseFlags([], spec), (e) => e instanceof CliError && e.code === EXIT.USAGE && /--name/.test(e.message));
});

test("usageText lists every flag", () => {
    const text = usageText("demo", "Demo script", spec);
    for (const flag of ["--name", "--tag", "--force", "--help"]) assert.match(text, new RegExp(flag));
});

test("runCli prints one JSON envelope and exits 0", async () => {
    const r = await runScript(fixture, ["--name", "ok"]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.json, { ok: true, script: "fixture", echoed: "ok" });
    assert.equal(r.stdout.trim().split("\n").length, 1);
});

test("runCli maps CliError to its exit code and merges extra into the envelope", async () => {
    const r = await runScript(fixture, ["--name", "refuse"]);
    assert.equal(r.code, EXIT.REFUSED);
    assert.deepEqual(r.json, { ok: false, script: "fixture", code: 4, error: "refused on purpose", details: ["why"], reason: "demo" });
});

test("runCli maps an uncaught error to UNEXPECTED and keeps the stack off stdout", async () => {
    const r = await runScript(fixture, ["--name", "boom"]);
    assert.equal(r.code, EXIT.UNEXPECTED);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.code, 5);
    assert.match(r.stderr, /boom/);
});

test("runCli maps a usage error to exit 1 and prints usage on stderr", async () => {
    const r = await runScript(fixture, []);
    assert.equal(r.code, EXIT.USAGE);
    assert.match(r.stderr, /Usage:/);
    assert.equal(r.json.code, 1);
});

test("runCli --help prints usage text on stdout and exits 0", async () => {
    const r = await runScript(fixture, ["--help"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Usage:/);
    assert.equal(r.json, null);
});
