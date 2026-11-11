import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** The browser could not be started or reached. */
export class BrowserStartError extends Error {}

/** The browser started, but a command failed or the time ran out. */
export class BrowserError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for `promise`, but give up after `ms`. The timer is cleared so it never keeps the process alive. */
const settleWithin = (promise, ms) =>
    new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        promise.then(() => {
            clearTimeout(timer);
            resolve();
        });
    });

/** Remove the profile. Browser helper processes can write to it for a moment after the main process exits, so look again. */
async function removeProfile(dir) {
    for (let attempt = 0; attempt < 8; attempt++) {
        await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        await sleep(250);
        if (!existsSync(dir)) return;
    }
}

/** Block this thread for `ms`. Only for the signal path, which must finish before the event loop runs again. */
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * The live processes whose command line names the profile: the browser, its helpers and its crash handler.
 * A process that has exited but is not yet reaped shows no arguments, so it is not listed. Null when ps cannot be run.
 */
function processesUsing(profile) {
    const listing = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
    if (listing.status !== 0 || typeof listing.stdout !== "string") return null;
    return listing.stdout
        .split("\n")
        .filter((line) => line.includes(profile))
        .map((line) => Number(line.trim().split(/\s+/)[0]))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

/**
 * Kill every process that still uses the profile and wait, up to `timeoutMs`, until none is left, then remove the profile,
 * looking again in case a process that was shutting down wrote to it. Synchronous, so that it is done before a signal ends this process.
 */
function stopAndRemoveProfileSync(profile, { timeoutMs = 5000 } = {}) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const pids = processesUsing(profile);
        if (pids === null) {
            // no ps (native Windows): give the helpers a moment to follow the main process
            sleepSync(500);
            break;
        }
        if (pids.length === 0 || Date.now() > end) break;
        for (const pid of pids) {
            try {
                process.kill(pid, "SIGKILL");
            } catch {
                // already gone
            }
        }
        sleepSync(50);
    }
    for (let attempt = 0; attempt < 8; attempt++) {
        try {
            rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
            // look again below
        }
        sleepSync(100);
        if (!existsSync(profile)) return;
    }
}

/** Poll until `test` returns something truthy. Stops at the timeout or when the signal aborts. */
export async function waitFor(test, { what = "the condition", timeoutMs = 10_000, intervalMs = 100, signal } = {}) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        if (signal?.aborted) throw new BrowserError("the browser check timed out");
        const value = await test();
        if (value) return value;
        if (Date.now() > end) throw new BrowserError(`timed out waiting for ${what}`);
        await sleep(intervalMs);
    }
}

function connect(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let nextId = 1;
        const pending = new Map();
        const listeners = [];
        ws.onerror = () => reject(new BrowserStartError("cannot connect to the browser's debugging socket"));
        ws.onclose = () => {
            for (const { fail } of pending.values()) fail(new BrowserError("the browser closed the debugging connection"));
            pending.clear();
        };
        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.id !== undefined && pending.has(message.id)) {
                const { done, fail } = pending.get(message.id);
                pending.delete(message.id);
                if (message.error) fail(new BrowserError(message.error.message));
                else done(message.result);
            } else if (message.method) {
                for (const listener of listeners) listener(message);
            }
        };
        ws.onopen = () =>
            resolve({
                send: (method, params = {}) =>
                    new Promise((done, fail) => {
                        const id = nextId++;
                        pending.set(id, { done, fail });
                        ws.send(JSON.stringify({ id, method, params }));
                    }),
                on: (listener) => listeners.push(listener),
                close: () => ws.close(),
            });
    });
}

/**
 * Start a headless Chromium-family browser with a throwaway profile and connect to its first page.
 * The debugging port is read from DevToolsActivePort in the profile, and the profile is removed
 * only after the browser process has exited.
 */
export async function launchBrowser(executable, { signal, windowSize = "1600,900" } = {}) {
    const profile = await mkdtemp(path.join(tmpdir(), "dr-browser-"));
    // Extra flags, for example --no-sandbox on a CI runner or in a container, come from DR_BROWSER_FLAGS.
    const extraFlags = (process.env.DR_BROWSER_FLAGS ?? "").split(/\s+/).filter(Boolean);
    const child = spawn(
        executable,
        [
            "--headless=new",
            "--remote-debugging-port=0",
            `--user-data-dir=${profile}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            `--window-size=${windowSize}`,
            ...extraFlags,
            "about:blank",
        ],
        { stdio: "ignore" },
    );
    let gone = false;
    const exited = new Promise((resolve) => {
        child.once("exit", () => {
            gone = true;
            resolve();
        });
        child.once("error", () => {
            gone = true;
            resolve();
        });
    });
    let socket = null;
    // The browser stays in the caller's process group on purpose: a group kill from the caller (a test runner, a host that
    // times the check out) then reaches it too. Its helper processes follow the main process when that exits.
    const stop = async () => {
        socket?.close();
        if (!gone) child.kill();
        await settleWithin(exited, 3000);
        if (!gone) child.kill("SIGKILL");
        await settleWithin(exited, 2000);
    };
    // SIGTERM or SIGINT sent to this process alone would end it without any cleanup and leave the browser running for good.
    const onSignal = (name) => {
        process.removeListener("SIGTERM", onSignal);
        process.removeListener("SIGINT", onSignal);
        child.kill("SIGKILL");
        try {
            // A SIGKILL is not instant, and the helper processes outlive the main process for a moment and can still write to the
            // profile. Wait for all of them to be gone before removing it, all synchronously so that nothing else runs first.
            stopAndRemoveProfileSync(profile);
        } catch {
            // best effort: the signal must still end this process
        }
        process.kill(process.pid, name);
    };
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
    signal?.addEventListener("abort", () => stop(), { once: true });
    const close = async () => {
        process.removeListener("SIGTERM", onSignal);
        process.removeListener("SIGINT", onSignal);
        await stop();
        await removeProfile(profile);
    };

    try {
        const portFile = path.join(profile, "DevToolsActivePort");
        await waitFor(
            () => {
                if (gone) throw new BrowserStartError(`${path.basename(executable)} exited before it opened a debugging port`);
                return existsSync(portFile);
            },
            { what: "the debugging port", signal },
        );
        const [port] = (await readFile(portFile, "utf8")).split("\n");
        const target = await waitFor(
            async () => {
                try {
                    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
                    return list.find((entry) => entry.type === "page");
                } catch {
                    return null;
                }
            },
            { what: "the first page", signal },
        );
        socket = await connect(target.webSocketDebuggerUrl);
        return { send: socket.send, on: socket.on, close };
    } catch (err) {
        await close();
        throw err instanceof BrowserStartError ? err : new BrowserStartError(err.message);
    }
}
