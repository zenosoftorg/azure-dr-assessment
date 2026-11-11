import { sourceOf } from "./decision-source.mjs";
import { GROUP_STYLES } from "./diagram-style.mjs";
import { resolveIcon } from "./icon-map.mjs";
import { secretPaths } from "./secrets.mjs";

/** The rules and annotations that only the proposed-dr diagram kind has (contracts 7.4). */

export const EXCEPTIONS_GROUP_LABEL = "Documented exceptions";
export const EXCEPTION_PREFIX = "Exception: ";
export const EXCEPTIONS_GROUP_ID = "g_documented_exceptions";
/** v3 contracts 6.5: the third region of a split-region choice, the service's own pair. */
export const SPLIT_LABEL_PREFIX = "split: ";
const EXCEPTION_ICON = "azure:information";

const filled = (value) => typeof value === "string" && value.trim() !== "";
const unique = (list) => [...new Set(list)];
const join = (...parts) => parts.filter((part) => typeof part === "string" && part.trim() !== "").join("\n\n");

/** `decisions` lists slot ids of the resolution. Returns whether the list is well formed and the ids that exist. */
function checkDecisions(list, at, resolution, err) {
    if (list === undefined) return { ok: true, ids: [] };
    if (!Array.isArray(list) || list.some((id) => typeof id !== "string")) {
        err(at, "must be an array of decision slot ids such as traffic-dns");
        return { ok: false, ids: [] };
    }
    const slots = new Set(resolution.slots.map((row) => row?.slot));
    const ids = [];
    list.forEach((id, i) => {
        if (slots.has(id)) ids.push(id);
        else err(`${at}[${i}]`, `${JSON.stringify(id)} is not a slot of the pattern resolution`);
    });
    return { ok: true, ids };
}

export function checkDrGroup(group, at, err) {
    if (group.label === EXCEPTIONS_GROUP_LABEL) err(`${at}.label`, `${JSON.stringify(EXCEPTIONS_GROUP_LABEL)} is reserved for the group the builder adds`);
    if (group.style === "split" && typeof group.label === "string" && !group.label.startsWith(SPLIT_LABEL_PREFIX)) {
        err(`${at}.label`, "a split group is labelled split: <service> only (<region>)");
    }
}

export function checkDrNode(node, at, { ok, entries, resolution }, err) {
    const decisions = checkDecisions(node.decisions, `${at}.decisions`, resolution, err);
    if (ok && decisions.ok && entries.length === 0 && decisions.ids.length === 0) {
        err(`${at}.evidence`, "needs at least one ledger id (F-, D- or R-) or a decision slot of the pattern resolution");
    }
    if (typeof node.label === "string" && node.label.startsWith(EXCEPTION_PREFIX)) {
        err(`${at}.label`, `labels that start with ${JSON.stringify(EXCEPTION_PREFIX)} are reserved for the exceptions the builder adds`);
    }
    if (node.mechanism !== undefined && node.mechanism !== null) {
        err(`${at}.mechanism`, "a node has no mechanism; put the mechanism on the link that carries it");
    }
}

export function checkDrEdge(edge, at, { ok, entries, resolution }, err) {
    if (!filled(edge.label)) err(`${at}.label`, "must be a non-empty string: say what flows or replicates");
    if (!filled(edge.mechanism)) err(`${at}.mechanism`, "must be a non-empty string: name the mechanism, such as active geo-replication");
    const decisions = checkDecisions(edge.decisions, `${at}.decisions`, resolution, err);
    if (ok && decisions.ok && entries.length === 0 && decisions.ids.length === 0) {
        err(`${at}.evidence`, "needs at least one ledger id (F-, D- or R-) or a decision slot of the pattern resolution");
    }
    if (edge.kind === "observed" && ok && !entries.some((entry) => entry?.kind === "fact" && entry.strength === "Observed")) {
        err(`${at}.evidence`, "an observed edge needs an Observed fact in its evidence");
    }
}

/**
 * GC-07: the text of an override or a tier exception travels from assessment.yaml through the resolution into the
 * annotations the builder writes, after the spec's own text has been screened. Screening every string of
 * resolution.documentedExceptions here, with the other rules, makes the build refuse it before it writes anything.
 * The message names the path and never echoes the value.
 */
export function checkDrExceptionText(resolution, err) {
    for (const at of secretPaths(resolution?.documentedExceptions, "resolution.documentedExceptions")) {
        err(at, "looks like a secret (key, token, password or connection string) and must not appear in a diagram");
    }
}

/** The documentation URLs behind cited ledger entries: D- entries directly, R- entries through their doc. */
export function docUrls(entries, ledger) {
    const urls = [];
    for (const entry of entries) {
        const doc = entry?.kind === "doc" ? entry : entry?.kind === "region" && entry.doc ? ledger.get(entry.doc) : null;
        if (doc?.kind === "doc" && filled(doc.url)) urls.push(doc.url);
    }
    return unique(urls);
}

/** The generated annotation lines of a proposed-dr node or edge: evidence, mechanism, slots, sources and documentation. */
export function drParts(item, { ledger, resolution }) {
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    const rows = (Array.isArray(item.decisions) ? item.decisions : []).map((slot) => resolution.slots.find((row) => row.slot === slot)).filter(Boolean);
    const urls = docUrls(evidence.map((id) => ledger.get(id)).filter(Boolean), ledger);
    return [
        evidence.length ? `**Evidence:** ${evidence.join(", ")}` : null,
        filled(item.mechanism) ? `**Mechanism:** ${item.mechanism}` : null,
        rows.length ? `**Slot:** ${rows.map((row) => row.slot).join(", ")}` : null,
        rows.length ? `**Source:** ${unique(rows.map(sourceOf)).join("; ")}` : null,
        urls.length ? `**Docs:** ${urls.join(", ")}` : null,
    ];
}

function exceptionAnnotation(entry, resolution) {
    if (entry.kind === "dr-choice-gap") {
        return join(
            `**Accepted gap:** ${entry.type}`,
            `**Chosen by:** ${entry.chosen_by}`,
            `**Date:** ${entry.date}`,
            "_This skill records the choice. It cannot verify it._",
        );
    }
    if (entry.kind === "tier-exception") {
        return join(
            `**Exception:** ${entry.what}`,
            `**Approver role:** ${entry.approver_role}`,
            `**Date:** ${entry.date}`,
            "_This skill records the exception. It cannot verify the approval._",
        );
    }
    const level = (resolution.overrides ?? []).find((override) => override.index === entry.index)?.level;
    return join(
        `**Pattern:** ${entry.pattern}${level ? ` (${level})` : ""}`,
        `**Slots:** ${(entry.slots ?? []).join(", ")}`,
        `**Justification:** ${entry.justification}`,
        `**Owner role:** ${entry.owner_role}`,
        `**Date:** ${entry.date}`,
        entry.approver_role ? `**Approver role:** ${entry.approver_role}` : null,
        entry.approval_ref ? `**Approval reference:** ${entry.approval_ref}` : null,
        filled(entry.alternative) ? `**Alternative used:** ${entry.alternative}` : null,
        entry.approver_role ? "_This skill records the approval. It cannot verify it._" : null,
    );
}

const EXCEPTION_KINDS = {
    override: { subject: (entry) => `${entry.pattern} ${(entry.slots ?? []).join(", ")}`.trim(), sublabel: "override" },
    "tier-exception": { subject: () => "DR-TIER-001 objectives", sublabel: "tier exception" },
    "dr-choice-gap": { subject: (entry) => `${entry.type} accepted gap`, sublabel: "accepted gap" },
};

/**
 * The group and the nodes the builder adds for every applied override, tier exception and accepted DR gap, so that
 * a design that departs from a company pattern or leaves a service without DR shows it on the diagram (spec 6.3, v3 spec 7.5). Their ids contain an underscore
 * after the prefix, which slugKey never produces, so they cannot collide with a spec key. The text of every
 * entry was screened for secrets by checkDrExceptionText during validation; this function does not repeat it.
 */
export function exceptionElements(resolution, catalog) {
    const exceptions = Array.isArray(resolution?.documentedExceptions) ? resolution.documentedExceptions : [];
    if (exceptions.length === 0) return { group: null, nodes: [] };
    const iconId = resolveIcon({ icon: EXCEPTION_ICON }, catalog).iconId;
    const style = GROUP_STYLES.neutral;
    const labels = new Set();
    const nodes = exceptions.map((entry, i) => {
        const kind = EXCEPTION_KINDS[entry.kind] ?? EXCEPTION_KINDS["tier-exception"];
        let label = `${EXCEPTION_PREFIX}${kind.subject(entry)}`;
        // The report numbers an override by its index in assessment.yaml, so the diagram does too. A tier exception has none: its position stands in.
        if (labels.has(label)) label = `${label} (#${Number.isInteger(entry.index) ? entry.index : i})`;
        labels.add(label);
        return {
            id: `n_exception_${i}`, iconId, variant: 0, label, sublabel: kind.sublabel, x: 0, y: 0,
            group: EXCEPTIONS_GROUP_ID, annotation: exceptionAnnotation(entry, resolution),
        };
    });
    const group = {
        id: EXCEPTIONS_GROUP_ID, label: EXCEPTIONS_GROUP_LABEL, parent: null, x: 0, y: 0,
        border: style.border, background: style.background, dashed: style.dashed,
        annotation: exceptions.some((entry) => entry.kind === "dr-choice-gap")
            ? "Overrides, tier exceptions and accepted DR gaps recorded in assessment.yaml. This skill records them and cannot verify an approval or a choice."
            : "Overrides and tier exceptions recorded in assessment.yaml. This skill records them and cannot verify an approval.",
    };
    return { group, nodes };
}
