import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "..", "..");
const runner = path.join(repo, "tests", "run-all.mjs");
const fixtures = path.join("tests", "fixtures", "runner");
const leaky = path.join(fixtures, "leaky.fixture.mjs");
const hanging = path.join(fixtures, "hang.fixture.mjs");
const noProcessGroups = process.platform === "win32" && "needs process groups and ps";

/** Start the runner on some files or folders. It collects what the runner prints and ends with its exit code. */
function start(env, ...targets) {
    const child = spawn(process.execPath, [runner, ...targets], { cwd: repo, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const done = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, output }));
    });
    return { child, done };
}
const run = (env, ...targets) => start(env, ...targets).done;

/** A file for the fixtures to write to, in a folder of its own that goes away with the test. If a fixture is still running when the test ends, because the runner did not kill it, the processes that it recorded in the file are killed first, so that nothing is left running. */
function marker(t) {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-runner-"));
    const file = path.join(dir, "marker.txt");
    t.after(() => {
        for (const pid of pidsIn(file)) {
            try {
                process.kill(pid, "SIGKILL");
            } catch {
                // already gone
            }
        }
        rmSync(dir, { recursive: true, force: true });
    });
    return file;
}

/** An empty folder to be the runner's TMPDIR, so that the test can see whether the runner removed what it made there. */
function privateTmp(t) {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-runner-tmp-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The totals that the runner prints at the end, which is everything from its last "ℹ tests" line on (each file prints totals of its own before). */
const totalsOf = (output) => output.slice(output.lastIndexOf("ℹ tests"));

/** Wait until the check is true, for at most `limit` milliseconds. */
async function until(check, limit = 5000) {
    for (let waited = 0; waited < limit && !check(); waited += 50) await sleep(50);
    return check();
}

/** True when the process is gone. A zombie, which its parent has not collected yet, counts as gone. */
function isGone(pid) {
    const ps = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
    if (ps.error) {
        try {
            process.kill(pid, 0);
            return false;
        } catch {
            return true;
        }
    }
    return ps.stdout.trim() === "" || ps.stdout.trim().startsWith("Z");
}

/** The two processes that hang.fixture.mjs recorded: the test file's and its child's. The leaky fixture writes a folder name to its file, which gives none. */
const pidsIn = (file) => (existsSync(file) ? readFileSync(file, "utf8").split(" ").map(Number).filter((pid) => Number.isInteger(pid) && pid > 1) : []);

test("the runner removes the temporary folders that the tests made, and they were made in a folder of its own", async (t) => {
    const file = marker(t);
    assert.equal((await run({ DR_LEAK_MARKER: file }, leaky)).code, 0);
    const leaked = readFileSync(file, "utf8");
    assert.match(path.basename(path.dirname(leaked)), /^dr-tests-/);
    assert.equal(existsSync(leaked), false);
    assert.equal(existsSync(path.dirname(leaked)), false);
});

test("the runner passes a failing exit code on and still cleans up", async (t) => {
    const file = marker(t);
    assert.notEqual((await run({ DR_LEAK_MARKER: file, DR_LEAK_FAIL: "1" }, leaky)).code, 0);
    assert.equal(existsSync(path.dirname(readFileSync(file, "utf8"))), false);
});

test("a folder is searched for test files, the totals add up, and a failing file is named", async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-runner-files-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, "sub"));
    const body = (checks) => `import test from "node:test";\n${checks}\n`;
    writeFileSync(path.join(dir, "a.test.mjs"), body('test("one", () => {});\ntest("two", () => {});'));
    writeFileSync(path.join(dir, "sub", "b.test.mjs"), body('test("three", () => {});\ntest("four", { skip: "on purpose" }, () => {});'));
    writeFileSync(path.join(dir, "ignored.fixture.mjs"), body('test("not a test file", () => { throw new Error("must not run"); });'));
    const good = await run({}, dir);
    assert.equal(good.code, 0, good.output);
    assert.match(totalsOf(good.output), /^ℹ tests 4$/m);
    assert.match(totalsOf(good.output), /^ℹ pass 3$/m);
    assert.match(totalsOf(good.output), /^ℹ skipped 1$/m);
    assert.match(totalsOf(good.output), /^ℹ files 2$/m);
    assert.doesNotMatch(good.output, /failed files/);

    writeFileSync(path.join(dir, "c.test.mjs"), body('test("broken", () => { throw new Error("on purpose"); });'));
    const bad = await run({}, dir);
    assert.equal(bad.code, 1, bad.output);
    assert.match(bad.output, /failed files \(1\):\n {2}\S*c\.test\.mjs \(exit 1\)/);
    assert.match(totalsOf(bad.output), /^ℹ tests 5$/m);
    assert.match(totalsOf(bad.output), /^ℹ fail 1$/m);
});

test("a path that does not exist, or a folder without test files, stops the run before anything starts", async () => {
    const missing = await run({}, path.join("tests", "no-such-folder"));
    assert.equal(missing.code, 1);
    assert.match(missing.output, /^cannot read the tests to run: /);
    const empty = await run({}, fixtures);
    assert.equal(empty.code, 1);
    assert.match(empty.output, /^no test files to run$/m);
});

test("the runner kills the process group of a test file that runs too long, fails the run, and leaves no process behind", { skip: noProcessGroups, timeout: 60_000 }, async (t) => {
    const file = marker(t);
    const tmp = privateTmp(t);
    const result = await run({ DR_HANG_MARKER: file, DR_TEST_FILE_TIMEOUT_MS: "1500", TMPDIR: tmp }, hanging);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /✖ \S*hang\.fixture\.mjs: timed out after 1\.5 s \(DR_TEST_FILE_TIMEOUT_MS\); its process group was killed/);
    assert.match(result.output, /failed files \(1\):\n {2}\S*hang\.fixture\.mjs \(timed out\)/);
    const [filePid, childPid] = pidsIn(file);
    assert.ok(filePid > 0 && childPid > 0 && filePid !== childPid, "the fixture recorded its own process and its child");
    assert.ok(await until(() => isGone(filePid) && isGone(childPid)), "the test file or its child is still running");
    assert.deepEqual(readdirSync(tmp), [], "the runner removed its temporary folder");
});

test("the runner passes SIGTERM on to the files that are running, and exits with an error", { skip: noProcessGroups, timeout: 60_000 }, async (t) => {
    const file = marker(t);
    const tmp = privateTmp(t);
    const { child, done } = start({ DR_HANG_MARKER: file, TMPDIR: tmp }, hanging);
    assert.ok(await until(() => pidsIn(file).length === 2, 10_000), "the fixture did not start");
    child.kill("SIGTERM");
    const result = await done;
    assert.equal(result.code, 1, result.output);
    const [filePid, childPid] = pidsIn(file);
    assert.ok(await until(() => isGone(filePid) && isGone(childPid)), "the test file or its child is still running");
    assert.deepEqual(readdirSync(tmp), [], "the runner removed its temporary folder");
});

test("an unusable DR_TEST_FILE_TIMEOUT_MS, or one too large for a timer, does not time a quick file out", async (t) => {
    const file = marker(t);
    for (const value of ["abc", "0", "-5", "Infinity", "1e12"]) {
        const result = await run({ DR_LEAK_MARKER: file, DR_TEST_FILE_TIMEOUT_MS: value }, leaky);
        assert.equal(result.code, 0, `${value}: ${result.output}`);
        assert.doesNotMatch(result.output, /timed out/);
    }
});

test("npm test goes through the runner", () => {
    const manifest = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8"));
    assert.equal(manifest.scripts.test, "node tests/run-all.mjs");
});
