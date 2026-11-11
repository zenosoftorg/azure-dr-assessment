import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { Ledger, LedgerError } from "../../skills/azure-dr-assessment/scripts/lib/ledger.mjs";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-ledger-"));

const fact = (overrides = {}) => ({
    kind: "fact", strength: "Observed", subject: "ari:SQL DBs!3", claim: "orders-db Zone Redundant is false", property: "Zone Redundant",
    value: false, source: { type: "ari-xlsx", ref: "ari:SQL DBs!3", detail: "column Zone Redundant" }, ...overrides,
});
const doc = (overrides = {}) => ({
    kind: "doc", url: "https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support", title: "Azure services with multiregion support",
    retrievedAt: "2026-11-04T10:00:00.000Z", status: "Verified", supports: "mechanism rows for SQL Database",
    query: "sql database geo-replication nonpaired regions", tool: "microsoft_docs_fetch", ...overrides,
});
const region = (overrides = {}) => ({
    kind: "region", check: "mechanism", subject: "microsoft.sql/servers/databases", status: "Verified", class: "any-pair", doc: "D-0001",
    quote: "SQL Database | Active geo-replication | Yes | Yes", result: { mechanism: "active geo-replication" }, substitute: null, ...overrides,
});

test("ids count per prefix, facts and region entries get recordedAt, and keys come in the contract's order", () => {
    const ledger = Ledger.empty();
    assert.equal(ledger.add(fact()), "F-0001");
    assert.equal(ledger.add(doc()), "D-0001");
    assert.equal(ledger.add(region()), "R-0001");
    assert.equal(ledger.add(fact({ strength: "Inferred", basis: "owner statement", source: { type: "owner" }, subject: "web", claim: "web calls db" })), "F-0002");
    assert.deepEqual(Object.keys(ledger.get("F-0001")), ["id", "kind", "strength", "subject", "claim", "property", "value", "source", "basis", "recordedAt"]);
    assert.deepEqual(Object.keys(ledger.get("F-0001").source), ["type", "ref", "detail"]);
    assert.deepEqual(Object.keys(ledger.get("D-0001")), ["id", "kind", "url", "title", "retrievedAt", "status", "supports", "query", "tool"]);
    assert.deepEqual(Object.keys(ledger.get("R-0001")), ["id", "kind", "check", "subject", "status", "class", "doc", "quote", "result", "substitute", "recordedAt"]);
    assert.match(ledger.get("F-0001").recordedAt, ISO);
    assert.match(ledger.get("R-0001").recordedAt, ISO);
    assert.equal("recordedAt" in ledger.get("D-0001"), false);
    assert.equal(ledger.get("F-0002").basis, "owner statement");
    assert.equal(ledger.get("F-0002").source.ref, null);
    assert.equal(ledger.get("nope"), undefined);
    assert.deepEqual(ledger.counts(), { total: 4, fact: 2, doc: 1, region: 1, Observed: 1, Inferred: 1, Unknown: 0 });
});

test("save writes a stable file and load reads it back; numbering continues from the highest id", async () => {
    const dir = tmp();
    const file = path.join(dir, "evidence", "ledger.json");
    const ledger = Ledger.empty();
    ledger.add(fact());
    ledger.add(doc());
    await ledger.save(file);
    const text = readFileSync(file, "utf8");
    assert.ok(text.startsWith('{\n  "schemaVersion": 1,\n  "entries": [\n'));
    assert.ok(text.endsWith("}\n"));
    const loaded = await Ledger.load(file);
    assert.deepEqual(loaded.entries, ledger.entries);
    assert.equal(loaded.add(fact({ claim: "another" })), "F-0002");

    const gap = path.join(dir, "gap.json");
    writeFileSync(gap, JSON.stringify({ schemaVersion: 1, entries: [{ ...ledger.get("F-0001"), id: "F-0007" }] }));
    assert.equal((await Ledger.load(gap)).add(fact()), "F-0008");
    await loaded.save(file);
    assert.equal(readFileSync(file, "utf8").split('"id": "F-0001"').length, 2, "saving again does not duplicate entries");
});

test("a loaded ledger is rewritten with the canonical key order", async () => {
    const dir = tmp();
    const file = path.join(dir, "ledger.json");
    writeFileSync(file, JSON.stringify({
        schemaVersion: 1,
        entries: [{ recordedAt: "2026-11-04T10:00:00.000Z", basis: null, source: { detail: "d", ref: "r", type: "ari-xlsx" }, value: 1, property: "p", claim: "c", subject: "s", strength: "Observed", kind: "fact", id: "F-0001" }],
    }));
    const ledger = await Ledger.load(file);
    await ledger.save(file);
    const entry = JSON.parse(readFileSync(file, "utf8")).entries[0];
    assert.deepEqual(Object.keys(entry), ["id", "kind", "strength", "subject", "claim", "property", "value", "source", "basis", "recordedAt"]);
    assert.deepEqual(Object.keys(entry.source), ["type", "ref", "detail"]);
});

test("load maps a missing file, invalid JSON and a wrong schema to CliError(INPUT)", async () => {
    const dir = tmp();
    await assert.rejects(() => Ledger.load(path.join(dir, "missing.json")), (e) => e instanceof CliError && e.code === EXIT.INPUT);
    writeFileSync(path.join(dir, "bad.json"), "{ nope");
    await assert.rejects(() => Ledger.load(path.join(dir, "bad.json")), (e) => e.code === EXIT.INPUT && /not valid JSON/.test(e.message));
    writeFileSync(path.join(dir, "v2.json"), JSON.stringify({ schemaVersion: 2, entries: [] }));
    await assert.rejects(() => Ledger.load(path.join(dir, "v2.json")), (e) => e.code === EXIT.INPUT && /not a ledger/.test(e.message));
});

const REJECTED = [
    ["fact: unknown strength", fact({ strength: "Maybe" }), "strength"],
    ["fact: empty subject", fact({ subject: " " }), "subject"],
    ["fact: empty claim", fact({ claim: "" }), "claim"],
    ["fact: Inferred without a basis", fact({ strength: "Inferred", source: { type: "owner" } }), "basis"],
    ["fact: Inferred with an empty basis", fact({ strength: "Inferred", basis: " ", source: { type: "model" } }), "basis"],
    ["fact: Unknown with a value", fact({ strength: "Unknown", value: 3 }), "value"],
    ["fact: Observed from an owner statement", fact({ source: { type: "owner", ref: "x" } }), "source.type"],
    ["fact: Observed from the model", fact({ source: { type: "model", ref: "x" } }), "source.type"],
    ["fact: Unknown from the model", fact({ strength: "Unknown", value: null, source: { type: "model" } }), "source.type"],
    ["fact: unknown source type", fact({ source: { type: "guess", ref: "x" } }), "source.type"],
    ["fact: Observed without a ref", fact({ source: { type: "live" } }), "source.ref"],
    ["fact: no source", fact({ source: null }), "source"],
    ["doc: Verified without retrievedAt", doc({ retrievedAt: null }), "retrievedAt"],
    ["doc: Verified with tool none", doc({ tool: "none" }), "tool"],
    ["doc: unknown tool", doc({ tool: "browser" }), "tool"],
    ["doc: unknown status", doc({ status: "Probably" }), "status"],
    ["doc: Verified without a url", doc({ url: null }), "url"],
    ["doc: empty title", doc({ title: "" }), "title"],
    ["doc: empty supports", doc({ supports: "" }), "supports"],
    ["doc: retrievedAt is not ISO", doc({ retrievedAt: "yesterday" }), "retrievedAt"],
    ["region: unknown check", region({ check: "vibes" }), "check"],
    ["region: empty status", region({ status: "" }), "status"],
    ["region: mechanism without a class", region({ class: null }), "class"],
    ["region: mechanism with a wrong class", region({ class: "global" }), "class"],
    ["region: Verified mechanism without a doc", region({ doc: null }), "doc"],
    ["region: Verified mechanism citing a missing doc", region({ doc: "D-0009" }), "doc"],
    ["region: Verified mechanism without a quote", region({ quote: "" }), "quote"],
    ["region: substitute with an unknown source", region({ substitute: { source: "magic", ref: null, label: "Proposed" } }), "substitute.source"],
    ["region: pattern substitute labelled Unmet requirement", region({ substitute: { source: "pattern", ref: "DR-DNS-001", label: "Unmet requirement" } }), "substitute.label"],
    ["region: unmet substitute labelled Proposed", region({ substitute: { source: "unmet", ref: null, label: "Proposed" } }), "substitute.label"],
];

test("add rejects every entry that breaks a rule of contracts 7.3, names the path, and leaves the ledger unchanged", () => {
    for (const [label, entry, expectedPath] of REJECTED) {
        const ledger = Ledger.empty();
        ledger.add(doc());
        const before = ledger.entries.length;
        assert.throws(
            () => ledger.add(entry),
            (err) => err instanceof LedgerError && err.errors.some((e) => e.path === expectedPath),
            label,
        );
        assert.equal(ledger.entries.length, before, `${label}: nothing was added`);
        assert.equal(ledger.add(fact()), "F-0001", `${label}: the id was not consumed`);
    }
    assert.throws(() => Ledger.empty().add({ kind: "note" }), (err) => err instanceof LedgerError && err.errors[0].path === "kind");
});

test("accepted variations: owner and model facts are Inferred only, Unverified docs may lack a url, substitutes carry their label", () => {
    const ledger = Ledger.empty();
    assert.equal(ledger.add(fact({ strength: "Inferred", basis: "owner statement", source: { type: "owner", detail: "decisions[0]" } })), "F-0001");
    assert.equal(ledger.add(fact({ strength: "Inferred", basis: "role name", source: { type: "model" } })), "F-0002");
    assert.equal(ledger.add(fact({ strength: "Unknown", value: undefined, claim: "Replication of orders-db was not collected", source: { type: "live" } })), "F-0003");
    assert.equal(ledger.get("F-0003").value, null);
    assert.equal(ledger.add(doc({ status: "Unverified", url: null, retrievedAt: null, tool: "none" })), "D-0001");
    assert.equal(ledger.add(doc()), "D-0002");
    assert.equal(ledger.add(region({ doc: "D-0002", substitute: { source: "pattern", ref: "DR-DNS-001", label: "Proposed" } })), "R-0001");
    assert.equal(ledger.add(region({ status: "Unverified", doc: null, quote: null, substitute: { source: "unmet", ref: null, label: "Unmet requirement" } })), "R-0002");
    assert.equal(ledger.add({ kind: "region", check: "pair", subject: "westeurope/swedencentral", status: "Verified" }), "R-0003");
    assert.equal(ledger.get("R-0003").class, null);
    assert.equal(ledger.validate().ok, true);
});

test("an Observed ref must exist in the inventory when one is supplied", () => {
    const ledger = Ledger.empty();
    const refs = new Set(["ari:SQL DBs!3"]);
    assert.equal(ledger.add(fact(), { refs }), "F-0001");
    assert.throws(() => ledger.add(fact({ source: { type: "ari-xlsx", ref: "ari:SQL DBs!99" } }), { refs }), (e) => e.errors[0].path === "source.ref" && /not in the inventory/.test(e.errors[0].message));
    assert.equal(ledger.add(fact({ strength: "Inferred", basis: "x", source: { type: "owner", ref: "anything" } }), { refs }), "F-0002");
    assert.equal(ledger.validate({ inventory: { resources: [{ ref: "ari:SQL DBs!3" }] } }).ok, true);
    const result = ledger.validate({ inventory: { resources: [{ ref: "ari:other!2" }] } });
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((e) => e.path), ["entries[0].source.ref"]);
});

test("validate reports duplicate ids, a prefix that does not match the kind and broken entries with their index", () => {
    const good = Ledger.empty();
    good.add(fact());
    const entry = good.get("F-0001");
    const ledger = new Ledger([
        entry,
        { ...entry },
        { ...entry, id: "D-0001" },
        { ...entry, id: "F-1" },
        { ...entry, id: "F-0002", strength: "Inferred" },
        null,
    ]);
    const { ok, errors } = ledger.validate();
    assert.equal(ok, false);
    const text = errors.map((e) => `${e.path}: ${e.message}`);
    assert.ok(text.includes("entries[1].id: duplicate id F-0001"), text.join("\n"));
    assert.ok(text.some((t) => t.startsWith("entries[2].id: ") && /prefix/.test(t)));
    assert.ok(text.some((t) => t.startsWith("entries[3].id: ") && /F-0001/.test(t)));
    assert.ok(text.includes("entries[4].basis: Inferred needs a basis"), text.join("\n"));
    assert.ok(text.includes("entries[5]: must be an object"));
});
