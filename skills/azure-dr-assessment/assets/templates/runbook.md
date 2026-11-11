# Recovery runbook

> **DRAFT: not an operational procedure until rehearsed and approved by the owner.**

<!-- fill: one line with the workload, the tier, the primary and DR regions and the date of this draft -->

## 1. Preconditions and decision authority

<!-- fill: the disaster scenario and the recovery boundary, what must be true before failover starts, who decides failover and failback, and who executes them -->

## 2. Detection and triggers

<!-- fill: the health signals, how an incident is detected, and the triggers for declaring a regional failure -->

## 3. Recovery steps by component

<!-- fill: the order of the services below and the steps that join them. One subsection per service, written by establishment-guide --inject-runbook from its playbook; fill its owner roles and the rows of a service without a playbook. Every time is Estimated until a drill record shows it as Demonstrated. -->

<!-- dr-guide:runbook -->
<!-- /dr-guide:runbook -->

## 4. Traffic switch

<!-- fill: how users reach the recovery region. When DR-DNS-001 applies: the on-prem DNS record change, its record type and TTL from pattern_inputs, who changes it, and that the TTL wait counts toward RTO. Name Traffic Manager or Front Door only as a documented alternative that is not applied. -->

## 5. Business verification

<!-- fill: the application and data integrity checks and who signs them off -->

## 6. Failback and resynchronization

<!-- fill: the conditions for failback, the resynchronization of data, the order, and the verification -->

## 7. Return to steady state

<!-- fill: how protection of the recovered workload is restored and what is re-established in the recovery region -->

## 8. Test plan

<!-- fill: rehearsal scenarios, frequency, measurement method, evidence and ownership. Every time stays Estimated until a drill record shows it as Demonstrated. Give commands or infrastructure-as-code only when asked, and label them untested. -->
