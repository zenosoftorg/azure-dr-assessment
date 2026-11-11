import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { runAz } from "../../skills/azure-dr-assessment/scripts/lib/live.mjs";
import { isWindows } from "../helpers/fake-az-env.mjs";

/** An executable stand-in for az that prints `bytes` characters, or waits for a minute when bytes is 0. */
function shim(bytes, t) {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-az-shim-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "az");
    writeFileSync(file, `#!${process.execPath}\n${bytes > 0 ? `process.stdout.write("x".repeat(${bytes}));` : "setTimeout(() => {}, 60000);"}\n`);
    chmodSync(file, 0o755);
    return file;
}

const environment = (message, ...hints) => (err) =>
    err instanceof CliError && err.code === EXIT.ENVIRONMENT && message.test(err.message) && hints.every((hint) => err.details.some((line) => hint.test(line)));

test("too much output is its own failure, not a timeout", { skip: isWindows }, async (t) => {
    const az = shim(2 * 1024 * 1024, t);
    await assert.rejects(runAz(["version"], { env: { DR_AZ: az }, maxBufferBytes: 1024 * 1024 }), environment(/^az printed more than 1 MB$/, /narrow the query/));
});

test("an az that does not answer is still a timeout", { skip: isWindows }, async (t) => {
    const az = shim(0, t);
    await assert.rejects(runAz(["version"], { env: { DR_AZ: az }, timeoutMs: 1000 }), environment(/^az did not answer within 1 s$/));
});

test("native Windows without DR_AZ says that live mode is not supported there, before anything runs", async () => {
    await assert.rejects(
        runAz(["version"], { env: { DR_AZ: "" }, platform: "win32" }),
        environment(/^live mode is not supported on native Windows$/, /never start a program through a shell/, /WSL/),
    );
});
