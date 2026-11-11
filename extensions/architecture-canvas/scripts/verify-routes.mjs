#!/usr/bin/env node
// Guard: orthogonal connectors must stay axis-aligned and must not be drawn on
// top of each other. Two edges can each be perfectly routed and still be
// invisible as separate lines, which is what routeAll's port spreading and
// channel deconfliction exist to prevent. Run after editing web/edge-route.mjs.
//
//   node scripts/verify-routes.mjs [diagram.arch.json ...]
//
// With no arguments it checks every diagram in the repo's architectures folder.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeAll, labelBoxes } from "../web/edge-route.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");

// Lines closer than SAME are one line to the eye; closer than NEAR are legible
// but tight. Only runs longer than MINRUN matter — a short stub crossing
// another reads as a corner, not as a doubled line.
const SAME = 2;
const NEAR = 6;
const MINRUN = 8;

function segmentsOf(routes) {
    const segs = [];
    for (const [id, route] of routes) {
        if (route.style !== "orthogonal") continue;
        const p = route.points;
        for (let i = 0; i < p.length - 1; i++) {
            const a = p[i];
            const b = p[i + 1];
            const vertical = Math.abs(a.x - b.x) < 0.5;
            const horizontal = Math.abs(a.y - b.y) < 0.5;
            if (!vertical && !horizontal) {
                segs.push({ id, diagonal: true });
                continue;
            }
            if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
            segs.push({
                id,
                vertical,
                fixed: vertical ? a.x : a.y,
                lo: vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
                hi: vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x),
            });
        }
    }
    return segs;
}

async function check(file) {
    const diagram = JSON.parse(await readFile(file, "utf8"));
    const routes = routeAll(diagram.nodes || [], diagram.edges || [], {
        labels: labelBoxes(diagram.groups),
    });
    const segs = segmentsOf(routes);
    const name = path.basename(file);

    const diagonal = segs.filter((s) => s.diagonal);
    const runs = segs.filter((s) => !s.diagonal);
    if (!runs.length && !diagonal.length) {
        console.log(`  ok   ${name} (no orthogonal connectors)`);
        return true;
    }

    const problems = [];
    for (const s of diagonal) problems.push(`${s.id} has a segment that is not axis-aligned`);

    let tight = 0;
    for (let i = 0; i < runs.length; i++) {
        for (let j = i + 1; j < runs.length; j++) {
            const p = runs[i];
            const q = runs[j];
            if (p.id === q.id || p.vertical !== q.vertical) continue;
            const apart = Math.abs(p.fixed - q.fixed);
            if (apart > NEAR) continue;
            const run = Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo);
            if (run <= MINRUN) continue;
            const where = `${p.vertical ? "x" : "y"}=${p.fixed.toFixed(1)}/${q.fixed.toFixed(1)}`;
            if (apart < SAME) {
                problems.push(`${p.id} and ${q.id} share a line (${where}, ${run.toFixed(0)}px)`);
            } else {
                tight++;
            }
        }
    }

    const summary = `${runs.length} segments, ${tight} tight pair(s)`;
    if (problems.length) {
        console.log(`  FAIL ${name} - ${summary}`);
        for (const p of problems) console.log(`         ${p}`);
        return false;
    }
    console.log(`  ok   ${name} - ${summary}`);
    return true;
}

let files = process.argv.slice(2);
if (!files.length) {
    const dir = path.join(REPO, "architectures");
    files = (await readdir(dir))
        .filter((f) => f.endsWith(".arch.json"))
        .map((f) => path.join(dir, f));
}

console.log(`checking ${files.length} diagram(s)`);
let ok = true;
for (const f of files) ok = (await check(f)) && ok;

if (!ok) {
    console.error("FAIL: connectors are drawn on top of each other.");
    process.exit(1);
}
console.log("PASS");
