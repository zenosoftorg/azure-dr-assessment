import { spawn, spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileExitCode } from "./helpers/file-exit-code.mjs";

// Runs every test file in a process of its own and in a process group of its own, with a private temporary folder that
// it removes afterwards, so that no test has to clean up after itself. A file that runs longer than DR_TEST_FILE_TIMEOUT_MS
// (default 120000) has its whole process group killed and fails the run, so that a hung child of a test cannot hold it.
// Pass test files or folders to run fewer; the default is the tests folder.
const TOTALS = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"];
const requested = Number(process.env.DR_TEST_FILE_TIMEOUT_MS);
// setTimeout turns anything above 2 ** 31 - 1 (and Infinity) into 1 millisecond, so the limit stops at about 24 days
const timeoutMs = requested > 0 ? Math.min(requested, 2 ** 31 - 1) : 120_000;
const repo = path.resolve(import.meta.dirname, "..");
const started = performance.now();
const active = new Set();
let stopping = false;

/** Kill the process group that the file was started in, and with it every child that the file left running. */
function killGroup(child, signal = "SIGKILL") {
    if (child.pid === undefined) return;
    try {
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
        else process.kill(-child.pid, signal);
    } catch {
        // the group is already gone
    }
}

// The files are not in the terminal's process group, so Ctrl-C does not reach them: pass the signal on.
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        stopping = true;
        for (const child of active) killGroup(child, signal);
    });
}

/** The test files that an argument names: the file itself, or every *.test.mjs below a folder. */
function testFilesOf(target) {
    if (!statSync(target).isDirectory()) return [target];
    return readdirSync(target, { withFileTypes: true })
        .flatMap((entry) => {
            const full = path.join(target, entry.name);
            if (entry.isDirectory()) return testFilesOf(full);
            return entry.name.endsWith(".test.mjs") ? [full] : [];
        })
        .sort();
}

let files;
try {
    files = (process.argv.length > 2 ? process.argv.slice(2) : [path.join(repo, "tests")]).flatMap((target) => testFilesOf(path.resolve(target)));
} catch (err) {
    console.error(`cannot read the tests to run: ${err.message}`);
    process.exit(1);
}
if (files.length === 0) {
    console.error("no test files to run");
    process.exit(1);
}

const scratch = await mkdtemp(path.join(os.tmpdir(), "dr-tests-"));
// A run that is itself started by node --test must not make the files think that they are children of it.
const { NODE_TEST_CONTEXT, ...inherited } = process.env;
const env = { ...inherited, TMPDIR: scratch, TMP: scratch, TEMP: scratch };

function runFile(file) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, ["--test-reporter=spec", file], {
            env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
        });
        active.add(child);
        let output = "";
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            killGroup(child);
        }, timeoutMs);
        const finish = (code, signal) => {
            clearTimeout(timer);
            active.delete(child);
            resolve({ file, output: output === "" || output.endsWith("\n") ? output : `${output}\n`, timedOut, code: fileExitCode({ code, signal, timedOut }) });
        };
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        child.on("error", (err) => {
            output += `${err.message}\n`;
            finish(1, null);
        });
        child.on("close", finish);
    });
}

const results = [];
let next = 0;
async function worker() {
    while (!stopping && next < files.length) {
        const result = await runFile(files[next++]);
        results.push(result);
        process.stdout.write(result.output);
        if (result.timedOut) {
            process.stdout.write(`✖ ${path.relative(process.cwd(), result.file)}: timed out after ${timeoutMs / 1000} s (DR_TEST_FILE_TIMEOUT_MS); its process group was killed\n`);
        }
    }
}
await Promise.all(Array.from({ length: Math.min(files.length, Math.max(1, os.availableParallelism() - 1)) }, worker));

const totals = Object.fromEntries(TOTALS.map((name) => [name, 0]));
for (const { output } of results) {
    for (const name of TOTALS) totals[name] += Number(new RegExp(`^ℹ ${name} (\\d+)$`, "m").exec(output)?.[1] ?? 0);
}
const failed = results.filter((result) => result.code !== 0);
if (failed.length > 0) {
    console.log(`\n✖ failed files (${failed.length}):`);
    for (const { file, code, timedOut } of failed) console.log(`  ${path.relative(process.cwd(), file)} (${timedOut ? "timed out" : `exit ${code}`})`);
}
console.log(`\n${TOTALS.map((name) => `ℹ ${name} ${totals[name]}`).join("\n")}\nℹ files ${results.length}\nℹ duration_ms ${(performance.now() - started).toFixed(0)}`);
await rm(scratch, { recursive: true, force: true });
process.exitCode = stopping || failed.length > 0 || results.length < files.length ? 1 : 0;
