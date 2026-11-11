---
id: DR-NEW-002
version: 2
status: approved
slots: [detection]
override: overridable
supersedes: [DR-OLD-001]
owner_role: Platform architecture
---

# Detection uses synthetic probes

## Required behavior

- Detection uses synthetic health probes that run from outside the primary region.

## Rationale

Fixture pattern for the supersedes tests: it replaces DR-OLD-001 on the slots they share.

## Diagram elements

- Show the probe and the region it runs from.

## Runbook steps

1. Confirm the incident from the probe results.

## Verification

- The probe runs outside the primary region.
