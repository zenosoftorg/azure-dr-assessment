import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CliError, EXIT } from "./cli.mjs";
import { defaultPatternsDir, repoRoot } from "./paths.mjs";
import { parseFrontMatter, YamlError } from "./yaml.mjs";

/** The decision slot vocabulary (contracts 7.6), in this order. */
export const SLOT_IDS = [
    "objectives",
    "traffic-dns",
    "ingress",
    "compute",
    "data-replication.relational",
    "data-replication.nosql",
    "data-replication.storage",
    "data-replication.messaging",
    "data-replication.vm-disks",
    "data-replication.cache",
    "secrets-keys",
    "identity",
    "backup",
    "connectivity",
    "detection",
    "failover-approval",
    "testing",
];
export const STATUSES = ["draft", "approved", "deprecated", "superseded"];
export const OVERRIDE_LEVELS = ["overridable", "approval-required", "locked"];
export const SCENARIOS = ["zonal", "regional", "wider"];
export const APPLIES_TO_KEYS = ["workloads", "environments", "tiers", "scenarios"];
export const FIXED_SECTIONS = ["Required behavior", "Rationale", "Diagram elements", "Runbook steps", "Verification"];
export const OPTIONAL_SECTIONS = ["Mandatory first step", "Required response structure", "Boundaries"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const word = (v) => (typeof v === "string" ? v : "");
const lower = (v) => String(v).toLowerCase();
const show = (values) => `[${values.join(", ")}]`;

/** Split a markdown body into its "## " sections: title, 1-based file line and trimmed text. Headings inside code fences are ignored. */
export function splitSections(body, bodyStartLine = 1) {
    const sections = [];
    let fence = null;
    String(body).split(/\r?\n/).forEach((line, index) => {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
        let isHeading = false;
        if (fence === null) {
            if (marker) fence = marker;
            else isHeading = /^##\s+\S/.test(line);
        } else if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
            fence = null;
        }
        if (isHeading) sections.push({ title: line.replace(/^##\s+/, "").trim(), line: bodyStartLine + index, lines: [] });
        else if (sections.length > 0) sections.at(-1).lines.push(line);
    });
    return sections.map(({ title, line, lines }) => ({ title, line, text: lines.join("\n").trim() }));
}

/** The first blockquote of a text, with the "> " markers removed and the lines joined by newlines. */
export function firstBlockquote(text) {
    const lines = String(text).split(/\r?\n/);
    const start = lines.findIndex((line) => /^ {0,3}>/.test(line));
    if (start < 0) return null;
    const quoted = [];
    for (let i = start; i < lines.length && /^ {0,3}>/.test(lines[i]); i++) quoted.push(lines[i].replace(/^ {0,3}> ?/, ""));
    return quoted.join("\n").trim() || null;
}

/** Parse a pattern file: raw front matter plus its sections. Null without front matter; throws YamlError on bad YAML. */
export function readPatternSource(markdown) {
    const parsed = parseFrontMatter(markdown);
    if (parsed === null) return null;
    return {
        data: parsed.data,
        body: parsed.body,
        bodyStartLine: parsed.bodyStartLine,
        sections: splitSections(parsed.body, parsed.bodyStartLine),
    };
}

function toPattern(source, file) {
    const d = source.data;
    const at = isObject(d.applies_to) ? d.applies_to : {};
    const appliesTo = {};
    for (const key of APPLIES_TO_KEYS) {
        const values = key === "tiers" ? (Array.isArray(at.tiers) ? at.tiers.filter(Number.isInteger) : []) : strings(at[key]);
        if (values.length > 0) appliesTo[key] = values;
    }
    const titles = new Map();
    for (const section of source.sections) if (!titles.has(section.title)) titles.set(section.title, section.text);
    return {
        id: word(d.id),
        version: Number.isInteger(d.version) ? d.version : 0,
        status: word(d.status),
        slots: strings(d.slots),
        override: word(d.override),
        applies_to: appliesTo,
        supersedes: strings(d.supersedes),
        owner_role: word(d.owner_role),
        inputs: Array.isArray(d.inputs)
            ? d.inputs.filter(isObject).map((i) => ({ name: word(i.name), description: word(i.description), required: i.required === true }))
            : [],
        parameters: isObject(d.parameters) ? d.parameters : {},
        file,
        sections: Object.fromEntries(titles),
        gate: titles.has("Mandatory first step") && firstBlockquote(titles.get("Mandatory first step"))
            ? { question: firstBlockquote(titles.get("Mandatory first step")) }
            : null,
    };
}

/** Read every pattern file in a folder. Returns the pack and each file's raw source (the lint rules use it). */
export async function readPack(dir, opts = {}) {
    const abs = path.resolve(dir);
    let names;
    try {
        names = await readdir(abs);
    } catch (err) {
        throw new CliError(EXIT.INPUT, `cannot read the pattern pack ${dir}`, [err.message]);
    }
    const files = names.filter((name) => /\.md$/i.test(name) && name.toLowerCase() !== "readme.md").sort();
    const pack = { dir: abs, isDefault: opts.isDefault ?? abs === defaultPatternsDir(), patterns: [], byId: new Map(), findings: [] };
    const sources = new Map();
    for (const file of files) {
        const problem = (rule, message) => pack.findings.push({ severity: "error", rule, file, id: null, message });
        let markdown;
        try {
            markdown = await readFile(path.join(abs, file), "utf8");
        } catch (err) {
            problem("unreadable-file", `cannot read the file: ${err.message}`);
            continue;
        }
        let source;
        try {
            source = readPatternSource(markdown);
        } catch (err) {
            if (!(err instanceof YamlError)) throw err;
            problem("front-matter-invalid", err.message);
            continue;
        }
        if (source === null) {
            problem("front-matter-missing", "the file has no front matter (a leading --- block)");
            continue;
        }
        if (!isObject(source.data)) {
            problem("front-matter-invalid", "front matter must be a mapping of fields");
            continue;
        }
        const pattern = toPattern(source, file);
        sources.set(file, source);
        pack.patterns.push(pattern);
        if (pattern.id !== "" && !pack.byId.has(pattern.id)) pack.byId.set(pattern.id, pattern);
    }
    return { pack, sources };
}

export async function loadPack(dir, opts = {}) {
    return (await readPack(dir, opts)).pack;
}

/**
 * Whether a pattern is in force for an assessment: approved, and every applies_to key that is present matches.
 * An unknown workload name or environment never switches a binding pattern off: the pattern applies and the reason says so.
 */
export function applies(pattern, a) {
    if (pattern.status !== "approved") {
        return { applies: false, reason: `status is ${pattern.status || "missing"}; only approved patterns apply` };
    }
    const at = pattern.applies_to ?? {};
    const no = (reason) => ({ applies: false, reason });
    const unknown = [];
    if (at.workloads?.length) {
        const names = [a.workload.name, a.workload.app].filter(Boolean).map(lower);
        if (names.length === 0) {
            unknown.push(`workload.name is not set: applied because the pattern is restricted to workloads ${show(at.workloads)}`);
        } else if (!at.workloads.some((w) => names.includes(lower(w)))) {
            return no(`workloads ${show(at.workloads)} do not include ${a.workload.name || a.workload.app}`);
        }
    }
    if (at.environments?.length) {
        const environment = a.workload.environment;
        if (!environment) {
            unknown.push(`workload.environment is not set: applied because the pattern is restricted to environments ${show(at.environments)}`);
        } else if (!at.environments.some((e) => lower(e) === lower(environment))) {
            return no(`environments ${show(at.environments)} do not include ${environment}`);
        }
    }
    if (at.tiers?.length) {
        const tier = a.objectives.tier;
        if (tier === null) return no(`applies only to tiers ${show(at.tiers)}; objectives.tier is not set`);
        if (!at.tiers.includes(tier)) return no(`tiers ${show(at.tiers)} do not include tier ${tier}`);
    }
    if (at.scenarios?.length && !at.scenarios.includes(a.regions.failure_scope)) {
        return no(`scenarios ${show(at.scenarios)} do not include ${a.regions.failure_scope}`);
    }
    return { applies: true, reason: unknown.length > 0 ? unknown.join("; ") : "approved and applicable" };
}

/** Whether two applies_to ranges can overlap: every key present in both has intersecting values; an omitted key means all. */
export function rangesOverlap(a, b) {
    for (const key of APPLIES_TO_KEYS) {
        const left = a[key];
        const right = b[key];
        if (!left?.length || !right?.length) continue;
        const normalize = (v) => (typeof v === "string" ? v.toLowerCase() : v);
        const wanted = new Set(left.map(normalize));
        if (!right.some((v) => wanted.has(normalize(v)))) return false;
    }
    return true;
}

/** The supersedes graph: reaches(a, b) is true when a supersedes b directly or through a chain. A pattern in a cycle reaches itself. */
export function supersedesIndex(patterns) {
    const direct = new Map(patterns.map((p) => [p.id, p.supersedes]));
    const memo = new Map();
    function reachable(id) {
        if (!memo.has(id)) {
            const seen = new Set();
            const stack = [...(direct.get(id) ?? [])];
            while (stack.length > 0) {
                const next = stack.pop();
                if (seen.has(next)) continue;
                seen.add(next);
                stack.push(...(direct.get(next) ?? []));
            }
            memo.set(id, seen);
        }
        return memo.get(id);
    }
    return { reaches: (from, to) => reachable(from).has(to), reachable };
}

/** The pack folder as shown in output: repository-relative with "/" inside the repository, else absolute. */
export function packDisplayDir(dir) {
    const abs = path.resolve(dir);
    const relative = path.relative(repoRoot(), abs);
    const inside = relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    return (inside ? relative : abs).split(path.sep).join("/");
}

/** The banner text of contracts 7.6 for a non-default pack, else null. Both scripts put it in their output. */
export function packBanner(pack) {
    return pack.isDefault ? null : `NON-DEFAULT PATTERN PACK: ${packDisplayDir(pack.dir)} (test or operator override, not the company pack)`;
}
