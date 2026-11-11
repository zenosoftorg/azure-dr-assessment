# Azure DR assessment skill v2: design spec

| | |
|---|---|
| Status | Approved design. This write-up awaits the owner's review. |
| Date | 2026-11-04 |
| Repository | `zenosoftorg/azure-dr-assessment` |
| Replaces | v1: one skill with three references and two assets, plus manual scenarios DR-01 to DR-09 |

## 1. Goal and scope

An application team gives the skill an Azure Resource Inventory (ARI) workbook, or read-only access to its subscriptions, plus a DR tier and two regions. One invocation returns the current-state architecture, a proposed DR architecture with a narrated walkthrough, an assessment report and a draft recovery runbook. The team supplies nothing else.

Three properties define the skill:

- **Any region pair.** Primary and DR region are inputs, and they are usually not Azure paired regions. Every service is assessed for the actual pair, with facts read from Microsoft Learn on every run.
- **Tier-driven.** The application's DR tier fixes the recovery pattern, the RPO and RTO targets, and the relative cost profile.
- **Company patterns first.** Company-wide patterns (for example "on-prem DNS is authoritative for failover") outrank Microsoft Learn guidance. A team can override a pattern only as far as the pattern's override level allows.

"Self-contained" means a user installs nothing besides this repository: no other skill, extension or plugin. Platform prerequisites remain: Node, network access to Learn and to the icon source, and `az` for live mode.

The work is too large for one implementation plan. §14 splits it into five.

**Success checks the plan must prove**

1. From a clean install, one prompt with an ARI workbook, a tier and two regions produces every output in §9.
2. A non-paired region pair yields per-service mechanisms or explicit substitutes. Pairing is never assumed.
3. The DNS example in §6.2 resolves to the company pattern, with Traffic Manager shown only as an alternative.
4. Each override level behaves as §6.3 says, and every applied override is visible in the report and on the diagram.
5. Nothing writes to Azure, and nothing writes into the skill's directory.

## 2. Confirmed decisions

| # | Decision | Where |
|---|---|---|
| 1 | The repository is self-contained. It ships the `architecture-canvas` extension and the `architecture-presentation` skill, so a user needs nothing beyond this repository. | §5, §12 |
| 2 | Each pattern declares an override level: `overridable`, `approval-required` or `locked`. Overrides are recorded as documented exceptions in the report. Locked patterns change only through this repository. | §6 |
| 3 | Build approach B: a deterministic Node pipeline for the mechanical work, model reasoning for judgment. Rejected: A (model-driven end to end through canvas actions) and C (three separate skills plus a coordinator). | §4, §5 |
| 4 | The output folder default changes from v1: the skill announces and uses `dr-assessment/{app}/` in the working directory instead of asking first. | §9, §13 |

Everything else in this spec records the approved four-part design: flow and units; patterns, precedence and overrides; regions, non-paired handling and tiers; outputs, guardrails, testing and repository changes. Where the approval left a detail open, this spec states one reading and lists it in §15.

## 3. Users and inputs

Application teams run the skill, supply the inputs, read the outputs and may add overrides to `assessment.yaml`. Pattern owners (the platform and landing zone (LZ) team) maintain the company pattern pack by pull request. Maintainers own the pipeline, references and tests.

| Input | Required | Form | Rule |
|---|---|---|---|
| Inventory source | Yes | ARI `.xlsx` path, or subscription IDs for read-only live collection | One inventory per run. If both are given, the ARI file is the inventory and the subscriptions serve only live DR-region checks (§7). Legacy `.xls` is not supported. |
| DR tier | Yes | `0` to `3` | Never inferred. If missing, the company tier question is asked alone, first, with the wording in DR-TIER-001. An explicit tier is acknowledged and not asked again. |
| Primary region (`regions.primary`) | Yes | Display or ARM name | Checked against the inventory after ingest. A mismatch is surfaced (§4). |
| DR region (`regions.dr`) | Yes | Display or ARM name | Must differ from the primary. Pairing is never assumed. One DR region per run. |
| Scope selector | Only if needed | Resource groups, a tag, or a subscription | Asked only when the inventory summary shows more than one candidate workload. |
| Workload name | No | Text | Names `{app}`. If absent it is derived from the scope selector, else from the inventory file name. Announced, not asked. |
| Targets and constraints | No | Numeric RPO and RTO, failure scope (default `regional`), data residency, cost ceiling, test windows | A numeric target stricter than the tier stops the run (§8). |
| Overrides | No | `overrides[]` in `assessment.yaml` | §6.3. |
| Drill records | No | `drills[]`: date, scenario, measured RPO and RTO, reference | The only source of *Demonstrated* times (§8). |
| `options.pause_after_current_state` | No | Boolean, default `false` | §4. |

Region names are stored as ARM names (for example `westeurope`).

**Input forms.** Free text, `assessment.yaml`, or both. Intake never asks for what it already has.

**Asking order.** First, if the tier is missing, the tier question alone. Then everything else still missing, together: source, regions, scope selector, and the tier-versus-target decision when it applies. The scope question needs the inventory summary (§4), so when the source only arrives in this round, scope follows as one short extra question. Nothing else is asked. DR-TIER-001's discovery questions (business functions, owner, dependencies, constraints) become assumptions and open inputs in the report (§15, F9).

**Reruns.** Intake writes a normalized `dr-assessment/{app}/assessment.yaml`, keeping overrides, decisions and drill records. A rerun is one line: "Use /azure-dr-assessment with dr-assessment/checkout/assessment.yaml." Generated files are overwritten. `assessment.yaml` is the only file a person edits.

## 4. Pipeline stages

One entry skill, `azure-dr-assessment`, runs seven stages in one invocation. Scripts do the mechanical work. The model does the judgment and writes inputs that scripts validate.

| # | Stage | Runs as | Writes | If it fails or degrades |
|---|---|---|---|---|
| 1 | Preflight | Script | Report on stdout only | Reports what degrades; never blocks |
| 2 | Intake | Model; a script writes the YAML | `assessment.yaml` | Two gates halt the run (below) |
| 3 | Ingest | Script | `evidence/inventory.json`, `evidence/ledger.json` | Missing ARI sections become Unknown; live permission gaps give a partial result |
| 4 | As-is architecture | Model writes a diagram spec; scripts build | `{app}-current-state.arch.json`, presentation #1 | Zero icons or an unresolved story label refuses the HTML build |
| 5 | Region analysis | Model, with the Learn MCP | Ledger entries | Learn unreachable gives Unverified |
| 6 | DR design | Script proposes candidates; model decides | `pattern-resolution.json`, `{app}-proposed-dr.arch.json` | A pattern collision leaves the slot unresolved; an impossible requirement becomes an unmet requirement |
| 7 | Report and runbook | Model writes; scripts build | Report, runbook, presentation #2, chat summary | Same build refusals as stage 4 |

**1 Preflight.** Checks Node and permission to run scripts; network reach of Learn and the Learn MCP tools in the session; the icon cache; that the canvas library path resolves (§12); and, for live mode, `az` with the Resource Graph extension. With no Node, the failed `node` call is itself the finding. A missing icon cache is filled by one announced run of `fetch-icons` (§12).

**2 Intake.** See §3. Two gates halt the run here, before stage 3: a missing tier, asked alone and first, and a numeric target stricter than the tier (§8). Once the source is known, Intake runs ingest's summary pass (counts by subscription, resource group, tag and region). The model derives candidate workload groupings from it and labels them Inferred. With more than one candidate it asks for a scope selector and offers the candidates. With one it proceeds and announces the scope it assumed. In non-interactive use a halted run ends with the open question. The owner answers by editing `assessment.yaml` and rerunning.

**3 Ingest.** ARI: reads every worksheet without assuming sheets or columns. `inventory.json` keeps each sheet as read (name, headers, rows) plus a normalized view (type, name, resource group, subscription, location) where headers allow, each normalized field citing its sheet and row. The report lists which sheets were assessed and which were omitted. Live: bundled read-only Resource Graph queries through `az graph query`, run by a collector that executes only allowlisted read operations against the subscriptions the user named. It announces the tenant and subscriptions before the first query (v1 rule) and records them, the time and any permission gaps. Either way every fact enters the ledger as Observed, Inferred or Unknown, and values of secret-like properties are dropped (only the property name is kept).

**4 As-is architecture.**

- The model groups resources into the workload (Inferred, basis stated) and writes a diagram spec. The builder rejects a node without a ledger reference and an edge without a basis.
- Observed connections draw solid. Inferred connections draw dashed amber, with the basis in the annotation. A connection with no basis is not drawn and is listed as Unknown.
- At the start of this stage the declared primary region is compared with the regions of the in-scope resources. A mismatch goes into the chat summary, and the declared region stays in force.
- Presentation #1 opens with any region mismatch, then the inferred links and the unknowns.
- With `options.pause_after_current_state: true` the run stops here so the owner can correct links, unknowns or the region. Corrections go into `decisions[]` in `assessment.yaml` and enter the ledger as Inferred, with the basis "owner statement". The default is no pause.

**5 Region analysis.** See §7.

**6 DR design.** `resolve-patterns` proposes a candidate per slot (§6.2). The model applies the Azure-reality check, records the final decision for each slot in `pattern-resolution.json`, and writes the DR diagram spec: regions as groups, each edge labeled with its mechanism (replication, traffic routing, failover initiation), annotations citing ledger IDs, pattern ID and version, Learn URLs and applied overrides.

**7 Report and runbook.** See §9. This stage also builds presentation #2 and writes the chat summary.

**One shot.** Once Intake is satisfied, stages 3 to 7 run without further questions.

**Reasoning-only mode.** Without Node or permission to run scripts, the stages run as reasoning only. The report and runbook are still written to the output folder, with Mermaid diagrams and the evidence as a table. No JSON, `.arch.json` or HTML is produced.

**Inline mode.** If the user asks for no files, or no writable location exists, the same reasoning-only run returns its answer in chat, in the §9 section order, and writes nothing.

## 5. Units and repository layout

| Unit | Purpose | Interface | Depends on |
|---|---|---|---|
| Orchestrator: `skills/azure-dr-assessment/SKILL.md` and `references/` | Runs the seven stages; holds the hard rules and labels | A user prompt or `assessment.yaml`; reads stage references on demand | Scripts, pattern pack, Learn MCP |
| Pipeline scripts: `skills/azure-dr-assessment/scripts/` | Preflight, ingest, live collection, diagram build, presentation build, pattern lint and resolution, icon fetch | Node CLIs: files in, files out, a JSON summary on stdout, non-zero exit on failure | Node; canvas library modules; presentation builder |
| Pattern pack: `skills/azure-dr-assessment/patterns/` | Company patterns | Markdown with front matter, read by the lint and resolve scripts and by the model | None |
| `skills/architecture-presentation/` (vendored) | Turns an `.arch.json` and a story module into one self-contained HTML | `scripts/build-presentation.mjs`; icons read from the on-disk catalog | Icon catalog module; icon cache |
| `extensions/architecture-canvas/` (vendored) | Diagram store, icon catalog, layout, and the optional canvas viewer and editor | Scripts import `lib/store.mjs`, `lib/icons.mjs` and `web/layout.mjs`; users open `.arch.json` files in the canvas | Icon cache; the Copilot SDK, for `extension.mjs` only |
| Plugin manifest: `.claude-plugin/plugin.json`, `.mcp.json` | One install gives both skills and the Learn MCP server | The plugin installer | None |
| Icon cache (not committed) | Microsoft icon sets used by diagrams and presentations | Folder found through `ARCH_CANVAS_ICON_ROOT`, else the default in §12 | Network at fetch time |
| `tests/` | Unit tests, fixture generators, acceptance scenarios | `node --test`; `scenarios.md` | None |

Design rules for the units:

- **Validate at the seams.** Scripts validate what the model writes: diagram specs cite ledger entries, story labels resolve to nodes, groups or edges, and each slot decision cites a source. A model-written file that fails validation fails its stage. Nothing is patched silently.
- **Reuse the canvas modules.** Only `extension.mjs` imports the Copilot SDK, so `store.mjs` and `icons.mjs` load in plain Node. Generated `.arch.json` files are schema-valid, so they open in the canvas unchanged. Whether `layout.mjs` also loads in plain Node is unverified (§14.2, R5).
- **Vendor code, not icons.** About 13.9 MB of the extension's roughly 14 MB are icon sets, and they stay out. The extension's code is about 5.5k lines. The presentation builder changes at one place, its icon call site (near line 51), to read the on-disk catalog instead of a live canvas port. `NOTICE.md` records the source path, copy date and every change for each vendored unit.
- **Story modules.** The model writes `presentations/{diagram-id}.story.mjs` in the format documented in the vendored skill's `SKILL.md`. Scenes resolve nodes, groups and edges by label, and the build fails on any label that does not resolve.

Script names below are working names.

```text
.claude-plugin/plugin.json       Plugin manifest
.mcp.json                        microsoft-learn MCP server
NOTICE.md                        Provenance of vendored code; Microsoft icon terms
README.md
skills/
  azure-dr-assessment/
    SKILL.md                     Thin orchestrator
    references/
      stages/                    02-intake, 03-ingest, 04-as-is, 05-region-analysis, 06-dr-design
                                 (stage 1 is described in SKILL.md, stage 7 in output-contract.md)
      patterns.md
      output-contract.md
    patterns/                    Company pattern pack
      README.md                  Authoring guide
      DR-TIER-001.md
      DR-DNS-001.md
    scripts/                     preflight, ingest, collect-live, build-diagram, present,
                                 lint-patterns, resolve-patterns, fetch-icons, lib/
    assets/                      assessment.example.yaml, pattern-template.md,
                                 learn-service-map.json, report, runbook and story templates
  architecture-presentation/     Vendored: SKILL.md, scripts/build-presentation.mjs
extensions/
  architecture-canvas/           Vendored code only: extension.mjs, lib/, web/ (no icons)
tests/
  scenarios.md
  unit/
  fixtures/                      Fixture packs, workbook generator, golden files
docs/superpowers/specs/          This spec
```

## 6. Pattern model

### 6.1 Decision slots

A DR design is a set of decision slots. Each slot gets one resolved decision, with its source recorded.

| Slot | Decides |
|---|---|
| `objectives` | Tier, RPO and RTO targets, recovery pattern, cost profile |
| `traffic-dns` | How users reach the recovery region, including DNS |
| `ingress` | Entry points and edge services in each region |
| `compute` | Secondary compute posture and how it is activated |
| `data-replication.<class>` | Replication per service class: relational, NoSQL, object and file storage, messaging, VM disks, cache |
| `secrets-keys` | Secrets, keys and certificates |
| `identity` | Identity and access in the recovery region |
| `backup` | Backup, retention, protection and the restore path |
| `connectivity` | Networking, private endpoints and on-premises connectivity |
| `detection` | Health signals and incident detection |
| `failover-approval` | Who decides, and who executes, failover and failback |
| `testing` | Rehearsal scenarios, frequency and evidence |

### 6.2 Resolution order

For each slot, ranks 2 to 4 are tried in order and the first that yields a decision wins. Rank 1 is a veto on whatever wins.

| Rank | Source | Rule |
|---|---|---|
| 1 | Azure reality | Observed state, service capabilities and region limits. Nothing overrides them. A decision that asks for the impossible becomes an **unmet requirement** with a **Proposed** alternative. |
| 2 | Valid override | A valid `overrides[]` entry (§6.3) for a pattern that decides the slot. It supplies its `alternative`; without one it waives the pattern, and rank 4 applies. |
| 3 | Company pattern | The approved, applicable, unwaived pattern that decides the slot. Two such patterns with no `supersedes` between them leave the slot **unresolved**. |
| 4 | Microsoft Learn | Guidance retrieved in this run. If it was not retrieved, it is **Unverified**. |

- **Who does what.** `resolve-patterns` does ranks 2 and 3 and emits the candidate for each slot. The model applies rank 1 with evidence and writes the final decision.
- **Pattern versus Azure.** A pattern can override a Microsoft recommendation. It cannot make an unsupported capability supported.
- **Collisions.** They are never resolved by file order, name, version or date. The slot stays unresolved, other work continues, and the report asks for a recorded decision or a `supersedes` change.
- **Verification checks.** The Verification section of every applicable pattern runs against the finished design, including for slots the pattern does not decide. DR-TIER-001 decides only `objectives`. Its per-tier rules reach the other slots as constraints the model designs to and as these checks. A failed check is a Gap that names the weakest link and, when two patterns disagree, both IDs. It never rewrites another pattern's decision (§15, F1).

**DNS example.** Learn defaults to Traffic Manager or Front Door for failover routing. DR-DNS-001 says on-prem DNS is authoritative, so `traffic-dns` resolves to the pattern at rank 3. The design redirects users by changing the on-prem record. The DR diagram shows that path, the runbook includes the record change with its owner, and the TTL wait counts toward RTO. Traffic Manager appears only as a documented alternative, not applied (DR-DNS-001 v1).

### 6.3 Override levels

Each pattern declares one level.

| Level | The team supplies | The skill |
|---|---|---|
| `overridable` | An `overrides[]` entry with pattern ID, justification, owner role and date | Applies it and lists it under Documented exceptions in the report and on the diagram |
| `approval-required` | The same, plus approver role and approval reference | Applies it, records the approval reference, and states in the report that it cannot verify the approval |
| `locked` | Nothing: the team cannot override it | Rejects any entry, lists it as rejected with the reason, and keeps applying the pattern |

Only a pull request to this repository changes a locked pattern, or any pattern's level.

An entry looks like this (illustrative values):

```yaml
overrides:
  - pattern: DR-DNS-001
    slots: [traffic-dns]                          # optional; default: every slot the pattern decides
    justification: Internet-facing only; no on-prem DNS dependency
    owner_role: Application owner                 # the role that owns this exception
    date: 2026-11-04
    approver_role: Platform architecture board    # approval-required patterns only
    approval_ref: ARB-2026-114                    # approval-required patterns only
    alternative: Azure Front Door with health probes   # optional replacement decision
```

**Semantics.** An override waives the pattern for the listed slots (default: every slot the pattern decides). The slot then takes the entry's `alternative` if given, checked against Azure reality, otherwise Learn guidance (rank 4). An entry is valid only if the pattern exists, is approved and is not locked, and every field its level requires is present. An invalid entry is rejected with its reason, and the pattern keeps applying. A free-text request to override becomes an entry only when every required field is supplied (§15, F8).

A tier exception is not an override. When a numeric target is stricter than the tier, an `objectives.exceptions[]` entry (what, approver role, date) records that the target stays unmet by the tier's design (§8). It leaves DR-TIER-001's rules in force, so it is allowed even though DR-TIER-001 is locked. The locked level protects the tier definitions (bands, rules, cost ratios, response structure), not the team's choice of tier.

### 6.4 Pattern file format

Markdown with YAML front matter.

| Field | Rule |
|---|---|
| `id` | `DR-<AREA>-<NNN>`; unique across the pack; equals the file name |
| `version` | Integer; bumped on any behavioral change; reports cite `ID vN` |
| `status` | `draft`, `approved`, `deprecated` or `superseded`; only `approved` applies |
| `slots` | The slots the pattern decides (§6.1) |
| `override` | `overridable`, `approval-required` or `locked` |
| `applies_to` | Optional keys `workloads`, `environments`, `tiers`, `scenarios`; an omitted key means all |
| `supersedes` | IDs this pattern replaces on shared slots |
| `owner_role` | Role accountable for the pattern |

Fixed sections, in order: Required behavior, Rationale, Diagram elements, Runbook steps, Verification. Optional sections kept from v1: Mandatory first step (a gate, with its exact wording), Required response structure, Boundaries (§15, F7). Intake runs every applicable pattern's Mandatory first step as a gate, and the tier question is the only one in the v1 pack.

### 6.5 Lint

`lint-patterns` runs in the test suite and in CI. It fails on missing or invalid front matter, a file name that differs from `id`, duplicate IDs, a slot outside the vocabulary, missing or misordered fixed sections, and a `supersedes` entry that names an unknown ID or forms a cycle. It also fails on two `approved` patterns that share a slot, with no `supersedes` link, whose `applies_to` ranges can overlap. Ranges overlap when every key present in both has intersecting values; an omitted key means all.

Lint finds collisions that can occur for some input. `resolve-patterns` finds the ones that occur in a given run.

### 6.6 The v1 pack

| Pattern | Source | Slot | Level | Status |
|---|---|---|---|---|
| `DR-TIER-001` | The attached company tier file | `objectives` | `locked` | `approved` |
| `DR-DNS-001` | Drafted from the owner's example: on-prem DNS is authoritative, so failover changes the on-prem record | `traffic-dns` | `approval-required` (planning assumption, §16) | `approved` at release; the owner's confirmation is a release gate (§16) |

DR-TIER-001 keeps the tier file wording verbatim: scope, tier question, tier table, discovery, per-tier rules, assessment checklist and the seven-section response structure. This repository derives its Diagram elements, Runbook steps and Verification sections from those rules and marks them "derived". Other patterns join by pull request, using `assets/pattern-template.md` and the authoring guide `patterns/README.md`.

### 6.7 Where patterns come from

The bundled pack is the only source of company patterns. Application files (the inventory, `assessment.yaml`, the chat) never carry patterns. An application can only add overrides. v1's `patterns.paths` setting is removed.

A test-only hook points the engine at a fixture pack, so tests and scenarios can use collisions and drafts. It is an operator-level environment variable or script flag and is never read from `assessment.yaml`. While a non-default pack is active, every output carries a banner saying so.

## 7. Region analysis and non-paired handling

Primary and DR region are required inputs, and pairing is never assumed. Stage 5 reads Learn live through the Learn MCP. Nothing below is hard-coded.

| Step | Question | Source | Result |
|---|---|---|---|
| 1 | Are the two regions a pair? | Learn's region-pair reference | Pair status in the ledger |
| 2 | What are each region's zones, geography and data-residency boundary? | Learn's region references | Residency check; flags replication across a boundary |
| 3 | How far apart are they? | Learn's inter-region latency statistics, where the pair is listed | Matters for synchronous designs in Tier 0; Unknown if not listed |
| 4 | For each distinct service (resource type) in the in-scope inventory, what does Learn offer? | The service's row in the multiregion support reference (separate Paired and Nonpaired columns per mechanism) and the linked reliability article | Mechanism, what is replicated, failover mode, prerequisites, failback |
| 5 | Which class is each mechanism? | Steps 1 and 4 | **Any-pair**, **paired-only**, or **no built-in multiregion** |
| 6 | What replaces a paired-only or missing mechanism? | In order: a company pattern; a customer-built option documented on Learn, labeled **Proposed** and needing owner confirmation; otherwise an **unmet requirement** | Substitute per service |
| 7 | Does the DR region fit? | Service, SKU and zone availability and quota, read live when connected and Unknown from ARI; data residency | Fit findings |

The multiregion reference is `https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support`. It has two tabs, Built-in multiregion support and No built-in multiregion support, and the skill reads both. The class in step 5 and the quoted row behind it are recorded in the ledger.

- **Paired-only mechanisms.** They replicate to the primary's pair. When that pair is not the DR region, the analysis names the region where the replica actually lands, checks it against residency, and does not count the mechanism as DR coverage for the chosen region.
- **Curated catalogue.** `assets/learn-service-map.json` maps an ARM resource type to its Learn row and article, with a verified-on date. It speeds lookup and is never the source of truth. The row is always re-read from Learn.
- **Learn unreachable.** The skill tries the v1 CLI fallback where present. Otherwise guidance is Unverified and the report says so. The model may still draft from its own knowledge, labeled Unverified, and records no class as Verified.
- **Query hygiene (from v1).** One service per query. Queries carry only generic service, SKU and region terms, never customer, resource or inventory content. The skill extracts the rows it needs instead of loading whole pages.
- **Illustration only.** In an excerpt seen during design, Key Vault failover, Azure Backup cross-region restore, storage account failover and Storage Mover showed no Nonpaired support, while SQL Database active geo-replication, Cosmos DB, Service Bus geo-replication, Event Hubs geo-replication, Container Registry geo-replication and Site Recovery showed both. The skill never relies on this list; it re-reads the reference every run.

## 8. Tier handling

The tier is an input and is never inferred. DR-TIER-001 supplies the pattern, the targets, the design rules and the cost profile. The table is for orientation; DR-TIER-001 is the source of truth.

| Tier | Pattern | RPO | RTO | Relative cost | Design rules, in short |
|---|---|---|---|---|---|
| 0 | Active/Active | Near zero | Near zero | ~2.2×–2.5× | Two active, adequately provisioned regional instances; health-based global traffic management; per-store replication, consistency and conflict analysis; no near-zero claim without a validation plan and measured evidence |
| 1 | Hot/Warm (Active/Passive) | Seconds–minutes | 30 minutes–2 hours | ~2.2×–2.5× | A fully running, application-ready secondary; replication mode, capacity, detection, cutover and orchestration documented |
| 2 | Hot/Cold (minimal secondary compute; Azure Site Recovery where appropriate) | 1–4 hours | 4–12 hours | ~1.3×–1.6× | Replicated state and landing-zone prerequisites; minimal secondary compute; ASR only for supported VM workloads; time to scale and activate documented; regional capacity not assumed |
| 3 | Cold (Backup/Restore) | 24+ hours | 24–72 hours | ~1.05×–1.3× | Protected, isolated backups; reproducible deployment; cross-region restore feasibility; restore sequence and duration |

The ratios are planning ratios against a single-region deployment. They are never price quotes.

- **Stricter targets.** A numeric RPO or RTO is stricter than the tier when it is below the tier's lower bound, for example an RTO under 30 minutes for Tier 1, or zero data loss for Tiers 1 to 3. Targets inside or looser than the band do not stop the run. Tier 0 has no numeric band, so its targets are taken as the owner's definition of "near zero" and tested for feasibility instead. A stricter target stops the run at Intake. The skill shows the mismatch, and the owner changes the tier or records an `objectives.exceptions[]` entry. The run then resumes, the report lists the exception, and the design still states that the tier does not meet the target.
- **"Near zero".** The report asks for measurable thresholds and claims no target achievable without a validation plan and measured evidence. This is an open input in the report, not a gate.
- **Labels.** Each RPO and RTO is labeled Estimated or Demonstrated. *Demonstrated* requires a drill record in `assessment.yaml`. The report names the weakest component for each target.
- **Cost.** The report compares the design's broad recurring-cost profile with the tier ratio. It quotes no prices.

## 9. Outputs

Everything goes under `dr-assessment/{app}/` in the working directory. `{app}` is the slug of the workload name: lowercase letters, digits and hyphens.

The skill announces the folder before it writes and does not ask. It never writes inside the skill or plugin directory. If the working directory is inside one, it asks for another folder. This is the only case where it asks about the output location. An explicit alternative path, or a request for no files (inline mode, §4), overrides the default.

| Path | Content | Stage |
|---|---|---|
| `assessment.yaml` | Normalized inputs, overrides, decisions, drill records; the only hand-edited file | 2 |
| `evidence/inventory.json` | What was read: sheets or queries, resources, omissions. Customer data. | 3 |
| `evidence/ledger.json` | Fact entries (Observed, Inferred, Unknown) and documentation-source entries (URL, retrieval date, Verified or Unverified, what each supports) | 3 to 6 |
| `evidence/pattern-resolution.json` | One row per slot: decision, source (`ID vN`, override or Learn), status | 6 |
| `architectures/{app}-current-state.arch.json`, `{app}-proposed-dr.arch.json` | The two diagrams, schema-valid and openable in the canvas; their `.spec.json` inputs sit beside them | 4, 6 |
| `presentations/{app}-current-state.html`, `{app}-proposed-dr.html` | Presentation #1 (as-is) and #2 (DR walkthrough), each with its `.story.mjs` | 4, 7 |
| `reports/assessment.md` | The report | 7 |
| `reports/recovery-runbook.md` | The draft runbook | 7 |

The folder holds customer data. The pipeline writes `evidence/.gitignore` (ignore everything) so a team's Git repository does not pick the inventory up by accident (§15, R4). Sharing the report, which cites resource names, is the team's decision.

**Report.** Sections 1 to 7 come from DR-TIER-001's response structure, in its order: Selected landing zone tier and recovery objectives; Assumptions and failure scope; Proposed architecture; Failover and failback sequence; RPO/RTO feasibility assessment; Landing zone versus workload-team actions; Validation plan and next steps. Then four supporting sections: A Current-state architecture, B Evidence and unknowns, C Documentation sources, D Pattern register and documented exceptions. Each recommendation shows its evidence reference, documented source, pattern `ID vN` and the decision or open gap. A request for a concise answer keeps the same sections in the same order, at one table row or at most three bullets each.

**Runbook.** Marked "DRAFT: not an operational procedure until rehearsed and approved by the owner." It contains preconditions and decision authority; detection and triggers; ordered steps per component with owner, estimated duration, verification and abort condition; the traffic switch, including the on-prem DNS record change and its owner when DR-DNS-001 applies; business verification; failback and resynchronization; steady-state restoration; and a test plan. Commands or infrastructure-as-code appear only on request and are labeled untested.

**DR walkthrough (presentation #2).** Scenes in order: healthy state, disaster, detection, who approves, failover (including the DNS step), verification, failback, RPO/RTO weakest link, test plan.

**Chat summary.** Tier, regions and pair status, headline gaps, the decisions the owner must make, and file locations.

## 10. Guardrails and failure behavior

**Hard rules (carried over from v1 unless marked new)**

- Read-only. Never create, change, delete or fail over Azure resources. *New:* live collection runs only bundled, allowlisted read operations.
- Never read, request or save secrets. *New:* ingest keeps only the names of secret-like properties.
- Documentation queries carry only generic service, SKU and region terms.
- Keep Observed, Documented, Required and Proposed apart and label each.
- Capability is not configuration. Zonal resilience is not regional recovery. Metadata replication is not data replication. Unknown is not absent.
- RTO and RPO are objectives, not guarantees. Never write "compliant" or "achieved" without test evidence.
- A pattern never authorizes running a failover or any Azure change.
- Never infer a tier, a dependency or a data flow from names or co-location.
- Nothing absent from the inventory goes on the current-state diagram. The builder enforces this, and canvas suggestions are never used.
- *New:* patterns come only from the bundled pack. Customer data never goes into the skill or plugin directory. No price quotes.

**Labels**

| Set | Labels |
|---|---|
| Evidence | Observed, Inferred, Unknown |
| Documentation | Verified, Unverified |
| Times | Estimated, Demonstrated |
| Component status | Gap, Unknown, Supported by configuration, Not assessed |
| Slot outcome (new) | Resolved, Unresolved, Unmet requirement |
| Substitute (new) | Proposed |
| Mechanism class (new) | Any-pair, Paired-only, No built-in multiregion |

**Failure behavior**

| Condition | Behavior |
|---|---|
| No Node, or script execution not permitted | Reasoning-only mode (§4): Markdown plus Mermaid. An ARI file is read with a workbook reader the session already has (v1 rule); if there is none, the input is reported as unreadable. |
| Learn unreachable | Guidance and region facts are Unverified, and the report says so. The run continues. |
| Zero icons available | The HTML build refuses. Diagrams, report and runbook are still produced. |
| ARI section missing, or fact not collected | Unknown, listed under evidence and unknowns, never read as absent. |
| Unsupported or unreadable inventory format | Reported with the supported alternatives (`.xlsx`, or live). No guessing. |
| Live permission gap | Partial result; the gap is reported; affected facts are Unknown. |
| Declared primary region absent from the in-scope inventory | Surfaced in presentation #1 and the chat summary; the declared region stays. |
| Numeric target stricter than the tier | The run stops at Intake until the tier changes or an exception is recorded. |
| Approved patterns collide on a slot with no `supersedes` | Slot unresolved with both IDs and versions named; other work continues. |
| A pattern asks for what Azure cannot do for this region pair | Unmet requirement plus a Proposed alternative. |
| A service has no DR path to the chosen region | Unmet requirement. No substitute is invented. |
| Invalid override: missing field, locked pattern, unknown ID | Rejected with the reason and listed in the report; the pattern keeps applying. |
| Story label does not resolve at build | The build lists the labels. The model corrects the story and rebuilds once. If it still fails, the HTML is not delivered and the report says so. |

Preflight never blocks. The refusals above come from the build and the later stages, not from preflight.

## 11. Testing

Mechanical work gets deterministic tests. Model behavior gets acceptance scenarios.

| Layer | What it covers | How |
|---|---|---|
| Ingest | A generated ARI-style workbook (sheets, unusual headers, missing sections, secret-like columns); the live-collector allowlist; the owner's sanitized export when available | `node --test`; workbooks generated at test time, because `.gitignore` blocks `*.xlsx`; the sanitized export stays out of Git and is read from a path in an environment variable |
| Patterns | Lint rules; resolution for every override level; `supersedes`; collisions; draft and deprecated patterns ignored; invalid overrides | `node --test` with fixture packs |
| Diagram builder | Specs to `.arch.json` golden files that pass `normalizeDiagram` unchanged; edge styles; missing-evidence rejection; icon fallback | Golden files |
| Presentation build | Icons inlined (count above zero); every story label resolves; a zero-icon build refuses | Fixture diagram and story |
| Headless browser | The checks the presentation skill lists: cover, Begin button, camera transform changes, `.nd.hot` and `.nd.dim`, markdown tables, flow particles, zero console errors, dark theme | Runs where a headless browser exists; otherwise the result is NOT RUN, reported and never skipped silently |
| Acceptance scenarios | DR-01 to DR-14 | Manual, baseline versus with the skill |

**Kept from v1, adapted** (§15, F4)

- DR-01 to DR-04 run in inline mode. Their prompts gain the now-required DR tier and DR region, DR-01 drops "approved recovery region" from its not-collected list, and the "no customer patterns" setup note goes away.
- DR-02 and DR-04 also give patterns in the prompt, which carry no authority in v2. They run against a fixture pack through the test hook (§6.7), and the unit tests cover the same logic deterministically.
- DR-05 expects the announced default folder instead of a question, discovery through a plugin install, and no writes into the skill directory.
- DR-06 covers ARI through script ingest. Its tool-availability checks cover no Node, Learn unreachable and an empty icon cache.
- DR-07 to DR-09 use the bundled DR-TIER-001, so the "requires the tier pattern" notes go away.

**New scenarios**

| ID | Tests | Passes when |
|---|---|---|
| DR-10 | Non-paired regions: primary West Europe, DR Sweden Central (not a pair; West Europe pairs with North Europe), with services of each mechanism class | Pair status is stated and sourced. Each service shows its mechanism class with the Learn row cited. Paired-only and missing mechanisms get a substitute (pattern, Proposed customer-built option, or unmet requirement). No service counts as covered only because geo-redundancy is configured. A third-region replica is named. |
| DR-11 | DNS precedence: DR-DNS-001 applies while Learn suggests Traffic Manager | `traffic-dns` cites DR-DNS-001 v1. The DR diagram shows the on-prem record path. The runbook has the record change with its owner. TTL counts toward RTO. Traffic Manager appears only as a documented alternative. A Tier 0 run shows the conflict as a Gap (§15, F1). |
| DR-12 | Override levels | A complete overridable entry is applied and listed under Documented exceptions and on the diagram. An approval-required entry without an approver is rejected; with one it is applied and the approval is stated as unverified. A locked entry is rejected with the reason. A free-text request lacking required fields is not applied. |
| DR-13 | Up-front intake | With free text plus a partial `assessment.yaml`: the tier is asked alone and first when missing, regions and scope are asked together, nothing supplied is asked again, the output folder is announced and not asked, and the normalized YAML is written. A rerun from that file asks nothing. |
| DR-14 | End to end | A synthetic ARI workbook in; every §9 output under `dr-assessment/{app}/` in one shot; both presentations open with icons; the report has the seven tier sections then A to D; the runbook is marked DRAFT; the chat summary has the §9 content. |

Passing synthetic scenarios does not prove live Azure access, real ARI parsing beyond the fixtures, or recovery procedures. The results table in `tests/scenarios.md` keeps PASS, FAIL, PARTIAL and NOT RUN.

## 12. Distribution and install

**Plugin.** `.claude-plugin/plugin.json` carries name, description, version, author, homepage, repository, license and keywords, as the superpowers plugin's manifest does. Skills are discovered from `skills/`. `.mcp.json` declares the `microsoft-learn` server (type `http`, URL `https://learn.microsoft.com/api/mcp`), as the `microsoftdocs/mcp` plugin does. Installing the plugin from the GitHub repository therefore gives both skills and the Learn MCP server. Plugin skills are listed in the desktop app (the superpowers plugin's skills are available in the owner's desktop session), so plugin install is the primary path.

**Canvas (optional).** Install `https://github.com/zenosoftorg/azure-dr-assessment/tree/main/extensions/architecture-canvas` with the app's extension installer, scope user, project or session. The pipeline works without it.

**Icons.** They are not committed. `scripts/fetch-icons.mjs` downloads Microsoft's official sets into a cache. The Azure set is required (`https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip`). The Microsoft 365, Dynamics 365, Entra, Fabric and Power Platform sets are optional and come from the pages linked on Learn's "Download Azure icons" page. A configurable internal mirror replaces the Microsoft URLs. The default cache is `$COPILOT_HOME/extensions/architecture-canvas/Final SVG Icons` (`COPILOT_HOME` defaults to `~/.copilot`), a place the canvas already searches, so scripts and an installed canvas find the same icons. `ARCH_CANVAS_ICON_ROOT` overrides it. The fetch runs once on first use, announced by the orchestrator after preflight (§15, F2), and is idempotent.

Microsoft's terms on the Learn page: "Microsoft permits the use of these icons in architectural diagrams, training materials, or documentation. You can copy, distribute, and display the icons only for the permitted use unless granted explicit permission by Microsoft. Microsoft reserves all other rights." Generated diagrams and presentations are architectural diagrams. Committing the icon files would distribute them outside that use, so vendoring waits for the owner's legal check (§16).

| Install path | Status |
|---|---|
| Plugin install from the GitHub repository | Supported; primary |
| Clone, then `copilot skill add <clone>/skills` | Supported: the repository tree stays intact, so the library imports resolve |
| Copy one skill folder into `~/.copilot/skills/` (the v1 fallback) | Not supported: scripts import the vendored canvas modules and presentation builder from elsewhere in the repository. Preflight reports what is missing and the run degrades to reasoning-only mode (§4). |

Resolution order for the canvas modules: the repository-relative path, then `$COPILOT_HOME/extensions/architecture-canvas`. Updates come from a plugin update or `git pull`, and a missing icon cache is simply fetched again.

Platform prerequisites: Node (minimum version fixed in the plan), network access to Learn and to the icon source or mirror, and for live mode `az` with the `resource-graph` extension and Reader access.

## 13. Changes to existing files

| File | Change |
|---|---|
| `README.md` | Rewritten: purpose; plugin and canvas install; first-use icon fetch; one-line usage; inputs; output folder and the data-handling note; override and pattern-authoring pointers; test command. States that the bundled patterns are examples that a company replaces or extends in its own copy or fork, and that the repository holds no customer data. Drops v1's install-by-copy fallback and the assessment-project layout. |
| `skills/azure-dr-assessment/SKILL.md` | A thin orchestrator. The description lists triggers only (ARI or live input, tier, region pair, DR architecture, walkthrough, runbook). It names the seven stages and points to stage references. Slot resolution replaces v1's precedence list. Hard rules, labels and red flags carry over. "Locations" now describes the announced output folder, and the rule "ask before writing anything" goes away. |
| `references/assessment-workflow.md` | Split into `references/stages/02-intake.md` through `06-dr-design.md`, then deleted. ARI and live reading, the ledger, Learn retrieval and the diagram rules move to the matching stage file. Canvas-action instructions (`open_canvas`, `add_component` and so on) give way to script instructions. |
| `references/customer-patterns.md` | Renamed `references/patterns.md`. Keeps gates, conflicts, traceability and authority. "Finding patterns" in customer directories is replaced by the bundled pack, slots, override levels and resolution, and by the rule that application files never carry patterns. |
| `references/output-contract.md` | Rewritten for the §9 output tree, the DR walkthrough, documented exceptions and the chat summary. The report sections come from DR-TIER-001. Keeps the concise-request rule, the per-recommendation trace and the runbook rules. |
| `assets/assessment.example.yaml` | Adds `regions.dr` (replacing `candidate_recovery`), a scope selector, `overrides`, `options.pause_after_current_state`, `drills` and the workload name. Removes `patterns.paths`. `outputs.directory` becomes the output root and defaults to `dr-assessment/{app}`. The `objectives.tier` comment no longer says tiers come from a customer pattern. |
| `assets/pattern-template.md` | Gains `slots` and `override`, `applies_to.tiers`, and the section set in §6.4. Keeps the optional sections. |
| `tests/scenarios.md` | Keeps DR-01 to DR-09 as adapted in §11, adds DR-10 to DR-14, extends the results table, and updates the setup notes because DR-TIER-001 is always bundled. |
| `.gitignore` | Keeps every entry. Adds `/dr-assessment/`, `Final SVG Icons/`, `node_modules/` and test temp output. `*.xlsx` and `*.xls` stay, so fixtures are generated at test time. |

New files and folders are the ones in the §5 layout: the plugin manifest, `.mcp.json`, `NOTICE.md`, the pattern pack, the scripts, the new assets, the two vendored units, and `tests/unit/` with `tests/fixtures/`.

## 14. Implementation staging and deferred items

### 14.1 Staging

This is too big for one plan. It splits into five plans, in this order. Plan 2 can run in parallel with plan 1.

| Plan | Delivers | Depends on | Done when |
|---|---|---|---|
| 1 Foundation | Repository layout, the two vendored units, on-disk icons in the presentation builder, `fetch-icons`, preflight, plugin manifest, `.gitignore`, `NOTICE.md` | None | From a clean clone, a hand-written `.arch.json` and story build to an HTML with icons inlined, and a zero-icon build refuses |
| 2 Pattern engine | Front-matter schema, `lint-patterns`, `resolve-patterns`, template, authoring guide, DR-TIER-001, DR-DNS-001 | None | Unit tests cover every override level, `supersedes` and collisions, and lint passes on the pack |
| 3 Ingest and as-is | ARI reader, live collector, ledger, diagram builder, presentation #1, the intake summary pass | 1 | A generated workbook produces `current-state.arch.json` and presentation #1, and the golden files normalize cleanly |
| 4 Region analysis and DR design | Stage references, curated catalogue, DR diagram and story, report and runbook templates, orchestrator `SKILL.md`, `patterns.md`, `output-contract.md` | 1, 2, 3 | DR-01 to DR-04 and DR-07 to DR-12 pass with the skill loaded |
| 5 Hardening and docs | End-to-end run, headless-browser check, README, scenarios, install check on a clean profile | 1 to 4 | DR-05, DR-06, DR-13 and DR-14 pass, and the README steps work from scratch |

### 14.2 Deferred to the plan

Each item names its constraint. The plan decides or verifies it.

- **Canvas libraries in plain Node.** Confirm `store.mjs`, `icons.mjs` and `web/layout.mjs` load outside the extension host. If `layout.mjs` needs browser APIs, extract a pure function or add a deterministic layered layout to `build-diagram` (R5).
- **`.xlsx` reader.** Zero-dependency (`node:zlib` plus OOXML parsing) or a vendored single-file library. It must work from a plain clone with no `npm install` (F5).
- **ARI heuristics.** Resource type from the sheet name, header-to-field mapping and the normalized schema, checked against the owner's sanitized export when available.
- **Live collection.** The Resource Graph query set, the allowlisted read operations for DR-region fit (SKU, zone, quota), and the permissions they need.
- **Icons.** The official URL for each set; mapping the official ZIP layout to the catalog's `Final SVG Icons` layout; the mirror setting; whether the installer keeps the default cache across updates (otherwise move the cache and set `ARCH_CANVAS_ICON_ROOT`); which sets are fetched by default (spec default: Azure required, others optional).
- **ARM type to icon.** A table or a catalog search, and the generic fallback icons.
- **Schemas and templates.** Diagram spec, ledger, `pattern-resolution.json`, curated catalogue, and the report, runbook and story templates.
- **Canvas discovery.** How the installed canvas finds `dr-assessment/{app}/architectures/`: its workspace `architectures/` convention or `ARCH_CANVAS_DIAGRAM_DIR`.
- **Install.** Exact plugin install steps for the CLI and the desktop app on a clean profile; duplicate Learn MCP registration (R8); behavior with the owner's personal copies present (R2).
- **Tooling.** Minimum Node version, test runner (`node --test` assumed), CI running the tests and `lint-patterns`, `CODEOWNERS` for `patterns/` (R3), and the headless-browser tool.
- **Test hook and overrides.** The fixture-pack hook (§6.7), and whether overrides get a version pin or an expiry (R11).
- **Large inventories.** Summary views so the model never needs the raw inventory, and size limits for the ledger (R10).
- **Naming.** The `{app}` slug rule, the region-name normalization source, and final script names.
- **DR-DNS-001 text.** Written once the owner answers §16.

## 15. Risks and open questions

### 15.1 Flags against the approved design

Each flag is an inconsistency, an infeasibility or an ambiguity found while writing this spec. The third column states the reading this spec uses. No approved decision was reversed. Where an approved mechanism cannot work as stated (F2), the flag says what replaces it.

| # | Flag | Reading used and consequence |
|---|---|---|
| F1 | **Tier 0 versus DR-DNS-001.** DR-TIER-001 requires health-based global traffic management for Tier 0. DR-DNS-001 as drafted redirects by changing the on-prem DNS record. That adds a manual step and the TTL, so it cannot give near-zero RTO. If DR-TIER-001 also owned `traffic-dns`, it would collide with DR-DNS-001 in the pack itself. | DR-TIER-001 decides only `objectives`. Its rules are acceptance checks (§6.2). A Tier 0 run therefore shows a Gap with the DNS step as the weakest link and no slot collision. The owner's answer in §16, item 1 should say whether DR-DNS-001 may front an Azure-side global router with an on-prem CNAME for Tier 0, or apply only to tiers 1 to 3 through `applies_to.tiers`. |
| F2 | **Icons "downloaded at install".** Plugin and extension installs copy or clone files, and no install-time hook is known. The canvas installed by the app is also a separate copy from the plugin. | The decision stands: icons are not committed, they are downloaded, and a mirror is configurable. Only the trigger moves from install to first use, unless the platform offers an install hook. `fetch-icons` runs on first use, announced, and from the README. It is idempotent and writes to a cache that scripts and an installed canvas both find (§12). "Self-contained" therefore excludes the icon download (§1). |
| F3 | **Intake needs ingest facts.** The scope question ("only if the inventory holds more than one workload") and the primary-region check need the inventory, but ingest is stage 3. | Intake runs ingest's summary pass once the source is known. Full ingest stays in stage 3. The primary-region check runs after stage 3. For a live source, the summary needs the subscription IDs first. |
| F4 | **v1 scenarios clash with v2 rules.** DR-02 and DR-04 supply patterns in the prompt, and v2 accepts no application-supplied patterns. DR-01 to DR-04 state no DR tier or DR region, which are now required. DR-05 expects a question about the output location, which decision 4 removes. Several scenarios say "do not write files". | A test-only fixture-pack hook (§6.7), prompts that add tier and DR region, a rewritten DR-05, and inline mode for "no files" (§4, §11). |
| F5 | **Dependency-free Node versus `.xlsx`.** Reading `.xlsx` needs a ZIP and XML reader. The repository has no `package.json`, and plugin install runs no `npm install`. v1's `.gitignore` blocks `*.xlsx`, so fixtures cannot be committed. | Default: a zero-dependency reader, or one vendored single-file library, decided in the plan. Fixtures are generated at test time. The owner's sanitized export stays out of Git. |
| F6 | **Partial copies break imports.** Scripts import the canvas modules from `extensions/` and the presentation builder from `skills/architecture-presentation/`. v1's fallback of copying one skill folder into `~/.copilot/skills/` would lose them. | Supported install paths and the resolution order in §12. Preflight reports what is missing. |
| F7 | **Pattern sections.** The approved fixed sections omit v1's Mandatory first step, Required response structure and Boundaries. DR-TIER-001 needs the first two. | They stay as optional sections (§6.4). |
| F8 | **Override semantics.** The approved entry fields (pattern ID, justification, owner role, date) do not say what replaces the pattern. | An override waives the pattern for its slots. An optional `alternative` names the replacement. Otherwise Learn guidance applies (§6.3). |
| F9 | **Discovery versus "nothing else needed".** DR-TIER-001 asks discovery questions after the tier. The goal is that the team supplies nothing else. | Unknowns become assumptions and open inputs in report sections 2 and 7, which the tier file allows ("state it as an assumption or open decision"). The pause option lets the owner answer them (§3, §4). |
| F10 | **Both inventory sources supplied.** The approved intake says "ARI .xlsx, or subscription IDs". | The ARI file is the inventory of record. The subscriptions serve only live DR-region checks (§3, §7). |

### 15.2 Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Provenance, license and visibility. The vendored code comes from the owner's personal copies, the repository has no `LICENSE`, and example company patterns live in the repository. | `NOTICE.md` records provenance. The bundled patterns are examples; a company keeps its own in its copy or fork. The owner confirms ownership and license before the first release. |
| R2 | Name collisions. The owner's personal `architecture-presentation` skill and `architecture-canvas` extension share names with the vendored units, and copies can drift. | `NOTICE.md` records origin. The plan checks behavior with both present. After vendoring, this repository's copy is the source of truth. |
| R3 | Locked-pattern integrity depends on repository controls. | `CODEOWNERS` for `patterns/`, required review, and CI that runs the tests and pattern lint. |
| R4 | Output in a team's own Git repository could expose the customer inventory. | The folder is announced, and the pipeline writes `evidence/.gitignore`. |
| R5 | `web/layout.mjs` may need browser APIs. | The plan verifies it. Fallback: a deterministic layered layout in `build-diagram`. |
| R6 | Learn drift. Page structure, tabs or columns can change, and class assignment is model judgment over Learn text. | The model reads the page, with no parser. The ledger stores the quoted row and the URL. An unrecognized structure gives Unverified. DR-10 detects drift. |
| R7 | The host may deny script execution. | Preflight reports it and the run degrades to reasoning-only mode (§4). |
| R8 | The Learn MCP server is declared twice when the owner's `microsoftdocs/mcp` plugin is also installed. | The plan checks for duplicate registration and removes one declaration if the host lists both. |
| R9 | Two copies of the tier rules: the company tier file and DR-TIER-001. | The landing zone team owns the source. The pattern records the source file's date, and a tier file change needs a pull request here. |
| R10 | ARI exports vary by version, and enterprise inventories can be very large. | The report lists sheets assessed and omitted. The model reads in-scope summaries and cites ledger IDs. The sanitized export test is the check. |
| R11 | Overrides carry no version pin or expiry, so a later pattern change can leave an old override stale. | Reports print the pattern version applied and the override date. The plan decides on pinning. |

### 15.3 Smaller readings stated in the body

The owner can veto any of these: the declared primary region stays when the inventory disagrees, and corrections enter the ledger as Inferred owner statements (§4); presentation #2 is built in stage 7 (§4); a tier exception is allowed although DR-TIER-001 is locked (§6.3); what counts as a target stricter than the tier (§8); one DR region per run (§3, §17); `evidence/.gitignore` (§9).

## 16. Open inputs from the owner

| # | Input | Default assumption planning will use |
|---|---|---|
| 1 | **DR-DNS-001 details.** The exact rule: record type, TTL, who changes records, how Azure-hosted private zones integrate. Its override level. Which tiers it covers, given F1. | Override level `approval-required`. The rule applies to all tiers. A Tier 0 conflict shows as a Gap. |
| 2 | **Other company patterns** wanted in the v1 pack. | Only DR-TIER-001 and DR-DNS-001 ship, plus the template and an authoring guide. |
| 3 | **A sanitized real ARI export.** | Start with a synthetic generated workbook. The reader assumes nothing about columns, and the real export is added to local test runs when available. |
| 4 | **Icon distribution.** Download from Microsoft, or vendor the icons after a legal check. | Download on first use, with a configurable mirror. Vendoring only after the owner's legal check. |

## 17. Out of scope

- Price quotes, and cost estimates beyond the relative cost ratios of the company tier file.
- Any Azure write operation, including executing a failover or failback.
- Comparing several candidate DR regions in one run. Rerun once per candidate.
- Verifying approvals, and continuous or scheduled assessment.
- Generating infrastructure-as-code or commands unless asked. When asked, they are labeled untested.
- PowerPoint exports, legacy `.xls` input, and non-Azure inventories.
