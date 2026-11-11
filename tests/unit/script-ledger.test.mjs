import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runScript } from "../helpers/run-cli.mjs";

const script = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "scripts", "ledger.mjs");
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-ledger-cli-"));
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

const factFlags = ["add-fact", "--strength", "Observed", "--subject", "ari:SQL DBs!3", "--claim", "orders-db Zone Redundant is false", "--property", "Zone Redundant", "--value", "false", "--source-type", "ari-xlsx", "--source-ref", "ari:SQL DBs!3", "--source-detail", "column Zone Redundant"];

test("add-fact creates the ledger, allocates ids and stores JSON values", async () => {
    const dir = tmp();
    const ledger = path.join(dir, "evidence", "ledger.json");
    const first = await runScript(script, [...factFlags, "--ledger", ledger]);
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(first.json, { ok: true, script: "ledger", id: "F-0001" });
    const second = await runScript(script, ["add-fact", "--ledger", ledger, "--strength", "Inferred", "--subject", "web", "--claim", "web calls orders-db", "--source-type", "owner", "--basis", "owner statement", "--value", '{"a":[1,2]}']);
    assert.equal(second.json.id, "F-0002");
    const saved = read(ledger);
    assert.equal(saved.schemaVersion, 1);
    assert.equal(saved.entries[0].value, false);
    assert.deepEqual(saved.entries[1].value, { a: [1, 2] });
    assert.equal(saved.entries[1].basis, "owner statement");
});

test("add-doc and add-region record documentation and region analysis", async () => {
    const dir = tmp();
    const ledger = path.join(dir, "ledger.json");
    const doc = await runScript(script, ["add-doc", "--ledger", ledger, "--url", "https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support", "--title", "Azure services with multiregion support", "--status", "Verified", "--supports", "mechanism rows for SQL Database", "--query", "sql database geo-replication", "--tool", "microsoft_docs_fetch"]);
    assert.equal(doc.code, 0, doc.stderr);
    assert.equal(doc.json.id, "D-0001");
    assert.match(read(ledger).entries[0].retrievedAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, "a Verified doc without --retrieved-at is stamped with the current time");
    const explicit = await runScript(script, ["add-doc", "--ledger", ledger, "--url", "https://example.com/x", "--title", "t", "--status", "Verified", "--supports", "s", "--tool", "learn-cli", "--retrieved-at", "2026-11-04T09:00:00.000Z"]);
    assert.equal(read(ledger).entries[1].retrievedAt, "2026-11-04T09:00:00.000Z");
    const unverified = await runScript(script, ["add-doc", "--ledger", ledger, "--title", "t", "--status", "Unverified", "--supports", "s", "--tool", "none"]);
    assert.equal(unverified.code, 0, unverified.stderr);
    assert.equal(explicit.json.id, "D-0002");
    assert.equal(unverified.json.id, "D-0003");

    const mechanism = await runScript(script, ["add-region", "--ledger", ledger, "--check", "mechanism", "--subject", "microsoft.sql/servers/databases", "--status", "Verified", "--class", "any-pair", "--doc", "D-0001", "--quote", "SQL Database | Active geo-replication | Yes | Yes", "--result", '{"mechanism":"active geo-replication"}']);
    assert.equal(mechanism.code, 0, mechanism.stderr);
    assert.equal(mechanism.json.id, "R-0001");
    const unmet = await runScript(script, ["add-region", "--ledger", ledger, "--check", "mechanism", "--subject", "microsoft.keyvault/vaults", "--status", "Unverified", "--class", "paired-only", "--substitute-source", "unmet"]);
    assert.equal(unmet.code, 0, unmet.stderr);
    const saved = read(ledger).entries;
    assert.deepEqual(saved[3].result, { mechanism: "active geo-replication" });
    assert.deepEqual(saved[4].substitute, { source: "unmet", ref: null, label: "Unmet requirement" });
});

test("an invalid entry is a usage error and nothing is written", async () => {
    const dir = tmp();
    const ledger = path.join(dir, "ledger.json");
    const noBasis = await runScript(script, ["add-fact", "--ledger", ledger, "--strength", "Inferred", "--subject", "s", "--claim", "c", "--source-type", "owner"]);
    assert.equal(noBasis.code, 1);
    assert.equal(noBasis.json.ok, false);
    assert.ok(noBasis.json.details.includes("basis: Inferred needs a basis"), noBasis.stdout);
    const noClaim = await runScript(script, ["add-fact", "--ledger", ledger, "--strength", "Observed", "--subject", "s", "--source-type", "live", "--source-ref", "arg:x"]);
    assert.equal(noClaim.code, 1);
    assert.equal(existsSync(ledger), false, "a rejected entry must not create the ledger");
});

test("an Observed ref is checked against the inventory beside the ledger, or the one named by --inventory", async () => {
    const dir = tmp();
    const evidence = path.join(dir, "evidence");
    mkdirSync(evidence);
    writeFileSync(path.join(evidence, "inventory.json"), JSON.stringify({ schemaVersion: 1, resources: [{ ref: "ari:SQL DBs!3" }] }));
    const ledger = path.join(evidence, "ledger.json");
    const ok = await runScript(script, [...factFlags, "--ledger", ledger]);
    assert.equal(ok.code, 0, ok.stderr);
    const bad = await runScript(script, ["add-fact", "--ledger", ledger, "--strength", "Observed", "--subject", "s", "--claim", "c", "--source-type", "ari-xlsx", "--source-ref", "ari:SQL DBs!99"]);
    assert.equal(bad.code, 1);
    assert.ok(bad.json.details.some((d) => /ari:SQL DBs!99 is not in the inventory/.test(d)));

    const other = path.join(dir, "other.json");
    writeFileSync(other, JSON.stringify({ resources: [{ ref: "ari:SQL DBs!99" }] }));
    const viaFlag = await runScript(script, ["add-fact", "--ledger", ledger, "--inventory", other, "--strength", "Observed", "--subject", "s", "--claim", "c", "--source-type", "ari-xlsx", "--source-ref", "ari:SQL DBs!99"]);
    assert.equal(viaFlag.code, 0, viaFlag.stderr);
    const notInventory = await runScript(script, ["list", "--ledger", ledger, "--inventory", path.join(dir, "missing.json")]);
    assert.equal(notInventory.code, 0, "list does not need an inventory");
    const missing = await runScript(script, ["validate", "--ledger", ledger, "--inventory", path.join(dir, "missing.json")]);
    assert.equal(missing.code, 2);
});

test("list returns counts and filtered entries, validate returns errors with exit 2", async () => {
    const dir = tmp();
    const ledger = path.join(dir, "ledger.json");
    await runScript(script, [...factFlags, "--ledger", ledger]);
    await runScript(script, ["add-fact", "--ledger", ledger, "--strength", "Unknown", "--subject", "sheet:Overview", "--claim", "Sheet Overview was not assessed", "--source-type", "ari-xlsx"]);
    await runScript(script, ["add-doc", "--ledger", ledger, "--url", "https://example.com", "--title", "t", "--status", "Verified", "--supports", "s", "--tool", "learn-cli"]);

    const all = await runScript(script, ["list", "--ledger", ledger]);
    assert.equal(all.code, 0, all.stderr);
    assert.deepEqual(all.json.counts, { total: 3, fact: 2, doc: 1, region: 0, Observed: 1, Inferred: 0, Unknown: 1 });
    assert.equal(all.json.matched, 3);
    assert.equal(all.json.entries.length, 3);
    const unknown = await runScript(script, ["list", "--ledger", ledger, "--kind", "fact", "--strength", "Unknown"]);
    assert.deepEqual(unknown.json.entries.map((e) => e.id), ["F-0002"]);
    const bySubject = await runScript(script, ["list", "--ledger", ledger, "--subject", "ari:SQL DBs!3"]);
    assert.deepEqual(bySubject.json.entries.map((e) => e.id), ["F-0001"]);
    const limited = await runScript(script, ["list", "--ledger", ledger, "--limit", "1"]);
    assert.equal(limited.json.entries.length, 1);
    assert.equal(limited.json.matched, 3);
    assert.equal((await runScript(script, ["list", "--ledger", ledger, "--limit", "0"])).code, 1);

    const valid = await runScript(script, ["validate", "--ledger", ledger]);
    assert.equal(valid.code, 0, valid.stderr);
    assert.deepEqual(valid.json.errors, []);

    const broken = read(ledger);
    broken.entries[0].strength = "Inferred";
    writeFileSync(ledger, JSON.stringify(broken));
    const invalid = await runScript(script, ["validate", "--ledger", ledger]);
    assert.equal(invalid.code, 2);
    assert.equal(invalid.json.ok, false);
    assert.deepEqual(invalid.json.errors.map((e) => e.path), ["entries[0].basis"]);
    assert.ok(invalid.json.details[0].startsWith("entries[0].basis:"));
});

test("usage problems: no subcommand, an unknown one, no --ledger, bad JSON, a missing ledger for list and validate", async () => {
    const dir = tmp();
    const ledger = path.join(dir, "ledger.json");
    assert.equal((await runScript(script, ["--ledger", ledger])).code, 1);
    assert.equal((await runScript(script, ["frobnicate", "--ledger", ledger])).code, 1);
    assert.equal((await runScript(script, ["constructor", "--ledger", ledger])).code, 1);
    assert.equal((await runScript(script, ["list"])).code, 1);
    const badJson = await runScript(script, [...factFlags.slice(0, -2), "--value", "{nope", "--ledger", ledger]);
    assert.equal(badJson.code, 1);
    assert.match(badJson.json.error, /--value must be JSON/);
    assert.equal((await runScript(script, ["list", "--ledger", ledger])).code, 2);
    assert.equal((await runScript(script, ["validate", "--ledger", ledger])).code, 2);
    assert.equal((await runScript(script, ["--help"])).code, 0);
});
