import { SLOT_IDS } from "./patterns.mjs";
import { OPTION_KINDS, OPTION_TARGETS, isEstimate, isIsoDate, isLearnUrl } from "./playbooks.mjs";
import { isSecretValue, secretPaths } from "./secrets.mjs";

/** A playbook whose verified_on is more than this many days before today is stale (a warning). */
export const PLAYBOOK_STALE_AFTER_DAYS = 90;

const DAY_MS = 86_400_000;
const withoutFragment = (url) => url.split("#")[0];

/** One finding as a single line: "<file>: [<rule>] <message>". */
export function formatPlaybookFinding(finding) {
    return `${finding.file}: [${finding.rule}] ${finding.message}`;
}

/** The places of a playbook that hold secret-like text. A place is a front matter path or a section title, never the text itself. */
function secretPlaces(p) {
    const front = { service: p.service, title: p.title, armTypes: p.armTypes, slot: p.slot, verifiedOn: p.verifiedOn, learnSources: p.learnSources };
    const places = secretPaths(front).map((at) => `front matter ${at}`);
    for (const section of p.sections) {
        const hit = section.text.split("\n").some((line) => {
            const field = line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/^[A-Za-z][A-Za-z ]*:\s*/, "");
            return [line, field, ...line.split("|")].some((piece) => isSecretValue(piece.trim()));
        });
        if (hit) places.push(`section "${section.title}"`);
    }
    return places;
}

const NUMBERS = String.raw`\d+(?:(?:\s*,\s*|\s+(?:and|to|or)\s+)\d+)*\b`;
/** A cross-reference to a step by its number: "Build step 6", "Cut over 2", "Failback 3", "step 4", "steps 6 to 8". */
const STEP_NUMBER = new RegExp(String.raw`\b(?:(?:build|validate|cut[ -]over|decommission|failover|failback)(?:\s+steps?)?|steps?)\s+${NUMBERS}`, "gi");

/**
 * The numeric step cross-references of a playbook, per section, outside code fences. The guide and the runbook keep
 * only the steps of the chosen option and renumber them, so a step number in the playbook points at the wrong step.
 */
function stepNumberRefs(p) {
    const refs = [];
    for (const section of p.sections) {
        let fence = false;
        for (const line of section.text.split("\n")) {
            if (/^\s*(`{3,}|~{3,})/.test(line)) fence = !fence;
            if (fence) continue;
            for (const m of line.matchAll(STEP_NUMBER)) refs.push([section.title, m[0]]);
        }
    }
    return refs;
}

const OPTION_LABEL = /^([a-z0-9]+(?:-[a-z0-9]+)*):\s+/;

/**
 * The steps that the guide and the runbook keep for every option (no option label) but that name some, and not all,
 * options of the playbook: their text leaks into the chapters of the other options.
 */
function optionTextProblems(p) {
    const ids = p.options.map((o) => o.id).filter(Boolean);
    if (ids.length < 2) return [];
    const names = (text) => ids.filter((id) => new RegExp(`(?<![a-z0-9-])${id}(?![a-z0-9-])`).test(text));
    const row = (s) => [s.step, s.role, s.duration, s.verification, s.abort].join(" ");
    const lists = [
        ["Build step", p.migration.build, (s) => s], ["Validate step", p.migration.validate, (s) => s],
        ["Cut over step", p.migration.cutOver, (s) => s], ["Decommission step", p.migration.decommission, (s) => s],
        ["Failover row", p.steps.failover, row], ["Failback row", p.steps.failback, row],
    ];
    const problems = [];
    for (const [what, steps, text] of lists) {
        steps.forEach((step, i) => {
            const label = OPTION_LABEL.exec(what.endsWith("row") ? step.step : step)?.[1];
            if (label && ids.includes(label)) return;
            const named = names(text(step));
            if (named.length > 0 && named.length < ids.length) problems.push(`${what} ${i + 1} names ${named.join(", ")} but carries no option label: write it once per option it applies to, each copy starting with "<option id>: ", or word it for every option`);
        });
    }
    return problems;
}

function lintOptions(p, add) {
    const mechanisms = new Set(p.mechanisms.map((m) => m.name.toLowerCase()));
    const tested = new Set(p.tests.flatMap((t) => t.appliesTo));
    const ids = new Set(p.options.map((o) => o.id).filter(Boolean));
    for (const o of p.options) {
        const what = `option "${o.id || o.title}"`;
        if (o.kind !== "" && !OPTION_KINDS.includes(o.kind)) add("error", "option-kind", `${what}: Kind "${o.kind}" must be one of ${OPTION_KINDS.join(", ")}`);
        if (o.target !== "" && !OPTION_TARGETS.includes(o.target)) {
            add("error", "option-target", `${what}: Target "${o.target}" must be one of ${OPTION_TARGETS.join(", ")}`);
        } else if (o.target !== "" && OPTION_KINDS.includes(o.kind)) {
            const expected = o.kind === "split-region" ? "pair-region" : "dr-region";
            if (o.target !== expected) add("error", "option-target", `${what}: a ${o.kind} option targets ${expected}`);
        }
        if (o.usesMechanism !== "" && o.usesMechanism !== "none" && !mechanisms.has(o.usesMechanism.toLowerCase())) {
            add("error", "option-mechanism", `${what}: Uses mechanism "${o.usesMechanism}" is not a mechanism of this playbook (or none)`);
        }
        for (const [key, value] of [["Estimated RPO", o.rpo], ["Estimated RTO", o.rto]]) {
            if (value !== "" && !isEstimate(value)) add("error", "option-estimate", `${what}: ${key} must start with a duration such as 30m or with unknown`);
        }
        for (const slot of o.decidesSlots ?? []) {
            if (!SLOT_IDS.includes(slot)) add("error", "option-field", `${what}: Decides slots names "${slot}", which is not a slot id (see patterns/README.md)`);
        }
        if (o.id !== "" && !tested.has(o.id)) add("error", "option-untested", `${what} is in the Applies to of no test criterion`);
    }
    for (const t of p.tests) {
        for (const id of t.appliesTo) {
            if (!ids.has(id)) add("error", "test-option", `${t.id}: Applies to names "${id}", which is not an option of this playbook`);
        }
    }
}

function lintSources(p, add) {
    const listed = new Set(p.learnSources.map(withoutFragment));
    for (const url of p.learnSources) {
        if (!isLearnUrl(url)) add("error", "source-not-learn", `learn_sources entry ${url} must be one URL that starts with https://learn.microsoft.com/`);
    }
    const cited = [
        ...p.mechanisms.map((m) => [`mechanism "${m.name}"`, m.source]),
        ...p.constraints.map((c) => [`constraint "${c.heading}"`, c.source]),
        ...p.options.map((o) => [`option "${o.id || o.title}"`, o.source]),
    ];
    for (const [what, url] of cited) {
        if (url === "") continue;
        if (!isLearnUrl(url)) add("error", "source-not-learn", `${what}: Source ${url} must be one URL that starts with https://learn.microsoft.com/`);
        // without learn_sources the front matter finding already says so; every Source would repeat it
        else if (listed.size > 0 && !listed.has(withoutFragment(url))) add("error", "source-unlisted", `${what}: Source ${url} is not in learn_sources`);
    }
}

/**
 * Lint the playbooks that readPlaybooks returned. The load and grammar findings come first; then the rules that need
 * the parsed shape or the whole set. `today` (YYYY-MM-DD) is the date the 90-day age is measured from.
 */
export function lintPlaybooks({ set, findings }, { today } = {}) {
    if (!isIsoDate(today)) throw new TypeError("lintPlaybooks needs today as YYYY-MM-DD");
    const out = [...findings];
    const services = new Map();
    const types = new Map();
    for (const p of set.playbooks) {
        const add = (severity, rule, message) => out.push({ severity, rule, file: p.file, service: p.service || null, message });
        const stem = p.file.replace(/\.md$/i, "");
        if (p.service !== "" && p.service !== stem) add("error", "file-name", `service ${p.service} must equal the file name ${stem}`);
        if (p.service !== "") {
            if (services.has(p.service)) add("error", "service-duplicate", `service ${p.service} is already used by ${services.get(p.service)}`);
            else services.set(p.service, p.file);
        }
        if (p.slot !== "" && !SLOT_IDS.includes(p.slot)) add("error", "slot-unknown", `slot "${p.slot}" is not a slot id (see patterns/README.md)`);
        for (const type of new Set(p.armTypes)) {
            if (types.has(type)) add("error", "arm-type-duplicate", `ARM type ${type} is already covered by ${types.get(type)}`);
            else types.set(type, p.file);
        }
        lintOptions(p, add);
        lintSources(p, add);
        for (const message of optionTextProblems(p)) add("error", "option-text", message);
        for (const [section, ref] of stepNumberRefs(p)) {
            add("error", "step-number", `section "${section}": "${ref}" refers to a step by its number; the guide and the runbook drop the steps of other options and renumber the rest, so name the step by its part and what it does`);
        }
        for (const place of secretPlaces(p)) add("error", "secret", `secret-like text in ${place}: a playbook holds generic Azure know-how only`);
        if (isIsoDate(p.verifiedOn)) {
            const age = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${p.verifiedOn}T00:00:00Z`)) / DAY_MS);
            if (age > PLAYBOOK_STALE_AFTER_DAYS) {
                add("warning", "verified-stale", `verified_on ${p.verifiedOn} is ${age} days before ${today}; re-verify the playbook against Learn`);
            }
        }
    }
    return out;
}
