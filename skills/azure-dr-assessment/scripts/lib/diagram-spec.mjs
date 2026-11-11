import { CliError, EXIT } from "./cli.mjs";
import { checkDrEdge, checkDrExceptionText, checkDrGroup, checkDrNode, drParts, exceptionElements } from "./diagram-dr.mjs";
import { ARROWS, DIRECTIONS, EDGE_STYLES, GROUP_STYLES, KINDS, MAX_NODE_LABEL, NON_DEFAULT_PACK_SUFFIX, slugKey } from "./diagram-style.mjs";
import { resolveIcon } from "./icon-map.mjs";
import { isSecretValue } from "./secrets.mjs";

const SPEC_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX_ID = 60;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const filled = (value) => typeof value === "string" && value.trim() !== "";
const textOrNull = (value) => value === undefined || value === null || typeof value === "string";
const isFact = (entry, ...strengths) => entry?.kind === "fact" && strengths.includes(entry.strength);
const quote = (value) => JSON.stringify(value);

/** GC-07: free text that ends up in the diagram must not carry a secret. The message never echoes the value. */
function checkSecrets(items, fields, base, err) {
    items.forEach((item, i) => {
        if (!isObject(item)) return;
        for (const field of fields) {
            if (isSecretValue(item[field])) err(`${base}[${i}].${field}`, "looks like a secret (key, token, password or connection string) and must not appear in a diagram");
        }
    });
}

/** The ledger entries a list of ids names. An id that is not in the ledger is an error; `ok` is false when the list itself is malformed. */
function cite(list, at, ledger, err) {
    if (!Array.isArray(list) || list.some((id) => typeof id !== "string")) {
        err(at, "must be an array of ledger ids such as F-0001");
        return { ok: false, entries: [] };
    }
    const entries = [];
    list.forEach((id, i) => {
        const entry = ledger.get(id);
        if (entry) entries.push(entry);
        else err(`${at}[${i}]`, `${id} is not in the ledger`);
    });
    return { ok: true, entries };
}

/** Keys become id suffixes through slugKey, so two keys must not share a slug. */
function checkKey(key, at, seen, err) {
    if (!filled(key) || !/[A-Za-z0-9]/.test(key)) {
        err(`${at}.key`, "must be a non-empty string with at least one letter or digit");
        return;
    }
    const slug = slugKey(key);
    if (!seen.has(slug)) seen.set(slug, key);
    else err(`${at}.key`, seen.get(slug) === key ? `duplicate key ${quote(key)}` : `key ${quote(key)} gives the same id as ${quote(seen.get(slug))}`);
}

function checkGroups(groups, rules, ledger, err, dr = null) {
    const keys = new Map();
    const labels = new Set();
    const parentOf = new Map(groups.filter(isObject).map((group) => [group.key, group.parent ?? null]));
    groups.forEach((group, i) => {
        const at = `groups[${i}]`;
        if (!isObject(group)) {
            err(at, "must be an object");
            return;
        }
        checkKey(group.key, at, keys, err);
        if (!filled(group.label)) err(`${at}.label`, "must be a non-empty string");
        else if (labels.has(group.label)) err(`${at}.label`, `duplicate group label ${quote(group.label)}; labels are the story's join key`);
        else labels.add(group.label);
        if (dr) checkDrGroup(group, at, err);
        if (!rules.groupStyles.includes(group.style)) err(`${at}.style`, `must be one of ${rules.groupStyles.join(", ")}`);
        if (group.parent !== undefined && group.parent !== null) {
            if (group.parent === group.key) {
                err(`${at}.parent`, "a group cannot be its own parent");
            } else if (!parentOf.has(group.parent)) {
                err(`${at}.parent`, `${quote(group.parent)} is not a group key`);
            } else {
                const seen = new Set([group.key]);
                for (let cursor = group.parent; cursor; cursor = parentOf.get(cursor)) {
                    if (seen.has(cursor)) {
                        err(`${at}.parent`, "the parent chain contains a cycle");
                        break;
                    }
                    seen.add(cursor);
                }
            }
        }
        if (group.evidence !== undefined) cite(group.evidence, `${at}.evidence`, ledger, err);
        if (!textOrNull(group.annotation)) err(`${at}.annotation`, "must be a string");
    });
    return new Set(parentOf.keys());
}

function checkNodes(nodes, groupKeys, ledger, err, dr = null) {
    const keys = new Map();
    const labels = new Set();
    nodes.forEach((node, i) => {
        const at = `nodes[${i}]`;
        if (!isObject(node)) {
            err(at, "must be an object");
            return;
        }
        checkKey(node.key, at, keys, err);
        if (!filled(node.label)) {
            err(`${at}.label`, "must be a non-empty string");
        } else {
            if (node.label.length > MAX_NODE_LABEL) err(`${at}.label`, `must be at most ${MAX_NODE_LABEL} characters (it is ${node.label.length})`);
            if (labels.has(node.label)) err(`${at}.label`, `duplicate node label ${quote(node.label)}; labels are the story's join key`);
            else labels.add(node.label);
        }
        for (const field of ["sublabel", "armType", "icon", "annotation"]) {
            if (!textOrNull(node[field])) err(`${at}.${field}`, "must be a string or null");
        }
        if (node.group !== undefined && node.group !== null && !groupKeys.has(node.group)) err(`${at}.group`, `${quote(node.group)} is not a group key`);
        const { ok, entries } = cite(node.evidence, `${at}.evidence`, ledger, err);
        if (dr) {
            checkDrNode(node, at, { ok, entries, resolution: dr.resolution }, err);
            return;
        }
        if (ok && !entries.some((entry) => isFact(entry, "Observed", "Inferred"))) {
            err(`${at}.evidence`, "needs at least one F- fact with strength Observed or Inferred; an Unknown fact alone does not justify a node");
        }
        if (node.decisions !== undefined && !(Array.isArray(node.decisions) && node.decisions.length === 0)) {
            err(`${at}.decisions`, "must be empty in a current-state diagram; decision slots belong to proposed-dr");
        }
    });
}

function checkEdges(edges, nodeKeys, rules, ledger, err, dr = null) {
    edges.forEach((edge, i) => {
        const at = `edges[${i}]`;
        if (!isObject(edge)) {
            err(at, "must be an object");
            return;
        }
        for (const end of ["from", "to"]) {
            if (!nodeKeys.has(edge[end])) err(`${at}.${end}`, `${quote(edge[end])} is not a node key`);
        }
        if (nodeKeys.has(edge.from) && edge.from === edge.to) err(`${at}.to`, "an edge cannot connect a node to itself");
        if (!textOrNull(edge.label)) err(`${at}.label`, "must be a string");
        if (!textOrNull(edge.basis)) err(`${at}.basis`, "must be a string");
        if (!textOrNull(edge.annotation)) err(`${at}.annotation`, "must be a string");
        if (!rules.edgeKinds.includes(edge.kind)) err(`${at}.kind`, `must be one of ${rules.edgeKinds.join(", ")}`);
        if (edge.arrow !== undefined && !ARROWS.includes(edge.arrow)) err(`${at}.arrow`, `must be one of ${ARROWS.join(", ")}`);
        if (dr) {
            const cited = cite(edge.evidence, `${at}.evidence`, ledger, err);
            checkDrEdge(edge, at, { ok: cited.ok, entries: cited.entries, resolution: dr.resolution }, err);
            return;
        }
        if (edge.mechanism !== undefined && edge.mechanism !== null) err(`${at}.mechanism`, "must be null in a current-state diagram; mechanisms belong to proposed-dr");
        const { ok, entries } = cite(edge.evidence, `${at}.evidence`, ledger, err);
        if (edge.kind === "observed" && ok && !entries.some((entry) => isFact(entry, "Observed"))) {
            err(`${at}.evidence`, "an observed edge needs an Observed fact in its evidence");
        }
        if (edge.kind === "inferred") {
            if (!filled(edge.basis)) err(`${at}.basis`, "an inferred edge needs a basis: say what the link is inferred from");
            if (ok && !entries.some((entry) => isFact(entry, "Observed", "Inferred"))) {
                err(`${at}.evidence`, "an inferred edge needs at least one Observed or Inferred fact in its evidence");
            }
        }
    });
}

/**
 * Check a diagram spec against the rules of contracts 7.4 and the evidence ledger. The proposed-dr kind also
 * needs the pattern resolution in ctx.resolution (its rules are in diagram-dr.mjs, which also screens the
 * exception text the resolution carries for secrets).
 */
export function validateDiagramSpec(spec, ctx) {
    const { ledger, kind } = ctx ?? {};
    if (typeof ledger?.get !== "function") throw new TypeError("validateDiagramSpec needs the evidence ledger in ctx.ledger");
    const errors = [];
    const err = (path, message) => errors.push({ path, message });
    const done = () => ({ ok: errors.length === 0, errors });

    if (!isObject(spec)) {
        err("", "the spec must be a JSON object");
        return done();
    }
    if (!Object.hasOwn(KINDS, kind)) {
        err("kind", "must be current-state or proposed-dr");
        return done();
    }
    if (spec.kind !== kind) {
        err("kind", `must be ${quote(kind)}, it is ${quote(spec.kind)}`);
        return done();
    }
    if (kind === "proposed-dr" && !(isObject(ctx.resolution) && Array.isArray(ctx.resolution.slots))) {
        err("resolution", "a proposed-dr spec is checked against pattern-resolution.json: pass it with --resolution");
        return done();
    }
    const dr = kind === "proposed-dr" ? { resolution: ctx.resolution } : null;

    const rules = KINDS[kind];
    if (spec.schemaVersion !== 1) err("schemaVersion", "must be 1");
    if (typeof spec.id !== "string" || spec.id.length > MAX_ID || !SPEC_ID.test(spec.id)) {
        err("id", `must be a lowercase slug of at most ${MAX_ID} characters, such as checkout-current-state`);
    }
    if (!filled(spec.title)) err("title", "must be a non-empty string");
    if (spec.direction !== undefined && !DIRECTIONS.includes(spec.direction)) err("direction", `must be ${DIRECTIONS.join(" or ")}`);
    for (const field of ["groups", "nodes", "edges"]) {
        if (spec[field] !== undefined && !Array.isArray(spec[field])) err(field, "must be an array");
    }
    const groups = Array.isArray(spec.groups) ? spec.groups : [];
    const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
    const edges = Array.isArray(spec.edges) ? spec.edges : [];
    if (Array.isArray(spec.nodes) ? nodes.length === 0 : spec.nodes === undefined) err("nodes", "needs at least one node");

    const groupKeys = checkGroups(groups, rules, ledger, err, dr);
    checkNodes(nodes, groupKeys, ledger, err, dr);
    checkEdges(edges, new Set(nodes.filter(isObject).map((node) => node.key)), rules, ledger, err, dr);
    if (isSecretValue(spec.title)) err("title", "looks like a secret (key, token, password or connection string) and must not appear in a diagram");
    checkSecrets(groups, ["label", "annotation"], "groups", err);
    checkSecrets(nodes, ["label", "sublabel", "annotation", "armType", "icon"], "nodes", err);
    checkSecrets(edges, ["label", "annotation", "basis", "mechanism"], "edges", err);
    if (dr) checkDrExceptionText(dr.resolution, err);
    return done();
}

const join = (...parts) => parts.filter((part) => typeof part === "string" && part.trim() !== "").join("\n\n");

function iconNote(node, icon) {
    if (icon.how === "closest") return `_Closest icon match: ${icon.iconId}._`;
    if (icon.how !== "generic") return null;
    const subject = node.armType || node.icon;
    return subject ? `_Generic icon: no specific icon for ${subject}._` : "_Generic icon: the node gives neither an ARM type nor an icon._";
}

/**
 * Turn a valid spec into the laid-out .arch.json object (contracts 7.4): the builder writes the generated lines
 * of every annotation (evidence and strength for current-state; evidence, mechanism, slot, source and docs for
 * proposed-dr), the vendored normalizeDiagram drops what the canvas does not know and autoLayout places the boxes.
 * A proposed-dr diagram also gets the Documented exceptions group (diagram-dr.mjs).
 */
export function buildDiagram(spec, ctx) {
    const { ledger, catalog, modules, resolution } = ctx;
    const verdict = validateDiagramSpec(spec, { ledger, kind: spec?.kind, resolution });
    if (!verdict.ok) {
        throw new CliError(EXIT.INPUT, "the diagram spec is invalid", verdict.errors.map(({ path, message }) => `${path || "(spec)"}: ${message}`));
    }
    const dr = spec.kind === "proposed-dr";
    const nodeId = (key) => `n_${slugKey(key)}`;
    const groupId = (key) => `g_${slugKey(key)}`;
    const genericIcons = [];
    const closestIcons = [];

    const nodes = spec.nodes.map((node) => {
        const icon = resolveIcon(node, catalog);
        if (icon.how === "generic") genericIcons.push(node.label);
        if (icon.how === "closest") closestIcons.push(node.label);
        const observed = node.evidence.some((id) => isFact(ledger.get(id), "Observed"));
        return {
            id: nodeId(node.key), iconId: icon.iconId, variant: 0, label: node.label, sublabel: node.sublabel ?? "", x: 0, y: 0,
            group: node.group ? groupId(node.group) : null,
            annotation: dr
                ? join(...drParts(node, { ledger, resolution }), iconNote(node, icon), node.annotation)
                : join(`**Evidence:** ${node.evidence.join(", ")}`, `**Strength:** ${observed ? "Observed" : "Inferred"}`, iconNote(node, icon), node.annotation),
        };
    });

    const groups = (spec.groups ?? []).map((group) => {
        const style = GROUP_STYLES[group.style];
        return {
            id: groupId(group.key), label: group.label, parent: group.parent ? groupId(group.parent) : null, x: 0, y: 0,
            border: style.border, background: style.background, dashed: style.dashed,
            annotation: join(group.evidence?.length ? `**Evidence:** ${group.evidence.join(", ")}` : null, group.annotation),
        };
    });

    const ordinals = new Map();
    const edges = (spec.edges ?? []).map((edge) => {
        const pair = `${slugKey(edge.from)}_${slugKey(edge.to)}`;
        const index = ordinals.get(pair) ?? 0;
        ordinals.set(pair, index + 1);
        const style = EDGE_STYLES[edge.kind];
        return {
            id: `e_${pair}_${index}`, from: nodeId(edge.from), to: nodeId(edge.to), label: edge.label ?? "",
            color: style.color, dashed: style.dashed, width: 2, arrow: edge.arrow ?? "forward", route: "straight",
            annotation: dr
                ? join(...drParts(edge, { ledger, resolution }), edge.annotation)
                : join(
                    `**Evidence:** ${edge.evidence.join(", ")}`,
                    `**Strength:** ${edge.kind === "observed" ? "Observed" : "Inferred"}`,
                    filled(edge.basis) ? `**Basis:** ${edge.basis}` : null,
                    edge.annotation,
                ),
        };
    });

    const extra = dr ? exceptionElements(resolution, catalog) : { group: null, nodes: [] };
    const title = resolution?.nonDefaultPack === true ? `${spec.title}${NON_DEFAULT_PACK_SUFFIX}` : spec.title;
    const diagram = modules.store.normalizeDiagram({
        version: 1, title, nodes: [...nodes, ...extra.nodes], edges, groups: extra.group ? [...groups, extra.group] : groups, decisions: [],
    }, title);
    modules.layout.autoLayout(diagram, { direction: spec.direction === "TB" ? "TB" : "LR" });
    return { diagram, genericIcons, closestIcons };
}
