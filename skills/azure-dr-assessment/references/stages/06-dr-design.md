# Stage 6: DR design

Decide every slot of the DR design, draw it, and tell it as a walkthrough. The pattern engine proposes a candidate for each slot and checks your decisions. You make the judgement calls and write them down with their sources.

## Start the resolution

```bash
node skills/azure-dr-assessment/scripts/resolve-patterns.mjs --assessment dr-assessment/checkout/assessment.yaml
```

This writes `evidence/pattern-resolution.json`: one row per decision slot, each with a `candidate`. Read the summary: `gatesOpen` must be 0 (intake closed the gates), `collisions` lists slots where two approved patterns claim the same slot, `openInputs` lists values a pattern needs from the application team, and `rejectedOverrides` lists override entries that were refused with their reasons. Rerunning the command starts a new resolution and discards decisions you have written, so run it once, at the start of this stage.

## The candidate binds you

Per slot, in this order, the first that applies wins: Azure reality, a valid override, the company pattern, the service playbook, Microsoft Learn. The engine has already done the second and third step. Your decision must come from the candidate, with one exception, Azure reality.

| Candidate | What you do | `source` and `ref` |
|---|---|---|
| `pattern` | Read the pattern file in `skills/azure-dr-assessment/patterns/<ID>.md` and follow its Required behavior, Diagram elements, Runbook steps and Verification. Microsoft Learn does not replace it: where Learn proposes something else, name that as a documented alternative that is not applied. | `pattern`, `<ID> v<version>` |
| `override` with an `alternative` | The override is a documented exception. Apply its `alternative`, and say that the design departs from the pattern. | `override`, `Override #<n> of <ID>` |
| `override` without an `alternative` | The pattern is waived for its slots and nothing replaces it. Decide from Microsoft Learn as for a `learn` candidate, but keep the source `override`: the report derives the source from the candidate. Name the Microsoft Learn documents you used in `ref`, and list their `D-` ids in `ledger`. Record a page you read in this stage with `ledger.mjs add-doc` first, so that it has a `D-` id. | `override`, `Override #<n> of <ID>; Learn: <document titles>` |
| `learn`, and the slot holds types of `evidence/dr-options.json` | Write the decision from the DR options of those types (see "From the DR options to the decision"). When a service playbook supplied the options, the source is `playbook` with the ref `playbook <service> v<version>` of the playbook of the first such type in `dr-options.json` order; name the other playbooks in `text`. When the options are Learn-derived (`option` entries), the source is `learn`. List the ledger ids of the options in `ledger`. | `playbook`, `playbook <service> v<version>`; or `learn` |
| `learn` | Decide from the Microsoft Learn pages of stage 5 (and more you read now), the evidence and the tier's design rules. Record a page you read now with `ledger.mjs add-doc` before you cite it, so that it has a `D-` id for `ledger` and for section C of the report. | `learn` |
| A collision (`status` is `unresolved`) | Record it as Unresolved, name both patterns, and carry on with the other slots. Never choose between the patterns. If `decisions` in `assessment.yaml` holds the owner's answer for this slot, quote it in `text` with who and the date: the report shows it. Name both patterns and ask for the resolution in these words: a `supersedes` link between the patterns, or a decision recorded under `decisions[]` in `assessment.yaml`. A decision recorded in `assessment.yaml` `decisions[]` documents the owner's choice; the slot stays Unresolved in the resolution file until a `supersedes` link removes the collision, and the row stays Unresolved even when a decision is quoted, because the validation allows nothing else for a collision. Slots that the collision does not touch continue to be designed. | any |
| Azure reality vetoes the candidate | The stage 5 findings show that the mechanism cannot work for these regions, such as a paired-only mechanism when the DR region is not the primary's pair. Record an Unmet requirement with the reason, and propose a substitute in the order of stage 5. | `azure-reality`, the `R-` id of the finding |

### From the DR options to the decision

Each in-scope type has a row in `evidence/dr-options.json` with its `slot`, its options and its `choice` from `dr_choices` (stage 5b). The chosen option governs the type; when a row has no valid choice, take its `recommended` option and say that it is not the owner's choice. A type that a pattern or an override decides (`decidedBy`) follows its candidate as above, and its options are not used.

- **Several types in one slot.** Two storage accounts and a file share share `data-replication.storage`: the decision text names each type with its option, such as "Storage accounts: object replication to germanywestcentral (owner's choice); File share: a second share in germanywestcentral filled by a scheduled copy (default)".
- **Native, workaround, backup-restore.** The option's target is the DR region. A backup-restore option recovers by restoring there; it is drawn as a `failover` edge.
- **Split-region.** The service recovers into its own pair, a third region, through its paired-only mechanism. It is never DR coverage in the DR region: say that the DR region's consumers read across regions from the pair, and give the residency result of the pair. When `--validate` listed a residency warning for it, it is a residency Gap.
- **A slot that a pattern decides.** An option that names the slot in its `Decides slots` is vetoed by `dr-options --classify` (GC-11): it is in the row's `vetoed` list, never its target. When DR-DNS-001 decides `traffic-dns`, App Service's `secondary-app` (Front Door) is vetoed and `secondary-app-dns` is the recommendation: the second app behind the company's DNS, whose traffic switch is the on-prem record change with the TTL counting toward the RTO. The guide takes that option's steps. An owner who chose `secondary-app` before is asked again, because the recorded choice is now invalid.
- **Accept the gap.** The type stays an Unmet requirement in its slot, with the reason. When an owner chose it, it is also a documented exception (`dr-choice-gap` in `documentedExceptions`, section D and the diagram); a default is not, because an exception needs an owner.
- **The tier still applies.** Run the tier Verification on the result. A chosen option that does not meet the tier is a Gap that names the type and the option; the choice never hides it.
- **An override without an `alternative`** keeps the source `override`; its content may come from the playbook's options, as from Learn.

The decision goes into the `decision` field of the slot row in `evidence/pattern-resolution.json`:

```json
{ "text": "Change the on-prem DNS record at failover", "source": "pattern", "ref": "DR-DNS-001 v1", "status": "Resolved", "azureReality": "no veto", "ledger": ["R-0004"], "alternative": null }
```

| Field | Rule |
|---|---|
| `status` | `Resolved`, `Unresolved` or `Unmet requirement`. |
| `text` | What the design does, in one or two sentences. Required for Resolved. |
| `azureReality` | What the stage 5 findings say about this slot. Write `no veto` when they say nothing against the decision. An Unmet requirement needs this or `alternative`. |
| `ledger` | The ledger ids that support the decision. |
| `alternative` | For an Unmet requirement: the proposed substitute, labeled Proposed in the report, or null when there is none. |

Only the `decision` of each slot row is yours. Leave `candidate`, `status` and `collision` of the rows, and `patterns`, `overrides`, `documentedExceptions`, `gates`, `openInputs` and `banner`, as `resolve-patterns` wrote them: the validation checks the candidate and the status of each row, and section D of the report is built from the rest.

Check your work until it exits 0:

```bash
node skills/azure-dr-assessment/scripts/resolve-patterns.mjs --validate dr-assessment/checkout/evidence/pattern-resolution.json
```

The check refuses a missing decision, a Resolved decision without text or source, a decision that ignores its candidate, a `playbook` decision on a candidate that is not `learn` or without the ref `playbook <service> v<version>`, and a ledger id that does not exist.

## The slots

| Slot | What the decision covers |
|---|---|
| `objectives` | The tier, its pattern, RPO and RTO, and any recorded exception. |
| `traffic-dns` | How users reach the recovery region and who changes what at failover. |
| `ingress` | The entry point to each region: gateways, load balancers, WAF. |
| `compute` | How compute exists in the DR region: running, minimal, or recreated. |
| `data-replication.relational`, `.nosql`, `.storage`, `.messaging`, `.vm-disks`, `.cache` | The mechanism for each class of data service, from the stage 5 findings. |
| `secrets-keys` | Where secrets and keys live in the DR region and how they stay current. |
| `identity` | Sign-in and access in the DR region. |
| `backup` | Backups, their isolation and cross-region restore. |
| `connectivity` | Network paths, private endpoints and DNS between the regions and on-prem. |
| `detection` | How a regional failure is detected. |
| `failover-approval` | Who decides failover and failback. You record the role; you never approve or run anything. |
| `testing` | How recovery is rehearsed and measured. |

A type's slot is the `slot` of its row in `evidence/dr-options.json`: the playbook's slot, or the slot of its `option` entries. A type with a null slot is named in the decision of the slot its role fits best, with the reason.

## Tier rules and honesty

- Apply the design rules and the Verification checks of DR-TIER-001 for the tier. Then run the Verification section of every other approved pattern that applies to this workload against the finished design, including slots that pattern does not decide. A check that fails is a Gap in the report that names the weakest link and cites the pattern and its version. Name the failed check by its number: the position of its bullet in that pattern's Verification section, counted from 1 (the Tier 1 check of DR-TIER-001 v1 is `DR-TIER-001 v1 check 6`), and quote the check's wording from the pattern. This holds when you review a proposal against a pattern, too: the answer never says only that the pattern is not met. In the establishment guide, a check that fails goes on a line of its own under the script's Target lines: `establishment-guide` writes the Option, Source, Chosen by, Estimated RPO and RTO, and Tier lines from `evidence/dr-options.json`, and they stay as written (stage 7). When two patterns disagree about the same design, the Gap names both IDs and versions, and you never rewrite another pattern's decision.
- An override waives the pattern for the slots it names, whether or not it has an `alternative`, yet the pattern still has `applied: true` in the resolution. Read its Verification section twice: skip every check that tests a waived slot, because the pattern is off there and the check would raise a false Gap, and run the checks of its other slots. Keep a list of the skipped checks for the report, each as `Not checked: waived by Override #<n>` with the pattern ID and version. `<n>` is the number that the Documented exceptions table gives the override (its `index` in `overrides` of the resolution).
- Label every RPO and RTO **Estimated** until a drill record shows it as Demonstrated. Name the weakest component. When the DNS step is a manual record change, it is the weakest link of a near-zero RTO: say so and do not change the tier.
- Tier 0 has no numeric band in DR-TIER-001. When the owner gave an RTO or RPO for it, that number is the owner's definition of "near zero": test it against the stage 5 findings (the distance between the regions, the replication mechanism, the DNS step) and label the result Estimated. When no number was given, say that "near zero" cannot be tested and list it as an open input.
- State cost only as the tier's planning ratio from DR-TIER-001, never as a price.
- A value that a pattern says the application team supplies (for DR-DNS-001: record type, TTL, record owner role, private-zone integration) is written as "not supplied by the application team" and listed as an open input. Never guess it.

## Draw the DR diagram

Write `dr-assessment/checkout/architectures/checkout-proposed-dr.spec.json` with `"kind": "proposed-dr"`. The shape is that of stage 4 with these differences:

| Field | Rule |
|---|---|
| Groups | Use the styles `primary`, `dr`, `global`, `onprem` and `neutral`: the primary region, the DR region, global services, on-prem systems such as the company DNS, and the rest. The builder adds the group `Documented exceptions`; do not draw it, and do not use that label. |
| Split-region | A split-region choice gets a third region group with the style `split`, labelled `split: <service> only (<region>)`, such as `split: Key Vault only (swedensouth)`, holding the service's nodes in its pair; a `dependency` edge from the consumer in the DR region to it, labelled with the cross-region path; and the residency result in the group's annotation. The builder refuses a `split` group whose label does not start with `split: `. |
| Backup-restore | The restore path is a `failover` edge to the restored service in the DR region, with the mechanism `restore from <backup mechanism>`. |
| Node `evidence` and `decisions` | Cite ledger ids (`F-`, `D-` or `R-`) and the slots the node implements. A node needs at least one of them. |
| Edge `kind` | `replication`, `traffic`, `failover`, `dependency` or `observed`. |
| Edge `label` and `mechanism` | Both required. The mechanism names how, such as `SQL Database active geo-replication`. |
| Pattern shapes | Draw what the applied patterns' Diagram elements ask for. For DR-DNS-001 that is the on-prem DNS in its own group, a traffic edge to the primary and a failover edge labeled "change on-prem DNS record" to the DR region, and no Traffic Manager node. The label of that edge, and of any edge of a decision from DR-DNS-001, shows the pattern's inputs as supplied, for example `change on-prem DNS record: CNAME, TTL 300 s`, or `change on-prem DNS record: record type, TTL: not supplied by the application team` when they are not (when only one is missing, write that one as `not supplied by the application team`). The annotation may repeat them, but it never replaces the label. |

Build it. The resolution must be complete and valid first:

```bash
node skills/azure-dr-assessment/scripts/build-diagram.mjs --spec dr-assessment/checkout/architectures/checkout-proposed-dr.spec.json --ledger dr-assessment/checkout/evidence/ledger.json --resolution dr-assessment/checkout/evidence/pattern-resolution.json
```

Exit 2 lists every problem: an incomplete resolution, a decision that ignores its candidate, a slot that is not in the resolution, a `split` group whose label does not start with `split: `, a missing mechanism, a node that carries a `mechanism` (put it on the link that carries it) and text of a documented exception that looks like a secret (the message names the path, never the text: remove that text from `assessment.yaml`, rerun `resolve-patterns`, which starts a new resolution so that you write your decisions again, and build again). Fix and rerun. Every applied override, tier exception and gap that an owner accepted appears on the diagram as a node of the group `Documented exceptions`.

## Presentation 2: the DR walkthrough

1. Copy `skills/azure-dr-assessment/assets/templates/story.dr-walkthrough.mjs` to `dr-assessment/checkout/presentations/checkout-proposed-dr.story.mjs`.
2. Write `presentations/checkout-proposed-dr.story-data.json` next to it. It has `schemaVersion` 1, a `cover` (`title` and `blurb`; put the banner in the blurb when there is one) and `steps`: exactly one entry for each of the ten steps, each with a narration `md` and optionally `title`, `groups`, `nodes` and `edges` (by label) to highlight; the `establishing` entry has `scenes` instead:

   | `step` | Tell |
   |---|---|
   | `healthy` | How the workload runs today and what is protected. |
   | `establishing` | From today's setup to the new DR region: a list `scenes`, each with a `title`, an `md` and optionally `groups`, `nodes` and `edges`; the entry's own `md` is an optional introduction. |
   | `disaster` | What fails and how far the failure reaches. |
   | `detection` | How the failure is noticed and by what. |
   | `approval` | Who approves the failover, and that this skill approves nothing. |
   | `failover` | The recovery steps in order with Estimated durations, including the traffic switch. With DR-DNS-001: the record change, who makes it, and that the TTL wait counts toward the RTO. |
   | `verification` | The checks that show the workload works in the DR region. |
   | `failback` | How and when the workload returns, and how data is resynchronized. |
   | `weakest-link` | The component that limits RPO and RTO, and what would improve it. |
   | `test-plan` | Rehearsals, frequency, measurement, evidence and owners. |

   The tables of mechanisms, slots and sources, and the scene for the documented exceptions, are generated from the diagram.

   The `establishing` entry tells how the DR region is established, from today's paired setup to a validated DR. Write one scene per build-order group that holds a type of `evidence/dr-options.json`, in the build order of the establishment guide: connectivity, identity, detection, secrets and keys, the data-replication slots and backup, compute, ingress, the types without a slot, then the traffic switch. Each scene's `md` names today's setup, the target (the chosen option, or the default, said as such) and the test criterion that proves it; highlight the nodes and groups of the target, such as the `split:` group of a split-region service. The template refuses an `establishing` entry without a scene: exit 2 with `scenes must be a non-empty list`.
3. Build it:

   ```bash
   node skills/azure-dr-assessment/scripts/present.mjs --story dr-assessment/checkout/presentations/checkout-proposed-dr.story.mjs
   ```

   Exit 4 with `unresolved-labels` lists the labels to fix: correct the data file and rebuild once. If it still fails, do not deliver the presentation, and say so in the report (stage 7). Exit 4 with `zero-icons` and exit 3 are handled as in stage 4. Exit 2 with `steps is missing` names the step you left out. Exit 2 with a message that the story data holds text that looks like a secret: the details name the path of each string, never the text. Remove that text from `presentations/checkout-proposed-dr.story-data.json` and build again; the presentation was not built.

## Never

- Authorize, approve or run a failover. A pattern never authorizes one either.
- Write "compliant", "achieved" or "guaranteed" for a recovery objective without a drill record.
- Use Microsoft Learn in place of a company pattern or an override's `alternative`, or choose between colliding patterns. The one exception is a slot that an override waives without an alternative: Microsoft Learn decides it and the source stays `override`.
- Invent a value that the application team has to supply.
- Count a service as covered because geo-redundancy is configured.

## Done when

The resolution validates, `build-diagram` exits 0, `present` exits 0 or you have said why the presentation was withheld, every unmet requirement, open input, unresolved collision and rejected override is written down for the report, and every RPO and RTO carries its label and its weakest link.
