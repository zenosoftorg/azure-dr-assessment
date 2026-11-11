---
name: azure-dr-assessment
description: Use when asked to assess an Azure workload's disaster recovery or resilience from an Azure Resource Inventory (ARI) export or a read-only subscription, to rebuild its Azure architecture, or to propose a DR architecture, failover walkthrough or runbook for a primary and a DR region at a given RPO/RTO tier.
---

# Azure DR assessment

One invocation turns an inventory into the current-state architecture and a proposed DR architecture with its explanation. The user provides the inventory, the DR tier, the primary region and the DR region. Nothing else is needed.

**Core principle:** keep four things apart and label each: **Observed** (inventory or live reads), **Documented** (Microsoft Learn), **Required** (company patterns, business targets), **Proposed** (your design). Never present one as another.

Not for general DR-pattern comparisons, cost estimates, or unrelated programming questions.

## What the user provides
- The inventory: an ARI `.xlsx` export, or subscription IDs for a read-only live read.
- The DR tier, 0 to 3. It is never inferred. When it is missing, the whole reply is the DR-TIER-001 question word for word, from `gates[0].question` when intake ran, otherwise from the first blockquote of "Mandatory first step" in `patterns/DR-TIER-001.md`: alone, with no commentary, no table and no other question, also when nobody can answer in this run. The open question ends the reply.
- The primary region and the DR region. They are usually not a pair. Never assume pairing. No architecture, diagram or design text is produced until the primary region and the DR region are both known. Ask for what is missing, the regions and the scope together; a missing DR region is never an open assumption.
- Which workload, only when the inventory holds more than one.

Free text, an `assessment.yaml`, or both. Never ask for what you already have.

## The tier question
When the tier is missing, the reply is the block below and nothing else: no table, no commentary, no other question, no design text. It is the same text as `gates[0].question` and as the first blockquote of "Mandatory first step" in `patterns/DR-TIER-001.md`. Copy it exactly, also when you cannot ask a question tool.

> **Which landing zone DR tier applies to this application?**
>
> - **Tier 0 — Active/Active:** RPO **near zero**; RTO **near zero**. Mission-critical workloads.
> - **Tier 1 — Hot/Warm (Active/Passive):** RPO **seconds–minutes**; RTO **30 minutes–2 hours**. Business-critical workloads.
> - **Tier 2 — Hot/Cold (minimal secondary compute; Azure Site Recovery where appropriate):** RPO **1–4 hours**; RTO **4–12 hours**. Important, cost-conscious workloads.
> - **Tier 3 — Cold (Backup/Restore):** RPO **24+ hours**; RTO **24–72 hours**. Low-criticality workloads.
>
> Reply with **0, 1, 2, or 3**. If you are unsure, describe the business impact of data loss and downtime, and we can determine the appropriate tier together.

## Locations
- `references/`, `patterns/`, `scripts/` and `assets/` belong to this skill. The references write commands as `node skills/azure-dr-assessment/scripts/<name>.mjs`. When the skill is installed elsewhere, replace the leading `skills/azure-dr-assessment` with this skill's directory.
- Every output goes to `dr-assessment/{app}/` in the working directory. Announce it, do not ask. The one exception is the optional canvas copies of the diagrams: only when the owner asks, they go to `architectures/` of the working folder (or `$ARCH_CANVAS_DIAGRAM_DIR`), outside `dr-assessment/{app}/`; a team that commits the working folder should gitignore `architectures/`, or point `ARCH_CANVAS_DIAGRAM_DIR` inside `dr-assessment/{app}/` (stage 7). Never read customer data from, or write it to, this skill's directory. The layout is in [output-contract](references/output-contract.md). `assessment.yaml` is the only file a person edits: everything else is generated and the next run overwrites it. Scratch or helper files, such as a script or a scratch json, go to the operating system temp folder or to a temp folder inside the working folder outside `dr-assessment/{app}/`, and are deleted before the final answer; the output folder holds only the files that the output contract lists.

## Precedence, per decision slot
1. **Azure reality:** observed state, service capabilities, region limits and the Microsoft Learn facts read in this run. Nothing overrides it, not even a playbook claim. A pattern that asks for the impossible becomes an unmet requirement with a proposed alternative.
2. **A valid override** from `assessment.yaml`, recorded as a documented exception. It supplies its `alternative`; without one it waives the pattern, Microsoft Learn decides the slot and the source stays `override`.
3. **The company pattern** for the slot. The tier rules are a pattern too. A slot that a pattern decides is not offered in the DR options question.
4. **The service playbook** in `playbooks/`: the default source for a service's DR options, setup steps and test criteria. Stage 5 checks its claims against Learn, and Learn wins.
5. **Microsoft Learn** guidance and defaults, for a service without a playbook and for what a playbook does not cover.

The patterns, their override levels and how to write one are in [patterns](references/patterns.md).

## Workflow
Run the stages in order, in one pass. Stop to ask only where a stage tells you to.

| # | Stage | Do | Reference |
|---|---|---|---|
| 1 | Preflight | `node skills/azure-dr-assessment/scripts/preflight.mjs`. A live read needs `--live` (`node skills/azure-dr-assessment/scripts/preflight.mjs --live`), which also checks `az`, its `resource-graph` extension and the sign-in. Say what degrades. Never stop for it. If you cannot run it (no Node 22, or the host does not let you run scripts), go to Degraded modes. Check that the Microsoft Learn tools (`microsoft_docs_search`, `microsoft_docs_fetch`) are in your tool list, and say so when they are not: the guidance is then Unverified unless the Learn CLI fallback of stage 5 works. If the icon library is missing, announce that you fetch Microsoft's official icons now, and run `node skills/azure-dr-assessment/scripts/fetch-icons.mjs` once: it is idempotent. An inline or reasoning-only run skips the icon fetch: no script runs, so no diagram file or presentation is built. | this file, "Degraded modes" |
| 2 | Intake | Collect the inputs, close the tier gate, write `assessment.yaml`. | [02-intake](references/stages/02-intake.md) |
| 3 | Ingest | Read the inventory into evidence files. | [03-ingest](references/stages/03-ingest.md) |
| 4 | As-is architecture | Group the resources into the workload, draw it, build presentation 1. | [04-as-is](references/stages/04-as-is.md) |
| 5 | Region analysis | Read Microsoft Learn for the two regions, service by service, check the playbooks, classify each service's DR path. | [05-region-analysis](references/stages/05-region-analysis.md) |
| 5b | DR options | Ask the one DR options question when a service has no native DR into the DR region, or record the defaults when nobody can answer. | [05b-dr-options](references/stages/05b-dr-options.md) |
| 6 | DR design | Decide every slot from the choices, draw the DR architecture, build presentation 2. | [06-dr-design](references/stages/06-dr-design.md) |
| 7 | Report, guide and runbook | Write the DR establishment guide, the draft runbook and the report, then summarize. | [07-report](references/stages/07-report.md) |

The default is one shot, with one more stop: stage 5b asks the DR options question once, and never when nobody can answer. If the owner wants to check the as-is picture first, intake sets `pause_after_current_state` and the run stops after stage 4.

## Hard rules
- Read-only. Never create, change, delete, or fail over Azure resources. Never read, request, or save secrets.
- Capability is not configuration. Zonal resilience is not regional recovery. Metadata replication is not data replication. Unknown is not absent.
- A failed Verification check of a pattern is named by its number in the pattern's Verification list, for example `DR-TIER-001 v1 check 6`, with the pattern's wording, also when you review a proposal inline.
- RTO and RPO are objectives, not guarantees. Label times *Estimated* or *Demonstrated*.
- Documentation queries contain only generic service, SKU, and region terms: no customer names, resource names, IDs, or inventory content.
- A pattern or a runbook step never authorizes you to run a failover, and approving a procedure does not either.
- This skill records an approval reference and cannot verify it. Say so.

## Labels
Evidence: Observed · Inferred · Unknown. Documentation: Verified · Unverified. Times: Estimated · Demonstrated. Status: Gap · Unknown · Supported by configuration · Not assessed. Decisions: Resolved · Unresolved · Unmet requirement. Substitutes: Proposed. Mechanisms: Any-pair · Paired-only · No built-in multiregion. DR paths: Native · Workaround · Split-region · Backup-restore · No path. Choices: Recommended · Default (chosen by nobody). A class is given only to an Azure service's replication or recovery mechanism; a step that is a company pattern, a customer procedure or an on-premises action carries the pattern ID and version (or `customer procedure`) and no class: write "DNS cutover: DR-DNS-001 v1", never "DNS cutover: Any-pair".

## Degraded modes
| Situation | Behavior |
|---|---|
| No Node.js 22 or later, or the host does not let you run scripts | Reasoning-only: no script runs. Write the report, the DR establishment guide and the runbook with Mermaid diagrams and the evidence as a table, and say that the evidence ledger, the diagram files and the presentations were not produced. Read an `.xlsx` only with a workbook reader that the session already has. If there is none, report the input as unreadable and name the alternatives: run where Node 22 is available, or give a live read. |
| `preflight` prints `mode: reasoning-only` although Node works | The canvas library was not found, for example because only the skill folder was copied out of its repository, which is not a supported install. The run degrades as in the row above: reasoning-only, no script runs. Say what `preflight` reports as missing, and say in your answer that a copy of the skill folder alone is not a supported install. |
| The user asks for no files, or no writable location exists | Inline mode: the same reasoning-only run, and nothing is written, not even `assessment.yaml`. Read the pattern files yourself, answer in chat in the order of the output contract, and say that nothing was written. Labels still apply without a ledger: every replication or recovery mechanism you name, current or proposed, carries its class (Any-pair, Paired-only, No built-in multiregion) and its documentation status (Verified or Unverified), and every RPO or RTO figure is labelled Estimated, or Demonstrated only when a drill record exists. |
| Microsoft Learn unreachable | Guidance is Unverified, and the report says so. |
| No icon library, and the fetch failed or is offline | The presentation build refuses (exit 4, `zero-icons`). The diagram files, the report, the DR establishment guide and the runbook are still produced. Say so, and give the command to try again: `node skills/azure-dr-assessment/scripts/fetch-icons.mjs`. |
| No browser, or it did not start | The browser check of the presentations is NOT RUN. Say so, and never call a presentation verified. |
| An inventory section is missing | Its facts are Unknown, never absent. |
| Two patterns claim one slot | The decision stays Unresolved. Name both patterns and ask for the resolution in these words: a `supersedes` link between the patterns, or a decision recorded under `decisions[]` in `assessment.yaml`. A decision recorded in `assessment.yaml` `decisions[]` documents the owner's choice; the slot stays Unresolved in the resolution file until a `supersedes` link removes the collision. Slots that the collision does not touch continue to be designed. |
| A service has no DR path to the chosen region | It is an unmet requirement. |

## Red flags: stop and correct
- Inferring a tier, dependency, or data flow from names or co-location.
- Using Microsoft Learn in place of a company pattern or of an override's `alternative`. The one exception is a slot that an override waives without an alternative: Learn decides it and the source stays `override`.
- Choosing between conflicting patterns by file order or version.
- Writing "compliant" or "achieved" without test evidence.
- Treating a paired-only mechanism as covering a DR region that is not the primary's pair.
- Offering a DR option that is not in `evidence/dr-options.json`, or recommending by judgement instead of the rule that `dr-options` applies.
- Counting a split-region service as covered in the DR region.
- Calling a default an owner decision.
