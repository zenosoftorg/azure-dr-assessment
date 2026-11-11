import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertReadOnly } from "../../skills/azure-dr-assessment/scripts/lib/live.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { defaultFixture, installFakeAz, isWindows, SUB_A, SUB_B, SUB_GAP, TENANT } from "../helpers/fake-az-env.mjs";

const skip = isWindows ? "the fake az is a script with a shebang" : false;
const script = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "scripts", "collect-live.mjs");
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-collect-"));

test("inventory mode announces the tenant and subscriptions, writes --out and reports partial results with exit 0", { skip }, async () => {
    const fake = installFakeAz();
    const out = path.join(tmp(), "evidence", "live.json");
    const r = await runScript(script, ["--subscriptions", `${SUB_A},${SUB_B},${SUB_GAP}`, "--tenant", TENANT, "--out", out], { env: fake.env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.mode, "inventory");
    assert.equal(r.json.tenantId, TENANT);
    assert.deepEqual(r.json.subscriptions, [{ id: SUB_A, name: "Sub A" }, { id: SUB_B, name: "Sub B" }, { id: SUB_GAP, name: null }]);
    assert.equal(r.json.queries, 3);
    assert.equal(r.json.rows, 6);
    assert.equal(r.json.permissionGaps.length, 1);
    assert.equal(r.json.permissionGaps[0].subscriptionId, SUB_GAP);
    assert.equal(r.json.out, out);
    assert.match(r.stderr, new RegExp(`tenant ${TENANT}`));
    assert.match(r.stderr, new RegExp(SUB_A));
    assert.match(r.stderr, /read-only/);
    const saved = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(saved.schemaVersion, 1);
    assert.equal(saved.mode, "inventory");
    assert.equal(saved.resources.length, 6);
    assert.equal(saved.permissionGaps.length, 1);
    assert.equal(JSON.stringify(saved).includes("Fixture-Pw"), false);
    for (const argv of fake.calls()) assert.doesNotThrow(() => assertReadOnly(argv), argv.join(" "));
});

test("inventory mode without --out only reports counts, and --first sets the page size", { skip }, async () => {
    const fake = installFakeAz();
    const r = await runScript(script, ["--subscriptions", SUB_A, "--first", "1"], { env: fake.env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.out, null);
    assert.equal(r.json.rows, 4);
    assert.equal(r.json.queries, 4 + 1 + 1);
});

test("fit mode needs a location and --out, takes --sizes and writes the fit result", { skip }, async () => {
    const fake = installFakeAz();
    const out = path.join(tmp(), "fit.json");
    const r = await runScript(script, ["--mode", "fit", "--location", "swedencentral", "--sizes", "Standard_D4s_v5,Standard_M416s_v2", "--subscriptions", SUB_A, "--out", out], { env: fake.env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.mode, "fit");
    assert.equal(r.json.tenantId, TENANT);
    assert.deepEqual(r.json.subscriptions, [{ id: SUB_A, name: "Sub A" }]);
    assert.equal(r.json.rows, 4);
    assert.deepEqual(r.json.permissionGaps, []);
    const saved = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(saved.schemaVersion, 1);
    assert.equal(saved.mode, "fit");
    assert.equal(saved.location, "swedencentral");
    assert.deepEqual(saved.skus.map((s) => [s.size, s.available]), [["Standard_D4s_v5", true], ["Standard_M416s_v2", false]]);
    assert.equal((await runScript(script, ["--mode", "fit", "--out", out], { env: fake.env })).code, 1);
    assert.equal((await runScript(script, ["--mode", "fit", "--location", "swedencentral"], { env: fake.env })).code, 1);
});

test("usage errors exit 1 and a missing az, extension or login exits 3", { skip }, async () => {
    const fake = installFakeAz();
    assert.equal((await runScript(script, [], { env: fake.env })).code, 1);
    assert.equal((await runScript(script, ["--subscriptions", "not-a-guid"], { env: fake.env })).code, 1);
    assert.equal((await runScript(script, ["--subscriptions", SUB_A, "--first", "0"], { env: fake.env })).code, 1);
    assert.equal((await runScript(script, ["--subscriptions", SUB_A, "--mode", "everything"], { env: fake.env })).code, 1);
    const missing = await runScript(script, ["--subscriptions", SUB_A], { env: { DR_AZ: path.join(tmp(), "no-such-az") } });
    assert.equal(missing.code, 3);
    assert.match(missing.json.error, /not found/);
    const noExtension = defaultFixture();
    noExtension.extensions = [];
    assert.equal((await runScript(script, ["--subscriptions", SUB_A], { env: installFakeAz(noExtension).env })).code, 3);
    const notLoggedIn = defaultFixture();
    notLoggedIn.failures = { "account show": { code: 1, stderr: "Please run 'az login'" } };
    assert.equal((await runScript(script, ["--subscriptions", SUB_A], { env: installFakeAz(notLoggedIn).env })).code, 3);
});
