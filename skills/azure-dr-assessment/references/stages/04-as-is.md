# Stage 4: As-is architecture

Draw the workload as the evidence shows it, and say what is inferred and what is unknown. Scripts list the evidence and build the diagram and the presentation. You decide what belongs to the workload and how it is grouped.

## List the resources

```bash
node skills/azure-dr-assessment/scripts/resources.mjs --assessment dr-assessment/checkout/assessment.yaml
```

One short row per in-scope resource: its name, ARM type, resource group, location, SKU and zones, and `id`, the ledger fact that names it. Page with `--limit` and `--offset`, and narrow with `--type` or `--resource-group`. Never read the raw workbook and never `inventory.json` in full.

The facts of one resource, with their ids, come from the ledger. `--subject` is the resource's `ref` from the list, matched exactly:

```bash
node skills/azure-dr-assessment/scripts/ledger.mjs list --ledger dr-assessment/checkout/evidence/ledger.json --subject "ari:SQL DBs!3"
```

## Decide what the workload is

1. Start from the scope that intake settled. Group the resources by resource group and by role (entry, compute, data, security, networking).
2. A grouping that is your own judgement is labeled **Inferred**: use the group style `inferred` for it, and `primary` for a group the inventory itself shows, such as a resource group in the primary region.
3. A resource that the owner tells you about but the inventory does not list is drawn only with a ledger fact that records the statement:

   ```bash
   node skills/azure-dr-assessment/scripts/ledger.mjs add-fact --ledger dr-assessment/checkout/evidence/ledger.json --strength Inferred --subject orders-queue --claim "the checkout also uses an orders queue that the export does not list" --basis "owner statement" --source-type owner --source-detail "decisions[0]"
   ```

   Stage 3 starts a new ledger on every run, so an owner's correction is lost on a rerun unless you add it again. At the start of this stage, add one such fact for each entry of `decisions` in `assessment.yaml` that corrects or confirms the current-state picture. `--source-detail` names the entry. When the owner sends a correction after the pause, record it under `decisions` first, then add the fact.

   Record what you could not find out as an Unknown fact (`--strength Unknown`, `--source-type ari-xlsx`), for example a property the export lacks.
4. Draw a link only with a basis. An **observed** link needs a fact that was read from the inventory, such as a virtual machine's subnet or an App Service's plan. An **inferred** link needs a stated basis: an owner statement, or a documented rule for the service. Never infer a dependency or a data flow from names or co-location. If you cannot give a basis, leave the link out and list the question as unknown.
5. Keep the picture small enough to read: one node per component or tightly coupled set, and a group per region or tier. A resource that no group needs sits outside the groups.
6. A function app and a web app have the same ARM type, `microsoft.web/sites`, so the icon table draws both as an App Service. When the resource's `kind` fact (`ledger.mjs list --subject <ref>`) contains `functionapp`, set the node's `icon` to `azure:function-apps` and keep its `armType`.

## Write the diagram spec

Write `dr-assessment/checkout/architectures/checkout-current-state.spec.json` from this run's ledger. Never copy or edit a spec from an earlier run: its `F-` ids were numbered again by the last ingest. The id of the diagram is the file name without `.spec.json`.

```json
{
  "schemaVersion": 1,
  "kind": "current-state",
  "id": "checkout-current-state",
  "title": "checkout · current state (westeurope)",
  "direction": "LR",
  "groups": [
    { "key": "primary", "label": "Primary · westeurope", "parent": null, "style": "primary", "evidence": ["F-0003"], "annotation": "" }
  ],
  "nodes": [
    { "key": "web", "label": "web-checkout", "sublabel": "App Service · P1v3", "armType": "microsoft.web/sites", "icon": null, "group": "primary", "evidence": ["F-0021"], "decisions": [], "annotation": "" }
  ],
  "edges": [
    { "from": "web", "to": "db", "label": "SQL", "kind": "inferred", "basis": "owner statement", "evidence": ["F-0053"], "mechanism": null, "arrow": "forward", "annotation": "" }
  ]
}
```

The ids above only show the shape: use the ids from your own ledger.

| Field | Rule |
|---|---|
| `label` | Unique among nodes and among groups, at most 60 characters. Labels are how the story finds things. |
| `armType` | The ARM type exactly as `resources` shows it. A type the icon table does not know gets a generic icon, which the build reports. |
| `evidence` | At least one `F-` id whose strength is Observed or Inferred. An Unknown fact alone does not justify a node. A node that stands for a resource cites the `id` that `resources` gave. |
| `decisions` | Empty in a current-state spec. |
| Edge `kind` | `observed` or `inferred`. An edge without a basis is rejected, not drawn. |
| Group `style` | `primary`, `inferred` or `neutral`. |

## Build the diagram

```bash
node skills/azure-dr-assessment/scripts/build-diagram.mjs --spec dr-assessment/checkout/architectures/checkout-current-state.spec.json --ledger dr-assessment/checkout/evidence/ledger.json
```

Exit 2 lists every problem with its path: fix the spec and rerun. Read `genericIcons` and `closestIcons` in the result: they name the nodes whose icon is a fallback, and the node's annotation says so. If intake printed a `banner`, the pattern pack is not the company pack: run `node skills/azure-dr-assessment/scripts/resolve-patterns.mjs --assessment dr-assessment/checkout/assessment.yaml` and add `--resolution dr-assessment/checkout/evidence/pattern-resolution.json` to the build, so the diagram title carries the banner.

The diagram is an architecture-canvas file. It opens in the canvas unchanged.

## Presentation 1

1. Copy `skills/azure-dr-assessment/assets/templates/story.current-state.mjs` to `dr-assessment/checkout/presentations/checkout-current-state.story.mjs`. The name must be `<id>.story.mjs`.
2. Write `presentations/checkout-current-state.story-data.json` next to it:

   | Field | Content |
   |---|---|
   | `schemaVersion` | `1` |
   | `cover` | `title` and `blurb`; `kicker` is optional. When there is a banner, put it in the blurb. |
   | `regionMismatch` | `null`, or `{ "title", "md" }` when the ingest summary's `regionCheck.status` is `mismatch`: say which region was declared and where the in-scope resources are. The declared region stays in force. |
   | `unknowns` | `{ "title", "md" }`: a list of what the evidence does not say, including every sheet that was not assessed and every Unknown fact that matters. |
   | `groups` | One entry per diagram group: `group` (the label of the diagram group), `md` (the narration) and, optionally, `title`, `nodes` (labels) and `edges` (`[from label, to label]` pairs) to emphasize. |

   The inferred links, the overview and the component tables are generated from the diagram, so the story cannot say more than the evidence does.
3. Build it:

   ```bash
   node skills/azure-dr-assessment/scripts/present.mjs --story dr-assessment/checkout/presentations/checkout-current-state.story.mjs
   ```

   Exit 4 with `unresolved-labels` lists every label the story uses that the diagram does not have: fix the data file and rebuild once. If the second build also fails, do not deliver the presentation, and say so in the report and in the chat summary (stage 7). Exit 2 with a message that the story data holds text that looks like a secret: the details name the path of each string, never the text. Remove that text from `presentations/checkout-current-state.story-data.json` and build again; the presentation was not built. Exit 4 with `zero-icons` means the icon library is empty: the presentation is not built, and the diagram, the report and the runbook do not depend on it. Run `node skills/azure-dr-assessment/scripts/fetch-icons.mjs` or pass `--icon-root`, then build again. Exit 3 means the canvas library is missing: say so and continue with the Markdown report.

## Pause

If `assessment.yaml` sets `options.pause_after_current_state` (intake's `--pause-after-current-state`), stop after this stage. Tell the owner to open `presentations/checkout-current-state.html`, check the inferred links and the unknowns, and send corrections. Record them under `decisions` in `assessment.yaml` (and as ledger facts), then rerun from this stage.

## Never

- Draw a resource, link or dependency without evidence or a recorded owner statement.
- Label an inference Observed.
- Read the whole inventory into the conversation.

## Done when

`build-diagram` exits 0, `present` exits 0 or you have said why the presentation was withheld, every node cites a fact, every inferred link states its basis, and you can say in one sentence what the diagram does not show.
