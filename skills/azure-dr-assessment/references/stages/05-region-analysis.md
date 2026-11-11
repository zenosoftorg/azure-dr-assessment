# Stage 5: Region analysis

Find out what Azure offers between the two regions, service by service, from Microsoft Learn read in this run, check every service playbook claim that bears on the classification, and classify each service's DR path. Pairing is never assumed. Nothing here is hard-coded: the catalogue file, the playbooks and the examples below tell you where to look, and every page is read again on every run.

## Inputs

- `assessment.yaml`: `regions.primary`, `regions.dr`, `regions.failure_scope`, `objectives.tier` and `constraints.data_residency`.
- The worklist of services in scope:

  ```bash
  node skills/azure-dr-assessment/scripts/region-services.mjs --assessment dr-assessment/checkout/assessment.yaml
  ```

  `types` lists each distinct service, most frequent first, with the catalogue's hint (`learn[].service`, `articleUrl`, `customSolutionsUrl`) and its `playbook`: the service playbook that covers the type, `skills/azure-dr-assessment/playbooks/<playbook>.md`, or null. `unmapped` lists types the catalogue does not know. `catalogue.stale` means the hints are older than 90 days: treat them as a starting point only.
- The Learn MCP tools of this session, `microsoft_docs_search` and `microsoft_docs_fetch`. If they are missing, see "Learn unreachable".

## Query hygiene

One service per query. A query carries only generic service, SKU and region terms: never a customer name, resource name, ID or any inventory content. Extract the rows you need from a page. Do not paste whole pages into the conversation or the ledger.

## Steps

Record every finding in the ledger as you go (see "Recording"). Steps 1 to 3 are about the two regions, steps 4 to 6 about each service, step 7 about fit, step 8 classifies.

1. **Pair status.** Read the region pairs page (`https://learn.microsoft.com/en-us/azure/reliability/regions-paired`). A pair is directional: look up the primary's paired region and the DR region's, and record both. The two regions are a pair for DR only if the primary's pair is the DR region. Some pairs are asymmetric (Brazil South pairs with South Central US, which does not pair back), and many regions have no pair (`N/A`). Note a restricted-access marker on either region. Record one `pair` entry with the subject `<primary>|<dr>` and the result fields `paired`, `primaryPair` and `drPair` (see "Recording"): `dr-options` reads them.
2. **Zones, geography, residency.** Read the regions list (`https://learn.microsoft.com/en-us/azure/reliability/regions-list`): availability zones, paired region, geography and programmatic name of each region. Check `constraints.data_residency` against the geographies. Flag any replication that crosses a geography boundary, including a paired-only mechanism whose replica lands in the primary's pair outside the DR region's geography. Record one `geography` entry for the primary, one for the DR region and one for the primary's pair, each with the result fields `region`, `geography` and `residency`: `ok` when the region respects `constraints.data_residency` (always `ok` when it is null), `crosses` when it does not, `unknown` when you cannot tell.
3. **Distance.** Read the round-trip latency page (`https://learn.microsoft.com/azure/networking/azure-network-latency`, P50 values, tabs by region group). It matters for synchronous designs in Tier 0. If the two regions are not listed together, record that they were not found. Do not estimate.
4. **Mechanisms per service.** For each type in `types` that has a `playbook`, open the playbook first. Read Learn for every mechanism of its Mechanisms section and record each one as below, with `result.mechanism` written exactly as the playbook names it, so that `dr-options` can match the two. Read Learn for every constraint of its Constraints section and record a `playbook-claim` entry with the playbook's `service`, the constraint heading as `claim`, the quoted Learn text and `agrees` true or false (see "Recording"). Read only the Mechanisms and Constraints sections again in a run: the other sections are checked when the playbook is written and by the weekly drift test. For every type, read its row in the multiregion support reference (`https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support`; read both tabs and the footnotes under the second one), then the service's reliability article for the mechanism, what is replicated (data, metadata or both), the failover mode (Microsoft-managed, customer-managed or manual), prerequisites and failback. A service can have several rows, one per mechanism: read them all. A type that is not on the page: search Learn for `<service> reliability multiregion`. If nothing documents it, do not add a mechanism entry: record an Unknown fact for the type (see "Recording"). The mechanism is Unknown and the guidance Unverified, and the design must not claim coverage for it.

   **4a. No playbook.** For a type whose `playbook` is null, derive its DR options from Learn: the reliability article, its custom multiregion solutions section (`customSolutionsUrl` when the catalogue has one) and Azure Backup cross-region restore. Record each option as an `option` entry with its id, title, kind (`native`, `workaround`, `split-region` or `backup-restore`), target (`dr-region`, or `pair-region` for a split to the service's own pair), the mechanism it uses or `none`, the Estimated RPO and RTO (a duration such as `30m`, or `unknown`), the slot and what it gives up, citing the `D-` id (see "Recording"). Write `unknown` when Learn gives no figure: never estimate one yourself. An option that nothing on Learn documents is not recorded.
5. **Classify each mechanism** from its row and step 1:
   - **Any-pair:** a check in both the Paired and the Nonpaired column. A "Nonregional service" row counts.
   - **Paired-only:** a check in Paired only.
   - **No built-in multiregion:** listed on the second tab, or not offered.

   Footnote 1 means the capability may need several services configured. Footnote 2 means region selection constraints: read the article for the supported region combinations before you count the mechanism for this DR region.
6. **Substitutes.** A paired-only mechanism whose pair is not the DR region, and a service with no built-in multiregion mechanism, need a substitute. Take the first that applies, in this order:
   1. a company pattern that covers the slot;
   2. the DR options of the type, from its playbook (step 4) or from Learn (step 4a), among which the owner chooses in stage 5b, recorded as **Proposed**;
   3. otherwise, when the only option left is accepting the gap, an **unmet requirement**. Do not invent a substitute.

   A paired-only mechanism never counts as DR coverage for a DR region that is not the primary's pair. Name where its replica actually lands. A split-region option uses it knowingly: the service recovers into its own pair, a third region, and is never counted as covered in the DR region.
7. **Does the DR region fit?** Service, SKU and zone availability and quota in the DR region, and residency. With a live connection, read VM sizes and vCPU quota:

   ```bash
   node skills/azure-dr-assessment/scripts/collect-live.mjs --mode fit --location swedencentral --sizes Standard_D4s_v5 --subscriptions <ids> --out dr-assessment/checkout/evidence/fit.json
   ```

   Everything else is Learn-only: a service's availability by region comes from its article, and quota is Not assessed. From an ARI export without a live connection, availability and quota are Unknown.

   The fit queries run in the Azure CLI's active subscription, because SKU restrictions and quota are per subscription. When the result's `warnings` says that subscription is not one of `--subscriptions`, ask the user to run `az account set --subscription <id>` and then run the command again. You never run it yourself.
8. **Classify.** When the ledger validates, classify every type:

   ```bash
   node skills/azure-dr-assessment/scripts/dr-options.mjs --classify --assessment dr-assessment/checkout/assessment.yaml
   ```

   It writes `evidence/dr-options.json`: per type its DR path, its options with their tier fit and residency, the recommendation, the stale playbook claims, and the DR options question. The script classifies and recommends by fixed rules; never do either by judgement. In the summary, `ask` lists the types that stage 5b asks about and `question` is the question to ask; `staleClaims`, `stalePlaybooks` and `warnings` go into the report. Then go to [stage 5b](05b-dr-options.md) in every run: when `ask` is empty it asks nothing and only runs its record step (`--record --defaults`), which refreshes a default whose recommendation changed. Stage 5b asks only when `question` is not null, and always records the defaults. Exit 2 names what is missing: an evidence file, the tier, or a playbook or pattern pack that does not lint.

## Verification of a playbook

`dr-options` compares each playbook mechanism's `Paired` and `Nonpaired` claim with the class you recorded for the same type and mechanism name, and reads your `playbook-claim` entries for the constraints. A different class, or `agrees: false`, makes the claim **stale**: Learn wins, every option that rests on the mechanism is evaluated again (an option whose mechanism no longer reaches its target is dropped as vetoed), and the row lists the claim in `staleClaims`. A claim without a Verified entry is Unverified, and an option that rests on it never counts as meeting the tier. Native needs a Verified mechanism. A playbook whose `verified_on` is more than 90 days old is a warning, never a refusal. Never edit a playbook during a run: a stale claim is fixed by a pull request.

## Recording

Add each page you used as a documentation entry, then each finding as a region entry that cites it.

```bash
node skills/azure-dr-assessment/scripts/ledger.mjs add-doc --ledger dr-assessment/checkout/evidence/ledger.json --url https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support --title "Azure services that support multiple regions" --status Verified --supports "mechanism rows for SQL Database" --query "sql database geo-replication nonpaired regions" --tool microsoft_docs_fetch
node skills/azure-dr-assessment/scripts/ledger.mjs add-region --ledger dr-assessment/checkout/evidence/ledger.json --check mechanism --subject microsoft.sql/servers/databases --status Verified --class any-pair --doc D-0001 --quote "Azure SQL Database | Active geo-replication | yes | yes" --result '{"mechanism":"active geo-replication","failover":"customer-managed"}'
```

`add-doc` prints the new `D-` id: use it in `--doc`. A `Verified` mechanism entry needs the `D-` id and the quoted row. `--class` is `any-pair`, `paired-only` or `none`. For a substitute add `--substitute-source pattern`, `customer-built` or `unmet`, and `--substitute-ref` (the pattern ID or the Learn URL). Use `--check pair`, `geography`, `zones`, `latency` or `fit` for the other findings, with the facts in `--result`.

The pair and geography results have fixed fields, because `dr-options` reads them:

```bash
node skills/azure-dr-assessment/scripts/ledger.mjs add-region --ledger dr-assessment/checkout/evidence/ledger.json --check pair --subject "swedencentral|germanywestcentral" --status Verified --doc D-0002 --quote "Sweden Central | Sweden South" --result '{"paired":false,"primaryPair":"swedensouth","drPair":"germanynorth"}'
node skills/azure-dr-assessment/scripts/ledger.mjs add-region --ledger dr-assessment/checkout/evidence/ledger.json --check geography --subject germanywestcentral --status Verified --doc D-0003 --quote "Germany West Central | Germany" --result '{"region":"germanywestcentral","geography":"Germany","residency":"ok"}'
```

A playbook constraint checked against Learn, and an option derived from Learn for a type without a playbook:

```bash
node skills/azure-dr-assessment/scripts/ledger.mjs add-region --ledger dr-assessment/checkout/evidence/ledger.json --check playbook-claim --subject microsoft.keyvault/vaults --status Verified --doc D-0004 --quote "You can't restore a key vault backup into a different geography." --result '{"playbook":"key-vault","claim":"Backups restore only in the same subscription and geography","agrees":true}'
node skills/azure-dr-assessment/scripts/ledger.mjs add-region --ledger dr-assessment/checkout/evidence/ledger.json --check option --subject microsoft.network/virtualnetworks --status Verified --doc D-0005 --result '{"id":"redeploy-network","title":"Deploy the network in the DR region from code","kind":"workaround","target":"dr-region","usesMechanism":"none","rpo":"unknown","rto":"unknown","slot":"connectivity","givesUp":"a network that exists before the failover"}'
```

A `Verified` `playbook-claim` entry needs the `D-` id and the quoted Learn text; a `Verified` `option` entry needs the `D-` id. Record them as `Unverified` without a `D-` id when Learn could not be read. `accept-gap` is never recorded: every type gets it.

A type that nothing documents gets an Unknown fact, not a mechanism entry: a mechanism entry needs a `--class`, and `--class none` would claim that the type has no built-in multiregion mechanism, which you have not established. The claim says what you did not find and where you looked. `--source-type` is `ari-xlsx` for an ARI inventory and `live` for a live one: an `owner` or `model` source is valid only for an Inferred fact.

```bash
node skills/azure-dr-assessment/scripts/ledger.mjs add-fact --ledger dr-assessment/checkout/evidence/ledger.json --strength Unknown --subject <armType> --property mechanism --value null --claim "No multiregion mechanism is documented for <armType>: it is not in either tab of the multiregion support reference, and a Learn search for its reliability article found nothing" --source-type ari-xlsx --source-detail "not documented on Microsoft Learn"
```

The report then shows the component as Unknown, and the design must not claim coverage for it.

## Learn unreachable

If the Learn MCP tools are missing, the Learn CLI is the second choice: `npx @microsoft/learn-cli search "<query>"` and `npx @microsoft/learn-cli fetch "<url>"`. Record those documentation entries with `--tool learn-cli`, and say that you used it. If no retrieval method works, try once more, then continue. Every documentation entry is `--status Unverified --tool none`, no mechanism class is recorded as Verified, and the report says so. You may still draft from your own knowledge, labeled Unverified. Every playbook claim is then Unverified, so no type is Native and every type that no pattern decides is in the DR options question; a type without a playbook has only the option of accepting the gap.

## Never

- Count a service as covered because geo-redundancy is configured. Capability is not configuration, and metadata replication is not data replication.
- Reuse the examples in this file or the catalogue as facts.
- Count a mechanism as covering the DR region without checking pair status and the footnote 2 constraints.
- Take a playbook claim as true without its ledger entry of this run, or edit a playbook during a run.
- Classify a service or recommend an option by judgement: `dr-options --classify` does both.

## Done when

Every type in `types` has a mechanism entry or, when nothing documents its mechanism, an Unknown fact; the pair, zones, geography and latency findings are recorded for both regions; every mechanism and constraint of a playbook in scope has its entry, and every type without a playbook has its `option` entries or none because Learn documents none; every substitute is recorded as Proposed or Unmet requirement; the ledger validates:

```bash
node skills/azure-dr-assessment/scripts/ledger.mjs validate --ledger dr-assessment/checkout/evidence/ledger.json
```

and `dr-options --classify` exited 0.
