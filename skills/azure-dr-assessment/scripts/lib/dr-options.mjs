import { isDefaultChoice, parseDuration } from "./assessment.mjs";
import { CliError, EXIT } from "./cli.mjs";
import { PLAYBOOK_STALE_AFTER_DAYS } from "./playbook-lint.mjs";
import { OPTION_KINDS, RESERVED_OPTION_ID, estimateSeconds } from "./playbooks.mjs";
import { isSecretValue } from "./secrets.mjs";
import { formatSeconds } from "./tiers.mjs";
import { KNOWN_SHORTS, typeTitle } from "./type-names.mjs";

/**
 * Classification of the in-scope types for the DR options interview (v3 contracts 6.2). Every function here is pure:
 * the ledger entries, the playbooks, the regions and the date are passed in, nothing is read from disk or the clock.
 */

export const DR_PATHS = ["native", "workaround", "split-region", "backup-restore", "none"];
/** GC-12 as amended: the set DR path. */
export const PATH_LABELS = { native: "Native", workaround: "Workaround", "split-region": "Split-region", "backup-restore": "Backup-restore", none: "No path" };
export const RESIDENCY = ["ok", "crosses", "unknown"];
export const ACCEPT_GAP_TITLE = "Accept the gap and record it as an exception";
export const VETO_DR_REGION = "the mechanism does not reach the DR region";
export const VETO_NO_MULTIREGION = "the mechanism has no multiregion replication";
const CLASS_LABELS = { "any-pair": "Any-pair", "paired-only": "Paired-only", none: "No built-in multiregion" };
const CLASS_CLAIMS = { "any-pair": [true, true], "paired-only": [true, false], none: [false, false] };
const DAY_MS = 86_400_000;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const yesNo = (v) => (v === true ? "yes" : v === false ? "no" : "missing");
const regionEntries = (entries, check) => entries.filter((e) => e?.kind === "region" && e.check === check);
const forType = (entries, check, type) => regionEntries(entries, check).filter((e) => sameSubject(e.subject, type) && isObject(e.result));
const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
/** ARM types and region names are case-insensitive in Azure: ledger subjects are compared in lower case. */
const sameSubject = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/**
 * The pair facts of contracts 6.1 for primary|dr, from the last pair entry with that subject. `paired` is true only
 * when that entry is Verified and says so: pairing is never assumed.
 */
export function pairFacts(entries, primary, dr) {
    const entry = regionEntries(entries, "pair").filter((e) => sameSubject(e.subject, `${primary}|${dr}`)).at(-1) ?? null;
    const result = isObject(entry?.result) ? entry.result : {};
    return {
        regions: {
            primary,
            dr,
            primaryPair: typeof result.primaryPair === "string" && result.primaryPair !== "" ? result.primaryPair : null,
            paired: entry?.status === "Verified" && result.paired === true,
        },
        ledger: entry ? entry.id : null,
    };
}

/** The residency reading of a target region: ok without a residency constraint, else from its last geography entry. */
export function residencyOf(entries, region, dataResidency) {
    if (region === null || region === undefined) return "unknown";
    if (dataResidency === null || dataResidency === undefined) return "ok";
    const entry = regionEntries(entries, "geography").filter((e) => sameSubject(e.subject, region)).at(-1);
    const residency = isObject(entry?.result) ? entry.result.residency : undefined;
    return RESIDENCY.includes(residency) ? residency : "unknown";
}

/** The Verified mechanism entry of this name for the type that the classification uses: the last one recorded. */
function verifiedMechanism(entries, type, name) {
    return forType(entries, "mechanism", type).filter((e) => e.status === "Verified" && sameName(e.result.mechanism, name)).at(-1) ?? null;
}

/**
 * One warning per mechanism or playbook-claim entry of the type that the playbook cannot use: a mechanism entry that
 * names no mechanism of the playbook, a claim of another playbook, or a claim that is no constraint heading of it.
 * Such an entry matches nothing in the classification, so it would otherwise go unseen.
 */
function unmatchedEntryWarnings({ type, playbook, entries }) {
    if (!playbook) return [];
    const label = `playbook ${playbook.service} v${playbook.version}`;
    const warnings = [];
    for (const entry of regionEntries(entries, "mechanism")) {
        if (!sameSubject(entry.subject, type) || !["Verified", "Unverified"].includes(entry.status)) continue;
        const name = isObject(entry.result) ? entry.result.mechanism : undefined;
        if (!playbook.mechanisms.some((m) => sameName(m.name, name))) {
            warnings.push(`ledger entry ${entry.id} is a mechanism of ${type} that names no mechanism of ${label}`);
        }
    }
    for (const entry of regionEntries(entries, "playbook-claim")) {
        if (!sameSubject(entry.subject, type) || !isObject(entry.result)) continue;
        if (entry.result.playbook !== playbook.service) {
            warnings.push(`ledger entry ${entry.id} is a playbook-claim of ${type} that names playbook ${entry.result.playbook}, not ${playbook.service} v${playbook.version}`);
        } else if (!playbook.constraints.some((c) => c.heading === entry.result.claim)) {
            warnings.push(`ledger entry ${entry.id} is a playbook-claim of ${type} that names no constraint of ${label}`);
        }
    }
    return warnings;
}

/** The playbook claims that Learn, read in this run, contradicts (contracts 6.2.1). */
export function staleClaims({ type, playbook, entries }) {
    if (!playbook) return [];
    const stale = [];
    for (const mechanism of playbook.mechanisms) {
        const entry = verifiedMechanism(entries, type, mechanism.name);
        const claims = entry ? CLASS_CLAIMS[entry.class] : undefined;
        if (claims && (claims[0] !== mechanism.paired || claims[1] !== mechanism.nonpaired)) {
            stale.push({
                kind: "mechanism",
                claim: mechanism.name,
                playbookSays: `Paired: ${yesNo(mechanism.paired)}, Nonpaired: ${yesNo(mechanism.nonpaired)}`,
                learnSays: CLASS_LABELS[entry.class],
                ledger: [entry.id],
            });
        }
    }
    const claims = forType(entries, "playbook-claim", type).filter((e) => e.status === "Verified" && e.result.playbook === playbook.service);
    for (const constraint of playbook.constraints) {
        const entry = claims.filter((e) => e.result.claim === constraint.heading).at(-1);
        if (entry && entry.result.agrees === false) {
            stale.push({ kind: "constraint", claim: constraint.heading, playbookSays: constraint.text, learnSays: entry.quote ?? "", ledger: [entry.id] });
        }
    }
    return stale;
}

/**
 * The status of one option against the ledger (contracts 6.2.1): `valid` or `unverified`, the reason it is vetoed
 * (or null) and the ledger ids it rests on. `option` is a playbook option, or a Learn-derived one with `ledger` set.
 */
export function optionStatus(option, { type, playbook = null, entries, paired }) {
    if (option.id === RESERVED_OPTION_ID) return { status: "valid", vetoed: null, ledger: [] };
    if (option.source === "learn") return { status: option.entryStatus === "Verified" ? "valid" : "unverified", vetoed: null, ledger: option.ledger };
    if (sameName(option.usesMechanism, "none")) {
        const claims = forType(entries, "playbook-claim", type).filter((e) => e.result.playbook === playbook?.service);
        const verified = (playbook?.constraints ?? []).every((c) => claims.some((e) => e.status === "Verified" && e.result.claim === c.heading));
        return { status: verified ? "valid" : "unverified", vetoed: null, ledger: claims.map((e) => e.id) };
    }
    const ledger = forType(entries, "mechanism", type).filter((e) => sameName(e.result.mechanism, option.usesMechanism)).map((e) => e.id);
    const entry = verifiedMechanism(entries, type, option.usesMechanism);
    if (!entry) return { status: "unverified", vetoed: null, ledger };
    if (entry.class === "none") {
        return { status: "valid", vetoed: option.target === "pair-region" ? VETO_NO_MULTIREGION : VETO_DR_REGION, ledger };
    }
    if (option.target === "dr-region" && entry.class === "paired-only" && !paired) return { status: "valid", vetoed: VETO_DR_REGION, ledger };
    return { status: "valid", vetoed: null, ledger };
}

/**
 * The Learn-derived options of a type without a playbook: its option entries, by kind and then in the order of each
 * id's first entry. The last entry of an id decides its values (a correction is a new entry); `ledger` lists them all.
 */
function learnOptions(entries, type) {
    const byId = new Map();
    for (const entry of forType(entries, "option", type)) {
        const r = entry.result;
        if (typeof r.id !== "string") continue;
        const ledger = [...(byId.get(r.id)?.ledger ?? []), entry.id];
        byId.set(r.id, {
            id: r.id, title: r.title, kind: r.kind, target: r.target, usesMechanism: r.usesMechanism, rpo: r.rpo, rto: r.rto,
            rpoSeconds: estimateSeconds(r.rpo), rtoSeconds: estimateSeconds(r.rto), givesUp: r.givesUp, slot: r.slot,
            source: "learn", entryStatus: entry.status, ledger,
        });
    }
    const options = [...byId.values()];
    const rank = (o) => (OPTION_KINDS.includes(o.kind) ? OPTION_KINDS.indexOf(o.kind) : OPTION_KINDS.length);
    return options.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map(({ o }) => o);
}

/**
 * One row of evidence/dr-options.json for an ARM type (contracts 6.2), in its key order. `short`, `recommended`,
 * `recommendationNote` and `choice` are null, `ask` is false and every option's `meetsTier` is false: shortNames,
 * recommend and finishRows fill them.
 */
export function classifyType({ type, count, playbook = null, entries = [], regions, dataResidency = null, decidedBy = null, decidedSlots = {}, today }) {
    const candidates = playbook
        ? playbook.options.map((o) => ({ ...o, source: "playbook" }))
        : learnOptions(entries, type);
    const options = [];
    const vetoed = [];
    for (const option of candidates) {
        const { status, vetoed: mechanismVeto, ledger } = optionStatus(option, { type, playbook, entries, paired: regions.paired });
        const ruled = (option.decidesSlots ?? []).find((slot) => decidedSlots[slot]);
        const reason = mechanismVeto ?? (ruled ? `${decidedSlots[ruled].ref} decides the slot ${ruled}, which this option would decide too` : null);
        if (reason) {
            vetoed.push({ id: option.id, reason, ledger });
            continue;
        }
        const targetRegion = option.target === "pair-region" ? regions.primaryPair : regions.dr;
        options.push({
            id: option.id, title: option.title, kind: option.kind, target: option.target, targetRegion, rpo: option.rpo, rto: option.rto,
            rpoSeconds: option.rpoSeconds, rtoSeconds: option.rtoSeconds, source: option.source, status, meetsTier: false,
            residency: residencyOf(entries, targetRegion, dataResidency), givesUp: option.givesUp, ledger,
        });
    }
    options.push({
        id: RESERVED_OPTION_ID, title: ACCEPT_GAP_TITLE, kind: RESERVED_OPTION_ID, target: null, targetRegion: null, rpo: null, rto: null,
        rpoSeconds: null, rtoSeconds: null, source: "rule", status: "valid", meetsTier: false, residency: "ok", givesUp: "DR for this service", ledger: [],
    });
    const first = options[0];
    const age = playbook ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${playbook.verifiedOn}T00:00:00Z`)) / DAY_MS) : 0;
    return {
        type,
        short: null,
        title: playbook ? playbook.title : typeTitle(type),
        count,
        slot: playbook ? playbook.slot : (candidates[0]?.slot ?? null),
        playbook: playbook ? `${playbook.service} v${playbook.version}` : null,
        verifiedOn: playbook ? playbook.verifiedOn : null,
        playbookStale: age > PLAYBOOK_STALE_AFTER_DAYS,
        decidedBy,
        path: first.id === RESERVED_OPTION_ID ? "none" : first.kind,
        verified: first.status === "valid",
        staleClaims: staleClaims({ type, playbook, entries }),
        options,
        vetoed,
        recommended: null,
        recommendationNote: null,
        ask: false,
        choice: null,
    };
}

/**
 * Who decides a type's slot before the interview (contracts 6.2 `decidedBy`), from the slot row that resolveSlots
 * proposes: a pattern, an override with an alternative, or a pattern collision (which the owner resolves in the pack or
 * in decisions, not in the interview). Null for a `learn` candidate and an override without an alternative (D28).
 */
export function deciderOf(slotRow) {
    const c = isObject(slotRow?.candidate) ? slotRow.candidate : {};
    if (c.source === "pattern") return { source: "pattern", ref: `${c.pattern} v${c.version}` };
    if (c.source === "override" && typeof c.alternative === "string" && c.alternative.trim() !== "") {
        return { source: "override", ref: `Override #${c.overrideIndex} of ${c.pattern}` };
    }
    if (c.source === "collision") return { source: "collision", ref: (Array.isArray(slotRow.collision) ? slotRow.collision : []).join(" and ") };
    return null;
}

/**
 * The RPO and RTO maxima an option must meet (contracts 6.2.2): the tier band's maximum from tierBands(pack), or the
 * owner's objectives.rpo and rto when stricter; null accepts any duration. Tier 0 has no numeric band: it is testable
 * only with both owner targets.
 */
export function tierLimits({ tier, bands, objectives = {} }) {
    const band = bands.find((b) => b.tier === tier);
    if (!band) throw new TypeError(`tierLimits: no tier band for tier ${tier}`);
    const own = (metric) => parseDuration(objectives[metric] ?? null);
    const stricter = (max, owner) => (owner !== null && (max === null || owner < max) ? owner : max);
    if (tier === 0) return { tier, maxRpo: own("rpo"), maxRto: own("rto"), testable: own("rpo") !== null && own("rto") !== null };
    return { tier, maxRpo: stricter(band.rpo.maxSeconds, own("rpo")), maxRto: stricter(band.rto.maxSeconds, own("rto")), testable: true };
}

/** Whether an option meets the tier: valid, both estimates numeric, each within its maximum. accept-gap never does. */
export function meetsTier(option, limits) {
    if (option.id === RESERVED_OPTION_ID || !limits.testable || option.status !== "valid") return false;
    const within = (seconds, max) => typeof seconds === "number" && (max === null || seconds <= max);
    return within(option.rpoSeconds, limits.maxRpo) && within(option.rtoSeconds, limits.maxRto);
}

/**
 * The recommendation rule of contracts 6.2.2. Returns the row with `meetsTier` set on every option, `recommended`
 * (an option id) and `recommendationNote`. The options are already in rank order and without the vetoed ones.
 */
export function recommend(row, limits) {
    const options = row.options.map((o) => ({ ...o, meetsTier: meetsTier(o, limits) }));
    const candidates = options.filter((o) => o.id !== RESERVED_OPTION_ID);
    const fits = candidates.find((o) => o.meetsTier && o.residency === "ok");
    if (fits) return { ...row, options, recommended: fits.id, recommendationNote: `meets Tier ${limits.tier}` };
    const best = candidates.find((o) => o.residency === "ok");
    if (best) {
        let note = `does not meet Tier ${limits.tier}${best.status === "unverified" ? " (Unverified)" : ""}`;
        if (!limits.testable) note = "near zero cannot be tested";
        return { ...row, options, recommended: best.id, recommendationNote: note };
    }
    return { ...row, options, recommended: RESERVED_OPTION_ID, recommendationNote: `does not meet Tier ${limits.tier}` };
}

/**
 * The short name of every row, in row order (contracts 6.2): the initials of the title's words without a leading
 * "Azure", or the first two letters of a one-word title, upper case; a type with a well-known abbreviation (VNET, NIC,
 * NSG) takes that instead. A clash appends 2, 3 and so on.
 */
export function shortNames(rows) {
    const used = new Map();
    return rows.map((row) => {
        let words = String(row.title ?? "").split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, "")).filter(Boolean);
        if (words.length > 1 && words[0].toLowerCase() === "azure") words = words.slice(1);
        const base = KNOWN_SHORTS[row.type] ?? ((words.length === 1 ? words[0].slice(0, 2) : words.map((w) => w[0]).join("")).toUpperCase() || "X");
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        return n === 1 ? base : `${base}${n}`;
    });
}

const sentence = (text) => String(text ?? "").trim().replace(/\.+$/, "");
const estimate = (seconds) => (typeof seconds === "number" ? formatSeconds(seconds) : "unknown");

const optionIds = (row) => row.options.map((o) => o.id);

/** An asked row whose only option is accept-gap: nothing to choose, so it is listed instead of asked. */
const isGapOnly = (row) => row.options.every((o) => o.id === RESERVED_OPTION_ID);

/**
 * The asked blocks of the rows with `ask: true` and a real option, in row order. Rows of one playbook with the same
 * option ids, recommendation, stale claims and decider are one group: the first row names it, and its short name
 * answers for every type of the group.
 */
function askedGroups(rows) {
    const groups = [];
    const byKey = new Map();
    for (const row of rows) {
        if (!row.ask || isGapOnly(row)) continue;
        const key = row.playbook ? JSON.stringify([row.playbook, optionIds(row), row.recommended, row.staleClaims, row.decidedBy]) : null;
        const group = key === null ? null : byKey.get(key);
        if (group) {
            group.rows.push(row);
            continue;
        }
        const added = { first: row, rows: [row] };
        groups.push(added);
        if (key !== null) byKey.set(key, added);
    }
    return groups;
}

/** The block of one asked group (contracts 6.2.3). */
function questionBlock({ first: row, rows }, dr) {
    let summary = `No native DR into ${dr}.`;
    for (const claim of row.staleClaims) summary += ` Playbook claim stale: ${claim.claim} (Learn says ${sentence(claim.learnSays)}).`;
    if (row.decidedBy) summary += ` Decided by ${row.decidedBy.ref}, which Azure reality vetoes.`;
    const count = rows.reduce((sum, r) => sum + r.count, 0);
    const covers = rows.length > 1 ? `: ${rows.map((r) => r.type).join(", ")}` : "";
    const lines = [`**${row.title}** (${count} ${count === 1 ? "resource" : "resources"}${covers}). ${summary}`];
    row.options.forEach((option, i) => {
        const mark = option.id === row.recommended ? ` **Recommended (${row.recommendationNote}).**` : "";
        if (option.id === RESERVED_OPTION_ID) {
            lines.push(`${i + 1}. ${ACCEPT_GAP_TITLE}.${mark}`);
        } else {
            lines.push(`${i + 1}. ${sentence(option.title)}. Estimated RPO: ${estimate(option.rpoSeconds)}; RTO: ${estimate(option.rtoSeconds)}. Gives up: ${sentence(option.givesUp)}.${mark}`);
        }
    });
    return lines.join("\n");
}

/**
 * The question of contracts 6.2.3 for the rows with `ask: true`, or null when nothing is asked. A row whose only option
 * is accept-gap is not a block: one line lists these rows as open gaps, and the defaults step records them.
 */
export function questionText(rows, { dr }) {
    const groups = askedGroups(rows);
    if (groups.length === 0) return null;
    const gaps = rows.filter((row) => row.ask && isGapOnly(row));
    const second = groups[1] ?? null;
    const examples = second ? `${groups[0].first.short} 1, ${second.first.short} ${Math.min(2, second.first.options.length)}` : `${groups[0].first.short} 1`;
    const parts = groups.map((group) => questionBlock(group, dr));
    if (gaps.length > 0) parts.push(`No DR option found, recorded as open gaps: ${gaps.map((row) => row.title).join(", ")}.`);
    parts.push(`Reply e.g. ${examples}, or accept recommendations.`);
    return parts.join("\n\n");
}

/**
 * The owner's reply to the question, as { type, option } pairs in reply order (contracts 6.2.3). "accept
 * recommendations" (or "accept") alone takes every asked row's recommendation. A short name answers for every type of
 * its block. Any problem throws CliError(INPUT) listing every problem, so that nothing is recorded.
 */
export function parseReply(text, rows) {
    const groups = askedGroups(rows);
    const reply = String(text ?? "").trim();
    if (/^accept( recommendations)?\.?$/i.test(reply)) return groups.flatMap((group) => group.rows.map((row) => ({ type: row.type, option: row.recommended })));
    const byShort = new Map(groups.flatMap((group) => group.rows.map((row) => [String(row.short).toLowerCase(), { group, row }])));
    const problems = [];
    const picks = [];
    const seen = new Set();
    const items = reply.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
    for (const [index, item] of items.entries()) {
        const match = /^(\S+)\s+(\d+)\.?$/.exec(item);
        if (!match) {
            const shown = isSecretValue(item) ? `item ${index + 1}` : `"${item}"`;
            problems.push(`${shown} is not a short name and a number, such as ${groups[0]?.first.short ?? "KV"} 1`);
            continue;
        }
        const named = byShort.get(match[1].toLowerCase());
        if (!named) {
            problems.push(`${match[1]} is not a service of the question (${groups.map((g) => g.first.short).join(", ") || "nothing is asked"})`);
            continue;
        }
        const { group, row } = named;
        const first = group.first;
        if (seen.has(first)) {
            problems.push(`${row.short} is answered twice`);
            continue;
        }
        seen.add(first);
        const n = Number(match[2]);
        if (n < 1 || n > first.options.length) {
            problems.push(`${row.short} ${match[2]}: choose a number from 1 to ${first.options.length}`);
            continue;
        }
        for (const member of group.rows) picks.push({ type: member.type, option: member.options[n - 1].id });
    }
    if (picks.length === 0 && problems.length === 0) problems.push("the reply names no service: answer with a short name and a number, or accept recommendations");
    if (problems.length > 0) throw new CliError(EXIT.INPUT, "the reply could not be read, so nothing was recorded", problems);
    return picks;
}

/** The status of a dr_choices entry against its row of dr-options.json (contracts 6.2 `choice`): valid, or invalid with the problem. */
export function choiceStatus(entry, row) {
    if (!row) return { status: "invalid", problem: `${entry.type} is not an in-scope type of this run` };
    if (row.options.some((o) => o.id === entry.option)) return { status: "valid", problem: null };
    const veto = row.vetoed.find((v) => v.id === entry.option);
    if (veto) return { status: "invalid", problem: `${entry.option} is vetoed in this run: ${veto.reason}` };
    return { status: "invalid", problem: `${entry.option} is not an option of ${entry.type} (options: ${row.options.map((o) => o.id).join(", ")})` };
}

/**
 * Complete the classified rows (contracts 6.2): the short names, the recommendation, the recorded choice and `ask`.
 * A type is asked when no pattern or override decides it (or --ask-type names it), it is not Native on a Verified
 * mechanism, and it has no valid dr_choices entry.
 */
export function finishRows(rows, { limits, choices = [], askTypes = [] }) {
    const shorts = shortNames(rows);
    const byType = new Map(choices.map((c) => [c.type, c]));
    return rows.map((classified, i) => {
        const row = recommend(classified, limits);
        const entry = byType.get(row.type);
        const choice = entry
            ? { option: entry.option, chosen_by: entry.chosen_by, date: entry.date, recommended: entry.recommended, ...choiceStatus(entry, row) }
            : null;
        const undecided = row.decidedBy === null || askTypes.includes(row.type);
        const native = row.path === "native" && row.verified;
        return { ...row, short: shorts[i], choice, ask: undecided && !native && (choice === null || choice.status === "invalid") };
    });
}

/** The in-scope ARM types with their resource counts, most frequent first, ties by code unit (as typeHints). */
export function typeCounts(resources) {
    const counts = new Map();
    for (const resource of resources) {
        if (!resource?.armType) continue;
        const type = resource.armType.toLowerCase();
        counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * The whole of evidence/dr-options.json (contracts 6.2) from the run's inputs. `playbooks` is the set of
 * readPlaybooks, `slots` the slot rows of resolveSlots and `bands` tierBands(pack).
 */
export function buildDrOptions({
    assessment, resources, entries, playbooks, slots = [], bands, askTypes = [], today, generatedAt,
    assessmentName = "assessment.yaml", playbooksDir = null, nonDefaultPlaybooks = false,
}) {
    const { primary, dr } = assessment.regions;
    const { regions, ledger: pairLedger } = pairFacts(entries, primary, dr);
    const warnings = [];
    if (pairLedger === null) warnings.push(`the ledger has no pair entry for ${primary}|${dr}: the DR region counts as not paired and the pair region is unknown`);
    // GC-11: a slot that a pattern or an override decides vetoes every playbook option that would decide it too
    const decidedSlots = Object.fromEntries(slots.map((s) => [s.slot, deciderOf(s)]).filter(([, d]) => d && d.source !== "collision"));
    const rows = typeCounts(resources).map(([type, count]) => {
        const row = classifyType({
            type, count, playbook: playbooks.byType.get(type) ?? null, entries, regions,
            dataResidency: assessment.constraints.data_residency, decidedSlots, today,
        });
        return { ...row, decidedBy: row.slot ? deciderOf(slots.find((s) => s.slot === row.slot)) : null };
    });
    for (const type of askTypes) {
        if (!rows.some((row) => row.type === type)) warnings.push(`--ask-type ${type} is not an in-scope type of this run`);
    }
    const stale = new Map();
    for (const row of rows) if (row.playbookStale) stale.set(row.playbook, row.verifiedOn);
    for (const [playbook, verifiedOn] of stale) {
        warnings.push(`playbook ${playbook} was verified on ${verifiedOn}, more than ${PLAYBOOK_STALE_AFTER_DAYS} days before ${today}`);
    }
    for (const row of rows) {
        warnings.push(...unmatchedEntryWarnings({ type: row.type, playbook: playbooks.byType.get(row.type) ?? null, entries }));
    }
    const tier = assessment.objectives.tier;
    const types = finishRows(rows, {
        limits: tierLimits({ tier, bands, objectives: assessment.objectives }),
        choices: assessment.dr_choices,
        askTypes,
    });
    return {
        schemaVersion: 1,
        generatedAt,
        assessment: assessmentName,
        tier,
        regions,
        playbooksDir,
        nonDefaultPlaybooks,
        types,
        question: questionText(types, { dr }),
        warnings,
    };
}

/**
 * The rules of contracts 6.3 that need dr-options.json: one entry per type, a type of this run, a known option that
 * is not vetoed. `problems` lists { index, type, option, problem }; `residencyWarnings` lists the valid entries whose
 * target crosses the residency constraint, as { type, option, targetRegion }.
 */
export function validateChoices(choices, doc) {
    const rows = new Map(doc.types.map((row) => [row.type, row]));
    const seen = new Map();
    const problems = [];
    const residencyWarnings = [];
    choices.forEach((entry, index) => {
        if (seen.has(entry.type)) {
            problems.push({ index, type: entry.type, option: entry.option, problem: `${entry.type} already has an entry (dr_choices[${seen.get(entry.type)}])` });
            return;
        }
        seen.set(entry.type, index);
        const row = rows.get(entry.type);
        const { status, problem } = choiceStatus(entry, row);
        if (status === "invalid") {
            problems.push({ index, type: entry.type, option: entry.option, problem });
            return;
        }
        const option = row.options.find((o) => o.id === entry.option);
        if (option.residency === "crosses") residencyWarnings.push({ type: entry.type, option: entry.option, targetRegion: option.targetRegion });
    });
    return { problems, residencyWarnings };
}

/** Whether a row takes a dr_choices entry: it is asked, or it already has a valid one (a type a pattern decides does not). */
const takesChoice = (row) => row.ask || row.choice?.status === "valid";

/**
 * The new dr_choices for `dr-options --record` (contracts 4.2): the owner's picks first, then with `defaults` the
 * recommendation for every asked type without a valid entry, the refreshed default entries and the replaced invalid
 * ones. An invalid entry of a type that takes no choice (out of scope, or decided by a pattern) is removed and listed
 * in `replaced` with option null. Throws CliError(INPUT) with every problem when a pick names an unknown type or
 * option, a vetoed option, a type decided by a pattern or override, or a type twice; nothing is then recorded.
 */
export function applyChoices({ choices, doc, picks = [], by = null, today, defaults = false }) {
    const rows = new Map(doc.types.map((row) => [row.type, row]));
    const problems = [];
    const picked = new Set();
    for (const pick of picks) {
        const row = rows.get(pick.type);
        if (picked.has(pick.type)) {
            problems.push(`${pick.type} is answered twice`);
            continue;
        }
        picked.add(pick.type);
        const { status, problem } = choiceStatus(pick, row);
        if (status === "invalid") problems.push(problem);
        else if (row.decidedBy !== null && !takesChoice(row)) problems.push(`${pick.type} is decided by ${row.decidedBy.ref}; the interview does not override it`);
    }
    if (problems.length > 0) throw new CliError(EXIT.INPUT, "the choices could not be recorded, so nothing was written", problems);

    const next = choices.map((entry) => ({ ...entry }));
    const at = (type) => next.findIndex((entry) => entry.type === type);
    const recorded = [];
    for (const pick of picks) {
        const entry = { type: pick.type, option: pick.option, chosen_by: by, date: today, recommended: pick.option === rows.get(pick.type).recommended };
        const i = at(pick.type);
        if (i === -1) next.push(entry);
        else next[i] = entry;
        recorded.push({ type: entry.type, option: entry.option, chosen_by: entry.chosen_by });
    }

    const defaulted = [];
    const refreshed = [];
    const replaced = [];
    if (defaults) {
        const fallback = (row) => ({ type: row.type, option: row.recommended, chosen_by: "default", date: today, recommended: true });
        for (const row of doc.types) {
            if (picked.has(row.type) || !takesChoice(row)) continue;
            const i = at(row.type);
            if (i === -1) {
                next.push(fallback(row));
                defaulted.push(row.type);
                continue;
            }
            const { status, problem } = choiceStatus(next[i], row);
            if (status === "invalid") {
                replaced.push({ type: row.type, option: row.recommended, problem });
                next[i] = fallback(row);
            } else if (isDefaultChoice(next[i].chosen_by) && next[i].option !== row.recommended) {
                refreshed.push({ type: row.type, from: next[i].option, to: row.recommended });
                next[i] = fallback(row);
            }
        }
        for (let i = next.length - 1; i >= 0; i -= 1) {
            const row = rows.get(next[i].type);
            if (row && takesChoice(row)) continue;
            const { status, problem } = choiceStatus(next[i], row);
            if (status === "invalid") {
                replaced.unshift({ type: next[i].type, option: null, problem });
                next.splice(i, 1);
            }
        }
    }
    const openDecisions = next.filter((entry) => isDefaultChoice(entry.chosen_by)).map((entry) => entry.type);
    return { choices: next, recorded, defaulted, refreshed, replaced, openDecisions };
}

/** Every row's `choice` from a dr_choices list (contracts 6.2), for the update that --record writes. */
export function withChoices(doc, choices) {
    const byType = new Map(choices.map((c) => [c.type, c]));
    return {
        ...doc,
        types: doc.types.map((row) => {
            const entry = byType.get(row.type);
            const choice = entry
                ? { option: entry.option, chosen_by: entry.chosen_by, date: entry.date, recommended: entry.recommended, ...choiceStatus(entry, row) }
                : null;
            return { ...row, choice };
        }),
    };
}
