// Hierarchical layered auto-layout.
//
// Pure, dependency-free, and shared by both the extension (Node) and the
// editor (browser) so agent-built and hand-built diagrams tidy identically.
//
// Approach (Sugiyama-style, cluster aware):
//   1. Recurse into subgraphs innermost-first, so a nested subgraph is measured
//      as a single block before its parent places it.
//   2. Within a container, rank items by longest path along edges. Edges
//      between different subgraphs are projected onto the containing blocks.
//   3. Order each layer by barycentre to cut crossings.
//   4. Assign coordinates, then translate each subgraph's contents into place.
//
// Because subgraph boxes are derived from member positions, giving each
// subgraph a disjoint region is what stops the boxes overlapping.

import { routeAll, labelBoxes } from "./edge-route.mjs";

export const NODE_W = 104;
export const NODE_H = 84;

const H_GAP = 96; // between layers (LR) / within a layer (TB)
const V_GAP = 60; // within a layer (LR) / between layers (TB)
const PAD = 34; // subgraph padding
const HEADER = 30; // subgraph header bar allowance

// A long edge is threaded through placeholder items in the layers it crosses.
// They are narrow — they only need to reserve a lane, not look like anything.
const DUMMY_W = 8;
const DUMMY_H = 10;
const DUMMY_GAP = 20; // tighter spacing either side of a reserved lane
const BAND_GAP = 90;  // between wrapped rows of layers
const TARGET_RATIO = 1.3; // preferred width : height of a laid-out block

export function autoLayout(diagram, options = {}) {
    const dir = options.direction === "TB" ? "TB" : "LR";
    if (!diagram?.nodes?.length) return diagram;
    const nodesById = new Map(diagram.nodes.map((n) => [n.id, n]));
    const groupsById = new Map((diagram.groups || []).map((g) => [g.id, g]));

    // Which container and layer each item landed in. The refinement pass uses
    // this to only ever exchange peers, so reordering never reverses the flow
    // the ranking just worked out.
    const slot = new Map();

    const childNodes = (cid) => diagram.nodes.filter((n) => (n.group || null) === cid);
    const childGroups = (cid) => (diagram.groups || []).filter((g) => (g.parent || null) === cid);

    /** Project a node onto the direct child of `cid` that contains it. */
    function project(nodeId, cid) {
        const n = nodesById.get(nodeId);
        if (!n) return null;
        if ((n.group || null) === cid) return `node:${nodeId}`;
        let cursor = n.group ? groupsById.get(n.group) : null;
        let guard = 0;
        while (cursor && guard++ < 64) {
            if ((cursor.parent || null) === cid) return `group:${cursor.id}`;
            cursor = cursor.parent ? groupsById.get(cursor.parent) : null;
        }
        return null;
    }

    function layout(cid) {
        const nodes = childNodes(cid);
        const groups = childGroups(cid);

        // Measure nested subgraphs first.
        const sub = new Map();
        for (const g of groups) sub.set(g.id, layout(g.id));

        const items = [
            ...nodes.map((n) => ({ key: `node:${n.id}`, kind: "node", id: n.id, w: NODE_W, h: NODE_H })),
            ...groups.map((g) => ({
                key: `group:${g.id}`,
                kind: "group",
                id: g.id,
                w: sub.get(g.id).width,
                h: sub.get(g.id).height,
            })),
        ];

        if (!items.length) {
            return { width: 260, height: 160, apply: () => {} };
        }

        const byKey = new Map(items.map((i) => [i.key, i]));
        const out = new Map();

        for (const e of diagram.edges || []) {
            const a = project(e.from, cid);
            const b = project(e.to, cid);
            if (!a || !b || a === b) continue;
            if (!byKey.has(a) || !byKey.has(b)) continue;
            if (!out.has(a)) out.set(a, new Set());
            if (out.get(a).has(b)) continue;
            out.get(a).add(b);
        }

        // Break cycles before ranking.
        //
        // Ranking only means anything on a DAG, and architecture diagrams are
        // full of feedback: monitoring reads everything, policy feeds back into
        // the gateway, hubs peer with each other. The old code ranked what it
        // could and gave everything caught in a cycle rank 0. On the vWAN
        // topology that was all four subgraphs, and on the landing zone six of
        // seven — so a tidy stacked the entire drawing into one column and then
        // ran every connector up and down it. That single fallback was doing
        // more damage than any amount of routing could repair.
        //
        // Classify edges with a depth-first search and set the back edges aside
        // for ranking only. They are still drawn, and still steer the ordering.
        const forward = new Map();
        {
            const WHITE = 0, GREY = 1, BLACK = 2;
            const state = new Map(items.map((i) => [i.key, WHITE]));
            const link = (a, b) => {
                if (!forward.has(a)) forward.set(a, new Set());
                forward.get(a).add(b);
            };
            // Iterative, because a deep chain would otherwise overflow the stack.
            for (const root of items) {
                if (state.get(root.key) !== WHITE) continue;
                state.set(root.key, GREY);
                const stack = [{ key: root.key, iter: null }];
                while (stack.length) {
                    const frame = stack[stack.length - 1];
                    if (!frame.iter) frame.iter = (out.get(frame.key) || new Set()).values();
                    const step = frame.iter.next();
                    if (step.done) {
                        state.set(frame.key, BLACK);
                        stack.pop();
                        continue;
                    }
                    const nb = step.value;
                    if (state.get(nb) === GREY) continue; // a back edge; not a rank
                    link(frame.key, nb);
                    if (state.get(nb) === WHITE) {
                        state.set(nb, GREY);
                        stack.push({ key: nb, iter: null });
                    }
                }
            }
        }

        // Longest-path ranking. Every item settles, because `forward` is acyclic.
        const rank = new Map(items.map((i) => [i.key, 0]));
        const degree = new Map(items.map((i) => [i.key, 0]));
        for (const [, set] of forward) for (const nb of set) degree.set(nb, degree.get(nb) + 1);
        const queue = items.filter((i) => degree.get(i.key) === 0).map((i) => i.key);
        while (queue.length) {
            const k = queue.shift();
            for (const nb of forward.get(k) || []) {
                rank.set(nb, Math.max(rank.get(nb), rank.get(k) + 1));
                degree.set(nb, degree.get(nb) - 1);
                if (degree.get(nb) === 0) queue.push(nb);
            }
        }

        // Normalise long edges into chains of placeholders.
        //
        // This is what stops Tidy laying out a diagram whose lines then have
        // nowhere to go. An edge from rank 0 to rank 3 used to be invisible
        // here: the crossing counter never saw it, and nothing reserved space
        // for it in ranks 1 and 2, so it was simply drawn through whatever had
        // been placed there. Threading it through a placeholder in each layer
        // it crosses makes it a first-class citizen — it gets ordered with
        // everything else, and the real nodes move aside to leave it a lane.
        const graph = new Map();
        const link = (a, b) => {
            if (!graph.has(a)) graph.set(a, new Set());
            graph.get(a).add(b);
        };
        for (const [k, set] of out) {
            for (const nb of set) {
                const ra = rank.get(k);
                const rb = rank.get(nb);
                if (Math.abs(rb - ra) <= 1) {
                    link(k, nb);
                    continue;
                }
                const step = rb > ra ? 1 : -1;
                let prev = k;
                for (let r = ra + step; r !== rb; r += step) {
                    const key = `dummy:${k}>${nb}:${r}`;
                    const item = { key, kind: "dummy", id: key, w: DUMMY_W, h: DUMMY_H };
                    items.push(item);
                    byKey.set(key, item);
                    rank.set(key, r);
                    link(prev, key);
                    prev = key;
                }
                link(prev, nb);
            }
        }

        const layers = [];
        for (const it of items) {
            const r = rank.get(it.key) || 0;
            if (!layers[r]) layers[r] = [];
            layers[r].push(it);
        }
        for (let i = 0; i < layers.length; i++) if (!layers[i]) layers[i] = [];

        // Barycentre ordering with alternating sweeps.
        // A single forward pass only ever considers predecessors, which leaves
        // obvious crossings behind whenever a node's successors disagree with
        // its predecessors. Sweeping down and then up, and keeping whichever
        // ordering actually crossed least, converges markedly better — and edge
        // crossings are the main thing that makes a dense diagram unreadable.
        const incoming = new Map(items.map((i) => [i.key, []]));
        for (const [k, set] of graph) {
            for (const nb of set) {
                if (incoming.has(nb)) incoming.get(nb).push(k);
            }
        }
        const outgoing = new Map(items.map((i) => [i.key, []]));
        for (const [k, set] of graph) {
            if (!outgoing.has(k)) continue;
            for (const nb of set) outgoing.get(k).push(nb);
        }

        const sweep = (r, neighbours, refLayer) => {
            const positionOf = new Map(refLayer.map((it, idx) => [it.key, idx]));
            const score = new Map();
            layers[r].forEach((it, idx) => {
                const ns = (neighbours.get(it.key) || [])
                    .filter((k) => positionOf.has(k))
                    .map((k) => positionOf.get(k));
                // No neighbour in the reference layer: hold current position
                // rather than being flung to the end.
                score.set(it.key, ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : idx);
            });
            layers[r].sort((a, b) => score.get(a.key) - score.get(b.key));
        };

        const countCrossings = () => {
            let total = 0;
            for (let r = 0; r + 1 < layers.length; r++) {
                const upper = new Map(layers[r].map((it, idx) => [it.key, idx]));
                const lower = new Map(layers[r + 1].map((it, idx) => [it.key, idx]));
                const pairs = [];
                for (const [k, set] of graph) {
                    if (!upper.has(k)) continue;
                    for (const nb of set) {
                        if (lower.has(nb)) pairs.push([upper.get(k), lower.get(nb)]);
                    }
                }
                for (let i = 0; i < pairs.length; i++) {
                    for (let j = i + 1; j < pairs.length; j++) {
                        const [a1, b1] = pairs[i];
                        const [a2, b2] = pairs[j];
                        if ((a1 - a2) * (b1 - b2) < 0) total++;
                    }
                }
            }
            return total;
        };

        let best = layers.map((l) => [...l]);
        let bestCrossings = countCrossings();
        for (let pass = 0; pass < 6; pass++) {
            if (pass % 2 === 0) {
                for (let r = 1; r < layers.length; r++) sweep(r, incoming, layers[r - 1]);
            } else {
                for (let r = layers.length - 2; r >= 0; r--) sweep(r, outgoing, layers[r + 1]);
            }
            const c = countCrossings();
            if (c < bestCrossings) {
                bestCrossings = c;
                best = layers.map((l) => [...l]);
            }
        }
        for (let r = 0; r < layers.length; r++) layers[r] = best[r];

        for (const it of items) {
            if (it.kind !== "dummy") slot.set(it.key, `${cid}#${rank.get(it.key)}`);
        }

        const local = new Map();
        let width = 0;
        let height = 0;

        // A reserved lane needs clearance, not a full node's worth of gap, so
        // threading long edges through a diagram does not inflate it.
        const gapBetween = (a, b) =>
            a.kind === "dummy" || b.kind === "dummy" ? DUMMY_GAP : V_GAP;
        const stack = (layer, size, gap) => {
            let total = 0;
            layer.forEach((it, i) => {
                total += size(it);
                if (i < layer.length - 1) total += gap(it, layer[i + 1]);
            });
            return total;
        };

        if (dir === "LR") {
            const layerW = layers.map((l) => (l.length ? Math.max(...l.map((i) => i.w)) : 0));
            const layerH = layers.map((l) => stack(l, (i) => i.h, gapBetween));
            const bands = wrapLayers(layerW, layerH, H_GAP);
            let y0 = 0;
            for (const band of bands) {
                const bandH = Math.max(...band.map((r) => layerH[r]));
                let x = 0;
                for (const r of band) {
                    let y = y0 + (bandH - layerH[r]) / 2;
                    layers[r].forEach((it, i) => {
                        local.set(it.key, { x: x + (layerW[r] - it.w) / 2, y });
                        y += it.h + (i < layers[r].length - 1 ? gapBetween(it, layers[r][i + 1]) : 0);
                    });
                    x += layerW[r] + H_GAP;
                }
                width = Math.max(width, x - H_GAP);
                y0 += bandH + BAND_GAP;
            }
            height = Math.max(0, y0 - BAND_GAP);
        } else {
            const hGap = (a, b) => (a.kind === "dummy" || b.kind === "dummy" ? DUMMY_GAP : H_GAP);
            const layerH = layers.map((l) => (l.length ? Math.max(...l.map((i) => i.h)) : 0));
            const layerW = layers.map((l) => stack(l, (i) => i.w, hGap));
            const bands = wrapLayers(layerH, layerW, V_GAP);
            let x0 = 0;
            for (const band of bands) {
                const bandW = Math.max(...band.map((r) => layerW[r]));
                let y = 0;
                for (const r of band) {
                    let x = x0 + (bandW - layerW[r]) / 2;
                    layers[r].forEach((it, i) => {
                        local.set(it.key, { x, y: y + (layerH[r] - it.h) / 2 });
                        x += it.w + (i < layers[r].length - 1 ? hGap(it, layers[r][i + 1]) : 0);
                    });
                    y += layerH[r] + V_GAP;
                }
                height = Math.max(height, y - V_GAP);
                x0 += bandW + BAND_GAP;
            }
            width = Math.max(0, x0 - BAND_GAP);
        }

        function apply(dx, dy) {
            for (const it of items) {
                const p = local.get(it.key);
                if (it.kind === "dummy") continue; // a reserved lane, not a shape
                if (it.kind === "node") {
                    const n = nodesById.get(it.id);
                    n.x = Math.round(dx + p.x);
                    n.y = Math.round(dy + p.y);
                } else {
                    sub.get(it.id).apply(dx + p.x + PAD, dy + p.y + PAD + HEADER);
                }
            }
        }

        const isRoot = cid === null;
        return {
            width: width + (isRoot ? 0 : PAD * 2),
            height: height + (isRoot ? 0 : PAD * 2 + HEADER),
            apply,
        };
    }

    layout(null).apply(0, 0);
    fitGroupBoxes(diagram);
    refineLayout(diagram, { ...options, slot, direction: dir });
    // Callers that need to reason about the layering (the guard script) can
    // pass a Map to receive it; coordinates alone are ambiguous once layers
    // wrap into bands, because two layers can legitimately share an x.
    if (options.slots instanceof Map) for (const [k, v] of slot) options.slots.set(k, v);
    return diagram;
}

// ------------------------------------------------------------- refinement

/**
 * Move nodes to get lines out of trouble.
 *
 * Layering alone cannot fix these diagrams. It works one container at a time,
 * so an edge that leaves a subgraph is projected onto the subgraph as a whole
 * and then forgotten — and in practice those are most of the edges (17 of 25
 * on the vWAN topology, 21 of 35 on the landing zone). The result is a node
 * placed at the far side of its group from the thing it talks to, with the
 * line dragged back across everything in between.
 *
 * Nothing about the layered pass can see that, because the damage only exists
 * once real coordinates and real routes exist. So this runs afterwards on the
 * finished geometry: try a change, route it for real, count what collides, and
 * keep the change only if it helped.
 *
 * The moves are deliberately conservative — swapping two nodes inside a
 * subgraph, or two sibling subgraphs — so a tidy never reorganises a diagram
 * into something the author does not recognise.
 */
export function refineLayout(diagram, options = {}) {
    const nodes = diagram.nodes || [];
    const groups = diagram.groups || [];
    if (nodes.length < 3 || !(diagram.edges || []).length) return diagram;

    // Nodes may move freely within their subgraph; whole subgraphs may only
    // trade places with a peer in the same layer. A subgraph carries the macro
    // flow of the diagram — "ingress, then compute, then data" — and shuffling
    // that to save a few crossings costs far more than it gains. Letting
    // subgraphs move freely does score better on the landing zone (4 lines
    // through a box instead of 10), but only by reordering the layers, which
    // is not a tidy any more.
    const slot = options.slot;
    const canSwapGroups = (a, b) => Boolean(slot) && slot.has(a) && slot.get(a) === slot.get(b);

    // Scoring a candidate costs roughly the square of the edge count, so the
    // number of candidates has to come down as diagrams grow or a tidy on a
    // large drawing would hang. Deliberately a function of size rather than a
    // stopwatch, so the same diagram always tidies the same way.
    const e = (diagram.edges || []).length;

    // Past this size the budget is down to a handful of moves against a huge
    // search space, and measurement bears it out: at 200 edges the pass spends
    // nearly two seconds to change nothing at all. Better to tidy instantly.
    if (e > 120) return diagram;

    const budget = options.maxEvaluations ?? Math.max(24, Math.min(600, Math.round(2e5 / (e * e))));
    const rounds = options.rounds ?? 4;

    const dir = options.direction === "TB" ? "TB" : "LR";
    const flowPenalty = options.flowPenalty ?? 20;
    let evaluations = 0;
    let cost = collisionCost(diagram, dir, flowPenalty);

    // Never accept a move that puts more shapes on top of each other, however
    // many lines it untangles.
    const accepts = (next) => next.overlaps <= cost.overlaps && next.score < cost.score;

    const swapNodes = (a, b) => {
        const ax = a.x, ay = a.y;
        a.x = b.x; a.y = b.y;
        b.x = ax; b.y = ay;
    };

    const moveGroup = (g, dx, dy) => {
        for (const n of nodes) if (n.group === g.id) { n.x += dx; n.y += dy; }
        for (const k of groups) if (k.parent === g.id) moveGroup(k, dx, dy);
    };

    for (let round = 0; round < rounds; round++) {
        let improved = false;

        // Swap two nodes within the same subgraph.
        for (const g of [...groups, { id: null }]) {
            const members = nodes.filter((n) => (n.group || null) === (g.id || null));
            for (let i = 0; i < members.length; i++) {
                for (let j = i + 1; j < members.length; j++) {
                    if (evaluations >= budget) break;
                    swapNodes(members[i], members[j]);
                    evaluations++;
                    const next = collisionCost(diagram, dir, flowPenalty);
                    if (accepts(next)) {
                        cost = next;
                        improved = true;
                    } else {
                        swapNodes(members[i], members[j]);
                    }
                }
            }
        }

        // Swap two sibling subgraphs, carrying their contents with them.
        for (let i = 0; i < groups.length; i++) {
            for (let j = i + 1; j < groups.length; j++) {
                const a = groups[i];
                const b = groups[j];
                if ((a.parent || null) !== (b.parent || null)) continue;
                if (!canSwapGroups(`group:${a.id}`, `group:${b.id}`)) continue;
                if (evaluations >= budget) break;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                moveGroup(a, dx, dy);
                moveGroup(b, -dx, -dy);
                fitGroupBoxes(diagram);
                evaluations++;
                const next = collisionCost(diagram, dir, flowPenalty);
                if (accepts(next)) {
                    cost = next;
                    improved = true;
                } else {
                    moveGroup(a, -dx, -dy);
                    moveGroup(b, dx, dy);
                    fitGroupBoxes(diagram);
                }
            }
        }

        if (!improved) break;
    }

    fitGroupBoxes(diagram);
    return diagram;
}

/**
 * What the diagram costs a reader, in collisions.
 *
 * A line vanishing behind a box is the worst outcome, so it dominates; a
 * crossing is untidy but still followable; straying through an unrelated
 * subgraph is only misleading.
 *
 * Overlapping shapes are returned separately rather than priced in, because
 * they are not a trade. Weighted, they get bought: a swap that overlaps two
 * subgraphs but fixes thirty lines scores well and is accepted, and the result
 * is a diagram with two boxes on top of each other. Overlap is a constraint.
 */
function collisionCost(diagram, dir, flowPenalty) {
    // The cheap router: this scores hundreds of candidate arrangements and only
    // needs a proxy for how tangled each one is.
    const routes = routeAll(diagram.nodes, diagram.edges, {
        fast: true,
        labels: labelBoxes(diagram.groups),
    });
    const boxes = diagram.nodes.map((n) => ({
        id: n.id, x: n.x, y: n.y, w: NODE_W, h: NODE_H,
    }));

    let throughNodes = 0;
    for (const e of diagram.edges) {
        const r = routes.get(e.id);
        if (!r) continue;
        for (const box of boxes) {
            if (box.id === e.from || box.id === e.to) continue;
            if (polylineHitsBox(r.points, box)) throughNodes++;
        }
    }

    let crossings = 0;
    const list = [...routes.entries()];
    const byId = new Map(diagram.edges.map((e) => [e.id, e]));
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const ea = byId.get(list[i][0]);
            const eb = byId.get(list[j][0]);
            // Edges meeting at a shared node are not a crossing.
            if (ea.from === eb.from || ea.from === eb.to ||
                ea.to === eb.from || ea.to === eb.to) continue;
            if (polylinesCross(list[i][1].points, list[j][1].points)) crossings++;
        }
    }

    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            if (boxesOverlap(boxes[i], boxes[j])) overlaps++;
        }
    }
    const groups = diagram.groups || [];
    for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
            const a = groups[i];
            const b = groups[j];
            if ((a.parent || null) !== (b.parent || null)) continue;
            if (boxesOverlap(
                { x: a.x, y: a.y, w: a.width, h: a.height },
                { x: b.x, y: b.y, w: b.width, h: b.height },
            )) overlaps++;
        }
    }

    const nodeGroup = new Map(diagram.nodes.map((n) => [n.id, n.group || null]));
    let throughGroups = 0;
    for (const e of diagram.edges) {
        const r = routes.get(e.id);
        if (!r) continue;
        for (const g of groups) {
            if (nodeGroup.get(e.from) === g.id || nodeGroup.get(e.to) === g.id) continue;
            if (polylineHitsBox(r.points, { x: g.x, y: g.y, w: g.width, h: g.height })) {
                throughGroups++;
            }
        }
    }

    // Arrows that run against the flow. Without this the optimiser would
    // happily "fix" a collision by dragging a downstream node upstream, which
    // trades a tangle for a diagram that reads backwards — a worse result.
    const pos = new Map(diagram.nodes.map((n) => [n.id, n]));
    let backward = 0;
    for (const e of diagram.edges) {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) continue;
        if (dir === "TB" ? b.y + NODE_H <= a.y : b.x + NODE_W <= a.x) backward++;
    }

    return {
        overlaps,
        score: throughNodes * 10 + backward * flowPenalty + crossings * 3 + throughGroups,
    };
}

function boxesOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function polylineHitsBox(points, box) {
    const m = 4;
    const x1 = box.x + m;
    const y1 = box.y + m;
    const x2 = box.x + box.w - m;
    const y2 = box.y + box.h - m;
    if (x2 <= x1 || y2 <= y1) return false;
    for (let i = 0; i < points.length - 1; i++) {
        const p = points[i];
        const q = points[i + 1];
        if (Math.min(p.x, q.x) < x2 && Math.max(p.x, q.x) > x1 &&
            Math.min(p.y, q.y) < y2 && Math.max(p.y, q.y) > y1) return true;
    }
    return false;
}

function polylinesCross(a, b) {
    // Bounding-box reject first. Most edge pairs in a diagram are nowhere near
    // each other, and this scoring runs once per candidate move.
    let aMinX = Infinity, aMaxX = -Infinity, aMinY = Infinity, aMaxY = -Infinity;
    for (const p of a) {
        if (p.x < aMinX) aMinX = p.x;
        if (p.x > aMaxX) aMaxX = p.x;
        if (p.y < aMinY) aMinY = p.y;
        if (p.y > aMaxY) aMaxY = p.y;
    }
    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
    for (const p of b) {
        if (p.x < bMinX) bMinX = p.x;
        if (p.x > bMaxX) bMaxX = p.x;
        if (p.y < bMinY) bMinY = p.y;
        if (p.y > bMaxY) bMaxY = p.y;
    }
    if (aMaxX < bMinX || bMaxX < aMinX || aMaxY < bMinY || bMaxY < aMinY) return false;

    const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    for (let i = 0; i < a.length - 1; i++) {
        for (let j = 0; j < b.length - 1; j++) {
            const p1 = a[i], p2 = a[i + 1], p3 = b[j], p4 = b[j + 1];
            if (Math.min(p1.x, p2.x) > Math.max(p3.x, p4.x)) continue;
            if (Math.max(p1.x, p2.x) < Math.min(p3.x, p4.x)) continue;
            if (Math.min(p1.y, p2.y) > Math.max(p3.y, p4.y)) continue;
            if (Math.max(p1.y, p2.y) < Math.min(p3.y, p4.y)) continue;
            const d1 = side(p3, p4, p1);
            const d2 = side(p3, p4, p2);
            const d3 = side(p1, p2, p3);
            const d4 = side(p1, p2, p4);
            if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
                ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
        }
    }
    return false;
}

/**
 * Wrap a run of layers into bands so the drawing keeps a sensible shape.
 *
 * Laid out strictly by flow, a diagram with many ranks becomes a long thin
 * strip — nine columns across for the vWAN topology — which no one can read on
 * a slide. Wrapping the sequence the way text wraps keeps the flow order
 * (left to right, then down to the next band) while filling the page.
 *
 * @param {number[]} along  size of each layer along the flow axis
 * @param {number[]} across size of each layer across it
 * @param {number} gap      spacing between layers along the flow axis
 * @returns {number[][]} layer indices grouped into bands
 */
function wrapLayers(along, across, gap) {
    const n = along.length;
    if (n < 2) return [along.map((_, i) => i)];

    const total = along.reduce((s, v) => s + v, 0) + (n - 1) * gap;

    // Pack greedily into a given number of bands, aiming for equal length.
    const pack = (count) => {
        const target = total / count;
        const bands = [];
        let current = [];
        let run = 0;
        for (let i = 0; i < n; i++) {
            // Allow a little overshoot rather than leaving a band conspicuously short.
            if (current.length && run + gap + along[i] > target * 1.12) {
                bands.push(current);
                current = [];
                run = 0;
            }
            if (current.length) run += gap;
            current.push(i);
            run += along[i];
        }
        if (current.length) bands.push(current);
        return bands;
    };

    const shape = (bands) => {
        let w = 0;
        let h = 0;
        bands.forEach((band, i) => {
            const len = band.reduce((s, r) => s + along[r], 0) + (band.length - 1) * gap;
            w = Math.max(w, len);
            h += Math.max(...band.map((r) => across[r]));
            if (i < bands.length - 1) h += BAND_GAP;
        });
        return { w, h: h || 1 };
    };

    // Score candidates on what they actually produce rather than an estimate.
    // Guessing the height as "bands x the deepest layer" is far too pessimistic
    // when one layer is much deeper than the rest, and that single bad estimate
    // was enough to keep the landing zone as a 2644x788 strip.
    let best = null;
    let bestMiss = Infinity;
    for (let b = 1; b <= n; b++) {
        const bands = pack(b);
        const { w, h } = shape(bands);
        // Compare on a log scale, so "three times too wide" and "three times
        // too tall" count as equally wrong.
        const miss = Math.abs(Math.log((w / h) / TARGET_RATIO));
        if (miss < bestMiss) {
            bestMiss = miss;
            best = bands;
        }
    }
    return best;
}

/**
 * Size every non-empty subgraph around its contents, deepest first.
 * The editor refines this with real text metrics on render; this keeps the
 * saved document correct for agent-side callers and for export.
 */
export function fitGroupBoxes(diagram) {
    const groups = diagram.groups || [];
    if (!groups.length) return diagram;

    const depth = (g) => {
        let d = 0;
        let cursor = g;
        while (cursor?.parent && d < 64) {
            cursor = groups.find((x) => x.id === cursor.parent);
            d++;
        }
        return d;
    };

    for (const g of [...groups].sort((a, b) => depth(b) - depth(a))) {
        const members = diagram.nodes.filter((n) => n.group === g.id);
        const kids = groups.filter((k) => k.parent === g.id);
        if (!members.length && !kids.length) continue;

        const pad = Number.isFinite(Number(g.padding)) ? Number(g.padding) : PAD;
        const x1 = [];
        const y1 = [];
        const x2 = [];
        const y2 = [];
        for (const n of members) {
            x1.push(n.x);
            y1.push(n.y);
            x2.push(n.x + NODE_W);
            y2.push(n.y + NODE_H);
        }
        for (const k of kids) {
            x1.push(k.x);
            y1.push(k.y - HEADER);
            x2.push(k.x + k.width);
            y2.push(k.y + k.height);
        }
        g.x = Math.round(Math.min(...x1) - pad);
        g.y = Math.round(Math.min(...y1) - pad);
        g.width = Math.round(Math.max(...x2) + pad - g.x);
        g.height = Math.round(Math.max(...y2) + pad - g.y);
    }
    return diagram;
}
