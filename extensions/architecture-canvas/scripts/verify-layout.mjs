#!/usr/bin/env node
// Guard: a tidy must produce a readable drawing.
//
// The failure that motivated this was silent — ranking gave every item caught
// in a cycle the same rank, so diagrams full of feedback (which is most of
// them) collapsed into a single layer and every connector ran up and down one
// column. Nothing crashed; it just looked terrible. These checks assert the
// properties that were quietly violated.
//
//   node scripts/verify-layout.mjs [diagram.arch.json ...]
//
// With no arguments it checks every diagram in the repo's architectures folder.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autoLayout, NODE_W, NODE_H } from "../web/layout.mjs";
import { routeAll, labelBoxes } from "../web/edge-route.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");

// A drawing more than this many times longer than it is deep does not fit on a
// slide and is usually a sign the layers never wrapped.
const MAX_RATIO = 3.5;

const overlap = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Children of a container, and how many distinct layers they landed in.
 *
 * Used to assert that connected items actually got separate layers. That is
 * the invariant the cycle bug broke: every subgraph on the vWAN topology was
 * ranked 0 and stacked into one column, and neither an overlap nor an
 * aspect-ratio check noticed, because nothing overlapped and the column was
 * not especially long. Only the layering itself shows it.
 *
 * This reads the layering rather than the coordinates, because once layers
 * wrap into bands two different layers can legitimately share an x.
 */
function containerSpread(diagram, cid, slots) {
    const nodes = diagram.nodes || [];
    const groups = diagram.groups || [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const gById = new Map(groups.map((g) => [g.id, g]));

    const project = (nodeId) => {
        const n = byId.get(nodeId);
        if (!n) return null;
        if ((n.group || null) === cid) return `node:${nodeId}`;
        let cursor = n.group ? gById.get(n.group) : null;
        let guard = 0;
        while (cursor && guard++ < 64) {
            if ((cursor.parent || null) === cid) return `group:${cursor.id}`;
            cursor = cursor.parent ? gById.get(cursor.parent) : null;
        }
        return null;
    };

    const children = new Set();
    for (const n of nodes) if ((n.group || null) === cid) children.add(`node:${n.id}`);
    for (const g of groups) if ((g.parent || null) === cid) children.add(`group:${g.id}`);

    let internalEdges = 0;
    for (const e of diagram.edges || []) {
        const a = project(e.from);
        const b = project(e.to);
        if (a && b && a !== b && children.has(a) && children.has(b)) internalEdges++;
    }

    const layers = new Set();
    for (const key of children) if (slots.has(key)) layers.add(slots.get(key));

    return { count: children.size, internalEdges, distinct: layers.size };
}

function check(diagram, dir, name) {
    const slots = new Map();
    autoLayout(diagram, { direction: dir, slots });
    const problems = [];
    const nodes = diagram.nodes || [];
    const groups = diagram.groups || [];

    const boxes = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: NODE_W, h: NODE_H }));
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            if (overlap(boxes[i], boxes[j])) {
                problems.push(`components ${boxes[i].id} and ${boxes[j].id} overlap`);
            }
        }
    }
    for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
            const a = groups[i];
            const b = groups[j];
            if ((a.parent || null) !== (b.parent || null)) continue;
            if (overlap(
                { x: a.x, y: a.y, w: a.width, h: a.height },
                { x: b.x, y: b.y, w: b.width, h: b.height },
            )) problems.push(`subgraphs "${a.label}" and "${b.label}" overlap`);
        }
    }

    if (nodes.length) {
        const xs = nodes.map((n) => n.x);
        const ys = nodes.map((n) => n.y);
        const w = Math.max(...xs) - Math.min(...xs) + NODE_W;
        const h = Math.max(...ys) - Math.min(...ys) + NODE_H;
        const ratio = Math.max(w / h, h / w);
        if (ratio > MAX_RATIO) {
            problems.push(`drawing is ${Math.round(w)}x${Math.round(h)} - ${ratio.toFixed(1)}:1`);
        }
    }

    // Connected siblings must land in different layers.
    for (const cid of [null, ...groups.map((g) => g.id)]) {
        const s = containerSpread(diagram, cid, slots);
        if (s.count >= 2 && s.internalEdges > 0 && s.distinct < 2) {
            const where = cid
                ? `subgraph "${groups.find((g) => g.id === cid)?.label}"`
                : "the top level";
            problems.push(
                `${where}: ${s.count} connected items all landed in one layer ` +
                `(${s.internalEdges} connector(s) between them)`,
            );
        }
    }

    // Collisions. A connector vanishing behind a box is the failure this whole
    // exercise was about, so it is asserted below rather than merely counted.
    const labels = labelBoxes(groups);
    const routes = routeAll(nodes, diagram.edges || [], { labels });
    let through = 0;
    let selfCross = 0;
    let labelCross = 0;
    for (const e of diagram.edges || []) {
        const r = routes.get(e.id);
        if (!r) continue;
        const crosses = (box, m = 4) => r.points.some((p, i) => {
            if (i === r.points.length - 1) return false;
            const q = r.points[i + 1];
            return Math.min(p.x, q.x) < box.x + box.w - m && Math.max(p.x, q.x) > box.x + m &&
                   Math.min(p.y, q.y) < box.y + box.h - m && Math.max(p.y, q.y) > box.y + m;
        });
        for (const box of boxes) {
            const own = box.id === e.from || box.id === e.to;
            if (!crosses(box)) continue;
            if (own) { selfCross++; break; }
            through++;
            break;
        }
        for (const box of labels) {
            if (crosses(box, 2)) { labelCross++; break; }
        }
    }

    // Connectors must not disappear behind a component. The path search makes
    // this achievable, so it is a failure rather than a statistic.
    if (through > 0) {
        problems.push(`${through} connector(s) routed through a component box`);
    }
    // A line crossing its own endpoint to reach a port on the far side. Worth
    // asserting separately, because the obvious check excludes exactly the two
    // boxes involved and so never sees it.
    if (selfCross > 0) {
        problems.push(`${selfCross} connector(s) cross their own endpoint's box`);
    }
    // A line struck through a subgraph's title, which is usually the thing
    // telling the reader what they are looking at.
    if (labelCross > 0) {
        problems.push(`${labelCross} connector(s) cross a subgraph label`);
    }

    const summary = `${nodes.length} components, ${(diagram.edges || []).length} connectors, ` +
        `${through + selfCross} through a box, ${labelCross} through a label`;
    if (problems.length) {
        console.log(`  FAIL ${name} ${dir} - ${summary}`);
        for (const p of problems) console.log(`         ${p}`);
        return false;
    }
    console.log(`  ok   ${name} ${dir} - ${summary}`);
    return true;
}

let files = process.argv.slice(2);
if (!files.length) {
    const dir = path.join(REPO, "architectures");
    files = (await readdir(dir))
        .filter((f) => f.endsWith(".arch.json"))
        .map((f) => path.join(dir, f));
}

console.log(`tidying ${files.length} diagram(s)`);
let ok = true;
for (const f of files) {
    const name = path.basename(f).replace(/\.arch\.json$/, "");
    for (const dir of ["LR", "TB"]) {
        const diagram = JSON.parse(await readFile(f, "utf8"));
        for (const e of diagram.edges || []) e.route = "orthogonal";
        if (!diagram.nodes?.length) continue;
        ok = check(diagram, dir, name) && ok;
    }
}

if (!ok) {
    console.error("FAIL: auto-layout produced an unreadable drawing.");
    process.exit(1);
}
console.log("PASS");
