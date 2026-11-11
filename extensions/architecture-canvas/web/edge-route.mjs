// Edge routing — shared by the editor, the SVG export, the Visio export and
// the presentation renderer, so every surface draws the same line.
//
// Three styles:
//
//   straight     direct centre-to-centre, clipped at the node boxes
//   orthogonal   right-angle elbow ("L"/"Z"), the classic network-diagram look
//   curved       cubic bezier easing out of one side and into the other ("S")
//
// Straight is fine for small diagrams. Once a diagram has thirty edges the
// diagonals turn into a haystack: orthogonal routing reads far better because
// the eye can follow a line that only ever turns at 90 degrees.
//
// Everything here is pure and dependency-free so it can be imported by Node,
// by the browser, and inlined verbatim into the generated presentation.

export const NODE_W = 104;
export const NODE_H = 84;

export const ROUTES = ["straight", "orthogonal", "curved"];

const CLEAR = 4;      // gap between a node edge and the line start
const STUB = 26;      // straight run leaving a node before the first turn
const PORT_GAP = 15;  // spacing between connections on the same node side
const LANE_GAP = 14;  // spacing between parallel runs sharing a channel

/** Which side of `from` faces `to`: one of "l" | "r" | "t" | "b". */

// Subgraph header bars. Kept here rather than in the editor because the router
// needs to treat them as obstacles: a connector crossing a subgraph's title
// makes the title unreadable, and the title is usually the thing telling the
// reader what they are looking at.
export const HEADER_LINE = 14;
export const HEADER_PAD_X = 9;
export const HEADER_PAD_Y = 4;
export const HEADER_MIN_W = 90;

/** Rough width of the header font (600 11px system-ui), per character. */
const CHAR_W = 6.2;

/**
 * Bounding boxes of every subgraph's label bar.
 *
 * `measure` is optional: the editor has real text metrics and passes them, and
 * anything running outside a browser falls back to a per-character estimate.
 * The estimate only has to be close — it is an obstacle, not a layout.
 *
 * The bar sits above the box rather than inside it. Inside, the title occupies
 * the same space as the components, so a connector frequently has no way round
 * it and strikes through the words instead.
 */
export function labelBoxes(groups, options = {}) {
    const width = options.measure || ((text) => String(text || "").length * CHAR_W);
    const out = [];
    for (const g of groups || []) {
        if (!g || typeof g.x !== "number" || typeof g.y !== "number") continue;
        const box = Math.max(HEADER_MIN_W, g.width || 300);
        const maxText = Math.max(40, box - HEADER_PAD_X * 2);
        const text = width(g.label);
        const lines = Math.max(1, Math.ceil(text / maxText));
        const w = Math.min(Math.max(HEADER_MIN_W, Math.ceil(text / lines) + HEADER_PAD_X * 2), box);
        const h = lines * HEADER_LINE + HEADER_PAD_Y * 2;
        out.push({ x: g.x, y: g.y - h, w, h, label: true });
    }
    return out;
}

export function sideToward(from, to) {    const dx = (to.x + NODE_W / 2) - (from.x + NODE_W / 2);
    const dy = (to.y + NODE_H / 2) - (from.y + NODE_H / 2);
    // Bias toward horizontal: boxes are wider than tall, so a shallow diagonal
    // reads better leaving the side than leaving the top.
    if (Math.abs(dx) * (NODE_H / NODE_W) >= Math.abs(dy)) return dx >= 0 ? "r" : "l";
    return dy >= 0 ? "b" : "t";
}

/** Centre of the given side of a node box, pushed out by CLEAR. */
export function sidePoint(n, side) {
    const cx = n.x + NODE_W / 2;
    const cy = n.y + NODE_H / 2;
    switch (side) {
        case "l": return { x: n.x - CLEAR, y: cy, dir: "l" };
        case "r": return { x: n.x + NODE_W + CLEAR, y: cy, dir: "r" };
        case "t": return { x: cx, y: n.y - CLEAR, dir: "t" };
        default:  return { x: cx, y: n.y + NODE_H + CLEAR, dir: "b" };
    }
}

/** Straight-line anchor: clip the centre-to-centre ray at the node box. */
export function radialAnchor(from, to) {
    const a = { x: from.x + NODE_W / 2, y: from.y + NODE_H / 2 };
    const b = { x: to.x + NODE_W / 2, y: to.y + NODE_H / 2 };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (!dx && !dy) return a;
    const hw = NODE_W / 2 + CLEAR;
    const hh = NODE_H / 2 + CLEAR;
    const scale = Math.min(
        dx === 0 ? Infinity : hw / Math.abs(dx),
        dy === 0 ? Infinity : hh / Math.abs(dy),
    );
    return { x: a.x + dx * scale, y: a.y + dy * scale };
}

/**
 * Compute the points for an edge.
 *
 * @returns {{ points: {x,y}[], style: string, start: {x,y}, end: {x,y},
 *            mid: {x,y}, d: string }}
 *   `points` is the polyline (2 points for straight, 3-4 for orthogonal, the
 *   bezier hull for curved). `d` is an SVG path. `mid` is a sensible label
 *   anchor. Visio uses `points`; SVG uses `d`.
 */
export function routeEdge(from, to, style = "straight", offset = 0) {
    const kind = ROUTES.includes(style) ? style : "straight";

    if (kind === "straight") {
        const a = radialAnchor(from, to);
        const b = radialAnchor(to, from);
        const pts = offset ? [a, perpOffsetMid(a, b, offset), b] : [a, b];
        return {
            style: kind,
            points: pts,
            start: a,
            end: b,
            mid: offset ? pts[1] : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            d: offset
                ? `M ${r(a.x)} ${r(a.y)} Q ${r(pts[1].x)} ${r(pts[1].y)} ${r(b.x)} ${r(b.y)}`
                : `M ${r(a.x)} ${r(a.y)} L ${r(b.x)} ${r(b.y)}`,
        };
    }

    const sa = sideToward(from, to);
    const sb = sideToward(to, from);
    const a = sidePoint(from, sa);
    const b = sidePoint(to, sb);

    if (kind === "curved") {
        // Control points pushed straight out of each side, so the curve leaves
        // and arrives perpendicular to the box — an S-bend rather than a bow.
        const reach = Math.max(
            STUB * 2,
            Math.min(180, Math.hypot(b.x - a.x, b.y - a.y) * 0.42),
        );
        const c1 = pushOut(a, sa, reach);
        const c2 = pushOut(b, sb, reach);
        return {
            style: kind,
            points: [a, c1, c2, b],
            start: a,
            end: b,
            // Midpoint of a cubic at t = 0.5.
            mid: {
                x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
                y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
            },
            d: `M ${r(a.x)} ${r(a.y)} C ${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(b.x)} ${r(b.y)}`,
        };
    }

    // Orthogonal: stub out of each side, then meet on a shared channel.
    const pts = orthogonalPoints(a, sa, b, sb, offset);
    return {
        style: kind,
        points: pts,
        start: a,
        end: b,
        mid: polylineMid(pts),
        d: `M ${pts.map((p) => `${r(p.x)} ${r(p.y)}`).join(" L ")}`,
    };
}

function r(v) {
    return Math.round(v * 100) / 100;
}

function pushOut(p, side, by) {
    switch (side) {
        case "l": return { x: p.x - by, y: p.y };
        case "r": return { x: p.x + by, y: p.y };
        case "t": return { x: p.x, y: p.y - by };
        default:  return { x: p.x, y: p.y + by };
    }
}

const horizontal = (side) => side === "l" || side === "r";

/**
 * Right-angle route between two side points.
 *
 * `offset` shifts the shared channel, which is how parallel edges between the
 * same pair of nodes avoid drawing on top of each other.
 */
function orthogonalPoints(a, sa, b, sb, offset = 0) {
    const s = pushOut(a, sa, STUB);
    const t = pushOut(b, sb, STUB);

    if (horizontal(sa) && horizontal(sb)) {
        const mx = (s.x + t.x) / 2 + offset;
        return dedupe([a, s, { x: mx, y: s.y }, { x: mx, y: t.y }, t, b]);
    }
    if (!horizontal(sa) && !horizontal(sb)) {
        const my = (s.y + t.y) / 2 + offset;
        return dedupe([a, s, { x: s.x, y: my }, { x: t.x, y: my }, t, b]);
    }
    // Mixed: one horizontal, one vertical — a single corner does it.
    if (horizontal(sa)) return dedupe([a, s, { x: t.x, y: s.y }, t, b]);
    return dedupe([a, s, { x: s.x, y: t.y }, t, b]);
}

// ------------------------------------------------------------ path search

const GRID_GAP = 10;    // clearance of a routing lane from a box it passes
const BEND_COST = 140;  // a turn is worth this many pixels of detour
const LANE_COST = 1600; // sharing a lane with an existing line costs this much
const MAX_OBSTACLES = 70; // beyond this, only the nearest boxes are considered
const REGION = 1200;    // how far outside the two ends the search may look

// How much straight run a line gets leaving a node before it may turn. An
// arrowhead landing directly on a corner reads as a kink rather than an
// arrival, so the approach is kept generous and only shortened when a
// neighbouring box leaves no room for it.
const APPROACHES = [30, 22, 16, 10];

// Corners a connector may use before it stops being followable. The search may
// exceed this to dodge another line, but is asked to reconsider first.
const MAX_BENDS = 4;

/**
 * Route around the boxes, with as many bends as it takes.
 *
 * The channel router this replaces had exactly one degree of freedom — where
 * to put the single channel between the two stubs — so it could only ever draw
 * an L or a Z. When no single channel was clear it had no choice but to run the
 * line through a box, which is why 31 connectors still did.
 *
 * This searches instead. Lanes are laid just outside every box (the classic
 * trick: a shortest orthogonal path avoiding rectangles only ever needs to turn
 * on lines derived from their edges, so a handful of coordinates is enough —
 * no dense pixel grid), and A* finds the cheapest way through. Cost is length
 * plus a penalty per turn, so routes stay simple, plus a penalty for lying on
 * top of a line already drawn, so parallel runs separate themselves.
 */
function gridRoute(pa, sa, pb, sb, allObstacles, lanes, bendCost = BEND_COST) {
    // Only the boxes near the two ends can shape the route, and the grid grows
    // with the square of the boxes considered. Confining it to the region the
    // line could plausibly use, and then keeping only the nearest few, is what
    // keeps a large diagram routable: the alternative — giving up and falling
    // back whenever there are too many boxes — is what left 135 connectors
    // through boxes on a 100-component drawing.
    const reach = pushOut(pa, sa, APPROACHES[0]);
    const far = pushOut(pb, sb, APPROACHES[0]);
    const lox = Math.min(reach.x, far.x) - REGION;
    const hix = Math.max(reach.x, far.x) + REGION;
    const loy = Math.min(reach.y, far.y) - REGION;
    const hiy = Math.max(reach.y, far.y) + REGION;
    let obstacles = allObstacles.filter(
        (o) => o.x + o.w > lox && o.x < hix && o.y + o.h > loy && o.y < hiy,
    );
    if (obstacles.length > MAX_OBSTACLES) {
        const mx = (reach.x + far.x) / 2;
        const my = (reach.y + far.y) / 2;
        const near = (o) => Math.abs(o.x + o.w / 2 - mx) + Math.abs(o.y + o.h / 2 - my);
        obstacles = obstacles.sort((p, q) => near(p) - near(q)).slice(0, MAX_OBSTACLES);
    }

    // Take the longest approach that actually fits at both ends.
    let s = null;
    let t = null;
    for (const gap of APPROACHES) {
        const cs = pushOut(pa, sa, gap);
        const ct = pushOut(pb, sb, gap);
        if (!pointInside(cs, obstacles) && !pointInside(ct, obstacles) &&
            clear(pa.x, pa.y, cs.x, cs.y, obstacles) &&
            clear(pb.x, pb.y, ct.x, ct.y, obstacles)) {
            s = cs;
            t = ct;
            break;
        }
    }
    if (!s || !t) return null;

    const xs = new Set([s.x, t.x]);
    const ys = new Set([s.y, t.y]);
    for (const o of obstacles) {
        xs.add(o.x - GRID_GAP);
        xs.add(o.x + o.w + GRID_GAP);
        ys.add(o.y - GRID_GAP);
        ys.add(o.y + o.h + GRID_GAP);
    }
    const X = [...xs].sort((p, q) => p - q);
    const Y = [...ys].sort((p, q) => p - q);
    const nx = X.length;
    const ny = Y.length;
    const si = X.indexOf(s.x);
    const sj = Y.indexOf(s.y);
    const ti = X.indexOf(t.x);
    const tj = Y.indexOf(t.y);

    // Which unit moves are legal. Precomputed, because A* asks repeatedly.
    const hOpen = new Uint8Array(nx * ny); // (i,j) -> (i+1,j)
    const vOpen = new Uint8Array(nx * ny); // (i,j) -> (i,j+1)
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
            if (i + 1 < nx) {
                hOpen[i * ny + j] = clear(X[i], Y[j], X[i + 1], Y[j], obstacles) ? 1 : 0;
            }
            if (j + 1 < ny) {
                vOpen[i * ny + j] = clear(X[i], Y[j], X[i], Y[j + 1], obstacles) ? 1 : 0;
            }
        }
    }

    // State is a cell plus the direction of arrival, so turns can be charged.
    const DIRS = 3; // 0 = start, 1 = horizontal, 2 = vertical
    const size = nx * ny * DIRS;
    const g = new Float64Array(size).fill(Infinity);
    const from = new Int32Array(size).fill(-1);
    const heap = new MinHeap();

    const startDir = horizontal(sa) ? 1 : 2;
    const startState = (si * ny + sj) * DIRS + startDir;
    g[startState] = 0;
    heap.push(startState, Math.abs(t.x - s.x) + Math.abs(t.y - s.y));

    let goal = -1;
    while (heap.size) {
        const state = heap.pop();
        const dir = state % DIRS;
        const cell = (state - dir) / DIRS;
        const j = cell % ny;
        const i = (cell - j) / ny;
        if (i === ti && j === tj) { goal = state; break; }
        const base = g[state];

        for (const [di, dj] of STEPS) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || ni >= nx || nj < 0 || nj >= ny) continue;
            const open = di !== 0
                ? hOpen[Math.min(i, ni) * ny + j]
                : vOpen[i * ny + Math.min(j, nj)];
            if (!open) continue;

            const nd = di !== 0 ? 1 : 2;
            const x1 = X[i], y1 = Y[j], x2 = X[ni], y2 = Y[nj];
            const step = Math.abs(x2 - x1) + Math.abs(y2 - y1)
                + (nd === dir ? 0 : bendCost)
                + (onTakenLane(x1, y1, x2, y2, lanes) ? LANE_COST : 0);

            const next = (ni * ny + nj) * DIRS + nd;
            const cost = base + step;
            if (cost < g[next] - 0.01) {
                g[next] = cost;
                from[next] = state;
                heap.push(next, cost + Math.abs(t.x - X[ni]) + Math.abs(t.y - Y[nj]));
            }
        }
    }
    if (goal < 0) return null;

    const path = [];
    for (let state = goal; state >= 0; state = from[state]) {
        const dir = state % DIRS;
        const cell = (state - dir) / DIRS;
        const j = cell % ny;
        const i = (cell - j) / ny;
        path.push({ x: X[i], y: Y[j] });
    }
    path.reverse();
    return dedupe([pa, ...path, pb]);
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Is this axis-aligned segment free of every obstacle? */
function clear(x1, y1, x2, y2, obstacles) {
    const lox = Math.min(x1, x2);
    const hix = Math.max(x1, x2);
    const loy = Math.min(y1, y2);
    const hiy = Math.max(y1, y2);
    for (const o of obstacles) {
        if (lox < o.x + o.w - 0.5 && hix > o.x + 0.5 &&
            loy < o.y + o.h - 0.5 && hiy > o.y + 0.5) return false;
    }
    return true;
}

function pointInside(p, obstacles) {
    for (const o of obstacles) {
        if (p.x > o.x + 0.5 && p.x < o.x + o.w - 0.5 &&
            p.y > o.y + 0.5 && p.y < o.y + o.h - 0.5) return true;
    }
    return false;
}

/** Index the lines drawn so far, so the search can be charged for reusing one. */
function laneIndex(runs) {
    const h = new Map();
    const v = new Map();
    for (const r of runs) {
        const key = Math.round(r.fixed / LANE_GAP);
        const into = r.vertical ? v : h;
        for (const k of [key - 1, key, key + 1]) {
            if (!into.has(k)) into.set(k, []);
            into.get(k).push(r);
        }
    }
    return { h, v };
}

function onTakenLane(x1, y1, x2, y2, lanes) {
    if (!lanes) return false;
    const vertical = Math.abs(x1 - x2) < 0.5;
    const fixed = vertical ? x1 : y1;
    const bucket = (vertical ? lanes.v : lanes.h).get(Math.round(fixed / LANE_GAP));
    if (!bucket) return false;
    const lo = vertical ? Math.min(y1, y2) : Math.min(x1, x2);
    const hi = vertical ? Math.max(y1, y2) : Math.max(x1, x2);
    for (const r of bucket) {
        if (Math.abs(r.fixed - fixed) >= LANE_GAP - 2) continue;
        if (Math.min(r.hi, hi) - Math.max(r.lo, lo) > 6) return true;
    }
    return false;
}

/** Binary heap keyed on priority; the search pops tens of thousands of times. */
class MinHeap {
    constructor() {
        this.items = [];
        this.keys = [];
    }
    get size() {
        return this.items.length;
    }
    push(item, key) {
        this.items.push(item);
        this.keys.push(key);
        let i = this.items.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.keys[parent] <= this.keys[i]) break;
            this.swap(i, parent);
            i = parent;
        }
    }
    pop() {
        const top = this.items[0];
        const item = this.items.pop();
        const key = this.keys.pop();
        if (this.items.length) {
            this.items[0] = item;
            this.keys[0] = key;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let small = i;
                if (l < this.items.length && this.keys[l] < this.keys[small]) small = l;
                if (r < this.items.length && this.keys[r] < this.keys[small]) small = r;
                if (small === i) break;
                this.swap(i, small);
                i = small;
            }
        }
        return top;
    }
    swap(a, b) {
        [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
        [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    }
}

// --------------------------------------------------- obstacle-aware channels

const MARGIN = 7;   // clearance kept between a line and a box it passes
const DETOUR = 140; // how far outside the span a line may swing to get around

/**
 * Right-angle route that steers around node boxes and away from other lines.
 *
 * Every orthogonal route reduces to a single decision: where to put the one
 * channel that carries the line between its two stubs. Placing it at the
 * midpoint — which is all the geometry alone can suggest — is what drives a
 * line straight through whatever happens to sit in between.
 *
 * So instead of one position, generate the plausible ones (the natural
 * midpoint, plus the clear lanes either side of every box) and score them.
 *
 * Crucially the score counts the lines already routed as well as the boxes.
 * Avoiding obstacles alone is actively harmful: every edge independently
 * discovers the same clear lane beside the same box and they all pile into it,
 * trading one line through a box for several lines drawn on top of each other.
 * Routing in sequence, and letting each edge see its predecessors, is what
 * keeps the two goals from working against each other.
 *
 * The channel runs vertically when the line leaves its source sideways and
 * horizontally when it leaves top or bottom, which covers L-shapes and
 * S-shapes alike: an L is just the case where the best channel happens to line
 * up with the far stub.
 */
function orthogonalAvoiding(a, sa, b, sb, obstacles, taken = []) {
    const s = pushOut(a, sa, STUB);
    const t = pushOut(b, sb, STUB);
    const vertical = horizontal(sa); // a vertical channel carries a sideways exit

    const build = vertical
        ? (c) => dedupe([a, s, { x: c, y: s.y }, { x: c, y: t.y }, t, b])
        : (c) => dedupe([a, s, { x: s.x, y: c }, { x: t.x, y: c }, t, b]);

    // The natural channel: halfway for a straight-through run, or level with
    // the far stub when only one turn is needed.
    const lo = vertical ? Math.min(s.x, t.x) : Math.min(s.y, t.y);
    const hi = vertical ? Math.max(s.x, t.x) : Math.max(s.y, t.y);
    const natural = horizontal(sa) === horizontal(sb) ? (lo + hi) / 2 : (vertical ? t.x : t.y);

    if (!obstacles.length && !taken.length) return build(natural);

    const candidates = [natural];
    for (const o of obstacles) {
        if (vertical) candidates.push(o.x - MARGIN, o.x + o.w + MARGIN);
        else candidates.push(o.y - MARGIN, o.y + o.h + MARGIN);
    }
    for (const seg of taken) {
        if (seg.vertical !== vertical) continue;
        candidates.push(seg.fixed - LANE_GAP, seg.fixed + LANE_GAP);
    }

    // Try the most direct options first and stop as soon as one is clean, so a
    // big diagram does not pay for candidates it will never choose.
    const inReach = candidates
        .filter((c) => c >= lo - DETOUR && c <= hi + DETOUR)
        .sort((p, q) => Math.abs(p - natural) - Math.abs(q - natural))
        .slice(0, 32);

    let best = null;
    let bestCost = Infinity;
    const span = Math.max(1, hi - lo);
    for (const c of inReach) {
        const pts = build(c);
        // A line through a box is the worst; sharing a lane with another line
        // is next; going the long way round is merely inelegant.
        const cost = crossCount(pts, obstacles) * 100
            + laneClashes(pts, taken) * 20
            + (Math.abs(c - natural) / span) * 3;
        if (cost < bestCost) {
            bestCost = cost;
            best = pts;
            if (cost < 1) break;
        }
    }
    return best || build(natural);
}

/** Axis-aligned runs of a polyline, for lane bookkeeping. */
function axisRuns(points) {
    const runs = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p = points[i];
        const q = points[i + 1];
        const isV = Math.abs(p.x - q.x) < 0.5;
        const isH = Math.abs(p.y - q.y) < 0.5;
        if (!isV && !isH) continue;
        if (Math.hypot(q.x - p.x, q.y - p.y) < 1) continue;
        runs.push({
            vertical: isV,
            fixed: isV ? p.x : p.y,
            lo: isV ? Math.min(p.y, q.y) : Math.min(p.x, q.x),
            hi: isV ? Math.max(p.y, q.y) : Math.max(p.x, q.x),
        });
    }
    return runs;
}

/** How many already-routed runs this polyline would sit on top of. */
function laneClashes(points, taken) {
    if (!taken.length) return 0;
    let n = 0;
    for (const run of axisRuns(points)) {
        for (const seg of taken) {
            if (seg.vertical !== run.vertical) continue;
            if (Math.abs(seg.fixed - run.fixed) >= LANE_GAP - 2) continue;
            if (Math.min(seg.hi, run.hi) - Math.max(seg.lo, run.lo) > 8) n++;
        }
    }
    return n;
}

/** How many boxes a polyline passes through. */
function crossCount(points, obstacles) {
    let n = 0;
    for (const o of obstacles) {
        for (let i = 0; i < points.length - 1; i++) {
            if (segmentHitsBox(points[i], points[i + 1], o)) { n++; break; }
        }
    }
    return n;
}

/** Axis-aligned segment against a box, with a margin so grazing does not count. */
function segmentHitsBox(p, q, o) {
    const x1 = o.x - MARGIN;
    const y1 = o.y - MARGIN;
    const x2 = o.x + o.w + MARGIN;
    const y2 = o.y + o.h + MARGIN;
    const sx = Math.min(p.x, q.x);
    const ex = Math.max(p.x, q.x);
    const sy = Math.min(p.y, q.y);
    const ey = Math.max(p.y, q.y);
    return sx < x2 && ex > x1 && sy < y2 && ey > y1;
}

/** Drop points that repeat or sit on a straight run between their neighbours. */
function dedupe(points) {
    const out = [];
    for (const p of points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
        out.push(p);
    }
    for (let i = out.length - 2; i > 0; i--) {
        const prev = out[i - 1];
        const cur = out[i];
        const next = out[i + 1];
        const collinearX = Math.abs(prev.x - cur.x) < 0.5 && Math.abs(cur.x - next.x) < 0.5;
        const collinearY = Math.abs(prev.y - cur.y) < 0.5 && Math.abs(cur.y - next.y) < 0.5;
        if (collinearX || collinearY) out.splice(i, 1);
    }
    return out;
}

function perpOffsetMid(a, b, offset) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: mx + (-dy / len) * offset, y: my + (dx / len) * offset };
}

/** Point at half the total length of a polyline — a stable label anchor. */
export function polylineMid(points) {
    if (points.length < 2) return points[0] || { x: 0, y: 0 };
    let total = 0;
    const seg = [];
    for (let i = 1; i < points.length; i++) {
        const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        seg.push(l);
        total += l;
    }
    let want = total / 2;
    for (let i = 0; i < seg.length; i++) {
        if (want <= seg[i] || i === seg.length - 1) {
            const t = seg[i] ? want / seg[i] : 0;
            return {
                x: points[i].x + (points[i + 1].x - points[i].x) * t,
                y: points[i].y + (points[i + 1].y - points[i].y) * t,
            };
        }
        want -= seg[i];
    }
    return points[0];
}

/**
 * Spread parallel edges so they do not overlap.
 *
 * Edges sharing an endpoint pair are fanned apart by index; the returned map is
 * keyed by edge id and holds the offset to pass to routeEdge.
 */
export function parallelOffsets(edges, spacing = 18) {
    const groups = new Map();
    for (const e of edges) {
        const key = [e.from, e.to].sort().join("|");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
    }
    const offsets = new Map();
    for (const list of groups.values()) {
        if (list.length === 1) {
            offsets.set(list[0].id, 0);
            continue;
        }
        const mid = (list.length - 1) / 2;
        list.forEach((e, i) => offsets.set(e.id, Math.round((i - mid) * spacing)));
    }
    return offsets;
}

// ------------------------------------------------------------------ routeAll

/**
 * Route every edge in a diagram, keeping connectors apart.
 *
 * Routing one edge at a time is not enough: two edges can each be perfectly
 * orthogonal and still be drawn exactly on top of each other, because nothing
 * told either about the other. Separation is inherently a whole-diagram
 * problem, so it happens here in two passes:
 *
 *   1. **Ports** — edges arriving at the same side of the same node are spread
 *      along that side instead of all meeting at its midpoint. They are ordered
 *      by where the far end sits, so the fan does not cross itself.
 *   2. **Channels** — interior segments that share a line and overlap are
 *      assigned lanes and nudged apart. Only interior segments move, so the
 *      ends stay glued to their ports.
 *
 * `fast` skips the path search and uses the cheaper channel router. The layout
 * refinement scores hundreds of candidate arrangements and only needs a proxy
 * for how tangled each one is; running the full search for every candidate made
 * a tidy of sixty components take forty-five seconds.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {{ fast?: boolean }} [options]
 * @returns {Map<string, object>} edge id -> route (same shape as routeEdge)
 */
export function routeAll(nodes, edges, options = {}) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const live = (edges || []).filter((e) => byId.has(e.from) && byId.has(e.to));

    const pairOffsets = parallelOffsets(live);
    const routes = new Map();

    // Node footprints, so orthogonal routes can steer around them.
    const boxes = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: NODE_W, h: NODE_H }));

    // Subgraph titles are obstacles too, so a connector does not strike through
    // the words that say what the subgraph is.
    const withLabels = options.labels?.length ? [...boxes, ...options.labels] : boxes;

    // Lanes already occupied. Each orthogonal edge is routed against the ones
    // before it, so they spread out instead of converging on the same gap.
    const taken = [];

    // --- pass 1: ports ---------------------------------------------------
    // Collect every attachment as (node, side), then spread each bundle.
    const bundles = new Map(); // `${nodeId}|${side}` -> [{ edge, end, other }]
    const ends = new Map();    // edgeId -> { fromSide, toSide }

    for (const e of live) {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        const style = ROUTES.includes(e.route) ? e.route : "straight";
        if (style === "straight") continue; // straight uses radial anchors
        const sa = sideToward(a, b);
        const sb = sideToward(b, a);
        ends.set(e.id, { fromSide: sa, toSide: sb });
        const ka = `${e.from}|${sa}`;
        const kb = `${e.to}|${sb}`;
        if (!bundles.has(ka)) bundles.set(ka, []);
        if (!bundles.has(kb)) bundles.set(kb, []);
        bundles.get(ka).push({ id: e.id, end: "from", node: a, other: b, side: sa });
        bundles.get(kb).push({ id: e.id, end: "to", node: b, other: a, side: sb });
    }

    const ports = new Map(); // `${edgeId}|${end}` -> {x,y}
    for (const list of bundles.values()) {
        const { node, side } = list[0];
        const vertical = side === "l" || side === "r";
        // Order by where the far end lies, so the bundle fans without crossing.
        list.sort((p, q) => (vertical
            ? (p.other.y + NODE_H / 2) - (q.other.y + NODE_H / 2)
            : (p.other.x + NODE_W / 2) - (q.other.x + NODE_W / 2)));

        const span = vertical ? NODE_H : NODE_W;
        const usable = Math.max(0, span - 20);
        const step = list.length > 1
            ? Math.min(PORT_GAP, usable / (list.length - 1))
            : 0;
        const mid = (list.length - 1) / 2;

        list.forEach((p, i) => {
            const base = sidePoint(node, side);
            const shift = (i - mid) * step;
            ports.set(`${p.id}|${p.end}`, vertical
                ? { x: base.x, y: base.y + shift }
                : { x: base.x + shift, y: base.y });
        });
    }

    // --- build routes ----------------------------------------------------
    for (const e of live) {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        const style = ROUTES.includes(e.route) ? e.route : "straight";

        if (style === "straight") {
            routes.set(e.id, routeEdge(a, b, style, pairOffsets.get(e.id) || 0));
            continue;
        }

        const { fromSide, toSide } = ends.get(e.id);
        const pa = ports.get(`${e.id}|from`) || sidePoint(a, fromSide);
        const pb = ports.get(`${e.id}|to`) || sidePoint(b, toSide);

        if (style === "curved") {
            const reach = Math.max(
                STUB * 2,
                Math.min(180, Math.hypot(pb.x - pa.x, pb.y - pa.y) * 0.42),
            );
            const c1 = pushOut(pa, fromSide, reach);
            const c2 = pushOut(pb, toSide, reach);
            routes.set(e.id, {
                style,
                points: [pa, c1, c2, pb],
                start: pa,
                end: pb,
                mid: {
                    x: (pa.x + 3 * c1.x + 3 * c2.x + pb.x) / 8,
                    y: (pa.y + 3 * c1.y + 3 * c2.y + pb.y) / 8,
                },
                d: `M ${r(pa.x)} ${r(pa.y)} C ${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(pb.x)} ${r(pb.y)}`,
            });
            continue;
        }

        const others = boxes.filter((o) => o.id !== e.from && o.id !== e.to);
        const lanes = options.fast ? null : laneIndex(taken);
        // The search must treat the two endpoint boxes as obstacles too. The
        // ports sit just outside them, so this costs nothing at the ends — but
        // without it a line is free to cut straight across the very node it is
        // connecting to in order to reach a port on the far side, which is
        // exactly what eight connectors were doing.
        let pts = options.fast ? null : gridRoute(pa, fromSide, pb, toSide, withLabels, lanes);

        // Subgraph titles are a soft obstacle: worth a detour, but never worth
        // failing to route over. If avoiding one leaves no way through, drop
        // them and route around the components alone.
        if (!pts && !options.fast) {
            pts = gridRoute(pa, fromSide, pb, toSide, boxes, lanes);
        }

        // A connector with more corners than this is hard to follow. The search
        // will happily spend them to dodge another line, which is usually the
        // right trade — but ask once more with turns priced much higher, and
        // take the calmer route when it is no worse.
        if (pts && pts.length - 2 > MAX_BENDS) {
            const calmer = gridRoute(pa, fromSide, pb, toSide, withLabels, lanes, BEND_COST * 8);
            if (calmer && calmer.length < pts.length
                && laneClashes(calmer, taken) <= laneClashes(pts, taken)) {
                pts = calmer;
            }
        }
        pts = pts || orthogonalAvoiding(pa, fromSide, pb, toSide, others, taken);
        taken.push(...axisRuns(pts));
        routes.set(e.id, {
            style,
            points: pts,
            start: pa,
            end: pb,
            mid: polylineMid(pts),
            d: `M ${pts.map((p) => `${r(p.x)} ${r(p.y)}`).join(" L ")}`,
        });
    }

    separateChannels(routes, () => boxes);
    return routes;
}

/**
 * Nudge apart segments that share a line and overlap.
 *
 * Interior segments simply move: their neighbours are perpendicular, so they
 * stretch to follow. A segment attached to a port cannot move outright without
 * detaching the line, so it gets a short jog beside the port instead — which is
 * what Visio does in the same situation.
 *
 * Every move is then checked against the boxes and undone if it made things
 * worse. Separating two lines is not worth pushing one of them behind a
 * component: on a dense diagram this pass alone was putting 55 connectors
 * through boxes that the path search had carefully routed around.
 */
function separateChannels(routes, obstaclesFor) {
    // One pass only. Each shifted line can land on another, and chasing that is
    // counter-productive: a second pass measurably increases the number of
    // lines sharing a lane rather than reducing it.
    const before = new Map();
    for (const [id, route] of routes) {
        if (route.style === "orthogonal") before.set(id, route.points.map((p) => ({ ...p })));
    }

    separatePass(routes);

    for (const [id, route] of routes) {
        if (route.style !== "orthogonal") continue;
        const original = before.get(id);
        if (original && obstaclesFor) {
            const obstacles = obstaclesFor(id);
            if (crossCount(route.points, obstacles) > crossCount(original, obstacles)) {
                route.points = original;
            }
        }
        route.points = dedupe(route.points);
        route.mid = polylineMid(route.points);
        route.d = `M ${route.points.map((p) => `${r(p.x)} ${r(p.y)}`).join(" L ")}`;
    }
}

/** One deconfliction sweep. */
function separatePass(routes) {
    const segments = [];
    for (const [id, route] of routes) {
        if (route.style !== "orthogonal") continue;
        const p = route.points;
        if (p.length < 2) continue;
        for (let i = 0; i < p.length - 1; i++) {
            const a = p[i];
            const b = p[i + 1];
            const vertical = Math.abs(a.x - b.x) < 0.5;
            const horizontal = Math.abs(a.y - b.y) < 0.5;
            if (!vertical && !horizontal) continue;
            segments.push({
                id,
                i,
                vertical,
                fixed: vertical ? a.x : a.y,
                lo: vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
                hi: vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x),
            });
        }
    }
    if (segments.length < 2) return;

    // Only disturb lines that genuinely disappear into one another. Every move
    // here inserts a jog, and moving a line because it shares a few pixels with
    // a neighbour buys nothing. Measured across the repo's diagrams, acting on
    // every touch adds ~180 segments of extra zig-zag for no fewer overlaps;
    // acting only on substantial runs keeps the geometry calm and still brings
    // the worst overlap down from 556px to 72px.
    const MIN_RUN = 20;
    const clashing = new Set();
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            const p = segments[i];
            const q = segments[j];
            if (p.id === q.id || p.vertical !== q.vertical) continue;
            if (Math.abs(p.fixed - q.fixed) >= LANE_GAP * 0.75) continue;
            if (Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo) <= MIN_RUN) continue;
            clashing.add(p);
            clashing.add(q);
        }
    }
    if (clashing.size < 2) return;

    // Group by axis and shared line, then split each group into clusters that
    // actually overlap — two runs on the same x that never share a y range are
    // not on top of each other and must not be moved apart.
    //
    // Group by proximity rather than by rounding to a grid: two runs a fraction
    // of a pixel apart can straddle a bucket boundary and never be compared,
    // which is exactly the case that looks like a single line on screen.
    // Chain from the previous member, not the group's first, so a run of
    // near-neighbours stays one group instead of splitting at an arbitrary
    // point and leaving two of them still on top of each other.
    const NEAR = LANE_GAP * 0.75;
    const groups = [];
    for (const axis of [true, false]) {
        const list = segments
            .filter((s) => s.vertical === axis && clashing.has(s))
            .sort((a, b) => a.fixed - b.fixed);
        let group = [];
        for (const s of list) {
            if (group.length && s.fixed - group[group.length - 1].fixed >= NEAR) {
                groups.push(group);
                group = [];
            }
            group.push(s);
        }
        if (group.length) groups.push(group);
    }

    const shifts = [];
    for (const list of groups) {
        if (list.length < 2) continue;
        list.sort((a, b) => a.lo - b.lo);

        let cluster = [list[0]];
        let reach = list[0].hi;
        const flush = () => {
            if (cluster.length > 1) {
                // Place lanes at absolute positions around the cluster's mean,
                // so the gap is exactly LANE_GAP however close they started.
                const base = cluster.reduce((sum, s) => sum + s.fixed, 0) / cluster.length;
                const mid = (cluster.length - 1) / 2;
                cluster.forEach((s, idx) => {
                    const shift = base + (idx - mid) * LANE_GAP - s.fixed;
                    if (Math.abs(shift) > 0.5) shifts.push({ ...s, shift, lane: idx });
                });
            }
            cluster = [];
        };
        for (let i = 1; i < list.length; i++) {
            if (list[i].lo <= reach) {
                cluster.push(list[i]);
                reach = Math.max(reach, list[i].hi);
            } else {
                flush();
                cluster = [list[i]];
                reach = list[i].hi;
            }
        }
        flush();
    }

    // Apply per edge, highest segment index first: a jog inserts points and
    // would otherwise invalidate the indices still waiting to be applied.
    const perEdge = new Map();
    for (const s of shifts) {
        if (!perEdge.has(s.id)) perEdge.set(s.id, []);
        perEdge.get(s.id).push(s);
    }
    for (const [id, list] of perEdge) {
        list.sort((a, b) => b.i - a.i);
        for (const s of list) shiftSegment(routes.get(id), s.i, s.shift, s.vertical, s.lane);
    }
}

/** Move one segment sideways, jogging around a port when the end is pinned. */
function shiftSegment(route, i, shift, vertical, lane = 0) {
    const p = route.points;
    const last = p.length - 2;
    const move = (pt) => (vertical ? { x: pt.x + shift, y: pt.y } : { x: pt.x, y: pt.y + shift });

    if (i > 0 && i < last) {
        p[i] = move(p[i]);
        p[i + 1] = move(p[i + 1]);
        return;
    }

    // The jog is the run kept straight out of the port before turning aside.
    // It is staggered by lane, because otherwise every line in a bundle turns
    // at the same distance from the node and the risers stack up instead.
    const run = vertical
        ? Math.abs(p[i + 1].y - p[i].y)
        : Math.abs(p[i + 1].x - p[i].x);
    const JOG = Math.max(4, Math.min(10 + lane * 7, run * 0.4));
    const step = (from, to) => {
        const dir = vertical ? Math.sign(to.y - from.y) || 1 : Math.sign(to.x - from.x) || 1;
        return vertical
            ? { x: from.x, y: from.y + dir * JOG }
            : { x: from.x + dir * JOG, y: from.y };
    };

    if (i === 0 && i === last) {
        // A single run between two ports: jog beside both of them.
        if (run < 3 * JOG) return;
        const ca = step(p[0], p[1]);
        const cb = step(p[1], p[0]);
        p.splice(1, 0, ca, move(ca), move(cb), cb);
        return;
    }

    if (i === 0) {
        const corner = step(p[0], p[1]);
        p.splice(1, 0, corner, move(corner));
        p[3] = move(p[3]);
    } else {
        const n = p.length;
        const corner = step(p[n - 1], p[n - 2]);
        p.splice(n - 1, 0, move(corner), corner);
        p[p.length - 4] = move(p[p.length - 4]);
    }
}
