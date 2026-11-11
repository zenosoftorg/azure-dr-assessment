# Notices

This repository bundles company patterns and wraps two units copied from the owner's personal Copilot configuration. Each unit's provenance is recorded below. Customer data is never committed here.

## Microsoft icons

The Microsoft architecture icon sets are not part of this repository. `skills/azure-dr-assessment/scripts/fetch-icons.mjs` downloads them from Microsoft into a local cache the first time they are needed. Microsoft's terms (Azure Architecture Center, "Download Azure icons", reviewed 2026-11-04):

> Microsoft permits the use of these icons in architectural diagrams, training materials, or documentation. You can copy, distribute, and display the icons only for the permitted use unless granted explicit permission by Microsoft. Microsoft reserves all other rights.

Generated diagrams and presentations are architectural diagrams. Committing the icon files would distribute them outside that use, so they stay out of Git until the owner's legal check allows vendoring.

## Vendored: architecture-canvas extension

- Source: the owner's personal copy of the architecture-canvas extension, copied on 2026-11-04.
- Included: `extension.mjs`, `lib/`, `web/` and `scripts/` (15 files). Excluded: the `Final SVG Icons/` folder (see "Microsoft icons" above) and `.DS_Store`.
- Changes: `tests/fixtures/vendored-canvas.sha256` holds the SHA-256 of every file and a test fails when one changes. Numbered changes since the copy (the numbering continues the list of the presentation builder below):
  - P-8: `extension.mjs` no longer calls `store.ensureDir()` at start-up. The original created an empty `architectures/` folder in the working directory of every session, also in customer folders. `DiagramStore` already creates the folder on the first save and lists a missing folder as empty, so the actions and the diagram files are unchanged. The owner's personal copy of `extension.mjs` has the same line.
- Use: the pipeline imports `lib/store.mjs`, `lib/icons.mjs`, `lib/config.mjs`, `web/layout.mjs` and `web/edge-route.mjs` in plain Node. `extension.mjs` is the optional canvas viewer and editor, installed with the app's extension installer from `extensions/architecture-canvas`.
- Ownership and licence: to be confirmed by the owner before the first release (release gate R1). After vendoring, this repository's copy is the source of truth and the personal copy may drift.

## Vendored: architecture-presentation skill

- Source: the owner's personal copy of the architecture-presentation skill, copied on 2026-11-04.
- Included: `SKILL.md` and `scripts/build-presentation.mjs`. Excluded: `.DS_Store` and an empty `architectures/` folder.
- Changes, all in `scripts/build-presentation.mjs` (plus the matching documentation edits in `SKILL.md`):
  1. CLI: `<diagram.arch.json> <story.mjs> <out.html> [--icon-root <dir>] [--json]` with exit codes 0, 1, 2, 3 and 4. With `--json` the only stdout is one JSON line.
  2. The canvas library root is resolved from `<repo>/extensions/architecture-canvas`, then `$COPILOT_HOME/extensions/architecture-canvas`; exit 3 when neither exists.
  3. Icons come from the on-disk icon catalog instead of a canvas server. Only icons that were read are counted, and a build with none refuses (exit 4, `zero-icons`). The original counted failed lookups as inlined and exited 0.
  4. `buildStory(diagram, helpers)` receives `node`, `group` and `edge` helpers that record every unresolved label. Any miss refuses the build (exit 4, `unresolved-labels`) with the full list, and the returned scenes are validated.
  5. The calls that inject the payload into the page use function replacers. The original corrupted story text that contained `$&` or `$$`.
  6. The window `resize` handler does nothing until the first scene is shown. The original called `frame(story[-1])` on the cover and threw a TypeError, and headless Chrome fires a resize after the page loads, so the browser check failed at random.
  7. The markdown renderer of the page escapes a double quote as `&quot;`, like `&`, `<` and `>`. The original left it as it was, so a link address that held a double quote ended the `href` attribute and the rest of the address became attributes of the link, such as an `onmouseover`.
- After vendoring, this repository's copy is the source of truth and the personal copy may drift.

## Derived data: ARI sheet map

- `skills/azure-dr-assessment/assets/ari-sheet-map.json` is derived from the worksheet names and Azure resource type names used by [microsoft/ARI](https://github.com/microsoft/ARI) (Azure Resource Inventory) at commit `4cc602c36f64ad26eb2bad920a9cae04ac0dd43e` (2026-10-17): the `-WorksheetName` and `$SheetName` literals and the resource types read by the 86 modules under `Modules/Public/InventoryModules/`, the report sheet names of `Modules/Private/3.ReportingFunctions/`, and the column names that identify a resource in the few sheets that do not use `Name`. No ARI code is copied.
- microsoft/ARI is published under the MIT License, reproduced here because its names are used:

> MIT License
>
> Copyright (c) 2020 RenatoGregio
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
