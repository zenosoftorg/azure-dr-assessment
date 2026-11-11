import { isDefaultChoice } from "./assessment.mjs";
import { validateOverrides } from "./overrides.mjs";
import { SLOT_IDS, applies, packBanner, packDisplayDir, supersedesIndex } from "./patterns.mjs";
import { TIER_PATTERN_ID, checkTargets, formatSeconds } from "./tiers.mjs";

export const DECISION_SOURCES = ["override", "pattern", "playbook", "learn", "azure-reality"];
const DECISION_STATUSES = ["Resolved", "Unresolved", "Unmet requirement"];
const CANDIDATE_SOURCES = ["override", "pattern", "learn", "collision"];
const ROW_STATUSES = ["candidate", "unresolved"];
/** v3 contracts 8 (v2 C 7.6): the ref of a decision whose content comes from a service playbook. */
const PLAYBOOK_REF = /^playbook [a-z0-9]+(-[a-z0-9]+)* v[1-9]\d*$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const filled = (v) => typeof v === "string" && v.trim() !== "";
const supplied = (v) => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");

/** The two intake gates of DR-TIER-001 (contracts 7.6): a missing tier, and a numeric target stricter than the tier. */
export function evaluateGates(a, pack) {
    const tier = a.objectives.tier;
    const missing = tier === null;
    const tierGate = {
        id: "tier-missing",
        pattern: TIER_PATTERN_ID,
        status: missing ? "open" : "satisfied",
        detail: missing ? "no tier supplied; ask the tier question alone and first" : `tier ${tier} supplied`,
        question: missing ? (pack.byId.get(TIER_PATTERN_ID)?.gate?.question ?? null) : null,
    };
    const { stricter, excepted } = checkTargets(a, pack);
    let status = "satisfied";
    let detail = missing ? "no tier supplied; numeric targets are checked once a tier is set" : `no numeric target is stricter than tier ${tier}`;
    if (stricter.length > 0) {
        const found = stricter
            .map((s) => `${s.metric.toUpperCase()} ${a.objectives[s.metric]} is below the tier ${tier} lower bound of ${formatSeconds(s.tierMinSeconds)}`)
            .join("; ");
        status = excepted ? "excepted" : "open";
        detail = excepted ? `${found}; recorded as an objectives.exceptions entry; one entry covers all` : `${found}; change the tier or record an objectives.exceptions entry`;
    }
    return [tierGate, { id: "target-stricter-than-tier", pattern: TIER_PATTERN_ID, status, detail, question: null }];
}

function candidate(source, pattern = null, overrideIndex = null, alternative = null) {
    return { source, pattern: pattern?.id ?? null, version: pattern?.version ?? null, overrideIndex, alternative };
}

/**
 * Propose a candidate per decision slot from the overrides and the approved, applicable patterns (contracts 7.6).
 * The pack must be lint-clean apart from slot-collision: validateOverrides falls back to the overridable rules on a bad override level.
 */
export function resolveSlots(a, pack) {
    const outcomes = validateOverrides(a, pack);
    const register = pack.patterns.map((pattern) => ({ pattern, verdict: applies(pattern, a) }));
    const active = register.filter((r) => r.verdict.applies).map((r) => r.pattern);
    const graph = supersedesIndex(pack.patterns.filter((p) => p.id !== ""));
    const inForce = new Set();

    const slots = SLOT_IDS.map((slot) => {
        const deciders = active.filter((p) => p.slots.includes(slot));
        // A pattern that supersedes another displaces it on the slots they share; patterns in a cycle displace nobody.
        const survivors = deciders.filter((p) => !deciders.some((q) => q !== p && graph.reaches(q.id, p.id) && !graph.reaches(p.id, q.id)));
        const waivers = new Map();
        for (const outcome of outcomes.applied) {
            if (outcome.slots.includes(slot) && !waivers.has(outcome.pattern) && survivors.some((p) => p.id === outcome.pattern)) {
                waivers.set(outcome.pattern, outcome);
            }
        }
        const remaining = survivors.filter((p) => !waivers.has(p.id));
        for (const p of remaining) inForce.add(p.id);
        const result = { slot, candidate: candidate("learn"), collision: null, status: "candidate", decision: null };
        if (remaining.length === 1) {
            result.candidate = candidate("pattern", remaining[0]);
        } else if (remaining.length > 1) {
            result.candidate = candidate("collision");
            result.collision = remaining.map((p) => `${p.id} v${p.version}`);
            result.status = "unresolved";
        } else if (waivers.size > 0) {
            const first = [...waivers.values()].sort((x, y) => x.index - y.index)[0];
            result.candidate = candidate("override", pack.byId.get(first.pattern), first.index, first.entry.alternative ?? null);
        }
        return result;
    });

    const openInputs = pack.patterns
        .filter((p) => inForce.has(p.id))
        .flatMap((p) => p.inputs
            .filter((input) => input.required && !supplied(a.pattern_inputs[p.id]?.[input.name]))
            .map((input) => ({ pattern: p.id, name: input.name, description: input.description })));

    const documentedExceptions = [
        ...outcomes.applied.map((o) => ({
            kind: "override",
            index: o.index,
            pattern: o.pattern,
            slots: o.slots,
            justification: o.entry.justification,
            owner_role: o.entry.owner_role,
            date: o.entry.date,
            approver_role: o.entry.approver_role ?? null,
            approval_ref: o.entry.approval_ref ?? null,
            approvalVerified: false,
            alternative: o.entry.alternative ?? null,
        })),
        ...a.objectives.exceptions.map((e) => ({ kind: "tier-exception", what: e.what, approver_role: e.approver_role, date: e.date })),
        // An accepted gap is an exception only when an owner chose it: a default has no owner (spec 7.5, V7).
        ...a.dr_choices
            .filter((c) => c.option === "accept-gap" && !isDefaultChoice(c.chosen_by))
            .map((c) => ({ kind: "dr-choice-gap", type: c.type, chosen_by: c.chosen_by, date: c.date })),
    ];

    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        assessment: "assessment.yaml",
        packDir: packDisplayDir(pack.dir),
        nonDefaultPack: !pack.isDefault,
        banner: packBanner(pack),
        gates: evaluateGates(a, pack),
        patterns: register.map(({ pattern, verdict }) => ({
            id: pattern.id,
            version: pattern.version,
            status: pattern.status,
            override: pattern.override,
            applied: verdict.applies,
            reason: verdict.reason,
        })),
        overrides: [...outcomes.applied, ...outcomes.rejected].sort((x, y) => x.index - y.index),
        openInputs,
        slots,
        documentedExceptions,
    };
}

/** Check a resolution after the model has completed it (contracts 7.6). */
export function validateResolution(resolution, { ledgerIds } = {}) {
    const errors = [];
    const err = (path, message) => {
        errors.push({ path, message });
    };
    if (!isObject(resolution)) return { ok: false, errors: [{ path: "$", message: "must be a JSON object" }] };
    if (resolution.schemaVersion !== 1) err("schemaVersion", "must be 1");
    if (!Array.isArray(resolution.slots)) {
        err("slots", "must be an array of slot rows");
        return { ok: false, errors };
    }
    const seen = new Set();
    resolution.slots.forEach((slotRow, i) => {
        const at = `slots[${i}]`;
        if (!isObject(slotRow) || !SLOT_IDS.includes(slotRow.slot)) {
            err(`${at}.slot`, "must be one of the slot ids");
            return;
        }
        if (seen.has(slotRow.slot)) err(`${at}.slot`, `${slotRow.slot} is listed twice`);
        seen.add(slotRow.slot);
        // The rules below key on the engine's candidate and status, so a row that lost or edited one is an error, not a free pass.
        const candidate = isObject(slotRow.candidate) ? slotRow.candidate.source : undefined;
        const knownCandidate = CANDIDATE_SOURCES.includes(candidate);
        if (!isObject(slotRow.candidate)) {
            err(`${at}.candidate`, `${slotRow.slot} has no candidate object: keep the engine's candidate as resolve-patterns wrote it`);
        } else if (!knownCandidate) {
            err(`${at}.candidate.source`, `must be one of ${CANDIDATE_SOURCES.join(", ")}`);
        }
        if (!ROW_STATUSES.includes(slotRow.status)) {
            err(`${at}.status`, `must be one of ${ROW_STATUSES.join(", ")}`);
        } else if (knownCandidate && (slotRow.status === "unresolved") !== (candidate === "collision")) {
            err(`${at}.status`, `${slotRow.slot}: status "${slotRow.status}" contradicts the candidate from ${candidate}; a collision is status "unresolved" with a collision candidate, so keep both as resolve-patterns wrote them`);
        }
        const collides = slotRow.status === "unresolved" || candidate === "collision";
        const d = slotRow.decision;
        if (!isObject(d)) {
            err(`${at}.decision`, `${slotRow.slot} has no decision yet`);
            return;
        }
        const hasSource = d.source !== undefined && d.source !== null;
        if (hasSource && !DECISION_SOURCES.includes(d.source)) {
            err(`${at}.decision.source`, `must be one of ${DECISION_SOURCES.join(", ")}`);
        }
        if (!DECISION_STATUSES.includes(d.status)) {
            err(`${at}.decision.status`, `must be one of ${DECISION_STATUSES.join(", ")}`);
            return;
        }
        if (collides && d.status !== "Unresolved") {
            err(`${at}.decision.status`, `${slotRow.slot} has a pattern collision (${(Array.isArray(slotRow.collision) ? slotRow.collision : []).join(", ")}): it can only be recorded as Unresolved`);
        }
        // A service playbook fills a slot only where no override and no pattern decides it: a learn candidate.
        const playbookOnLearn = d.source === "playbook" && candidate === "learn";
        if (hasSource && DECISION_SOURCES.includes(d.source) && d.source !== "azure-reality" && d.status !== "Unresolved"
            && knownCandidate && candidate !== "collision" && d.source !== candidate && !playbookOnLearn) {
            err(`${at}.decision.source`, d.source === "playbook"
                ? `${slotRow.slot}: a decision from playbook needs a learn candidate, and the engine's candidate comes from ${candidate}; keep the source ${candidate}`
                : `${slotRow.slot}: the engine's candidate comes from ${candidate}, so a decision from ${d.source} would ignore it; only azure-reality can overrule a candidate`);
        }
        if (d.source === "playbook" && !PLAYBOOK_REF.test(String(d.ref ?? "").trim())) {
            err(`${at}.decision.ref`, "a decision from playbook needs the ref playbook <service> v<version>, such as playbook key-vault v1");
        }
        if (d.status === "Resolved") {
            if (!filled(d.text)) err(`${at}.decision.text`, "a Resolved decision needs text");
            if (!hasSource) err(`${at}.decision.source`, "a Resolved decision needs a source");
            else if (DECISION_SOURCES.includes(d.source) && d.source !== "learn" && d.source !== "playbook" && !filled(d.ref)) err(`${at}.decision.ref`, `a decision from ${d.source} needs a ref`);
        }
        if (d.status === "Unmet requirement" && !filled(d.alternative) && !filled(d.azureReality)) {
            err(`${at}.decision.alternative`, "an Unmet requirement needs an alternative or an azureReality note");
        }
        if (d.ledger !== undefined && d.ledger !== null) {
            if (!Array.isArray(d.ledger) || !d.ledger.every((id) => typeof id === "string")) {
                err(`${at}.decision.ledger`, "must be a list of ledger ids");
            } else if (ledgerIds) {
                for (const id of d.ledger) if (!ledgerIds.has(id)) err(`${at}.decision.ledger`, `${id} is not in the ledger`);
            }
        }
    });
    for (const slot of SLOT_IDS) if (!seen.has(slot)) err("slots", `slot ${slot} is missing`);
    return { ok: errors.length === 0, errors };
}
