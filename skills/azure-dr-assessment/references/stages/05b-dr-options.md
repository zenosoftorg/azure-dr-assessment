# Stage 5b: The DR options interview

Ask the owner once, in one message, which DR option each service takes when it has no native DR into the DR region. The answers go to `dr_choices` in `assessment.yaml`, so a rerun never asks about a recorded type. With nobody to answer, the recommendations are recorded as defaults and the run goes on.

## Inputs

- `evidence/dr-options.json` and the summary of `dr-options --classify` from step 8 of stage 5: `ask` lists the types that take a `dr_choices` entry, `question` is the question (null when nothing is worth asking).
- `assessment.yaml`: `dr_choices`, the answers of earlier runs.

## When to ask

Ask only when `question` is not null, and only once in a run. When it is null, or `ask` is empty, record the defaults (below) and go to stage 6 without a question: the record step also refreshes a default whose recommendation changed since the last run. A type is not in `ask` when:

- it is Native: a Verified mechanism reaches the DR region;
- a company pattern, or an override with an `alternative`, decides its slot (`decidedBy` of its row), unless Azure reality vetoes that pattern for the type (see "A pattern that Azure reality vetoes");
- it has a valid `dr_choices` entry, whoever chose it, `default` included.

A type in `ask` whose only option is `accept-gap` (no playbook and no option entry, such as network interfaces or public IPs) is not asked: the question lists such types in one line, `No DR option found, recorded as open gaps: <types>.`, and the defaults step records each as a default `accept-gap`, an open decision. The question has one block for every other type; types of one playbook with the same options (a virtual machine and its disks) share one block and one answer. When every type in `ask` is like that, `question` is null.

## How the script decides

`dr-options` classifies and recommends by fixed rules, so that the same evidence always gives the same question. You never do either by judgement.

- **DR path:** the kind of the highest-ranked option that is not vetoed: Native, Workaround, Split-region, Backup-restore, or No path when only accepting the gap is left. Options rank in playbook order; Learn-derived options rank by kind in that order, then in recording order. Every type also gets the option `accept-gap`.
- **Recommendation:** the first option whose Estimated RPO and RTO are within the tier band of DR-TIER-001 (or within the owner's `objectives.rpo` and `rto` when they are stricter) and whose target respects `constraints.data_residency`. An option with an `unknown` estimate or an Unverified claim never meets the tier. If none meets it, the first option that respects residency, marked `does not meet Tier <n>`; for Tier 0 without owner targets, `near zero cannot be tested`. `accept-gap` is recommended only when no option respects residency, or none is left.

## Ask

Ask with the host's question tool, in one message, the `question` of the summary word for word. The open-gaps line is part of it. Do not reword, reorder, shorten or extend it: the short names (`KV`) and the numbers map to types and option ids in `evidence/dr-options.json`, and the reply is read against them. Wait for the answer.

## Record the answer

Pass the owner's reply as it was written, with the role that answered:

```bash
node skills/azure-dr-assessment/scripts/dr-options.mjs --record --assessment dr-assessment/checkout/assessment.yaml --reply "KV 2, SA 1" --by "Application owner"
```

`accept recommendations` records the recommendation of every type the question asks, with the owner's role. A short name answers for every type of its block; a trailing period is fine. When the owner answers in words instead, record each choice by its option id, and only when the answer names the option without doubt; otherwise ask again:

```bash
node skills/azure-dr-assessment/scripts/dr-options.mjs --record --assessment dr-assessment/checkout/assessment.yaml --choice microsoft.keyvault/vaults=paired-failover-split --by "Application owner"
```

`--by` is a role, such as Application owner or Data owner, never a person's name or contact details. Exit 2 names every part of the answer that could not be read (an unknown short name, a number out of range, a service named twice, an option vetoed in this run, a type a pattern decides) and writes nothing: show the problems to the owner and ask once more. `--record` leaves `assessment.yaml` normalized, like intake: comments are not kept.

Then always record the defaults, whether the owner answered, nobody was asked, or `question` was null:

```bash
node skills/azure-dr-assessment/scripts/dr-options.mjs --record --assessment dr-assessment/checkout/assessment.yaml --defaults
```

It writes the recommendation with `chosen_by: default` for every type in `ask` that still has no valid entry, the open-gaps types included (`defaulted`), refreshes a default whose recommendation changed (`refreshed`, from and to) and replaces an invalid entry (`replaced`, with the problem). `openDecisions` lists the types whose entry is a default: they are open decisions, and stage 7 names each in the summary and the report. `--choice`, `--reply` and `--defaults` can go in one call; the answers are written first.

Check the result:

```bash
node skills/azure-dr-assessment/scripts/dr-options.mjs --validate --assessment dr-assessment/checkout/assessment.yaml
```

Exit 2 names each invalid entry as `<type>: <problem>`. `residencyWarnings` lists the choices whose target crosses the residency constraint: each is a residency Gap in the report and on the diagram annotation.

## Nobody to answer

When the host has no question tool, or the owner asked for an unattended run, do not ask. Record only the defaults. Unlike the tier question, the interview never ends the reply: go on to stage 6, and say in the summary that the DR options were defaulted, naming each type. A default is an open decision, not an owner's decision, and a default `accept-gap` is an unmet requirement, not a documented exception: an exception needs an owner.

## A pattern that Azure reality vetoes

When stage 5 shows that the pattern or override deciding a type's slot cannot work for that type, for example a paired-only mechanism when the DR region is not the primary's pair, v2's rule applies (an unmet requirement and a substitute) and the type is asked. Classify again with the type named, then ask:

```bash
node skills/azure-dr-assessment/scripts/dr-options.mjs --classify --assessment dr-assessment/checkout/assessment.yaml --ask-type microsoft.keyvault/vaults
```

The question then says which pattern decides the type and that Azure reality vetoes it.

## Reruns

A recorded type is never asked again, default or not. Only new types, and types whose entry became invalid (an option that a new playbook version renamed or that Azure reality vetoes in this run), are asked. `--defaults` recomputes every default entry on every run and says when one changed; an entry with a role stays as the owner wrote it. The owner confirms a default by writing a role into its `chosen_by` in `assessment.yaml`, or by answering when the skill asks about a new type.

## Inline and reasoning-only runs

No script runs. Read the playbooks in `skills/azure-dr-assessment/playbooks/` yourself, apply the rules of "How the script decides" by hand, and ask the question in the same shape (inline), or take the recommendations when there is no question tool. List the choices in the answer. Nothing persists them: a rerun asks again.

## Never

- Offer an option that is not in `evidence/dr-options.json`, drop one, or change its numbers.
- Recommend by judgement: the recommendation is the one `dr-options` computed.
- Record an answer with `--by` that the owner did not give. A default is `--defaults`, chosen by nobody.
- Call a default an owner decision.
- Ask about a type that a pattern or an override decides, unless Azure reality vetoes it (`--ask-type`).
- Ask the DR options question more than once in a run.

## Done when

`dr-options --validate` exits 0, every type that was asked has a `dr_choices` entry, and the defaulted types are noted for the summary.
