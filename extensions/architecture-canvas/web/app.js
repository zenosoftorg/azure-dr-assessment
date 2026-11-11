// Architecture canvas editor.
//
// SVG scene graph with a single world transform for pan/zoom. State is a plain
// diagram object matching lib/store.mjs; every mutation goes through commit()
// which re-renders and marks the document dirty.

import { autoLayout } from "/layout.mjs";
import { buildVsdx } from "/vsdx.mjs";
import { routeEdge, routeAll, ROUTES } from "/edge-route.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_W = 104;
const NODE_H = 84;
const ICON = 40;

const PALETTE = [
    "#64748b", "#0969da", "#1a7f37", "#bf8700",
    "#cf222e", "#8250df", "#0891b2", "#be185d",
];
const GROUP_TINTS = [
    { border: "#0969da", background: "rgba(9,105,218,0.08)" },
    { border: "#1a7f37", background: "rgba(26,127,55,0.08)" },
    { border: "#8250df", background: "rgba(130,80,223,0.08)" },
    { border: "#bf8700", background: "rgba(191,135,0,0.10)" },
    { border: "#cf222e", background: "rgba(207,34,46,0.08)" },
    { border: "#0891b2", background: "rgba(8,145,178,0.08)" },
];

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v !== null && v !== undefined) node.setAttribute(k, String(v));
    }
    return node;
};
const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

// ---------------------------------------------------------------- state

const app = {
    diagramId: null,
    diagram: null,
    collections: [],
    selection: { kind: null, id: null, extra: new Set() },
    mode: "select",           // "select" | "connect"
    connectFrom: null,
    dirty: false,
    pickerTarget: "node",     // "node" | "replace"
    answers: {},
};

// ---------------------------------------------------------------- markdown

/** Minimal, escape-first markdown renderer. No raw HTML passthrough. */
function renderMarkdown(src) {
    if (!src) return "";
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const fences = [];
    let text = esc(src).replace(/```([\s\S]*?)```/g, (_, code) => {
        fences.push(code.replace(/^\n/, ""));
        return `\u0000FENCE${fences.length - 1}\u0000`;
    });

    const lines = text.split("\n");
    const out = [];
    let list = null;

    const closeList = () => {
        if (list) {
            out.push(`</${list}>`);
            list = null;
        }
    };

    const inline = (s) =>
        s
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
            .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');

    // GFM pipe tables. Leading/trailing pipes are optional; `\|` escapes a literal pipe.
    const splitRow = (raw) => {
        let s = raw.trim();
        if (s.startsWith("|")) s = s.slice(1);
        if (/[^\\]\|$/.test(s) || s === "|") s = s.slice(0, -1);
        const cells = [];
        let cur = "";
        for (let i = 0; i < s.length; i++) {
            if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
            if (s[i] === "|") { cells.push(cur); cur = ""; continue; }
            cur += s[i];
        }
        cells.push(cur);
        return cells.map((c) => c.trim());
    };

    const alignOf = (c) => {
        const left = c.startsWith(":");
        const right = c.endsWith(":");
        if (left && right) return " class=\"md-a-c\"";
        if (right) return " class=\"md-a-r\"";
        if (left) return " class=\"md-a-l\"";
        return "";
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trimEnd();
        if (/^\u0000FENCE\d+\u0000$/.test(line.trim())) {
            closeList();
            const idx = Number(line.trim().match(/\d+/)[0]);
            out.push(`<pre><code>${fences[idx]}</code></pre>`);
            continue;
        }
        if (!line.trim()) { closeList(); continue; }

        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
            closeList();
            const level = Math.min(heading[1].length + 1, 4);
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            continue;
        }
        if (/^&gt;\s?/.test(line)) {
            closeList();
            out.push(`<blockquote>${inline(line.replace(/^&gt;\s?/, ""))}</blockquote>`);
            continue;
        }

        // A table is a header row plus a delimiter row of matching arity.
        if (line.includes("|") && i + 1 < lines.length) {
            const head = splitRow(line);
            const delim = splitRow(lines[i + 1].trimEnd());
            const isDelim =
                head.length > 1 &&
                delim.length === head.length &&
                delim.every((c) => /^:?-+:?$/.test(c));
            if (isDelim) {
                closeList();
                const aligns = delim.map(alignOf);
                const th = head.map((c, k) => `<th${aligns[k]}>${inline(c)}</th>`).join("");
                const body = [];
                let j = i + 2;
                for (; j < lines.length; j++) {
                    const r = lines[j].trimEnd();
                    if (!r.trim() || !r.includes("|")) break;
                    const cells = splitRow(r);
                    const tds = head
                        .map((_, k) => `<td${aligns[k]}>${inline(cells[k] ?? "")}</td>`)
                        .join("");
                    body.push(`<tr>${tds}</tr>`);
                }
                out.push(
                    `<table><thead><tr>${th}</tr></thead>` +
                    (body.length ? `<tbody>${body.join("")}</tbody>` : "") +
                    `</table>`,
                );
                i = j - 1;
                continue;
            }
        }

        const ul = /^[-*+]\s+(.*)$/.exec(line);
        const ol = /^\d+\.\s+(.*)$/.exec(line);
        if (ul || ol) {
            const want = ul ? "ul" : "ol";
            if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
            out.push(`<li>${inline((ul || ol)[1])}</li>`);
            continue;
        }
        closeList();
        out.push(`<p>${inline(line)}</p>`);
    }
    closeList();
    return out.join("");
}

// ---------------------------------------------------------------- geometry

const nodeCenter = (n) => ({ x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 });

/** Clip a center-to-center segment at the source node's bounding box. */
function edgeAnchor(from, to) {
    const a = nodeCenter(from);
    const b = nodeCenter(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (!dx && !dy) return a;
    const hw = NODE_W / 2 + 4;
    const hh = NODE_H / 2 + 4;
    const scale = Math.min(
        dx === 0 ? Infinity : hw / Math.abs(dx),
        dy === 0 ? Infinity : hh / Math.abs(dy),
    );
    return { x: a.x + dx * scale, y: a.y + dy * scale };
}

function contentBounds() {
    const items = [];
    for (const n of app.diagram.nodes) items.push({ x: n.x, y: n.y, w: NODE_W, h: NODE_H });
    for (const g of app.diagram.groups) items.push({ x: g.x, y: g.y, w: g.width, h: g.height });
    if (!items.length) return null;
    const minX = Math.min(...items.map((i) => i.x));
    const minY = Math.min(...items.map((i) => i.y));
    const maxX = Math.max(...items.map((i) => i.x + i.w));
    const maxY = Math.max(...items.map((i) => i.y + i.h));
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------- view

const view = { x: 0, y: 0, zoom: 1 };

function applyView() {
    $("world").setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.zoom})`);
    $("zoom-label").textContent = `${Math.round(view.zoom * 100)}%`;
}

function screenToWorld(clientX, clientY) {
    const rect = $("scene").getBoundingClientRect();
    return {
        x: (clientX - rect.left - view.x) / view.zoom,
        y: (clientY - rect.top - view.y) / view.zoom,
    };
}

function zoomAt(factor, clientX, clientY) {
    const rect = $("scene").getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const next = Math.min(3, Math.max(0.15, view.zoom * factor));
    view.x = px - (px - view.x) * (next / view.zoom);
    view.y = py - (py - view.y) * (next / view.zoom);
    view.zoom = next;
    applyView();
}

function fitToContent() {
    const b = contentBounds();
    const rect = $("scene").getBoundingClientRect();
    if (!b) {
        view.x = rect.width / 2;
        view.y = rect.height / 2;
        view.zoom = 1;
        return applyView();
    }
    const pad = 70;
    const zoom = Math.min(
        3,
        Math.max(0.15, Math.min((rect.width - pad * 2) / b.width, (rect.height - pad * 2) / b.height)),
    );
    view.zoom = zoom;
    view.x = rect.width / 2 - (b.minX + b.width / 2) * zoom;
    view.y = rect.height / 2 - (b.minY + b.height / 2) * zoom;
    applyView();
}

// ---------------------------------------------------------------- render

/**
 * @param {object}  [opts]
 * @param {boolean} [opts.inspector] Re-render the inspector panel. Pass false
 *   when the change originates from a focused inspector control: rebuilding the
 *   panel replaces the very input being typed into, which drops focus after the
 *   first keystroke and hands subsequent keys to the canvas shortcuts.
 */
function commit({ rerender = true, dirty = true, inspector = true } = {}) {
    if (dirty) markDirty();
    if (rerender) render({ inspector });
}

/** Commit an edit made from a focused inspector field, leaving the panel alone. */
function commitLive() {
    commit({ inspector: false });
}

let autosaveTimer = null;

function markDirty() {
    app.dirty = true;
    $("status").textContent = "unsaved changes";
    // Autosave. A beforeunload guard is unreliable inside an iframe and
    // actively blocks the host from reloading the canvas, which strands stale
    // state on screen. Persisting continuously removes the need for one.
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        save().catch(() => {
            $("status").textContent = "autosave failed";
        });
    }, 900);
}

function render({ inspector = true } = {}) {
    fitGroups();
    renderGroups();
    renderEdges();
    renderNodes();
    if (inspector) renderInspector();
}

function isSelected(kind, id) {
    return (app.selection.kind === kind && app.selection.id === id) ||
        (kind === "node" && app.selection.extra.has(id));
}

function renderGroups() {
    const layer = $("layer-groups");
    layer.replaceChildren();
    // Shallowest first so nested subgraphs paint on top of their parents.
    const ordered = [...app.diagram.groups].sort((a, b) => groupDepth(a) - groupDepth(b));
    for (const g of ordered) {
        const grp = el("g", { class: `group${isSelected("group", g.id) ? " selected" : ""}` });
        grp.dataset.id = g.id;

        grp.appendChild(el("rect", {
            class: "group-box",
            x: g.x, y: g.y, width: g.width, height: g.height,
            fill: g.background,
            stroke: g.border,
            "stroke-width": 1.5,
            "stroke-dasharray": g.dashed ? "7 5" : null,
        }));

        const head = headerMetrics(g);
        const headTop = g.y - head.height;

        const headRect = el("rect", {
            class: "group-head",
            x: g.x,
            y: headTop,
            width: head.width,
            height: head.height,
            rx: 5,
            fill: g.border,
            opacity: 0.92,
        });
        headRect.dataset.id = g.id;
        headRect.dataset.role = "group-head";
        grp.appendChild(headRect);

        head.lines.forEach((line, index) => {
            const label = el("text", {
                class: "group-label",
                x: g.x + HEADER_PAD_X,
                y: headTop + HEADER_PAD_Y + HEADER_LINE * index + 10.5,
                fill: "#fff",
            });
            label.textContent = line;
            grp.appendChild(label);
        });

        const handle = el("rect", {
            class: "group-resize",
            x: g.x + g.width - 7, y: g.y + g.height - 7, width: 14, height: 14, rx: 3,
        });
        handle.dataset.id = g.id;
        handle.dataset.role = "group-resize";
        grp.appendChild(handle);

        if (g.annotation) grp.appendChild(annotationDot(g.x + g.width - 14, g.y + 14, g.annotation, g.border));
        layer.appendChild(grp);
    }
}

function annotationDot(x, y, markdown, color = "#8250df") {
    const dot = el("g", { class: "anno-dot" });
    dot.appendChild(el("circle", { cx: x, cy: y, r: 8, fill: color, opacity: 0.92 }));
    const glyph = el("text", {
        x, y: y + 3.6, "text-anchor": "middle", "font-size": 11,
        "font-weight": 700, fill: "#fff", "pointer-events": "none",
    });
    glyph.textContent = "i";
    dot.appendChild(glyph);
    dot.addEventListener("mouseenter", (e) => showHoverCard(e, markdown));
    dot.addEventListener("mouseleave", scheduleHideHoverCard);
    return dot;
}

function renderEdges() {
    const layer = $("layer-edges");
    const defs = $("defs");
    layer.replaceChildren();
    defs.replaceChildren();

    const byId = new Map(app.diagram.nodes.map((n) => [n.id, n]));
    // Edge labels collide when several edges share a region. Track what we've
    // placed and nudge later labels clear of earlier ones.
    const placedLabels = [];

    function freeLabelSpot(cx, cy, text) {
        const halfW = Math.max(24, text.length * 3.1);
        const halfH = 8;
        for (let attempt = 0; attempt < 8; attempt++) {
            const y = cy + (attempt % 2 === 0 ? -1 : 1) * Math.ceil(attempt / 2) * 17;
            const hit = placedLabels.some(
                (p) =>
                    Math.abs(p.x - cx) < p.halfW + halfW && Math.abs(p.y - y) < p.halfH + halfH,
            );
            if (!hit) {
                placedLabels.push({ x: cx, y, halfW, halfH });
                return y;
            }
        }
        placedLabels.push({ x: cx, y: cy, halfW, halfH });
        return cy;
    }

    const routes = routeAll(app.diagram.nodes, app.diagram.edges, {
        // The editor has real text metrics, so the header bars it tells the
        // router about are exactly the ones it will draw.
        labels: app.diagram.groups.map((g) => {
            const head = headerMetrics(g);
            return { x: g.x, y: g.y - head.height, w: head.width, h: head.height };
        }),
    });

    for (const e of app.diagram.edges) {
        const from = byId.get(e.from);
        const to = byId.get(e.to);
        if (!from || !to) continue;

        const route = routes.get(e.id) || routeEdge(from, to, e.route, 0);
        const p1 = route.start;
        const p2 = route.end;

        const forward = e.arrow === "forward" || e.arrow === "both";
        const backward = e.arrow === "backward" || e.arrow === "both";
        if (forward) defs.appendChild(marker(`${e.id}-end`, e.color, false));
        if (backward) defs.appendChild(marker(`${e.id}-start`, e.color, true));

        const grp = el("g", { class: `edge${isSelected("edge", e.id) ? " selected" : ""}` });
        grp.dataset.id = e.id;

        grp.appendChild(el("path", {
            class: "edge-line",
            d: route.d,
            stroke: e.color,
            "stroke-width": e.width,
            "stroke-dasharray": e.dashed ? "7 5" : null,
            "marker-end": forward ? `url(#arw-${e.id}-end)` : null,
            "marker-start": backward ? `url(#arw-${e.id}-start)` : null,
        }));

        const hit = el("path", { class: "edge-hit", d: route.d });
        hit.dataset.id = e.id;
        hit.dataset.role = "edge";
        grp.appendChild(hit);

        const mx = route.mid.x;
        const my = route.mid.y;
        if (e.label) {
            const ly = freeLabelSpot(mx, my - 6, e.label);
            const t = el("text", { class: "edge-label", x: mx, y: ly });
            t.textContent = e.label;
            grp.appendChild(t);
        }
        if (e.annotation) grp.appendChild(annotationDot(mx, my + 13, e.annotation, e.color));

        layer.appendChild(grp);
    }
}

function marker(id, color, flip) {
    const m = el("marker", {
        id: `arw-${id}`,
        viewBox: "0 0 10 10",
        refX: flip ? 1 : 9,
        refY: 5,
        markerWidth: 6.5,
        markerHeight: 6.5,
        // Plain "auto", not "auto-start-reverse": the start marker's path is
        // already drawn pointing backwards below. Letting the renderer reverse
        // it as well cancels out, and a bidirectional edge ends up with both
        // heads pointing the same way. "auto" is also the portable choice —
        // auto-start-reverse is SVG 2 and not honoured by every consumer of the
        // exported file.
        orient: "auto",
        markerUnits: "strokeWidth",
    });
    m.appendChild(el("path", { d: flip ? "M 10 0 L 0 5 L 10 10 z" : "M 0 0 L 10 5 L 0 10 z", fill: color }));
    return m;
}

function renderNodes() {
    const layer = $("layer-nodes");
    layer.replaceChildren();

    for (const n of app.diagram.nodes) {
        const isSource = app.connectFrom === n.id;
        const grp = el("g", {
            class: `node${isSelected("node", n.id) ? " selected" : ""}${isSource ? " connect-source" : ""}`,
        });
        grp.dataset.id = n.id;
        grp.dataset.role = "node";

        grp.appendChild(el("rect", { class: "node-box", x: n.x, y: n.y, width: NODE_W, height: NODE_H }));

        if (n.iconId) {
            grp.appendChild(el("image", {
                href: `/api/icon/${encodeURIComponent(n.iconId)}.svg?v=${n.variant || 0}`,
                x: n.x + (NODE_W - ICON) / 2,
                y: n.y + 9,
                width: ICON,
                height: ICON,
                "pointer-events": "none",
            }));
        }

        const label = el("text", { class: "node-label", x: n.x + NODE_W / 2, y: n.y + 63 });
        label.textContent = truncate(n.label || "Untitled", 15);
        grp.appendChild(label);

        if (n.sublabel) {
            const sub = el("text", { class: "node-sub", x: n.x + NODE_W / 2, y: n.y + 75 });
            sub.textContent = truncate(n.sublabel, 18);
            grp.appendChild(sub);
        }

        if (n.annotation) grp.appendChild(annotationDot(n.x + NODE_W - 11, n.y + 11, n.annotation));

        // Connection handle: visible on the selected node, drag it to connect.
        if (app.selection.kind === "node" && app.selection.id === n.id && !app.selection.extra.size) {
            const port = el("g", { class: "port" });
            port.dataset.id = n.id;
            port.dataset.role = "port";
            port.appendChild(el("circle", {
                cx: n.x + NODE_W,
                cy: n.y + NODE_H / 2,
                r: 9,
                class: "port-hit",
            }));
            port.appendChild(el("circle", {
                cx: n.x + NODE_W,
                cy: n.y + NODE_H / 2,
                r: 5.5,
                class: "port-dot",
            }));
            const glyph = el("text", {
                x: n.x + NODE_W,
                y: n.y + NODE_H / 2 + 3.2,
                class: "port-glyph",
            });
            glyph.textContent = "→";
            port.appendChild(glyph);
            grp.appendChild(port);
        }

        layer.appendChild(grp);
    }
}

function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------------------------------------------------------------- hover card

let hoverTimer = null;

function showHoverCard(event, markdown) {
    clearTimeout(hoverTimer);
    const card = $("hover-card");
    card.innerHTML = renderMarkdown(markdown);
    card.hidden = false;

    const host = $("viewport").getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    let left = event.clientX - host.left + 14;
    let top = event.clientY - host.top + 14;
    if (left + cardRect.width > host.width - 8) left = host.width - cardRect.width - 8;
    if (top + cardRect.height > host.height - 8) top = Math.max(8, host.height - cardRect.height - 8);
    card.style.left = `${Math.max(8, left)}px`;
    card.style.top = `${top}px`;
}

function scheduleHideHoverCard() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { $("hover-card").hidden = true; }, 260);
}

$("hover-card").addEventListener("mouseenter", () => clearTimeout(hoverTimer));
$("hover-card").addEventListener("mouseleave", scheduleHideHoverCard);

// ---------------------------------------------------------------- interaction

const drag = { active: false, kind: null, id: null, start: null, origin: null, moved: false };

$("viewport").addEventListener("wheel", (e) => {
    // The hover card is a child of the viewport, so its wheel events bubble
    // here. Let scrollable overlays consume the wheel instead of zooming.
    if (e.target instanceof Element && e.target.closest(".hover-card")) return;
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
}, { passive: false });

$("scene").addEventListener("pointerdown", (e) => {
    const target = e.target.closest("[data-role]");
    const role = target?.dataset.role;
    const id = target?.dataset.id;

    if (app.mode === "connect" && role === "node") {
        if (!app.connectFrom) {
            app.connectFrom = id;
            render(); // highlights the source
            drawRubberBand(screenToWorld(e.clientX, e.clientY));
            flash("Now click the target component · Esc to cancel", true);
        } else if (app.connectFrom === id) {
            flash("Pick a different component as the target", true);
        } else {
            addEdge(app.connectFrom, id);
            app.connectFrom = null;
            clearRubberBand();
            setMode("select");
        }
        return;
    }

    // Drag handle on a selected node: drag it onto another node to connect.
    if (role === "port") {
        app.connectFrom = id;
        beginDrag(e, "port", id);
        drawRubberBand(screenToWorld(e.clientX, e.clientY));
        flash("Drop on the target component", true);
        return;
    }

    if (role === "node") {
        if (e.shiftKey) {
            app.selection.extra.add(id);
            if (!app.selection.id) { app.selection.kind = "node"; app.selection.id = id; }
        } else if (!isSelected("node", id)) {
            select("node", id);
        }
        beginDrag(e, "node", id);
        return;
    }
    if (role === "group-head") { select("group", id); beginDrag(e, "group", id); return; }
    if (role === "group-resize") { select("group", id); beginDrag(e, "group-resize", id); return; }
    if (role === "edge") { select("edge", id); return; }

    // Empty space: cancel a pending connection, otherwise clear and pan.
    if (app.mode === "connect") {
        cancelConnect({ keepMode: true });
        return;
    }
    select(null, null);
    beginDrag(e, "pan", null);
});

function beginDrag(e, kind, id) {
    drag.active = true;
    drag.kind = kind;
    drag.id = id;
    drag.moved = false;
    drag.start = { x: e.clientX, y: e.clientY };

    if (kind === "pan") {
        drag.origin = { x: view.x, y: view.y };
        $("viewport").classList.add("panning");
    } else if (kind === "node") {
        const ids = new Set([id, ...app.selection.extra]);
        drag.origin = [...ids]
            .map((nid) => app.diagram.nodes.find((n) => n.id === nid))
            .filter(Boolean)
            .map((n) => ({ id: n.id, x: n.x, y: n.y }));
    } else if (kind === "group" || kind === "group-resize") {
        const g = groupById(id);
        if (!g) return;
        drag.origin = {
            x: g.x,
            y: g.y,
            width: g.width,
            height: g.height,
            padding: Number.isFinite(g.padding) ? g.padding : 34,
            // Every node at any nesting depth, plus empty child subgraphs which
            // have no members to carry them along.
            nodes: descendantNodes(id).map((n) => ({ id: n.id, x: n.x, y: n.y })),
            emptyGroups: descendantGroups(id)
                .filter((k) => !groupNodes(k.id).length && !childGroups(k.id).length)
                .map((k) => ({ id: k.id, x: k.x, y: k.y })),
            selfEmpty: !groupNodes(id).length && !childGroups(id).length,
        };
    }
    $("scene").setPointerCapture(e.pointerId);
}

$("scene").addEventListener("pointermove", (e) => {
    // Live preview while connecting, whether click-click or handle-drag.
    if (app.connectFrom && (app.mode === "connect" || drag.kind === "port")) {
        drawRubberBand(screenToWorld(e.clientX, e.clientY));
    }
    if (!drag.active) return;
    if (drag.kind === "port") return; // preview only; nothing moves
    const dx = e.clientX - drag.start.x;
    const dy = e.clientY - drag.start.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;

    if (drag.kind === "pan") {
        view.x = drag.origin.x + dx;
        view.y = drag.origin.y + dy;
        return applyView();
    }

    const wdx = dx / view.zoom;
    const wdy = dy / view.zoom;

    if (drag.kind === "node") {
        for (const o of drag.origin) {
            const n = app.diagram.nodes.find((x) => x.id === o.id);
            if (n) { n.x = Math.round(o.x + wdx); n.y = Math.round(o.y + wdy); }
        }
        return commit({ dirty: false });
    }
    if (drag.kind === "group") {
        const g = groupById(drag.id);
        if (!g) return;
        for (const m of drag.origin.nodes) {
            const n = app.diagram.nodes.find((x) => x.id === m.id);
            if (n) { n.x = Math.round(m.x + wdx); n.y = Math.round(m.y + wdy); }
        }
        for (const m of drag.origin.emptyGroups) {
            const k = groupById(m.id);
            if (k) { k.x = Math.round(m.x + wdx); k.y = Math.round(m.y + wdy); }
        }
        // A subgraph with members is positioned by fitGroups(); only an empty
        // one needs its box moved directly.
        if (drag.origin.selfEmpty) {
            g.x = Math.round(drag.origin.x + wdx);
            g.y = Math.round(drag.origin.y + wdy);
        }
        return commit({ dirty: false });
    }
    if (drag.kind === "group-resize") {
        const g = groupById(drag.id);
        if (!g) return;
        if (drag.origin.selfEmpty) {
            g.width = Math.max(120, Math.round(drag.origin.width + wdx));
            g.height = Math.max(100, Math.round(drag.origin.height + wdy));
        } else {
            // Non-empty subgraphs are auto-fitted, so the handle tunes the
            // padding around the members instead of a fixed size.
            g.padding = Math.max(16, Math.round(drag.origin.padding + Math.max(wdx, wdy)));
        }
        return commit({ dirty: false });
    }
});

$("scene").addEventListener("pointerup", (e) => {
    // Handle-drag connect: resolve whatever node is under the pointer.
    if (drag.kind === "port") {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const targetNode = under?.closest?.('[data-role="node"]');
        const targetId = targetNode?.dataset.id;
        if (targetId && targetId !== app.connectFrom) {
            addEdge(app.connectFrom, targetId);
            flash("Connected");
        } else {
            flash("Drop on a different component to connect");
        }
        app.connectFrom = null;
        clearRubberBand();
        drag.active = false;
        drag.kind = null;
        try { $("scene").releasePointerCapture(e.pointerId); } catch { /* already released */ }
        render();
        return;
    }

    if (!drag.active) return;
    $("viewport").classList.remove("panning");
    if (drag.moved && drag.kind !== "pan") {
        // Membership is sticky. Shift-drop re-parents into whatever subgraph
        // the node was dropped on (or out of all of them).
        if (drag.kind === "node" && e.shiftKey) {
            for (const o of drag.origin) {
                const n = app.diagram.nodes.find((x) => x.id === o.id);
                if (!n) continue;
                const target = groupAt(nodeCenter(n));
                n.group = target ? target.id : null;
            }
            flash("Re-parented");
        }
        markDirty();
        render();
    }
    drag.active = false;
    drag.kind = null;
    try { $("scene").releasePointerCapture(e.pointerId); } catch { /* pointer already released */ }
});

/** A node's subgraph membership is explicit and sticky: moving a node never
 *  silently re-parents it. Hold Shift while dropping to re-parent. */

const HEADER_LINE = 14;
const HEADER_PAD_X = 9;
const HEADER_PAD_Y = 4;
const HEADER_MIN_W = 90;

// Real text measurement. The old width estimate (label.length * 7) both
// mis-measured proportional fonts and ignored the subgraph box, so long titles
// spilled far past the group.
const measureCtx = document.createElement("canvas").getContext("2d");
let labelFont = null;

function groupLabelFont() {
    if (labelFont) return labelFont;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;font-weight:600;font-size:11px";
    probe.style.fontFamily = getComputedStyle(document.body).fontFamily;
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    labelFont = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    probe.remove();
    return labelFont;
}

function measureLabel(text) {
    measureCtx.font = groupLabelFont();
    return measureCtx.measureText(text).width;
}

/** Word-wrap, hard-breaking any single word too long to fit on its own line. */
function wrapLabel(text, maxWidth) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    const flush = () => {
        if (current) { lines.push(current); current = ""; }
    };

    for (let word of words) {
        while (measureLabel(word) > maxWidth) {
            let chunk = "";
            for (const ch of word) {
                if (chunk && measureLabel(chunk + ch) > maxWidth) break;
                chunk += ch;
            }
            if (!chunk) break;
            flush();
            lines.push(chunk);
            word = word.slice(chunk.length);
            if (!word) break;
        }
        if (!word) continue;

        const trial = current ? `${current} ${word}` : word;
        if (!current || measureLabel(trial) <= maxWidth) current = trial;
        else { lines.push(current); current = word; }
    }
    flush();
    return lines.length ? lines : [""];
}

/** Header bar geometry for a subgraph: never wider than the box it labels. */
function headerMetrics(g) {
    const box = Math.max(HEADER_MIN_W, g.width || 300);
    const maxText = Math.max(40, box - HEADER_PAD_X * 2);
    const lines = wrapLabel(g.label, maxText);
    const textWidth = Math.max(...lines.map(measureLabel));
    return {
        lines,
        width: Math.min(Math.max(HEADER_MIN_W, Math.ceil(textWidth) + HEADER_PAD_X * 2), box),
        height: lines.length * HEADER_LINE + HEADER_PAD_Y * 2,
    };
}

const groupById = (id) => app.diagram.groups.find((g) => g.id === id) || null;
const childGroups = (id) => app.diagram.groups.filter((g) => g.parent === id);
const groupNodes = (id) => app.diagram.nodes.filter((n) => n.group === id);

function groupDepth(g) {
    let depth = 0;
    let cursor = g;
    while (cursor?.parent && depth < 32) {
        cursor = groupById(cursor.parent);
        depth++;
    }
    return depth;
}

/** Every subgraph nested beneath `id`, at any depth. */
function descendantGroups(id, out = []) {
    for (const child of childGroups(id)) {
        out.push(child);
        descendantGroups(child.id, out);
    }
    return out;
}

/** Every node inside `id` or any subgraph nested beneath it. */
function descendantNodes(id) {
    const ids = new Set([id, ...descendantGroups(id).map((g) => g.id)]);
    return app.diagram.nodes.filter((n) => ids.has(n.group));
}

/** True if `candidateId` is `groupId` or one of its ancestors (cycle guard). */
function isAncestor(candidateId, groupId) {
    let cursor = groupById(groupId);
    let guard = 0;
    while (cursor && guard++ < 32) {
        if (cursor.id === candidateId) return true;
        cursor = cursor.parent ? groupById(cursor.parent) : null;
    }
    return false;
}

/**
 * Resize every non-empty subgraph to wrap its members, deepest first so a
 * parent sees its children's final bounds. Empty subgraphs keep their manual
 * box so they can be drawn and filled later.
 */
function fitGroups() {
    const ordered = [...app.diagram.groups].sort((a, b) => groupDepth(b) - groupDepth(a));
    for (const g of ordered) {
        const nodes = groupNodes(g.id);
        const kids = childGroups(g.id);
        if (!nodes.length && !kids.length) continue;

        const pad = Number.isFinite(g.padding) ? g.padding : 34;
        const x1 = [];
        const y1 = [];
        const x2 = [];
        const y2 = [];
        for (const n of nodes) {
            x1.push(n.x); y1.push(n.y);
            x2.push(n.x + NODE_W); y2.push(n.y + NODE_H);
        }
        for (const k of kids) {
            // Reserve room for the child's header bar, which sits above its box
            // and may now be several lines tall.
            const head = headerMetrics(k);
            x1.push(k.x); y1.push(k.y - head.height);
            x2.push(k.x + k.width); y2.push(k.y + k.height);
        }
        g.x = Math.round(Math.min(...x1) - pad);
        g.y = Math.round(Math.min(...y1) - pad);
        g.width = Math.round(Math.max(...x2) + pad - g.x);
        g.height = Math.round(Math.max(...y2) + pad - g.y);
    }
}

/** Innermost subgraph whose box contains the point. */
function groupAt(point, exclude = new Set()) {
    return (
        [...app.diagram.groups]
            .filter((g) => !exclude.has(g.id))
            .sort((a, b) => groupDepth(b) - groupDepth(a))
            .find(
                (g) =>
                    point.x >= g.x &&
                    point.x <= g.x + g.width &&
                    point.y >= g.y &&
                    point.y <= g.y + g.height,
            ) || null
    );
}

function select(kind, id) {
    app.selection = { kind, id, extra: new Set() };
    render();
}

function setMode(mode) {
    app.mode = mode;
    if (mode !== "connect") {
        app.connectFrom = null;
        clearRubberBand();
        clearHint();
    }
    $("btn-connect").classList.toggle("active", mode === "connect");
    $("viewport").classList.toggle("connecting", mode === "connect");
    if (mode === "connect") flash("Click the source component", true);
}

let flashTimer = null;
function flash(message, sticky = false) {
    const hint = $("hint");
    hint.textContent = message;
    hint.classList.add("show");
    clearTimeout(flashTimer);
    if (!sticky) {
        flashTimer = setTimeout(() => hint.classList.remove("show"), 2600);
    }
}

function clearHint() {
    clearTimeout(flashTimer);
    $("hint").classList.remove("show");
}

/** Live preview line while a connection is being drawn. */
function drawRubberBand(toPoint) {
    const from = app.diagram.nodes.find((n) => n.id === app.connectFrom);
    if (!from) return;
    const layer = $("layer-overlay");
    layer.replaceChildren();

    const a = edgeAnchor(from, {
        x: toPoint.x - NODE_W / 2,
        y: toPoint.y - NODE_H / 2,
    });
    layer.appendChild(el("path", {
        d: `M ${a.x} ${a.y} L ${toPoint.x} ${toPoint.y}`,
        stroke: "var(--accent, #0969da)",
        "stroke-width": 2,
        "stroke-dasharray": "6 4",
        fill: "none",
        "pointer-events": "none",
    }));
    layer.appendChild(el("circle", {
        cx: toPoint.x,
        cy: toPoint.y,
        r: 4,
        fill: "var(--accent, #0969da)",
        "pointer-events": "none",
    }));
}

function clearRubberBand() {
    $("layer-overlay").replaceChildren();
}

/** Cancel an in-progress connection without leaving stale state behind. */
function cancelConnect({ keepMode = false } = {}) {
    app.connectFrom = null;
    clearRubberBand();
    if (keepMode && app.mode === "connect") {
        flash("Click the source component", true);
    } else {
        setMode("select");
    }
    render();
}

// ---------------------------------------------------------------- mutations

function addNode(icon, at, opts = {}) {
    const rect = $("scene").getBoundingClientRect();
    const center = at || screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    // Membership is explicit: inherit from the caller, else the selected
    // subgraph, else none.
    const group =
        opts.group !== undefined
            ? opts.group
            : app.selection.kind === "group"
              ? app.selection.id
              : null;
    const node = {
        id: uid("n"),
        iconId: icon.id,
        variant: 0,
        label: icon.name,
        sublabel: "",
        x: Math.round(center.x - NODE_W / 2 + (at ? 0 : Math.random() * 40 - 20)),
        y: Math.round(center.y - NODE_H / 2 + (at ? 0 : Math.random() * 40 - 20)),
        group,
        annotation: "",
    };
    app.diagram.nodes.push(node);
    select("node", node.id);
    markDirty();
    if (opts.suggest !== false) requestSuggestions(icon, node.id);
    return node;
}

function addEdge(from, to) {
    const edge = {
        id: uid("e"),
        from, to,
        label: "",
        color: PALETTE[1],
        dashed: false,
        width: 2,
        arrow: "forward",
        route: "straight",
        annotation: "",
    };
    app.diagram.edges.push(edge);
    select("edge", edge.id);
    markDirty();
    return edge;
}

function addGroup() {
    const members = app.diagram.nodes.filter((n) => isSelected("node", n.id));
    const tint = GROUP_TINTS[app.diagram.groups.length % GROUP_TINTS.length];

    // Nest when the intent is unambiguous: all selected nodes already share a
    // parent, or a subgraph is selected and we're adding an empty one inside it.
    let parent = null;
    if (members.length) {
        const parents = new Set(members.map((n) => n.group));
        if (parents.size === 1) parent = [...parents][0];
    } else if (app.selection.kind === "group") {
        parent = app.selection.id;
    }

    let box;
    if (members.length) {
        const pad = 34;
        box = {
            x: Math.min(...members.map((n) => n.x)) - pad,
            y: Math.min(...members.map((n) => n.y)) - pad,
            width: Math.max(...members.map((n) => n.x + NODE_W)) - Math.min(...members.map((n) => n.x)) + pad * 2,
            height: Math.max(...members.map((n) => n.y + NODE_H)) - Math.min(...members.map((n) => n.y)) + pad * 2,
        };
    } else {
        const anchor = parent ? groupById(parent) : null;
        const rect = $("scene").getBoundingClientRect();
        const c = anchor
            ? { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 }
            : screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
        box = { x: c.x - 150, y: c.y - 100, width: 300, height: 200 };
    }

    const group = {
        id: uid("g"),
        label: members.length ? "New subgraph" : "Subgraph",
        parent,
        ...box,
        padding: 34,
        border: tint.border,
        background: tint.background,
        dashed: true,
        annotation: "",
    };
    app.diagram.groups.push(group);
    for (const member of members) member.group = group.id;
    select("group", group.id);
    markDirty();
    render();
}

function deleteSelection() {
    const { kind, id, extra } = app.selection;
    if (!kind) return;
    if (kind === "node") {
        const ids = new Set([id, ...extra]);
        app.diagram.nodes = app.diagram.nodes.filter((n) => !ids.has(n.id));
        app.diagram.edges = app.diagram.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
    } else if (kind === "edge") {
        app.diagram.edges = app.diagram.edges.filter((e) => e.id !== id);
    } else if (kind === "group") {
        app.diagram.groups = app.diagram.groups.filter((g) => g.id !== id);
        for (const n of app.diagram.nodes) if (n.group === id) n.group = null;
    }
    select(null, null);
    markDirty();
}

// ---------------------------------------------------------------- inspector

function field(label, control, hint, opts = {}) {
    const wrap = document.createElement("div");
    wrap.className = opts.grow ? "field grow" : "field";
    const lab = document.createElement("label");
    lab.textContent = label;
    wrap.append(lab, control);
    if (hint) {
        const h = document.createElement("div");
        h.className = "hintline";
        h.textContent = hint;
        wrap.appendChild(h);
    }
    return wrap;
}

function textInput(value, onInput) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.addEventListener("input", () => onInput(input.value));
    return input;
}

function textArea(value, onInput, placeholder) {
    const area = document.createElement("textarea");
    area.value = value || "";
    area.placeholder = placeholder || "";
    area.addEventListener("input", () => onInput(area.value));
    return area;
}

function segmented(options, current, onPick) {
    const wrap = document.createElement("div");
    wrap.className = "seg";
    for (const opt of options) {
        const btn = document.createElement("button");
        btn.textContent = opt.label;
        btn.className = opt.value === current ? "active" : "";
        btn.addEventListener("click", () => onPick(opt.value));
        wrap.appendChild(btn);
    }
    return wrap;
}

function swatches(current, onPick) {
    const wrap = document.createElement("div");
    wrap.className = "swatches";
    for (const color of PALETTE) {
        const dot = document.createElement("button");
        dot.className = `swatch${color === current ? " active" : ""}`;
        dot.style.background = color;
        dot.title = color;
        dot.addEventListener("click", () => onPick(color));
        wrap.appendChild(dot);
    }
    return wrap;
}

function renderInspector() {
    const panel = $("inspector");
    const body = $("insp-body");
    const { kind, id } = app.selection;
    if (!kind) { panel.hidden = true; return; }
    panel.hidden = false;
    body.replaceChildren();

    if (kind === "node") {
        const n = app.diagram.nodes.find((x) => x.id === id);
        if (!n) { panel.hidden = true; return; }
        $("insp-title").textContent = "Component";

        body.append(
            field("Label", textInput(n.label, (v) => { n.label = v; commitLive(); })),
            field("Sublabel", textInput(n.sublabel, (v) => { n.sublabel = v; commitLive(); })),
        );

        const swap = document.createElement("button");
        swap.className = "btn";
        swap.textContent = "Change icon…";
        swap.addEventListener("click", () => openPicker("replace"));
        body.append(field("Icon", swap));

        const groupSelect = document.createElement("select");
        groupSelect.appendChild(new Option("— none —", ""));
        for (const g of app.diagram.groups) {
            groupSelect.appendChild(new Option(g.label, g.id, false, n.group === g.id));
        }
        groupSelect.addEventListener("change", () => {
            n.group = groupSelect.value || null;
            commit();
        });
        body.append(field("Subgraph", groupSelect));

        body.append(field(
            "Annotation (markdown)",
            textArea(n.annotation, (v) => { n.annotation = v; commitLive(); }, "## Notes\n- Scales to 10 pods\n- Owner: platform team"),
            "Shown in a scrollable card on hover.",
            { grow: true },
        ));
    }

    if (kind === "edge") {
        const e = app.diagram.edges.find((x) => x.id === id);
        if (!e) { panel.hidden = true; return; }
        $("insp-title").textContent = "Connection";

        body.append(field("Label", textInput(e.label, (v) => { e.label = v; commitLive(); })));
        body.append(field("Route", segmented(
            [
                { label: "Straight", value: "straight" },
                { label: "L", value: "orthogonal" },
                { label: "S", value: "curved" },
            ],
            e.route || "straight",
            (v) => { e.route = v; commit(); },
        ), "L = right angles, best for dense diagrams. S = curved."));
        body.append(field("Colour", swatches(e.color, (c) => { e.color = c; commit(); })));
        body.append(field("Line", segmented(
            [{ label: "Solid", value: false }, { label: "Dashed", value: true }],
            e.dashed,
            (v) => { e.dashed = v; commit(); },
        )));
        body.append(field("Arrows", segmented(
            [
                { label: "—", value: "none" },
                { label: "→", value: "forward" },
                { label: "←", value: "backward" },
                { label: "↔", value: "both" },
            ],
            e.arrow,
            (v) => { e.arrow = v; commit(); },
        )));

        const thickness = document.createElement("input");
        thickness.type = "range";
        thickness.min = "1";
        thickness.max = "6";
        thickness.step = "0.5";
        thickness.value = String(e.width);
        thickness.addEventListener("input", () => { e.width = Number(thickness.value); commitLive(); });
        body.append(field("Thickness", thickness));

        const flip = document.createElement("button");
        flip.className = "btn";
        flip.textContent = "Reverse direction";
        flip.addEventListener("click", () => {
            [e.from, e.to] = [e.to, e.from];
            commit();
        });
        body.append(field("Endpoints", flip));

        body.append(field(
            "Annotation (markdown)",
            textArea(e.annotation, (v) => { e.annotation = v; commitLive(); }, "Protocol: HTTPS\nAuth: managed identity"),
            "Shown in a scrollable card on hover.",
            { grow: true },
        ));
    }

    if (kind === "group") {
        const g = app.diagram.groups.find((x) => x.id === id);
        if (!g) { panel.hidden = true; return; }
        $("insp-title").textContent = "Subgraph";

        body.append(field("Label", textInput(g.label, (v) => { g.label = v; commitLive(); })));

        // Nesting. Exclude self and descendants, or we'd create a cycle that
        // makes fitGroups() recurse forever.
        const parentSelect = document.createElement("select");
        parentSelect.appendChild(new Option("— top level —", ""));
        for (const other of app.diagram.groups) {
            if (other.id === g.id || isAncestor(g.id, other.id)) continue;
            parentSelect.appendChild(new Option(other.label, other.id, false, g.parent === other.id));
        }
        parentSelect.addEventListener("change", () => {
            g.parent = parentSelect.value || null;
            commit();
        });
        const nested = childGroups(g.id).length;
        body.append(field(
            "Nested inside",
            parentSelect,
            nested ? `Contains ${nested} nested subgraph${nested === 1 ? "" : "s"}.` : undefined,
        ));

        const tints = document.createElement("div");
        tints.className = "swatches";
        for (const tint of GROUP_TINTS) {
            const dot = document.createElement("button");
            dot.className = `swatch${tint.border === g.border ? " active" : ""}`;
            dot.style.background = tint.background;
            dot.style.borderColor = tint.border;
            dot.style.borderStyle = "solid";
            dot.addEventListener("click", () => {
                g.border = tint.border;
                g.background = tint.background;
                commit();
            });
            tints.appendChild(dot);
        }
        body.append(field("Tint", tints, "Border and fill for this subgraph."));

        body.append(field("Border", segmented(
            [{ label: "Dashed", value: true }, { label: "Solid", value: false }],
            g.dashed,
            (v) => { g.dashed = v; commit(); },
        )));

        const members = app.diagram.nodes.filter((n) => n.group === g.id).length;
        const auto = members || childGroups(g.id).length;
        body.append(field(
            "Annotation (markdown)",
            textArea(g.annotation, (v) => { g.annotation = v; commitLive(); }),
            auto
                ? `${members} component${members === 1 ? "" : "s"} inside · auto-fits, corner handle adjusts padding (${g.padding ?? 34}px).`
                : "Empty subgraph · corner handle resizes it.",
            { grow: true },
        ));
    }

    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "Delete";
    del.addEventListener("click", deleteSelection);
    body.append(del);
}

$("insp-close").addEventListener("click", () => select(null, null));

// ---------------------------------------------------------------- icon picker

let pickerQuery = "";
let pickerCollection = null;

function openPicker(target = "node") {
    app.pickerTarget = target;
    $("picker").hidden = false;
    $("picker-search").value = pickerQuery;
    $("picker-search").focus();
    $("picker-search").select();
    loadIcons();
}

function closePicker() { $("picker").hidden = true; }

async function loadIcons() {
    const params = new URLSearchParams({ q: pickerQuery, limit: "160" });
    if (pickerCollection) params.set("c", pickerCollection);
    const res = await fetch(`/api/icons?${params}`);
    const { items } = await res.json();

    const grid = $("picker-grid");
    grid.replaceChildren();
    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No icons match that search.";
        grid.appendChild(empty);
    }
    for (const item of items) {
        const cell = document.createElement("button");
        cell.className = "icon-cell";
        cell.title = `${item.name} — ${item.collectionLabel}`;

        const img = document.createElement("img");
        img.src = `/api/icon/${encodeURIComponent(item.id)}.svg`;
        img.alt = "";
        img.loading = "lazy";

        const name = document.createElement("div");
        name.className = "nm";
        name.textContent = item.name;

        const coll = document.createElement("div");
        coll.className = "cl";
        coll.textContent = item.collectionLabel;

        cell.append(img, name, coll);
        cell.addEventListener("click", () => {
            if (app.pickerTarget === "replace" && app.selection.kind === "node") {
                const n = app.diagram.nodes.find((x) => x.id === app.selection.id);
                if (n) { n.iconId = item.id; n.variant = 0; commit(); }
            } else {
                addNode(item);
                render();
            }
            closePicker();
        });
        grid.appendChild(cell);
    }
    $("picker-count").textContent = `${items.length} shown`;
}

let searchTimer = null;
$("picker-search").addEventListener("input", (e) => {
    pickerQuery = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadIcons, 130);
});
$("picker-close").addEventListener("click", closePicker);
$("picker").addEventListener("click", (e) => { if (e.target.id === "picker") closePicker(); });

function renderFilters() {
    const wrap = $("picker-filters");
    wrap.replaceChildren();
    const all = document.createElement("button");
    all.className = `chip${pickerCollection === null ? " active" : ""}`;
    all.textContent = `All (${app.iconCount})`;
    all.addEventListener("click", () => { pickerCollection = null; renderFilters(); loadIcons(); });
    wrap.appendChild(all);

    for (const c of app.collections) {
        const chip = document.createElement("button");
        chip.className = `chip${pickerCollection === c.id ? " active" : ""}`;
        chip.textContent = `${c.label} (${c.count})`;
        chip.addEventListener("click", () => { pickerCollection = c.id; renderFilters(); loadIcons(); });
        wrap.appendChild(chip);
    }
}

// ---------------------------------------------------------------- suggestions

async function requestSuggestions(icon, originNodeId = null) {
    app.assistOrigin = originNodeId;
    try {
        const res = await fetch("/api/suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                iconId: icon.id,
                name: icon.name,
                existing: app.diagram.nodes.map((n) => n.iconId).filter(Boolean),
            }),
        });
        renderAssist(await res.json(), icon, originNodeId);
    } catch {
        /* suggestions are best-effort */
    }
}

/** Place a suggested node on a ring around its origin, skipping occupied spots. */
function placeAround(origin, index) {
    const radius = 210;
    const angle = (-Math.PI / 3) + index * (Math.PI / 5);
    return {
        x: origin.x + NODE_W / 2 + Math.cos(angle) * radius,
        y: origin.y + NODE_H / 2 + Math.sin(angle) * radius,
    };
}

function renderAssist(data, icon, originNodeId = null) {
    if (!data || (!data.suggestions?.length && !data.questions?.length)) return;
    const panel = $("assist");
    const body = $("assist-body");
    $("assist-title").textContent = data.topic ? `Because you added ${icon.name}` : "Suggestions";
    body.replaceChildren();

    if (data.suggestions?.length) {
        const label = document.createElement("div");
        label.className = "section-label";
        label.textContent = "Often paired with";
        body.appendChild(label);

        data.suggestions.forEach((s, index) => {
            const item = document.createElement("button");
            item.className = "sug-item";

            const img = document.createElement("img");
            img.src = `/api/icon/${encodeURIComponent(s.iconId)}.svg`;
            img.alt = "";

            const text = document.createElement("div");
            const title = document.createElement("div");
            title.className = "t";
            title.textContent = s.name;
            const reason = document.createElement("div");
            reason.className = "r";
            // Surface the connector that will be drawn, so accepting is predictable.
            const arrow = s.edge?.dir === "in" ? "\u2190" : "\u2192";
            reason.textContent = s.edge?.label
                ? `${arrow} ${s.edge.label}`
                : `${s.collectionLabel} \u00b7 ${s.reason}`;
            text.append(title, reason);

            item.append(img, text);
            item.addEventListener("click", () => {
                const origin = originNodeId
                    ? app.diagram.nodes.find((n) => n.id === originNodeId)
                    : null;

                const node = addNode(
                    { id: s.iconId, name: s.name },
                    origin ? placeAround(origin, index) : null,
                    // Inherit the origin's subgraph, and don't cascade a fresh
                    // suggestion panel on every accepted suggestion.
                    { group: origin ? origin.group : null, suggest: false },
                );

                if (origin && s.edge && s.edge.dir !== "none") {
                    const [from, to] =
                        s.edge.dir === "in" ? [node.id, origin.id] : [origin.id, node.id];
                    app.diagram.edges.push({
                        id: uid("e"),
                        from,
                        to,
                        label: s.edge.label || "",
                        color: s.edge.color || PALETTE[1],
                        dashed: Boolean(s.edge.dashed),
                        width: 2,
                        arrow: "forward",
                        route: "straight",
                        annotation: "",
                    });
                }
                render();
                item.remove();
            });
            body.appendChild(item);
        });
    }

    for (const q of data.questions || []) {
        const block = document.createElement("div");
        block.className = "q-block";

        const text = document.createElement("div");
        text.className = "q-text";
        text.textContent = q.text;
        block.appendChild(text);

        const opts = document.createElement("div");
        opts.className = "q-opts";
        for (const option of q.options) {
            const btn = document.createElement("button");
            btn.className = `q-opt${app.answers[q.id] === option ? " picked" : ""}`;
            btn.textContent = option;
            btn.addEventListener("click", () => {
                app.answers[q.id] = option;
                for (const sibling of opts.children) sibling.classList.remove("picked");
                btn.classList.add("picked");
                askAgent(q, option);
            });
            opts.appendChild(btn);
        }
        block.appendChild(opts);
        body.appendChild(block);
    }
    panel.hidden = false;
}

async function askAgent(question, answer) {
    try {
        await fetch("/api/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                diagramId: app.diagramId,
                id: question.id,
                question: question.text,
                answer,
                topic: question.topic,
            }),
        });
        flash("Recorded");
    } catch {
        /* the agent may not be listening; the answer is still recorded locally */
    }
}

$("assist-close").addEventListener("click", () => { $("assist").hidden = true; });

// ---------------------------------------------------------------- persistence

async function save() {
    app.diagram.title = $("title").value || "Untitled architecture";
    app.diagram.view = { ...view };
    const res = await fetch(`/api/diagram/${encodeURIComponent(app.diagramId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diagram: app.diagram }),
    });
    if (res.ok) {
        app.dirty = false;
        const { file } = await res.json();
        $("status").textContent = `saved · ${String(file).split(/[\\/]/).pop()}`;
    } else {
        $("status").textContent = "save failed";
    }
}

const SOURCE_META_ID = "architecture-canvas-source";

function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/** Snapshot the current drawing, including live title and viewport. */
function currentDocument() {
    return {
        ...app.diagram,
        title: $("title").value || app.diagram.title || "Untitled architecture",
        view: { ...view },
    };
}

function exportJson() {
    const doc = currentDocument();
    download(
        new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: "application/json" }),
        `${app.diagramId}.arch.json`,
    );
    flash("Exported drawing as JSON");
}

async function exportSvg() {
    // Inline every icon as a data URI so the exported file stands alone.
    const scene = $("scene").cloneNode(true);
    const bounds = contentBounds();
    if (bounds) {
        const pad = 60;
        scene.setAttribute("viewBox", `${bounds.minX - pad} ${bounds.minY - pad} ${bounds.width + pad * 2} ${bounds.height + pad * 2}`);
        scene.setAttribute("width", bounds.width + pad * 2);
        scene.setAttribute("height", bounds.height + pad * 2);
    }
    scene.querySelector("#world")?.removeAttribute("transform");
    for (const junk of scene.querySelectorAll(".edge-hit, .node-hit, .group-resize")) junk.remove();

    // Icons are drawn as <image href="/api/icon/...svg">. Inlining them as a
    // nested SVG data URI works in browsers but is silently dropped by
    // PowerPoint's SVG importer, which is why exported icons vanish there.
    // Flatten each icon into real vector nodes instead, so the export is a
    // single flat SVG that PowerPoint converts into shapes.
    //
    // Ids have to be rewritten per icon: the Microsoft icons carry
    // <linearGradient id="..."> defs referenced as fill="url(#...)", and once
    // several icons share one document those ids collide and every icon picks
    // up the first icon's gradient.
    let iconSeq = 0;
    const images = [...scene.querySelectorAll("image")];
    await Promise.all(images.map(async (img) => {
        const href = img.getAttribute("href");
        if (!href) return;
        try {
            const doc = new DOMParser().parseFromString(await (await fetch(href)).text(), "image/svg+xml");
            const root = doc.documentElement;
            if (doc.querySelector("parsererror") || root.localName !== "svg") return;

            // The icon's own <title>/<desc> would otherwise win the SVG tooltip
            // over the node title we attach below.
            for (const meta of root.querySelectorAll("title, desc")) meta.remove();

            const prefix = `ic${iconSeq++}-`;
            const renamed = new Map();
            for (const node of root.querySelectorAll("[id]")) {
                const from = node.getAttribute("id");
                renamed.set(from, prefix + from);
                node.setAttribute("id", prefix + from);
            }
            if (renamed.size) {
                const repoint = (value, isRef) => {
                    let next = value;
                    for (const [from, to] of renamed) {
                        next = next
                            .split(`url(#${from})`).join(`url(#${to})`)
                            .split(`url("#${from}")`).join(`url("#${to}")`)
                            .split(`url('#${from}')`).join(`url('#${to}')`);
                        if (isRef && next === `#${from}`) next = `#${to}`;
                    }
                    return next;
                };
                for (const node of root.querySelectorAll("*")) {
                    for (const attr of [...node.attributes]) {
                        if (attr.name === "id") continue;
                        const isRef = attr.name === "href" || attr.name.endsWith(":href");
                        const next = repoint(attr.value, isRef);
                        if (next !== attr.value) node.setAttribute(attr.name, next);
                    }
                }
                for (const styleEl of root.querySelectorAll("style")) {
                    styleEl.textContent = repoint(styleEl.textContent, false);
                }
            }

            // Map the icon's viewBox onto the <image> box, matching the default
            // preserveAspectRatio of xMidYMid meet.
            const box = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
            const [vx, vy, vw, vh] = box.length === 4 && box.every(Number.isFinite)
                ? box
                : [0, 0, parseFloat(root.getAttribute("width")) || ICON, parseFloat(root.getAttribute("height")) || ICON];
            if (!(vw > 0 && vh > 0)) return;

            const tx = parseFloat(img.getAttribute("x")) || 0;
            const ty = parseFloat(img.getAttribute("y")) || 0;
            const tw = parseFloat(img.getAttribute("width")) || vw;
            const th = parseFloat(img.getAttribute("height")) || vh;
            const scale = Math.min(tw / vw, th / vh);
            const ox = tx + (tw - vw * scale) / 2;
            const oy = ty + (th - vh * scale) / 2;

            const g = document.createElementNS(SVG_NS, "g");
            g.setAttribute("transform", `translate(${ox} ${oy}) scale(${scale}) translate(${-vx} ${-vy})`);
            g.setAttribute("pointer-events", "none");
            for (const inherited of ["fill", "stroke", "opacity", "style"]) {
                if (root.hasAttribute(inherited)) g.setAttribute(inherited, root.getAttribute(inherited));
            }
            for (const child of [...root.childNodes]) g.appendChild(document.importNode(child, true));
            img.replaceWith(g);
        } catch {
            /* leave the reference as-is */
        }
    }));

    // Edge labels use paint-order:stroke on the canvas to punch a white halo
    // through the connector beneath them. PowerPoint ignores paint-order and
    // paints fill then stroke, so the white stroke covers the text. Export the
    // captions as plain filled text: one shape each, nothing to clean up after
    // "Convert to Shape".
    for (const label of [...scene.querySelectorAll("text.edge-label")]) {
        label.setAttribute("fill", "#1f2328");
        label.setAttribute("stroke", "none");
    }

    // Native SVG tooltips: <title> shows on hover in browsers, <desc> carries
    // the markdown annotation. Neither survives into PowerPoint, which is why
    // the full drawing is embedded as metadata below.
    const annotate = (selector, id, titleText, descText) => {
        const target = scene.querySelector(`${selector}[data-id="${id}"]`);
        if (!target) return;
        if (titleText) {
            const t = document.createElementNS(SVG_NS, "title");
            t.textContent = titleText;
            target.insertBefore(t, target.firstChild);
        }
        if (descText) {
            const d = document.createElementNS(SVG_NS, "desc");
            d.textContent = descText;
            target.insertBefore(d, target.firstChild);
        }
    };
    const labelOf = (id) => app.diagram.nodes.find((n) => n.id === id)?.label || "?";
    for (const n of app.diagram.nodes) {
        annotate(".node", n.id, n.sublabel ? `${n.label} — ${n.sublabel}` : n.label, n.annotation);
    }
    for (const e of app.diagram.edges) {
        const arrow = e.arrow === "backward" ? "←" : e.arrow === "both" ? "↔" : e.arrow === "none" ? "—" : "→";
        annotate(".edge", e.id, `${labelOf(e.from)} ${arrow} ${labelOf(e.to)}${e.label ? `: ${e.label}` : ""}`, e.annotation);
    }
    for (const g of app.diagram.groups) {
        annotate(".group", g.id, g.label, g.annotation);
    }

    // Embed the source so this SVG round-trips back into the editor. Set as
    // textContent so the serializer escapes < and & for us.
    const meta = document.createElementNS(SVG_NS, "metadata");
    meta.setAttribute("id", SOURCE_META_ID);
    meta.textContent = JSON.stringify(currentDocument());
    scene.insertBefore(meta, scene.firstChild);

    const titleEl = document.createElementNS(SVG_NS, "title");
    titleEl.textContent = currentDocument().title;
    scene.insertBefore(titleEl, scene.firstChild);

    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = `
        .node-box{fill:#fff;stroke:#d0d7de;stroke-width:1;rx:8}
        .node-label{font:600 12px system-ui;fill:#1f2328;text-anchor:middle}
        .node-sub{font:10px system-ui;fill:#59636e;text-anchor:middle}
        .edge-line{fill:none}
        .edge-label{font:10.5px system-ui;fill:#1f2328;text-anchor:middle}
        .group-label{font:600 11px system-ui}
    `;
    scene.insertBefore(style, scene.firstChild);

    download(
        new Blob([new XMLSerializer().serializeToString(scene)], { type: "image/svg+xml" }),
        `${app.diagramId}.svg`,
    );
    flash("Exported SVG (drawing embedded)");
}

async function exportVsdx() {
    try {
        flash("Building Visio drawing…");
        const blob = await buildVsdx(
            currentDocument(),
            (n) => `/api/icon/${encodeURIComponent(n.iconId)}.svg?v=${n.variant || 0}`,
        );
        download(blob, `${app.diagramId}.vsdx`);
        flash("Exported Visio drawing (.vsdx)");
    } catch (err) {
        flash(`Visio export failed: ${err.message}`);
    }
}

/** Recover a diagram document from a .arch.json or an SVG we exported. */
async function readDiagramFile(file) {
    const text = await file.text();
    const isSvg = /\.svg$/i.test(file.name) || text.trimStart().startsWith("<");
    if (!isSvg) return JSON.parse(text);

    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    if (doc.querySelector("parsererror")) throw new Error("that SVG could not be parsed");
    const meta =
        doc.getElementById(SOURCE_META_ID) ||
        [...doc.getElementsByTagName("metadata")].find((m) => m.textContent?.includes('"nodes"'));
    if (!meta) {
        throw new Error("this SVG has no embedded drawing — only SVGs exported from here can be imported");
    }
    return JSON.parse(meta.textContent);
}

async function importDiagram(file) {
    try {
        const parsed = await readDiagramFile(file);
        const res = await fetch("/api/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ diagram: parsed }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "import failed");

        app.diagramId = data.diagramId;
        app.diagram = data.diagram;
        $("title").value = app.diagram.title || "";
        if (app.diagram.view) Object.assign(view, app.diagram.view);
        applyView();
        render();
        fitToContent();
        app.dirty = false;

        $("status").textContent = `imported → ${data.diagramId}`;
        flash(
            data.unknownIcons?.length
                ? `Imported · ${data.unknownIcons.length} icon(s) not in this library`
                : `Imported ${app.diagram.nodes.length} components`,
        );
    } catch (error) {
        $("status").textContent = `import failed: ${error.message}`;
        flash(`Import failed: ${error.message}`);
    }
}

// ---------------------------------------------------------------- wiring

$("btn-add").addEventListener("click", () => openPicker("node"));
$("btn-connect").addEventListener("click", () => setMode(app.mode === "connect" ? "select" : "connect"));
$("btn-group").addEventListener("click", addGroup);
$("btn-tidy").addEventListener("click", () => {
    autoLayout(app.diagram, { direction: "LR" });
    markDirty();
    render();
    fitToContent();
    flash("Tidied");
});
$("btn-zoom-in").addEventListener("click", () => {
    const r = $("scene").getBoundingClientRect();
    zoomAt(1.2, r.left + r.width / 2, r.top + r.height / 2);
});
$("btn-zoom-out").addEventListener("click", () => {
    const r = $("scene").getBoundingClientRect();
    zoomAt(1 / 1.2, r.left + r.width / 2, r.top + r.height / 2);
});
$("btn-fit").addEventListener("click", fitToContent);
$("btn-save").addEventListener("click", save);
$("btn-export").addEventListener("click", exportSvg);
$("btn-export-vsdx").addEventListener("click", exportVsdx);
$("btn-export-json").addEventListener("click", exportJson);
$("btn-import").addEventListener("click", () => $("file-import").click());
$("file-import").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) await importDiagram(file);
    e.target.value = ""; // allow re-importing the same filename
});
$("title").addEventListener("input", () => { app.diagram.title = $("title").value; markDirty(); });

document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === "Escape") {
        if (!$("picker").hidden) return closePicker();
        if (app.connectFrom || app.mode === "connect") return cancelConnect();
        return select(null, null);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); return save(); }
    if (typing) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); return deleteSelection(); }
    if (e.key.toLowerCase() === "a") return openPicker("node");
    if (e.key.toLowerCase() === "c") return setMode(app.mode === "connect" ? "select" : "connect");
    if (e.key.toLowerCase() === "g") return addGroup();
    if (e.key.toLowerCase() === "t") {
        autoLayout(app.diagram, { direction: "LR" });
        markDirty();
        render();
        fitToContent();
        return flash("Tidied");
    }
    if (e.key.toLowerCase() === "f") return fitToContent();
});

// Agent-pushed updates.
const sse = new EventSource("/events");
sse.addEventListener("diagram", (event) => {
    try {
        const payload = JSON.parse(event.data);
        if (payload.diagram) {
            app.diagram = payload.diagram;
            $("title").value = app.diagram.title || "";
            render();
            flash("Updated by the agent");
        }
    } catch { /* ignore malformed frames */ }
});

// ---------------------------------------------------------------- boot

async function boot() {
    const res = await fetch("/api/bootstrap");
    const data = await res.json();

    app.diagramId = data.diagramId;
    app.diagram = data.diagram;
    app.collections = data.collections || [];
    app.iconCount = data.iconCount || 0;

    $("title").value = app.diagram.title || "";
    renderFilters();

    if (app.diagram.view) Object.assign(view, app.diagram.view);
    applyView();
    render();

    if (!app.diagram.nodes.length) {
        fitToContent();
        $("status").textContent = data.iconRoot
            ? `${data.iconCount} icons ready`
            : "icon library not found";
        flash("Press A to add your first component");
    } else {
        fitToContent();
        $("status").textContent = `${app.diagram.nodes.length} components`;
    }
}

boot();
