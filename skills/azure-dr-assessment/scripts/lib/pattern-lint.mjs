import {
    APPLIES_TO_KEYS, FIXED_SECTIONS, OPTIONAL_SECTIONS, OVERRIDE_LEVELS, SCENARIOS, SLOT_IDS, STATUSES,
    firstBlockquote, rangesOverlap, supersedesIndex,
} from "./patterns.mjs";

const ID_PATTERN = /^DR-[A-Z]+-\d{3}$/;
const INPUT_NAME = /^[a-z][a-z0-9_]*$/;
const INPUT_KEYS = ["name", "description", "required"];
const FRONT_MATTER_KEYS = ["id", "version", "status", "slots", "override", "applies_to", "supersedes", "owner_role", "inputs", "parameters"];
const REQUIRED_KEYS = ["id", "version", "status", "slots", "override", "supersedes", "owner_role"];
const SECTION_ORDER = [...FIXED_SECTIONS, ...OPTIONAL_SECTIONS];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const filled = (v) => typeof v === "string" && v.trim() !== "";
const present = (v) => v !== undefined && v !== null;
const show = (v) => JSON.stringify(v) ?? String(v);

/** One finding as a single line: "<file>: [<rule>] <message>". */
export function formatFinding(finding) {
    return `${finding.file}: [${finding.rule}] ${finding.message}`;
}

function lintAppliesTo(value, add) {
    if (!present(value)) return;
    if (!isObject(value)) {
        add("error", "applies-to-invalid", "applies_to must be a mapping");
        return;
    }
    for (const [key, values] of Object.entries(value)) {
        if (!APPLIES_TO_KEYS.includes(key)) {
            add("error", "applies-to-invalid", `unknown applies_to key "${key}"; allowed keys: ${APPLIES_TO_KEYS.join(", ")}`);
        } else if (!Array.isArray(values) || values.length === 0) {
            add("error", "applies-to-invalid", `applies_to.${key} must be a non-empty list; omit the key to mean all`);
        } else if (key === "tiers" && !values.every((t) => Number.isInteger(t) && t >= 0 && t <= 3)) {
            add("error", "applies-to-invalid", "applies_to.tiers must list integers from 0 to 3");
        } else if (key === "scenarios" && !values.every((s) => SCENARIOS.includes(s))) {
            add("error", "applies-to-invalid", `applies_to.scenarios may only list ${SCENARIOS.join(", ")}`);
        } else if ((key === "workloads" || key === "environments") && !values.every(filled)) {
            add("error", "applies-to-invalid", `applies_to.${key} must list non-empty strings`);
        }
    }
}

function lintInputs(value, add) {
    if (!present(value)) return;
    if (!Array.isArray(value)) {
        add("error", "inputs-invalid", "inputs must be a list of { name, description, required }");
        return;
    }
    const names = new Set();
    value.forEach((item, i) => {
        const at = `inputs[${i}]`;
        if (!isObject(item)) {
            add("error", "inputs-invalid", `${at} must be a mapping with name, description and required`);
            return;
        }
        for (const key of Object.keys(item)) {
            if (!INPUT_KEYS.includes(key)) add("error", "inputs-invalid", `${at} has the unknown key "${key}"`);
        }
        if (typeof item.name !== "string" || !INPUT_NAME.test(item.name)) {
            add("error", "inputs-invalid", `${at}.name must use lowercase letters, digits and underscores, and start with a letter`);
        } else if (names.has(item.name)) {
            add("error", "inputs-invalid", `${at}.name "${item.name}" is used twice`);
        } else {
            names.add(item.name);
        }
        if (!filled(item.description)) add("error", "inputs-invalid", `${at}.description must be a non-empty string`);
        if (typeof item.required !== "boolean") add("error", "inputs-invalid", `${at}.required must be true or false`);
    });
}

function lintFrontMatter(d, file, add, ids) {
    for (const key of Object.keys(d)) {
        if (!FRONT_MATTER_KEYS.includes(key)) {
            add("error", "front-matter-unknown-key", `unknown front matter key "${key}"; allowed keys: ${FRONT_MATTER_KEYS.join(", ")}`);
        }
    }
    for (const key of REQUIRED_KEYS) {
        if (!present(d[key])) add("error", "front-matter-missing-field", `missing front matter field "${key}"`);
    }
    if (present(d.id)) {
        const stem = file.replace(/\.md$/i, "");
        if (typeof d.id !== "string" || !ID_PATTERN.test(d.id)) {
            add("error", "id-invalid", `id ${show(d.id)} must look like DR-<AREA>-<NNN>, for example DR-DNS-001`);
        } else {
            if (d.id !== stem) add("error", "id-filename-mismatch", `id ${d.id} must equal the file name ${stem}`);
            if (ids.has(d.id)) add("error", "id-duplicate", `id ${d.id} is already used by ${ids.get(d.id)}`);
            else ids.set(d.id, file);
        }
    }
    if (present(d.version) && !(Number.isInteger(d.version) && d.version >= 1)) {
        add("error", "version-invalid", `version ${show(d.version)} must be an integer of at least 1`);
    }
    if (present(d.status) && !STATUSES.includes(d.status)) {
        add("error", "status-invalid", `status ${show(d.status)} must be one of ${STATUSES.join(", ")}`);
    }
    if (present(d.slots)) {
        if (!Array.isArray(d.slots) || d.slots.length === 0 || !d.slots.every(filled)) {
            add("error", "slots-invalid", "slots must be a non-empty list of slot ids");
        } else {
            for (const slot of d.slots) {
                if (!SLOT_IDS.includes(slot)) add("error", "slot-unknown", `slot "${slot}" is not in the slot vocabulary (see patterns/README.md)`);
            }
        }
    }
    if (present(d.override) && !OVERRIDE_LEVELS.includes(d.override)) {
        add("error", "override-invalid", `override ${show(d.override)} must be one of ${OVERRIDE_LEVELS.join(", ")}`);
    }
    lintAppliesTo(d.applies_to, add);
    if (present(d.supersedes) && !(Array.isArray(d.supersedes) && d.supersedes.every((id) => typeof id === "string" && ID_PATTERN.test(id)))) {
        add("error", "supersedes-invalid", "supersedes must be a list of pattern ids");
    }
    if (present(d.owner_role) && !filled(d.owner_role)) add("error", "owner-role-invalid", "owner_role must be a non-empty string");
    lintInputs(d.inputs, add);
    if (present(d.parameters) && !isObject(d.parameters)) add("error", "parameters-invalid", "parameters must be a mapping");
}

function lintSections(source, add) {
    const seen = new Set();
    for (const section of source.sections) {
        if (seen.has(section.title)) add("error", "section-duplicate", `section "${section.title}" appears twice (line ${section.line})`);
        seen.add(section.title);
        if (!SECTION_ORDER.includes(section.title)) {
            add("warning", "section-unknown", `unknown section "${section.title}" (line ${section.line}); the engine ignores it`);
        } else if (section.text === "") {
            add("error", "section-empty", `section "${section.title}" is empty (line ${section.line})`);
        }
    }
    for (const title of FIXED_SECTIONS) {
        if (!seen.has(title)) add("error", "section-missing", `missing section "## ${title}"`);
    }
    const found = [...new Set(source.sections.map((s) => s.title).filter((t) => SECTION_ORDER.includes(t)))];
    const expected = SECTION_ORDER.filter((t) => found.includes(t));
    if (found.join("|") !== expected.join("|")) {
        add("error", "section-order", `sections are out of order; expected ${expected.join(", ")} but found ${found.join(", ")}`);
    }
    const gate = source.sections.find((s) => s.title === "Mandatory first step");
    if (gate && firstBlockquote(gate.text) === null) {
        add("error", "gate-missing-question", 'section "Mandatory first step" needs a blockquote with the exact question wording');
    }
}

function lintGraph(pack, findings) {
    const known = pack.patterns.filter((p) => p.id !== "");
    const graph = supersedesIndex(known);
    const add = (p, rule, message) => findings.push({ severity: "error", rule, file: p.file, id: p.id, message });
    for (const p of known) {
        for (const target of p.supersedes) {
            if (ID_PATTERN.test(target) && !pack.byId.has(target)) add(p, "supersedes-unknown", `supersedes ${target}, which is not in the pack`);
        }
        if (graph.reaches(p.id, p.id)) {
            const loop = known.filter((q) => graph.reaches(p.id, q.id) && graph.reaches(q.id, p.id)).map((q) => q.id).sort();
            add(p, "supersedes-cycle", loop.length === 1 ? `${p.id} supersedes itself` : `supersedes forms a cycle: ${loop.join(", ")}`);
        }
    }
    const approved = known.filter((p) => p.status === "approved");
    for (let i = 0; i < approved.length; i++) {
        for (let j = i + 1; j < approved.length; j++) {
            const [first, second] = [approved[i], approved[j]];
            const shared = first.slots.filter((slot) => second.slots.includes(slot));
            if (shared.length === 0 || !rangesOverlap(first.applies_to, second.applies_to)) continue;
            if (graph.reaches(first.id, second.id) || graph.reaches(second.id, first.id)) continue;
            add(first, "slot-collision", `${first.id} and ${second.id} both decide ${shared.join(", ")} with overlapping applies_to ranges, and neither supersedes the other`);
        }
    }
}

/** Lint a pack read by readPack. The pack's own load findings come first. */
export function lintPack({ pack, sources }) {
    const findings = [...pack.findings];
    const ids = new Map();
    for (const pattern of pack.patterns) {
        const source = sources.get(pattern.file);
        const add = (severity, rule, message) => findings.push({ severity, rule, file: pattern.file, id: pattern.id || null, message });
        lintFrontMatter(source.data, pattern.file, add, ids);
        lintSections(source, add);
    }
    lintGraph(pack, findings);
    return findings;
}
