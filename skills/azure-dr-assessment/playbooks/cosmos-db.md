---
service: cosmos-db
title: Azure Cosmos DB
arm_types:
  - microsoft.documentdb/databaseaccounts
slot: data-replication.nosql
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db
  - https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-manage-database-account
  - https://learn.microsoft.com/en-us/azure/cosmos-db/disaster-recovery-guidance
  - https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels
  - https://learn.microsoft.com/en-us/azure/cosmos-db/manage-with-cli
  - https://learn.microsoft.com/en-us/azure/cosmos-db/failover-considerations-for-private-endpoints
  - https://learn.microsoft.com/en-us/azure/cosmos-db/serverless
  - https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-connect-role-based-access-control
  - https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-setup-customer-managed-keys
  - https://learn.microsoft.com/en-us/azure/templates/microsoft.documentdb/databaseaccounts
  - https://learn.microsoft.com/en-us/azure/cosmos-db/periodic-backup-restore-introduction
---

# Azure Cosmos DB

## Mechanisms

### Multiple read regions with a single write region
- Replicates: data (every database and container of the account) from the write region to each read region that you add; how the replication behaves depends on the account's consistency level. The customer-managed failover on this replication is the forced failover (taking a region offline, which Learn also calls a customer managed failover or an offline region operation)
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: 15m (Learn's table for an account deployed in at least two regions gives "Less than 15 minutes" for session, consistent prefix and eventual consistency, 0 for strong, and K versions and T time for bounded staleness, whose minimum for a multiple-region account is 100,000 write operations or 300 seconds; the account's consistency level decides which row applies, and a forced failover of the write region "carries the possibility of data loss for any unreplicated writes")
- Estimated RTO: unknown (Learn: with a forced failover the downtime depends on how long you take to discover the outage and start the failover, and on the failover itself, which "is usually a few seconds"; the discovery and decision time is the customer's, so TC-3 measures the whole switch-over)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db

### Service-managed failover
- Replicates: nothing by itself; it is a setting of the account in which Microsoft decides when to fail the write region over to the next region in the failover priority order, on top of the replication of the mechanism above
- Paired: yes
- Nonpaired: yes
- Failover: Microsoft-managed
- Estimated RPO: unknown (Learn: "If Microsoft triggers service-managed failover for the account's write region, any unreplicated writes could be lost"; the amount depends on the consistency level, see the mechanism above)
- Estimated RTO: unknown (Learn: declaring an outage and triggering service-managed failover "can take significant time - potentially one hour or more"; Learn says "Microsoft is responsible for deciding when to fail over between regions" and advises a forced failover for faster recovery; Learn describes no customer-initiated trigger for it, so the playbook plans on the customer not controlling its timing, which is an inference)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db#failover-between-regions

### Change write region
- Replicates: nothing; it promotes another region of the account to be the write region while the regions are healthy, which Learn calls "effectively a planned failover of the write region"
- Paired: yes
- Nonpaired: yes
- Failover: manual
- Estimated RPO: 0 (Learn: "Changing the write region results in no data loss, because the data replication catches up before the new write region is promoted"; the operation needs healthy regions)
- Estimated RTO: unknown (Learn: "There might be a brief interruption", and clients with retry logic "don't typically experience significant impact"; no figure)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db#failover-between-regions

### Per-partition automatic failover (PPAF)
- Replicates: nothing by itself; it lets an account with a single write region fail over individual partitions to a secondary region while healthy partitions stay in the primary region
- Paired: yes
- Nonpaired: yes
- Failover: Microsoft-managed
- Estimated RPO: unknown (Learn: "If you configure your account with strong consistency, no data loss occurs. Otherwise, any unreplicated writes might be lost after the failover completes", so for the other consistency levels see the first mechanism)
- Estimated RTO: 3m (Learn: the system "typically" detects and recovers within 3 minutes, and for a write region failure expect "a brief interruption, which is usually around 3 minutes"; PPAF is a failover type that must be configured in advance)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db#behavior-during-a-write-region-failure

### Multiple write regions
- Replicates: data, asynchronously between all regions of the account, each of which accepts writes; write conflicts are resolved by a conflict resolution policy
- Paired: yes
- Nonpaired: yes
- Failover: not applicable
- Estimated RPO: 15m (Learn's table: "Less than 15 minutes" for session, consistent prefix and eventual, K and T for bounded staleness; strong consistency is not supported with multiple write regions; "recently updated data in the failed region might be unavailable in remaining regions")
- Estimated RTO: 0 (Learn: "There is no expected downtime in multi-write configurations, provided SDKs are correctly configured with `ApplicationRegions` or `PreferredRegions`"; no account failover is needed, the SDK routes to healthy regions)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db

### Periodic backup and restore
- Replicates: the periodic full backups of the account's data (every 4 hours by default, the latest two kept by default), which are stored in Azure Blob storage in the same region as the write region and then, in Learn's words, "replicated to another region through geo-redundant storage (GRS)", the region being "based on your source region and the regional pair associated with the source region"; Learn's periodic backup page says that the restore "always restores data into a new account, which is located in the write region of the source account", which is "only a single-region account", and that the Azure Cosmos DB team restores a backup when you request it through a support request (Learn's disaster recovery guidance words the restore location for a single-region account differently, see the constraint "A single-region account has no multiregion recovery"); Nonpaired is no as the playbook's reading of the pair wording (an inference: Learn does not say what happens for a region without a pair)
- Paired: yes
- Nonpaired: no
- Failover: not applicable
- Estimated RPO: unknown (Learn: the full backup runs every 4 hours by default and the interval is configurable; the page gives no figure for the replication of a backup to the other region; this is recovery from deletion or corruption, not a region failover)
- Estimated RTO: unknown (Learn: "The duration of restore depends on the amount of data that needs to be restored"; no figure)
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/periodic-backup-restore-introduction

## Constraints

### Any Azure region can be a read region
Learn says: "You can configure any Azure region as a read region for your Azure Cosmos DB account." The DR region therefore does not have to be the primary's pair.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db#requirements-1

### The portal's create-time geo-redundancy setting pairs the region
In the portal's Global Distribution tab the Geo-redundancy setting (value shown: Disable) is described as "Enable or disable global distribution on your account by pairing your region with a pair region. You can add more regions to your account later." Learn adds: "The following options aren't available if you select Serverless as the Capacity mode in the previous Basics page: Geo-redundancy, Multi-region writes". The Manage regions pane then offers a Region dropdown to add a region. This means a paired setup can come from enabling that setting when the account is created (an inference, not a Learn statement); together with the constraint above, the pairing is not a limit of the service.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-manage-database-account#create-an-account

### The replication lag and the RPO follow the consistency level
For an account in at least two regions the durability table is: session, consistent prefix and eventual consistency "Less than 15 minutes"; bounded staleness K and T (minimum 100,000 write operations or 300 seconds for a multiple-region account); strong consistency 0. For a single-region account the table gives "< 240 Minutes" for any consistency level. Learn shows the replication latencies between the regions of an account in the portal, in the Metrics section under Consistency.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels

### Strong consistency has a latency and distance cost
With strong consistency and more than one region, the write latency is two times the round-trip time between the two farthest regions plus 10 milliseconds at the 99th percentile, because a write completes only after it is committed to all regions. Learn says that "Strong consistency for accounts with regions spanning more than 5,000 miles (8,000 kilometers) is blocked by default because of high write latency" and that enabling it means contacting support. Strong consistency is also not supported with multiple write regions. A DR region that is far from the primary therefore changes which consistency level the team can choose.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels

### Strong and bounded staleness accounts with two regions can lose write availability when a read region fails
For strong consistency with only two regions, or bounded staleness whose staleness window is exceeded, a read region outage also takes away write availability until you take the affected region offline. Learn says that strong consistency requires two or more regions to maintain dynamic quorum, so with fewer than two regions available and no failover the account loses write availability until the service is restored.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db

### Serverless accounts run in one region
Learn says: "A serverless account can run only in a single Azure region. It isn't possible to add more Azure regions to a serverless account after you create the account." This means a serverless account cannot use this playbook's option; its recovery is the backup path of the mechanisms section.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/serverless#use-serverless-resources

### A single-region account has no multiregion recovery
In a region outage a single-region account loses read and write access until service is restored; Learn's recovery options are to wait, or, if the outage exceeds your RTO, to request a restore to a different region through Azure Support. The Periodic backup and restore mechanism records a different statement of Learn's periodic backup page about where a restore goes; the two Learn pages differ and the playbook does not choose between them, so the region of the restore is settled with Azure Support in the support request (the playbook's inference).
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/disaster-recovery-guidance#single-region-accounts

### Adding a region copies all the data before it is available
"When a new region is added, all data must be fully replicated and committed into the new region before the region is marked as available." How long this takes depends on how much data is stored in the account. An asynchronous throughput scaling operation that is in progress is paused and resumes when the add or remove region operation completes. When a region is removed, all replication across regions must complete before the region is marked as unavailable. In single-region write mode the write region cannot be removed: fail over to a different region first.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-manage-database-account#add-or-remove-regions-from-your-database-account

### Regions are added or removed as a separate operation
Learn's CLI page says that you can't add or remove regions and change other properties of the account in the same operation: modifying regions "must be performed as a separate operation than any other change to the account resource". The region command does not change failover priorities or trigger a failover; those have their own command.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/manage-with-cli#add-or-remove-regions

### Failover priority decides which region is promoted, and priority 0 is the write region
Failover priorities set the order in which regions are promoted to the write region during a failover. Learn's CLI page shows the account's regions as locations with a region name, a failover priority and a zone redundancy flag, and warns that "Changing region with priority = 0 will trigger a manual failover for an Azure Cosmos DB account. Any other priority change will not trigger a failover." Its priority sample is for an account configured for service-managed failover.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/manage-with-cli

### Account properties that show the failover setup
The Azure Resource Manager reference of the account lists enableAutomaticFailover ("Enables automatic failover of the write region in the rare event that the region is unavailable due to an outage"; the new write region is chosen from the failover priorities), enableMultipleWriteLocations, and the defaultConsistencyLevel of the account's consistency policy. These are the properties that an inventory reads for the failover mode and the consistency level.
- Source: https://learn.microsoft.com/en-us/azure/templates/microsoft.documentdb/databaseaccounts

### The forced failover is the customer's tool, with data-loss and recovery consequences
A forced failover (offline region) is "the recommended approach for quickly restoring availability during an outage"; "You're responsible for detecting the outage and triggering the failover." Learn says it "carries the possibility of data loss for any unreplicated writes" in the write region. After it, Microsoft must bring the region back online: for healthy regions this is automated "but can take up to several days", and if the region doesn't come back within a day or two you open a support case. Forced failover can also simulate a region outage in a DR drill.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db#failover-between-regions

### The portal's offline region operation promotes the highest priority and keeps the region offline for days
Learn's portal procedure warns of "the possibility of data loss due to un-replicated writes not being available in the region that will be promoted to the new write region based on the failover priority", promotes the region with the highest failover priority, and says that bringing a region back online "might take more than three days" depending on the impact's severity. For a DR drill Learn says to create a support ticket request to bring the region back online. In a single-write account the region comes back as a read region and the change write region operation promotes it again. Learn lists Region Offline and Region Online metrics for automation.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-manage-database-account#perform-forced-failover-for-your-azure-cosmos-db-account

### Service-managed failover may take an hour or more, and a forced failover is faster
When the account uses service-managed failover, Microsoft decides when to fail over; declaring the outage and triggering the failover "can take significant time - potentially one hour or more". Learn says to perform a forced failover instead of waiting. To test, Learn says to temporarily disable service-managed failover, invoke the forced failover and monitor the application, then fail back and restore service-managed failover. After a service-managed failover Microsoft automatically brings a region back online, which "can take several days".
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db#failover-between-regions

### Change write region needs healthy regions and is not for an outage
Learn warns to "avoid performing a change write region operation" if there's an outage of your account's write region: "Write region changes don't succeed if there's an outage of the source or destination region", because the region change procedure includes a consistency check that requires connectivity between the regions. Learn presents it as an operation for when the regions are healthy.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db#behavior-during-a-write-region-failure

### No control plane operations on the affected region during an outage
Learn lists as operations to avoid during a region outage: change write region or modify failover priority; update the account to multi-write; update consistency levels or other account settings; update private endpoint or network settings; update account throughput or scaling operations; and any other operation that changes the account configuration or region settings. They "result in account inconsistency and delay recovery". Everything the DR needs from this list is therefore done before the outage.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/disaster-recovery-guidance#operations-to-avoid-during-region-outages

### The recovered region is not promoted back automatically
After a write region outage the recovered region shows as online and is available as a read region. "The recovered region will not be promoted back as the write region automatically": changing the write region back is the customer's job, once it is safe, and it has no data or availability loss. Unreplicated writes can be read from the conflict feed, and the application resolves them and writes the result back.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db#region-recovery

### The remaining regions need capacity for the whole workload
If a region goes offline the remaining regions "experience higher request volume". Learn advises autoscale throughput, or, with provisioned throughput, planning for adequate capacity to handle the loss of a region, and consider over-provisioning. Learn's warning on the same page lists throughput updates and scaling operations among the operations to avoid during a region outage, so this capacity is set in advance (this means the Build, not the Failover, makes the capacity).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db#capacity-planning-and-management

### The SDK region list drives the client side of the failover
Ideally read region outages "should be handled at the client level" by the preferred regions list in the SDK configuration; the SDK marks an unavailable region and routes the next operations to the next available region of the list, and when none of the listed regions is available reads fall back to the account's current write region. The SDK threshold-based availability strategy (hedging) sends parallel read requests to multiple regions.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db

### Microsoft does not notify you that a region is down
"Microsoft doesn't automatically notify you when a region is down." Learn points to Azure Resource Health for the resource and Azure Service Health for the service, each with alerts.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db#behavior-during-a-read-region-failure

### Private endpoints are not region-bound and each needs its own DNS zone
An account supports multiple private endpoints, and a private endpoint in one region can reach an account in another region. Two private endpoints cannot use the same private DNS zone for the same endpoint, so each region has its own private DNS zone. When the account fails over the service name stays the same and no DNS change is needed for the account itself; if the outage hits the DNS servers hosted in the primary region, on-premises conditional forwarders have to be updated to the secondary region.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/failover-considerations-for-private-endpoints

### Per-partition automatic failover is labelled Preview
Learn's disaster recovery guidance headlines the accounts enabled with per-partition automatic failover (PPAF) as "(Preview)"; with PPAF the service "automatically manages failovers for partitions in an error state".
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/disaster-recovery-guidance#accounts-enabled-with-per-partition-automatic-failover-ppaf-preview

### Zone redundancy is set per region
Zone redundancy is not an account-wide setting: each region of an account is configured on its own. For most accounts it is enabled when a region is added, and Learn recommends enabling it for a single-region account or a single write region with read regions. Regions with zone redundancy "are charged at a premium", which is waived for multiple write regions and for autoscale.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db

### Control plane access: the Cosmos DB Operator role
The built-in Cosmos DB Operator role "lets you manage Azure Cosmos DB accounts, but not access data in them" and prevents access to account keys and connection strings. Its actions include Microsoft.DocumentDb/databaseAccounts/*, Microsoft.ResourceHealth/availabilityStatuses/read and Microsoft.Support/*. Native data-plane role assignments are stored as resources within the account, and creating them needs control plane access.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-connect-role-based-access-control#grant-control-plane-role-based-access

### Customer-managed keys depend on a Key Vault that stays reachable
When the account uses customer-managed keys, Learn requires that the Key Vault is reachable through public network access or lets trusted Microsoft services bypass its firewall (a vault only reachable through private endpoints can't host the keys), needs soft delete and purge protection, and "highly recommended" data replication on the Key Vault for continuous availability during unexpected regional outages. The Key Vault's own DR is the subject of the key-vault playbook.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-setup-customer-managed-keys#configure-your-azure-key-vault-instance

## Non-paired options

### add-dr-region: Add the DR region to the account as a read region
- Kind: native
- Target: dr-region
- Uses mechanism: Multiple read regions with a single write region
- Estimated RPO: 15m (Learn's upper bound for an account in more than one region with a single write region: "Less than 15 minutes" for session, consistent prefix and eventual consistency, 0 for strong consistency, and K and T for bounded staleness, whose minimum is 100,000 write operations or 300 seconds for a multiple-region account — https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels#consistency-levels-and-data-durability; for multiple write regions the same figures carry over only for session, consistent prefix and eventual consistency (under 15 minutes) and for bounded staleness (K and T), because strong consistency is not supported with multiple write regions; the account's consistency level decides, and TC-2 proves the lag against it)
- Estimated RTO: 30m (Estimated, team-set starting value for the switch-over target; TC-3 proves it. Learn: the failover itself is "usually a few seconds" for a forced failover, and the time to discover the outage and to decide is the team's; a service-managed failover can take one hour or more and is not planned on)
- Prerequisites: each item rests on the constraint named after it, which holds the Learn fact and its own Source: an account in provisioned throughput mode (constraint "Serverless accounts run in one region"); the DR region added as a read region (constraint "Any Azure region can be a read region") with a lower failover priority number than the pair region's, so that the DR region is promoted first (constraint "Failover priority decides which region is promoted, and priority 0 is the write region"); a consistency level that fits the distance between the regions (constraints "Strong consistency has a latency and distance cost" and "Strong and bounded staleness accounts with two regions can lose write availability when a read region fails"); the control plane role for the platform engineers who add the region, set priorities, run the failover and open support cases, and a data-plane role assignment for the application identity on the account (constraint "Control plane access: the Cosmos DB Operator role"); throughput (autoscale or provisioned) sized for the whole workload in the DR region (constraint "The remaining regions need capacity for the whole workload"); when the primary uses private endpoints, a private endpoint in the DR network with its own regional private DNS zone and a conditional forwarder plan for on-premises callers (constraint "Private endpoints are not region-bound and each needs its own DNS zone"); an SDK preferred regions list that names the primary and the DR region (constraint "The SDK region list drives the client side of the failover"); Resource Health and Service Health alerts (constraint "Microsoft does not notify you that a region is down"); for an account with customer-managed keys, a Key Vault that stays reachable after the loss of the primary region (constraint "Customer-managed keys depend on a Key Vault that stays reachable").
- Cost notes: each region added to the account increases the existing cost of the account; zone redundancy in the DR region is charged at a premium unless autoscale or multiple write regions waive it; throughput held ready for the whole workload; private endpoint and cross-region traffic; no price.
- Gives up: nothing of the replication itself (the service replicates to any region), but the customer gives up: a zero RPO unless the account uses strong consistency, which adds write latency; automatic failover that is fast (service-managed failover can take an hour or more, so the customer-managed forced failover is the planned path and a person has to decide); changing the account (priorities, consistency, throughput, private endpoint settings, adding multi-write) once the outage has started; and the recovered region coming back by itself, because Microsoft brings it online over days and the customer changes the write region back.
- Recommended when: the account uses provisioned throughput, the DR region is not the primary's pair (or no pair is available), the application can use the SDK region list and tolerate the loss of unreplicated writes up to the RPO of its consistency level, and a person with the Cosmos DB Operator role can run the forced failover.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-cosmos-db

## Migration from a paired setup

### Recognise today's setup
An account whose paired DR is built into the service shows in an inventory as one `microsoft.documentdb/databaseaccounts` resource whose locations list holds the primary region at failover priority 0 and one read region, the primary's pair, at priority 1; the flags enableAutomaticFailover and enableMultipleWriteLocations are read as they are (no value is assumed). A paired setup can come from enabling the portal's Geo-redundancy setting when the account was created (an inference; Learn shows that setting as Disable). Record today's DR as the account's replication to the pair when the region pair list confirms that the second region is the primary's pair; record it as Unknown when the locations are not readable. An account with one location has no multiregion DR today (its recovery is backup and restore), and a serverless account cannot have one. The migration to a DR region that is not the pair is the option `add-dr-region` and needs no data copy: the DR region is added as another read region and the pair region is removed only after validation passed.

### Build
1. add-dr-region: inventory the account: capacity mode (a serverless account stops here and goes to the backup path), the locations with their priorities and zone redundancy, enableAutomaticFailover, enableMultipleWriteLocations, the default consistency level, the backup policy, the private endpoints and their private DNS zones, whether customer-managed keys are used, and the SDK preferred regions list of every application. This inventory is what TC-1 compares.
2. add-dr-region: check the distance between the regions of the account: when the consistency level is strong and the DR region is more than 5,000 miles (8,000 kilometres) from any other region of the account, plan the support request that enables it, or choose a weaker level with its Estimated RPO from the durability table, and record the decision with the application owner.
3. add-dr-region: grant the roles: the platform engineers who run Build, Failover and Failback get the Cosmos DB Operator role at the scope of the account (it holds Microsoft.DocumentDb/databaseAccounts/*, Resource Health read and Microsoft.Support/*, so it covers adding the region, changing priorities, the forced failover, changing the write region back and opening a support case); the application's managed identity keeps its data-plane role assignment, which belongs to the account and so is the same in the DR region; nobody gets the account keys for the DR path.
4. add-dr-region: add the DR region as its own operation (no other account change in the same operation), with zone redundancy when the DR region supports it and the team chooses it. Wait until the region is marked as available: the time depends on how much data the account holds, and the region is available only after all data is replicated and committed.
5. add-dr-region: set the failover priorities as a separate operation, with the primary write region at 0, the DR region at 1 and the paired region after it, and leave priority 0 with the current write region (a change of priority 0 triggers a manual failover); decide and record whether service-managed failover stays enabled as a backstop (Learn's order is to enable service-managed failover first and then set the priority of each region); when the team will rehearse with a forced failover, the runbook says to disable it temporarily.
6. add-dr-region: set the capacity: autoscale throughput, or provisioned throughput that handles the whole workload in one region, for every database and container (Learn lists autoscale and over-provisioning); this is done now because throughput changes are on the list of operations to avoid during the outage.
7. add-dr-region: build the DR network path when the primary uses private endpoints: a private endpoint for the account in the DR virtual network, its own private DNS zone for that region (two endpoints cannot share one zone for the same name), the link of the zone to the DR network, and conditional forwarders for on-premises callers that can be pointed at the DR region's resolvers.
8. add-dr-region: deploy the application configuration: the preferred regions list names the primary first and the DR region next for every application that talks to the account, set per deployment so that a region is added to or removed from it without a code change; the SDK retries transient faults; the DR deployment of the application has the same data-plane identity.
9. add-dr-region: set up monitoring: Resource Health alerts and Service Health alerts for the account, an alert on the replication latency between the write region and the DR region against the bound of TC-2, and an alert on the Region Offline and Region Online metrics that Learn lists for automation.
10. add-dr-region: for an account with customer-managed keys, confirm that the Key Vault stays reachable after the loss of the primary region and has soft delete, purge protection and data replication (see the key-vault playbook for its options).
11. add-dr-region: write the runbook with the Failover and Failback tables, including the rule not to run control plane operations on the affected region during the outage, then go to Validate.

### Validate
1. add-dr-region: run TC-1 once, then at the frequency of TC-1.
2. add-dr-region: run TC-2 every day for 7 consecutive days, then at the frequency of TC-2.
3. add-dr-region: run TC-5 once from every DR network, then at the frequency of TC-5.
4. add-dr-region: run TC-6, then at the frequency of TC-6.
5. add-dr-region: run TC-4, then at the frequency of TC-4.
6. add-dr-region: run TC-8 (backup policy and restore plan), then at the frequency of TC-8.
7. add-dr-region: run TC-3 with the Failover and Failback tables on a non-production account that has the same topology and consistency level, or in a window that the account's owner accepted for the production account, because Learn says that Microsoft must bring the region back online after a forced failover, which can take several days, and that a support request brings it back online after a drill; time the switch-over against the target the team set, then run TC-3 at its frequency.
8. add-dr-region: run TC-7 (the design check of the runbook, roles and alerts), then at the frequency of TC-7.
9. add-dr-region: record each result with its date; a time or figure that a drill measured is Demonstrated, and everything else, including the service-managed failover time and the time Microsoft takes to bring a region back online, stays Estimated or Unknown.

### Cut over
1. add-dr-region: make the DR region the promoted region of the runbook (priority 1) and write the DR region, the target switch-over time and the owner of the forced failover decision into the runbook.
2. add-dr-region: change the application's DR configuration so that the DR deployment names the DR region first in its preferred regions list.
3. add-dr-region: remove the runbook steps that relied on the paired region as the failover target, once Validate has passed.

### Decommission
1. add-dr-region: remove the paired region from the account only after Validate passed and while the primary region and the DR region are healthy and the DR region is replicating: do it as its own operation, never when the paired region is the write region (fail over first), never during an outage, and expect it to wait until all replication across regions completes. The team may keep the paired region as a third region instead, which then costs what Learn describes for any region added.
2. add-dr-region: remove the paired region's private endpoint, its private DNS zone link, its alerts, its entry in every application's preferred regions list and its throughput planning.
3. add-dr-region: re-run TC-1 and TC-2 after the removal, because the account then has the primary and the DR region only (see the constraint on two-region accounts for strong consistency and bounded staleness).

### Keep until cut-over
For add-dr-region: the paired region, its failover priority, its private endpoint with its DNS zone, the application's preferred regions entry for it and the runbook steps that fail over to it stay until TC-1 to TC-8 have passed and the DR region is the promoted region. The account's backup policy, its network settings and its data-plane role assignments stay for good.

## Failover and failback

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the write region of the account is down and declare DR for the workload; Learn says "Microsoft doesn't automatically notify you when a region is down", so the signals are Resource Health and Service Health alerts, the service issue banner in the portal and the email alert that Learn's disaster recovery guidance describes for a configured subscription | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time, and Resource Health of the account or Service Health shows the write region affected | The write region answers writes again before the declaration |
| 2 | add-dr-region: record the consistency level and the last replication latency between the write region and the DR region, so that the possible data loss is known before the failover | Platform engineer | Estimated unknown (measured in the first drill) | The record shows the consistency level and the last latency; for strong consistency the record says that no data loss is expected | The DR region is also shown as affected: do not start the failover, open a support request and wait for the incident manager |
| 3 | add-dr-region: check the account's current write region, then perform the forced failover (offline region) of the affected write region, so that the region with the highest failover priority (the DR region) becomes the write region; do not wait for the service-managed failover, in which Microsoft decides when to fail over (Learn describes no customer-initiated trigger for it, so the playbook does not plan on it) and which can take one hour or more | Platform engineer | Estimated unknown (Learn: the forced failover itself is "usually a few seconds"; measured in the first drill) | The account shows the DR region as the write region and the original write region as offline, and the Region Offline metric is set | The write region is already the DR region (service-managed failover ran first): skip this step and go on with the failover step that starts or switches the application in the DR region. Never use change write region here: Learn says to avoid it during a write region outage |
| 4 | add-dr-region: start or switch the application in the DR region and let its SDK use the DR region from the preferred regions list; make no change to the account while the outage lasts (no priority, consistency, throughput, network or multi-write change) | Application engineer | Estimated unknown (measured in the first drill) | A test write from the application in the DR region succeeds and the SDK diagnostics show the DR region, and the canary document written before the outage (TC-3) is read back or recorded as unreplicated | Writes fail with the account's write region still the original one: check the failover step that performs the forced failover, do not change any other account setting, and open a support request |
| 5 | add-dr-region: when the account is reached over private endpoints, check that the DR network resolves the account name to its own private endpoint; update the on-premises conditional forwarders only when the DNS servers of the failed region are impacted | Network engineer | Estimated unknown (measured in the first drill) | The account name resolves to the private IP address of the DR endpoint from the DR network, and from on-premises when callers use it | The name does not resolve in the DR network: fix the DNS zone link or the forwarder, and do not change the account's private endpoint or network settings during the outage |
| 6 | add-dr-region: watch the throttling of the DR region and shed or queue load in the application when it is throttled | Application engineer | Estimated unknown (measured in the first drill) | The rate of throttled requests (429) stays under the bound that TC-6 recorded and the request latency is within the application's target | Throttling stays above the bound: shed load in the application and do not rescale throughput, because Learn lists throughput updates among the operations to avoid during the outage |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | add-dr-region: wait until Microsoft brings the original region back online; it is not done by the customer (Learn: it can take up to several days, and more than three days in an outage) | Platform engineer | Estimated unknown (Learn: several days; measured only in a real event or in a drill) | The original region shows as online in the portal, the Region Online metric is set and it is a read region of the account | The region is not online after a day or two: open a support request, as Learn says, and stay on the DR region |
| 2 | add-dr-region: read the unreplicated writes from the conflict feed, resolve them with the application's logic and write the result back; skip it for strong consistency | Application engineer | Estimated unknown (depends on the volume of unreplicated writes; measured in the first drill) | The conflict feed is empty or each entry is resolved and the result is written back | The conflict feed cannot be read or resolved: stay on the DR region and keep the write region where it is |
| 3 | add-dr-region: when the regions are healthy and the original region has caught up, change the write region back to the original region (change write region, never during an outage) | Platform engineer | Estimated unknown (Learn: "a brief interruption", no data loss; measured in the first drill) | The account shows the original region as the write region, the DR region is a read region, and a test write succeeds | Either region shows an outage: do not change the write region, and stay on the DR region |
| 4 | add-dr-region: restore the failover priorities (original region 0, DR region 1) as a separate operation, and re-enable service-managed failover when it was disabled for the failover or a drill | Platform engineer | Estimated unknown (measured in the first drill) | The locations show the planned priorities and TC-1 shows no difference with the inventory | The priority change would put another region at 0: stop, the change of priority 0 triggers a failover |
| 5 | add-dr-region: switch the application back to the original region and keep the DR region second in its preferred regions list | Application engineer | Estimated unknown (measured in the first drill) | The SDK diagnostics show the original region for writes and the DR region as the fallback | Errors rise after the switch: switch the application back to the DR region |
| 6 | add-dr-region: re-run TC-1, TC-2 and TC-6 | Platform engineer | Estimated unknown (TC-2 needs a day of measurements; measured in the first drill) | The three criteria pass | A criterion fails: keep the failback open and correct the account before closing the incident |

## Test criteria

### TC-1: The DR region is in the account and the failover setup is as planned
- Applies to: add-dr-region
- Pass condition: the account's locations list holds the DR region with the failover priority that the plan gives it (the primary write region 0, the DR region 1), with the zone redundancy that the plan gives each region, and with enableAutomaticFailover, enableMultipleWriteLocations and the default consistency level equal to the inventory of the Build step that inventories the account; no region of the account is left that the plan does not name after Decommission.
- How to measure: read the account's properties with a read-only query (`az cosmosdb show` or Azure Resource Graph) and compare them with the inventory.
- Evidence: the query output with its date, the list of regions with their priorities and zone redundancy, and the three properties.
- Frequency: weekly, and after every change to the regions, the failover priorities or the failover setting of the account

### TC-2: The replication lag stays below the Estimated RPO
- Applies to: add-dr-region
- Pass condition: for 7 consecutive days the replication latency from the write region to the DR region stays below the Estimated RPO of the option (15 minutes for session, consistent prefix and eventual consistency), or below the K and T that the account sets for bounded staleness; for strong consistency the check is that the account's default consistency level is Strong, because all regions commit every write.
- How to measure: read the replication latency between the regions in the portal's Metrics under Consistency (or the same metric through Azure Monitor) with the maximum per day, and write a canary document in the write region every day and time its appearance in the DR region.
- Evidence: the 7-day export of the metric with its daily maximum and the canary read times.
- Frequency: before cut-over, then monthly

### TC-3: The failover works end to end within the target the team sets
- Applies to: add-dr-region
- Pass condition: in a drill that runs the Failover and Failback tables, the time from the start of the forced failover to the first successful write from the application in the DR region is at or below the Estimated RTO of the option (30m, a team-set starting value that the first drill confirms or replaces, recorded before the drill), no document that the canary wrote before the failover is lost beyond the Estimated RPO of the account's consistency level, and the Failback table closes with TC-1 passing. The time that Microsoft takes to bring the region back online and the service-managed failover time are not part of the pass condition: they can only be observed in a real event or in the drill's recovery.
- How to measure: a drill on a non-production account with the same topology, or on the production account in a window that the owner accepted: temporarily disable service-managed failover, write canary documents with timestamps, run the forced failover, time the switch-over, read back the canary documents, then follow the Failback table, with the support request that brings the region back online after a drill.
- Evidence: the drill record with its timestamps, the account's activity log entries for the forced failover and the change of the write region, the canary read-back list and the measured times.
- Frequency: every DR drill, and after every change to the regions, the consistency level or how the application selects regions

### TC-4: The application reaches the DR region without a code change
- Applies to: add-dr-region
- Pass condition: with the primary region removed from the application's reachable regions (by excluding it in the SDK configuration or blocking it in the network), reads and, after the forced failover of TC-3, writes succeed from the DR region using only the application's configuration: the preferred regions list names the primary first and the DR region next, no region or endpoint is hard-coded, and the SDK retries transient faults.
- How to measure: a review of the application's SDK configuration, then a read test with the primary region excluded, with the SDK diagnostics checked for the region used.
- Evidence: the configuration review record and the test log with the region that served each request.
- Frequency: every release that changes how the application selects regions, and every DR drill

### TC-5: The private and data-plane access path works from the DR network
- Applies to: add-dr-region
- Pass condition: from every DR network that runs consumers, the account name resolves to the private IP address of that region's private endpoint (or to the planned public path), a canary read succeeds with the application's identity, the DR region's private DNS zone is linked to that network, and the application identity holds the data-plane role assignment of the account.
- How to measure: resolve the account name from inside each DR network, run the canary read with the application's identity, and list the private endpoint connections, the DNS zone links and the account's data-plane role assignments with read-only queries.
- Evidence: the resolved addresses, the canary read result and the role assignment list, with their date.
- Frequency: weekly, and after every change to the DR network, the DNS or the role assignments

### TC-6: The DR region has the capacity for the whole workload
- Applies to: add-dr-region
- Pass condition: the autoscale maximum or the provisioned throughput of every database and container is at least the peak request unit consumption that the whole workload showed in the last 30 days, in one region, and the rate of throttled requests (429) during the capacity test stays under the bound that the team sets and records.
- How to measure: read the peak of the normalized request unit consumption and the configured throughput of every container with read-only queries, and during a load test in the DR region (or in a drill) count the 429 responses.
- Evidence: the table of containers with configured throughput and the observed peak, the load-test result with its date and the bound.
- Frequency: monthly, and after every change to the workload or to the throughput

### TC-7: The runbook, roles and alerts are in place (design check, not drillable)
- Applies to: add-dr-region
- Pass condition: design check, not drillable: the service-managed failover time, the time Microsoft takes to bring a region back online and the behavior of a region outage can be seen only in a real event, so the check passes when: the runbook holds the Failover and Failback tables and the rule that no control plane operation runs on the affected region during the outage; the platform engineers on the roster hold the Cosmos DB Operator role at the account scope (or the equivalent custom role); the team can open a support request; Resource Health alerts, Service Health alerts and the alert on the replication latency exist and a test alert reached the incident manager; and the decision on service-managed failover (kept as a backstop or disabled) is recorded.
- How to measure: a review of the runbook, a read-only list of the role assignments of the account, a list of the alert rules and a test alert. In a real event, record the time from the loss of the write region to the first successful write in the DR region.
- Evidence: the review record with its date, the role assignment list, the alert rule list and the test alert record; after a real event, the observed time.
- Frequency: after every change to the runbook, the roles or the alerts, and every DR drill

### TC-8: The account has a backup policy for corruption and deletion
- Applies to: add-dr-region
- Pass condition: the account's backup policy is periodic or continuous as the plan says, with the interval and retention that the team recorded, and the runbook holds the restore path (a support request for periodic backup, or a point-in-time restore for continuous backup); this is recovery from deletion or corruption, which replication copies to the DR region, and it is not the proof of region failover.
- How to measure: read the account's backup policy with a read-only query and check the runbook.
- Evidence: the query output with its date and the runbook page.
- Frequency: monthly, and after every change to the account's backup policy
