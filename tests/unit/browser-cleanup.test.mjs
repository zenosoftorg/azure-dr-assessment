import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { findBrowser } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const fixture = path.join(root, "tests", "fixtures", "browser", "launch.fixture.mjs");
const skip = (findBrowser() === null && "no Chrome, Edge or Chromium found") || (process.platform === "win32" && "needs process groups and ps");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The processes that run with this profile, the browser and its helpers. */
function processesOf(profile) {
    const listing = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).stdout;
    return listing
        .split("\n")
        .filter((line) => line.includes(`--user-data-dir=${profile}`))
        .map((line) => Number(line.trim().split(/\s+/)[0]));
}

/** Run the fixture in a process group of its own, as tests/run-all.mjs runs a test file, with a private temporary folder. */
async function start(t, ...args) {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-browser-cleanup-"));
    const startedAt = Date.now();
    const child = spawn(process.execPath, [fixture, ...args], { env: { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const exited = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    const profiles = () => readdirSync(dir).filter((name) => name.startsWith("dr-browser-")).map((name) => path.join(dir, name));
    t.after(async () => {
        // whatever the test left behind goes, whether or not the code under test did its job
        for (const profile of profiles()) {
            for (const pid of processesOf(profile).reverse()) {
                try {
                    process.kill(pid, "SIGKILL");
                } catch {
                    // already gone
                }
            }
        }
        try {
            process.kill(-child.pid, "SIGKILL");
        } catch {
            // already gone
        }
        await exited;
        rmSync(dir, { recursive: true, force: true });
    });
    for (let waited = 0; !output.includes("ready"); waited += 50) {
        assert.ok(waited < 15_000, `the browser did not start: ${output}`);
        await sleep(50);
    }
    return { child, exited, profiles, startedAt, output: () => output };
}

/** Wait for up to five seconds for the browser to be gone. */
async function gone(profile) {
    for (let waited = 0; waited < 5000 && processesOf(profile).length > 0; waited += 100) await sleep(100);
}

for (const signal of ["SIGKILL", "SIGTERM"]) {
    test(`a ${signal} to the process group of the check ends the browser too`, { skip }, async (t) => {
        const run = await start(t);
        const [profile] = run.profiles();
        assert.ok(processesOf(profile).length > 0, "the browser is running");
        process.kill(-run.child.pid, signal);
        await run.exited;
        await gone(profile);
        assert.deepEqual(processesOf(profile), [], "no browser process is left");
    });
}

for (const signal of ["SIGTERM", "SIGINT"]) {
    test(`a ${signal} to the check alone stops the browser and removes its profile`, { skip }, async (t) => {
        const run = await start(t);
        const [profile] = run.profiles();
        assert.ok(processesOf(profile).length > 0, "the browser is running");
        run.child.kill(signal);
        const ended = await run.exited;
        assert.equal(ended.signal, signal, `the check still ends with the signal that it was sent: ${run.output()}`);
        await gone(profile);
        assert.deepEqual(processesOf(profile), [], "no browser process is left");
        assert.deepEqual(run.profiles(), [], `the profile is removed: ${leftOver(profile)}`);
    });
}

/** What is still in the profile, and which processes still name it, for a failure message. */
function leftOver(profile) {
    const files = existsSync(profile) ? readdirSync(profile, { recursive: true }).slice(0, 20) : [];
    const users = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
        .stdout.split("\n")
        .filter((line) => line.includes(profile))
        .map((line) => line.trim().slice(0, 200));
    return JSON.stringify({ files, processes: users });
}

test("a normal close leaves no browser process and no profile", { skip }, async (t) => {
    const run = await start(t, "close");
    const [profile] = run.profiles();
    const ended = await run.exited;
    assert.equal(ended.code, 0, run.output());
    assert.deepEqual(run.profiles(), [], "the profile is removed");
    await gone(profile);
    assert.deepEqual(processesOf(profile), [], "no browser process is left");
});

/** The processes, with their command lines, that run a browser with a profile below this folder. */
function browsersBelow(dir) {
    return spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
        .stdout.split("\n")
        .filter((line) => line.includes(`--user-data-dir=${dir}${path.sep}`));
}

/**
 * Start run-all on the fixture with a time limit and wait until the fixture has signalled that its browser is up.
 * The scratch folders and any browser left are removed by cleanup(), which the caller must run.
 */
async function runUntilBrowser(limitMs) {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-browser-cleanup-"));
    const markers = mkdtempSync(path.join(tmpdir(), "dr-browser-marker-"));
    const marker = path.join(markers, "ready.json");
    const env = { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, DR_TEST_FILE_TIMEOUT_MS: String(limitMs), DR_FIXTURE_MARKER: marker };
    const startedAt = Date.now();
    const runner = spawn(process.execPath, [path.join(root, "tests", "run-all.mjs"), fixture], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let output = "";
    runner.stdout.on("data", (chunk) => (output += chunk));
    runner.stderr.on("data", (chunk) => (output += chunk));
    const exited = new Promise((resolve) => runner.once("close", resolve));
    const cleanup = async () => {
        // whatever the attempt left behind goes, whether or not the code under test did its job
        for (const line of browsersBelow(dir)) {
            try {
                process.kill(Number(line.trim().split(/\s+/)[0]), "SIGKILL");
            } catch {
                // already gone
            }
        }
        try {
            process.kill(-runner.pid, "SIGKILL");
        } catch {
            // already gone
        }
        await exited;
        rmSync(dir, { recursive: true, force: true });
        rmSync(markers, { recursive: true, force: true });
    };
    const attempt = { dir, runner, exited, cleanup, output: () => output, startedAt };
    // a generous deadline: it is the marker that the attempt waits for, not the clock
    for (let waited = 0; !existsSync(marker); waited += 50) {
        if (runner.exitCode !== null) return { ...attempt, endedFirst: true };
        if (waited >= 60_000) return { ...attempt, neverReady: true };
        await sleep(50);
    }
    return { ...attempt, readyAt: JSON.parse(readFileSync(marker, "utf8")).at, browsers: browsersBelow(dir) };
}

test("a test file that the runner kills at its time limit leaves no browser and no scratch folder", { skip }, async (t) => {
    // The browser start time varies with the load of the machine, so a limit that is too short is retried with a longer one
    // (the runner must be seen with its browser up before its limit fires, or the run proves nothing). Only the last attempt may fail.
    const retries = [];
    for (const limitMs of [4000, 8000, 16_000, 30_000]) {
        const run = await runUntilBrowser(limitMs);
        t.after(run.cleanup);
        try {
            assert.ok(!run.neverReady, `the fixture never signalled its browser: ${run.output()}`);
            const late =
                (run.endedFirst && "the runner ended at its time limit before the browser came up") ||
                (run.readyAt - run.startedAt >= limitMs && "the browser came up after the time limit") ||
                (run.runner.exitCode !== null && "the runner had ended when the browser was seen") ||
                (/timed out/.test(run.output()) && "the time limit had fired when the browser was seen") ||
                (run.browsers.length === 0 && "no browser process was found when the marker was seen");
            if (late) {
                retries.push(`${limitMs} ms: ${late}`);
                continue;
            }
            await run.exited;
            assert.match(run.output(), new RegExp(`timed out after ${limitMs / 1000} s`), "the runner reached the time limit");
            for (let waited = 0; waited < 5000 && browsersBelow(run.dir).length > 0; waited += 100) await sleep(100);
            assert.deepEqual(browsersBelow(run.dir), [], "no browser process is left");
            assert.deepEqual(readdirSync(run.dir), [], "the runner's scratch folder and the browser profile are removed");
            return;
        } finally {
            await run.cleanup();
        }
    }
    assert.fail(`the browser was never seen up inside a time limit of the runner, so this run proves nothing: rerun on a quieter machine\n${retries.join("\n")}`);
});
