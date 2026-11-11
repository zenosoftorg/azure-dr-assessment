import { parseDuration } from "./assessment.mjs";
import { CliError, EXIT } from "./cli.mjs";

export const TIER_PATTERN_ID = "DR-TIER-001";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** 1800 -> "30m", 7200 -> "2h", 0 -> "0": whole hours or minutes when exact, else seconds. */
export function formatSeconds(seconds) {
    if (seconds === 0) return "0";
    if (seconds % 3600 === 0) return `${seconds / 3600}h`;
    if (seconds % 60 === 0) return `${seconds / 60}m`;
    return `${seconds}s`;
}

function readBand(value, at, tier, problems) {
    const band = { minSeconds: null, maxSeconds: null };
    if (!isObject(value)) {
        problems.push(`${at}: must be a mapping with min and max`);
        return band;
    }
    for (const [key, field] of [["min", "minSeconds"], ["max", "maxSeconds"]]) {
        const raw = value[key];
        if (raw === null || raw === undefined) {
            if (key === "min" && tier >= 1) problems.push(`${at}.min: tiers 1 to 3 need a lower bound`);
            continue;
        }
        const seconds = parseDuration(raw);
        if (seconds === null) problems.push(`${at}.${key}: expected a duration such as 30m, or null, got ${JSON.stringify(raw)}`);
        else band[field] = seconds;
    }
    if (band.minSeconds !== null && band.maxSeconds !== null && band.minSeconds > band.maxSeconds) problems.push(`${at}: min is above max`);
    return band;
}

/** The tier bands that DR-TIER-001 stores under parameters.tiers, in seconds. Empty when the pack has no DR-TIER-001. */
export function tierBands(pack) {
    const pattern = pack.byId.get(TIER_PATTERN_ID);
    if (!pattern) return [];
    const tiers = pattern.parameters.tiers;
    const problems = [];
    const bands = [];
    if (!isObject(tiers)) {
        problems.push("parameters.tiers: must be a mapping keyed 0 to 3");
    } else {
        for (const tier of [0, 1, 2, 3]) {
            const entry = tiers[tier];
            const at = `parameters.tiers.${tier}`;
            if (!isObject(entry)) {
                problems.push(`${at}: missing`);
                continue;
            }
            if (typeof entry.pattern !== "string" || entry.pattern.trim() === "") problems.push(`${at}.pattern: must be a non-empty string`);
            if (typeof entry.cost !== "string" || entry.cost.trim() === "") problems.push(`${at}.cost: must be a non-empty string`);
            const rpo = readBand(entry.rpo, `${at}.rpo`, tier, problems);
            const rto = readBand(entry.rto, `${at}.rto`, tier, problems);
            bands.push({ tier, pattern: entry.pattern, rpo, rto, cost: entry.cost });
        }
    }
    if (problems.length > 0) throw new CliError(EXIT.INPUT, `${TIER_PATTERN_ID} has invalid parameters.tiers`, problems);
    return bands;
}

/** Numeric targets below the lower bound of the chosen tier, and whether an exception is recorded. */
export function checkTargets(a, pack) {
    const excepted = a.objectives.exceptions.length > 0;
    const tier = a.objectives.tier;
    const band = tier === null ? undefined : tierBands(pack).find((b) => b.tier === tier);
    const stricter = [];
    if (band) {
        for (const metric of ["rpo", "rto"]) {
            const targetSeconds = parseDuration(a.objectives[metric]);
            const tierMinSeconds = band[metric].minSeconds;
            if (targetSeconds !== null && tierMinSeconds !== null && targetSeconds < tierMinSeconds) {
                stricter.push({ metric, targetSeconds, tierMinSeconds });
            }
        }
    }
    return { stricter, excepted };
}
