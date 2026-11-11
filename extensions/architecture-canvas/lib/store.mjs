// Diagram persistence.
//
// The durable identity of a diagram is its FILE PATH, never the canvas
// instanceId. Two panels opened on the same path show the same diagram.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const SCHEMA_VERSION = 1;

export function slugify(text) {
    return (text || "untitled")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "untitled";
}

const slug = slugify;

export function emptyDiagram(title = "Untitled architecture") {
    return {
        version: SCHEMA_VERSION,
        title,
        nodes: [],
        edges: [],
        groups: [],
        decisions: [],
        view: { x: 0, y: 0, zoom: 1 },
        updatedAt: new Date().toISOString(),
    };
}

/** Fill in defaults and drop anything structurally broken. */
export function normalizeDiagram(raw, fallbackTitle = "Untitled architecture") {
    const base = emptyDiagram(fallbackTitle);
    if (!raw || typeof raw !== "object") return base;

    const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
    const groups = Array.isArray(raw.groups) ? raw.groups : [];
    const nodeIds = new Set();

    base.title = typeof raw.title === "string" && raw.title.trim() ? raw.title : fallbackTitle;
    base.nodes = nodes
        .filter((n) => n && typeof n.id === "string")
        .map((n) => {
            nodeIds.add(n.id);
            return {
                id: n.id,
                iconId: typeof n.iconId === "string" ? n.iconId : null,
                variant: Number.isInteger(n.variant) ? n.variant : 0,
                label: typeof n.label === "string" ? n.label : "",
                sublabel: typeof n.sublabel === "string" ? n.sublabel : "",
                x: Number(n.x) || 0,
                y: Number(n.y) || 0,
                group: typeof n.group === "string" ? n.group : null,
                annotation: typeof n.annotation === "string" ? n.annotation : "",
            };
        });

    base.groups = groups
        .filter((g) => g && typeof g.id === "string")
        .map((g) => ({
            id: g.id,
            label: typeof g.label === "string" ? g.label : "Group",
            parent: typeof g.parent === "string" ? g.parent : null,
            x: Number(g.x) || 0,
            y: Number(g.y) || 0,
            width: Number(g.width) || 320,
            height: Number(g.height) || 220,
            padding: Number.isFinite(Number(g.padding)) ? Math.max(16, Number(g.padding)) : 34,
            border: typeof g.border === "string" ? g.border : "#3b82f6",
            background: typeof g.background === "string" ? g.background : "rgba(59,130,246,0.08)",
            dashed: g.dashed !== false,
            annotation: typeof g.annotation === "string" ? g.annotation : "",
        }));

    // Break parent cycles and dangling parents: a cycle would make layout
    // recurse forever.
    const groupIds = new Set(base.groups.map((g) => g.id));
    for (const g of base.groups) {
        if (g.parent && !groupIds.has(g.parent)) g.parent = null;
    }
    for (const g of base.groups) {
        const seen = new Set([g.id]);
        let cursor = g;
        while (cursor.parent) {
            if (seen.has(cursor.parent)) {
                cursor.parent = null;
                break;
            }
            seen.add(cursor.parent);
            cursor = base.groups.find((x) => x.id === cursor.parent);
            if (!cursor) break;
        }
    }

    base.edges = (Array.isArray(raw.edges) ? raw.edges : [])
        .filter((e) => e && typeof e.id === "string" && nodeIds.has(e.from) && nodeIds.has(e.to))
        .map((e) => ({
            id: e.id,
            from: e.from,
            to: e.to,
            label: typeof e.label === "string" ? e.label : "",
            color: typeof e.color === "string" ? e.color : "#64748b",
            dashed: Boolean(e.dashed),
            width: Number(e.width) || 2,
            arrow: ["none", "forward", "backward", "both"].includes(e.arrow) ? e.arrow : "forward",
            route: ["straight", "orthogonal", "curved"].includes(e.route) ? e.route : "straight",
            annotation: typeof e.annotation === "string" ? e.annotation : "",
        }));

    // Decisions answered in the canvas. Durable, so a recorded answer never
    // depends on a message reaching the agent.
    base.decisions = (Array.isArray(raw.decisions) ? raw.decisions : [])
        .filter((d) => d && typeof d === "object")
        .map((d) => ({
            id: typeof d.id === "string" ? d.id : "",
            question: typeof d.question === "string" ? d.question : "",
            answer: typeof d.answer === "string" ? d.answer : "",
            topic: typeof d.topic === "string" ? d.topic : "",
            at: typeof d.at === "string" ? d.at : new Date().toISOString(),
        }))
        .filter((d) => d.question && d.answer);

    if (raw.view && typeof raw.view === "object") {
        base.view = {
            x: Number(raw.view.x) || 0,
            y: Number(raw.view.y) || 0,
            zoom: Number(raw.view.zoom) || 1,
        };
    }
    return base;
}

export class DiagramStore {
    constructor(dir) {
        this.dir = dir;
    }

    async ensureDir() {
        await mkdir(this.dir, { recursive: true });
    }

    fileFor(id) {
        return path.join(this.dir, `${slug(id)}.arch.json`);
    }

    async list() {
        try {
            const entries = await readdir(this.dir, { withFileTypes: true });
            const out = [];
            for (const entry of entries) {
                if (!entry.isFile() || !entry.name.endsWith(".arch.json")) continue;
                const id = entry.name.replace(/\.arch\.json$/, "");
                let title = id;
                let counts = { nodes: 0, edges: 0, groups: 0 };
                try {
                    const parsed = JSON.parse(await readFile(path.join(this.dir, entry.name), "utf8"));
                    title = parsed.title || id;
                    counts = {
                        nodes: parsed.nodes?.length || 0,
                        edges: parsed.edges?.length || 0,
                        groups: parsed.groups?.length || 0,
                    };
                } catch {
                    // Unreadable file still listed so the user can see it exists.
                }
                out.push({ id, title, ...counts });
            }
            return out.sort((a, b) => a.title.localeCompare(b.title));
        } catch {
            return [];
        }
    }

    async load(id, fallbackTitle) {
        try {
            const raw = await readFile(this.fileFor(id), "utf8");
            return normalizeDiagram(JSON.parse(raw), fallbackTitle || id);
        } catch {
            return emptyDiagram(fallbackTitle || id);
        }
    }

    async save(id, diagram) {
        await this.ensureDir();
        const normalized = normalizeDiagram(diagram, id);
        normalized.updatedAt = new Date().toISOString();
        const file = this.fileFor(id);
        await writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
        return { file, diagram: normalized };
    }
}
