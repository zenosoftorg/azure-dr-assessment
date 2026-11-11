import { readFileSync } from "node:fs";
import path from "node:path";
import { CliError, EXIT } from "./cli.mjs";
import { skillRoot } from "./paths.mjs";

export const STALE_AFTER_DAYS = 90;

const LEARN_HOST = "https://learn.microsoft.com";
const RELIABILITY_BASE = `${LEARN_HOST}/en-us/azure/reliability/`;
const CUSTOM_ANCHOR = "custom-multiregion-solutions-for-resiliency";
const TABS = ["built-in", "none", "not-listed"];

/** Order by UTF-16 code unit: the same on every machine, unlike localeCompare, which follows the locale. */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const defaultMapFile = () => path.join(skillRoot(), "assets", "learn-service-map.json");

/** A slug such as reliability-aks (optionally ?pivots=vpn), or an /en-us/ path when the reference page links elsewhere. */
export function articleUrl(article) {
    if (!article) return null;
    return article.startsWith("/") ? `${LEARN_HOST}${article}` : `${RELIABILITY_BASE}${article}`;
}

export function validateLearnMap(map) {
    const errors = [];
    const fail = (at, message) => errors.push({ path: at, message });
    if (map?.schemaVersion !== 1) fail("schemaVersion", "must be 1");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(map?.verifiedOn ?? "") || Number.isNaN(Date.parse(map.verifiedOn))) {
        fail("verifiedOn", "must be a YYYY-MM-DD date");
    }
    if (typeof map?.reference !== "string" || !map.reference.startsWith(`${LEARN_HOST}/`)) {
        fail("reference", "must be a learn.microsoft.com URL");
    }
    if (typeof map?.types !== "object" || map.types === null || Array.isArray(map.types)) {
        fail("types", "must be an object keyed by ARM resource type");
        return { ok: false, errors };
    }
    for (const [armType, entries] of Object.entries(map.types)) {
        const at = `types.${armType}`;
        if (!/^microsoft\.[a-z0-9]+(\/[a-z0-9]+)+$/.test(armType)) fail(at, "key must be a lowercase ARM resource type");
        if (!Array.isArray(entries) || entries.length === 0) {
            fail(at, "must be a non-empty array");
            continue;
        }
        const seen = new Set();
        entries.forEach((entry, i) => {
            const here = `${at}[${i}]`;
            if (typeof entry?.service !== "string" || !entry.service.trim()) {
                fail(`${here}.service`, "must be the Service name as the reference page shows it");
            } else if (seen.has(entry.service)) {
                fail(`${here}.service`, `duplicate service "${entry.service}"`);
            } else {
                seen.add(entry.service);
            }
            if (!TABS.includes(entry?.tab)) fail(`${here}.tab`, `must be one of ${TABS.join(", ")}`);
            const article = entry?.article;
            const slug = typeof article === "string" && /^reliability-[a-z0-9-]+(\?pivots=[a-z-]+)?$/.test(article);
            const docsPath = typeof article === "string" && /^\/en-us\/[a-z0-9/-]+$/.test(article);
            if (article !== null && !slug && !docsPath) {
                fail(`${here}.article`, "must be null, a reliability-<name> slug (optionally ?pivots=<name>) or an /en-us/ path");
            }
            if (entry?.tab === "not-listed" && article !== null) {
                fail(`${here}.article`, "a not-listed service has no reliability article in the reference");
            }
            if (entry?.customAnchor !== undefined && typeof entry.customAnchor !== "boolean") {
                fail(`${here}.customAnchor`, "must be a boolean");
            } else if (entry?.customAnchor && article === null) {
                fail(`${here}.customAnchor`, "needs an article");
            }
            if (entry?.when !== undefined && (typeof entry.when !== "string" || !entry.when.trim())) {
                fail(`${here}.when`, "must be a non-empty string");
            }
        });
    }
    return { ok: errors.length === 0, errors };
}

export function loadLearnMap(file = defaultMapFile()) {
    let map;
    try {
        map = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
        throw new CliError(EXIT.INPUT, "cannot read the Learn service map", [`${file}: ${err.message}`]);
    }
    const { ok, errors } = validateLearnMap(map);
    if (!ok) throw new CliError(EXIT.INPUT, "the Learn service map is invalid", errors.map((error) => `${error.path}: ${error.message}`));
    return map;
}

export function lookupServices(map, armType) {
    const key = String(armType).toLowerCase();
    const entries = Object.hasOwn(map.types, key) ? map.types[key] : [];
    return entries.map((entry) => {
        const url = articleUrl(entry.article);
        return { ...entry, articleUrl: url, customSolutionsUrl: entry.customAnchor && url ? `${url}#${CUSTOM_ANCHOR}` : null };
    });
}

export function catalogueAge(map, now = new Date()) {
    const ageDays = Math.floor((now.getTime() - Date.parse(`${map.verifiedOn}T00:00:00Z`)) / 86_400_000);
    return { verifiedOn: map.verifiedOn, ageDays, stale: ageDays > STALE_AFTER_DAYS };
}

/** The distinct resource types of an inventory with their counts and catalogue hints, most frequent first, ties in code-unit order. */
export function typeHints(resources, map) {
    const counts = new Map();
    for (const resource of resources) {
        if (!resource.armType) continue;
        const armType = resource.armType.toLowerCase();
        counts.set(armType, (counts.get(armType) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([armType, count]) => {
            const learn = lookupServices(map, armType);
            return { armType, count, mapped: learn.length > 0, learn };
        })
        .sort((a, b) => b.count - a.count || byCodeUnit(a.armType, b.armType));
}
