---
id: DR-MANUAL-001
version: 1
status: approved
slots: [failover-approval]
override: overridable
supersedes: []
owner_role: Incident management
---

# Failover requires approval

## Required behavior

- Customer-controlled failover requires incident-commander approval.

## Rationale

Fixture pattern for scenario DR-04: it collides with DR-AUTO-001 and neither supersedes the other.

## Diagram elements

- Show the approval step before the failover.

## Runbook steps

1. The incident commander approves the failover.

## Verification

- An approval step precedes the failover.
