import assert from "node:assert/strict";
import test from "node:test";
import { fileExitCode } from "../helpers/file-exit-code.mjs";

test("a file passes only when it ended by itself with exit code 0", () => {
    assert.equal(fileExitCode({ code: 0, signal: null, timedOut: false }), 0);
    assert.equal(fileExitCode({ code: 3, signal: null, timedOut: false }), 3);
});

test("a file that timed out fails, even when its process then ended with exit code 0", () => {
    assert.equal(fileExitCode({ code: 0, signal: null, timedOut: true }), 1);
    assert.equal(fileExitCode({ code: 0, signal: "SIGKILL", timedOut: true }), 1);
});

test("a file that a signal ended, or that has no exit code, fails", () => {
    assert.equal(fileExitCode({ code: null, signal: "SIGTERM", timedOut: false }), 1);
    assert.equal(fileExitCode({ code: 0, signal: "SIGTERM", timedOut: false }), 1);
    assert.equal(fileExitCode({ code: null, signal: null, timedOut: false }), 1);
});
