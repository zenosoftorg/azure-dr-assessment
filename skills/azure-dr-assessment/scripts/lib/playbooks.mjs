import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseDuration } from "./assessment.mjs";
import { CliError, EXIT } from "./cli.mjs";
import { defaultPlaybooksDir } from "./paths.mjs";
import { splitSections } from "./patterns.mjs";
import { parseFrontMatter, YamlError } from "./yaml.mjs";

export const PLAYBOOK_SECTIONS = ["Mechanisms", "Constraints", "Non-paired options", "Migration from a paired setup", "Failover and failback", "Test criteria"];
export const MECHANISM_FIELDS = ["Replicates", "Paired", "Nonpaired", "Failover", "Estimated RPO", "Estimated RTO", "Source"];
export const OPTION_FIELDS = ["Kind", "Target", "Uses mechanism", "Estimated RPO", "Estimated RTO", "Prerequisites", "Cost notes", "Gives up", "Recommended when", "Source"];
/** Fields an option may carry. `Decides slots`: the slot ids the option decides itself (its traffic switch, for example); a slot that a company pattern decides vetoes it (GC-11). */
export const OPTIONAL_OPTION_FIELDS = ["Decides slots"];
export const OPTION_KINDS = ["native", "workaround", "split-region", "backup-restore"];
export const OPTION_TARGETS = ["dr-region", "pair-region"];
export const FAILOVER_MODES = ["Microsoft-managed", "customer-managed", "manual", "not applicable"];
export const MIGRATION_PARTS = ["Recognise today's setup", "Build", "Validate", "Cut over", "Decommission", "Keep until cut-over"];
export const STEP_PARTS = ["Failover", "Failback"];
export const STEP_COLUMNS = ["#", "Step", "Role", "Estimated duration", "Verification", "Abort condition"];
export const TEST_FIELDS = ["Applies to", "Pass condition", "How to measure", "Evidence", "Frequency"];
export const RESERVED_OPTION_ID = "accept-gap";
export const LEARN_PREFIX = "https://learn.microsoft.com/";

/** The front matter fields of a playbook, all required (contracts 5.2). */
export const FRONT_MATTER_FIELDS = ["service", "title", "arm_types", "slot", "version", "verified_on", "learn_sources"];
/** A kebab-case slug: the service name and every option id. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ARM_TYPE = /^[a-z0-9.]+\/[a-z0-9./]+$/;
const LIST_PARTS = ["Build", "Validate", "Cut over", "Decommission"];
const PART_KEYS = {
    "Recognise today's setup": "recognise",
    Build: "build",
    Validate: "validate",
    "Cut over": "cutOver",
    Decommission: "decommission",
    "Keep until cut-over": "keep",
};
const STEP_KEYS = ["n", "step", "role", "duration", "verification", "abort"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const word = (v) => (typeof v === "string" ? v : "");
const filled = (v) => typeof v === "string" && v.trim() !== "";
const show = (v) => JSON.stringify(v) ?? String(v);

/** A real calendar date written as YYYY-MM-DD ("2026-02-30" and "2026-2-3" are not). */
export function isIsoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The leading duration of an estimate in seconds (`15m (the sync interval)` is 900), or null for `unknown` and anything else. */
export function estimateSeconds(text) {
    const s = String(text ?? "").trim();
    const match = /^(\d+(?:\.\d+)?\s*[smhd])(?![A-Za-z0-9])/i.exec(s);
    if (match) return parseDuration(match[1]);
    return /^0(?![A-Za-z0-9.])/.test(s) ? 0 : null;
}

/** Whether an estimate starts with a duration or with the word unknown. */
export function isEstimate(text) {
    const s = String(text ?? "").trim();
    return estimateSeconds(s) !== null || /^unknown(?![A-Za-z0-9])/i.test(s);
}

/** Whether a text is one https://learn.microsoft.com/ URL. */
export function isLearnUrl(url) {
    return typeof url === "string" && url.startsWith(LEARN_PREFIX) && !/\s/.test(url);
}

/** Split a section's text into its "### " entries. Headings inside code fences are ignored; text before the first heading is the preamble. */
function splitEntries(text) {
    const entries = [];
    const preamble = [];
    let fence = null;
    for (const line of String(text).split(/\r?\n/)) {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
        let isHeading = false;
        if (fence === null) {
            if (marker) fence = marker;
            else isHeading = /^###\s+\S/.test(line);
        } else if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
            fence = null;
        }
        if (isHeading) entries.push({ heading: line.replace(/^###\s+/, "").trim(), lines: [] });
        else if (entries.length > 0) entries.at(-1).lines.push(line);
        else preamble.push(line);
    }
    return { preamble: preamble.join("\n").trim(), entries };
}

/** The "- Key: value" lines of an entry. A key that appears twice is listed in `duplicates`; its first value wins. */
function readFields(lines) {
    const fields = new Map();
    const duplicates = [];
    for (const line of lines) {
        const match = /^- ([A-Za-z][A-Za-z ]*?):(?:\s+(.*))?$/.exec(line);
        if (!match) continue;
        if (fields.has(match[1])) duplicates.push(match[1]);
        else fields.set(match[1], (match[2] ?? "").trim());
    }
    return { fields, duplicates };
}

/** Report missing, empty, unknown and repeated fields of one entry. */
function checkFields(what, { fields, duplicates }, expected, rule, problem, optional = []) {
    for (const key of expected) {
        if (!fields.has(key)) problem(rule, `${what} has no "${key}" field`);
        else if (fields.get(key) === "") problem(rule, `${what} has an empty "${key}" field`);
    }
    for (const key of optional) {
        if (fields.has(key) && fields.get(key) === "") problem(rule, `${what} has an empty "${key}" field`);
    }
    for (const key of fields.keys()) {
        if (!expected.includes(key) && !optional.includes(key)) problem(rule, `${what} has the unknown field "${key}"; the fields are ${[...expected, ...optional].join(", ")}`);
    }
    for (const key of duplicates) problem(rule, `${what} has the field "${key}" twice`);
}

function yesNo(value) {
    const v = String(value ?? "").trim().toLowerCase();
    return v === "yes" ? true : v === "no" ? false : null;
}

function checkFrontMatter(d, problem) {
    for (const key of Object.keys(d)) {
        if (!FRONT_MATTER_FIELDS.includes(key)) problem("field-invalid", `unknown front matter field "${key}"; the fields are ${FRONT_MATTER_FIELDS.join(", ")}`);
    }
    const present = (key) => d[key] !== undefined && d[key] !== null;
    for (const key of FRONT_MATTER_FIELDS) {
        if (!present(key)) problem("field-missing", `missing front matter field "${key}"`);
    }
    if (present("service") && !(typeof d.service === "string" && SLUG.test(d.service))) {
        problem("field-invalid", `service ${show(d.service)} must be a kebab-case slug such as key-vault`);
    }
    if (present("title") && !filled(d.title)) problem("field-invalid", "title must be a non-empty string");
    if (present("arm_types")) {
        const list = d.arm_types;
        if (!Array.isArray(list) || list.length === 0 || !list.every((t) => typeof t === "string" && ARM_TYPE.test(t))) {
            problem("field-invalid", "arm_types must be a non-empty list of lowercase ARM types such as microsoft.keyvault/vaults");
        } else if (new Set(list).size !== list.length) {
            problem("field-invalid", "arm_types lists a type twice");
        }
    }
    if (present("slot") && !filled(d.slot)) problem("field-invalid", "slot must be a slot id such as secrets-keys");
    if (present("version") && !(Number.isInteger(d.version) && d.version >= 1)) {
        problem("field-invalid", `version ${show(d.version)} must be an integer of at least 1`);
    }
    if (present("verified_on") && !isIsoDate(d.verified_on)) problem("field-invalid", `verified_on ${show(d.verified_on)} must be a date as YYYY-MM-DD`);
    if (present("learn_sources")) {
        const list = d.learn_sources;
        if (!Array.isArray(list) || list.length === 0 || !list.every(filled)) {
            problem("field-invalid", "learn_sources must be a non-empty list of URLs");
        } else if (new Set(list).size !== list.length) {
            problem("field-invalid", "learn_sources lists a URL twice");
        }
    }
}

function checkSections(sections, problem) {
    const seen = new Set();
    for (const section of sections) {
        if (seen.has(section.title)) problem("section-order", `section "${section.title}" appears twice (line ${section.line})`);
        seen.add(section.title);
        if (!PLAYBOOK_SECTIONS.includes(section.title)) {
            problem("section-unknown", `unknown section "${section.title}" (line ${section.line}); the sections are ${PLAYBOOK_SECTIONS.join(", ")}`);
        }
    }
    for (const title of PLAYBOOK_SECTIONS) {
        if (!seen.has(title)) problem("section-missing", `missing section "## ${title}"`);
    }
    const found = [...new Set(sections.map((s) => s.title).filter((t) => PLAYBOOK_SECTIONS.includes(t)))];
    const expected = PLAYBOOK_SECTIONS.filter((t) => found.includes(t));
    if (found.join("|") !== expected.join("|")) {
        problem("section-order", `sections are out of order; expected ${expected.join(", ")} but found ${found.join(", ")}`);
    }
}

function parseMechanisms(text, problem) {
    const { entries } = splitEntries(text);
    if (entries.length === 0) problem("mechanism-field", "the Mechanisms section has no mechanism (### <mechanism name>)");
    const names = new Set();
    return entries.map((entry) => {
        const what = `mechanism "${entry.heading}"`;
        if (names.has(entry.heading.toLowerCase())) problem("mechanism-field", `${what} appears twice`);
        names.add(entry.heading.toLowerCase());
        const read = readFields(entry.lines);
        checkFields(what, read, MECHANISM_FIELDS, "mechanism-field", problem);
        const value = (key) => read.fields.get(key) ?? "";
        const mechanism = {
            name: entry.heading,
            replicates: value("Replicates"),
            paired: yesNo(value("Paired")),
            nonpaired: yesNo(value("Nonpaired")),
            failover: value("Failover"),
            rpo: value("Estimated RPO"),
            rto: value("Estimated RTO"),
            source: value("Source"),
        };
        for (const [key, parsed] of [["Paired", mechanism.paired], ["Nonpaired", mechanism.nonpaired]]) {
            if (value(key) !== "" && parsed === null) problem("mechanism-field", `${what}: ${key} must be yes or no`);
        }
        if (mechanism.failover !== "" && !FAILOVER_MODES.includes(mechanism.failover)) {
            problem("mechanism-field", `${what}: Failover must be one of ${FAILOVER_MODES.join(", ")}`);
        }
        for (const key of ["Estimated RPO", "Estimated RTO"]) {
            if (value(key) !== "" && !isEstimate(value(key))) problem("mechanism-field", `${what}: ${key} must start with a duration such as 30m or with unknown`);
        }
        return mechanism;
    });
}

function parseConstraints(text, problem) {
    const { entries } = splitEntries(text);
    if (entries.length === 0) problem("constraint-source", "the Constraints section has no constraint (### <constraint heading>)");
    const headings = new Set();
    return entries.map((entry) => {
        const what = `constraint "${entry.heading}"`;
        if (headings.has(entry.heading)) problem("constraint-source", `${what} appears twice`);
        headings.add(entry.heading);
        const sources = entry.lines.map((line) => /^- Source:(?:\s+(.*))?$/.exec(line)).filter(Boolean).map((m) => (m[1] ?? "").trim());
        const prose = entry.lines.filter((line) => !/^- Source:/.test(line)).join("\n").trim();
        if (prose === "") problem("constraint-source", `${what} has no text`);
        if (sources.length === 0 || sources[0] === "") problem("constraint-source", `${what} has no "- Source: <url>" line`);
        else if (sources.length > 1) problem("constraint-source", `${what} has more than one Source line`);
        return { heading: entry.heading, text: prose, source: sources[0] ?? "" };
    });
}

function parseOptions(text, problem) {
    const { entries } = splitEntries(text);
    if (entries.length === 0) problem("option-field", "the Non-paired options section has no option (### <option id>: <option title>)");
    const ids = new Set();
    return entries.map((entry, index) => {
        const colon = entry.heading.indexOf(": ");
        const id = colon < 0 ? "" : entry.heading.slice(0, colon).trim();
        const title = colon < 0 ? entry.heading : entry.heading.slice(colon + 2).trim();
        if (colon < 0 || title === "") {
            problem("option-id", `option heading "${entry.heading}" must be "<option id>: <option title>"`);
        } else if (!SLUG.test(id)) {
            problem("option-id", `option id "${id}" must be a kebab-case slug`);
        } else if (id === RESERVED_OPTION_ID) {
            problem("option-id", `option id "${RESERVED_OPTION_ID}" is reserved for accepting the gap`);
        } else if (ids.has(id)) {
            problem("option-id", `option id "${id}" appears twice`);
        }
        ids.add(id);
        const read = readFields(entry.lines);
        checkFields(`option "${id || entry.heading}"`, read, OPTION_FIELDS, "option-field", problem, OPTIONAL_OPTION_FIELDS);
        const value = (key) => read.fields.get(key) ?? "";
        return {
            id,
            title,
            rank: index + 1,
            kind: value("Kind"),
            target: value("Target"),
            usesMechanism: value("Uses mechanism"),
            rpo: value("Estimated RPO"),
            rto: value("Estimated RTO"),
            rpoSeconds: estimateSeconds(value("Estimated RPO")),
            rtoSeconds: estimateSeconds(value("Estimated RTO")),
            prerequisites: value("Prerequisites"),
            costNotes: value("Cost notes"),
            givesUp: value("Gives up"),
            recommendedWhen: value("Recommended when"),
            source: value("Source"),
            decidesSlots: value("Decides slots").split(",").map((slot) => slot.trim()).filter(Boolean),
        };
    });
}

function parseMigration(text, problem) {
    const { entries } = splitEntries(text);
    const migration = { recognise: "", build: [], validate: [], cutOver: [], decommission: [], keep: "" };
    const seen = new Set();
    for (const entry of entries) {
        if (!MIGRATION_PARTS.includes(entry.heading)) {
            problem("part-missing", `unknown part "### ${entry.heading}" in Migration from a paired setup; the parts are ${MIGRATION_PARTS.join(", ")}`);
            continue;
        }
        if (seen.has(entry.heading)) {
            problem("part-missing", `part "### ${entry.heading}" appears twice`);
            continue;
        }
        seen.add(entry.heading);
        const key = PART_KEYS[entry.heading];
        if (LIST_PARTS.includes(entry.heading)) {
            migration[key] = entry.lines.map((line) => /^\d+\.\s+(\S.*)$/.exec(line)?.[1].trim()).filter(Boolean);
            if (migration[key].length === 0) problem("part-missing", `part "### ${entry.heading}" needs a numbered list (1. <step>)`);
        } else {
            migration[key] = entry.lines.join("\n").trim();
            if (migration[key] === "") problem("part-missing", `part "### ${entry.heading}" is empty`);
        }
    }
    for (const part of MIGRATION_PARTS) {
        if (!seen.has(part)) problem("part-missing", `missing part "### ${part}" in Migration from a paired setup`);
    }
    const found = entries.map((e) => e.heading).filter((h, i, all) => MIGRATION_PARTS.includes(h) && all.indexOf(h) === i);
    if (found.join("|") !== MIGRATION_PARTS.filter((p) => found.includes(p)).join("|")) {
        problem("part-missing", `the parts of Migration from a paired setup are out of order; expected ${MIGRATION_PARTS.join(", ")}`);
    }
    return migration;
}

/** The cells of a Markdown table row; "\|" stays a literal bar inside a cell. */
function cells(line) {
    return line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function parseStepTable(part, lines, problem) {
    const rows = lines.filter((line) => line.trim().startsWith("|"));
    const what = `the ${part} table`;
    if (rows.length === 0) {
        problem("steps-table", `### ${part} needs a table with the columns ${STEP_COLUMNS.join(" | ")}`);
        return [];
    }
    if (cells(rows[0]).join("|") !== STEP_COLUMNS.join("|")) {
        problem("steps-table", `${what} must have exactly the header | ${STEP_COLUMNS.join(" | ")} |`);
        return [];
    }
    if (rows.length < 2 || !cells(rows[1]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
        problem("steps-table", `${what} needs a separator row under its header`);
        return [];
    }
    const data = rows.slice(2);
    if (data.length === 0) problem("steps-table", `${what} has no step`);
    return data.map((row, i) => {
        const values = cells(row);
        if (values.length !== STEP_COLUMNS.length) {
            problem("steps-table", `${what}, row ${i + 1}: has ${values.length} cells, expected ${STEP_COLUMNS.length}`);
        }
        STEP_COLUMNS.forEach((column, c) => {
            if (!filled(values[c])) problem("steps-table", `${what}, row ${i + 1}: the cell "${column}" is empty`);
        });
        if (filled(values[3]) && !/^Estimated\b/.test(values[3])) {
            problem("steps-table", `${what}, row ${i + 1}: the Estimated duration must start with the word Estimated`);
        }
        return Object.fromEntries(STEP_KEYS.map((key, c) => [key, values[c] ?? ""]));
    });
}

function parseSteps(text, problem) {
    const { entries } = splitEntries(text);
    const steps = { failover: [], failback: [] };
    for (const entry of entries) {
        if (!STEP_PARTS.includes(entry.heading)) problem("steps-table", `unknown part "### ${entry.heading}" in Failover and failback; the parts are ${STEP_PARTS.join(", ")}`);
    }
    for (const part of STEP_PARTS) {
        const entry = entries.find((e) => e.heading === part);
        if (!entry) problem("steps-table", `missing part "### ${part}" in Failover and failback`);
        else steps[part.toLowerCase()] = parseStepTable(part, entry.lines, problem);
    }
    return steps;
}

function parseTests(text, problem) {
    const { entries } = splitEntries(text);
    if (entries.length === 0) problem("test-field", "the Test criteria section has no criterion (### TC-<n>: <title>)");
    return entries.map((entry, index) => {
        const match = /^TC-(\d+):\s+(\S.*)$/.exec(entry.heading);
        if (!match) problem("test-numbering", `test criterion heading "${entry.heading}" must be "TC-<n>: <title>"`);
        else if (Number(match[1]) !== index + 1) problem("test-numbering", `TC-${match[1]} is criterion ${index + 1}; number the criteria 1, 2, 3 without gaps`);
        const id = match ? `TC-${match[1]}` : entry.heading;
        const read = readFields(entry.lines);
        checkFields(`test criterion "${id}"`, read, TEST_FIELDS, "test-field", problem);
        const value = (key) => read.fields.get(key) ?? "";
        return {
            id,
            title: match ? match[2].trim() : "",
            appliesTo: value("Applies to").split(",").map((s) => s.trim()).filter(Boolean),
            passCondition: value("Pass condition"),
            howToMeasure: value("How to measure"),
            evidence: value("Evidence"),
            frequency: value("Frequency"),
        };
    });
}

/**
 * Parse one playbook file. `problems` lists the grammar problems as { rule, message }; `playbook` is null only when
 * the file has no front matter mapping. Wrong-typed front matter never throws: it normalizes to "", 0 or [].
 */
export function parsePlaybook(markdown, file) {
    const problems = [];
    const problem = (rule, message) => problems.push({ rule, message });
    let parsed;
    try {
        parsed = parseFrontMatter(markdown);
    } catch (err) {
        if (!(err instanceof YamlError)) throw err;
        problem("front-matter-invalid", err.message);
        return { playbook: null, problems };
    }
    if (parsed === null) {
        problem("front-matter-missing", "the file has no front matter (a leading --- block)");
        return { playbook: null, problems };
    }
    if (!isObject(parsed.data)) {
        problem("front-matter-invalid", "front matter must be a mapping of fields");
        return { playbook: null, problems };
    }
    const d = parsed.data;
    checkFrontMatter(d, problem);
    const sections = splitSections(parsed.body, parsed.bodyStartLine);
    checkSections(sections, problem);
    const text = (title) => sections.find((s) => s.title === title)?.text;
    const each = (title, parse, empty) => (text(title) === undefined ? empty : parse(text(title), problem));
    const playbook = {
        file,
        service: word(d.service),
        title: word(d.title),
        armTypes: strings(d.arm_types),
        slot: word(d.slot),
        version: Number.isInteger(d.version) ? d.version : 0,
        verifiedOn: word(d.verified_on),
        learnSources: strings(d.learn_sources),
        sections,
        mechanisms: each("Mechanisms", parseMechanisms, []),
        constraints: each("Constraints", parseConstraints, []),
        options: each("Non-paired options", parseOptions, []),
        migration: each("Migration from a paired setup", parseMigration, { recognise: "", build: [], validate: [], cutOver: [], decommission: [], keep: "" }),
        steps: each("Failover and failback", parseSteps, { failover: [], failback: [] }),
        tests: each("Test criteria", parseTests, []),
    };
    return { playbook, problems };
}

/**
 * Read every playbook of a folder (every *.md except README.md, sorted by name). `findings` holds one error per file
 * that is unreadable or has no front matter mapping (left out of `playbooks`), and one per grammar problem of a kept file.
 * A duplicate service or ARM type keeps its first playbook in `byService` and `byType`.
 */
export async function readPlaybooks(dir, opts = {}) {
    const abs = path.resolve(dir);
    let names;
    try {
        names = await readdir(abs);
    } catch (err) {
        throw new CliError(EXIT.INPUT, `cannot read the playbook folder ${dir}`, [err.message]);
    }
    const files = names.filter((name) => /\.md$/i.test(name) && name.toLowerCase() !== "readme.md").sort();
    const set = { dir: abs, isDefault: opts.isDefault ?? abs === defaultPlaybooksDir(), playbooks: [], byService: new Map(), byType: new Map() };
    const findings = [];
    for (const file of files) {
        let markdown;
        try {
            markdown = await readFile(path.join(abs, file), "utf8");
        } catch (err) {
            findings.push({ severity: "error", rule: "unreadable-file", file, service: null, message: `cannot read the file: ${err.message}` });
            continue;
        }
        const { playbook, problems } = parsePlaybook(markdown, file);
        for (const { rule, message } of problems) findings.push({ severity: "error", rule, file, service: playbook?.service || null, message });
        if (playbook === null) continue;
        set.playbooks.push(playbook);
        if (playbook.service !== "" && !set.byService.has(playbook.service)) set.byService.set(playbook.service, playbook);
        for (const type of playbook.armTypes) if (!set.byType.has(type)) set.byType.set(type, playbook);
    }
    return { set, findings };
}
