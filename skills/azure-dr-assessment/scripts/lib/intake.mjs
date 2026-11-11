import path from "node:path";
import { normalizeRegion, parseDuration } from "./assessment.mjs";
import { CliError, EXIT } from "./cli.mjs";
import { slugify } from "./paths.mjs";

const FAILURE_SCOPES = ["zonal", "regional", "wider"];

// A list of regions in one flag: "A, B", "A; B", "A/B", "A & B", "A + B", "A | B", "A and B", "A or B" or one per line. Azure region names contain none of these.
// It is tested on the trimmed value: a line break before or after the value is only whitespace, a line break inside it is a list.
const SEVERAL_REGIONS = /[,;/&+|\r\n]|\s(?:and|or)\s/i;

const ONE_REGION_ONLY = {
    primary: "the primary region is the one region the workload runs in today; if the inventory holds several workloads, narrow it with a scope selector instead",
    dr: "one DR region per run: run the skill again for each other candidate region",
};

const FIELDS = [
    "workload.name",
    "workload.environment",
    "objectives.tier",
    "objectives.rto",
    "objectives.rpo",
    "regions.primary",
    "regions.dr",
    "regions.failure_scope",
    "inputs.ari_file",
    "inputs.live.subscription_ids",
    "inputs.live.tenant_id",
    "scope.resource_groups",
    "scope.tag",
    "scope.subscriptions",
    "options.pause_after_current_state",
];

const read = (object, dotted) => dotted.split(".").reduce((value, key) => value?.[key], object);

const usage = (message, details = []) => new CliError(EXIT.USAGE, message, details);

/** How a path is stored in assessment.yaml: relative to the working directory when the target is below it, else absolute. */
export function storedPath(value, cwd) {
    const absolute = path.resolve(cwd, value);
    const relative = path.relative(cwd, absolute);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative.split(path.sep).join("/") : absolute;
}

/** Merge what the user said (as flags) into an assessment. A flag replaces the field it names; nothing else changes. */
export function applyIntake(assessment, given, { cwd }) {
    const a = structuredClone(assessment);
    if (given.app !== undefined) {
        const name = String(given.app).trim();
        if (!name) throw usage("--app must not be empty");
        a.workload.name = name;
        a.workload.app = slugify(name);
    }
    if (given.environment !== undefined) a.workload.environment = String(given.environment).trim() || null;
    if (given.tier !== undefined) {
        if (!/^[0-3]$/.test(String(given.tier).trim())) throw usage("--tier must be 0, 1, 2 or 3");
        a.objectives.tier = Number(String(given.tier).trim());
    }
    for (const metric of ["rto", "rpo"]) {
        if (given[metric] === undefined) continue;
        if (parseDuration(given[metric]) === null) {
            throw usage(`--${metric} must be a numeric duration such as 30m, 2h or 0`, ['use a number with s, m, h or d; "near zero" is not a number']);
        }
        a.objectives[metric] = String(given[metric]).trim();
    }
    for (const [flag, field] of [["primary", "primary"], ["dr", "dr"]]) {
        if (given[flag] === undefined) continue;
        if (SEVERAL_REGIONS.test(String(given[flag]).trim())) {
            throw usage(`--${flag} names more than one region`, [ONE_REGION_ONLY[flag]]);
        }
        const region = normalizeRegion(given[flag]);
        if (!region) throw usage(`--${flag} must name an Azure region`);
        a.regions[field] = region;
    }
    if (given.failureScope !== undefined) {
        if (!FAILURE_SCOPES.includes(given.failureScope)) throw usage(`--failure-scope must be one of ${FAILURE_SCOPES.join(", ")}`);
        a.regions.failure_scope = given.failureScope;
    }
    if (given.ari !== undefined) a.inputs.ari_file = storedPath(given.ari, cwd);
    if (given.subscriptions !== undefined) {
        const ids = String(given.subscriptions).split(",").map((id) => id.trim()).filter(Boolean);
        if (ids.length === 0) throw usage("--subscriptions needs at least one subscription id");
        a.inputs.live.subscription_ids = ids;
    }
    if (given.tenant !== undefined) a.inputs.live.tenant_id = String(given.tenant).trim() || null;
    if (given.scopeResourceGroups?.length) a.scope.resource_groups = given.scopeResourceGroups.map((name) => name.trim()).filter(Boolean);
    if (given.scopeSubscriptions?.length) a.scope.subscriptions = given.scopeSubscriptions.map((name) => name.trim()).filter(Boolean);
    if (given.scopeTag !== undefined) {
        const at = String(given.scopeTag).indexOf("=");
        const name = at > 0 ? given.scopeTag.slice(0, at).trim() : "";
        const value = at > 0 ? given.scopeTag.slice(at + 1).trim() : "";
        if (!name || !value) throw usage("--scope-tag must be name=value");
        a.scope.tag = { name, value };
    }
    if (given.pauseAfterCurrentState) a.options.pause_after_current_state = true;

    const changes = FIELDS.filter((field) => JSON.stringify(read(a, field)) !== JSON.stringify(read(assessment, field)));
    return { assessment: a, changes };
}

/** What intake still needs from the user. The tier comes first because its question is asked alone. */
export function missingItems(a) {
    const missing = [];
    if (a.objectives.tier === null) missing.push({ field: "objectives.tier", ask: "the landing zone DR tier (the gate question, asked alone and first)" });
    if (!a.regions.primary) missing.push({ field: "regions.primary", ask: "the primary Azure region the workload runs in today" });
    if (!a.regions.dr) missing.push({ field: "regions.dr", ask: "the DR region (it need not be the paired region)" });
    if (!a.inputs.ari_file && a.inputs.live.subscription_ids.length === 0) {
        missing.push({ field: "inputs", ask: "the inventory source: an ARI .xlsx file, or Azure subscription ids for a read-only live read" });
    }
    return missing;
}
