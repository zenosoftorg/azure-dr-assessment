# Azure DR assessment acceptance scenarios

## Purpose

Verify that azure-dr-assessment produces evidence-based Azure DR advice from an inventory, a tier and two regions, applies the bundled company patterns and the override rules correctly, handles regions that are not a pair, and keeps customer artifacts outside its installation directory.

Synthetic scenarios test assessment behavior. They do not prove that Azure access or a live subscription works.

## Running the scenarios

1. Baseline: use a fresh Copilot session without azure-dr-assessment loaded.
2. Paste only the scenario's Prompt, not its acceptance criteria. Prepare the Setup first.
3. Preserve the response and the actual tool activity.
4. After installing the skill, repeat in a fresh session using: "Use the /azure-dr-assessment skill for the following assessment." Then paste the same Prompt.
5. Record observed results. Never infer that a tool was called from a source link or a statement in the response.

Three kinds of scenario, and the setup they share:
- **Inline scenarios** (DR-01 to DR-04 and DR-07 to DR-09). The prompt says "Do not write files" and describes the workload itself, so there is no inventory file. The skill runs in inline mode: no script runs, it answers in chat in the order of the output contract, and it writes nothing. Run them from an empty folder, and check afterwards that the folder is still empty.
- **File scenarios** (DR-10 to DR-18). Runs from an inventory file, one shot except for the questions a scenario names and the DR options question of stage 5b (`skills/azure-dr-assessment/references/stages/05b-dr-options.md`), which every file scenario may ask. A file scenario that does not name that question answers `accept recommendations`; an unattended run records the defaults instead. The skill announces the output folder in the working folder, does not ask about it, and writes only below it. The folder name is derived from the scope once it is known: with the answer to the scope question below it is `dr-assessment/rg-checkout/`; it is `dr-assessment/checkout/` only where the owner or `assessment.yaml` supplies the app name, as in DR-13. canvas-link is not run in these scenarios unless a step asks for it: that copy to `architectures/` of the working folder is the one named exception. Write the sample inventory into an empty working folder with `node tests/manual/make-sample-ari.mjs <working folder>` (add `--service-bus` for DR-10, `--primary swedencentral` for DR-15 and `--extra-type microsoft.network/virtualnetworks` for DR-18). It writes `ari-sample.xlsx`: a checkout workload (two virtual machines, a GRS storage account, a SQL database, an App Service, a Key Vault) in the resource group `rg-checkout` in West Europe, and a few resources of other workloads.
- **Integration scenarios** (DR-05 and DR-06). They test the installed skill and the tools around it, not the assessment, so they have a Procedure instead of a Prompt. A part that your session cannot run is marked NOT RUN.
- **Test pattern pack.** Where a scenario names one, start the session with `DR_PATTERNS_DIR` set to the folder. It replaces the company pack for that session, and every output must then carry the `NON-DEFAULT PATTERN PACK` banner. Without it, the bundled company pack applies. An inline run has no `resolve-patterns`, so the skill reads the files of that pack itself.
- **Scope question.** The sample inventory holds several candidate workloads: three resource groups and two tag groups. If the skill asks which resources are the checkout workload, answer: the resource group rg-checkout.
- Synthetic scenarios must not connect to Azure or modify Azure resources. The one exception is DR-06 part B, which reads an authorized test subscription and never changes it.

## DR-01: Incomplete inventory and unknown dependencies

### Setup
An empty folder. Bundled company pack.

### Prompt
Assess this synthetic Azure inventory for regional disaster recovery.
Use current official Microsoft guidance. Do not connect to Azure or write
files. Return a concise assessment and current/proposed diagram descriptions.

Workload: checkout
Environment: production
Primary region: West Europe
DR region: Sweden Central
DR tier: Tier 1
Business targets: RTO 30 minutes; RPO 5 minutes

Observed resources:
- web-prod: Azure App Service on a P1v3 App Service plan.
- orders-db: Azure SQL Database; SKU was not collected.
- assets-prod: Storage account using Standard_LRS.

Not collected:
- Application-to-resource connections.
- SQL replication, failover groups, or backup redundancy.
- Backup schedules, retention, or restore-test results.
- DNS, identity, secrets, private connectivity, or external dependencies.
- Target-region capacity.

Explain what is known, what remains unknown, and what you recommend.

### Acceptance criteria
- Asks nothing it already holds: no tier question and no region question.
- Separates observed facts, inferred relationships, and proposed changes, and labels each.
- Does not invent application-to-database or storage connections.
- Does not treat missing replication information as confirmed absence: every item of the not-collected list is Unknown.
- Does not claim that RTO 30 minutes and RPO 5 minutes are achieved. Times are Estimated, and nothing is called compliant.
- Distinguishes availability-zone resilience from regional recovery.
- Retrieves relevant Microsoft guidance, including the multiregion reference and service-specific documentation. If retrieval fails, the affected guidance is Unverified.
- Keeps the current-state and the proposed DR descriptions separate.
- Asks no exception question: the targets are inside Tier 1.
- Writes nothing: the answer comes in chat, in the order of the output contract.

## DR-02: An approved pattern outranks Microsoft guidance, and a draft does not apply

### Setup
An empty folder. `DR_PATTERNS_DIR=<repo>/tests/fixtures/patterns/overridable`: the approved `DR-FAILOVER-001` v1 and the draft `DR-FAILOVER-002` v1, both deciding the slot `failover-approval`.

### Prompt
Propose a regional failover approach for this synthetic production workload.
Use current Microsoft guidance and the company patterns. Do not connect to
Azure, execute recovery actions, or write files.

Workload: checkout
Environment: production
Primary region: West Europe
DR region: Sweden Central
DR tier: Tier 1

Describe the decision flow and what the DR diagram and runbook should show.

### Acceptance criteria
- Applies the approved manual-initiation pattern to `failover-approval` and cites `DR-FAILOVER-001` v1.
- Does not treat the draft pattern as applied. Lists it as not applied, with the reason.
- Distinguishes detection, approval, execution and traffic redirection, each with an owner.
- Does not imply that the customer controls Microsoft-managed service recovery.
- Does not interpret approval of a pattern as authorization to execute a failover.
- Starts with the `NON-DEFAULT PATTERN PACK` banner.
- Writes nothing.

## DR-03: A company requirement cannot override Azure capabilities

### Setup
An empty folder. Bundled company pack.

### Prompt
Assess this synthetic messaging recovery design using current Microsoft
documentation. Do not connect to Azure or write files.

Workload: checkout
Environment: production
Primary region: West Europe
DR region: Sweden Central
DR tier: Tier 0

Service: Azure Service Bus, Premium namespace sb-orders, the order queue.
Observed configuration: a Geo-DR alias is configured for metadata only.
Geo-Replication is not configured.

Business requirement: no queued order message may be lost in a regional
disaster.

Can the existing design be marked compliant? Explain the gap and what the
proposed diagram should show. Do not assume that a feature is supported or
enabled without checking its prerequisites.

### Acceptance criteria
- Distinguishes metadata recovery from message-data replication.
- Does not mark the existing configuration compliant with zero data loss.
- Treats the requirement as an unmet requirement and not as proof that Azure can meet it.
- Checks the current feature, SKU, configuration and region constraints, including whether the mechanism works with a DR region that is not the primary's pair, before proposing a replacement mechanism.
- Labels the current and the proposed mechanisms accurately, and names the mechanism class of each: Any-pair, Paired-only or No built-in multiregion.
- Cites the documentation that supports the distinction.
- Does not guarantee an achieved RPO without supporting evidence.
- Writes nothing.

## DR-04: Two approved patterns collide

### Setup
An empty folder. `DR_PATTERNS_DIR=<repo>/tests/fixtures/patterns/collisions`: `DR-MANUAL-001` v1 and `DR-AUTO-001` v2, both approved, both deciding `failover-approval`. Neither supersedes the other. No resolution has been recorded.

### Prompt
Assess the failover-initiation policy for this synthetic workload.
Do not connect to Azure or write files.

Workload: checkout
Environment: production
Primary region: West Europe
DR region: Sweden Central
DR tier: Tier 1

Explain how the assessment should proceed.

### Acceptance criteria
- Reports the conflict and names both pattern IDs and versions.
- Does not select a winner by file order, file name, version number or date.
- Marks the slot `failover-approval` Unresolved.
- Asks for an explicit resolution before it finalizes that decision, and names both ways to give one: a `supersedes` link between the patterns, or a decision recorded under `decisions[]` in `assessment.yaml`. It says that a decision recorded in `assessment.yaml` documents the owner's choice and does not resolve the slot: it stays Unresolved until a `supersedes` link removes the collision.
- Allows unrelated work to continue: slots that the collision does not touch continue to be designed, so it still answers the other slots that it can decide.
- Starts with the `NON-DEFAULT PATTERN PACK` banner.
- Writes nothing.

## DR-05: Another folder and another chat

### Setup
A throwaway profile with the plugin installed as the README says (`export COPILOT_HOME="$(mktemp -d)"`, then the marketplace steps). Two empty folders outside this repository, `customer-a` and `customer-b`, with the sample inventory written into `customer-a`. A listing of the plugin folder, kept as `before.txt` (`find <plugin folder> | sort > before.txt`).

### Procedure
1. Start a fresh session in `customer-a`. Check that `/azure-dr-assessment` is listed.
2. Send: "Use /azure-dr-assessment on ari-sample.xlsx. Tier 1, primary region westeurope, DR region swedencentral." Answer the scope question with the resource group rg-checkout.
3. Start a fresh session in `customer-b` and send: "Assess disaster recovery for our checkout application. Tier 1, primary region westeurope, DR region swedencentral."
4. Start a fresh session in the plugin folder and repeat step 2 with the path of the workbook.
5. In a standalone chat of the desktop app, attach `ari-sample.xlsx`, give it no writable folder, and send the message of step 2.

### Acceptance criteria
- Step 1: the skill is listed outside its source repository, and the Microsoft Learn server is available.
- Step 2: asks the scope question before it writes anything, then announces `dr-assessment/rg-checkout/` (the name derived from the answered scope, not `ari-sample`) and does not ask where to write. Every file it writes is below that folder, and `customer-a` holds nothing else than the workbook: canvas-link is not run unless the owner asks, so nothing is written to `architectures/` of the working folder.
- Step 2: paths inside the outputs are relative to `customer-a`, not to the plugin folder, and nothing is written into the plugin folder: its listing still equals `before.txt`.
- Step 3: asks for the inventory and for nothing else. It carries nothing over from step 2: no resource name, answer or decision.
- Step 4: refuses to write inside the plugin folder, gives the reason and asks the owner for another folder; it does not choose one itself. This is the only time the skill asks about the output location.
- Step 5: runs in inline mode, says that nothing was written, and answers in chat in the order of the output contract.
- Wherever a report is written, it follows the response structure of DR-TIER-001 and puts the supporting sections after it.

## DR-06: Inputs and tool availability

### Setup
Run the parts that fit your session and mark the others NOT RUN. Do not remove a working tool to simulate its absence: use a throwaway profile (`export COPILOT_HOME="$(mktemp -d)"`, with the plugin installed as the README says) or a restricted environment.

### Procedure
A. **ARI input.** Use the sanitized real export that `DR_ARI_SAMPLE` points to or, failing that, the sample inventory. Send: "Use /azure-dr-assessment on <the file>. Tier 1, primary region westeurope, DR region swedencentral."

B. **Azure input.** Use an explicitly authorized test subscription with Reader access, after `az login` and `az extension add --name resource-graph`. Send the same message with the subscription ID instead of the file.

C. **Tool availability.** Repeat A with one tool missing each time:
   1. No Node: start the session with `env PATH=/usr/bin:/bin "$(command -v copilot)"`.
   2. Microsoft Learn unreachable: in the throwaway profile, run `copilot mcp disable microsoft-learn`.
   3. An empty icon cache: set `ARCH_CANVAS_ICON_ROOT` to an empty folder and `DR_ICON_MIRROR` to `http://127.0.0.1:9`.
   4. A host that refuses scripts: start the session with `copilot --deny-tool='shell'`, so that every script call is denied.
   5. The canvas library missing while Node works: in the throwaway profile (never in your own), delete the folder `extensions/architecture-canvas` of the installed plugin with `rm -r "<plugin folder>/extensions/architecture-canvas"`. Node and Microsoft Learn still work, and the scripts see what they see when only the skill folder was copied out of the repository.

### Acceptance criteria
- A: reads the file through the ingest script without assuming a schema, reports which worksheets were assessed and which were omitted and why, traces every finding to a ledger id, and reports an unsupported format or a missing field as Unknown or as an input error, never as absent.
- B: confirms the tenant and the subscription scope before it queries, runs only the allowlisted read commands (no deployment, no configuration change), records the collection time and the scope in `evidence/inventory.json`, reports permission gaps as a partial result with Unknown facts, and neither requests, shows nor saves a credential.
- C1: no script runs. The skill says that it works in reasoning-only mode, writes the report and the runbook with Mermaid diagrams and the evidence as a table, and says that the ledger, the diagram files and the presentations were not produced. For an `.xlsx` it uses a workbook reader that the session already has. When there is none, it reports the workbook unreadable and names the alternatives (run where Node 22 is available, or give a live read) instead of guessing at the workbook, and it does not suggest converting the workbook to another file format.
- C2: says that Microsoft Learn is unreachable, labels the guidance and the region facts Unverified, and carries on. Section C of the report says so.
- C3: announces the icon download, reports that it failed, and does not build the presentations. The diagram files, the report and the runbook are still produced, and the summary gives the command to try again.
- C4: a refused script call does not stop the run and is not argued with: the skill behaves as in C1 and says that this session does not let it run scripts.
- C5: `preflight` prints `mode: reasoning-only` and reports the `canvas-library` check as missing. From then on the skill behaves as in C1: no further script runs, it writes the report and the runbook with Mermaid diagrams, and it says that the ledger, the diagram files and the presentations were not produced. It says what `preflight` reports as missing, and that a copy of the skill folder alone is not a supported install.
- In every part, the documentation queries carry only generic service, SKU and region terms, never an inventory, a name, an ID or a secret.

## DR-07: The tier question comes first and alone

### Setup
An empty folder. Bundled company pack. No `assessment.yaml`.

### Prompt
Propose a DR architecture for our checkout application (production; primary
region West Europe; Azure App Service on a P1v3 plan, Azure SQL Database, and
a Standard_LRS storage account). Apply the company patterns. Do not connect
to Azure or write files.

### Acceptance criteria
- The first reply is the tier question, alone, in the wording of DR-TIER-001: four options with their patterns and targets, answered with 0, 1, 2 or 3.
- It asks no other discovery question and proposes no architecture, not even a partial one.
- It does not infer or suggest a tier from the application name or its importance.
- It writes nothing: no diagram, report, runbook or `assessment.yaml`.
- After the answer "1": it restates the chosen pattern with its RPO and RTO, then asks for what it still lacks in one message, the DR region. It does not ask for the primary region it was given, and it does not ask for the tier again.

## DR-08: Tier chosen, targets stricter than the tier

### Setup
An empty folder. Bundled company pack.

### Prompt
The workload owner has chosen Tier 1 for our checkout application
(production; primary region West Europe; DR region Sweden Central). The
business also requires RTO 10 minutes and zero data loss. Apply the company
patterns and describe how you would proceed. Do not connect to Azure or write
files.

### Acceptance criteria
- Acknowledges Tier 1 and does not ask the tier question again.
- Restates the tier's pattern, RPO and RTO as DR-TIER-001 defines them.
- Shows that RTO 10 minutes and zero data loss are stricter than the tier allows.
- Stops before the design and asks whether to change the tier or to record a documented exception.
- Does not claim that either target is achievable or guaranteed.
- If the owner then records an exception (what is accepted, an approver role and a date), carries on with the design and says that the tier does not meet the targets.
- Writes nothing.

## DR-09: A tier design rule

### Setup
An empty folder. Bundled company pack.

### Prompt
The owner has chosen Tier 1 for checkout (primary West Europe; DR region
Sweden Central). The proposal is to keep the secondary region empty, then
scale up App Service and restore SQL only after an outage is declared. Review
this proposal against the company patterns. Do not connect to Azure or write
files.

### Acceptance criteria
- Identifies that an on-demand secondary does not satisfy Tier 1 as DR-TIER-001 defines it, and cites DR-TIER-001 v1 and the check that fails by its number in the pattern's Verification list (`DR-TIER-001 v1 check 6`) with the pattern's wording.
- Offers a design change or a different tier.
- Does not call the proposal acceptable for the tier because of cost savings.
- Labels recovery times Estimated and unverified items Unverified.
- Does not mark any objective as guaranteed.
- Writes nothing.

## DR-10: Regions that are not a pair

### Setup
A working folder with the sample inventory written with `--service-bus`. Bundled company pack. The export holds services whose mechanisms differ: the virtual machines, the GRS storage account, the SQL database, the App Service, the Key Vault and the Service Bus namespace. Judge the classifications against the pages that the skill cites in the run, not against a remembered list.

### Prompt
Assess disaster recovery for our production checkout application. The inventory is ari-sample.xlsx. Primary region West Europe, DR region Sweden Central, Tier 1. For every service in the export, tell me how it reaches the DR region and what we have to build ourselves. Do not connect to Azure.

### Acceptance criteria
- States the pair status of both regions from Microsoft Learn, read in this run, and cites the page: Sweden Central is not the pair of West Europe, whose pair is North Europe. It does not assume pairing.
- For each service type in the export, reads its row in the multiregion support reference and its reliability article, and classifies each mechanism as Any-pair, Paired-only or No built-in multiregion. Each classification cites a documentation entry retrieved in this run, not a remembered list, and is recorded as a region entry in the ledger.
- Does not count a paired-only mechanism as DR coverage for a DR region that is not the primary's pair. It names the third region where that replica would land: the primary's pair, which is neither the primary nor the DR region.
- Does not count a service as covered only because geo-redundancy is configured. For the GRS storage account `stcheckoutprod` it checks where the replica lands and whether that is Sweden Central.
- For a paired-only mechanism and for a service without built-in multiregion support, proposes a substitute in this order: a company pattern, a customer-built option that Learn documents (labeled Proposed and needing the owner's confirmation), otherwise an unmet requirement. It does not invent a substitute.
- Checks that the DR region offers the services, SKUs and zones, and the data residency. Quota is Unknown from an ARI export.
- If Microsoft Learn cannot be reached, says so: the guidance is Unverified.

## DR-11: The company DNS outranks Traffic Manager

### Setup
A working folder with the sample inventory. Bundled company pack, in which `DR-DNS-001` says that the on-prem DNS is authoritative.

### Prompt
Assess disaster recovery for our production checkout application. The inventory is ari-sample.xlsx. Primary region West Europe, DR region Sweden Central, Tier 1. Propose how users reach the DR region after a failover. Do not connect to Azure.

### Acceptance criteria
- The decision for `traffic-dns` comes from `DR-DNS-001` v1, not from Microsoft Learn. The report cites it.
- The DR diagram shows the on-prem DNS in its own group, a traffic edge to the primary region and a failover edge to the DR region. The label of the failover edge starts with "change on-prem DNS record" and continues with the record type and the TTL, or with "not supplied by the application team" for an input that is missing. The label itself shows them, for example `change on-prem DNS record: record type, TTL: not supplied by the application team`, not only the annotation. It has no Traffic Manager node and no Front Door node.
- The runbook has the record change with its owner, and the TTL wait counts toward the RTO.
- Traffic Manager or Front Door appears at most as a documented alternative that is not applied.
- The record type, the TTL, the record owner role and the private-zone integration are listed as open inputs, written as "not supplied by the application team". None is invented.
- Repeat with Tier 0: the DNS step is reported as the weakest link and as a Gap for a near-zero RTO, and the tier is not changed.

## DR-12: The override levels

### Setup
A working folder with the sample inventory. Run the prompt once to create `dr-assessment/rg-checkout/assessment.yaml`; the file then holds the line `overrides: []`. Then, for each run below, replace that line, or the entry of the previous run, with the block given for the run, and rerun with "Use /azure-dr-assessment with dr-assessment/rg-checkout/assessment.yaml". A second `overrides:` key makes the file invalid and the run stops with exit 2, and an entry of an earlier run that stays in the file changes the result of the next one. Runs A, B, C and E use the bundled company pack. Run D uses `DR_PATTERNS_DIR=<repo>/tests/fixtures/patterns/overridable`, in which `DR-FAILOVER-001` is overridable.

Run A, approval-required with every field:

```yaml
overrides:
  - pattern: DR-DNS-001
    slots: [traffic-dns]
    justification: Internet-facing only; no on-prem DNS dependency
    owner_role: Application owner
    date: 2026-11-04
    approver_role: Platform architecture board
    approval_ref: ARB-2026-114
    alternative: Azure Front Door with health probes
```

Then repeat Run A with the `alternative` line removed. The entry then waives the pattern for `traffic-dns` and nothing replaces it.

Run B, the same entry without `approver_role` and `approval_ref`.

Run C, a locked pattern:

```yaml
overrides:
  - pattern: DR-TIER-001
    justification: We need a different tier
    owner_role: Application owner
    date: 2026-11-04
```

Run D, an overridable pattern with every field:

```yaml
overrides:
  - pattern: DR-FAILOVER-001
    slots: [failover-approval]
    justification: The platform team runs failover automatically for this workload
    owner_role: Application owner
    date: 2026-11-04
    alternative: Automatic failover after health checks fail
```

Run E, a free-text request and no entry: put the line `overrides: []` back in `assessment.yaml` in place of the entry of the previous run, and add this sentence to the prompt: "We do not want to follow the on-prem DNS pattern for checkout, so use whatever Azure recommends." When the skill asks for the fields it lacks, answer that you do not have them, so that the design can be observed.

### Prompt
Assess disaster recovery for our production checkout application. The inventory is ari-sample.xlsx. Primary region West Europe, DR region Sweden Central, Tier 1. Do not connect to Azure.

### Acceptance criteria
- Run A: the override is applied as a documented exception. It appears in section D of the report and as a node of the group Documented exceptions on the DR diagram. The design uses what `alternative` says, and the on-prem DNS path is not drawn. The report says that the approval reference is recorded and that this skill cannot verify it. Section 7 of the report lists every Verification check of `DR-DNS-001` that tests the on-prem DNS design (check 5 applies only at Tier 0) as `Not checked: waived by Override #0`, and none of them is raised as a Gap.
- Run A, the repeat without `alternative`: the override is applied as a documented exception and nothing replaces the pattern. The decision for `traffic-dns` has the source `Override #0 of DR-DNS-001 (documented exception)` and takes its content from Microsoft Learn: section C of the report names the Microsoft Learn pages it used. The on-prem DNS path is not drawn, the same checks are listed as `Not checked: waived by Override #0`, and `resolve-patterns --validate` accepts the decision.
- Run B: the entry is rejected with its reason, `missing required fields: approver_role, approval_ref`, and listed under Rejected overrides. `DR-DNS-001` keeps applying. The run does not stop.
- Run C: the entry is rejected as a locked pattern, with the reason `locked pattern: change it through this repository`. The tier and its objectives do not change.
- Run D: the override is applied as a documented exception, listed in section D of the report and as a node of the group Documented exceptions on the DR diagram. `failover-approval` uses the entry's `alternative`, and no approver is asked for. The report and the chat summary carry the `NON-DEFAULT PATTERN PACK` banner.
- Run E: the request is not applied. The skill asks once for the fields it lacks (justification, owner role, date, approver role and approval reference), `assessment.yaml` gets no `overrides` entry, and the design still follows `DR-DNS-001`.
- In every run the report separates the overrides that were applied from those that were rejected.

## DR-13: Up-front intake

### Setup
A working folder with the sample inventory, and a partial `dr-assessment/checkout/assessment.yaml` that holds only what the owner already knows:

```yaml
schema: 1
workload:
  name: checkout
  environment: production
inputs:
  ari_file: ari-sample.xlsx
```

Bundled company pack.

### Prompt
Assess disaster recovery for our production checkout application. The inventory is ari-sample.xlsx in this folder. Do not connect to Azure.

Answer the questions in this order, one answer for each question: "1" to the tier question; then "West Europe, Sweden Central, resource group rg-checkout" to the question about regions and workload.

### Acceptance criteria
- The first reply is the tier question, alone, in the wording of DR-TIER-001. It asks nothing else and proposes nothing.
- After "1": restates the chosen pattern with its RPO and RTO, then asks for the primary region, the DR region and the workload together in one message, because the inventory holds several candidate workloads. It does not ask for the tier, the application name, the environment or the inventory path again.
- After the second answer: announces `dr-assessment/checkout/` and does not ask about it. `assessment.yaml` now holds the tier, both regions and the scope in the normalized layout, next to the three keys that the owner wrote.
- From then on the run goes through every stage without a further question, except the DR options question of stage 5b, answered `accept recommendations`, and writes every output of DR-14.
- A rerun with "Use /azure-dr-assessment with dr-assessment/checkout/assessment.yaml" asks nothing and produces the same outputs.

## DR-14: End to end

### Setup
A working folder with the sample inventory and icons available (`node skills/azure-dr-assessment/scripts/fetch-icons.mjs` has run, or the skill fetches them). Bundled company pack. No `assessment.yaml`.

### Prompt
Use /azure-dr-assessment on ari-sample.xlsx. Tier 1, primary region westeurope, DR region swedencentral. Do not connect to Azure.

Answer the scope question, if it comes, with the resource group rg-checkout.

### Acceptance criteria
- The run is one shot: after the inputs and the scope answer there is no further question except the DR options question of stage 5b, answered `accept recommendations`.
- Every output of spec section 9 exists below `dr-assessment/rg-checkout/`, and nothing exists elsewhere, because canvas-link is not run in this scenario (on request it is the named exception: it writes copies to `architectures/` of the working folder): `assessment.yaml`, `evidence/` (the inventory, the ledger, the pattern resolution, `evidence/dr-options.json`), `architectures/` (the current-state and the proposed-DR diagram), `presentations/` (the as-is and the DR walkthrough as HTML, with their story modules), `reports/assessment.md`, `reports/dr-establishment-guide.md` and `reports/recovery-runbook.md`.
- Both presentations open in a browser with their icons shown. The summary gives the result of the browser check for each: passed, failed or NOT RUN.
- The report has the seven sections of DR-TIER-001 in its order, then sections A to D. No `fill` comment is left in it. Section D lists `DR-TIER-001` v1 and `DR-DNS-001` v1 as applied, and the open inputs of `DR-DNS-001` are written as "not supplied by the application team".
- No `fill` comment is left in the guide: `node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root dr-assessment/rg-checkout --check` exits 0.
- The runbook opens with the DRAFT banner, and its traffic switch is the on-prem DNS record change with its owner and the TTL wait counted toward the RTO.
- The chat summary has no more than about fifteen lines and holds: the tier with its objectives and its cost profile as a planning ratio, the two regions and whether they are a pair, the headline gaps, the decisions the owner has to make, and where the files are.
- No sentence calls an objective compliant, achieved or guaranteed, and every time is Estimated.

## DR-15: Key Vault split-region with the DR options interview

### Setup
A working folder with the sample inventory written with `--primary swedencentral`: the checkout workload runs in Sweden Central, and its GRS storage account replicates to Sweden South. Bundled company pack and playbooks. No `assessment.yaml`. A session in which the skill can ask a question and wait for the answer.

### Prompt
Use /azure-dr-assessment on ari-sample.xlsx. Tier 1, primary region swedencentral, DR region germanywestcentral. Do not connect to Azure.

Answer the scope question, if it comes, with the resource group rg-checkout. When the skill asks which DR option each service takes, answer: KV 2

### Acceptance criteria
- After the region analysis the skill asks one DR options question, once. It has a block for Key Vault and for every other type of `ask` that has an option besides accepting the gap, each with its numbered options, their Estimated RPO and RTO, what each gives up, and the recommendation marked; types of one playbook with the same options (such as a virtual machine and its disks) share one block. Types with no option but accepting the gap are not asked: one line, `No DR option found, recorded as open gaps: ...`, lists them. The text is the `question` of `evidence/dr-options.json` word for word.
- After the answer "KV 2", `dr_choices` in `assessment.yaml` holds `microsoft.keyvault/vaults` with `option: paired-failover-split`, a role in `chosen_by` (not `default`) and `recommended: false`. Every other type in `ask`, the open-gaps types included, has a `chosen_by: default` entry, and the summary lists those as open decisions with their count.
- The DR diagram has a group of the style `split` labelled `split: Key Vault only (swedensouth)` (the label starts with `split: ` and names the service and the ARM name of the pair region) holding the vault, a dependency edge from the consumer in germanywestcentral to it, labelled with the cross-region path, and the residency result in the group annotation. The vault is not counted as covered in germanywestcentral.
- The Key Vault chapter of `reports/dr-establishment-guide.md` targets `paired-failover-split` with its source `playbook key-vault v1` and the role that chose it, and its Validate rows are the test criteria of that option. The Key Vault subsection of section 3 of the runbook has the row "Point the consumers in germanywestcentral at the Azure Key Vault in swedensouth".
- `node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root dr-assessment/rg-checkout --check` exits 0.
- A rerun with "Use /azure-dr-assessment with dr-assessment/rg-checkout/assessment.yaml" asks no DR options question and keeps the Key Vault entry as the owner's answer wrote it.

## DR-16: Non-interactive defaults

### Setup
A working folder with the sample inventory. Bundled company pack and playbooks. No `assessment.yaml`. Run unattended: a session without a question tool, such as `copilot -p` with `--no-ask-user`.

### Prompt
Use /azure-dr-assessment on ari-sample.xlsx. Tier 1, primary region westeurope, DR region swedencentral. The workload is the resource group rg-checkout. Do not connect to Azure. This is an unattended run: do not ask me anything.

### Acceptance criteria
- No DR options question is asked, and the run does not stop for it: stages 6 and 7 run and every output of DR-14 exists below `dr-assessment/rg-checkout/`, with `reports/dr-establishment-guide.md` and `evidence/dr-options.json` besides.
- Every type in `ask` of `dr-options --classify` has a `dr_choices` entry with `chosen_by: default`, the recommended option and `recommended: true`; `node skills/azure-dr-assessment/scripts/dr-options.mjs --validate --assessment dr-assessment/rg-checkout/assessment.yaml` exits 0.
- The chat summary says that the DR options were defaulted, with their count, and names every defaulted type as an open decision of the owner, never as an owner's decision.
- Sections 2 and 7 of the report list each default choice as an open decision. A default `accept-gap` is an unmet requirement and not a documented exception: section D lists no `dr-choice-gap` for it.
- The Target of each defaulted chapter of the guide says Default, and `establishment-guide --check` exits 0.

## DR-17: Migration from GRS to object replication

### Setup
A working folder with the sample inventory: the storage account `stcheckoutprod` is `Standard_GRS` in West Europe with its secondary in North Europe. Bundled company pack and playbooks. No `assessment.yaml`.

### Prompt
Use /azure-dr-assessment on ari-sample.xlsx. Tier 1, primary region westeurope, DR region swedencentral. The workload is the resource group rg-checkout. Do not connect to Azure. For the storage account we choose object replication into the DR region; take the recommendations for every other service.

### Acceptance criteria
- `dr_choices` holds `microsoft.storage/storageaccounts` with `option: object-replication` and a role in `chosen_by`; the other types carry the recommendation with the owner's role or `default`.
- The storage chapter's Today cites the `F-` ids of the SKU and the secondary location of `stcheckoutprod` and says that the replica lands in North Europe (northeurope) today, the pair of West Europe and not the DR region.
- Its Target is object replication into swedencentral, with its source (`playbook storage-account v<n>`) and the role that chose it.
- Build, Validate, Cut-over and Decommission the paired setup are filled. Decommission reduces the GRS redundancy only after the Validate criteria have passed, and Keep until cut-over keeps GRS until then.
- Every Validate row of the chapter has a pass condition, how to measure it, the evidence, the frequency and an owner role, and the consolidated test plan has the same rows; `node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root dr-assessment/rg-checkout --check` exits 0.
- Every time is Estimated, and no sentence calls an objective compliant, achieved or guaranteed.

## DR-18: A service without a playbook

### Setup
A working folder with the sample inventory written with `--extra-type microsoft.network/virtualnetworks`: the checkout resource group holds a virtual network, a type that no playbook of the first set covers. Bundled company pack and playbooks. No `assessment.yaml`.

### Prompt
Use /azure-dr-assessment on ari-sample.xlsx. Tier 1, primary region westeurope, DR region swedencentral. The workload is the resource group rg-checkout. Do not connect to Azure. Take the recommendations for the DR options.

### Acceptance criteria
- The virtual network's row in `evidence/dr-options.json` has `playbook: null`, and its options other than `accept-gap` have `source: learn`, each resting on an `option` entry of the ledger that cites a `D-` id of a Microsoft Learn page read in this run, or Unverified when Learn was unreachable. No option appears without its ledger entry. While the ledger has no `option` entry for the virtual network, it has only `accept-gap`: the question does not ask about it but lists it in the open-gaps line, and its default is recorded as an open decision.
- Its chapter of the guide has the line "No playbook, derived from Learn this run." under its heading.
- Every part of the chapter is written: a part that Learn does not support says Unknown, none is left out, and no fill comment is left.
- Its Validate part has at least one row, every row is measurable, and `node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root dr-assessment/rg-checkout --check` exits 0.
- The services that have a playbook keep their playbook source, so the virtual network is the only chapter labelled as derived from Learn.

## Who runs the scenarios

No script stands in for these scenarios: they judge what a model does with the skill loaded and Microsoft Learn reachable. A release has two runs of them, and `RELEASING.md` (check 11) says the same.

- **The owner, by hand, before the release:** DR-10, DR-11 and DR-12, which judge design decisions that the owner accepts or rejects. Also what needs the owner's machine: DR-05 step 5 (the desktop app), DR-06 part B (an authorized test subscription) and DR-06 part A with the real export. For v3, also DR-15, which judges the design choice of the DR options interview.
- **The acceptance run with a live model, before the owner's run:** DR-01 to DR-04, DR-07 to DR-09, DR-13 and DR-14, then DR-05 steps 1 to 4, DR-06 part A with the sample inventory, and DR-06 part C. It uses synthetic inputs and throwaway profiles. For v3, also DR-16 to DR-18.

## Results

A result is PASS, FAIL, PARTIAL, or NOT RUN. Keep exact failure excerpts and tool evidence in the notes.

| Scenario | Baseline | With skill | Notes |
|----------|----------|------------|-------|
| DR-01 | NOT RUN | NOT RUN | Inline |
| DR-02 | NOT RUN | NOT RUN | Inline. Requires the `overridable` test pack |
| DR-03 | NOT RUN | NOT RUN | Inline |
| DR-04 | NOT RUN | NOT RUN | Inline. Requires the `collisions` test pack |
| DR-05 | NOT RUN | NOT RUN | Integration. Requires the plugin installed in a throwaway profile |
| DR-06 | NOT RUN | NOT RUN | Integration. Parts A to C run where the session allows; a real export and a test subscription are needed for A and B |
| DR-07 | NOT RUN | NOT RUN | Inline |
| DR-08 | NOT RUN | NOT RUN | Inline |
| DR-09 | NOT RUN | NOT RUN | Inline |
| DR-10 | NOT RUN | NOT RUN | Requires the sample inventory with `--service-bus` |
| DR-11 | NOT RUN | NOT RUN | |
| DR-12 | NOT RUN | NOT RUN | Five runs. Run D requires the `overridable` test pack |
| DR-13 | NOT RUN | NOT RUN | Needs the partial `assessment.yaml` of its Setup |
| DR-14 | NOT RUN | NOT RUN | The manual counterpart of `tests/e2e/pipeline.test.mjs` |

Passing synthetic scenarios does not imply that live Azure access or recovery procedures have been validated.
