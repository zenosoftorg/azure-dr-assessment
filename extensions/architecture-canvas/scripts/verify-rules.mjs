#!/usr/bin/env node
// Guard: every icon name referenced by the suggestion rules must resolve to a
// real entry in the catalog, and resolve to that exact icon rather than drifting
// to a fuzzy neighbour ("Azure Functions" -> "Azure Network Function Manager
// Functions"). Run after editing lib/suggest.mjs.
//
//   node scripts/verify-rules.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveIconRoot } from "../lib/config.mjs";
import { buildCatalog } from "../lib/icons.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUGGEST_FILE = path.join(HERE, "..", "lib", "suggest.mjs");

const catalog = await buildCatalog(resolveIconRoot(HERE));
if (!catalog.size) {
    console.error("FAIL: icon catalog is empty - could not locate 'Final SVG Icons'.");
    process.exit(1);
}

// Pull every icon name out of the `suggests: [...]` arrays. Handles both the
// plain-string form and the object form `{ icon: "...", label, dir }`.
const source = await readFile(SUGGEST_FILE, "utf8");
const names = new Set();
for (const block of source.matchAll(/suggests:\s*\[([\s\S]*?)\n\s*\],/g)) {
    const body = block[1];
    for (const obj of body.matchAll(/\{\s*icon:\s*"([^"]+)"/g)) names.add(obj[1]);
    // Plain-string entries: quoted strings not preceded by a property name.
    for (const bare of body.matchAll(/(^|[[,])\s*"([^"]+)"\s*(?=[,\]])/g)) names.add(bare[2]);
}

if (!names.size) {
    console.error("FAIL: no suggestion names found - did the rule format change?");
    process.exit(1);
}

const problems = [];
for (const name of [...names].sort()) {
    const hit = catalog.resolve(name);
    if (!hit) {
        problems.push({ name, got: null, kind: "missing" });
    } else if (hit.name.toLowerCase() !== name.toLowerCase()) {
        problems.push({ name, got: hit.name, kind: "drift" });
    }
}

console.log(`checked ${names.size} suggestion names against ${catalog.size} icons`);

if (!problems.length) {
    console.log("OK: every suggestion resolves to an exact icon.");
    process.exit(0);
}

for (const p of problems) {
    if (p.kind === "missing") {
        console.error(`  MISSING  "${p.name}" - no icon found`);
        const near = catalog.search(p.name.split(" ")[0], { limit: 3 }).map((i) => i.name);
        if (near.length) console.error(`           did you mean: ${near.join(", ")}`);
    } else {
        console.error(`  DRIFT    "${p.name}" -> resolved to "${p.got}"`);
    }
}
console.error(`\n${problems.length} problem(s).`);
process.exit(1);
