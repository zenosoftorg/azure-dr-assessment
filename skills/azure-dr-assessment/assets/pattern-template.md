---
id: DR-EXAMPLE-001                  # DR-<AREA>-<NNN>; must equal the file name without .md
version: 1                          # integer; bump it on any behavioral change, reports cite "ID vN"
status: draft                       # draft, approved, deprecated or superseded; only approved applies
slots: [compute]                    # the decision slots this pattern decides (see patterns/README.md)
override: overridable               # overridable, approval-required or locked
applies_to: {}                      # optional; narrow with workloads, environments, tiers (0 to 3) or scenarios (zonal, regional, wider); omit a key to mean all
supersedes: []                      # ids of patterns this one replaces on shared slots
owner_role: Platform architecture   # the role accountable for the pattern
inputs: []                          # optional; items { name, description, required } the application team supplies under pattern_inputs.<ID>.<name>
parameters: {}                      # optional; machine-readable data the engine reads
---

# Short policy name

## Required behavior

State what the company requires as testable statements. Write rules, not advice.

- The workload must ...

## Rationale

Why the company requires it, and who agreed. One short paragraph.

## Diagram elements

What the DR diagram must show for this pattern: components, groups, and the label of each edge.

- Show ...

## Runbook steps

What the runbook must include: decision criteria, the approving role, the executing role, the steps in order, and the checks.

1. ...

## Verification

Checks that run against the finished design. A failed check is a Gap that names the weakest link and this pattern's ID.

- Check that ...

## Mandatory first step

Optional. Delete this section unless a question must be settled before any proposal. The first blockquote is the exact wording the intake gate asks, so write it as the user should read it.

> Write the exact question and its options here.

## Required response structure

Optional. Delete this section unless the report must follow an ordered list of sections. Write the section names as a numbered list.

1. First section name

## Boundaries

Optional. Delete this section unless the pattern needs limits stated: what it does not cover or authorize.

- This pattern does not ...
