import { readFile } from "node:fs/promises";
import { CliError, EXIT } from "./cli.mjs";
import { slugify } from "./paths.mjs";
import { parseYaml, stringifyYaml, YamlError } from "./yaml.mjs";

const FAILURE_SCOPES = ["zonal", "regional", "wider"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const ARM_TYPE = /^[a-z0-9.]+\/[a-z0-9./]+$/;
const OPTION_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const obj = (v) => (isObject(v) ? v : {});
const list = (v) => (Array.isArray(v) ? v : []);
function str(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
}
const strList = (v) => list(v).map((x) => String(x).trim()).filter(Boolean);

/** "(Europe) West Europe" and "Sweden Central" become ARM names: westeurope, swedencentral. */
export function normalizeRegion(input) {
    return String(input ?? "")
        .replace(/^\s*\([^)]*\)\s*/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

/** "30m" -> 1800. Accepts s, m, h, d and "0". Anything else is null. */
export function parseDuration(text) {
    if (text === null || text === undefined) return null;
    const s = String(text).trim().toLowerCase();
    if (s === "0") return 0;
    const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/.exec(s);
    if (!match) return null;
    return Math.round(Number(match[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[match[2]]);
}

function toTier(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
    return v;
}

function normalizeOverride(entry) {
    const o = obj(entry);
    const out = { pattern: str(o.pattern) ?? "" };
    if (o.slots !== undefined && o.slots !== null) out.slots = strList(o.slots);
    out.justification = str(o.justification) ?? "";
    out.owner_role = str(o.owner_role) ?? "";
    out.date = str(o.date) ?? "";
    for (const key of ["approver_role", "approval_ref", "alternative"]) {
        const v = str(o[key]);
        if (v !== null) out[key] = v;
    }
    if (o.pattern_version !== undefined && o.pattern_version !== null) out.pattern_version = o.pattern_version;
    return out;
}

/** One dr_choices entry (v3 contracts 6.3). `recommended` is false when missing; any other non-boolean is kept for validateAssessment to name. */
function normalizeChoice(entry) {
    const c = obj(entry);
    return {
        type: str(c.type) ?? "",
        option: str(c.option) ?? "",
        chosen_by: str(c.chosen_by) ?? "",
        date: str(c.date) ?? "",
        recommended: c.recommended === undefined || c.recommended === null ? false : c.recommended,
    };
}

/** Fill defaults and coerce types. Never throws on missing optional fields; validateAssessment reports problems. */
export function normalizeAssessment(raw) {
    const r = obj(raw);
    const workload = obj(r.workload);
    const inputs = obj(r.inputs);
    const live = obj(inputs.live);
    const scope = obj(r.scope);
    const regions = obj(r.regions);
    const objectives = obj(r.objectives);
    const constraints = obj(r.constraints);
    const options = obj(r.options);
    const outputs = obj(r.outputs);
    const name = str(workload.name) ?? "";
    const app = str(workload.app) ?? (name ? slugify(name) : "");
    return {
        schema: r.schema ?? 1,
        workload: { name, app, environment: str(workload.environment), owner_role: str(workload.owner_role) },
        inputs: {
            ari_file: str(inputs.ari_file),
            live: { tenant_id: str(live.tenant_id), subscription_ids: strList(live.subscription_ids) },
        },
        scope: {
            resource_groups: strList(scope.resource_groups),
            tag: isObject(scope.tag) ? { name: str(scope.tag.name), value: str(scope.tag.value) } : null,
            subscriptions: strList(scope.subscriptions),
        },
        regions: {
            primary: str(regions.primary) ? normalizeRegion(regions.primary) : null,
            dr: str(regions.dr) ? normalizeRegion(regions.dr) : null,
            failure_scope: str(regions.failure_scope) ?? "regional",
        },
        objectives: {
            tier: toTier(objectives.tier),
            rto: str(objectives.rto),
            rpo: str(objectives.rpo),
            exceptions: list(objectives.exceptions).map((e) => ({
                what: str(obj(e).what) ?? "",
                approver_role: str(obj(e).approver_role) ?? "",
                date: str(obj(e).date) ?? "",
            })),
        },
        constraints: {
            data_residency: str(constraints.data_residency),
            cost_ceiling: str(constraints.cost_ceiling),
            test_windows: str(constraints.test_windows),
        },
        pattern_inputs: obj(r.pattern_inputs),
        overrides: list(r.overrides).map(normalizeOverride),
        decisions: list(r.decisions).map((d) => ({
            question: str(obj(d).question) ?? "",
            answer: str(obj(d).answer) ?? "",
            by: str(obj(d).by),
            date: str(obj(d).date) ?? "",
        })),
        dr_choices: list(r.dr_choices).map(normalizeChoice),
        drills: list(r.drills).map((d) => ({
            date: str(obj(d).date) ?? "",
            scenario: str(obj(d).scenario) ?? "",
            rpo: str(obj(d).rpo),
            rto: str(obj(d).rto),
            reference: str(obj(d).reference) ?? "",
        })),
        options: { pause_after_current_state: options.pause_after_current_state === true },
        outputs: { directory: str(outputs.directory) ?? (app ? `dr-assessment/${app}` : "dr-assessment") },
    };
}

function validDate(value) {
    if (typeof value !== "string" || !DATE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateAssessment(a, { requireComplete = false } = {}) {
    const errors = [];
    const err = (path, message) => errors.push({ path, message });
    if (a.schema !== 1) err("schema", "must be 1");
    if (!a.workload.name) err("workload.name", "must be a non-empty string");
    if (a.workload.app && !SLUG.test(a.workload.app)) err("workload.app", "must be a slug: lowercase letters, digits and hyphens");
    for (const field of ["primary", "dr"]) {
        const v = a.regions[field];
        if (v !== null && !/^[a-z0-9]+$/.test(v)) err(`regions.${field}`, "must be an Azure region name such as westeurope");
    }
    if (a.regions.primary && a.regions.dr && a.regions.primary === a.regions.dr) err("regions.dr", "must differ from regions.primary");
    if (!FAILURE_SCOPES.includes(a.regions.failure_scope)) err("regions.failure_scope", `must be one of ${FAILURE_SCOPES.join(", ")}`);
    const tier = a.objectives.tier;
    if (tier !== null && !(Number.isInteger(tier) && tier >= 0 && tier <= 3)) err("objectives.tier", "must be 0, 1, 2 or 3");
    for (const metric of ["rto", "rpo"]) {
        const v = a.objectives[metric];
        if (v !== null && parseDuration(v) === null) err(`objectives.${metric}`, "use a numeric duration such as 30m, 2h or 0, or leave it null");
    }
    a.objectives.exceptions.forEach((e, i) => {
        for (const f of ["what", "approver_role"]) if (!e[f]) err(`objectives.exceptions[${i}].${f}`, "must be a non-empty string");
        if (!validDate(e.date)) err(`objectives.exceptions[${i}].date`, "must be a date as YYYY-MM-DD");
    });
    if (a.scope.tag && (!a.scope.tag.name || !a.scope.tag.value)) err("scope.tag", "needs a name and a value");
    // Override entries are judged by validateOverrides (Plan 2): a bad entry is rejected with its reason and listed, and the run goes on.
    a.decisions.forEach((d, i) => {
        for (const f of ["question", "answer"]) if (!d[f]) err(`decisions[${i}].${f}`, "must be a non-empty string");
        if (!validDate(d.date)) err(`decisions[${i}].date`, "must be a date as YYYY-MM-DD");
    });
    // The rules that need evidence/dr-options.json (known type and option, not vetoed, residency) are validateChoices in lib/dr-options.mjs.
    const chosen = new Map();
    a.dr_choices.forEach((c, i) => {
        if (!ARM_TYPE.test(c.type)) err(`dr_choices[${i}].type`, "must be a lowercase ARM type such as microsoft.keyvault/vaults");
        else if (chosen.has(c.type)) err(`dr_choices[${i}].type`, `${c.type} already has an entry (dr_choices[${chosen.get(c.type)}]); keep one entry per type`);
        else chosen.set(c.type, i);
        if (!OPTION_ID.test(c.option)) err(`dr_choices[${i}].option`, "must be an option id such as secondary-vault-sync, or accept-gap");
        if (!c.chosen_by) err(`dr_choices[${i}].chosen_by`, "must be a role, or default when nobody answered");
        if (!validDate(c.date)) err(`dr_choices[${i}].date`, "must be a date as YYYY-MM-DD");
        if (typeof c.recommended !== "boolean") err(`dr_choices[${i}].recommended`, "must be true or false");
    });
    a.drills.forEach((d, i) => {
        for (const f of ["scenario", "reference"]) if (!d[f]) err(`drills[${i}].${f}`, "must be a non-empty string");
        if (!validDate(d.date)) err(`drills[${i}].date`, "must be a date as YYYY-MM-DD");
        for (const metric of ["rpo", "rto"]) {
            if (d[metric] !== null && parseDuration(d[metric]) === null) err(`drills[${i}].${metric}`, "use a numeric duration such as 30m or 2h");
        }
        if (d.rpo === null && d.rto === null) err(`drills[${i}]`, "needs a measured rpo or rto");
    });
    for (const [id, values] of Object.entries(a.pattern_inputs)) {
        if (!isObject(values)) err(`pattern_inputs.${id}`, "must be a mapping of input names to values");
        else {
            for (const [name, value] of Object.entries(values)) {
                if (isObject(value) || Array.isArray(value)) err(`pattern_inputs.${id}.${name}`, "must be a scalar: a string, number, boolean or null");
            }
        }
    }
    if (requireComplete) {
        if (a.objectives.tier === null) err("objectives.tier", "is required");
        if (!a.regions.primary) err("regions.primary", "is required");
        if (!a.regions.dr) err("regions.dr", "is required");
        if (!a.inputs.ari_file && a.inputs.live.subscription_ids.length === 0) {
            err("inputs", "needs ari_file or at least one live subscription id");
        }
    }
    return { ok: errors.length === 0, errors };
}

const LIST_FIELDS = [
    ["overrides"],
    ["decisions"],
    ["dr_choices"],
    ["drills"],
    ["objectives", "exceptions"],
    ["inputs", "live", "subscription_ids"],
    ["scope", "resource_groups"],
    ["scope", "subscriptions"],
];

/** A list field that is not a list would normalize to an empty list and be ignored without a word. */
function rawShapeProblems(raw) {
    const problems = [];
    for (const keys of LIST_FIELDS) {
        let value = raw;
        for (const key of keys) value = isObject(value) ? value[key] : undefined;
        if (value !== undefined && value !== null && !Array.isArray(value)) problems.push(`${keys.join(".")}: must be a list`);
    }
    return problems;
}

export async function readAssessment(file, opts = {}) {
    let text;
    try {
        text = await readFile(file, "utf8");
    } catch (err) {
        throw new CliError(EXIT.INPUT, `cannot read ${file}`, [err.message]);
    }
    let raw;
    try {
        raw = parseYaml(text);
    } catch (err) {
        if (err instanceof YamlError) throw new CliError(EXIT.INPUT, `${file} is not valid YAML`, [err.message]);
        throw err;
    }
    const shape = rawShapeProblems(raw);
    if (shape.length > 0) throw new CliError(EXIT.INPUT, `${file} is not a valid assessment`, shape);
    const assessment = normalizeAssessment(raw);
    const result = validateAssessment(assessment, opts);
    if (!result.ok) {
        throw new CliError(EXIT.INPUT, `${file} is not a valid assessment`, result.errors.map((e) => `${e.path}: ${e.message}`));
    }
    return assessment;
}

export function serializeAssessment(a) {
    return stringifyYaml(a);
}

/** A dr_choices entry recorded by nobody: chosen_by "default", in any case (stage 5b writes it in lower case). */
export function isDefaultChoice(chosenBy) {
    return typeof chosenBy === "string" && chosenBy.trim().toLowerCase() === "default";
}
