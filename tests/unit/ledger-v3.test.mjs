import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Ledger, LedgerError } from "../../skills/azure-dr-assessment/scripts/lib/ledger.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const script = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "scripts", "ledger.mjs");
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-ledger-v3-"));
const LEARN = "https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault";
const SECRET = ["Account", "Key=abc123"].join("");

const doc = { kind: "doc", url: LEARN, title: "Reliability in Azure Key Vault", retrievedAt: "2026-11-09T10:00:00.000Z", status: "Verified", supports: "Key Vault options", query: "key vault multiregion", tool: "microsoft_docs_fetch" };
const optionResult = (fields = {}) => ({
    id: "secondary-vault-sync", title: "Second vault in the DR region", kind: "workaround", target: "dr-region", usesMechanism: "none",
    rpo: "15m (the sync interval)", rto: "unknown", slot: "secrets-keys", givesUp: "Microsoft-managed failover", ...fields,
});
const option = (fields = {}) => ({ kind: "region", check: "option", subject: "microsoft.keyvault/vaults", status: "Verified", doc: "D-0001", result: optionResult(), ...fields });
const claim = (fields = {}) => ({
    kind: "region", check: "playbook-claim", subject: "microsoft.keyvault/vaults", status: "Verified", doc: "D-0001", quote: "Backups can only be restored in the same geography.",
    result: { playbook: "key-vault", claim: "Backups restore only in the same subscription and geography", agrees: true }, ...fields,
});

function withDoc() {
    const ledger = Ledger.empty();
    ledger.add(doc);
    return ledger;
}

/** The paths of the errors that adding `entry` to a ledger with one doc entry raises. */
function rejected(entry) {
    try {
        withDoc().add(entry);
    } catch (err) {
        assert.ok(err instanceof LedgerError);
        return err.errors.map((e) => e.path);
    }
    return [];
}

test("option and playbook-claim are region checks with a null class and a null substitute", () => {
    const ledger = withDoc();
    assert.equal(ledger.add(option()), "R-0001");
    assert.equal(ledger.add(claim()), "R-0002");
    assert.equal(ledger.add(option({ status: "Unverified", doc: null, result: optionResult({ id: "rebuild", kind: "backup-restore", rpo: "24h", rto: "unknown (no figure)" }) })), "R-0003");
    assert.equal(ledger.add(claim({ status: "Unverified", doc: null, quote: null, result: { playbook: "key-vault", claim: "Soft delete", agrees: false } })), "R-0004");
    assert.deepEqual(Object.keys(ledger.get("R-0001")), ["id", "kind", "check", "subject", "status", "class", "doc", "quote", "result", "substitute", "recordedAt"]);
    for (const id of ["R-0001", "R-0002", "R-0003", "R-0004"]) {
        assert.equal(ledger.get(id).class, null);
        assert.equal(ledger.get(id).substitute, null);
    }
    assert.deepEqual(ledger.get("R-0001").result, optionResult());
    assert.equal(ledger.validate().ok, true);
});

test("an option entry is refused with the path of every broken rule", () => {
    const cases = [
        [{ subject: "Key Vault" }, "subject"],
        [{ status: "Observed" }, "status"],
        [{ class: "any-pair" }, "class"],
        [{ substitute: { source: "unmet", ref: null, label: "Unmet requirement" } }, "substitute"],
        [{ doc: null }, "doc"],
        [{ doc: "D-0009" }, "doc"],
        [{ result: null }, "result"],
        [{ result: optionResult({ id: "Second Vault" }) }, "result.id"],
        [{ result: optionResult({ id: "accept-gap" }) }, "result.id"],
        [{ result: optionResult({ title: "" }) }, "result.title"],
        [{ result: optionResult({ givesUp: " " }) }, "result.givesUp"],
        [{ result: optionResult({ kind: "accept-gap" }) }, "result.kind"],
        [{ result: optionResult({ target: "primary" }) }, "result.target"],
        [{ result: optionResult({ usesMechanism: null }) }, "result.usesMechanism"],
        [{ result: optionResult({ rpo: "about 15m" }) }, "result.rpo"],
        [{ result: optionResult({ rto: 30 }) }, "result.rto"],
        [{ result: optionResult({ slot: "secrets" }) }, "result.slot"],
        [{ result: optionResult({ givesUp: SECRET }) }, "result.givesUp"],
    ];
    for (const [fields, expected] of cases) {
        assert.ok(rejected(option(fields)).includes(expected), `${JSON.stringify(fields)} is refused at ${expected}`);
    }
});

test("a playbook-claim entry is refused with the path of every broken rule", () => {
    const cases = [
        [{ subject: "key-vault" }, "subject"],
        [{ status: "Verified", quote: null }, "quote"],
        [{ status: "Verified", doc: null }, "doc"],
        [{ class: "none" }, "class"],
        [{ result: "agrees" }, "result"],
        [{ result: { playbook: "Key Vault", claim: "c", agrees: true } }, "result.playbook"],
        [{ result: { playbook: "key-vault", claim: "", agrees: true } }, "result.claim"],
        [{ result: { playbook: "key-vault", claim: "c", agrees: "yes" } }, "result.agrees"],
        [{ quote: SECRET }, "quote"],
    ];
    for (const [fields, expected] of cases) {
        assert.ok(rejected(claim(fields)).includes(expected), `${JSON.stringify(fields)} is refused at ${expected}`);
    }
});

test("the fixed pair and geography fields are checked when present, and other fields stay free", () => {
    const ledger = withDoc();
    const pair = (result) => ({ kind: "region", check: "pair", subject: "swedencentral|germanywestcentral", status: "Verified", doc: "D-0001", result });
    const geography = (result) => ({ kind: "region", check: "geography", subject: "germanywestcentral", status: "Verified", doc: "D-0001", result });
    assert.equal(ledger.add(pair({ paired: false, primaryPair: "swedensouth", drPair: "germanynorth" })), "R-0001");
    assert.equal(ledger.add(pair({ paired: true, primaryPair: null, drPair: null, note: "extra fields are allowed" })), "R-0002");
    assert.equal(ledger.add(pair({ pair: false })), "R-0003");
    assert.equal(ledger.add(pair(null)), "R-0004");
    assert.equal(ledger.add(geography({ region: "germanywestcentral", geography: "Germany", residency: "crosses" })), "R-0005");
    assert.equal(ledger.add(geography({ region: "swedensouth", geography: "Sweden", residency: "ok", zones: 3 })), "R-0006");
    assert.deepEqual(rejected(pair({ paired: "no" })), ["result.paired"]);
    assert.deepEqual(rejected(pair({ paired: false, primaryPair: 7, drPair: ["x"] })), ["result.primaryPair", "result.drPair"]);
    assert.deepEqual(rejected(pair("paired")), ["result"]);
    assert.deepEqual(rejected(geography({ region: "", geography: "Germany", residency: "ok" })), ["result.region"]);
    assert.deepEqual(rejected(geography({ region: "germanywestcentral", geography: null, residency: "ok" })), ["result.geography"]);
    assert.deepEqual(rejected(geography({ region: "germanywestcentral", geography: "Germany", residency: "maybe" })), ["result.residency"]);
    assert.deepEqual(rejected({ kind: "region", check: "zones", subject: "germanywestcentral", status: "Verified", result: "three zones" }), []);
});

test("the CLI records option and playbook-claim entries and its help lists the checks", async () => {
    const ledger = path.join(tmp(), "ledger.json");
    const added = await runScript(script, ["add-doc", "--ledger", ledger, "--url", LEARN, "--title", "Reliability in Azure Key Vault", "--status", "Verified", "--supports", "options", "--tool", "microsoft_docs_fetch"]);
    assert.equal(added.json.id, "D-0001");
    const opt = await runScript(script, ["add-region", "--ledger", ledger, "--check", "option", "--subject", "microsoft.keyvault/vaults", "--status", "Verified", "--doc", "D-0001", "--result", JSON.stringify(optionResult())]);
    assert.equal(opt.code, 0, opt.stdout + opt.stderr);
    assert.deepEqual(opt.json, { ok: true, script: "ledger", id: "R-0001" });
    const verified = await runScript(script, ["add-region", "--ledger", ledger, "--check", "playbook-claim", "--subject", "microsoft.keyvault/vaults", "--status", "Verified", "--doc", "D-0001", "--result", JSON.stringify({ playbook: "key-vault", claim: "c", agrees: false })]);
    assert.equal(verified.code, 1);
    assert.deepEqual(verified.json.details, ["quote: a Verified playbook-claim entry needs the quoted Learn text"]);
    assert.equal(JSON.parse(readFileSync(ledger, "utf8")).entries.length, 2);
    const help = await runScript(script, ["--help"]);
    assert.match(help.stdout, /add-region: pair, geography, zones, latency, mechanism, fit, option or playbook-claim/);
    assert.match(help.stdout, /playbook-claim: playbook, claim, agrees/);
});
