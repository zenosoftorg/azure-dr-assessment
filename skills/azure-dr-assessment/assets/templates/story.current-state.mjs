// Story module for presentation #1, the as-is architecture of the azure-dr-assessment skill.
//
// Copy this file to presentations/<id>.story.mjs. It reads its content from presentations/<id>.story-data.json
// (next to this file) and everything else from the diagram, so it works for any current-state diagram.
// It imports only node: built-ins because it runs from the output folder, outside the skill.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(import.meta.url);
const NAMED = /^(.*)\.story\.mjs$/;
if (!NAMED.test(file)) {
    throw new Error(`story template: name this file <id>.story.mjs so that its data file <id>.story-data.json can be found (it is ${path.basename(file)})`);
}
const dataFile = file.replace(NAMED, "$1.story-data.json");

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
    for (const name of ["regionMismatch", "unknowns"]) {
        const part = data[name];
        if (part !== undefined && part !== null && !(isObject(part) && filled(part.title) && filled(part.md))) bad(`${name} must be null or { "title", "md" }`);
    }
    const groups = data.groups ?? [];
    if (!Array.isArray(groups)) bad("groups must be an array");
    const seen = new Set();
    groups.forEach((entry, i) => {
        const at = `groups[${i}]`;
        if (!isObject(entry) || !filled(entry.group)) bad(`${at}.group must be a group label`);
        if (seen.has(entry.group)) bad(`${at}.group "${entry.group}" appears twice`);
        seen.add(entry.group);
        for (const field of ["title", "md"]) {
            if (entry[field] !== undefined && typeof entry[field] !== "string") bad(`${at}.${field} must be a string`);
        }
        if (entry.nodes !== undefined && !(Array.isArray(entry.nodes) && entry.nodes.every(filled))) bad(`${at}.nodes must be a list of node labels`);
        const pair = (value) => Array.isArray(value) && value.length === 2 && value.every(filled);
        if (entry.edges !== undefined && !(Array.isArray(entry.edges) && entry.edges.every(pair))) bad(`${at}.edges must be a list of [from label, to label] pairs`);
    });
    return { cover: data.cover, regionMismatch: data.regionMismatch ?? null, unknowns: data.unknowns ?? null, groups };
}

const data = readData();

export const cover = {
    kicker: data.cover.kicker || "Architecture Story · as-is",
    title: data.cover.title,
    blurb: data.cover.blurb,
};

const cell = (text) => String(text ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim() || "—";
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");

/** The evidence, strength and basis lines that build-diagram wrote into an annotation. */
function note(annotation) {
    const text = String(annotation ?? "");
    const pick = (name) => new RegExp(`\\*\\*${name}:\\*\\* ([^\\n]*)`).exec(text)?.[1]?.trim() ?? "";
    return { evidence: pick("Evidence"), strength: pick("Strength"), basis: pick("Basis") };
}

const componentRows = (nodes) =>
    nodes.map((node) => {
        const { strength, evidence } = note(node.annotation);
        return [node.label, node.sublabel, strength, evidence];
    });
const COMPONENTS = ["Component", "Detail", "Strength", "Evidence"];

export function buildStory(diagram, h) {
    const label = new Map(diagram.nodes.map((node) => [node.id, node.label]));
    const scenes = [];

    if (data.regionMismatch) {
        scenes.push({ chapter: "Region check", title: data.regionMismatch.title, all: true, hold: true, md: data.regionMismatch.md });
    }

    const inferred = diagram.edges.filter((edge) => note(edge.annotation).strength === "Inferred");
    if (inferred.length > 0) {
        const rows = inferred.map((edge) => {
            const { basis, evidence } = note(edge.annotation);
            return [`${label.get(edge.from)} → ${label.get(edge.to)}`, edge.label, basis, evidence];
        });
        scenes.push({
            chapter: "Inferred links",
            title: "What we inferred, and why",
            edges: inferred.map((edge) => edge.id),
            md: ["Dashed amber links are **inferred**, not observed in the inventory. Each one states what it was inferred from.", table(["Link", "Label", "Basis", "Evidence"], rows)].join("\n\n"),
        });
    }

    if (data.unknowns) scenes.push({ chapter: "Unknowns", title: data.unknowns.title, all: true, md: data.unknowns.md });

    scenes.push({
        chapter: "Observed architecture",
        title: "The architecture as the inventory shows it",
        all: true,
        hold: true,
        md: `**Components:** ${diagram.nodes.length}. **Groups:** ${diagram.groups.length}. **Links:** ${diagram.edges.length - inferred.length} observed (solid), ${inferred.length} inferred (dashed amber).`,
    });

    // Labels written by the model go through the builder's helpers, which list every miss in one refusal.
    for (const entry of data.groups) h.group(entry.group);
    const entries = new Map(data.groups.map((entry) => [entry.group, entry]));
    const within = (group) => [group, ...diagram.groups.filter((child) => child.parent === group.id).flatMap(within)];
    for (const group of diagram.groups) {
        const entry = entries.get(group.label);
        const members = diagram.nodes.filter((node) => node.group === group.id);
        scenes.push({
            chapter: group.label,
            title: entry?.title || group.label,
            groups: within(group).map((g) => g.id),
            nodes: (entry?.nodes ?? []).map((nodeLabel) => h.node(nodeLabel)),
            edges: (entry?.edges ?? []).map(([from, to]) => h.edge(from, to)),
            md: [entry?.md, members.length > 0 ? table(COMPONENTS, componentRows(members)) : "This group holds no component."].filter(Boolean).join("\n\n"),
        });
    }

    const loose = diagram.nodes.filter((node) => !node.group);
    if (loose.length > 0) {
        const grouped = diagram.groups.length > 0;
        scenes.push({
            chapter: grouped ? "Outside the groups" : "Observed architecture",
            title: grouped ? "Components outside the groups" : "The components",
            nodes: loose.map((node) => node.id),
            md: table(COMPONENTS, componentRows(loose)),
        });
    }
    return scenes;
}
