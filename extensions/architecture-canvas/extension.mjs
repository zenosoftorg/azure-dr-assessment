// Extension: architecture-canvas
//
// An interactive architecture diagram editor backed by the Microsoft SVG icon
// library. The iframe owns all direct manipulation; the actions below let the
// agent build and annotate diagrams programmatically.
//
// Durable identity is the diagram id (a file under architectures/), never the
// canvas instanceId — two panels on the same diagram id show the same content.

import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { resolveDiagramDir, resolveIconRoot } from "./lib/config.mjs";
import { buildCatalog } from "./lib/icons.mjs";
import { DiagramStore } from "./lib/store.mjs";
import { suggestFor } from "./lib/suggest.mjs";
import { createCanvasServer } from "./lib/http.mjs";
import { autoLayout } from "./web/layout.mjs";
import { ROUTES } from "./web/edge-route.mjs";

const NODE_W = 104;
const NODE_H = 84;

const instances = new Map(); // instanceId -> { server, diagramId }

let session = null;

const log = (message) => {
    // session.log rejects asynchronously, so a bare try/catch is not enough —
    // an unhandled rejection here would take the whole extension down.
    try {
        const result = session?.log(`[architecture-canvas] ${message}`, {
            level: "info",
            ephemeral: true,
        });
        if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {
        /* logging must never break the extension */
    }
};

function slugify(text) {
    return (
        (text || "untitled")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60) || "untitled"
    );
}

const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 9)}`;

// Boot the catalog and store BEFORE joinSession: the runtime can re-invoke
// open() for rehydrated instances as soon as we join, so both must be ready.
const workspaceHint = process.env.COPILOT_WORKSPACE_PATH || process.cwd();
const iconRoot = resolveIconRoot(workspaceHint);
const catalog = await buildCatalog(iconRoot);
const diagramDir = resolveDiagramDir(workspaceHint);
const store = new DiagramStore(diagramDir);

/** Resolve the diagram a given canvas instance is editing. */
function diagramIdFor(instanceId, input) {
    const explicit = input?.diagramId || input?.title;
    if (explicit) return slugify(explicit);
    return instances.get(instanceId)?.diagramId || "untitled-architecture";
}

/** Lay a new node out to the right of / below existing content. */
function placeNode(diagram) {
    if (!diagram.nodes.length) return { x: 0, y: 0 };
    const maxX = Math.max(...diagram.nodes.map((n) => n.x));
    const column = diagram.nodes.filter((n) => n.x === maxX);
    const maxY = Math.max(...column.map((n) => n.y));
    return column.length >= 4
        ? { x: maxX + NODE_W + 70, y: 0 }
        : { x: maxX, y: maxY + NODE_H + 60 };
}

function findNode(diagram, ref) {
    if (!ref) return null;
    const needle = String(ref).toLowerCase();
    return (
        diagram.nodes.find((n) => n.id === ref) ||
        diagram.nodes.find((n) => n.label?.toLowerCase() === needle) ||
        diagram.nodes.find((n) => n.label?.toLowerCase().includes(needle)) ||
        null
    );
}

/**
 * Serialize mutations per diagram. Each action does load -> modify -> save, so
 * concurrent invocations on the same diagram would otherwise lose writes.
 */
const mutationQueues = new Map(); // diagramId -> Promise

function enqueue(diagramId, task) {
    const previous = mutationQueues.get(diagramId) || Promise.resolve();
    // Swallow the predecessor's rejection so one failure can't poison the chain.
    const next = previous.catch(() => {}).then(task);
    mutationQueues.set(
        diagramId,
        next.catch(() => {}),
    );
    return next;
}

/** Persist and push the new state to any open iframe showing that diagram. */
async function mutate(diagramId, mutator) {
    return enqueue(diagramId, async () => {
        const diagram = await store.load(diagramId, diagramId);
        const result = await mutator(diagram);
        const { file, diagram: saved } = await store.save(diagramId, diagram);
        for (const entry of instances.values()) {
            if (entry.diagramId === diagramId) {
                entry.server.broadcast("diagram", { diagramId, diagram: saved });
            }
        }
        return { file, diagram: saved, result };
    });
}

// ---------------------------------------------------------------- actions

async function actionAddComponent(ctx) {
    const { icon, label, sublabel, annotation, group } = ctx.input || {};
    const found = catalog.resolve(icon);
    if (!found) throw new CanvasError("icon_not_found", `No icon matches "${icon}".`);

    const diagramId = diagramIdFor(ctx.instanceId, ctx.input);
    const { result, file, diagram } = await mutate(diagramId, (d) => {
        const at = placeNode(d);
        const node = {
            id: uid("n"),
            iconId: found.id,
            variant: 0,
            label: label || found.name,
            sublabel: sublabel || "",
            x: at.x,
            y: at.y,
            group: group ? d.groups.find((g) => g.label === group)?.id || null : null,
            annotation: annotation || "",
        };
        d.nodes.push(node);
        return node;
    });

    const advice = suggestFor(
        catalog,
        found,
        diagram.nodes.map((n) => n.iconId).filter(Boolean),
    );

    return {
        nodeId: result.id,
        icon: found.name,
        collection: found.collectionLabel,
        file,
        // Each suggestion carries the connector that should join it, so the
        // agent can follow up with `connect` using the right direction.
        suggestions: advice.suggestions.map((s) => ({
            name: s.name,
            edge: s.edge?.dir === "none"
                ? null
                : {
                      from: s.edge?.dir === "in" ? s.name : result.label,
                      to: s.edge?.dir === "in" ? result.label : s.name,
                      label: s.edge?.label || "",
                      dashed: Boolean(s.edge?.dashed),
                  },
        })),
        questions: advice.questions.map((q) => ({ question: q.text, options: q.options })),
    };
}

async function actionConnect(ctx) {
    const { from, to, label, color, dashed, arrow, annotation, route } = ctx.input || {};
    const diagramId = diagramIdFor(ctx.instanceId, ctx.input);

    const { result } = await mutate(diagramId, (d) => {
        const source = findNode(d, from);
        const target = findNode(d, to);
        if (!source) throw new CanvasError("node_not_found", `No component matches "${from}".`);
        if (!target) throw new CanvasError("node_not_found", `No component matches "${to}".`);
        const edge = {
            id: uid("e"),
            from: source.id,
            to: target.id,
            label: label || "",
            color: color || "#0969da",
            dashed: Boolean(dashed),
            width: 2,
            arrow: arrow || "forward",
            route: ROUTES.includes(route) ? route : "straight",
            annotation: annotation || "",
        };
        d.edges.push(edge);
        return { edge, source, target };
    });

    return { edgeId: result.edge.id, from: result.source.label, to: result.target.label };
}

async function actionGroup(ctx) {
    const { label, components, border, background, annotation, parent } = ctx.input || {};
    const diagramId = diagramIdFor(ctx.instanceId, ctx.input);

    const { result } = await mutate(diagramId, (d) => {
        const members = (components || []).map((ref) => findNode(d, ref)).filter(Boolean);

        const needle = parent ? String(parent).toLowerCase() : null;
        const parentGroup = needle
            ? d.groups.find((g) => g.id === parent || g.label?.toLowerCase() === needle)
            : null;

        const pad = 34;
        const box = members.length
            ? {
                  x: Math.min(...members.map((n) => n.x)) - pad,
                  y: Math.min(...members.map((n) => n.y)) - pad,
                  width:
                      Math.max(...members.map((n) => n.x + NODE_W)) -
                      Math.min(...members.map((n) => n.x)) +
                      pad * 2,
                  height:
                      Math.max(...members.map((n) => n.y + NODE_H)) -
                      Math.min(...members.map((n) => n.y)) +
                      pad * 2,
              }
            : { x: 0, y: 0, width: 300, height: 200 };

        const group = {
            id: uid("g"),
            label: label || "Subgraph",
            parent: parentGroup ? parentGroup.id : null,
            ...box,
            padding: pad,
            border: border || "#0969da",
            background: background || "rgba(9,105,218,0.08)",
            dashed: true,
            annotation: annotation || "",
        };
        d.groups.push(group);
        for (const member of members) member.group = group.id;
        return { group, count: members.length, parent: parentGroup?.label || null };
    });

    return {
        groupId: result.group.id,
        label: result.group.label,
        members: result.count,
        nestedInside: result.parent,
    };
}

async function actionAnnotate(ctx) {
    const { target, markdown } = ctx.input || {};
    const diagramId = diagramIdFor(ctx.instanceId, ctx.input);

    const { result } = await mutate(diagramId, (d) => {
        const node = findNode(d, target);
        if (node) {
            node.annotation = markdown || "";
            return { kind: "component", label: node.label };
        }
        const needle = String(target).toLowerCase();
        const group = d.groups.find((g) => g.id === target || g.label?.toLowerCase() === needle);
        if (group) {
            group.annotation = markdown || "";
            return { kind: "subgraph", label: group.label };
        }
        const edge = d.edges.find((e) => e.id === target);
        if (edge) {
            edge.annotation = markdown || "";
            return { kind: "connection", label: edge.label || edge.id };
        }
        throw new CanvasError(
            "target_not_found",
            `No component, subgraph, or connection matches "${target}".`,
        );
    });

    return { annotated: result.kind, label: result.label };
}

/**
 * Update an existing component, connection, or subgraph in place.
 *
 * Only the fields supplied are touched, so a caller can retitle something
 * without having to restate its styling. Passing an empty string clears a
 * field, which is how a sublabel or annotation is removed.
 */
async function actionUpdate(ctx) {
    const input = ctx.input || {};
    const { target } = input;
    if (!target) throw new CanvasError("target_required", "Pass target.");

    const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
    const diagramId = diagramIdFor(ctx.instanceId, input);

    let resolvedIcon = null;
    if (has("icon") && input.icon) {
        resolvedIcon = catalog.resolve(input.icon);
        if (!resolvedIcon) {
            throw new CanvasError("icon_not_found", `No icon matches "${input.icon}".`);
        }
    }

    const { result } = await mutate(diagramId, (d) => {
        const needle = String(target).toLowerCase();
        const changed = [];

        const apply = (obj, keys) => {
            for (const key of keys) {
                if (!has(key)) continue;
                obj[key] = input[key];
                changed.push(key);
            }
        };

        const node = findNode(d, target);
        if (node) {
            apply(node, ["label", "sublabel", "annotation"]);
            if (resolvedIcon) {
                node.iconId = resolvedIcon.id;
                node.variant = 0;
                changed.push("icon");
            }
            return { kind: "component", label: node.label, changed };
        }

        const edge =
            d.edges.find((e) => e.id === target) ||
            d.edges.find((e) => e.label && e.label.toLowerCase() === needle);
        if (edge) {
            apply(edge, ["label", "annotation", "color", "dashed", "arrow", "width"]);
            if (has("route")) {
                if (!ROUTES.includes(input.route)) {
                    throw new CanvasError(
                        "invalid_route",
                        `route must be one of ${ROUTES.join(", ")}.`,
                    );
                }
                edge.route = input.route;
                changed.push("route");
            }
            return { kind: "connection", label: edge.label || edge.id, changed };
        }

        const group = d.groups.find((g) => g.id === target || g.label?.toLowerCase() === needle);
        if (group) {
            apply(group, ["label", "annotation", "border", "background"]);
            return { kind: "subgraph", label: group.label, changed };
        }

        throw new CanvasError(
            "target_not_found",
            `No component, subgraph, or connection matches "${target}".`,
        );
    });

    if (!result.changed.length) {
        return { updated: result.kind, label: result.label, changed: [], note: "nothing to change" };
    }
    return { updated: result.kind, label: result.label, changed: result.changed };
}

/**
 * Delete a component, connection, or subgraph.
 *
 * Removing a component also removes the connections attached to it and drops it
 * from any subgraph, so the diagram cannot be left with edges pointing at
 * nothing. Deleting a subgraph removes the grouping only; the components inside
 * it survive.
 */
async function actionRemove(ctx) {
    const { target, from, to } = ctx.input || {};
    const diagramId = diagramIdFor(ctx.instanceId, ctx.input);

    const { result } = await mutate(diagramId, (d) => {
        // A connection identified by its endpoints, which is how connections are
        // usually described ("the Front Door to Support Portal one").
        if (from && to) {
            const a = findNode(d, from);
            const b = findNode(d, to);
            if (!a || !b) {
                throw new CanvasError(
                    "target_not_found",
                    `No component matches "${!a ? from : to}".`,
                );
            }
            const matches = d.edges.filter(
                (e) =>
                    (e.from === a.id && e.to === b.id) ||
                    (e.from === b.id && e.to === a.id),
            );
            if (!matches.length) {
                throw new CanvasError(
                    "target_not_found",
                    `No connection between "${a.label}" and "${b.label}".`,
                );
            }
            if (matches.length > 1 && !target) {
                throw new CanvasError(
                    "ambiguous_target",
                    `${matches.length} connections join "${a.label}" and "${b.label}". ` +
                        `Pass target with the label or id of the one to delete: ` +
                        matches.map((e) => `"${e.label || e.id}"`).join(", "),
                );
            }
            const needle = target ? String(target).toLowerCase() : null;
            const edge = needle
                ? matches.find((e) => e.id === target || e.label?.toLowerCase() === needle)
                : matches[0];
            if (!edge) {
                throw new CanvasError(
                    "target_not_found",
                    `No connection between "${a.label}" and "${b.label}" matches "${target}".`,
                );
            }
            d.edges = d.edges.filter((e) => e !== edge);
            return { kind: "connection", label: edge.label || edge.id };
        }

        if (!target) {
            throw new CanvasError(
                "target_required",
                "Pass target (a component, connection, or subgraph), or from and to for a connection.",
            );
        }

        const needle = String(target).toLowerCase();

        // Connections first: their labels are distinctive, and matching a
        // component by substring could otherwise shadow one.
        const edge =
            d.edges.find((e) => e.id === target) ||
            d.edges.find((e) => e.label && e.label.toLowerCase() === needle);
        if (edge) {
            d.edges = d.edges.filter((e) => e !== edge);
            return { kind: "connection", label: edge.label || edge.id };
        }

        const node = findNode(d, target);
        if (node) {
            const detached = d.edges.filter((e) => e.from === node.id || e.to === node.id).length;
            d.edges = d.edges.filter((e) => e.from !== node.id && e.to !== node.id);
            d.nodes = d.nodes.filter((n) => n !== node);
            for (const g of d.groups) {
                if (Array.isArray(g.members)) g.members = g.members.filter((m) => m !== node.id);
            }
            return { kind: "component", label: node.label, removedConnections: detached };
        }

        const group = d.groups.find((g) => g.id === target || g.label?.toLowerCase() === needle);
        if (group) {
            d.groups = d.groups.filter((g) => g !== group);
            for (const g of d.groups) {
                if (g.parent === group.id) g.parent = null;
            }
            return { kind: "subgraph", label: group.label, keptComponents: true };
        }

        throw new CanvasError(
            "target_not_found",
            `No component, subgraph, or connection matches "${target}".`,
        );
    });

    return { removed: result.kind, ...result };
}

/**
 * Canvas answers arrive one click at a time, but the runtime processes one
 * agent turn at a time — so N separate sends become N queued turns that all
 * land at once anyway. Coalesce them into a single, richer turn instead.
 *
 * The answer is persisted to the diagram first, so a recorded decision never
 * depends on a message being delivered.
 */
const ASK_DEBOUNCE_MS = 1200;
const pendingAsks = new Map(); // diagramId -> { items: [], timer }

async function flushAsks(diagramId) {
    const entry = pendingAsks.get(diagramId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingAsks.delete(diagramId);
    const items = entry.items;
    if (!items.length || !session) return;

    const lines = items.map((i) => `- **${i.question}** → ${i.answer}`).join("\n");
    const plural = items.length === 1 ? "decision" : "decisions";
    try {
        await session.send(
            `The architecture canvas recorded ${items.length} ${plural} on diagram \`${diagramId}\`:\n\n` +
                `${lines}\n\n` +
                `Read the board with \`get_diagram\` (it also returns the full decision log) and ` +
                `update the architecture if these answers change it.`,
        );
    } catch {
        /* the decision is already persisted; delivery is best-effort */
    }
}

function queueAsk(diagramId, payload) {
    let entry = pendingAsks.get(diagramId);
    if (!entry) {
        entry = { items: [], timer: null };
        pendingAsks.set(diagramId, entry);
    }
    entry.items.push(payload);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
        flushAsks(diagramId).catch(() => {});
    }, ASK_DEBOUNCE_MS);
}

async function recordDecision(payload) {
    const diagramId = payload?.diagramId || "untitled-architecture";
    const question = String(payload?.question || "").trim();
    const answer = String(payload?.answer || "").trim();
    if (!question || !answer) return;

    await mutate(diagramId, (d) => {
        d.decisions = Array.isArray(d.decisions) ? d.decisions : [];
        // One answer per question: a later click supersedes an earlier one.
        const existing = d.decisions.findIndex((x) => x.question === question);
        const record = {
            id: payload?.id || "",
            question,
            answer,
            topic: payload?.topic || "",
            at: new Date().toISOString(),
        };
        if (existing >= 0) d.decisions[existing] = record;
        else d.decisions.push(record);
    });

    queueAsk(diagramId, { question, answer });
}

async function actionAutoLayout(ctx) {
    const diagramId = diagramIdFor(ctx.instanceId, ctx.input);
    const direction = ctx.input?.direction === "TB" ? "TB" : "LR";
    const route = ctx.input?.route;
    if (route && !ROUTES.includes(route)) {
        throw new CanvasError("invalid_route", `route must be one of ${ROUTES.join(", ")}.`);
    }
    const { diagram } = await mutate(diagramId, (d) => {
        autoLayout(d, { direction });
        // Applying a routing style here is the common case: you tidy a dense
        // diagram and want the connectors to stop cutting diagonally across it.
        if (route) for (const e of d.edges || []) e.route = route;
    });
    return {
        diagramId,
        direction,
        route: route || "unchanged",
        components: diagram.nodes.length,
        subgraphs: diagram.groups.length,
    };
}

async function actionResetDiagram(ctx) {
    const diagramId = diagramIdFor(ctx.instanceId, ctx.input);
    const { result } = await mutate(diagramId, (d) => {
        const before = {
            nodes: d.nodes.length,
            edges: d.edges.length,
            groups: d.groups.length,
        };
        d.nodes = [];
        d.edges = [];
        d.groups = [];
        if (ctx.input?.title) d.title = ctx.input.title;
        return before;
    });
    return { diagramId, cleared: result };
}

async function actionSuggest(ctx) {
    const icon = catalog.resolve(ctx.input?.component);
    if (!icon) throw new CanvasError("icon_not_found", `No icon matches "${ctx.input?.component}".`);
    const diagramId = diagramIdFor(ctx.instanceId, ctx.input);
    const diagram = await store.load(diagramId, diagramId);
    const advice = suggestFor(catalog, icon, diagram.nodes.map((n) => n.iconId).filter(Boolean));
    return {
        topic: advice.topic,
        suggestions: advice.suggestions,
        questions: advice.questions.map((q) => ({ id: q.id, question: q.text, options: q.options })),
    };
}

async function actionSearchIcons(ctx) {
    const items = catalog.search(ctx.input?.query || "", {
        collection: ctx.input?.collection || null,
        limit: Math.min(ctx.input?.limit || 20, 60),
    });
    return {
        count: items.length,
        items: items.map((i) => ({ id: i.id, name: i.name, collection: i.collectionLabel })),
    };
}

async function actionGetDiagram(ctx) {
    const diagramId = diagramIdFor(ctx.instanceId, ctx.input);
    const diagram = await store.load(diagramId, diagramId);
    const labelOf = (id) => diagram.nodes.find((n) => n.id === id)?.label;
    return {
        diagramId,
        title: diagram.title,
        components: diagram.nodes.map((n) => ({
            id: n.id,
            label: n.label,
            icon: n.iconId,
            group: n.group,
            hasAnnotation: Boolean(n.annotation),
        })),
        connections: diagram.edges.map((e) => ({
            id: e.id,
            from: labelOf(e.from),
            to: labelOf(e.to),
            label: e.label,
            arrow: e.arrow,
            dashed: e.dashed,
        })),
        subgraphs: diagram.groups.map((g) => ({ id: g.id, label: g.label, parent: g.parent })),
        decisions: (diagram.decisions || []).map((d) => ({
            question: d.question,
            answer: d.answer,
            topic: d.topic,
        })),
    };
}

// ---------------------------------------------------------------- lifecycle

async function openCanvas(ctx) {
    const diagramId = diagramIdFor(ctx.instanceId, ctx.input);
    let entry = instances.get(ctx.instanceId);

    if (entry) {
        entry.diagramId = diagramId;
        entry.server.setDiagramId(diagramId);
    } else {
        const server = await createCanvasServer({
            catalog,
            store,
            diagramId,
            log,
            onAsk: async (payload) => {
                await recordDecision(payload);
            },
        });
        entry = { server, diagramId };
        instances.set(ctx.instanceId, entry);
    }

    const diagram = await store.load(diagramId, diagramId);
    return {
        title: diagram.title || "Architecture canvas",
        status: `${diagram.nodes.length} components \u00b7 ${catalog.size} icons`,
        url: entry.server.url,
    };
}

async function closeCanvas(ctx) {
    const entry = instances.get(ctx.instanceId);
    if (!entry) return;
    instances.delete(ctx.instanceId);
    await entry.server.close();
}

// ---------------------------------------------------------------- boot

const canvas = createCanvas({
    id: "architecture-canvas",
    displayName: "Architecture canvas",
    description:
        "Interactive architecture diagram editor using the Microsoft icon set (Azure, Entra, M365, Fabric, Power Platform, Dynamics). Open it to draw, edit, annotate, and group solution architectures.",
    inputSchema: {
        type: "object",
        properties: {
            diagramId: { type: "string", description: "Diagram file id. Defaults to the last one used." },
            title: { type: "string", description: "Title for a new diagram; also used to derive its id." },
        },
    },
    actions: [
        {
            name: "add_component",
            description:
                "Add a component by icon name (e.g. 'Kubernetes Services', 'Key Vaults'). Returns related components and clarifying questions.",
            inputSchema: {
                type: "object",
                required: ["icon"],
                properties: {
                    icon: { type: "string", description: "Icon to search for, e.g. 'App Service'." },
                    label: { type: "string", description: "Override the displayed label." },
                    sublabel: { type: "string" },
                    annotation: { type: "string", description: "Markdown shown on hover." },
                    group: { type: "string", description: "Label of an existing subgraph to place it in." },
                    diagramId: { type: "string" },
                },
            },
            handler: actionAddComponent,
        },
        {
            name: "connect",
            description: "Draw a connection between two components, referenced by label or id.",
            inputSchema: {
                type: "object",
                required: ["from", "to"],
                properties: {
                    from: { type: "string" },
                    to: { type: "string" },
                    label: { type: "string" },
                    color: { type: "string", description: "Hex colour, e.g. '#cf222e'." },
                    dashed: { type: "boolean" },
                    arrow: { type: "string", enum: ["none", "forward", "backward", "both"] },
                    route: {
                        type: "string",
                        enum: ["straight", "orthogonal", "curved"],
                        description:
                            "Line routing. Leave this unset unless the user asks: connections are straight by default, which is what most diagrams want. 'orthogonal' draws right angles ('L'), which suits a dense diagram and routes around components instead of through them. 'curved' is an S-bend. Set it only when the user asks for that style.",
                    },
                    annotation: { type: "string", description: "Markdown shown on hover." },
                    diagramId: { type: "string" },
                },
            },
            handler: actionConnect,
        },
        {
            name: "create_subgraph",
            description: "Group components into a subgraph with its own border and background colour.",
            inputSchema: {
                type: "object",
                required: ["label"],
                properties: {
                    label: { type: "string" },
                    components: {
                        type: "array",
                        items: { type: "string" },
                        description: "Component labels or ids.",
                    },
                    border: { type: "string" },
                    background: { type: "string" },
                    annotation: { type: "string" },
                    parent: { type: "string", description: "Label or id of a subgraph to nest this one inside." },
                    diagramId: { type: "string" },
                },
            },
            handler: actionGroup,
        },
        {
            name: "annotate",
            description:
                "Attach markdown to a component, connection, or subgraph. Shown in a scrollable hover card.",
            inputSchema: {
                type: "object",
                required: ["target", "markdown"],
                properties: {
                    target: { type: "string", description: "Component label, subgraph label, or element id." },
                    markdown: { type: "string" },
                    diagramId: { type: "string" },
                },
            },
            handler: actionAnnotate,
        },
        {
            name: "update",
            description:
                "Change an existing component, connection, or subgraph in place — label, sublabel, icon, annotation or styling. Only the fields you pass are touched; pass an empty string to clear one.",
            inputSchema: {
                type: "object",
                required: ["target"],
                properties: {
                    target: {
                        type: "string",
                        description: "Component label, subgraph label, connection label, or element id.",
                    },
                    label: { type: "string" },
                    sublabel: { type: "string", description: "Components only." },
                    icon: { type: "string", description: "Components only. Replaces the icon." },
                    annotation: { type: "string", description: "Markdown shown on hover." },
                    color: { type: "string", description: "Connections only. Hex colour." },
                    dashed: { type: "boolean", description: "Connections only." },
                    arrow: {
                        type: "string",
                        enum: ["none", "forward", "backward", "both"],
                        description: "Connections only.",
                    },
                    route: {
                        type: "string",
                        enum: ["straight", "orthogonal", "curved"],
                        description: "Connections only. Line routing style: 'straight' (the default), 'orthogonal' for right angles, 'curved' for an S-bend. Change it only when the user asks.",
                    },
                    border: { type: "string", description: "Subgraphs only." },
                    background: { type: "string", description: "Subgraphs only." },
                    diagramId: { type: "string" },
                },
            },
            handler: actionUpdate,
        },
        {
            name: "remove",
            description:
                "Delete a component, connection, or subgraph. Deleting a component also deletes the connections attached to it; deleting a subgraph keeps the components inside it.",
            inputSchema: {
                type: "object",
                properties: {
                    target: {
                        type: "string",
                        description:
                            "Component label, subgraph label, connection label, or element id. For a connection you can pass from and to instead.",
                    },
                    from: {
                        type: "string",
                        description: "Source component of a connection to delete, used with 'to'.",
                    },
                    to: {
                        type: "string",
                        description: "Target component of a connection to delete, used with 'from'.",
                    },
                    diagramId: { type: "string" },
                },
            },
            handler: actionRemove,
        },
        {
            name: "auto_layout",
            description: "Tidy the diagram: arrange components by flow, minimise edge crossings, and lay out subgraphs so they never overlap. Feedback loops are handled, the drawing is wrapped into a balanced shape rather than one long strip, and components are then nudged to keep connectors out of other boxes. Optionally set a routing style on every connection at the same time. Run this after building or restructuring a diagram.",
            inputSchema: {
                type: "object",
                properties: {
                    direction: {
                        type: "string",
                        enum: ["LR", "TB"],
                        description: "LR = left-to-right flow (default), TB = top-to-bottom.",
                    },
                    route: {
                        type: "string",
                        enum: ["straight", "orthogonal", "curved"],
                        description:
                            "Apply this routing style to every connection. Omit it to leave the existing styles alone, which is the usual case — connections are straight unless the user has asked for another style. Pass 'orthogonal' only when the user wants right-angled ('L') connectors.",
                    },
                    diagramId: { type: "string" },
                },
            },
            handler: actionAutoLayout,
        },
        {
            name: "reset_diagram",
            description: "Clear every component, connection, and subgraph from a diagram, giving a blank board.",
            inputSchema: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Optional new title for the blank diagram." },
                    diagramId: { type: "string" },
                },
            },
            handler: actionResetDiagram,
        },
        {
            name: "suggest_related",
            description:
                "Given a component, return commonly paired components and clarifying architecture questions.",
            inputSchema: {
                type: "object",
                required: ["component"],
                properties: {
                    component: { type: "string" },
                    diagramId: { type: "string" },
                },
            },
            handler: actionSuggest,
        },
        {
            name: "search_icons",
            description: "Search the Microsoft icon library by name.",
            inputSchema: {
                type: "object",
                required: ["query"],
                properties: {
                    query: { type: "string" },
                    collection: {
                        type: "string",
                        enum: ["azure", "entra", "power", "dynamics", "m365", "fabric"],
                    },
                    limit: { type: "number" },
                },
            },
            handler: actionSearchIcons,
        },
        {
            name: "get_diagram",
            description: "Read the current diagram as structured data (components, connections, subgraphs).",
            inputSchema: {
                type: "object",
                properties: { diagramId: { type: "string" } },
            },
            handler: actionGetDiagram,
        },
    ],
    open: openCanvas,
    onClose: closeCanvas,
});

session = await joinSession({ canvases: [canvas] });

log(`ready \u00b7 ${catalog.size} icons from ${iconRoot || "NO ICON ROOT"} \u00b7 diagrams in ${diagramDir}`);
