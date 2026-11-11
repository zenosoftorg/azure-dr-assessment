---
id: DR-DNS-001
version: 1
status: approved
slots: [traffic-dns]
override: approval-required
supersedes: []
owner_role: landing zone platform architecture
inputs:
  - name: record_type
    description: The type of the on-prem DNS record that is changed at failover
    required: true
  - name: ttl
    description: The TTL of that record, in seconds
    required: true
  - name: record_owner_role
    description: The role that changes the on-prem DNS record at failover
    required: true
  - name: private_zone_integration
    description: How the Azure-hosted private DNS zones that the workload uses integrate with the on-prem DNS
    required: true
---

# On-prem DNS is authoritative for failover

## Required behavior

- The company's on-prem DNS is authoritative for the application's names. The design reaches the DR region by changing the on-prem DNS record, not through an Azure-side global router.
- `traffic-dns` resolves to this pattern (cite it as DR-DNS-001 v1), ahead of Microsoft Learn guidance, which proposes Azure Traffic Manager for failover routing.
- Azure Traffic Manager appears only as a documented alternative, labeled not applied. It is never drawn as part of the design.
- The DR diagram shows the on-prem record path, and the runbook includes the record change with its owner.
- The TTL wait counts toward RTO: the RTO estimate for the traffic switch includes the time the old record can stay cached, which is the TTL.
- The application team supplies four inputs under `pattern_inputs.DR-DNS-001` in `assessment.yaml`: `record_type`, `ttl`, `record_owner_role` and `private_zone_integration`. Never guess or default a value. Where an input is missing, write "not supplied by the application team" and list it as an open input.
- Azure-hosted private DNS zones that the workload uses are shown with their integration with the on-prem DNS, as the `private_zone_integration` input states it.

## Rationale

The company runs its own DNS on-premises, and that DNS is authoritative for the application's names. A DR design therefore depends on it, not on the Azure Traffic Manager that Azure documentation proposes. This pattern is drafted from that statement by the pattern owner. The record type, the TTL, who changes the record and how Azure-hosted private zones integrate are not set here: the application team supplies them as inputs, so that no value is invented.

The override level is approval-required and the pattern applies to every tier, as planning assumptions. The pattern owner confirms this text before the first release.

## Diagram elements

- Show the on-prem DNS as its own on-prem group beside the two regions, holding the authoritative record for the application's name.
- Draw the traffic path from the record to the primary region's entry point before failover, and a failover edge from the same record to the DR region's entry point after the change. Label the failover edge "change on-prem DNS record" with the record type and the TTL. When an input is missing, label it "record type: not supplied by the application team" or "TTL: not supplied by the application team".
- Show the integration of the Azure-hosted private DNS zones with the on-prem DNS when `private_zone_integration` is supplied. Otherwise label the link "private zone integration: not supplied by the application team".
- Do not draw Azure Traffic Manager as part of the design. Name it only in an annotation, as a documented alternative that is not applied.

## Runbook steps

- Traffic switch: change the on-prem DNS record for the application's name so that it points to the DR region's entry point. The owner of the step is the role in `record_owner_role`. When it is missing, write "owner: not supplied by the application team".
- Record: state the record type from `record_type` and the TTL from `ttl`. When either is missing, write "not supplied by the application team".
- Duration: the estimate for the traffic switch includes the TTL wait, because clients can keep the old answer for up to the TTL. When `ttl` is missing, write "TTL wait: not supplied by the application team" and do not estimate it.
- Verify: resolve the application's name from a client network and confirm that it returns the DR region's entry point. Abort condition: the record change is not visible on the authoritative on-prem DNS.
- Failback: change the record back to the primary region's entry point, with the same owner and the same TTL wait.
- Decision authority: the record is changed only after the failover decision has been taken by the role that the failover-approval decision names. This pattern does not authorize running the change.

## Verification

- `traffic-dns` cites DR-DNS-001 and its version, or a documented override with its approval reference.
- The DR diagram shows the on-prem record path, and no Azure Traffic Manager node.
- The runbook has the record change with its owner, and a TTL wait that is counted in the RTO estimate.
- Every missing input is reported as an open input and written as "not supplied by the application team". No record type, TTL, record owner or private zone integration is assumed.
- Tier 0: a manual record change cannot reach near-zero RTO. Report the DNS step as the weakest link and a Gap for the Tier 0 objective. Do not change the tier, and do not replace this pattern's decision.
- Azure Traffic Manager appears only as a documented alternative, labeled not applied.

## Boundaries

- A Tier 0 design cannot reach near-zero RTO through a manual record change. The verification therefore reports the DNS step as the weakest link, a Gap, instead of overriding the tier.
- This pattern does not authorize running the record change, a failover or any Azure change. The change is executed by the owner named in `record_owner_role`, after the failover decision.
- It does not choose the record type, the TTL, the record owner or the private zone integration. The application team supplies them.
- It decides only the `traffic-dns` slot.
