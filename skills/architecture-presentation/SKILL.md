---
name: architecture-presentation
description: "Turn an architecture canvas diagram (.arch.json) into a single self-contained, cinematic HTML presentation that tells the story of the architecture. Use this skill whenever the user asks to present, narrate, walk through, tell the story of, demo, or hand over an architecture — including phrasings like 'make a presentation of this canvas', 'turn this diagram into slides', 'build an HTML walkthrough', 'I need to present this to the customer', or 'export this as a story'. Also use when refreshing an existing presentation after the diagram changed. Do NOT use for plain SVG/Visio/PNG export of a diagram, for PowerPoint decks, or for architectures that do not exist as an .arch.json."
---

# Architecture canvas → cinematic HTML presentation

## Overview

Generate one self-contained HTML file that narrates an architecture: the diagram
fills the left two-thirds and drives itself — panning, zooming and spotlighting —
while markdown commentary runs down the right third.

The file embeds everything (icons as data URIs, CSS, JS). It opens from disk,
works offline, and can be emailed or dropped in SharePoint as a single artifact.

**The split that makes this maintainable:**

| Piece | Lives in | Changes when |
| --- | --- | --- |
| Renderer (camera, highlighting, layout, markdown) | `scripts/build-presentation.mjs` in this skill | Rarely — it is diagram-agnostic |
| Narrative (scenes, prose, focus) | `presentations/<name>.story.mjs` | Every time you tell a different story |
| Diagram | `architectures/<name>.arch.json` | When the architecture changes |

Never fork the renderer to tell a new story. Write a new story module.

## Procedure

### Step 1 — Have the icon library

Icons are read from the on-disk icon library (the `Final SVG Icons` folder), which
is the only place the icon ids (`azure:foundry-agent-service`, `power:agent365`, …)
get turned into SVG. In the azure-dr-assessment repository run
`node skills/azure-dr-assessment/scripts/fetch-icons.mjs` once. The builder finds the
library through `--icon-root`, `ARCH_CANVAS_ICON_ROOT`, or the canvas extension's
default locations.

The build refuses (exit code 4, `zero-icons`) when no icon could be read, because a
presentation with no icons is a broken deliverable. A few missing icons only warn.

### Step 2 — Write the story module

Create `presentations/<diagram-id>.story.mjs`:

```js
export const cover = {
    kicker: "Architecture Story",
    title: "…",
    blurb: "One or two sentences that earn the next click.",
};

export function buildStory(diagram) {
    const node  = (l) => diagram.nodes.find((x) => x.label === l).id;
    const group = (l) => diagram.groups.find((x) => x.label === l).id;
    const edge  = (a, b) => { /* find by endpoint pair */ };

    return [
        {
            chapter: "Overture",          // groups scenes; drives the chapter card
            title: "An estate, not an agent",
            all: true,                    // wide shot, nothing dimmed
            hold: true,                   // slower camera move, for a beat
            md: `…markdown…`,
        },
        {
            chapter: "Governance",
            title: "One front door",
            nodes: [node("APIM AI Gateway")],
            groups: [group("Gateway & Governance · MCP · API · Models")],
            edges: [edge("Foundry Agent Service", "APIM AI Gateway")],
            md: `…markdown…`,
        },
    ];
}
```

**Resolve by label, not id.** Node ids (`n_ggr1r8v`) are generated and change if
an element is recreated; labels are what the author actually maintains. Resolve
eagerly so a renamed component fails the build loudly instead of silently
producing a scene that highlights nothing.

The builder passes a second argument `h` with `h.node(label)`, `h.group(label)` and
`h.edge(fromLabel, toLabel)`. Prefer it to local helpers: each returns the id (or
null) and records every miss, so one build lists all unresolved labels instead of
stopping at the first.

**Scene fields**

| Field | Effect |
| --- | --- |
| `chapter` | Groups scenes. A change triggers the full-stage chapter card. |
| `title` | Scene heading in the panel. |
| `nodes` / `groups` / `edges` | What is in focus. Everything else blurs back. |
| `all: true` | Wide shot, nothing dimmed. Use for openers and finales. |
| `hold: true` | Slower camera move — use when the point deserves a beat. |
| `md` | Markdown body. Tables, blockquotes, `~~strike~~`, lists, headings. |

The renderer derives the camera from whatever a scene focuses, so you never
specify coordinates. Focusing an edge implicitly focuses both endpoints;
focusing a group soft-focuses its members.

**Edge routing is read from the diagram**, not the story. Connectors are
straight by default. If the author wants right-angled ones, set them on the
canvas — `auto_layout` with `route: "orthogonal"` — and rebuild; orthogonal
connectors are routed around the components and given their own attachment
points and lanes, so they neither cut through a box nor collapse onto one
another. Do not switch a diagram to orthogonal unasked. The presentation, the
SVG export and the Visio export all share one routing module, so they never
disagree.

### Step 3 — Build

```bash
node skills/architecture-presentation/scripts/build-presentation.mjs \
  architectures/<name>.arch.json \
  presentations/<name>.story.mjs \
  presentations/<name>.html \
  [--icon-root <dir>] [--json]
```

Expect output like `inlined 23 icons` / `story: 17 scenes` / `wrote … (192 KB)`. Only icons
that were actually read are counted. Exit codes: 0 ok, 1 usage, 2 input unreadable or
invalid, 3 canvas library missing, 4 refused. With `--json` the only stdout is one JSON
line, for example `{"ok":false,"code":4,"reason":"unresolved-labels","unresolved":[…]}`.

### Step 4 — Verify in a browser

Do not hand over a presentation you have not watched. Drive it headlessly and
assert the things that silently break:

- The cover appears, and **Begin** dismisses it
- The camera transform actually *changes* between scenes
- Focused scenes produce `.nd.hot` elements and dimmed `.nd.dim` ones
- Markdown tables and blockquotes render (`#body table`, `#body blockquote`)
- Flow particles exist on focused edges (`.ed.hot .flowdot`)
- Zero console errors
- `?scoutTheme=dark` renders correctly

A scene that highlights nothing usually means a label in the story no longer
matches the diagram.

## Writing the narrative

The diagram already says *what*. The story exists to say **why**, and to be
honest about trade-offs. A presentation that only restates node labels is worse
than the diagram alone, because it takes longer.

**Structure that works**

1. **Overture** — the problem, and the shape of the answer. Earn the next click.
2. **Layer by layer** — follow the flow, not the org chart.
3. **The pivotal integration** — most architectures have one decision everything
   else hangs off. Give it a whole scene and let it breathe with `hold: true`.
4. **End to end** — trace one concrete request through every layer. This is the
   scene people remember.
5. **Finale** — sequencing, and three ideas worth keeping.

**Make it educational**

- Name the failure each component prevents, not just its features
- Put trade-offs in tables — they scan, and they look considered
- Use `>` callouts for the thing you would say out loud in the room
- Flag the traps: *"the usual first stumble is…"*
- `~~strikethrough~~` is excellent for showing what an approach **deletes**

**Keep each scene to one idea.** If a scene needs two tables and four
paragraphs, it is two scenes.

## Viewer controls

Worth mentioning when handing over: `←` `→` navigate, `P` autoplay, `F`
fullscreen, `R` refocus, drag to pan, scroll to zoom, and the chapter rail
jumps directly.

## Gotchas

| Symptom | Cause |
| --- | --- |
| Exit 4 `zero-icons` | Icon library missing: run `fetch-icons`, or pass `--icon-root` |
| Exit 4 `unresolved-labels` | A label in the story no longer matches the diagram; the JSON lists every one |
| Scene highlights nothing | A story written with its own helpers resolved a group or edge to nothing; use `h` so the build lists it |
| Camera barely moves | Scene focuses almost the whole diagram; narrow it or use `all: true` |
| Everything dim | A scene lists only ids that no longer exist |

**Regenerate after every diagram change.** The HTML is a build artifact — the
`.arch.json` and the story module are the sources. Commit all three.

## Theme

The output follows the Clawpilot theme — CSS variables for light and dark, with
a theme-detection script honouring `?scoutTheme=` and `prefers-color-scheme`.
Diagram colours (group borders, edge colours) come from the diagram data and are
intentionally preserved; everything else must use `var(--cp-*)`.
