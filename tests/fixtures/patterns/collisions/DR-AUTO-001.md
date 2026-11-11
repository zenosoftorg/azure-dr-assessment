---
id: DR-AUTO-001
version: 2
status: approved
slots: [failover-approval]
override: overridable
supersedes: []
owner_role: Incident management
---

# Failover starts automatically

## Required behavior

- Customer-controlled failover must start automatically after health checks fail.

## Rationale

Fixture pattern for scenario DR-04: it collides with DR-MANUAL-001 and neither supersedes the other.

## Diagram elements

- Show the health checks starting the failover.

## Runbook steps

1. Health checks fail and the failover starts.

## Verification

- No human approval step precedes the failover.
