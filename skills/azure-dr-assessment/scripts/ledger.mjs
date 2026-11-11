import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CliError, EXIT, runCli } from "./lib/cli.mjs";
import { Ledger, LedgerError } from "./lib/ledger.mjs";
import { isInsideSkillOrPlugin } from "./lib/paths.mjs";

const spec = {
    ledger: { type: "string", required: true, help: "Path to evidence/ledger.json (add-* creates it when absent)" },
    inventory: { type: "string", help: "inventory.json that Observed refs are checked against (default: inventory.json beside the ledger, when it exists)" },
    strength: { type: "string", help: "add-fact: Observed, Inferred or Unknown. list: only facts of this strength" },
    subject: { type: "string", help: "add-fact, add-region: what the entry is about. list: only entries with exactly this subject" },
    claim: { type: "string", help: "add-fact: the claim, in one sentence" },
    property: { type: "string", help: "add-fact: the property the claim is about" },
    value: { type: "string", help: "add-fact: the value, as JSON (false, 3, \"text\", {\"a\":1})" },
    "source-type": { type: "string", help: "add-fact: ari-xlsx, live, owner or model" },
    "source-ref": { type: "string", help: "add-fact: the resource ref, for example ari:SQL DBs!3" },
    "source-detail": { type: "string", help: "add-fact: where in the source, for example column Zone Redundant" },
    basis: { type: "string", help: "add-fact: why an Inferred fact holds" },
    url: { type: "string", help: "add-doc: the documentation URL" },
    title: { type: "string", help: "add-doc: the page title" },
    status: { type: "string", help: "add-doc: Verified or Unverified. add-region: Verified, Unverified and so on" },
    supports: { type: "string", help: "add-doc: what the page supports" },
    query: { type: "string", help: "add-doc: the search query used" },
    tool: { type: "string", help: "add-doc: microsoft_docs_search, microsoft_docs_fetch, learn-cli or none" },
    "retrieved-at": { type: "string", help: "add-doc: ISO 8601 UTC time of retrieval (default: now, for Verified)" },
    check: { type: "string", help: "add-region: pair, geography, zones, latency, mechanism, fit, option or playbook-claim" },
    class: { type: "string", help: "add-region: any-pair, paired-only or none (mechanism checks)" },
    doc: { type: "string", help: "add-region: the D- id of the documentation entry" },
    quote: { type: "string", help: "add-region: the quoted documentation row" },
    result: { type: "string", help: "add-region: the result, as JSON (pair: paired, primaryPair, drPair; geography: region, geography, residency; option: id, title, kind, target, usesMechanism, rpo, rto, slot, givesUp; playbook-claim: playbook, claim, agrees)" },
    "substitute-source": { type: "string", help: "add-region: pattern, customer-built or unmet" },
    "substitute-ref": { type: "string", help: "add-region: the pattern id or reference of the substitute" },
    kind: { type: "string", help: "list: only entries of this kind (fact, doc or region)" },
    limit: { type: "string", help: "list: at most this many entries (default 100)" },
};

function jsonFlag(values, name) {
    if (values[name] === undefined) return undefined;
    try {
        return JSON.parse(values[name]);
    } catch {
        throw new CliError(EXIT.USAGE, `--${name} must be JSON`, [`got ${values[name]}; quote strings, for example '"text"'`]);
    }
}

async function inventoryFor(values, ledgerFile) {
    const explicit = values.inventory ? path.resolve(values.inventory) : null;
    const file = explicit ?? path.join(path.dirname(ledgerFile), "inventory.json");
    if (!explicit && !existsSync(file)) return null;
    let inventory;
    try {
        inventory = JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
        throw new CliError(EXIT.INPUT, `cannot read ${file}`, [err.message]);
    }
    if (!Array.isArray(inventory?.resources)) throw new CliError(EXIT.INPUT, `${file} is not an inventory`, ["expected a resources array"]);
    return inventory;
}

async function openExisting(values) {
    const file = path.resolve(values.ledger);
    return { file, ledger: await Ledger.load(file) };
}

async function append(values, entry) {
    const file = path.resolve(values.ledger);
    if (isInsideSkillOrPlugin(path.dirname(file))) {
        throw new CliError(EXIT.REFUSED, "--ledger is inside the skill or plugin directory", [`${file} would hold customer data`, "keep the ledger below the assessment output root"]);
    }
    const ledger = existsSync(file) ? await Ledger.load(file) : Ledger.empty();
    const inventory = await inventoryFor(values, file);
    let id;
    try {
        id = ledger.add(entry, { refs: inventory ? new Set(inventory.resources.map((resource) => resource.ref)) : null });
    } catch (err) {
        if (err instanceof LedgerError) throw new CliError(EXIT.USAGE, "invalid ledger entry", err.errors.map((e) => `${e.path}: ${e.message}`));
        throw err;
    }
    await ledger.save(file);
    return { id };
}

const commands = {
    "add-fact": (values) =>
        append(values, {
            kind: "fact", strength: values.strength, subject: values.subject, claim: values.claim, property: values.property ?? null,
            value: jsonFlag(values, "value") ?? null,
            source: { type: values["source-type"], ref: values["source-ref"] ?? null, detail: values["source-detail"] ?? null },
            basis: values.basis ?? null,
        }),
    "add-doc": (values) =>
        append(values, {
            kind: "doc", url: values.url ?? null, title: values.title, status: values.status, supports: values.supports, query: values.query ?? null,
            tool: values.tool, retrievedAt: values["retrieved-at"] ?? (values.status === "Verified" ? new Date().toISOString() : null),
        }),
    "add-region": (values) =>
        append(values, {
            kind: "region", check: values.check, subject: values.subject, status: values.status, class: values.class ?? null, doc: values.doc ?? null,
            quote: values.quote ?? null, result: jsonFlag(values, "result") ?? null,
            substitute: values["substitute-source"]
                ? { source: values["substitute-source"], ref: values["substitute-ref"] ?? null, label: values["substitute-source"] === "unmet" ? "Unmet requirement" : "Proposed" }
                : null,
        }),
    async list(values) {
        const limit = values.limit === undefined ? 100 : Number(values.limit);
        if (!Number.isInteger(limit) || limit < 1) throw new CliError(EXIT.USAGE, "--limit must be a whole number of at least 1");
        const { ledger } = await openExisting(values);
        const matches = ledger.entries.filter(
            (entry) =>
                (!values.kind || entry.kind === values.kind) &&
                (!values.strength || entry.strength === values.strength) &&
                (!values.subject || entry.subject === values.subject),
        );
        return { counts: ledger.counts(), matched: matches.length, entries: matches.slice(0, limit) };
    },
    async validate(values) {
        const { file, ledger } = await openExisting(values);
        const { ok, errors } = ledger.validate({ inventory: await inventoryFor(values, file) });
        if (!ok) {
            throw new CliError(EXIT.INPUT, `${file} has ${errors.length} problem(s)`, errors.map((e) => `${e.path}: ${e.message}`), { errors });
        }
        return { errors: [] };
    },
};

await runCli({
    name: "ledger",
    description: "Allocate evidence ledger ids and validate ledger entries. Subcommands: add-fact, add-doc, add-region, list, validate",
    spec,
    main(values, positionals) {
        const [command, ...extra] = positionals;
        if (!Object.hasOwn(commands, command ?? "") || extra.length > 0) {
            throw new CliError(EXIT.USAGE, `expected one subcommand: ${Object.keys(commands).join(", ")}`);
        }
        return commands[command](values);
    },
});
