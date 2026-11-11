---
id: DR-FAILOVER-002
version: 1
status: draft
slots: [failover-approval]
override: overridable
applies_to:
  workloads: [checkout]
  environments: [production]
supersedes: []
owner_role: Incident management
---

# Customer-controlled failover starts automatically

## Required behavior

- Customer-controlled failover starts automatically after health checks fail.

## Rationale

Fixture draft for scenario DR-02: a draft is informational only and never applies.

## Diagram elements

- Show health checks starting the failover.

## Runbook steps

1. Health checks fail and the failover starts without an approval step.

## Verification

- The failover starts without a human approval step.
