---
id: DR-TIER-001
version: 1
status: approved
slots: [objectives]
override: locked
supersedes: []
owner_role: landing zone platform architecture
parameters:
  source: company tier file azure-dr.instructions.md (Azure DR Architecture — Landing Zone Workload Tiers), copied 2026-11-04
  tiers:
    0:
      pattern: Active/Active
      rpo:
        text: Near zero
        min: null
        max: null
      rto:
        text: Near zero
        min: null
        max: null
      cost: "~2.2×–2.5×"
    1:
      pattern: Hot/Warm (Active/Passive)
      rpo:
        text: Seconds–minutes
        # Derived reading: the tier file gives no numbers for "seconds–minutes". min 1s and max 59m are this repository's reading of the words, open until release gate Bands closes (RELEASING.md).
        min: 1s
        max: 59m
      rto:
        text: 30 minutes–2 hours
        min: 30m
        max: 2h
      cost: "~2.2×–2.5×"
    2:
      pattern: Hot/Cold — minimal secondary compute (ASR)
      rpo:
        text: 1–4 hours
        min: 1h
        max: 4h
      rto:
        text: 4–12 hours
        min: 4h
        max: 12h
      cost: "~1.3×–1.6×"
    3:
      pattern: Cold (Backup/Restore)
      rpo:
        text: 24+ hours
        min: 24h
        max: null
      rto:
        text: 24–72 hours
        min: 24h
        max: 72h
      cost: "~1.05×–1.3×"
---

# Landing zone application disaster recovery (DR) design instructions

Source: the company tier file `azure-dr.instructions.md` ("Azure DR Architecture — Landing Zone Workload Tiers"), copied on 2026-11-04. The tier file wording is kept without changes. The tier file `##` headings are one level lower here (`###`) and the tier file `###` headings two levels lower (`####`), so the fixed sections stay the only `##` headings. A change to the company tier rules needs a pull request that updates this file and `parameters.tiers`.

## Required behavior

### Scope and responsibility

The company landing zone (LZ) provides shared Azure platform foundations. **Workload teams remain responsible for designing, implementing, operating, and testing DR for their own applications** using one of the four patterns below. Do not assume that availability of platform connectivity or secondary regions automatically means the application is recoverable.

**Apply this workflow when asked for an application-specific DR architecture, deployment plan, resilience assessment, failover/failback process, or recovery test.** For unrelated programming questions or general comparisons of DR patterns, do not interrupt with tier selection.

### Landing zone DR tier reference: authoritative planning targets

| Tier | DR pattern | Target RPO | Target RTO | Relative cost vs. single region | Best fit |
| --- | --- | --- | --- | --- | --- |
| **Tier 0** | **Active/Active** | **Near zero** | **Near zero** | **~2.2×–2.5×** | Mission-critical: near-zero tolerance for downtime |
| **Tier 1** | **Hot/Warm (Active/Passive)** | **Seconds–minutes** | **30 minutes–2 hours** | **~2.2×–2.5×** | Business-critical: low RTO, fully running secondary |
| **Tier 2** | **Hot/Cold — minimal secondary compute (ASR)** | **1–4 hours** | **4–12 hours** | **~1.3×–1.6×** | Important workloads: moderate RTO, cost-conscious |
| **Tier 3** | **Cold (Backup/Restore)** | **24+ hours** | **24–72 hours** | **~1.05×–1.3×** | Low-criticality workloads: high RTO tolerance |

**Definitions:** RPO = maximum acceptable data loss measured in time. RTO = maximum acceptable time to restore required business functionality. These are **planning objectives, not Azure service guarantees**. Actual achievable values depend on architecture, service support, data volume, dependencies, failure scenario, automation, and successful testing. The cost multipliers are high-level relative planning estimates from the company tier framework, **not Azure price quotes**.

For 'near zero,' request explicit measurable business thresholds before claiming any target is achievable. Near zero is not automatically zero data loss or zero interruption.

### Discovery after tier selection

Ask concise questions in small batches, and use known repository or user-provided facts rather than asking again. Gather enough information to make the design actionable:

1. **Workload:** application purpose, business-critical functions, users, traffic patterns, and workload owner.
2. **Azure services and state:** compute (VMs, AKS, App Service, Functions, etc.), databases, storage, messaging, identity, secrets, external integrations, and data consistency needs.
3. **Regions and failure scope:** primary and candidate recovery region(s), regional/data-residency restrictions, availability-zone design, and whether the goal covers zonal, regional, or wider failures. Support non-paired regions when required; never assume Azure paired-region-only features will work between arbitrary regions.
4. **Dependencies:** shared infrastructure, landing zone networking and routing, DNS, ingress, private endpoints, on-premises connectivity, certificates, key management, security controls, and dependent applications.
5. **Operational constraints:** throughput, replication lag, backup retention, recovery order, failover decision and ownership, manual vs. automated steps, cost ceiling, and testing constraints.

If a critical input is unknown, state it as an assumption or open decision. Avoid pretending to know the specific regional availability or capabilities of Azure services.

### Design rules by tier

#### Tier 0 — Active/Active
- Design for two active, adequately provisioned regional application instances with health-based global traffic management and regional failure isolation.
- Determine how each stateful component meets the required replication, consistency, write-routing, conflict handling, and data-loss constraints. Assess whether near-zero RPO is technically feasible for the chosen services and region distance.
- Explain healthy-operation traffic distribution, degraded-region behaviour, automatic/manual cutover conditions, recovery of the failed region, and split-brain risks.
- Do not label a design 'near-zero RPO/RTO' without an explicit validation plan and measured evidence.

#### Tier 1 — Hot/Warm (Active/Passive)
- Maintain a **fully running, application-ready secondary**, even if it serves no production traffic until failover.
- Specify replication mode, data consistency, pre-provisioned capacity, service health detection, traffic cutover, failover orchestration, and dependency readiness.
- Show how runbooks and tests will support **seconds–minutes RPO** and **30 minutes–2 hours RTO**.
- Do not downgrade the secondary to on-demand infrastructure while still calling it Tier 1.

#### Tier 2 — Hot/Cold (minimal secondary compute)
- Prioritise replicated application state, essential landing-zone and network prerequisites, and **minimal secondary compute** until recovery is invoked.
- Consider **Azure Site Recovery (ASR) for supported VM-based workloads**, and suitable service-native replication/recovery for PaaS components; ASR is not a universal DR solution for all Azure services.
- Document the time to allocate or scale secondary compute, activate services, recover databases, reconnect dependencies, and direct traffic.
- Show how orchestration and testing will meet **1–4 hours RPO** and **4–12 hours RTO**, without assuming on-demand regional capacity is guaranteed.

#### Tier 3 — Cold (Backup/Restore)
- Prefer protected, appropriately isolated backups and reproducible infrastructure/application deployment rather than always-on secondary compute.
- Define backup frequency and consistency, retention, protection against accidental deletion or ransomware, cross-region restore feasibility, capacity prerequisites, and restore sequence.
- Include full-data restore duration, infrastructure re-creation, identity/secrets and integration recovery, and service verification.
- Show how the backup schedule supports **24+ hours RPO** and rehearsed restore procedures support **24–72 hours RTO**.

### Required architecture assessment

For every DR design:

- Separate **landing zone platform prerequisites** (for example, subscriptions, policies, network/identity foundations, regional connectivity and operational services) from **workload-owned responsibilities** (data replication, application topology, deployment, recovery sequencing, failover logic, business verification, and runbooks). Mark unverified platform capabilities as dependencies.
- Define the **disaster scenario and recovery boundary** before claiming an RTO/RPO, including regional failure, zone failure, and dependencies outside the chosen recovery region.
- Design **compute, data, networking/ingress, DNS, identity, secrets, monitoring, and external dependencies** as an end-to-end recovery path. A replicated database or powered-on VM is not necessarily a recovered application.
- Check **Azure-service-specific DR support, region/zone availability, SKU and quota/capacity constraints, replication direction, cross-region/cross-subscription support, and regional compliance requirements** against current authoritative documentation where access is available. Flag anything not verified. Do not invent regional product support.
- Explain **failover triggers, decision authority, recovery sequence, traffic switch, application/data integrity checks, failback, resynchronisation, and steady-state restoration**.
- Consider **planned maintenance, accidental deletion, corruption, security incidents, and region-wide outages**; asynchronous replication alone does not protect against all failure classes.
- Treat **RPO and RTO as end-to-end outcomes**: identify the component or manual step most likely to violate each target.
- Include **DR rehearsal scenarios, test frequency, measurement method, evidence, and ownership**, and clearly distinguish estimated from demonstrated recovery times.
- Compare the architecture's broad recurring-cost profile to the tier multiplier above, without presenting the multiplier as a validated bill of materials.
- Prefer practical Azure design options and infrastructure-as-code/runbook examples when asked, but never claim untested code implements a guaranteed DR SLA.

## Rationale

This pattern is locked. It carries the company tier definitions: the bands, the design rules, the relative cost ratios and the response structure. An application team cannot override them, because they are the platform team's definition of what each tier means. The lock protects the definitions, not the team's choice of tier: the team states the tier, and when a numeric target is stricter than the tier it records an `objectives.exceptions` entry instead of an override. The tier's rules stay in force, and the report says that the tier's design does not meet the target.

RPO and RTO here are "planning objectives, not Azure service guarantees". The rules above are checked against the finished design, and the report never writes "compliant" or "achieved" without test evidence.

The landing zone team owns the source rules. A change to them needs a pull request that updates this file, including `parameters.tiers`.

## Diagram elements

Derived by this repository from the rules above.

- Title the diagram with the selected tier and its pattern as the tier table words it: Active/Active, Hot/Warm (Active/Passive), Hot/Cold — minimal secondary compute (ASR), or Cold (Backup/Restore).
- Show the primary region and the recovery region as separate groups. Label each replication, traffic and failover edge with its mechanism, and mark each stateful component with its replication mode.
- Tier 0: show two active, adequately provisioned regional instances behind health-based global traffic management, and the write path of each stateful component.
- Tier 1: show the fully running, application-ready secondary and the cutover path to it, even though it serves no production traffic until failover.
- Tier 2: show the replicated state, the landing-zone and network prerequisites, and the minimal secondary compute. Mark where Azure Site Recovery is used.
- Tier 3: show the protected, isolated backups and the cross-region restore path. Show compute as re-created at recovery, not running.
- Mark the components that the landing zone platform owns apart from those the workload team owns, and mark unverified platform capabilities as dependencies.

## Runbook steps

Derived by this repository from the rules above.

- Open with the disaster scenario and the recovery boundary: regional failure, zone failure, and dependencies outside the recovery region.
- State the failover triggers, who decides failover and failback, and who executes them.
- Order the recovery sequence by component. Give each step an owner, an estimated duration, a verification and an abort condition.
- Include the traffic switch, the application and data integrity checks, failback, resynchronisation and steady-state restoration.
- Tier 0: include healthy-operation traffic distribution, degraded-region behaviour, the automatic or manual cutover conditions, recovery of the failed region and split-brain handling.
- Tier 1: include the replication mode and data consistency checks, the capacity check of the secondary, service health detection and the failover orchestration.
- Tier 2: include the time to allocate or scale secondary compute, activate services, recover databases, reconnect dependencies and direct traffic.
- Tier 3: include the backup frequency and retention, the full-data restore duration, infrastructure re-creation, and identity, secrets and integration recovery.
- End with the test plan: rehearsal scenarios, test frequency, measurement method, evidence and ownership. Label every time Estimated until a drill record shows it as Demonstrated.
- Give commands or infrastructure-as-code only when asked, and label them untested.

## Verification

Derived by this repository from the rules above.

Run these checks against the finished design. A failed check is a Gap that names the weakest link and cites DR-TIER-001 and its version.

- The tier is the one the owner supplied. It was not inferred from names or importance.
- Every numeric RPO and RTO target is inside or looser than the tier's band, or an `objectives.exceptions` entry records that the tier's design does not meet it. The report states the mismatch either way.
- Every RPO and RTO is labeled Estimated or Demonstrated, and Demonstrated only where a drill record exists. No text calls an objective compliant or achieved without test evidence.
- A "near zero" target has measurable business thresholds. Without them it is an open input, not a claim.
- Tier 0: two active, adequately provisioned regional instances sit behind health-based global traffic management, and every stateful component states its replication, consistency, write routing and conflict handling. If a decision in another slot depends on a manual step, name that step as the weakest link and a Gap for near-zero RTO. Do not change that decision.
- Tier 1: the secondary is fully running and application-ready. A secondary that exists only as on-demand infrastructure fails this check.
- Tier 2: replicated state and the landing-zone and network prerequisites exist, secondary compute is minimal, Azure Site Recovery is used only for supported VM workloads, the time to scale and activate is documented, and on-demand regional capacity is not assumed.
- Tier 3: backups are protected and isolated, cross-region restore is feasible for every in-scope service, and the restore sequence and duration are documented.
- Landing zone platform prerequisites and workload-owned responsibilities are listed separately, and unverified platform capabilities are marked as dependencies.

## Mandatory first step

**Before proposing or generating an application-specific DR architecture, ask the user to choose their DR tier if they have not already specified it.** Ask the tier question first, without bundling it with other discovery questions. Do not infer or silently assign a tier from application names or perceived importance. If the user has already explicitly provided a tier, acknowledge it and proceed without asking again.

Use this wording (or an equally clear version):

> **Which landing zone DR tier applies to this application?**
>
> - **Tier 0 — Active/Active:** RPO **near zero**; RTO **near zero**. Mission-critical workloads.
> - **Tier 1 — Hot/Warm (Active/Passive):** RPO **seconds–minutes**; RTO **30 minutes–2 hours**. Business-critical workloads.
> - **Tier 2 — Hot/Cold (minimal secondary compute; Azure Site Recovery where appropriate):** RPO **1–4 hours**; RTO **4–12 hours**. Important, cost-conscious workloads.
> - **Tier 3 — Cold (Backup/Restore):** RPO **24+ hours**; RTO **24–72 hours**. Low-criticality workloads.
>
> Reply with **0, 1, 2, or 3**. If you are unsure, describe the business impact of data loss and downtime, and we can determine the appropriate tier together.

After a selection, restate the chosen pattern and its RTO/RPO targets, then ask only the most consequential missing discovery questions. If the user gives an explicit numerical target that is stricter or incompatible with the tier, highlight the mismatch and ask whether to change tiers or retain a documented exception.

## Required response structure

1. **Selected landing zone tier and recovery objectives** — pattern, RPO, RTO, relative cost guidance; any business-specific overrides.
2. **Assumptions and failure scope** — primary/secondary regions, dependencies, exclusions, outstanding inputs.
3. **Proposed architecture** — regional topology, component-by-component DR mechanisms, and data consistency approach.
4. **Failover and failback sequence** — including estimated durations, triggers, ownership, and user/business verification.
5. **RPO/RTO feasibility assessment** — evidence and reasoning for both; bottlenecks, risks, and mitigations. Use **Unverified** where proof is missing; never mark objectives as guaranteed.
6. **Landing zone versus workload-team actions** — explicit ownership and prerequisites.
7. **Validation plan and next steps** — measurable recovery test criteria, unresolved decisions, and recommended implementation order.

If the business target is not feasible with the selected design, **say so explicitly** and offer design changes or a revised tier rather than masking the gap.

## Boundaries

- This pattern decides only the `objectives` slot. Its per-tier rules reach the other slots as constraints the design must meet and as the Verification checks above. It never rewrites another pattern's decision.
- It does not authorize running a failover, a failback or any Azure change.
- It sets no prices. The relative cost ratios are planning ratios against a single-region deployment, not price quotes.
