# DR assessment

<!-- fill: one line with the workload name, the tier and its pattern, the primary region and its pair status, the DR region and the failure scope; replace this comment -->

> **Draft for the owner's review.** RTO and RPO are objectives, not guarantees. Nothing in this report is compliant or achieved without test evidence.

<!-- fill: when evidence/pattern-resolution.json has a banner, put it here as a blockquote line; otherwise delete this comment -->

## 1. Selected landing zone tier and recovery objectives

<!-- fill: the pattern, RPO, RTO and relative cost guidance of the selected tier (DR-TIER-001, pattern ID and version), any business-specific targets and who set each, and any tier exception stated plainly. The cost ratio is a planning ratio, never a price. -->

## 2. Assumptions and failure scope

<!-- fill: the primary and DR regions with their pair status (cite the R- entries), the failure scope, dependencies, exclusions, and the outstanding inputs, including the open inputs of every applied pattern and the DR-TIER-001 discovery questions turned into assumptions. Label each assumption Inferred or Unknown. List every DR choice that nobody made (`chosen_by: default` in `dr_choices`) as an open decision, with its type and option. -->

## 3. Proposed architecture

<!-- fill: the regional topology (link the proposed-DR diagram and presentation), then each component or service class with its DR mechanism and its class (Any-pair, Paired-only, No built-in multiregion), its status (Gap, Unknown, Supported by configuration, Not assessed), any substitute (Proposed, or an unmet requirement) and the data consistency approach. Every recommendation shows its evidence reference, its documented source, its pattern ID and version if any, and the decision or the open gap. A slot that an override waives without an alternative follows Microsoft Learn: cite the documents and name the override. Link each component to its chapter of the establishment guide (dr-establishment-guide.md#chapter-<anchor>). -->

## 4. Failover and failback sequence

<!-- fill: triggers, decision authority, order, estimated durations, verification and the traffic switch. When DR-DNS-001 applies, show the on-prem DNS record change and its owner, and count the TTL wait toward RTO. Link reports/recovery-runbook.md. -->

## 5. RPO/RTO feasibility assessment

<!-- fill: for each target, whether it is Estimated or Demonstrated (Demonstrated only with a drill record), the weakest component, the evidence, the risks and the mitigations. Say plainly when a target is not feasible with this design and offer a design change or a revised tier. Compare the design's recurring-cost profile with the tier ratio without quoting prices. Use Unverified where proof is missing. -->

## 6. Landing zone versus workload-team actions

<!-- fill: what the landing zone platform owns and what the workload team owns, the prerequisites of each, and the platform capabilities that are Unverified as dependencies. -->

## 7. Validation plan and next steps

<!-- fill: rehearsal scenarios, frequency, measurement method, evidence and owners (reference the consolidated test plan of reports/dr-establishment-guide.md instead of repeating it), the decisions the owner still has to make, every default DR choice among them as an open decision, and the recommended implementation order (the build order of the guide). List each Verification check that was skipped because an override waives its slot as `Not checked: waived by Override #<n>`, with the pattern ID and version. -->

## A. Current-state architecture

<!-- fill: the observed and the inferred architecture (link the current-state diagram and presentation), every Unknown that matters, and any mismatch between the declared primary region and the regions of the in-scope resources. -->

## B. Evidence and unknowns

<!-- dr-tables:evidence -->
<!-- /dr-tables:evidence -->

## C. Documentation sources

<!-- dr-tables:sources -->
<!-- /dr-tables:sources -->

## D. Pattern register and documented exceptions

<!-- dr-tables:patterns -->
<!-- /dr-tables:patterns -->
