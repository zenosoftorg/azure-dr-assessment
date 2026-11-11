// Build a self-contained, cinematic HTML story from an .arch.json diagram.
//
// Everything is inlined — icons become data URIs, CSS and JS are embedded — so
// the output is one file that opens from disk with no server and no network.
//
//   node build-presentation.mjs <diagram.arch.json> <story.mjs> <out.html> [--icon-root <dir>] [--json]
//
// This renderer is diagram-agnostic: the narrative lives in the story module,
// which exports buildStory(diagram, helpers) and returns an array of scenes. See
// ../SKILL.md for the scene schema.
//
// Icons are read from the on-disk icon library through the canvas extension's
// IconCatalog. The library root is --icon-root, else ARCH_CANVAS_ICON_ROOT, else
// the default resolved by the canvas extension's lib/config.mjs.
//
// Exit codes: 0 ok, 1 usage, 2 input unreadable or invalid, 3 canvas library
// missing, 4 refused (zero icons inlined, or story labels did not resolve).
// With --json the only stdout is one JSON line; progress goes to stderr.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flags = { iconRoot: null, json: false };
const positional = [];
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") flags.json = true;
    else if (argv[i] === "--icon-root") flags.iconRoot = argv[++i] ?? null;
    else positional.push(argv[i]);
}
const [inPath, storyPath, outPath] = positional;
const say = (line) => (flags.json ? console.error(line) : console.log(line));

// Never returns: callers `await` it so top-level code stops here.
function finish(code, summary = {}) {
    const line = flags.json ? `${JSON.stringify({ ok: code === 0, code, ...summary })}\n` : "";
    if (code !== 0 && code !== 1 && !flags.json) console.error(`build-presentation: ${summary.error || summary.reason}`);
    process.stdout.write(line, () => process.exit(code));
    return new Promise(() => {});
}

if (!inPath || !storyPath || !outPath || positional.length > 3 || (argv.includes("--icon-root") && !flags.iconRoot)) {
    console.error(
        "usage: node build-presentation.mjs <diagram.arch.json> <story.mjs> <out.html> [--icon-root <dir>] [--json]",
    );
    await finish(1, { error: "usage" });
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The story module may also export `cover` to override the cover blurb.
let storyModule;
let diagram;
try {
    storyModule = await import(pathToFileURL(path.resolve(storyPath)).href);
    diagram = JSON.parse(await readFile(inPath, "utf8"));
} catch (err) {
    await finish(2, { error: `cannot read inputs: ${err.message}` });
}
const { buildStory, cover } = storyModule;
if (typeof buildStory !== "function") {
    await finish(2, { error: "story module must export buildStory(diagram, helpers)" });
}
if (!Array.isArray(diagram?.nodes) || !Array.isArray(diagram?.edges) || !Array.isArray(diagram?.groups)) {
    await finish(2, { error: "diagram must have nodes, edges and groups arrays" });
}

// The canvas extension's library modules are shared, not copied: edge routing is
// inlined into the output so every surface draws the same line, and the icon
// catalog supplies the SVGs. Repository layout first, then the user-scope install.
const copilotHome = process.env.COPILOT_HOME || path.join(homedir(), ".copilot");
const CANVAS_ROOT = [
    path.resolve(HERE, "../../../extensions/architecture-canvas"),
    path.join(copilotHome, "extensions", "architecture-canvas"),
].find((dir) => existsSync(path.join(dir, "web", "edge-route.mjs")));
if (!CANVAS_ROOT) {
    await finish(3, { error: "architecture-canvas library not found beside the repository or under $COPILOT_HOME/extensions" });
}
const ROUTE_SRC = (await readFile(path.join(CANVAS_ROOT, "web", "edge-route.mjs"), "utf8"))
    .replace(/^export /gm, "");

// ---------------------------------------------------------------- icons

const { resolveIconRoot } = await import(pathToFileURL(path.join(CANVAS_ROOT, "lib", "config.mjs")).href);
const { buildCatalog } = await import(pathToFileURL(path.join(CANVAS_ROOT, "lib", "icons.mjs")).href);
const iconRoot = flags.iconRoot || resolveIconRoot(undefined);
const catalog = await buildCatalog(iconRoot);

const cache = new Map();
const missing = new Set();
async function iconDataUri(iconId, variant = 0) {
    const key = `${iconId}|${variant}`;
    if (cache.has(key)) return cache.get(key);
    const svg = await catalog.svg(iconId, variant);
    let uri = "";
    if (svg) {
        uri = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
    } else {
        console.warn(`  ! icon unavailable: ${iconId}`);
        missing.add(iconId);
    }
    cache.set(key, uri);
    return uri;
}
for (const n of diagram.nodes) {
    if (n.iconId) n.iconUri = await iconDataUri(n.iconId, n.variant);
}
// Count what was actually read. A failed lookup is cached as "" and must not count.
const inlined = [...cache.values()].filter(Boolean).length;
say(`inlined ${inlined} icons`);
if (inlined === 0) {
    await finish(4, { reason: "zero-icons", iconRoot: iconRoot || null, missingIcons: [...missing] });
}

// Story helpers resolve by label and record every miss, so one build reports all
// of them. Stories that define their own helpers (the SKILL.md format) ignore the
// argument and keep working.
const unresolved = [];
const find = (list, label) => list.find((x) => x.label === label);
const helpers = {
    node(label) {
        const hit = find(diagram.nodes, label);
        if (!hit) unresolved.push(`node "${label}"`);
        return hit ? hit.id : null;
    },
    group(label) {
        const hit = find(diagram.groups, label);
        if (!hit) unresolved.push(`group "${label}"`);
        return hit ? hit.id : null;
    },
    edge(fromLabel, toLabel) {
        const a = find(diagram.nodes, fromLabel);
        const b = find(diagram.nodes, toLabel);
        const hit = a && b ? diagram.edges.find((e) => e.from === a.id && e.to === b.id) : null;
        if (!hit) unresolved.push(`edge "${fromLabel}" -> "${toLabel}"`);
        return hit ? hit.id : null;
    },
};
let story = [];
try {
    story = buildStory(diagram, helpers);
} catch (err) {
    unresolved.push(`story module threw: ${err.message}`);
}
if (unresolved.length) await finish(4, { reason: "unresolved-labels", unresolved });
if (!Array.isArray(story) || story.length === 0) await finish(2, { error: "buildStory must return a non-empty array of scenes" });

const known = {
    nodes: new Set(diagram.nodes.map((n) => n.id)),
    groups: new Set(diagram.groups.map((g) => g.id)),
    edges: new Set(diagram.edges.map((e) => e.id)),
};
const sceneErrors = [];
story.forEach((s, i) => {
    for (const field of ["chapter", "title"]) {
        if (typeof s?.[field] !== "string" || !s[field]) sceneErrors.push(`scene ${i + 1}: ${field} must be a non-empty string`);
    }
    if (s?.md !== undefined && typeof s.md !== "string") sceneErrors.push(`scene ${i + 1}: md must be a string`);
    for (const kind of ["nodes", "groups", "edges"]) {
        for (const id of s?.[kind] ?? []) {
            if (!known[kind].has(id)) sceneErrors.push(`scene ${i + 1}: ${kind} id "${id}" is not in the diagram`);
        }
    }
});
if (sceneErrors.length) await finish(2, { error: "invalid story scenes", details: sceneErrors });
say(`story: ${story.length} scenes`);

const payload = JSON.stringify({ diagram, story }).replace(/</g, "\\u003c");
const esc = (s) => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const chapters = [...new Set(story.map((s) => s.chapter))];

// ---------------------------------------------------------------- css

const CSS = String.raw`
:root {
  color-scheme: light;
  --cp-bg: #f7f4ef;
  --cp-bg-elevated: #fcfbf8;
  --cp-surface: #ffffff;
  --cp-surface-soft: #f5f5f5;
  --cp-border: #dedede;
  --cp-border-strong: #919191;
  --cp-text: #242424;
  --cp-text-muted: #5c5c5c;
  --cp-text-soft: #6f6f6f;
  --cp-accent: #b11f4b;
  --cp-accent-hover: #9a1a41;
  --cp-accent-soft: rgba(177, 31, 75, 0.08);
  --cp-accent-fg: #ffffff;
  --cp-success: #16a34a;
  --cp-danger: #dc2626;
  --cp-warning: #f59e0b;
  --cp-link: #0078d4;
  --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
  --cp-overlay: rgba(255, 255, 255, 0.8);
  --cp-panel: rgba(255, 255, 255, 0.86);
  --cp-panel-strong: rgba(255, 255, 255, 0.96);
  --cp-sheen: rgba(255, 255, 255, 0.55);
  --cp-highlight: rgba(177, 31, 75, 0.12);
}
html[data-theme="dark"] {
  color-scheme: dark;
  --cp-bg: #3d3b3a;
  --cp-bg-elevated: #343231;
  --cp-surface: #292929;
  --cp-surface-soft: #2e2e2e;
  --cp-border: #474747;
  --cp-border-strong: #5f5f5f;
  --cp-text: #dedede;
  --cp-text-muted: #919191;
  --cp-text-soft: #b0b0b0;
  --cp-accent: #fd8ea1;
  --cp-accent-hover: #fb7b91;
  --cp-accent-soft: rgba(253, 142, 161, 0.14);
  --cp-accent-fg: #1a1a1a;
  --cp-success: #4ade80;
  --cp-danger: #f87171;
  --cp-warning: #fbbf24;
  --cp-link: #4da6ff;
  --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  --cp-overlay: rgba(41, 41, 41, 0.88);
  --cp-panel: rgba(41, 41, 41, 0.72);
  --cp-panel-strong: rgba(41, 41, 41, 0.96);
  --cp-sheen: rgba(255, 255, 255, 0.04);
  --cp-highlight: rgba(253, 142, 161, 0.12);
}

* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--cp-bg);
  color: var(--cp-text);
  font-family: "Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}
code, pre, kbd { font-family: Consolas, "Courier New", Courier, monospace; }

.app { display: flex; height: 100vh; }

/* ================= stage ================= */

.stage {
  flex: 2 1 0; position: relative; min-width: 0; overflow: hidden;
  background: var(--cp-bg);
}
/* Depth: a soft sheen that drifts, so the backdrop is never flat. */
.stage::before {
  content: ""; position: absolute; inset: -20%;
  background:
    radial-gradient(48% 42% at 28% 22%, var(--cp-sheen), transparent 70%),
    radial-gradient(38% 34% at 76% 74%, var(--cp-accent-soft), transparent 72%);
  animation: drift 26s ease-in-out infinite alternate;
  pointer-events: none;
}
@keyframes drift {
  from { transform: translate3d(-1.5%, -1%, 0) scale(1); }
  to   { transform: translate3d(2.5%, 2%, 0) scale(1.07); }
}
/* Vignette keeps the eye centred during a move. */
.stage::after {
  content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 3;
  background: radial-gradient(ellipse at 50% 50%, transparent 52%, rgba(0,0,0,0.13) 100%);
}

#canvas { position: relative; z-index: 1; width: 100%; height: 100%; display: block; cursor: grab; }
#canvas.dragging { cursor: grabbing; }

.gr, .nd, .ed { transition: opacity 760ms cubic-bezier(.22,1,.36,1), filter 760ms cubic-bezier(.22,1,.36,1); }
.dim      { opacity: .10; filter: blur(3px) saturate(.25); }
.dim-soft { opacity: .42; filter: saturate(.6); }

.grect { transition: stroke-width 600ms ease, opacity 600ms ease; }
.gr.hot .grect { stroke-width: 2.6; }

.node-box {
  fill: var(--cp-surface); stroke: var(--cp-border); stroke-width: 1; rx: 11;
  transition: stroke 550ms ease, stroke-width 550ms ease;
}
.nd { transform-box: fill-box; transform-origin: center; }
.nd-inner { transition: transform 700ms cubic-bezier(.34,1.56,.64,1); transform-box: fill-box; transform-origin: center; }
.nd.hot .nd-inner { transform: scale(1.085); }
.nd.hot .node-box { stroke: var(--cp-accent); stroke-width: 2.4; }
.nd.hot .node-glow { opacity: 1; }
.node-glow {
  fill: none; stroke: var(--cp-accent); stroke-width: 2; rx: 15;
  opacity: 0; transform-box: fill-box; transform-origin: center;
  animation: halo 2.6s ease-out infinite;
}
@keyframes halo {
  0%   { transform: scale(1);    opacity: .55; }
  70%  { transform: scale(1.16); opacity: 0; }
  100% { transform: scale(1.16); opacity: 0; }
}

.node-label { font: 600 12.5px "Segoe UI", sans-serif; fill: var(--cp-text); text-anchor: middle; }
.node-sub   { font: 10px "Segoe UI", sans-serif; fill: var(--cp-text-muted); text-anchor: middle; }

.edge-line { fill: none; transition: stroke-width 550ms ease, opacity 550ms ease; }
.ed.hot .edge-line { stroke-width: 3.2; }
.edge-label { font: 10.5px "Segoe UI", sans-serif; fill: var(--cp-text); text-anchor: middle; }
.edge-halo  { font: 10.5px "Segoe UI", sans-serif; text-anchor: middle; stroke-linejoin: round;
              fill: var(--cp-bg); stroke: var(--cp-bg); stroke-width: 4.5; }
.flowdot { opacity: 0; transition: opacity 400ms ease; }
.ed.hot .flowdot { opacity: .95; }
.group-label { font: 600 11.5px "Segoe UI", sans-serif; letter-spacing: .01em; }

/* ================= overlays ================= */

.chapcard {
  position: absolute; inset: 0; z-index: 4; display: grid; place-items: center;
  pointer-events: none; opacity: 0;
}
.chapcard.show { animation: chap 2000ms cubic-bezier(.22,1,.36,1); }
@keyframes chap {
  0%   { opacity: 0; }
  18%  { opacity: 1; }
  74%  { opacity: 1; }
  100% { opacity: 0; }
}
.chapcard .inner { text-align: center; transform: translateY(0); }
.chapcard .eyebrow {
  font-size: 11px; font-weight: 700; letter-spacing: .34em; text-transform: uppercase;
  color: var(--cp-accent); margin-bottom: 12px;
}
.chapcard .big {
  font-size: clamp(38px, 6vw, 82px); font-weight: 700; letter-spacing: -.035em;
  line-height: 1; color: var(--cp-text);
  text-shadow: 0 10px 42px var(--cp-overlay);
}
.chapcard .rule {
  width: 0; height: 2px; margin: 20px auto 0; background: var(--cp-accent);
  animation: rule 2000ms cubic-bezier(.22,1,.36,1);
}
@keyframes rule { 0%,10% { width: 0; } 55% { width: 190px; } 100% { width: 190px; opacity: 0; } }

.badge {
  position: absolute; top: 18px; left: 20px; z-index: 5;
  display: flex; align-items: center; gap: 9px; padding: 8px 14px;
  background: var(--cp-panel); backdrop-filter: blur(12px);
  border: 1px solid var(--cp-border); border-radius: .625rem;
  font-size: 12px; color: var(--cp-text-muted); pointer-events: none;
}
.badge b { color: var(--cp-text); font-weight: 650; }
.badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cp-accent); }

.hint {
  position: absolute; bottom: 16px; left: 20px; z-index: 5;
  font-size: 11px; color: var(--cp-text-soft);
  background: var(--cp-panel); backdrop-filter: blur(12px);
  border: 1px solid var(--cp-border); border-radius: .625rem; padding: 6px 11px;
}
kbd {
  font-size: 10px; background: var(--cp-surface-soft); color: var(--cp-text);
  border: 1px solid var(--cp-border); border-bottom-width: 2px;
  border-radius: 4px; padding: 1px 5px; margin: 0 1px;
}

.tools { position: absolute; bottom: 16px; right: 18px; z-index: 5; display: flex; gap: 6px; }
.tools button {
  width: 32px; height: 32px; border-radius: .625rem; cursor: pointer;
  border: 1px solid var(--cp-border); background: var(--cp-panel-strong);
  color: var(--cp-text); font-size: 14px; line-height: 1;
  backdrop-filter: blur(12px); font-family: inherit;
}
.tools button:hover { border-color: var(--cp-accent); color: var(--cp-accent); }
.tools button.on { background: var(--cp-accent); color: var(--cp-accent-fg); border-color: var(--cp-accent); }

#minimap {
  position: absolute; top: 18px; right: 18px; z-index: 5;
  width: 172px; height: 116px; border-radius: .625rem;
  border: 1px solid var(--cp-border); background: var(--cp-panel);
  backdrop-filter: blur(12px); overflow: hidden; opacity: .92;
}
#minimap rect.vp { fill: var(--cp-accent-soft); stroke: var(--cp-accent); stroke-width: 2; }
#minimap rect.mg { fill: var(--cp-border); opacity: .5; }
#minimap rect.mn { fill: var(--cp-text-muted); }
#minimap rect.mn.on { fill: var(--cp-accent); }

/* ================= cover ================= */

.cover {
  position: fixed; inset: 0; z-index: 30; display: grid; place-items: center;
  background: var(--cp-bg); text-align: center; padding: 30px;
  transition: opacity 900ms ease, visibility 900ms;
}
.cover::before {
  content: ""; position: absolute; inset: -20%;
  background:
    radial-gradient(42% 40% at 30% 26%, var(--cp-accent-soft), transparent 70%),
    radial-gradient(38% 36% at 72% 70%, var(--cp-sheen), transparent 72%);
  animation: drift 20s ease-in-out infinite alternate;
}
.cover.gone { opacity: 0; visibility: hidden; }
.cover .in { position: relative; max-width: 760px; }
.cover .kicker {
  font-size: 11px; font-weight: 700; letter-spacing: .36em; text-transform: uppercase;
  color: var(--cp-accent); opacity: 0; animation: up 800ms cubic-bezier(.22,1,.36,1) 120ms forwards;
}
.cover h1 {
  margin: 18px 0 0; font-size: clamp(34px, 5.6vw, 66px); font-weight: 700;
  letter-spacing: -.035em; line-height: 1.04;
  opacity: 0; animation: up 900ms cubic-bezier(.22,1,.36,1) 260ms forwards;
}
.cover p {
  margin: 20px auto 0; max-width: 540px; font-size: 16px; line-height: 1.6;
  color: var(--cp-text-muted);
  opacity: 0; animation: up 900ms cubic-bezier(.22,1,.36,1) 420ms forwards;
}
.cover .stats {
  display: flex; gap: 34px; justify-content: center; margin: 34px 0 0;
  opacity: 0; animation: up 900ms cubic-bezier(.22,1,.36,1) 560ms forwards;
}
.cover .stat b { display: block; font-size: 30px; font-weight: 700; letter-spacing: -.02em; }
.cover .stat span { font-size: 11px; letter-spacing: .13em; text-transform: uppercase; color: var(--cp-text-soft); }
.cover .go {
  margin-top: 38px; opacity: 0; animation: up 900ms cubic-bezier(.22,1,.36,1) 700ms forwards;
}
.cover .go button {
  padding: 13px 30px; font-size: 14.5px; font-weight: 650; cursor: pointer;
  border-radius: .625rem; border: 1px solid var(--cp-accent);
  background: var(--cp-accent); color: var(--cp-accent-fg); font-family: inherit;
}
.cover .go button:hover { background: var(--cp-accent-hover); }
.cover .go .sub { margin-top: 13px; font-size: 11.5px; color: var(--cp-text-soft); }
@keyframes up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

/* ================= panel ================= */

.panel {
  flex: 1 1 0; min-width: 390px; max-width: 580px;
  display: flex; flex-direction: column;
  background: var(--cp-bg-elevated);
  border-left: 1px solid var(--cp-border);
  box-shadow: var(--cp-shadow); position: relative; z-index: 6;
}
.progress { height: 2px; background: var(--cp-border); }
.progress i { display: block; height: 100%; background: var(--cp-accent); width: 0;
              transition: width 700ms cubic-bezier(.22,1,.36,1); }

.rail { display: flex; gap: 4px; padding: 14px 26px 0; }
.rail .ch { flex: 1 1 0; display: flex; flex-direction: column; gap: 4px; cursor: pointer; min-width: 0; }
.rail .ch .bar { height: 3px; border-radius: 2px; background: var(--cp-border); transition: background 400ms ease; }
.rail .ch.done .bar { background: var(--cp-border-strong); }
.rail .ch.now  .bar { background: var(--cp-accent); }
.rail .ch .nm {
  font-size: 8.5px; letter-spacing: .07em; text-transform: uppercase;
  color: var(--cp-text-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rail .ch.now .nm { color: var(--cp-accent); font-weight: 700; }

.phead { padding: 16px 26px 6px; }
.chapter { font-size: 10.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--cp-accent); }
.ptitle { margin: 7px 0 0; font-size: 26px; line-height: 1.18; font-weight: 650; letter-spacing: -.02em; }

.pbody {
  flex: 1 1 auto; overflow-y: auto; padding: 6px 26px 26px;
  font-size: 14.5px; line-height: 1.66; scrollbar-width: thin;
}
.pbody::-webkit-scrollbar { width: 8px; }
.pbody::-webkit-scrollbar-thumb { background: var(--cp-border); border-radius: 4px; }
.pbody > * { opacity: 0; animation: up 560ms cubic-bezier(.22,1,.36,1) forwards; }
.pbody h3 { font-size: 15px; margin: 22px 0 8px; }
.pbody p { margin: 0 0 13px; }
.pbody ul, .pbody ol { margin: 0 0 13px; padding-left: 20px; }
.pbody li { margin: 5px 0; }
.pbody strong { font-weight: 650; }
.pbody em { color: var(--cp-text-muted); }
.pbody del { color: var(--cp-text-soft); }
.pbody code { font-size: 12.5px; background: var(--cp-surface-soft);
              border: 1px solid var(--cp-border); padding: 1px 5px; border-radius: 4px; }
.pbody a { color: var(--cp-link); }
.pbody blockquote {
  margin: 0 0 14px; padding: 11px 15px; border-left: 3px solid var(--cp-accent);
  background: var(--cp-accent-soft); border-radius: 0 .625rem .625rem 0;
}
.pbody blockquote p:last-child { margin-bottom: 0; }
.pbody table {
  width: 100%; border-collapse: collapse; margin: 0 0 15px; font-size: 13px;
  background: var(--cp-surface); border: 1px solid var(--cp-border);
  border-radius: .625rem; overflow: hidden;
}
.pbody th, .pbody td { border-bottom: 1px solid var(--cp-border); padding: 7px 11px; text-align: left; vertical-align: top; }
.pbody thead th { background: var(--cp-surface-soft); font-weight: 650; font-size: 12px; }
.pbody tbody tr:last-child td { border-bottom: none; }
.pbody hr { border: none; border-top: 1px solid var(--cp-border); margin: 20px 0; }

.pfoot {
  display: flex; align-items: center; gap: 10px; padding: 13px 26px 18px;
  border-top: 1px solid var(--cp-border); background: var(--cp-panel-strong);
}
.pfoot .count { font-size: 12px; color: var(--cp-text-muted); font-variant-numeric: tabular-nums; margin-right: auto; }
.btn {
  padding: 8px 15px; font-size: 13px; font-weight: 600; border-radius: .625rem;
  cursor: pointer; border: 1px solid var(--cp-border);
  background: var(--cp-surface); color: var(--cp-text); font-family: inherit;
}
.btn:hover:not(:disabled) { border-color: var(--cp-border-strong); }
.btn:disabled { opacity: .38; cursor: default; }
.btn.primary { background: var(--cp-accent); color: var(--cp-accent-fg); border-color: var(--cp-accent); }
.btn.primary:hover:not(:disabled) { background: var(--cp-accent-hover); }

@media (max-width: 1150px) {
  .app { flex-direction: column; }
  .panel { max-width: none; min-width: 0; border-left: none; border-top: 1px solid var(--cp-border); flex: 0 0 48%; }
  #minimap { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
`;

// ---------------------------------------------------------------- client js

const JS = String.raw`
const DATA = __PAYLOAD__;
__EDGE_ROUTE__
const diagram = DATA.diagram, story = DATA.story;
// NODE_W / NODE_H come from the inlined edge-route module above.
const ICON = 40;
const NS = "http://www.w3.org/2000/svg";
const $ = function (id) { return document.getElementById(id); };
const el = function (t, a) {
  const n = document.createElementNS(NS, t);
  if (a) for (const k in a) if (a[k] !== null && a[k] !== undefined) n.setAttribute(k, a[k]);
  return n;
};
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- markdown (GFM subset incl. tables) ---------------- */

function md(src) {
  if (!src) return "";
  const esc = function (s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
  const lines = esc(src).split("\n");
  const out = []; let list = null;
  const closeList = function () { if (list) { out.push("</" + list + ">"); list = null; } };
  const inline = function (s) {
    return s
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  };
  const cells = function (raw) {
    let s = raw.trim();
    if (s.charAt(0) === "|") s = s.slice(1);
    if (s.charAt(s.length - 1) === "|") s = s.slice(0, -1);
    return s.split("|").map(function (c) { return c.trim(); });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    if (!line.trim()) { closeList(); continue; }
    if (/^---+$/.test(line.trim())) { closeList(); out.push("<hr/>"); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push("<h3>" + inline(h[2]) + "</h3>"); continue; }
    if (/^&gt;\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i].replace(/\s+$/, ""))) {
        buf.push(lines[i].replace(/\s+$/, "").replace(/^&gt;\s?/, "")); i++;
      }
      i--;
      out.push("<blockquote>" + buf.filter(Boolean).map(function (b) { return "<p>" + inline(b) + "</p>"; }).join("") + "</blockquote>");
      continue;
    }
    if (line.indexOf("|") >= 0 && i + 1 < lines.length) {
      const head = cells(line), delim = cells(lines[i + 1].replace(/\s+$/, ""));
      const isT = head.length > 1 && delim.length === head.length &&
        delim.every(function (c) { return /^:?-+:?$/.test(c); });
      if (isT) {
        closeList();
        const th = head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("");
        const body = []; let j = i + 2;
        for (; j < lines.length; j++) {
          const r = lines[j].replace(/\s+$/, "");
          if (!r.trim() || r.indexOf("|") < 0) break;
          const cs = cells(r);
          body.push("<tr>" + head.map(function (_, k) { return "<td>" + inline(cs[k] || "") + "</td>"; }).join("") + "</tr>");
        }
        out.push("<table><thead><tr>" + th + "</tr></thead><tbody>" + body.join("") + "</tbody></table>");
        i = j - 1; continue;
      }
    }
    const ul = /^[-*+]\s+(.*)$/.exec(line), ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      const want = ul ? "ul" : "ol";
      if (list !== want) { closeList(); out.push("<" + want + ">"); list = want; }
      out.push("<li>" + inline((ul || ol)[1]) + "</li>");
      continue;
    }
    closeList();
    out.push("<p>" + inline(line) + "</p>");
  }
  closeList();
  return out.join("");
}

/* ---------------- geometry ---------------- */

const nodeById = new Map(diagram.nodes.map(function (n) { return [n.id, n]; }));
const edgeById = new Map(diagram.edges.map(function (e) { return [e.id, e]; }));
const groupById = new Map(diagram.groups.map(function (g) { return [g.id, g]; }));

/* ---------------- render ---------------- */

const svg = $("canvas");
const defs = el("defs");
const world = el("g");
svg.append(defs, world);
const LG = el("g"), LE = el("g"), LN = el("g");
world.append(LG, LE, LN);

const groupLabels = [];
for (const g of diagram.groups) {
  const grp = el("g", { class: "gr" });
  grp.dataset.id = g.id;
  grp.appendChild(el("rect", {
    class: "grect", x: g.x, y: g.y, width: g.width, height: g.height, rx: 15,
    fill: g.background || "transparent", stroke: g.border || "#8c959f",
    "stroke-width": 1.5, "stroke-dasharray": g.dashed ? "8 5" : null,
  }));
  // Above the box, as the canvas draws it. Inside the box the title sits in
  // the same space as the components, so a connector often has no way around
  // it and strikes straight through the words.
  const t = el("text", { class: "group-label", x: g.x + 15, y: g.y - 9, fill: g.border || "#57606a" });
  t.textContent = g.label || "";
  grp.appendChild(t);
  groupLabels.push(t);
  LG.appendChild(grp);
}

const flows = [];
const routes = routeAll(diagram.nodes, diagram.edges, {
  // The labels are already in the document, so measure what was actually
  // drawn rather than estimating it. A connector struck through a subgraph
  // title hides the one thing saying what the reader is looking at.
  labels: groupLabels.map(function (t) {
    const b = t.getBBox();
    return { x: b.x - 4, y: b.y - 3, w: b.width + 8, h: b.height + 6 };
  }),
});
for (const e of diagram.edges) {
  const a = nodeById.get(e.from), b = nodeById.get(e.to);
  if (!a || !b) continue;
  const rt = routes.get(e.id) || routeEdge(a, b, e.route, 0);
  const p1 = rt.start, p2 = rt.end;
  const fwd = e.arrow === "forward" || e.arrow === "both" || !e.arrow;
  const bwd = e.arrow === "backward" || e.arrow === "both";
  const col = e.color || "#0969da";
  const mk = function (id, flip) {
    const m = el("marker", { id: id, viewBox: "0 0 10 10", refX: flip ? 1 : 9, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: "auto", markerUnits: "strokeWidth" });
    m.appendChild(el("path", { d: flip ? "M 10 0 L 0 5 L 10 10 z" : "M 0 0 L 10 5 L 0 10 z", fill: col }));
    defs.appendChild(m);
  };
  if (fwd) mk("m" + e.id + "e", false);
  if (bwd) mk("m" + e.id + "s", true);

  const grp = el("g", { class: "ed" });
  grp.dataset.id = e.id;
  const line = el("path", {
    class: "edge-line", d: rt.d, stroke: col, "stroke-width": e.width || 2,
    fill: "none",
    "stroke-linejoin": "round",
    "stroke-dasharray": e.dashed ? "7 5" : null,
    "marker-end": fwd ? "url(#m" + e.id + "e)" : null,
    "marker-start": bwd ? "url(#m" + e.id + "s)" : null,
  });
  grp.appendChild(line);

  // Particles that travel the edge while it is in focus.
  const dots = [];
  for (let k = 0; k < 3; k++) {
    const c = el("circle", { class: "flowdot", r: 3.1, fill: col, cx: p1.x, cy: p1.y });
    grp.appendChild(c); dots.push(c);
  }
  flows.push({ id: e.id, path: line, dots: dots, rev: bwd && !fwd });

  if (e.label) {
    const mx = rt.mid.x, my = rt.mid.y - 8;
    const halo = el("text", { class: "edge-halo", x: mx, y: my });
    halo.textContent = e.label;
    const tx = el("text", { class: "edge-label", x: mx, y: my });
    tx.textContent = e.label;
    grp.append(halo, tx);
  }
  LE.appendChild(grp);
}

for (const n of diagram.nodes) {
  const grp = el("g", { class: "nd" });
  grp.dataset.id = n.id;
  const inner = el("g", { class: "nd-inner" });
  inner.appendChild(el("rect", { class: "node-glow", x: n.x - 4, y: n.y - 4, width: NODE_W + 8, height: NODE_H + 8 }));
  inner.appendChild(el("rect", { class: "node-box", x: n.x, y: n.y, width: NODE_W, height: NODE_H }));
  if (n.iconUri) {
    inner.appendChild(el("image", { href: n.iconUri, x: n.x + (NODE_W - ICON) / 2, y: n.y + 8, width: ICON, height: ICON }));
  }
  const l = el("text", { class: "node-label", x: n.x + NODE_W / 2, y: n.y + 62 });
  l.textContent = n.label || "";
  inner.appendChild(l);
  if (n.sublabel) {
    const s = el("text", { class: "node-sub", x: n.x + NODE_W / 2, y: n.y + 75 });
    s.textContent = n.sublabel;
    inner.appendChild(s);
  }
  grp.appendChild(inner);
  LN.appendChild(grp);
}

/* ---------------- flow particle loop ---------------- */

const hotEdges = new Set();
let t0 = performance.now();
function tick(now) {
  const t = (now - t0) / 1000;
  for (const f of flows) {
    if (!hotEdges.has(f.id)) continue;
    let len = 0;
    try { len = f.path.getTotalLength(); } catch (err) { continue; }
    if (!len) continue;
    for (let k = 0; k < f.dots.length; k++) {
      let u = ((t * 0.34) + k / f.dots.length) % 1;
      if (f.rev) u = 1 - u;
      const p = f.path.getPointAtLength(u * len);
      f.dots[k].setAttribute("cx", p.x);
      f.dots[k].setAttribute("cy", p.y);
    }
  }
  requestAnimationFrame(tick);
}
if (!reduced) requestAnimationFrame(tick);

/* ---------------- camera ---------------- */

let view = { x: 0, y: 0, k: 1 };
let anim = null, manual = false;

function paint() {
  world.setAttribute("transform", "translate(" + view.x + " " + view.y + ") scale(" + view.k + ")");
  drawViewport();
}
const easeInOut = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

function glideTo(target, ms) {
  if (anim) cancelAnimationFrame(anim.raf);
  if (reduced || ms === 0) { view = target; paint(); return; }
  const from = { x: view.x, y: view.y, k: view.k };
  const start = performance.now();
  const dur = ms || 1150;
  const step = function (now) {
    const p = Math.min(1, (now - start) / dur);
    const e = easeInOut(p);
    // Interpolate scale geometrically so the zoom feels linear to the eye.
    const k = from.k * Math.pow(target.k / from.k, e);
    view = { k: k, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
    paint();
    if (p < 1) anim.raf = requestAnimationFrame(step);
  };
  anim = { raf: requestAnimationFrame(step) };
}

function boundsOf(step) {
  const boxes = [];
  const push = function (b) { boxes.push(b); };
  (step.nodes || []).forEach(function (id) {
    const n = nodeById.get(id); if (n) push({ x: n.x, y: n.y, w: NODE_W, h: NODE_H });
  });
  (step.groups || []).forEach(function (id) {
    const g = groupById.get(id); if (g) push({ x: g.x, y: g.y, w: g.width, h: g.height });
  });
  (step.edges || []).forEach(function (id) {
    const e = edgeById.get(id); if (!e) return;
    [e.from, e.to].forEach(function (nid) {
      const n = nodeById.get(nid); if (n) push({ x: n.x, y: n.y, w: NODE_W, h: NODE_H });
    });
  });
  if (!boxes.length || step.all) {
    diagram.nodes.forEach(function (n) { push({ x: n.x, y: n.y, w: NODE_W, h: NODE_H }); });
    diagram.groups.forEach(function (g) { push({ x: g.x, y: g.y, w: g.width, h: g.height }); });
  }
  const minX = Math.min.apply(null, boxes.map(function (b) { return b.x; }));
  const minY = Math.min.apply(null, boxes.map(function (b) { return b.y; }));
  const maxX = Math.max.apply(null, boxes.map(function (b) { return b.x + b.w; }));
  const maxY = Math.max.apply(null, boxes.map(function (b) { return b.y + b.h; }));
  return { minX: minX, minY: minY, w: maxX - minX, h: maxY - minY };
}

function frame(step, ms) {
  const r = svg.getBoundingClientRect();
  const b = boundsOf(step);
  const pad = step.all ? 80 : 165;
  const k = Math.max(.14, Math.min(1.45, Math.min(r.width / (b.w + pad * 2), r.height / (b.h + pad * 2))));
  manual = false;
  glideTo({ k: k, x: r.width / 2 - (b.minX + b.w / 2) * k, y: r.height / 2 - (b.minY + b.h / 2) * k }, ms);
}

/* ---------------- minimap ---------------- */

const mini = $("minimap");
let miniBox = null, miniVp = null;
(function buildMini() {
  const all = [];
  diagram.nodes.forEach(function (n) { all.push({ x: n.x, y: n.y, w: NODE_W, h: NODE_H }); });
  diagram.groups.forEach(function (g) { all.push({ x: g.x, y: g.y, w: g.width, h: g.height }); });
  const minX = Math.min.apply(null, all.map(function (b) { return b.x; })) - 40;
  const minY = Math.min.apply(null, all.map(function (b) { return b.y; })) - 40;
  const maxX = Math.max.apply(null, all.map(function (b) { return b.x + b.w; })) + 40;
  const maxY = Math.max.apply(null, all.map(function (b) { return b.y + b.h; })) + 40;
  miniBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  mini.setAttribute("viewBox", minX + " " + minY + " " + miniBox.w + " " + miniBox.h);
  diagram.groups.forEach(function (g) {
    mini.appendChild(el("rect", { class: "mg", x: g.x, y: g.y, width: g.width, height: g.height, rx: 10 }));
  });
  diagram.nodes.forEach(function (n) {
    const r = el("rect", { class: "mn", x: n.x, y: n.y, width: NODE_W, height: NODE_H, rx: 7 });
    r.dataset.id = n.id;
    mini.appendChild(r);
  });
  miniVp = el("rect", { class: "vp", rx: 8 });
  mini.appendChild(miniVp);
})();

function drawViewport() {
  if (!miniVp) return;
  const r = svg.getBoundingClientRect();
  miniVp.setAttribute("x", (-view.x) / view.k);
  miniVp.setAttribute("y", (-view.y) / view.k);
  miniVp.setAttribute("width", r.width / view.k);
  miniVp.setAttribute("height", r.height / view.k);
}

/* ---------------- highlight ---------------- */

function highlight(step) {
  const hotN = new Set(step.nodes || []);
  const hotG = new Set(step.groups || []);
  const hotE = new Set(step.edges || []);
  hotE.forEach(function (id) {
    const e = edgeById.get(id);
    if (e) { hotN.add(e.from); hotN.add(e.to); }
  });
  const softN = new Set();
  hotG.forEach(function (gid) {
    diagram.nodes.forEach(function (n) { if (n.group === gid) softN.add(n.id); });
  });
  const wide = step.all || (!hotN.size && !hotG.size && !hotE.size);

  hotEdges.clear();
  if (!wide) hotE.forEach(function (id) { hotEdges.add(id); });

  Array.prototype.forEach.call(LG.children, function (g) {
    const on = wide || hotG.has(g.dataset.id);
    g.classList.toggle("hot", !wide && hotG.has(g.dataset.id));
    g.classList.toggle("dim", !on);
  });
  Array.prototype.forEach.call(LN.children, function (n) {
    const id = n.dataset.id, hot = hotN.has(id), soft = softN.has(id);
    const on = wide || hot || soft;
    n.classList.toggle("hot", hot && !wide);
    n.classList.toggle("dim", !on);
    n.classList.toggle("dim-soft", on && !hot && !wide);
  });
  Array.prototype.forEach.call(LE.children, function (e) {
    const hot = hotE.has(e.dataset.id);
    e.classList.toggle("hot", hot && !wide);
    e.classList.toggle("dim", !(wide || hot));
  });
  Array.prototype.forEach.call(mini.querySelectorAll("rect.mn"), function (r) {
    r.classList.toggle("on", !wide && hotN.has(r.dataset.id));
  });
}

/* ---------------- story ---------------- */

const chapters = [];
story.forEach(function (s, i) {
  const last = chapters[chapters.length - 1];
  if (last && last.name === s.chapter) last.end = i;
  else chapters.push({ name: s.chapter, start: i, end: i });
});

const rail = $("rail");
chapters.forEach(function (c) {
  const d = document.createElement("div");
  d.className = "ch";
  d.innerHTML = '<div class="bar"></div><div class="nm"></div>';
  d.querySelector(".nm").textContent = c.name;
  d.addEventListener("click", function () { go(c.start); });
  rail.appendChild(d);
});

let idx = -1;
let playing = false, playTimer = null;

function showChapterCard(name) {
  const card = $("chapcard");
  $("chapname").textContent = name;
  card.classList.remove("show");
  void card.offsetWidth;
  card.classList.add("show");
}

function go(i, opts) {
  const first = idx < 0;
  const next = Math.max(0, Math.min(story.length - 1, i));
  const changedChapter = first || story[next].chapter !== story[idx] ? true : false;
  const prevChapter = idx >= 0 ? story[idx].chapter : null;
  idx = next;
  const s = story[idx];

  if (!reduced && s.chapter !== prevChapter && !(opts && opts.silent)) showChapterCard(s.chapter);

  $("chapter").textContent = s.chapter;
  $("title").textContent = s.title;
  const body = $("body");
  body.innerHTML = md(s.md);
  body.scrollTop = 0;
  Array.prototype.forEach.call(body.children, function (c, j) {
    c.style.animationDelay = Math.min(j * 45, 420) + "ms";
  });
  $("count").textContent = (idx + 1) + " / " + story.length;
  $("badge-sub").textContent = s.chapter;
  $("prev").disabled = idx === 0;
  $("next").textContent = idx === story.length - 1 ? "Replay ↻" : "Next →";
  $("bar").style.width = ((idx + 1) / story.length * 100) + "%";

  Array.prototype.forEach.call(rail.children, function (d, j) {
    const c = chapters[j];
    d.className = "ch" + (idx > c.end ? " done" : (idx >= c.start && idx <= c.end) ? " now" : "");
  });

  highlight(s);
  frame(s, s.hold ? 1500 : 1150);
}

$("next").addEventListener("click", function () {
  if (idx === story.length - 1) { go(0); } else { go(idx + 1); }
});
$("prev").addEventListener("click", function () { go(idx - 1); });
$("zin").addEventListener("click", function () { zoomBy(1.28); });
$("zout").addEventListener("click", function () { zoomBy(1 / 1.28); });
$("zfit").addEventListener("click", function () { frame(story[idx], 800); });
$("play").addEventListener("click", togglePlay);

function togglePlay() {
  playing = !playing;
  $("play").classList.toggle("on", playing);
  $("play").textContent = playing ? "⏸" : "▶";
  clearTimeout(playTimer);
  if (playing) schedule();
}
function schedule() {
  clearTimeout(playTimer);
  if (!playing) return;
  playTimer = setTimeout(function () {
    if (idx >= story.length - 1) { togglePlay(); return; }
    go(idx + 1);
    schedule();
  }, 11000);
}

document.addEventListener("keydown", function (ev) {
  if (!$("cover").classList.contains("gone")) {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); begin(); }
    return;
  }
  const k = ev.key.toLowerCase();
  if (ev.key === "ArrowRight" || ev.key === "PageDown" || ev.key === " ") { ev.preventDefault(); go(idx + 1); }
  else if (ev.key === "ArrowLeft" || ev.key === "PageUp") { ev.preventDefault(); go(idx - 1); }
  else if (ev.key === "Home") go(0);
  else if (ev.key === "End") go(story.length - 1);
  else if (k === "r") frame(story[idx], 800);
  else if (k === "p") togglePlay();
  else if (k === "f") { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }
});

/* ---------------- pan & zoom ---------------- */

function zoomBy(f, cx, cy) {
  if (anim) cancelAnimationFrame(anim.raf);
  const r = svg.getBoundingClientRect();
  const px = cx === undefined ? r.width / 2 : cx;
  const py = cy === undefined ? r.height / 2 : cy;
  const k = Math.max(.07, Math.min(3.4, view.k * f));
  view.x = px - ((px - view.x) / view.k) * k;
  view.y = py - ((py - view.y) / view.k) * k;
  view.k = k; manual = true; paint();
}

svg.addEventListener("wheel", function (ev) {
  ev.preventDefault();
  const r = svg.getBoundingClientRect();
  zoomBy(ev.deltaY < 0 ? 1.13 : 1 / 1.13, ev.clientX - r.left, ev.clientY - r.top);
}, { passive: false });

let drag = null;
svg.addEventListener("pointerdown", function (ev) {
  if (anim) cancelAnimationFrame(anim.raf);
  drag = { sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y };
  svg.setPointerCapture(ev.pointerId);
  svg.classList.add("dragging");
});
svg.addEventListener("pointermove", function (ev) {
  if (!drag) return;
  view.x = drag.vx + (ev.clientX - drag.sx);
  view.y = drag.vy + (ev.clientY - drag.sy);
  manual = true; paint();
});
const endDrag = function () { drag = null; svg.classList.remove("dragging"); };
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);
window.addEventListener("resize", function () { if (!manual && idx >= 0) frame(story[idx], 400); });

/* ---------------- cover ---------------- */

function begin() {
  $("cover").classList.add("gone");
  go(0, { silent: true });
  setTimeout(function () { showChapterCard(story[0].chapter); }, 260);
}
$("begin").addEventListener("click", begin);

// Pre-position on the wide shot so the first move has somewhere to come from.
highlight({ all: true });
frame({ all: true }, 0);
zoomBy(0.82);
manual = false;
`;

// ---------------------------------------------------------------- html

const statCount = [
    { n: diagram.nodes.length, l: "Components" },
    { n: diagram.groups.length, l: "Layers" },
    { n: story.length, l: "Scenes" },
];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(diagram.title || "Architecture")}</title>
<script>
  (() => {
    const param = new URLSearchParams(window.location.search).get("scoutTheme");
    const theme =
      param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  })();
</script>
<style>${CSS}</style>
</head>
<body>

<div class="cover" id="cover">
  <div class="in">
    <div class="kicker">${esc((cover && cover.kicker) || "Architecture Story")}</div>
    <h1>${esc((cover && cover.title) || diagram.title || "Architecture")}</h1>
    <p>${esc((cover && cover.blurb) || "A guided tour of this architecture — what each layer does, why it is there, and how a single request travels all the way through.")}</p>
    <div class="stats">
      ${statCount.map((s) => `<div class="stat"><b>${s.n}</b><span>${s.l}</span></div>`).join("")}
    </div>
    <div class="go">
      <button id="begin">Begin the tour →</button>
      <div class="sub">Use <kbd>←</kbd> <kbd>→</kbd> to navigate · <kbd>P</kbd> autoplay · <kbd>F</kbd> fullscreen</div>
    </div>
  </div>
</div>

<div class="app">
  <div class="stage">
    <svg id="canvas"></svg>
    <svg id="minimap"></svg>
    <div class="chapcard" id="chapcard">
      <div class="inner">
        <div class="eyebrow">Chapter</div>
        <div class="big" id="chapname"></div>
        <div class="rule"></div>
      </div>
    </div>
    <div class="badge"><span class="dot"></span><b>${esc(diagram.title || "Architecture")}</b><span id="badge-sub"></span></div>
    <div class="hint"><kbd>←</kbd><kbd>→</kbd> navigate · drag to pan · scroll to zoom · <kbd>R</kbd> refocus · <kbd>P</kbd> play</div>
    <div class="tools">
      <button id="play" title="Autoplay (P)">▶</button>
      <button id="zin" title="Zoom in">+</button>
      <button id="zout" title="Zoom out">−</button>
      <button id="zfit" title="Refocus (R)">⊙</button>
    </div>
  </div>

  <div class="panel">
    <div class="progress"><i id="bar"></i></div>
    <div class="rail" id="rail"></div>
    <div class="phead">
      <div class="chapter" id="chapter"></div>
      <h1 class="ptitle" id="title"></h1>
    </div>
    <div class="pbody" id="body"></div>
    <div class="pfoot">
      <span class="count" id="count"></span>
      <button class="btn" id="prev">← Back</button>
      <button class="btn primary" id="next">Next →</button>
    </div>
  </div>
</div>

<script>${JS.replace("__PAYLOAD__", () => payload).replace("__EDGE_ROUTE__", () => ROUTE_SRC)}</script>
</body>
</html>
`;

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, html, "utf8");
const bytes = Buffer.byteLength(html, "utf8");
say(`wrote ${outPath} (${(bytes / 1024).toFixed(0)} KB)`);
await finish(0, { out: outPath, icons: inlined, missingIcons: [...missing], scenes: story.length, bytes });
