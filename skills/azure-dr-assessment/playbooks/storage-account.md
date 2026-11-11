---
service: storage-account
title: Azure Storage account
arm_types:
  - microsoft.storage/storageaccounts
slot: data-replication.storage
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-files
  - https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-overview
  - https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-configure
  - https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-priority-replication
  - https://learn.microsoft.com/en-us/azure/storage/common/storage-disaster-recovery-guidance
  - https://learn.microsoft.com/en-us/azure/storage/common/storage-failover-customer-managed-planned
  - https://learn.microsoft.com/en-us/azure/storage/common/storage-failover-customer-managed-unplanned
  - https://learn.microsoft.com/en-us/azure/storage/common/storage-initiate-account-failover
  - https://learn.microsoft.com/en-us/azure/storage/common/last-sync-time-get
  - https://learn.microsoft.com/en-us/azure/storage/common/redundancy-migration
  - https://learn.microsoft.com/en-us/azure/storage/files/files-disaster-recovery
  - https://learn.microsoft.com/en-us/azure/storage/common/storage-private-endpoints
  - https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azcopy-blobs-copy
  - https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azcopy-files
  - https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azcopy-authorize-azure-active-directory
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/permissions/storage
---

# Azure Storage account

## Mechanisms

### Geo-redundant storage (GRS and GZRS)
- Replicates: the data of every service in the account (blobs, files, tables, queues), asynchronously from the primary region to the primary's paired region, where it is stored with locally redundant storage (LRS); GRS uses LRS in the primary region and GZRS uses zone-redundant storage (ZRS) there
- Paired: yes
- Nonpaired: no
- Failover: customer-managed
- Estimated RPO: 15m (Learn: "You can expect the replication lag to be less than 15 minutes, but this time is an estimate and not guaranteed"; the Last Sync Time property shows the actual lag; a planned failover completes only after all data is synchronized, so its RPO is zero)
- Estimated RTO: 60m (Learn: customer-managed failover "typically completes within 60 minutes, depending on the account size and complexity"; the customer starts it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob#geo-redundant-storage-for-paired-regions

### Read-access geo-redundant storage (RA-GRS and RA-GZRS)
- Replicates: the same data as GRS and GZRS, with read access to the secondary endpoint in the pair, which can return slightly outdated data
- Paired: yes
- Nonpaired: no
- Failover: customer-managed
- Estimated RPO: 15m (Learn: the same lag estimate as GRS and GZRS, "not guaranteed")
- Estimated RTO: 60m (Learn: write access returns through the same customer-managed failover; reading from the secondary endpoint needs no failover and Learn gives no figure for the application's own switch to it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob

### Microsoft-managed failover
- Replicates: nothing of its own: it promotes the secondary region of the geo-redundant accounts of a region
- Paired: yes
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: unknown (the replication is asynchronous and Learn publishes no figure for this failover)
- Estimated RTO: unknown (Learn: "a last resort", "expected to only be performed after an extended period of outage"; Microsoft decides, and the customer cannot trigger or rehearse it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob#failover-types

### Object replication
- Replicates: block blobs of selected containers (optionally filtered by prefix) from a source account to a destination account in any Azure region, with their versions, metadata and properties, asynchronously
- Paired: yes
- Nonpaired: yes
- Failover: manual
- Estimated RPO: 15m (Learn: with priority replication enabled and source and destination in the same continent, 99.0% of objects replicate within 15 minutes for supported workloads, under an SLA; without it replication is asynchronous and the accounts "aren't immediately in sync")
- Estimated RTO: unknown (object replication has no failover of its own: the switch-over is the application's and the team's, so the option sets the figure)
- Source: https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-overview

### Custom multiregion solution with multiple storage accounts
- Replicates: whatever the customer's own tooling copies between separate storage accounts in different regions: AzCopy, Azure Data Factory, or Azure File Sync with a DR server endpoint
- Paired: yes
- Nonpaired: yes
- Failover: manual
- Estimated RPO: unknown (Learn publishes no figure: it is the copy interval and run time that the team sets)
- Estimated RTO: unknown (Learn publishes no figure: it is the switch-over that the team designs)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-files#custom-multiregion-solutions-for-resiliency

## Constraints

### Geo-redundant storage works only within paired regions
Learn: "Geo-redundant storage (GRS) only works within Azure paired regions." The secondary region is determined by the primary region and "can't be customized". For an account in a nonpaired region, or to fail over to a region that is not the primary's pair, Learn points to custom multiregion solutions.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob#resilience-to-region-wide-failures

### Replication to the pair is asynchronous
Recent writes can be lost if the primary region fails before they replicate. The lag is expected to be under 15 minutes but is "an estimate and not guaranteed"; the Last Sync Time property shows how much data might be lost in an unplanned failover. GRS and GZRS give no read access to the secondary until a failover; RA-GRS and RA-GZRS give read access to the secondary endpoint.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob#considerations

### Failover types and Microsoft-managed failover
Azure Storage has customer-managed unplanned failover, customer-managed planned failover and Microsoft-managed failover. Microsoft-managed failover "is a last resort", is initiated for a whole region, "can't be initiated for individual storage accounts, subscriptions, or customers" and might occur at different times for different services. Learn: "Don't rely on Microsoft-managed failover". A GRS account needs no preconfiguration for any failover type.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob#failover-types

### An unplanned failover can lose data and ends as LRS
Learn: "Initiating a customer-managed unplanned failover automatically converts your storage account to locally redundant storage (LRS) within a new primary region, and deletes the storage account in the original primary region." Re-enabling geo-redundancy afterwards costs money and takes time that depends on the number and size of objects.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-disaster-recovery-guidance#the-time-and-cost-of-failing-over

### An unplanned failover is for an unavailable primary
Learn: "Use an unplanned failover when storage in the primary region is unavailable." Decide whether restoring service justifies the risk of data loss, and consider whether Azure Resource Health shows problems and whether Microsoft advises a failover.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob#behavior-during-a-region-failure

### A planned failover needs both regions and loses no data
"The storage account must be available in both the primary and secondary regions before a planned failover can be initiated." The primary endpoints become read-only while the last updates replicate, then the DNS entries switch; both regions' endpoints are temporarily unavailable. Data loss "isn't expected" while both regions stay available, the account remains geo-replicated, and failback is another planned failover that restores the original redundancy; each typically takes about an hour.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-failover-customer-managed-planned

### Planned failover is not available in every region
Customer-managed planned failover is available in all public regions that support GRS or GZRS, except West India and Switzerland West.
- Source: https://learn.microsoft.com/en-us/azure/storage/files/files-disaster-recovery#customer-managed-planned-failover

### Endpoints stay the same and clients retry
During a failover both endpoints are temporarily unavailable for reads and writes and active requests might be dropped, so clients retry. Azure updates the endpoints so applications "don't need to be reconfigured", but an application that caches DNS entries might need to clear the cache.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob#behavior-during-a-region-failure

### Account types, features and consequences for a customer-managed failover
GRS and RA-GRS support customer-managed failover for general-purpose v2, general-purpose v1 and legacy Blob Storage accounts; GZRS and RA-GZRS only for general-purpose v2. Not supported: Azure File Sync cloud endpoints, accounts with premium block blobs (which "don't currently support geo-redundancy"), accounts with NFS 3.0 ("You can't create a storage account configured for geo-redundancy with NFSv3 enabled") and, for object replication, both source and destination. The feature table marks change feed and point-in-time restore as unsupported for planned failover and supported for unplanned failover. An unmanaged disk attached to a running VM is leased, and "An account failover can't proceed when there's a lease on a blob". After an unplanned failover accounts with a hierarchical namespace, change feed or point-in-time restore can see inconsistencies, the earliest point-in-time restore point resets to the failover completion time, and archived blobs must be rehydrated before geo-redundancy is configured again.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-disaster-recovery-guidance

### The storage resource provider does not fail over
After a failover data operations use the new primary, but "resource management operations must still take place in the primary region. If the primary region is unavailable, you aren't be able to perform management operations on the storage account."
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-disaster-recovery-guidance#storage-resource-provider

### Failing back after an unplanned failover
Re-enable geo-redundancy and check the Last Sync Time against the last write to the new primary before failing back: "your data isn't allowed to finish replicating to the secondary region during the failback process", so a failback too early can lose a major part of the data. After the failback the account is LRS (ZRS if it was GZRS) and the customer reconfigures geo-redundancy again.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-failover-customer-managed-unplanned#the-unplanned-failover-and-failback-process

### Reading the Last Sync Time
Learn reads the Last Sync Time with PowerShell (Get-AzStorageAccount with -IncludeGeoReplicationStats, property GeoReplicationStats.LastSyncTime, Az.Storage 1.11.0 or later) or with the Azure CLI (az storage account show with --expand geoReplicationStats, query geoReplicationStats.lastSyncTime). It is a GMT date and time: data written before it is on the secondary, data written after it might not be.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/last-sync-time-get

### Reading the failover state of an account
Before and after a failover Learn checks the account with Get-AzStorageAccount -IncludeGeoReplicationStats (or az storage account show --expand geoReplicationStats), looking at PrimaryLocation, SecondaryLocation, StatusOfPrimary, StatusOfSecondary, LastGeoFailoverTime, FailoverInProgress and the SKU name. The portal Redundancy page shows the failover status, and when the failover is complete it shows the last failover time and the new primary region. Failover can be started in the portal, PowerShell (Invoke-AzStorageAccountFailover) or the Azure CLI (az storage account failover), planned or unplanned.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-initiate-account-failover

### The failover permission
Learn's permission list for Azure Storage names Microsoft.Storage/storageAccounts/failover/action ("Customer is able to control the failover in case of availability issues"). The identity that starts a failover needs it on the account.
- Source: https://learn.microsoft.com/en-us/azure/role-based-access-control/permissions/storage#microsoftstorage

### Azure Files geo-redundancy covers standard shares only
Azure Files supports GRS or GZRS for standard (HDD) shares only; premium (SSD) shares must use LRS or ZRS. It does not support RA-GRS or RA-GZRS: such an account's standard shares are "configured and billed as GRS or GZRS".
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-files#requirements-1

### Azure Files Last Sync Time is snapshot based, with a share limit
For Azure Files the Last Sync Time is "based on the latest system snapshot in the secondary region". The calculation can time out above 100 file shares in an account, so Learn recommends 100 or fewer.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-files#considerations

### Azure Files replicates a system snapshot every 15 minutes
The primary creates a system snapshot every 15 minutes and replicates it; after a failover the share state is the latest system snapshot in the secondary, which "might be older than 15 minutes". Azure Files "typically has an RPO of 15 minutes or less", with no SLA on replication time.
- Source: https://learn.microsoft.com/en-us/azure/storage/files/files-disaster-recovery

### An Azure Files failover needs idle clients
Before a planned failover, stop all applications and clients on the file shares and check for open handles with Get-AzStorageFileHandle; active I/O "can result in file shares entering an inconsistent state". File handles and leases aren't retained, so clients unmount and remount. Azure File Sync supports account failover only if the Storage Sync Service is also failed over, and Microsoft Support must be asked to make it honor the new account location.
- Source: https://learn.microsoft.com/en-us/azure/storage/files/files-disaster-recovery

### Private endpoints follow a failover
Learn: "You don't need to create a private endpoint for the secondary instance for failover. The private endpoint will automatically connect to the new primary instance after failover." Read access to the secondary of an RA-GRS account needs separate endpoints for both instances.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-private-endpoints#creating-a-private-endpoint

### Private DNS zones for storage private endpoints
The recommended zone names are privatelink.blob.core.windows.net (blob), privatelink.file.core.windows.net (file), privatelink.table.core.windows.net (table), privatelink.queue.core.windows.net (queue) and privatelink.dfs.core.windows.net (Data Lake Storage). Private endpoints are not available for general-purpose v1 accounts.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-private-endpoints

### Changing the geo-redundancy of an existing account
The geo-redundant or read-access setting is changed in the portal, PowerShell or the Azure CLI. Adding geo-redundancy has a one-time egress charge, and "failover to the secondary region can't be initiated until data synchronization between the two regions is complete". Removing it (GRS to LRS, GZRS to ZRS) uses the same change. An LRS account that resulted from a failover cannot convert to ZRS or GZRS and needs a manual migration.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/redundancy-migration#changing-redundancy-configuration

### Object replication covers block blobs in two account types
Source and destination must be general-purpose v2 or premium block blob accounts. Block blobs only: "it doesn't support append blobs and page blobs". Not supported with a hierarchical namespace, for blobs uploaded through the Data Lake Storage APIs, or for source blobs encrypted with a customer-provided key. Because the scope is block blobs, file shares, tables and queues are outside it; this follows from the scope and the page does not name them.
- Source: https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-overview#prerequisites-and-caveats-for-object-replication

### Object replication needs versioning, change feed and the Contributor role
Blob versioning on both accounts and change feed on the source; enabling them can add cost and needs the Microsoft.Storage/storageAccounts/blobServices/write permission, which Learn says amounts to permission to copy data between the accounts once a policy exists. To configure a policy you need the Azure Resource Manager Contributor role scoped to the account or higher. Learn names no role for deleting a policy; the playbook assigns Contributor for that too and TC-6 proves it (an inference).
- Source: https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-configure#prerequisites

### Object replication is asynchronous
Block blob data is replicated asynchronously, so "the source account and destination account aren't immediately in sync". The replication status of a source blob shows whether replication is complete.
- Source: https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-overview#how-object-replication-works

### Priority replication has a 15-minute service level for supported workloads
Object replication "copies all operations ... asynchronously, with no guaranteed completion time"; with priority replication and source and destination in the same continent, 99.0% of objects replicate within 15 minutes for supported workloads under an SLA. It automatically enables replication metrics (operations and bytes pending, in time buckets such as 0-5 and 5-10 minutes). Excluded: objects over 5 GB, objects modified more than 10 times a second, periods above 1 Gbps or 1,000 PUT or DELETE operations a second, and pending replication of existing blobs after a policy change (about 100 TB a day on average). Only one policy per source can have it, it adds a per-GB charge for new data, and billing continues 30 days after disabling.
- Source: https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-priority-replication

### Object replication policies, rules and the write lock
The policy is created on the destination and associated with the source by policy ID, and the IDs must match. A source replicates to at most two destinations, one policy is allowed for each source and destination pair, and a policy holds up to 1,000 rules. Accounts can be in different regions, subscriptions or tenants. Containers must exist before a rule names them; by default only new blobs are copied. After the policy exists, writes to the destination container fail with error 409 (Conflict). Learn: "You can disable the rule by either deleting it for that container or by removing the entire replication policy."
- Source: https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-overview#object-replication-policies-and-rules

### Removing and recreating an object replication policy
Learn: "To remove a replication policy, delete the policy from both the source account and the destination account." Deleting a policy also deletes its rules. Learn does not say whether deleting it on the destination alone lifts the write lock, so that path is an unverified inference that the failover step that deletes the replication policy and TC-6 prove in a drill. A policy deleted and recreated for the same container pair is "an entirely separate replication relationship": a new policy ID is generated and the destination container is "assigned a new replication lock".
- Source: https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-configure

### What object replication copies and what it does not
It copies the contents, versions, metadata and properties of a block blob; a delete replicates as the current version becoming a previous version. It does not copy snapshots, and the destination blob gets a new version ID. Index tag replication is in preview. Replication fails if a blob in either account moves to the archive tier, and rehydrating does not trigger it. An immutability policy on the destination can make source updates and deletes fail to replicate.
- Source: https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-overview#how-object-replication-works

### Customer-managed failover is not supported with object replication
Learn: "Customer-managed failover isn't supported for either the source or the destination account in an object replication policy." So creating a policy on a geo-redundant account takes away that account's customer-managed failover.
- Source: https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-overview#prerequisites-and-caveats-for-object-replication

### The failover feature table lists object replication differently
Learn's disaster recovery page lists object replication as unsupported for planned failover and supported for unplanned failover, while the same page's list of unsupported services says customer-managed failover is not supported for accounts in a policy. This playbook follows the stricter statement: no account is in both a policy and a customer-managed failover plan.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-disaster-recovery-guidance#unsupported-features-and-services

### Custom multiregion solutions
Learn lists as reasons: a nonpaired region, a recovery time or data loss the built-in options do not meet, failover to a region that is not the primary's pair, an active/active need, and (Azure Files) a share type without geo-redundancy. With separate accounts "you need to configure cross-region data replication, implement load balancing and failover policies, and ensure data consistency across regions". For Azure Files Learn names AzCopy or Azure Data Factory, which "requires custom development and conflict resolution mechanisms", and Azure File Sync to a share in another region through a DR server endpoint on a VM (cloud tiering disabled, enough VM storage for the whole dataset, changes made on the server endpoint).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-files#custom-multiregion-solutions-for-resiliency

### Copy tools for each data service when geo-redundancy is not used
Learn's guidance: copy block blobs to another region with AzCopy, Azure PowerShell or the Data Movement library; for files, "when GRS isn't available", copy with AzCopy or Azure PowerShell; for tables, use AzCopy to export to another account in a different region. It names no copy for queues, so a queue's contents have no documented copy; this means a queue is better designed so its messages can be re-created.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-disaster-recovery-guidance#design-for-high-availability

### AzCopy guidelines for copying between accounts
With Microsoft Entra authorization for both accounts, they must be in the same tenant. The client needs network access to both accounts. Index tags must be reapplied to the destination, uppercase characters in metadata names become lowercase, and a copy to a premium block blob account omits the access tier.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azcopy-blobs-copy#guidelines

### AzCopy roles
Read: Storage Blob Data Reader (blobs) or Storage File Data Privileged Reader (files). Write: Storage Blob Data Contributor or Owner (blobs) or Storage File Data Privileged Contributor (files). Role assignments can take up to five minutes to propagate.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azcopy-authorize-azure-active-directory#verify-role-assignments

### AzCopy and Azure Files
Commands on files and directories can use Microsoft Entra authorization, but a command that targets only the share or the account needs a SAS token. From version 10.30.0 AzCopy does not create file shares. --preserve-permissions carries ACLs and --preserve-info carries SMB properties. AzCopy sync is "supported but not fully recommended for Azure Files": up to 10 million files per job, and some file fidelity might be lost. NFS shares need the --from-to switch.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azcopy-files

### Copying between accounts over private endpoints
It works only with the REST API or tools that use it (such as AzCopy), only for private endpoints on the blob or file resource (the dfs endpoint is "not yet supported"), and copying between accounts with NFS is "not yet supported". The client needs network access to both accounts.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-private-endpoints#known-issues

### Data protection features and backup are separate layers
Point-in-time restore, versioning, soft delete and snapshots keep their data in the same account and region (soft-deleted data also replicates to the secondary of a geo-redundant account), so they are not a second region. For cross-region backup Learn names Azure Backup for blobs, which can store backup data in a different region; the Azure Backup playbook covers it.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob#backup-and-recovery

## Non-paired options

### object-replication: Object replication to a second account in the DR region
- Kind: workaround
- Target: dr-region
- Uses mechanism: Object replication
- Estimated RPO: 15m (Learn: with priority replication enabled and source and destination in the same continent, 99.0% of objects replicate within 15 minutes for supported workloads, under an SLA; without it replication is "asynchronous" and the accounts "aren't immediately in sync", https://learn.microsoft.com/en-us/azure/storage/blobs/object-replication-overview; the team enables priority replication and TC-2 measures the lag)
- Estimated RTO: 30m (Estimated, team-set starting value: the switch-over time the team designs: delete the replication policy so the destination accepts writes, then point the application at the DR account; Learn publishes no figure; TC-6 proves it)
- Prerequisites: a DR account in the DR region, general-purpose v2 or premium block blob like the source, without a hierarchical namespace; versioning on both accounts, change feed on the source, and the Contributor role on both accounts for the identity that creates the policy (Learn names Contributor for configuring a policy; for deleting it no role is named, so the playbook assigns Contributor there too and TC-6 proves it, an inference); destination containers created before the rules; an inventory showing the in-scope data is block blobs with no snapshots to keep, no blobs written with a customer-provided key, no archive-tier blobs that must replicate and no immutability policy on the destination that would block replicated deletes; the DR account's own private endpoint and DNS zone link (privatelink.blob.core.windows.net) in the DR network when the primary uses private access, the application identity's data roles on it, and its own endpoint name in the DR deployment's configuration; Learn's pages read for this playbook do not describe network rules for the service-side copy, so TC-1 and TC-2 run with the final network settings; no plan for customer-managed account failover on either account.
- Cost notes: storage in the DR account, change feed and blob versioning, transactions and inter-region transfer for the copy, and a per-GB charge on new data for priority replication that continues 30 days after it is disabled; no price.
- Gives up: customer-managed account failover on both accounts; failover of the endpoint (the application is repointed to the DR account's own endpoint); anything but block blobs (no append or page blobs, snapshots, hierarchical namespace accounts, file shares, tables or queues); writes to the DR container until the policy is deleted; a completion time unless priority replication is enabled and the workload eligible; version IDs (the destination assigns new ones); existing blobs unless the rule copies them.
- Recommended when: the DR region is not the primary's pair, the data is block blobs in a general-purpose v2 or premium block blob account without a hierarchical namespace, a 15-minute objective backed by the priority replication SLA is wanted, and the application can switch to a second account.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob#custom-multiregion-solutions-for-resiliency

### scheduled-copy: Scheduled copy to a second account in the DR region
- Kind: workaround
- Target: dr-region
- Uses mechanism: Custom multiregion solution with multiple storage accounts
- Estimated RPO: 1h (Estimated, team-set starting value: the copy interval the team sets for the job, plus the run time of one job; Learn publishes no figure; TC-3 proves it)
- Estimated RTO: 1h (Estimated, team-set starting value: the switch-over time the team designs, including remounting file shares; Learn publishes no figure; TC-6 proves it)
- Prerequisites: a DR account in the DR region with the destination containers and shares created first (AzCopy does not create shares from version 10.30.0); a runner (a VM, an Azure Data Factory pipeline or a scheduled container job) with network access to both accounts and enough compute (Learn: AzCopy needs substantial compute for accounts with millions of blobs); identity: the runner's managed identity holds Storage Blob Data Reader or Storage File Data Privileged Reader on the account it reads and Storage Blob Data Contributor or Storage File Data Privileged Contributor on the account it writes, on both accounts in both directions so failback can copy back, with both accounts in one Microsoft Entra tenant (a command that targets a share or an account needs a SAS token); network and DNS: the same private endpoints, private DNS zones (privatelink.blob.core.windows.net, privatelink.file.core.windows.net) and firewall rules on the DR account as on the primary, blob or file endpoints only for copying over private endpoints and no NFS; for file shares, the --preserve-permissions and --preserve-info flags; an inventory of tables to export; queues have no documented copy.
- Cost notes: storage in the DR account, the runner, transactions and inter-region transfer of every run, and the effort of owning the job; no price.
- Gives up: a recovery point shorter than the interval (the Estimated RPO is the interval plus the run time, not the 15 minutes of object-replication); propagation of deletes unless the job is built for it; point-in-time consistency across blobs, files and tables (an inference: each run is a separate operation; Learn does not state it); full file fidelity if sync is used for Azure Files; index tags unless reapplied; failover of the endpoint (the application is repointed); a job that is custom code the team owns.
- Recommended when: the DR region is not the primary's pair and the data is in a service object replication does not cover (file shares including premium SSD, tables, append or page blobs, hierarchical namespace accounts) or a recovery point of the copy interval is acceptable, and the application can switch to a second account.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-files#custom-multiregion-solutions-for-resiliency

### geo-redundant-split: Keep geo-redundant storage in the pair and use it from the DR region
- Kind: split-region
- Target: pair-region
- Uses mechanism: Geo-redundant storage (GRS and GZRS)
- Estimated RPO: 15m (Learn: the replication lag is expected to be less than 15 minutes, and Learn says this time is only an estimate and not a commitment, https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob#geo-redundant-storage-for-paired-regions; the Last Sync Time property shows the actual lag; zero for a planned failover)
- Estimated RTO: 60m (Learn: customer-managed failover "typically completes within 60 minutes, depending on the account size and complexity", same page; the customer starts it)
- Prerequisites: the primary region has a pair and the pair's geography fits data residency; the account type supports customer-managed failover and none of the blocking features is present (no object replication policy, no premium block blobs, no NFS 3.0, no Azure File Sync cloud endpoint unless the failover of its Storage Sync Service is planned, no leased unmanaged disks); for Azure Files only standard shares and at most 100 shares per account; a custom role with Microsoft.Storage/storageAccounts/failover/action on the account (plus the permission to re-enable geo-redundancy after an unplanned failover) for the storage administrator role, assigned in Build; a network path from the DR region to the account (its private endpoint and private DNS zone link in the DR network when the primary uses private access, no extra endpoint is needed for a failover, or a firewall rule for the DR network); the application uses the account's own endpoint name, retries, and can clear cached DNS entries; Resource Health and Service Health alerts and the Last Sync Time check of TC-7 and TC-9.
- Cost notes: geo-redundant storage and cross-region replication, a one-time egress charge when geo-redundancy is added to an existing account, a charge for re-replicating after an unplanned failover, and cross-region traffic from the DR region to the account in the pair; no price.
- Gives up: the DR region for this account's data (it stays in the pair, so residency and cross-region latency apply); zero data loss in an unplanned failover; geo-redundancy after an unplanned failover until it is re-enabled; the combination with object replication, premium block blobs, NFS 3.0 or premium SSD shares, which this mechanism does not support; control of the Microsoft-managed failover, which the customer cannot trigger or rehearse.
- Recommended when: residency allows the pair, the data is in an account without the blocking features (standard file shares only), the application tolerates cross-region access after a failover, and a recovery point of about 15 minutes and a recovery time of about an hour are acceptable.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-blob#geo-redundant-storage-for-paired-regions

## Migration from a paired setup

### Recognise today's setup
A paired setup shows as a storage account whose SKU is geo-redundant (the SKU name for GRS, RA-GRS, GZRS or RA-GZRS; Learn's scripts show the name form Standard_LRS, and the geo-redundant names are not spelled out on the pages read, so read the exact names from the account's Redundancy setting) with a secondary location in the pair next to the primary location (the PrimaryLocation and SecondaryLocation properties and the Redundancy page, see the constraint on reading the failover state of an account). The inventory shows no setting for the replication itself and no DR account. It cannot show the actual Last Sync Time unless the geo-replication stats are requested, whether a failover was ever rehearsed, whether applications use the secondary endpoint of RA-GRS or RA-GZRS, or whether the account holds a feature that blocks a customer-managed failover (change feed, an object replication policy, premium block blobs, NFS 3.0, File Sync cloud endpoints). Record today's DR as geo-redundant storage with a customer-managed failover to the pair when the SKU and the secondary location show it, else as Unknown. Migration to a DR region that is not the pair is decided per account and data service, by option id: object-replication builds a second account and a policy for block blobs; scheduled-copy builds a second account and a job (file shares, tables and anything object replication does not cover); geo-redundant-split builds nothing and validates access from the DR region and the failover steps. They can be mixed across the accounts of a workload, never object-replication and geo-redundant-split on one account.

### Build
1. Take an inventory of every account in scope: kind, SKU, hierarchical namespace, NFS 3.0, change feed, point-in-time restore, versioning, the services in use (blobs, files, tables, queues), blob types and archive-tier blobs, share types (standard or premium) and share count, immutability policies, File Sync cloud endpoints, leased unmanaged disks, and the identities and network paths that use the account; choose an option per account and service and record why. TC-4 compares against this inventory.
2. object-replication: tell the owner that creating the policy ends customer-managed failover for both accounts (Learn), so today's paired DR of the source relies on the Microsoft-managed failover, which Learn says not to rely on, until Cut over; the owner accepts this before the Build step that creates the destination containers and the policy.
3. object-replication: create the DR account in the DR region (like the source, no hierarchical namespace) with the same tags, policy assignments and encryption settings, enable versioning on both accounts and change feed on the source, and build the DR account's access: the private endpoint and DNS zone link for the blob service when the primary uses private access, the firewall rules the primary has, and the data roles of the DR application identity on the DR account only (for example Storage Blob Data Contributor).
4. object-replication: create the destination containers, then the policy on the destination account and associate it with the source by its policy ID (the portal does both; with a JSON file use the full resource IDs and the default policy ID on the destination); one rule per container pair (the portal allows 10 pairs, a JSON file up to 1,000), existing blobs included (a minimum creation time of 1601-01-01T00:00:00Z copies all), replication metrics and priority replication on the policy that carries the critical data.
5. object-replication: assign the storage administrator role the Contributor role on both accounts now (Learn names it for configuring a policy; that it also suffices to delete one is an inference that TC-6 proves), so that deleting the policy at failover and creating it at failback need no access request, and assign the platform engineer role Storage Blob Data Reader on the DR account and Storage Blob Data Contributor on the primary account for the AzCopy copy-back of the Failback table (allow five minutes).
6. scheduled-copy: create the DR account and every destination container and share with the same share type, network and access settings as the primary, turn on soft delete on the DR account before any job propagates deletes, and build the runner and its identity with the roles in the option's Prerequisites in both directions, so the failback copy needs no new grant (allow five minutes); keep any SAS token in a secret store, never in the job definition.
7. scheduled-copy: write the job: per container a recursive copy that overwrites only when the source is newer; per file share a copy with the preserve flags (sync only if the team accepts that Learn does not fully recommend it for Azure Files); an AzCopy export for tables; index tags reapplied if needed; run it at the interval the team sets (the 1h of the Estimated RPO), log start, end and failed transfers of every run, and alert when the last success is older than the Estimated RPO.
8. geo-redundant-split: confirm the account is geo-redundant (otherwise change the redundancy in the portal, PowerShell or the Azure CLI and wait for synchronization), check each blocking feature of the inventory and remove or plan for it; for Azure Files check that shares are standard and at most 100 per account.
9. geo-redundant-split: grant the storage administrator role a custom role with Microsoft.Storage/storageAccounts/failover/action together with read and the permission to change the account's redundancy (the last is an inference: re-enabling geo-redundancy changes the redundancy setting); build the network path from the DR region, put the account's own name in the DR deployment's configuration, and tell the application owners what a failover does (both endpoints unavailable for about an hour, retries, cached DNS, remounted shares).
10. Set Azure Resource Health and Azure Service Health alerts on each account in scope.
11. geo-redundant-split: set a scheduled read of the Last Sync Time that alerts when its age passes the bound of TC-7.
12. Run the first replication or copy, then Validate.

### Validate
1. object-replication: run TC-1 (weekly), TC-2 (daily for 7 consecutive days before cut-over, then monthly) and TC-4 (weekly).
2. scheduled-copy: run TC-3 (daily for 7 consecutive days before cut-over, then monthly) and TC-4 (weekly).
3. Run TC-5 (weekly) on every account of the workload, the DR account included.
4. object-replication: run TC-6 in a drill with the primary account unreachable from the DR region (every DR drill) and time the switch-over against the Estimated RTO.
5. scheduled-copy: run TC-6 in a drill with the primary account unreachable from the DR region (every DR drill) and time the switch-over against the Estimated RTO.
6. geo-redundant-split: run TC-7 (daily), then TC-8 (every DR drill): the planned failover drill when the account allows it, and the design check for the unplanned and Microsoft-managed failover, which cannot be drilled.
7. Run TC-9 (every DR drill).
8. Record each result with its date; a time that a drill measured is Demonstrated, and everything else, including every recovery time of an unplanned or Microsoft-managed failover, stays Estimated or Unknown.

### Cut over
1. object-replication: make the DR account the storage account of the DR deployment in the runbook and the application's DR configuration, as its own endpoint name from deployment time, so the switch is a configuration change and not a code change.
2. scheduled-copy: make the DR account the storage account of the DR deployment in the runbook and the application's DR configuration, as its own endpoint name from deployment time, so the switch is a configuration change and not a code change.
3. geo-redundant-split: change nothing in the account; put the Failover steps for geo-redundant-split in the runbook, write the decision rule for an unplanned failover (Last Sync Time against the last write, and who accepts the loss), and record the account's DR as a customer-managed failover to the pair, validated by TC-5, TC-7, TC-8 and TC-9. Keep the Failover step that waits for a Microsoft-managed failover, because Microsoft may start that failover and the customer can only wait for it, but nothing in the plan depends on it.
4. object-replication: remove the runbook steps that waited for the Microsoft-managed failover of the account, and do not plan on it.
5. scheduled-copy: remove the runbook steps that waited for the Microsoft-managed failover of the account, and do not plan on it.

### Decommission
1. object-replication: only after Validate passed, and when the owner accepts that the DR copy replaces the geo-redundant replica, reduce the primary account's redundancy in the portal, PowerShell or the Azure CLI: GRS or RA-GRS to LRS, GZRS or RA-GZRS to ZRS. Learn says changing redundancy in the portal does not cause downtime for applications.
2. scheduled-copy: only after Validate passed, and when the owner accepts that the DR copy replaces the geo-redundant replica, reduce the primary account's redundancy in the portal, PowerShell or the Azure CLI: GRS or RA-GRS to LRS, GZRS or RA-GZRS to ZRS. Learn says changing redundancy in the portal does not cause downtime for applications.
3. object-replication: remove from the DR runbook the consumer configuration and network paths that read the secondary endpoint in the pair.
4. scheduled-copy: remove from the DR runbook the consumer configuration and network paths that read the secondary endpoint in the pair.
5. geo-redundant-split: nothing is decommissioned, because nothing was built; the geo-redundant account stays the DR copy of the data.

### Keep until cut-over
For object-replication and scheduled-copy: the geo-redundant SKU of the primary account and every network path to the pair that today's DR relies on, until TC-1 to TC-6 and TC-9 (those that apply) have passed. For an account in an object replication policy the customer-managed failover is already gone (Learn), so only the Microsoft-managed failover of the replica remains, which Learn says not to rely on. For geo-redundant-split: everything that exists today stays for good: the geo-redundant SKU, the DR region's network path and role assignments, the failover permission and the alerts; only their validation (TC-5, TC-7, TC-8, TC-9) is new.

## Failover and failback

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that storage in the primary region is unavailable (or that the workload must move for another reason) and declare DR for the workload | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time, and Resource Health and Service Health were read for the account | Storage answers again before the declaration |
| 2 | object-replication: read the last replication state still available (replication metrics, replication status of the newest blobs) and list the containers of the policy | Platform engineer | Estimated unknown (measured in the first drill) | The pending bytes and operations of the last reading, or the newest blob in each DR container, are recorded as the data-loss estimate | The DR account is not reachable from the DR region: stop and open a support request |
| 3 | object-replication: delete the replication policy on the DR account (the destination) and on the source account when it is reachable (Learn: delete the policy from both accounts); when the source is not reachable, deleting on the destination alone is an unverified inference that this step and TC-6 prove in a drill | Storage administrator | Estimated unknown (measured in the first drill) | A test blob is written to each DR container without the 409 (Conflict) error | The write still fails with 409: delete the policy on the source as soon as it is reachable, or open a support request, and do not start the application on the DR account |
| 4 | object-replication: start the application in the DR region with the DR account | Application engineer | Estimated 30m (the Estimated RTO of the option; TC-6 proves it) | The DR account name resolves to its private address from the DR network, reads of recent blobs succeed and a write succeeds | A container or blob the application needs is missing: the application owner decides whether to continue and records the gap |
| 5 | scheduled-copy: read the end time and result of the last successful copy run | Platform engineer | Estimated unknown (measured in the first drill) | The log shows the last successful run and the lag against the Estimated RPO is recorded | The last run is older than the Estimated RPO: the application owner decides whether to continue |
| 6 | scheduled-copy: stop the scheduled job, start the application in the DR region with the DR account and remount file shares from it | Application engineer | Estimated 1h (the Estimated RTO of the option; TC-6 proves it) | The DR names resolve from the DR network, a read and a write succeed on each container and share, and the job does not run | A needed container or share is missing or incomplete: the application owner decides |
| 7 | geo-redundant-split: check that the account allows the failover type: no object replication policy, no premium block blobs, no NFS 3.0, no File Sync cloud endpoint that is not planned for, no leased unmanaged disks; for a planned failover also no change feed, no point-in-time restore and both regions available | Platform engineer | Estimated unknown (measured in the first drill) | The check list is complete and recorded for the account | A blocking feature is present: do not start that failover type; use the data copy path or escalate to the application owner |
| 8 | geo-redundant-split: for an unplanned failover read the Last Sync Time, compare it with the last write, and have the incident manager accept the data loss | Incident manager | Estimated unknown (measured in the first drill) | The Last Sync Time, the last write time and the acceptance are recorded | The primary storage endpoints answer again: use a planned failover or do not fail over; the loss is not accepted: stop |
| 9 | geo-redundant-split: stop all client activity on Azure file shares (list open handles with Get-AzStorageFileHandle), then start the customer-managed failover (planned or unplanned) in the portal, PowerShell or the Azure CLI | Storage administrator | Estimated 60m (Learn: customer-managed failover typically completes within 60 minutes) | The Redundancy page of the portal (or LastGeoFailoverTime, PrimaryLocation and FailoverInProgress of the account) shows the failover complete, the new primary region and the last failover time, as in the constraint on reading the failover state | The initial synchronization of geo-redundancy is not complete (the failover cannot start): wait; a file share still has open handles: keep stopping clients |
| 10 | geo-redundant-split: if Microsoft has started a Microsoft-managed failover, wait; the customer cannot trigger or bring it forward | Platform engineer | Estimated unknown (Learn: Microsoft decides; expected only after an extended period of outage) | Service Health shows the failover complete and the account accepts writes | The wait passes the outage limit the application owner set in the runbook: the application owner decides and records it, and the platform engineer opens a support request |
| 11 | geo-redundant-split: restart the application in the DR region, clear cached DNS entries and remount file shares | Application engineer | Estimated unknown (measured in the first drill; the failover time is not part of it) | Reads and writes succeed through the same endpoint names and shares are remounted | A client cannot reach the account: check the DR network path (private endpoint, DNS zone link, firewall rule) before any change to the account |
| 12 | geo-redundant-split: after an unplanned failover, re-enable geo-redundancy (the account is LRS), after rehydrating archived blobs if any | Storage administrator | Estimated unknown (Learn: re-replication takes a significant amount of time, depending on the number and size of objects) | The SKU is geo-redundant again and the Last Sync Time advances | A management operation fails because the original primary region is unavailable: wait and escalate, since the resource provider does not fail over |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region and the primary account are available again | Incident manager | Estimated unknown (measured in the first drill) | The primary account answers reads and writes | The primary account is still unavailable |
| 2 | object-replication: stop writes to the DR account and list what changed in it during DR (new, changed and deleted blobs) | Application engineer | Estimated unknown (measured in the first drill) | The change list is complete and no write is open | A write is still arriving: keep stopping the application |
| 3 | object-replication: copy the changed blobs from the DR account to the primary account with AzCopy (overwrite only when the source is newer), apply the recorded deletes and compare counts and sizes per container | Platform engineer | Estimated unknown (measured in the first drill) | TC-4 shows no difference for the in-scope containers | The compare shows differences: repeat the copy; do not switch the application back |
| 4 | object-replication: switch the application back to the primary account, then create the policy again, source to destination, with the same rules and priority replication | Storage administrator | Estimated unknown (measured in the first drill) | A test blob written to the primary has the replication status Complete, and the DR containers refuse writes again with 409 | The policy cannot be created: keep the application on the primary account and check TC-1 |
| 5 | scheduled-copy: stop writes to the DR account, copy the changed data back to the primary account with the reverse roles from Build (file shares with the preserve flags), compare counts, sizes and hashes, then switch the application and remount shares | Platform engineer | Estimated unknown (measured in the first drill) | TC-4 shows no difference and the application reads and writes on the primary account | The compare shows differences: repeat the copy; the application owner decides whether to wait |
| 6 | scheduled-copy: resume the scheduled job in the original direction | Platform engineer | Estimated 1h (one copy interval; TC-3 proves it) | The first run after failback succeeds and TC-3 passes again | The run fails: keep the DR account as the source of truth and fix the identity or network |
| 7 | geo-redundant-split: after an unplanned failover, check that geo-redundancy is re-enabled and compare the Last Sync Time with the last write to the account | Platform engineer | Estimated unknown (Learn: re-replication takes a significant amount of time) | The Last Sync Time is later than the last write time that the application recorded | The Last Sync Time is older than the last write: do not fail back; Learn says the data is not allowed to finish replicating during the failback and the loss can be major |
| 8 | geo-redundant-split: stop all client activity on file shares, then start another customer-managed failover back to the original primary region (after a planned failover this restores the original redundancy; after an unplanned one Learn describes the failback as the original failover process, and the result is LRS or ZRS) | Storage administrator | Estimated 60m (Learn: failback typically takes about an hour) | The account properties show the original region as primary and the original SKU (planned) or LRS or ZRS (unplanned) | An open file handle or any blocking feature of the Failover table: do not start it |
| 9 | geo-redundant-split: after an unplanned failback, re-enable geo-redundancy, then restart the application, clear cached DNS entries and remount file shares | Storage administrator | Estimated unknown (Learn: re-replication takes a significant amount of time) | The SKU is geo-redundant, the Last Sync Time advances and the application reads and writes | The re-enabling fails: keep the account on LRS or ZRS and escalate; the application owner decides on the exposure |

## Test criteria

### TC-1: The object replication policy is in place
- Applies to: object-replication
- Pass condition: change feed is on for the source account and versioning on for both accounts; the policy exists on both accounts with the same policy ID and one rule for each planned container pair, destination containers present; priority replication and replication metrics are on for the policy that carries the critical data; and no account of the policy has a customer-managed failover plan.
- How to measure: read the blob service properties of both accounts, list the object replication policies of both and compare policy and rule IDs, read the priority replication and metrics settings, and review the runbook for account failover steps on these accounts.
- Evidence: the command output of both accounts with its date, and the container pairs listed against the inventory.
- Frequency: weekly

### TC-2: Object replication lag stays within the objective
- Applies to: object-replication
- Pass condition: for 7 consecutive days, at least 99.0% of the canary blobs written to every source container each hour have the replication status Complete within 15 minutes (Learn's priority replication figure for the same continent), no canary is pending after 24 hours, and the pending bytes and operations metrics in the buckets older than 15 minutes are at or near zero.
- How to measure: a scheduled job writes one small canary blob per source container each hour and reads its replication status and the destination blob; a metric query reads pending bytes and operations by time bucket on the source account.
- Evidence: the 7-day export of canaries with write time, completion time and lag, and the metric export.
- Frequency: daily for 7 consecutive days before cut-over, then monthly

### TC-3: The scheduled copy runs and stays within the objective
- Applies to: scheduled-copy
- Pass condition: for 7 consecutive days every run finishes with zero failed transfers, and the time from the last modification of any source object to its presence in the DR account stays below the Estimated RPO of the option (the interval plus the run time), confirmed on a day without real changes by a canary blob and a canary file that the job writes.
- How to measure: the job's log (start, end, transfers, failures) compared with the last modified times of source objects, and a daily canary in each container and share read in the DR account.
- Evidence: the 7-day export of run records and canary results with the maximum lag.
- Frequency: daily for 7 consecutive days before cut-over, then monthly

### TC-4: The DR copy matches the source
- Applies to: object-replication, scheduled-copy
- Pass condition: for every in-scope container, share and table, object count and total bytes in the DR account equal the source's for objects older than the Estimated RPO; a random sample of at least 100 objects per container or share (all if fewer) has equal content hashes; for file shares a sample of files has equal attributes and ACLs when permissions are preserved; every difference is listed with its cause (not yet replicated, excluded by design, failed).
- How to measure: list both accounts and compare counts and sizes, hash a random sample on both sides, compare directory listings and permissions for the share sample.
- Evidence: the comparison report per container or share with the date, counts, sample size and differences.
- Frequency: weekly

### TC-5: Every account is configured and reachable as planned
- Applies to: object-replication, scheduled-copy, geo-redundant-split
- Pass condition: for each account in scope the redundancy SKU is the one Build planned for the option; the account name resolves to its private address from the DR network when private access is used and a read succeeds from the DR network; the identities hold only the roles planned in Build (the application identity's data roles on the DR account, the runner's roles, the storage administrator's failover permission or Contributor role); and soft delete is on for each DR account that Build turned it on for.
- How to measure: read the account properties, the private endpoint connection state and the role assignments of the account scope, and run a name resolution and a test read from inside the DR network.
- Evidence: the query output with its date, the resolved addresses and the role assignment list.
- Frequency: weekly

### TC-6: The application runs from the DR account
- Applies to: object-replication, scheduled-copy
- Pass condition: with the primary account unreachable from the DR region, the application in the DR region starts with only the DR deployment's configuration (no code change), reads of every container and share it needs succeed, a write succeeds (for object-replication after the policy is deleted, without a 409 error), and the switch-over completes within the Estimated RTO of the option (30m for object-replication, 1h for scheduled-copy); for object-replication the drill also records whether writes are allowed after the policy is deleted on the destination account only, and that the Contributor role is enough to delete and recreate the policy (Learn names no role for deleting).
- How to measure: a drill that blocks the primary account from the DR region with a network rule and times the switch-over from its start to the first successful write; for object-replication it also deletes and recreates the policy to prove the failback step.
- Evidence: the drill record with timestamps, the application's log of storage operations and the measured time.
- Frequency: every DR drill

### TC-7: The Last Sync Time stays inside the bound
- Applies to: geo-redundant-split
- Pass condition: at every daily sample for 7 consecutive days the age of the Last Sync Time is at most 15 minutes for an account without Azure Files, and at most the bound the team sets for an account with Azure Files (start from two 15-minute system snapshot intervals, 30m, because Learn says the latest system snapshot "might be older than 15 minutes"); an alert on that age exists and has fired on a test.
- How to measure: read the Last Sync Time as in the constraint on reading it (az storage account show --expand geoReplicationStats, or Get-AzStorageAccount -IncludeGeoReplicationStats) and compute now minus the last sync time; test the alert with a lowered bound.
- Evidence: the sample export with its date and the alert test record.
- Frequency: daily

### TC-8: The planned failover is drilled; the unplanned and Microsoft-managed failover are design checks
- Applies to: geo-redundant-split
- Pass condition: two parts. Drill: in a maintenance window a planned failover and the failback each complete within the Estimated RTO of 60m, every canary blob written before the start is present afterwards with an equal hash, the account endpoints are unchanged, the application reads and writes through them after clearing cached DNS entries, shares are remounted, and the account is geo-redundant after both; an account with change feed or point-in-time restore enabled, or any other case Learn lists as unsupported for planned failover, is not drilled and this part is not applicable. Design check, not drillable: an unplanned failover loses data and ends as LRS, and the Microsoft-managed failover cannot be triggered by the customer, so neither is rehearsed; the check passes when the runbook holds the Last Sync Time decision rule, the failover permission is assigned, the re-enabling steps are written, and the outage limit and its owner are recorded.
- How to measure: the planned failover in the portal, PowerShell or the Azure CLI with timestamps and the account properties before and after; the design check is a review of the runbook, role assignments and application configuration.
- Evidence: the drill record with timestamps, hashes and account properties, and the review record with its date; after a real failover, the observed times.
- Frequency: every DR drill

### TC-9: Failure signals and decision data exist
- Applies to: object-replication, scheduled-copy, geo-redundant-split
- Pass condition: an Azure Resource Health alert and an Azure Service Health alert are set for every account in scope and have fired on a test; the runbook names who decides to fail over and the data that decision uses (the replication status and metrics for object-replication, the last successful run for scheduled-copy, the Last Sync Time for geo-redundant-split); and the application surfaces write failures to the owners.
- How to measure: read the alert rules of the account scope, trigger a test, and review the runbook against the list of decision data.
- Evidence: the alert rule export, the test record and the review record, with their dates.
- Frequency: every DR drill
