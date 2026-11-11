---
id: DR-FAILOVER-001
version: 1
status: approved
slots: [failover-approval]
override: overridable
applies_to:
  workloads: [checkout]
  environments: [production]
supersedes: []
owner_role: Incident management
---

# Customer-controlled failover is started by an authorized operator

## Required behavior

- Monitoring may detect incidents and recommend failover.
- The customer incident commander must approve customer-controlled failover.
- An authorized operator initiates the approved procedure.
- Failback requires separate approval.

## Rationale

Fixture pattern for the pattern engine tests and scenario DR-02: manual initiation after an approval.

## Diagram elements

- Show detection, approval, execution and traffic redirection as separate steps.

## Runbook steps

1. The incident commander approves the failover.
2. An authorized operator initiates the approved procedure.

## Verification

- Detection, approval, execution and traffic redirection are distinct steps with distinct owners.
