import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./atomic.mjs";
import { CliError, EXIT } from "./cli.mjs";
import { SLOT_IDS } from "./patterns.mjs";
import { OPTION_KINDS, OPTION_TARGETS, RESERVED_OPTION_ID, SLUG, isEstimate } from "./playbooks.mjs";
import { isSecretValue } from "./secrets.mjs";

const PREFIX = { fact: "F", doc: "D", region: "R" };
const STRENGTHS = ["Observed", "Inferred", "Unknown"];
const SOURCE_TYPES = ["ari-xlsx", "live", "owner", "model"];
const DOC_STATUSES = ["Verified", "Unverified"];
const DOC_TOOLS = ["microsoft_docs_search", "microsoft_docs_fetch", "learn-cli", "none"];
const REGION_CHECKS = ["pair", "geography", "zones", "latency", "mechanism", "fit", "option", "playbook-claim"];
const MECHANISM_CLASSES = ["any-pair", "paired-only", "none"];
const RESIDENCY = ["ok", "crosses", "unknown"];
const ARM_TYPE = /^[a-z0-9.]+\/[a-z0-9./]+$/;
const SUBSTITUTE_LABELS = { pattern: "Proposed", "customer-built": "Proposed", unmet: "Unmet requirement" };
const ID = /^([FDR])-(\d{4})$/;
const DOC_ID = /^D-\d{4}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const filled = (value) => typeof value === "string" && value.trim() !== "";
const orNull = (value) => (value === undefined ? null : value);

/** GC-07: a string anywhere inside `value` that looks like a secret is an error. The message never echoes it. */
function noSecrets(value, at, err) {
    if (typeof value === "string") {
        if (isSecretValue(value)) err(at, "looks like a secret (key, token, password or connection string) and must not be recorded");
    } else if (Array.isArray(value)) {
        value.forEach((item, i) => noSecrets(item, `${at}[${i}]`, err));
    } else if (isObject(value)) {
        for (const [key, item] of Object.entries(value)) noSecrets(item, `${at}.${key}`, err);
    }
}

/** An entry broke a rule of contracts 7.3. `errors` lists each problem with its path inside the entry. */
export class LedgerError extends Error {
    constructor(message, errors) {
        super(message);
        this.name = "LedgerError";
        this.errors = errors;
    }
}

/** The entry with its keys in the order of contracts 7.3 and every optional field present. */
function canonical(e) {
    if (!isObject(e)) return e;
    switch (e.kind) {
        case "fact":
            return {
                id: e.id, kind: "fact", strength: e.strength, subject: e.subject, claim: e.claim, property: orNull(e.property), value: orNull(e.value),
                source: isObject(e.source) ? { type: e.source.type, ref: orNull(e.source.ref), detail: orNull(e.source.detail) } : e.source,
                basis: orNull(e.basis), recordedAt: e.recordedAt,
            };
        case "doc":
            return {
                id: e.id, kind: "doc", url: orNull(e.url), title: e.title, retrievedAt: orNull(e.retrievedAt), status: e.status,
                supports: e.supports, query: orNull(e.query), tool: e.tool,
            };
        case "region":
            return {
                id: e.id, kind: "region", check: e.check, subject: e.subject, status: e.status, class: orNull(e.class), doc: orNull(e.doc),
                quote: orNull(e.quote), result: orNull(e.result),
                substitute: isObject(e.substitute) ? { source: e.substitute.source, ref: orNull(e.substitute.ref), label: e.substitute.label } : orNull(e.substitute),
                recordedAt: e.recordedAt,
            };
        default:
            return e;
    }
}

function validateFact(e, refs, err) {
    if (!STRENGTHS.includes(e.strength)) err("strength", "must be Observed, Inferred or Unknown");
    if (!filled(e.subject)) err("subject", "must be a non-empty string");
    if (!filled(e.claim)) err("claim", "must be a non-empty string");
    if (!ISO.test(e.recordedAt ?? "")) err("recordedAt", "must be an ISO 8601 UTC timestamp");
    if (!isObject(e.source)) {
        err("source", "must be an object with a type");
    } else {
        const { type, ref } = e.source;
        if (!SOURCE_TYPES.includes(type)) err("source.type", `must be one of ${SOURCE_TYPES.join(", ")}`);
        else if (e.strength === "Observed" && type !== "ari-xlsx" && type !== "live") err("source.type", "Observed needs an ari-xlsx or live source");
        else if (e.strength !== "Inferred" && (type === "owner" || type === "model")) err("source.type", "owner and model sources are valid only with Inferred");
        if (e.strength === "Observed") {
            if (!filled(ref)) err("source.ref", "Observed needs the ref of the resource it was read from");
            else if (refs && !refs.has(ref)) err("source.ref", `${ref} is not in the inventory`);
        }
    }
    if (e.strength === "Inferred" && !filled(e.basis)) err("basis", "Inferred needs a basis");
    if (e.strength === "Unknown" && e.value !== null) err("value", "Unknown needs value: null");
    for (const field of ["subject", "claim", "property", "value", "basis"]) noSecrets(e[field], field, err);
    if (isObject(e.source)) for (const field of ["ref", "detail"]) noSecrets(e.source[field], `source.${field}`, err);
}

function validateDoc(e, err) {
    if (!filled(e.title)) err("title", "must be a non-empty string");
    if (!filled(e.supports)) err("supports", "must be a non-empty string");
    if (!DOC_STATUSES.includes(e.status)) err("status", "must be Verified or Unverified");
    if (!DOC_TOOLS.includes(e.tool)) err("tool", `must be one of ${DOC_TOOLS.join(", ")}`);
    if (e.url === null || e.url === undefined) {
        if (e.status !== "Unverified") err("url", "is required unless status is Unverified");
    } else if (!filled(e.url)) {
        err("url", "must be a non-empty string or null");
    }
    if (e.retrievedAt !== null && e.retrievedAt !== undefined && !ISO.test(e.retrievedAt)) err("retrievedAt", "must be an ISO 8601 UTC timestamp");
    if (e.status === "Verified") {
        if (!filled(e.retrievedAt)) err("retrievedAt", "Verified needs retrievedAt");
        if (e.tool === "none") err("tool", "Verified needs a tool other than none");
    }
    for (const field of ["url", "title", "supports", "query"]) noSecrets(e[field], field, err);
}

/** A Verified entry of these checks cites a doc entry of this ledger. */
function needsDoc(e, hasDoc, err) {
    if (!DOC_ID.test(e.doc ?? "")) err("doc", `a Verified ${e.check} entry needs a D- id`);
    else if (!hasDoc(e.doc)) err("doc", `${e.doc} is not a doc entry of this ledger`);
}

/** v3 contracts 6.1: the fields that dr-options reads from a pair or geography result are checked when present. */
function validateFixedResult(e, err) {
    if (e.result === null || e.result === undefined) return;
    if (!isObject(e.result)) {
        err("result", `a ${e.check} result must be a JSON object`);
        return;
    }
    const r = e.result;
    const has = (key) => Object.hasOwn(r, key);
    const stringOrNull = (key) => {
        if (has(key) && r[key] !== null && typeof r[key] !== "string") err(`result.${key}`, "must be an ARM region name or null");
    };
    if (e.check === "pair") {
        if (has("paired") && typeof r.paired !== "boolean") err("result.paired", "must be true or false: whether the DR region is the primary's pair");
        stringOrNull("primaryPair");
        stringOrNull("drPair");
    } else {
        if (has("region") && !filled(r.region)) err("result.region", "must be an ARM region name");
        if (has("geography") && !filled(r.geography)) err("result.geography", "must be the geography's display name");
        if (has("residency") && !RESIDENCY.includes(r.residency)) err("result.residency", `must be one of ${RESIDENCY.join(", ")}`);
    }
}

/** v3 contracts 6.4: an option derived from Learn for a type without a playbook, and a playbook constraint checked against Learn. */
function validateV3Check(e, hasDoc, err) {
    if (!ARM_TYPE.test(e.subject ?? "")) err("subject", `a ${e.check} entry is about an ARM type such as microsoft.keyvault/vaults`);
    if (e.status !== "Verified" && e.status !== "Unverified") err("status", `a ${e.check} entry is Verified or Unverified`);
    if (e.class !== null && e.class !== undefined) err("class", `a ${e.check} entry has no class`);
    if (e.substitute !== null && e.substitute !== undefined) err("substitute", `a ${e.check} entry has no substitute`);
    if (e.status === "Verified") {
        needsDoc(e, hasDoc, err);
        if (e.check === "playbook-claim" && !filled(e.quote)) err("quote", "a Verified playbook-claim entry needs the quoted Learn text");
    }
    if (!isObject(e.result)) {
        err("result", e.check === "option"
            ? "an option entry needs a result { id, title, kind, target, usesMechanism, rpo, rto, slot, givesUp }"
            : "a playbook-claim entry needs a result { playbook, claim, agrees }");
        return;
    }
    const r = e.result;
    if (e.check === "option") {
        if (typeof r.id !== "string" || !SLUG.test(r.id)) err("result.id", "must be a kebab-case option id");
        else if (r.id === RESERVED_OPTION_ID) err("result.id", `${RESERVED_OPTION_ID} is reserved: every type gets it without an entry`);
        for (const key of ["title", "givesUp"]) if (!filled(r[key])) err(`result.${key}`, "must be a non-empty string");
        if (!OPTION_KINDS.includes(r.kind)) err("result.kind", `must be one of ${OPTION_KINDS.join(", ")}`);
        if (!OPTION_TARGETS.includes(r.target)) err("result.target", `must be one of ${OPTION_TARGETS.join(", ")}`);
        if (typeof r.usesMechanism !== "string") err("result.usesMechanism", "must be a mechanism name or none");
        for (const key of ["rpo", "rto"]) if (!isEstimate(r[key])) err(`result.${key}`, "must start with a duration such as 15m or with unknown");
        if (!SLOT_IDS.includes(r.slot)) err("result.slot", "must be a slot id (see patterns/README.md)");
    } else {
        if (typeof r.playbook !== "string" || !SLUG.test(r.playbook)) err("result.playbook", "must be the service of a playbook, such as key-vault");
        if (!filled(r.claim)) err("result.claim", "must be the heading of a constraint of the playbook");
        if (typeof r.agrees !== "boolean") err("result.agrees", "must be true or false: whether Learn agrees with the constraint");
    }
}

function validateRegion(e, hasDoc, err) {
    if (!REGION_CHECKS.includes(e.check)) err("check", `must be one of ${REGION_CHECKS.join(", ")}`);
    if (!filled(e.subject)) err("subject", "must be a non-empty string");
    if (!filled(e.status)) err("status", "must be a non-empty string");
    if (!ISO.test(e.recordedAt ?? "")) err("recordedAt", "must be an ISO 8601 UTC timestamp");
    if (e.check === "mechanism") {
        if (!MECHANISM_CLASSES.includes(e.class)) err("class", `a mechanism entry needs a class: ${MECHANISM_CLASSES.join(", ")}`);
        if (e.status === "Verified") {
            needsDoc(e, hasDoc, err);
            if (!filled(e.quote)) err("quote", "a Verified mechanism entry needs the quoted row");
        }
    }
    if (e.check === "pair" || e.check === "geography") validateFixedResult(e, err);
    if (e.check === "option" || e.check === "playbook-claim") validateV3Check(e, hasDoc, err);
    if (e.substitute !== null && e.substitute !== undefined) {
        const s = e.substitute;
        if (!isObject(s)) {
            err("substitute", "must be an object or null");
        } else {
            if (!Object.hasOwn(SUBSTITUTE_LABELS, s.source)) err("substitute.source", "must be pattern, customer-built or unmet");
            else if (s.label !== SUBSTITUTE_LABELS[s.source]) err("substitute.label", `must be ${SUBSTITUTE_LABELS[s.source]} for source ${s.source}`);
            if (s.ref !== null && s.ref !== undefined && !filled(s.ref)) err("substitute.ref", "must be a string or null");
            noSecrets(s.ref, "substitute.ref", err);
        }
    }
    for (const field of ["subject", "quote", "result"]) noSecrets(e[field], field, err);
}

function validateEntry(e, { refs, hasDoc }) {
    const errors = [];
    const err = (field, message) => errors.push({ path: field, message });
    if (e.kind === "fact") validateFact(e, refs, err);
    else if (e.kind === "doc") validateDoc(e, err);
    else if (e.kind === "region") validateRegion(e, hasDoc, err);
    else err("kind", "must be fact, doc or region");
    return errors;
}

export class Ledger {
    constructor(entries = []) {
        this.entries = entries;
        this.next = { F: 1, D: 1, R: 1 };
        for (const entry of entries) {
            const match = ID.exec(entry?.id ?? "");
            if (match) this.next[match[1]] = Math.max(this.next[match[1]], Number(match[2]) + 1);
        }
    }

    static empty() {
        return new Ledger();
    }

    static async load(file) {
        let raw;
        try {
            raw = await readFile(file, "utf8");
        } catch (err) {
            throw new CliError(EXIT.INPUT, `cannot read ${file}`, [err.message]);
        }
        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            throw new CliError(EXIT.INPUT, `${file} is not valid JSON`, [err.message]);
        }
        if (!isObject(data) || data.schemaVersion !== 1 || !Array.isArray(data.entries)) {
            throw new CliError(EXIT.INPUT, `${file} is not a ledger`, ['expected { "schemaVersion": 1, "entries": [...] }']);
        }
        return new Ledger(data.entries);
    }

    get(id) {
        return this.entries.find((entry) => entry?.id === id);
    }

    /** Allocate the next id for the entry's kind, validate the entry and append it. Returns the id. */
    add(input, { refs = null } = {}) {
        const prefix = PREFIX[input?.kind];
        if (!prefix) throw new LedgerError("invalid ledger entry", [{ path: "kind", message: "must be fact, doc or region" }]);
        const id = `${prefix}-${String(this.next[prefix]).padStart(4, "0")}`;
        const entry = canonical({ ...input, id, ...(input.kind === "doc" ? {} : { recordedAt: new Date().toISOString() }) });
        const errors = validateEntry(entry, { refs, hasDoc: (docId) => this.get(docId)?.kind === "doc" });
        if (errors.length > 0) throw new LedgerError("invalid ledger entry", errors);
        this.next[prefix]++;
        this.entries.push(entry);
        return id;
    }

    async save(file) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFileAtomic(file, `${JSON.stringify({ schemaVersion: 1, entries: this.entries.map(canonical) }, null, 2)}\n`);
    }

    /** Check every entry. With an inventory, Observed refs must exist in it. */
    validate({ inventory = null } = {}) {
        const refs = inventory ? new Set(inventory.resources.map((resource) => resource.ref)) : null;
        const docIds = new Set(this.entries.filter((entry) => entry?.kind === "doc").map((entry) => entry.id));
        const errors = [];
        const seen = new Set();
        this.entries.forEach((entry, i) => {
            const base = `entries[${i}]`;
            if (!isObject(entry)) {
                errors.push({ path: base, message: "must be an object" });
                return;
            }
            const match = ID.exec(entry.id ?? "");
            if (!match) {
                errors.push({ path: `${base}.id`, message: `${JSON.stringify(entry.id)} must look like F-0001, D-0001 or R-0001` });
            } else {
                if (match[1] !== PREFIX[entry.kind]) errors.push({ path: `${base}.id`, message: `prefix ${match[1]} does not match kind ${entry.kind}` });
                if (seen.has(entry.id)) errors.push({ path: `${base}.id`, message: `duplicate id ${entry.id}` });
                seen.add(entry.id);
            }
            for (const problem of validateEntry(entry, { refs, hasDoc: (id) => docIds.has(id) })) {
                errors.push({ path: `${base}.${problem.path}`, message: problem.message });
            }
        });
        return { ok: errors.length === 0, errors };
    }

    counts() {
        const counts = { total: this.entries.length, fact: 0, doc: 0, region: 0, Observed: 0, Inferred: 0, Unknown: 0 };
        for (const entry of this.entries) {
            if (Object.hasOwn(PREFIX, entry?.kind)) counts[entry.kind]++;
            if (entry?.kind === "fact" && STRENGTHS.includes(entry.strength)) counts[entry.strength]++;
        }
        return counts;
    }
}
