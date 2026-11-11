# Company pattern pack

This folder is the only source of company patterns for the Azure DR assessment skill. A pattern is a company-wide design requirement. When a pattern decides a decision slot, it outranks Microsoft Learn guidance. Application files (the inventory, `assessment.yaml`, the chat) never carry patterns. An application can only add overrides, and only as far as a pattern's override level allows.

## How the skill uses a pattern

For each decision slot, ranks 2 to 4 are tried in order and the first that yields a decision wins. Rank 1 is a veto on whatever wins.

| Rank | Source | Rule |
|---|---|---|
| 1 | Azure reality | Observed state, service capabilities and region limits. Nothing overrides them. A decision that asks for the impossible becomes an unmet requirement with a Proposed alternative. |
| 2 | Valid override | A valid `overrides[]` entry in `assessment.yaml` for a pattern that decides the slot. It supplies its `alternative`; without one it waives the pattern, and rank 4 applies. |
| 3 | Company pattern | The approved, applicable, unwaived pattern that decides the slot. Two such patterns with no `supersedes` link leave the slot unresolved. |
| 4 | Microsoft Learn | Guidance retrieved in this run. If it was not retrieved, it is Unverified. |

`resolve-patterns` does ranks 2 and 3 and writes a candidate per slot to `evidence/pattern-resolution.json`. The model applies rank 1 and records the final decision. The Verification section of every applicable pattern runs against the finished design, including for slots the pattern does not decide. A failed check is a Gap that names the weakest link. A pattern never authorizes running a failover or any Azure change.

## Pack status

| Pattern | Decides | Override level | Status | Notes |
|---|---|---|---|---|
| `DR-TIER-001` | `objectives` | `locked` | `approved` | The company tier file's rules in the tier file wording. It decides only `objectives`; its per-tier rules reach the other slots as constraints and as Verification checks. |
| `DR-DNS-001` | `traffic-dns` | `approval-required` | `approved` | Drafted from the owner's example: the company's on-prem DNS is authoritative, so failover changes the on-prem record. The text awaits the owner's confirmation, which is the DNS release gate in `RELEASING.md`, closed before the first release. |

## Add or change a pattern

1. Copy `../assets/pattern-template.md` to `patterns/<ID>.md`. The file name must equal the `id`.
2. Fill in the front matter and every fixed section. Delete the optional sections you do not need.
3. Keep `status: draft` while the text is under review. Only `approved` patterns apply.
4. Run `node skills/azure-dr-assessment/scripts/lint-patterns.mjs` (or `npm run lint:patterns`), then `npm test`.
5. Open a pull request. Only a pull request changes a locked pattern, or any pattern's override level. Bump `version` on any behavioral change: reports cite `ID vN`.

## Front matter

| Field | Rule |
|---|---|
| `id` | `DR-<AREA>-<NNN>` (for example `DR-DNS-001`), unique in the pack, equal to the file name without `.md` |
| `version` | Integer, at least 1 |
| `status` | `draft`, `approved`, `deprecated` or `superseded`. Only `approved` applies |
| `slots` | Non-empty list of the slots in the next section that the pattern decides |
| `override` | `overridable`, `approval-required` or `locked` |
| `applies_to` | Optional mapping, see below. An omitted key means all |
| `supersedes` | Ids of patterns this one replaces on shared slots. Required: write `[]` when it replaces nothing |
| `owner_role` | The role accountable for the pattern |
| `inputs` | Optional list of values the application team supplies, see below |
| `parameters` | Optional machine-readable data for the engine, see below |

## Slots

| Slot | Decides |
|---|---|
| `objectives` | Tier, RPO and RTO targets, recovery pattern, cost profile |
| `traffic-dns` | How users reach the recovery region, including DNS |
| `ingress` | Entry points and edge services in each region |
| `compute` | Secondary compute posture and how it is activated |
| `data-replication.relational` | Replication for relational databases |
| `data-replication.nosql` | Replication for NoSQL stores |
| `data-replication.storage` | Replication for object and file storage |
| `data-replication.messaging` | Replication for messaging services |
| `data-replication.vm-disks` | Replication for VM disks |
| `data-replication.cache` | Replication for caches |
| `secrets-keys` | Secrets, keys and certificates |
| `identity` | Identity and access in the recovery region |
| `backup` | Backup, retention, protection and the restore path |
| `connectivity` | Networking, private endpoints and on-premises connectivity |
| `detection` | Health signals and incident detection |
| `failover-approval` | Who decides, and who executes, failover and failback |
| `testing` | Rehearsal scenarios, frequency and evidence |

## Override levels

Each pattern declares one level. An application team adds an entry under `overrides` in its `assessment.yaml`.

| Level | The team supplies | The skill |
|---|---|---|
| `overridable` | `pattern`, `justification`, `owner_role`, `date` | Applies the entry and lists it under Documented exceptions in the report and on the diagram |
| `approval-required` | The same, plus `approver_role` and `approval_ref` | Applies the entry, records the approval reference, and states in the report that it cannot verify the approval |
| `locked` | Nothing: the team cannot override it | Rejects any entry, lists it as rejected with the reason, and keeps applying the pattern |

```yaml
overrides:
  - pattern: DR-DNS-001
    slots: [traffic-dns]
    justification: Internet-facing only; no on-prem DNS dependency
    owner_role: Application owner
    date: 2026-11-04
    approver_role: Platform architecture board
    approval_ref: ARB-2026-114
    alternative: Azure Front Door with health probes
    pattern_version: 1
```

- `slots` is optional and defaults to every slot the pattern decides. A blank `slots:` key counts as omitted, so it covers every slot too: write the slots you mean. When you write it, it must be a non-empty list. `alternative` is optional: it names the replacement decision, which is still checked against Azure reality. Without one the slot falls back to Microsoft Learn.
- `pattern_version` is optional. When it is set it must be an integer, and when the pattern is at another version the entry is rejected as stale.
- An entry is rejected, with its reason, when it names no pattern (an entry that is not a mapping lands here), when the pattern does not exist or is not approved, when the pattern is locked, when `slots` is empty or names a slot the pattern does not decide, when `pattern_version` is not an integer or is stale, when a required field is missing, or when `date` is not a real `YYYY-MM-DD` date. All the problems of one entry are in one reason. A rejected entry is listed in the report and never stops the run: the pattern keeps applying.
- A tier exception is not an override. When a numeric target is stricter than the tier, `objectives.exceptions[]` records that the tier's design does not meet it. One entry covers every target that is stricter than the tier, so name them in `what`. That is allowed even though DR-TIER-001 is locked, because the lock protects the tier definitions, not the team's choice of tier.

## applies_to

Optional keys: `workloads` and `environments` (lists of names, compared case-insensitively; a workload name matches the workload's name or its slug), `tiers` (integers 0 to 3) and `scenarios` (any of `zonal`, `regional`, `wider`, matched against `regions.failure_scope`). An omitted key means all. A key that is present must list at least one value. An unknown assessment value never switches a company pattern off: when `workloads` or `environments` is set and the assessment has no workload name or no `workload.environment`, the pattern applies, and the pattern register says so. A known value that does not match switches the pattern off. `tiers` and `scenarios` are never unknown in a run (the tier gate stops the run until a tier is set, and `failure_scope` defaults to `regional`), so a pattern restricted by `tiers` does not apply while `objectives.tier` is null.

## supersedes

`supersedes` lists the ids a pattern replaces. The replacement displaces the older pattern on the slots they share, directly or through a chain; the older pattern still decides its other slots. Two approved patterns that share a slot and whose `applies_to` ranges can overlap need a `supersedes` link between them, or lint fails. At run time, two applicable patterns with no link leave the slot unresolved: the engine never picks one by file order, name, version or date.

## Inputs and parameters

`inputs` declares values the application team supplies in `assessment.yaml` under `pattern_inputs.<ID>.<name>`. Each item has a `name` (lowercase letters, digits and underscores), a `description` and `required`. A required input that is null, missing or blank is an open input: the report lists it and writes "not supplied by the application team" where the value would go. The skill never guesses a value.

`parameters` is machine-readable data for the engine. DR-TIER-001 stores the tier bands under `parameters.tiers`, keyed 0 to 3:

```yaml
parameters:
  tiers:
    1:
      pattern: Hot/Warm (Active/Passive)
      rpo:
        text: Seconds–minutes
        min: 1s
        max: 59m
      rto:
        text: 30 minutes–2 hours
        min: 30m
        max: 2h
      cost: "~2.2×–2.5×"
```

`text` is the band as the tier table words it, and `min` and `max` are durations (`30m`, `2h`) or null. Tier 0 has no numeric band, so all four are null. Tiers 1 to 3 need a `min`: a numeric target below it is stricter than the tier. A test keeps the tier table and `parameters.tiers` in step.

## Sections

The fixed sections come first, in this order: `Required behavior`, `Rationale`, `Diagram elements`, `Runbook steps`, `Verification`. The optional sections follow, in this order: `Mandatory first step`, `Required response structure`, `Boundaries`. The first blockquote of `Mandatory first step` is the exact wording of the intake gate. Today only DR-TIER-001's first step (the tier question) runs as a gate: the gate ids are fixed, and `evaluateGates` in `lib/resolve.mjs` evaluates the tier question and the tier-versus-target check and nothing else. A new pattern's `Mandatory first step` therefore needs a code change in `evaluateGates` before it works as a gate; until then the model reads it like the rest of the pattern. Any other `## ` heading is a lint warning and is ignored by the engine; use `###` for sub-headings inside a section.

## Lint

`lint-patterns` fails on: a file without front matter or with invalid YAML, a missing, invalid or unknown front matter field, a file name that differs from `id`, duplicate ids, a slot outside the vocabulary, a missing, empty, duplicated or misordered section, a `Mandatory first step` without a blockquote, a `supersedes` entry that names an unknown id or forms a cycle, and two `approved` patterns that share a slot with overlapping `applies_to` ranges and no `supersedes` link between them. Ranges overlap when every key present in both has intersecting values.

```bash
node skills/azure-dr-assessment/scripts/lint-patterns.mjs
```

## Try another pack

Tests and scenarios point the engine at a fixture pack with `--patterns-dir <folder>` or the `DR_PATTERNS_DIR` environment variable on `lint-patterns` and `resolve-patterns`. While a non-default pack is active, `pattern-resolution.json` carries `nonDefaultPack: true` and a banner, and every output says so. The setting is never read from `assessment.yaml`.
