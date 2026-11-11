---
id: DR-OLD-001
version: 1
status: approved
slots: [detection, testing]
override: overridable
supersedes: []
owner_role: Platform architecture
---

# Older detection and testing rules

## Required behavior

- Detection raises an incident within the agreed window.
- A DR test runs once a year.

## Rationale

Fixture pattern for the supersedes tests: it is displaced on `detection` and keeps `testing`.

## Diagram elements

- Show the detection signal.

## Runbook steps

1. Confirm the incident from the detection signal.

## Verification

- The detection window is stated.
