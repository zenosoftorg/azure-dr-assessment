---
service: <kebab-case slug, equal to the file name without .md, for example key-vault>
title: <display name, for example Azure Key Vault>
arm_types:
  - <lowercase ARM type, for example microsoft.keyvault/vaults; a type belongs to one playbook only>
slot: <one slot id from patterns/README.md, for example secrets-keys>
version: 1
verified_on: <YYYY-MM-DD, the date of the second pass>
learn_sources:
  - <https://learn.microsoft.com/ page; list every page that a Source line cites, without its fragment>
---

# <title>

<!--
A service playbook holds generic Azure know-how for one service: no customer names, resources, ids or
inventory content, and no secrets. Every claim in sections 1 to 3 cites a https://learn.microsoft.com/ page
in a "- Source:" line, and that page (without its #fragment) is listed in learn_sources.
Keep the six "## " sections below, with these exact headings, in this order. Inside a section, "### "
headings open entries and "- Key: value" lines (one line each) hold their fields.
Estimates start with a duration (30m, 4h, 1d, 0) or with unknown, followed by the basis in brackets:
the Learn figure, the design parameter the team sets, or why Learn gives no figure. Never invent a number.
Check the file with: npm run lint:playbooks
The procedure, the second pass and the acceptance checks are in playbooks/README.md.
-->

## Mechanisms

<!--
One entry per built-in mechanism of the service, named as Learn names it (stage 5 records its ledger entry
under the same name). Paired and Nonpaired are yes or no: does the mechanism reach the primary's pair, and
does it reach a region that is not the pair? A service without built-in multiregion replication lists its
in-region mechanism with Paired: no and Nonpaired: no.
Failover is one of Microsoft-managed, customer-managed, manual, not applicable.
-->

### <mechanism name>
- Replicates: <data, metadata or both, and what exactly>
- Paired: <yes or no>
- Nonpaired: <yes or no>
- Failover: <Microsoft-managed, customer-managed, manual or not applicable>
- Estimated RPO: <duration or unknown> (<basis>)
- Estimated RTO: <duration or unknown> (<basis>)
- Source: <https://learn.microsoft.com/... page, with an optional #fragment>

## Constraints

<!--
One entry per constraint that bears on DR: geography and residency, SKU and tier, zones, limits.
The heading is unique: stage 5 checks each constraint against Learn under this heading.
One or more lines of prose, then exactly one Source line.
-->

### <constraint heading>
<what Learn says, in one or more lines of prose>
- Source: <https://learn.microsoft.com/... page>

## Non-paired options

<!--
One entry per option, in rank order (the first is rank 1): native, then documented workaround, then split to
the service's pair, then backup-restore. The option id is a kebab-case slug, unique, stable across versions,
and never accept-gap (reserved). Kind is native, workaround, split-region or backup-restore. Target is
pair-region for a split-region option and dr-region for every other kind. Uses mechanism is a mechanism name
of section 1, or none. Every field below is required; Cost notes never quote a price. An optional
"- Decides slots: <slot id>, ..." names the slots the option decides itself (its own traffic switch, for
example); a company pattern that decides one of them vetoes the option.
-->

### <option-id>: <option title>
- Kind: <native, workaround, split-region or backup-restore>
- Target: <dr-region or pair-region>
- Uses mechanism: <a mechanism name of section 1, or none>
- Estimated RPO: <duration or unknown> (<basis>)
- Estimated RTO: <duration or unknown> (<basis>)
- Prerequisites: <quota, SKU, network, roles, and what to check first>
- Cost notes: <what adds cost; no price>
- Gives up: <the key trade-off, shown in the DR options question>
- Recommended when: <the tier, residency or workload shape where this option fits>
- Source: <https://learn.microsoft.com/... page>

## Migration from a paired setup

<!-- The six parts, with these headings, in this order. Build, Validate, Cut over and Decommission are numbered lists. -->

### Recognise today's setup
<how today's paired DR shows in an inventory, for example GRS, an ASR target in the pair, a geo-redundant vault; say what the inventory cannot show>

### Build
1. <step>

### Validate
1. <step, naming the test criteria it runs>

### Cut over
1. <step>

### Decommission
1. <step, only after validation passed>

### Keep until cut-over
<what must stay in place until the cut-over>

## Failover and failback

<!--
One table each, with exactly this header and at least one row. Roles, never names. Every cell is filled.
An Estimated duration starts with the word Estimated. Step labels (here and in Build, Cut over, Decommission):
a step that applies to every option has no label; a step that applies to exactly one option starts with
"<option-id>: "; a step that applies to two or more options, but not all, is written once per option, each
copy starting with "<option-id>: ". Any other form ("a, b:", "a (qualifier):", "All options:") is read as
applying to every option. A qualifier goes after the colon. Refer to another step by its part and what it
does ("the Build step that creates the second instance"), never by its number: the guide and the runbook
renumber the steps of the chosen option (lint rule step-number).
-->

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | <step> | <role> | Estimated <duration, or how it is set> | <how the step is verified> | <when to stop> |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | <step> | <role> | Estimated <duration, or how it is set> | <how the step is verified> | <when to stop> |

## Test criteria

<!--
Criteria are numbered TC-1, TC-2, TC-3 without gaps. Applies to lists option ids of this playbook, separated by
commas; every option is listed by at least one criterion. The pass condition is measurable (a count, a
duration, a comparison), never "works" or "is compliant".
-->

### TC-1: <title>
- Applies to: <option-id>[, <option-id>]
- Pass condition: <measurable condition>
- How to measure: <the query, probe, job or drill>
- Evidence: <what to keep>
- Frequency: <how often>
