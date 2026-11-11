// Story module for presentation #2, the DR walkthrough of the azure-dr-assessment skill.
//
// Copy this file to presentations/<id>.story.mjs. It reads the narration from presentations/<id>.story-data.json
// (next to this file) and everything else from the proposed-dr diagram, so the tables always show the mechanism,
// the slot and the source that build-diagram wrote. It imports only node: built-ins because it runs from the
// output folder, outside the skill.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(import.meta.url);
const NAMED = /^(.*)\.story\.mjs$/;
if (!NAMED.test(file)) {
    throw new Error(`story template: name this file <id>.story.mjs so that its data file <id>.story-data.json can be found (it is ${path.basename(file)})`);
}
const dataFile = file.replace(NAMED, "$1.story-data.json");

/** The ten steps of the walkthrough in the order they are told: [step id, chapter, default title]. */
const STEPS = [
    ["healthy", "Healthy state", "How the workload runs and what is protected"],
    ["establishing", "Establishing DR", "From today's setup to the new DR region"],
    ["disaster", "Disaster", "What fails"],
    ["detection", "Detection", "How we notice"],
    ["approval", "Decision", "Who approves the failover"],
    ["failover", "Failover", "Failing over, step by step"],
    ["verification", "Verification", "Checking that the workload is back"],
    ["failback", "Failback", "Returning to the primary region"],
    ["weakest-link", "RPO and RTO", "The weakest link"],
    ["test-plan", "Test plan", "How we prove it"],
];
const STEP_IDS = STEPS.map(([id]) => id);
/** The step told in several scenes, one per build-order group of the establishment guide. */
const SCENES_STEP = "establishing";
const EXCEPTIONS_GROUP = "Documented exceptions";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const filled = (value) => typeof value === "string" && value.trim() !== "";

function readData() {
    const bad = (message) => {
        throw new Error(`story data ${path.basename(dataFile)}: ${message}`);
    };
    let data;
    try {
        data = JSON.parse(readFileSync(dataFile, "utf8"));
    } catch (err) {
        return bad(`cannot read it (${err.message})`);
    }
    if (!isObject(data) || data.schemaVersion !== 1) bad("schemaVersion must be 1");
    if (!isObject(data.cover) || !filled(data.cover.title) || !filled(data.cover.blurb)) bad("cover needs a title and a blurb");
    if (data.cover.kicker !== undefined && typeof data.cover.kicker !== "string") bad("cover.kicker must be a string");
    if (!Array.isArray(data.steps)) bad("steps must be an array with one entry for each of the ten steps");
    const highlights = (item, at) => {
        for (const field of ["groups", "nodes"]) {
            if (item[field] !== undefined && !(Array.isArray(item[field]) && item[field].every(filled))) bad(`${at}.${field} must be a list of labels`);
        }
        const pair = (value) => Array.isArray(value) && value.length === 2 && value.every(filled);
        if (item.edges !== undefined && !(Array.isArray(item.edges) && item.edges.every(pair))) bad(`${at}.edges must be a list of [from label, to label] pairs`);
    };
    const seen = new Set();
    data.steps.forEach((entry, i) => {
        const at = `steps[${i}]`;
        if (!isObject(entry) || !STEP_IDS.includes(entry.step)) bad(`${at}.step must be one of ${STEP_IDS.join(", ")}`);
        if (seen.has(entry.step)) bad(`${at}.step "${entry.step}" appears twice`);
        seen.add(entry.step);
        if (entry.title !== undefined && typeof entry.title !== "string") bad(`${at}.title must be a string`);
        if (entry.step === SCENES_STEP) {
            if (entry.md !== undefined && typeof entry.md !== "string") bad(`${at}.md must be a string: the optional introduction of the chapter`);
            if (!Array.isArray(entry.scenes) || entry.scenes.length === 0) bad(`${at}.scenes must be a non-empty list: one scene per build-order group`);
            entry.scenes.forEach((scene, j) => {
                const sat = `${at}.scenes[${j}]`;
                if (!isObject(scene)) bad(`${sat} must be an object with a title and md`);
                if (!filled(scene.title)) bad(`${sat}.title must be the title of the scene`);
                if (!filled(scene.md)) bad(`${sat}.md must be the narration of the scene`);
                highlights(scene, sat);
            });
            return;
        }
        if (!filled(entry.md)) bad(`${at}.md must be the narration of the step`);
        highlights(entry, at);
    });
    const missing = STEP_IDS.filter((id) => !seen.has(id));
    if (missing.length > 0) bad(`steps is missing: ${missing.join(", ")}`);
    return { cover: data.cover, steps: new Map(data.steps.map((entry) => [entry.step, entry])) };
}

const data = readData();

export const cover = {
    kicker: data.cover.kicker || "Architecture Story · disaster recovery",
    title: data.cover.title,
    blurb: data.cover.blurb,
};

const cell = (text) => String(text ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim() || "—";
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");

/** The mechanism, slot and source lines that build-diagram wrote into an annotation. */
function note(annotation) {
    const text = String(annotation ?? "");
    const pick = (name) => new RegExp(`\\*\\*${name}:\\*\\* ([^\\n]*)`).exec(text)?.[1]?.trim() ?? "";
    return { mechanism: pick("Mechanism"), slot: pick("Slot"), source: pick("Source") };
}

export function buildStory(diagram, h) {
    const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
    const edges = new Map(diagram.edges.map((edge) => [edge.id, edge]));
    const edgeRows = (list) => list.map((edge) => {
        const { mechanism, slot, source } = note(edge.annotation);
        return [`${nodes.get(edge.from)?.label ?? edge.from} → ${nodes.get(edge.to)?.label ?? edge.to}`, edge.label, mechanism, slot, source];
    });
    const nodeRows = (list) => list.map((node) => {
        const { slot, source } = note(node.annotation);
        return [node.label, node.sublabel, slot, source];
    });
    const scenes = [];
    /** One scene of a step, or of a scene of the establishing step, with the tables of what it highlights. */
    const sceneOf = (step, chapter, title, item, md) => {
        // Labels written by the model go through the builder's helpers, which list every miss in one refusal.
        const groups = (item.groups ?? []).map((label) => h.group(label));
        const nodeIds = (item.nodes ?? []).map((label) => h.node(label));
        const edgeIds = (item.edges ?? []).map(([from, to]) => h.edge(from, to));
        const tables = [];
        if (step === "healthy") {
            tables.push(`**Every link and the mechanism behind it**\n\n${table(["Link", "Label", "Mechanism", "Slot", "Source"], edgeRows(diagram.edges))}`);
        } else {
            const shownEdges = edgeIds.map((id) => edges.get(id)).filter(Boolean);
            const shownNodes = nodeIds.map((id) => nodes.get(id)).filter(Boolean);
            if (shownEdges.length > 0) tables.push(`**Links in this step**\n\n${table(["Link", "Label", "Mechanism", "Slot", "Source"], edgeRows(shownEdges))}`);
            if (shownNodes.length > 0) tables.push(`**Components in this step**\n\n${table(["Component", "Detail", "Slot", "Source"], nodeRows(shownNodes))}`);
        }
        const wide = step === "healthy" || groups.length + nodeIds.length + edgeIds.length === 0;
        return {
            chapter,
            title,
            ...(wide ? { all: true } : {}),
            ...(step === "healthy" ? { hold: true } : {}),
            groups,
            nodes: nodeIds,
            edges: edgeIds,
            md: [md, ...tables].join("\n\n"),
        };
    };

    for (const [step, chapter, defaultTitle] of STEPS) {
        const entry = data.steps.get(step);
        if (step === SCENES_STEP) {
            // One scene per entry of scenes; the optional introduction opens the first.
            entry.scenes.forEach((scene, j) => {
                const md = j === 0 && filled(entry.md) ? `${entry.md}\n\n${scene.md}` : scene.md;
                scenes.push(sceneOf(step, chapter, scene.title, scene, md));
            });
            continue;
        }
        scenes.push(sceneOf(step, chapter, entry.title || defaultTitle, entry, entry.md));

        // Applied overrides and tier exceptions are generated from the diagram, so the story cannot leave them out.
        const exceptions = diagram.groups.find((group) => group.label === EXCEPTIONS_GROUP);
        if (step === "weakest-link" && exceptions) {
            const members = diagram.nodes.filter((node) => node.group === exceptions.id);
            scenes.push({
                chapter: "Exceptions",
                title: EXCEPTIONS_GROUP,
                groups: [exceptions.id],
                nodes: members.map((node) => node.id),
                md: ["The design departs from the company defaults in these places. Each exception is recorded with its owner and its date.", ...members.map((node) => `**${node.label}**\n\n${node.annotation}`)].join("\n\n"),
            });
        }
    }
    return scenes;
}
