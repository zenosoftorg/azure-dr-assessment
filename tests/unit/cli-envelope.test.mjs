import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { runScript } from "../helpers/run-cli.mjs";

const reserved = path.resolve(import.meta.dirname, "..", "helpers", "reserved-script.mjs");

test("a result field named like an envelope field cannot overwrite the envelope", async () => {
    const r = await runScript(reserved, ["--mode", "result"]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.json, { ok: true, script: "reserved", kept: 1 });
    assert.deepEqual(Object.keys(r.json).slice(0, 2), ["ok", "script"]);
});

test("the extra fields of a failure cannot overwrite the code, the error or the details", async () => {
    const r = await runScript(reserved, ["--mode", "failure"]);
    assert.equal(r.code, 4);
    assert.deepEqual(r.json, { ok: false, script: "reserved", code: 4, error: "refused", details: ["why"], reason: "demo" });
    assert.deepEqual(Object.keys(r.json).slice(0, 5), ["ok", "script", "code", "error", "details"]);
});
