---
service: sql-managed-instance
title: Azure SQL Managed Instance
arm_types:
  - microsoft.sql/managedinstances
slot: data-replication.relational
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-sql-managed-instance
  - https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql
  - https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql
  - https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/recovery-using-backups?view=azuresql
  - https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/business-continuity-high-availability-disaster-recover-hadr-overview?view=azuresql-mi
  - https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/high-availability-disaster-recovery-checklist?view=azuresql-mi
  - https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/disaster-recovery-drills?view=azuresql-mi
  - https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/disaster-recovery-guidance?view=azuresql-mi
  - https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/automated-backups-overview?view=azuresql
  - https://learn.microsoft.com/en-us/azure/azure-sql/database/transparent-data-encryption-byok-overview?view=azuresql
  - https://learn.microsoft.com/en-us/azure/templates/microsoft.sql/2023-08-01/managedinstances
  - https://learn.microsoft.com/en-us/azure/templates/microsoft.sql/locations/instancefailovergroups
---

# Azure SQL Managed Instance

## Mechanisms

### Failover groups
- Replicates: data (all user databases of one managed instance, as a unit) from the primary managed instance to one secondary managed instance in a different Azure region, asynchronously; system databases such as master and msdb are not replicated, and instance configuration is not replicated either
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: unknown (Learn's reliability article says that "the amount of data loss depends on how you configure your application" and that, because geo-replication is asynchronous, a forced failover can lose data; it publishes no upper bound, and its business continuity table states an RPO of "Equal to or greater than 0" that depends on the data not yet replicated, so TC-1 measures the replication lag against a bound that the option sets)
- Estimated RTO: 5m (Learn: "the process of switching database roles can take up to five minutes under normal conditions" — https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#dns-update; this is the planning figure; Learn's reliability article also says "The downtime is typically less than 60 seconds" for a failover group failover, which is the typical value; the time to detect the outage and to decide is in neither figure, so TC-3 measures it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-sql-managed-instance#failover-groups

### Failover groups with a Microsoft-managed failover policy
- Replicates: the same data as a failover group; this is the failover policy of the group that delegates the forced failover to Microsoft
- Paired: yes
- Nonpaired: yes
- Failover: Microsoft-managed
- Estimated RPO: unknown (Learn: the Microsoft-managed policy accepts "an unknown amount of data loss, as the exact time of forced failover can't be controlled, and ignores the synchronization status of the secondary databases")
- Estimated RTO: unknown (Learn: the grace period "can't be set below one hour", the actual time of the forced failover "can vary significantly", and the policy is meant for applications that tolerate "at least one hour or more" of downtime; Learn describes no customer-initiated trigger for this failover, so a drill cannot measure it)
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#failover-policy

### Geo-restore
- Replicates: data, as automated backups (full, differential and transaction log) that are stored in geo-redundant or geo-zone-redundant backup storage, which copies them asynchronously to the paired region; a database is recreated from the most recent geo-replicated backup on a managed instance that already exists, in any region
- Paired: yes
- Nonpaired: yes
- Failover: manual
- Estimated RPO: 1h (Learn: "Recovery point objective (RPO) is up to 1 hour", because of the delay between a backup being taken and being geo-replicated)
- Estimated RTO: 12h (Learn: restores "usually take less than 12 hours but might vary based on database size and activity so restoration could extend beyond this time frame")
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/recovery-using-backups?view=azuresql#geo-restore-considerations

## Constraints

### An instance is deployed in one region and has no built-in cross-region copy
Learn says: "An individual SQL Managed Instance is deployed within a single region", and that a secondary managed instance in a separate Azure region with a failover group can be deployed. Learn describes zone redundancy under zone failures, so zone redundancy alone does not copy data to another region (this is an inference from the structure of the article). Backups in geo-redundant storage with geo-restore are the other cross-region mechanism.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-sql-managed-instance#resilience-to-region-wide-failures

### A failover group can use any Azure region except the primary's
Learn says: "You can select any Azure region for the SQL managed instances within the failover group", and that geo-replication is asynchronous because of the high latency of wide area networks, so regions with low latency connections should be selected. Learn names no pairing condition for the choice of region, so this means that a DR region that is not the primary's pair is supported (the pair is a performance recommendation, see the next constraints).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-sql-managed-instance#requirements

### Paired regions are recommended for performance, not required
Learn says to deploy both instances to paired regions "for performance reasons": failover groups in paired regions have better performance than in unpaired regions, and instances in geo-paired regions "benefit from a significantly higher geo-replication speed compared to unpaired regions". Learn gives no figure for the difference, so for a DR region that is not the pair, the initial seeding time and the replication lag have to be measured (TC-1) and cannot be taken from a Learn value.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql#configuration-requirements

### Different maintenance windows when the instances are not in paired regions
Azure SQL Managed Instance follows a safe deployment practice in which paired regions are generally not deployed to at the same time, and the order is not guaranteed. When the instances of a failover group are not in paired regions, Learn says to select different maintenance window schedules for the primary and the secondary, for example a weekday window for the geo-secondary and a weekend window for the geo-primary.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#use-paired-regions

### A failover group covers all user databases of one instance, and one instance is in one group
A failover group fails over all user databases of the instance as a unit, and a partial failover of a subset of databases is not possible. Failover groups cannot be created between two instances in the same Azure region. An instance can participate in only one failover group at any moment, and a failover group contains exactly two managed instances. System databases are not replicated, with one exception: the service master key is replicated once, when the failover group is created, and later changes of it on the primary are not replicated.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql#limitations

### The secondary must be empty and configured like the primary
The secondary managed instance must be empty, without user databases. The configuration of both instances "should be the same", including compute size, storage size and service tier, so that the secondary can sustain the replicated changes, including at peak activity. Both instances must use the same update policy. When databases hold in-memory OLTP objects the service tiers must match, because a lower tier on the geo-replica can leave the secondary unable to recover the database and make the failover unsuccessful.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql#configuration-requirements

### Scaling and update-policy changes follow an order
When scaling up within a service tier, scale the geo-secondary first and then the primary; when scaling down, scale the primary first and then the secondary. Learn gives the same order for changing the service tier, the number of vCores, the storage size and the memory allocation of a Next-gen General Purpose instance, and says not to change service tier, vCores and storage all at once. To move to a higher update policy, enable it on the secondary first, wait for the change to take effect, and then update the primary.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql#scaling-instances

### Both instances must share one DNS zone, set at creation
Both instances must be in the same DNS zone, so that one multi-domain (SAN) certificate authenticates client connections to either of them. The secondary is created with the primary's DNS zone id (the DNSZonePartner parameter of PowerShell and REST, the Primary Managed Instance field of the portal). Once assigned the DNS zone cannot be modified, and the first instance created in a subnet determines the zone for all later instances in that subnet, so two instances of one subnet cannot be in different DNS zones.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#create-the-geo-secondary-instance

### Connectivity between the two subnets must be built and kept
The IP address range of the primary's virtual network must not overlap with the secondary's virtual network or any network peered with either. The network security group rules of both subnets must allow inbound and outbound TCP on port 5022 and on the port range 11000-11999, and the route table and network security groups of the instance subnets must not be shared across the two peered virtual networks. Global virtual network peering is recommended; VPN gateways and Azure ExpressRoute are the other ways Learn lists. When another mechanism is used, firewalls and network virtual appliances must not block those ports, asymmetric routing must be avoided, and in a hub-and-spoke topology the replication traffic should go directly between the two instance subnets.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql#establish-connectivity-between-the-instances

### Initial seeding depends on data size and link speed and has a time limit
After the failover group is created, initial seeding copies the databases before replication starts, and Learn calls it the longest and most expensive part of the operation. With global virtual network peering the seeding speed is "up to 360 GB an hour" (batches of databases in parallel), and a slower link lengthens it; Learn's example is about 1.2 hours for a 100-GB database on an 84 GB per hour link and about 10 hours on a 10 GB per hour link. The overview page says creating the failover group is automatically canceled after six days.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#initial-seeding

### Seeding that does not finish in the limit deletes the replicated databases
The configure page says that if initial seeding of all databases does not complete within 7 days, creating the failover group fails and all successfully replicated databases are deleted from the secondary. The overview page says six days, so a plan that has to be safe uses the shorter figure and compares the estimate from the data size and link speed with it before the group is created.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql#limitations

### Some features block the creation of a failover group
A failover group cannot be created between instances in different Azure tenants, with an instance in an instance pool, or with an instance configured with a Managed Instance link. A database migrated by the Log Replay Service cannot be added until its cutover step is executed. Creating a failover group between instances in different resource groups or subscriptions is supported only with Azure PowerShell or the REST API, and the two subscriptions must be associated with the same Microsoft Entra tenant.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql#limitations

### Failover groups cannot be renamed and the name must be globally unique
Failover group names must be globally unique, and a failover group cannot be renamed (delete and re-create it under another name). When a failover group is deleted its listener DNS records are deleted too, so there is a non-zero probability that someone else creates a group with the same name, which would stop you from using it again; Learn says not to use generic names. Database rename is not supported for databases in a failover group (delete the group temporarily to rename one). If a database is dropped on the primary, it is dropped on the geo-secondary too.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql#change-the-primary-region

### System databases and instance properties are not replicated
System databases such as master and msdb are not replicated, so objects that depend on them must be created on the secondary and kept in sync by hand; Learn's example is logins, created with an identical SID, and the agent jobs and logins are named in its limitation text. Instances in a failover group remain separate Azure resources: no change to the primary's configuration is replicated, so a change of backup storage redundancy or long-term retention policy is made on both instances.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#enable-scenarios-dependent-on-objects-from-the-system-databases

### The listeners are DNS names, not reachable over the public endpoint
The read-write listener is a DNS CNAME record formed as fog-name.zone_id.database.windows.net and the read-only listener is fog-name.secondary.zone_id.database.windows.net. They stay unchanged after a failover, and the DNS record is updated, so new connections reach the new primary only after the client DNS cache is refreshed and existing client connections must be terminated and re-created. Learn says that both listeners cannot be reached through the public endpoint of the managed instance. By default the failover of the read-only listener is disabled.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#use-the-read-write-listener-primary-mi

### Replication is asynchronous and a forced failover can lose data
Because of the latency of wide area networks, geo-replication is asynchronous, so asynchronous replication "makes the possibility of data loss unavoidable if the primary fails". To prevent data loss during a user-initiated, planned geo-failover, replication changes automatically and temporarily to synchronous, performs the failover, and then returns to asynchronous. An application can call sp_wait_for_database_copy_sync after committing a critical transaction to block until the last committed transaction is hardened in the secondary's log; Learn says the delay can be significant, and that the procedure does not wait for the transactions to be replayed on the secondary.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql#prevent-loss-of-critical-data

### Replication lag is read from a dynamic management view
Learn says to monitor the lag against the recovery point objective with the replication_lag_sec column of sys.dm_geo_replication_link_status on the primary database. It shows the lag in seconds between the transactions committed on the primary and hardened in the secondary's log, and transactions committed in the last second are lost when the primary fails and a geo-failover is initiated at a lag of one second.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/high-availability-disaster-recovery-checklist?view=azuresql-mi#disaster-recovery-checklist

### Failover group status decides which failover is possible
The status is Seeding (failover cannot be initiated while it lasts, because the user databases are not copied yet), Synchronizing (the usual status, in which both automatic and manual failovers can be initiated, without a guarantee that the data is fully synchronized at every moment) or Failover in progress (no changes to the group and no further failovers can be initiated). When a new database is added to a group, planned failover is unavailable until it is seeded and synchronized, and a forced failover is still available.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#failover-group-status

### Customer-managed is the recommended failover policy
Learn says to use the customer-managed policy (the value manual in command line tools and in the API) to test and implement the DR plan and "Do not rely on Microsoft managed failover". With it the customer decides between a failover, which does not lose data, and a forced failover, which can. Microsoft-managed failover "might only be executed by Microsoft in extreme circumstances".
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#failover-policy

### Microsoft-managed failover is region-wide and waits for a grace period
A Microsoft-managed failover is initiated for all failover groups of the region that have the policy, and "can't be initiated for individual failover groups". It needs a region-level outage that affects many databases and an expired grace period that cannot be set below one hour (the GracePeriodWithDataLossHours setting controls how long the service waits). Every database of the group fails over regardless of zone redundancy or availability, without taking the application's other dependencies into account. Learn says to use the policy only when the application tolerates at least one hour of unavailability and an unknown amount of data loss, and when the primary and secondary have the same service tier, compute tier and compute size. The entry in the activity log of such a failover shows a single hyphen under Event initiated by.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#microsoft-managed

### Failback is the customer's job
After a forced failover the old primary reconnects automatically and becomes the new secondary, and Learn says to use a manual planned failover to move the primary back to the original location once the outage is mitigated. Learn says that when a failover group has a Microsoft-managed failover policy and a forced failover to the geo-secondary was initiated as per the grace period, "Failback to the old primary must be initiated manually".
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#failback

### The reliability article says Microsoft-managed failback is automatic
The reliability article says that failover groups "don't automatically fail back to the primary region when it's restored", that the customer initiates a failback for customer-managed failover groups, and that "for Microsoft-managed failover groups, the failback process is automatic". This differs from the failover group article (see the previous constraint), so the runbook plans a manual failback for both policies and checks the state of the group before relying on an automatic one.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-sql-managed-instance#region-recovery

### Backups follow the role, and a full backup follows each failover
Databases on the secondary instance of a failover group are not backed up until that instance becomes primary or the group is dropped. A full backup is taken before initial seeding and after each failover, it cannot be skipped or deferred, and it can delay seeding or "either delay or prevent a failover operation on a new instance shortly after a failover". A database cannot be restored to a point in time of a period in which its instance was a secondary replica; the restore is done from the instance that was primary at that time.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#backups

### Permissions on a failover group are Azure RBAC on both resource groups
The SQL Managed Instance Contributor role, scoped to the resource groups of the primary and the secondary managed instance, is sufficient for every management operation on failover groups. The minimal permissions are Microsoft.Sql/locations/instanceFailoverGroups/write and Microsoft.Sql/managedInstances/write to create or update, instanceFailoverGroups/failover/action to fail over, instanceFailoverGroups/forceFailoverAllowDataLoss/action to force a failover and instanceFailoverGroups/delete to delete, each on the resource groups of both instances.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql#permissions

### A license-free DR replica needs a secondary without workloads
When the secondary instance of a failover group has no read or write workload and is only a passive DR standby, Learn says the vCore licensing cost of the secondary is not charged (the failover rights benefit for a standby replica), while the compute and storage of the secondary are still billed.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/business-continuity-high-availability-disaster-recover-hadr-overview?view=azuresql-mi#license-free-dr-replicas

### Customer-managed TDE keys must be reachable from both instances
Learn says failover groups support customer-managed TDE, that the two instances can use a key vault or managed HSM in any supported region, and that "for a successful failover, both servers must have access to every Azure Key Vault or Azure Managed HSM that contains a required key". Both must have the required permissions, the same key material must be available to both, and the creation of the failover group fails when either cannot reach a required key. When separate key vaults are used in several regions their key material has to be kept in sync, and if the required keys are not available at the time of a failover the database "might become inaccessible".
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/database/transparent-data-encryption-byok-overview?view=azuresql#geo-disaster-recovery-with-customer-managed-tde

### A DR drill of a failover group uses a planned failover
Learn says that for an instance protected by a failover group the drill involves a planned failover to the secondary instance, which keeps the primary and the secondary in sync when the roles switch, so that, "Unlike the unplanned failover, this operation doesn't result in data loss, so the drill can be performed in a production environment". The outage is simulated by disabling the web application or virtual machine connected to the database, and fail back is a planned failover back to the original primary; fail back is optional. For geo-restore Learn says to do the drill on a copy of the production environment, to simulate the outage by renaming the source database, and that its fail back is repointing the application to the original instance.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/disaster-recovery-drills?view=azuresql-mi#failover-groups

### A drill with a forced failover is not recommended
Learn says that performing a drill using forced failover is "not recommended, as this operation doesn't provide guardrails against data loss", and that a forced failover without data loss needs the workload stopped on the primary, long running transactions completed, client connections to the primary disconnected and the status Synchronizing on both instances. The status must have gone from Failover in progress to Synchronizing before connections to the new primary are made. A forced failback is expected to fail when a previous forced failover did not succeed on both instances, and it takes longer when it is executed shortly after the first one, because it waits for outstanding automatic backup operations on the former primary; a manual planned failover is strongly recommended for a lossless failback.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#disaster-recovery-drills

### The role switch after a failover can take up to five minutes
Learn says the DNS update of the read-write listener happens immediately after the failover is initiated and does not lose data, "However, the process of switching database roles can take up to five minutes under normal conditions", and that until it completes some databases of the new primary are still read-only. A failover started with PowerShell is synchronous, the portal indicates the completion status, and a failover started with the REST API is monitored with Azure Resource Manager polling.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql#dns-update

### Learn publishes RPO and RTO figures for failover groups and geo-restore
Learn's table for Azure SQL Managed Instance gives, for disaster recovery with a failover group and a customer-managed failover policy, an RTO "typically less than 60 seconds" and an RPO "equal to or greater than 0" that depends on the data changes before the disruptive event that were not yet replicated, and for geo-restore an RTO of 12 hours and an RPO of 1 hour. For a Microsoft-managed failover Learn adds that the service takes at least 1 hour to activate it, to ensure that the failover is justified by the scale of the outage.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/business-continuity-high-availability-disaster-recover-hadr-overview?view=azuresql-mi#rto-and-rpo

### Learn says when to use failover groups
Learn says to use failover groups if the application is mission critical, has a service level agreement that does not allow for 12 hours or more of downtime, has downtime that might result in financial liability, or has a high rate of data change for which 1 hour of data loss is not acceptable, and to consider the cost of geo-replication against the potential financial liability. A combination of database backups and failover groups can be used depending on the requirements.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/business-continuity-high-availability-disaster-recover-hadr-overview?view=azuresql-mi#recover-a-database-to-an-existing-instance

### The instance must be configured for use after a recovery
After a geo-failover or a geo-restore, Learn lists the tasks that make the database production ready: update the connection strings (not needed when the application uses the failover group listeners), make the network security group and route table rules of the secondary match the primary's, create the logins that must be present in master with their permissions, update the alert rules to the new primary, and make auditing identical to the primary's. Learn also says that when the resource status of the primary and the secondary instance is Online in the Azure portal, the data plane of both is healthy, and to try a failover without data loss first and a forced failover only when it does not complete gracefully or the primary status is not Online.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/disaster-recovery-guidance?view=azuresql-mi#configure-your-database-after-recovery

### The inventory shows the backup redundancy and the DNS zone partner on the instance
The managed instance resource has the property requestedBackupStorageRedundancy, whose values are Local, Zone, Geo and GeoZone, and the property dnsZonePartner, "the resource id of another managed instance whose DNS zone this managed instance will share after creation". A zoneRedundant property says whether multi-AZ is enabled.
- Source: https://learn.microsoft.com/en-us/azure/templates/microsoft.sql/2023-08-01/managedinstances

### The inventory shows a failover group as a resource of the location
A failover group is a resource of type Microsoft.Sql/locations/instanceFailoverGroups with managedInstancePairs (the partner and primary instance ids), partnerRegions (the location of the partner instances), readWriteEndpoint (failoverPolicy Automatic or Manual, and the grace period in minutes, which is required when the policy is Automatic), readOnlyEndpoint (failoverPolicy Enabled or Disabled) and secondaryType (Geo, or Standby when the instance is used as a DR option only).
- Source: https://learn.microsoft.com/en-us/azure/templates/microsoft.sql/locations/instancefailovergroups

### Geo-restore needs geo-redundant or geo-zone-redundant backup storage
Geo-restore is available only for instances whose backup storage is geo-redundant (GRS) or geo-zone-redundant (GZRS), and it is disabled as soon as a database is updated to locally redundant or zone-redundant storage. GRS is the default. A change of backup storage redundancy on an existing instance applies to future backups only, can take up to 24 hours to apply, and is an update management operation that initiates a failover. GRS copies backups asynchronously, three times, to a single physical location in the paired secondary region, and GZRS replicates them to a secondary geographic region as well. Backup storage with geo-redundancy is priced higher than locally or zone-redundant storage, and the backup storage redundancy of a long-term retention policy is inherited when the policy is defined and cannot be changed afterwards.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/automated-backups-overview?view=azuresql#backup-storage-redundancy

### Geo-redundant backups need a primary region that has a pair
For geo-restore, Learn says: "If your primary region is paired, use GZRS or GRS backup storage to support geo-restore to the paired region." If the primary region is not paired, Learn says a custom solution can replicate the backups to another region, for example user-initiated copy-only backups stored in a storage account that uses blob object replication to a storage account in another region. This means that a primary region with no pair has no built-in geo-restore, and that the custom backup copy is a different option from the geo-restore of this playbook.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-sql-managed-instance#geo-restore

### Geo-redundant backup storage is not available in a region with no pair
Learn's checklist says that when failover groups cannot be enabled, geo-redundant backup storage can be set to use geo-restore, and that this option "isn't available in regions with no region pair". The checklist also says that for geo-restore the instance in another region should be identified in advance, and that using the paired region as the secondary region is common because it typically reduces the latency for replication and geo-restore operations.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/high-availability-disaster-recovery-checklist?view=azuresql-mi#prepare-secondary-for-an-outage

### The secondary or restore target is prepared before the outage
Learn says that whichever business continuity feature is used, the target instance must be identified and prepared, including the network rules, logins and master-database permissions, that the redirect of clients must be decided, and that other dependencies such as auditing settings and alerts must be documented; without that, bringing the application online takes additional time and "likely also requires troubleshooting". The checklist adds the network security group and route table configuration that users need on the new primary, the logins in master, and the SQL Server Audit configuration made identical on the secondary.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/business-continuity-high-availability-disaster-recover-hadr-overview?view=azuresql-mi#prepare-for-an-outage

### A geo-restore can target any region, in the same subscription
Learn says a database can be restored on any managed instance in any Azure region from the most recent geo-replicated backups, even if an outage has made the database or the datacenter inaccessible. The restore can only be done to an instance in the same subscription as the source instance, it creates a new database and cannot overwrite an existing one, and it can be requested from the portal or with PowerShell or the REST API but not with Transact-SQL. Learn says geo-restore with the Azure CLI is currently unavailable.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/recovery-using-backups?view=azuresql#geo-restore

### Geo-restore RPO and RTO are not guarantees, and new databases appear late
Learn gives the recovery point objective as up to 1 hour and the recovery time objective as approximately 12 hours, which "might vary based on database size and activity". Geo-restore "relies on automatically created geo-replicated backups in a secondary (paired) region", and Learn says that the secondary (paired) region "can't be changed". Recovery time depends on database size, compute size, the number of transaction logs, the activity to replay, the network bandwidth to another region and the number of concurrent restore requests in the target region; a prolonged regional outage can raise the number of geo-restore requests and the recovery time. Newly created or restored databases might not appear as restorable in other regions for up to 24 hours. The maximum number of databases restored in parallel is 200 per subscription.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/recovery-using-backups?view=azuresql#limitations

### Geo-restore is the basic option; Learn states capacity is assured for failover groups
Learn calls geo-restore "the most basic disaster-recovery solution" and an appropriate one for applications with relatively small databases that are not critical to the business. For business-critical applications with large databases it says to use failover groups, which offer "a much lower RPO and RTO, and the capacity is always guaranteed". Learn says nothing about a capacity guarantee for geo-restore, and it says that a prolonged outage in a region might cause a high number of geo-restore requests, which can increase the recovery time of individual databases.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/recovery-using-backups?view=azuresql#geo-restore-considerations

### A restore needs encryption keys, a compatible update policy and a predictable window
When the source database uses a customer-managed key as the TDE protector, an instance other than the source must have access to the same key, or TDE must be disabled on the source before the backup is taken. A backup can be restored only to an instance with the same or a higher update policy. System updates take precedence over restores in progress: pending restores are suspended and resumed after the update, so a maintenance window gives a more predictable restore time. Progress is tracked with sys.dm_exec_requests and sys.dm_operation_status.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/recovery-using-backups?view=azuresql#limitations

### Restore permissions are SQL Managed Instance Contributor or the subscription owner
To recover from automated backups the user must be a member of the SQL Server Contributor role or the SQL Managed Instance Contributor role (depending on the recovery destination) in the subscription, or the subscription owner.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/recovery-using-backups?view=azuresql#permissions

## Non-paired options

### failover-group: Failover group to a secondary instance in the DR region
- Kind: native
- Target: dr-region
- Uses mechanism: Failover groups
- Estimated RPO: 5m (Estimated, team-set starting value for the replication-lag bound; TC-1 proves it. Learn gives no figure: its table states an RPO of "Equal to or greater than 0" that depends on the data changes not yet replicated, and replication is asynchronous, so the value is never 0 — https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/business-continuity-high-availability-disaster-recover-hadr-overview?view=azuresql-mi#rto-and-rpo; a planned failover loses no data)
- Estimated RTO: 5m (Learn: "the process of switching database roles can take up to five minutes under normal conditions" — https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-sql-mi?view=azuresql-mi#dns-update; the typical downtime of "less than 60 seconds" is in Learn's table at the business continuity page; the time to detect the outage and to decide is in neither figure, and TC-3 measures the whole switch-over in a drill)
- Prerequisites: a secondary managed instance in the DR region (any region other than the primary's), empty, created in the primary's DNS zone, with the same service tier, hardware generation, vCores, storage size and update policy as the primary, in the same Microsoft Entra tenant (resource groups and subscriptions may differ, with PowerShell or the REST API), and not in an instance pool or Managed Instance link; a delegated subnet in a DR virtual network whose address space does not overlap the primary's or any peered network, global virtual network peering (or VPN or ExpressRoute) between the two subnets, and network security group rules that allow TCP 5022 and 11000-11999 both ways; for identity and RBAC the SQL Managed Instance Contributor role on both resource groups for the build, and for the runbook role only the failover and forceFailoverAllowDataLoss actions; for DNS the application resolves fog-name.zone_id.database.windows.net and fog-name.secondary.zone_id.database.windows.net from the DR network, and its clients re-resolve after a failover; the same logins (identical SIDs), agent jobs, auditing, alerts, maintenance window (different from the primary's when the regions are not paired), backup storage redundancy and long-term retention settings on both instances; for customer-managed TDE, both instances with access to every key vault or managed HSM that holds a required key; a check of the estimated seeding time against the six-day limit.
- Cost notes: a second managed instance in the DR region, billed like the first (the vCore license part can be waived when the secondary is a DR-only standby with no workload); geo-redundant backup storage of both instances; networking between the regions; no price.
- Gives up: no partial failover (all user databases of the instance fail over together, and an instance can be in one group only); system databases and instance settings are not replicated, so logins, jobs and settings are kept in sync by hand; potential data loss in a forced failover; Learn recommends paired regions for geo-replication speed, so a DR region that is not the pair can replicate and seed more slowly by an amount that Learn does not quantify; a full backup after each failover can delay a failover that follows soon after; the Microsoft-managed policy is not a substitute for the customer-managed runbook.
- Recommended when: the application is mission critical, the DR region is not the primary's pair or must be chosen for residency or latency, a downtime of minutes and a data loss bounded by the replication lag are acceptable (the constraint on when Learn says to use failover groups lists the criteria), and a second instance of the same size is affordable.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/failover-group-configure-sql-mi?view=azuresql#configuration-requirements

### geo-restore: Geo-restore from geo-redundant backups into an instance in the DR region
- Kind: backup-restore
- Target: dr-region
- Uses mechanism: Geo-restore
- Estimated RPO: 1h (Learn: up to 1 hour behind the original database, because of the delay between the backup and its geo-replication)
- Estimated RTO: 12h (Learn: approximately 12 hours, "usually" less than 12 hours, and it can go beyond that for large or very active databases; the figure is for the restore and Learn does not say that it includes creating the target instance, so this means the instance is prepared before the outage)
- Prerequisites: the source instance uses geo-redundant (GRS) or geo-zone-redundant (GZRS) backup storage and the primary region has a pair, because the backups are copied to the pair (the region that holds the backup cannot be changed, and the restore itself can target any region); a managed instance in the DR region, in the same subscription as the source, with the same or a higher update policy, enough compute and storage for every database to restore, a subnet with the network security group and route table rules that clients need, the logins and master-database permissions, auditing and alerts, a maintenance window outside the restore time, and access to the TDE protector key when the source uses a customer-managed key; for identity and RBAC the SQL Managed Instance Contributor or SQL Server Contributor role in the subscription, or the subscription owner; for DNS the application's connection strings or DNS entries are changed to the DR instance because there is no listener; the restore is started from the portal, PowerShell or the REST API.
- Cost notes: the DR instance (kept ready before the outage, or created at DR time) and its storage; geo-redundant backup storage is priced higher than locally or zone-redundant storage; no price.
- Gives up: an Estimated RPO of up to one hour and an Estimated RTO of about 12 hours or more; no continuous replication, and Learn states that capacity is assured for failover groups and states nothing of the kind for geo-restore, while a prolonged regional outage can raise the number of geo-restore requests and the recovery time; one restore per database, which creates a new database, with logins, agent jobs and settings prepared separately; new databases can be missing from the restorable list for up to 24 hours; a primary region with no pair has no geo-redundant backup storage, so a custom backup copy would be needed (see the constraint on the pair); the application must be pointed at the new instance by hand.
- Recommended when: the databases are relatively small and not critical to the business, a recovery of up to about 12 hours and a data loss of up to an hour are acceptable, and the cost of a continuously replicated second instance is not justified.
- Source: https://learn.microsoft.com/en-us/azure/azure-sql/managed-instance/recovery-using-backups?view=azuresql#geo-restore

## Migration from a paired setup

### Recognise today's setup
A paired setup shows in an inventory in one of two ways, and the inventory can hold both.
(1) A failover group: a resource of type Microsoft.Sql/locations/instanceFailoverGroups (a child of the location of the primary) whose managedInstancePairs name the primary and a partner instance, whose partnerRegions location is the primary's pair, with the readWriteEndpoint failoverPolicy Manual (customer-managed) or Automatic with failoverWithDataLossGracePeriodMinutes (Microsoft-managed), and secondaryType Geo or Standby. The partner is a second managed instance in the pair region whose dnsZonePartner points at the primary, with the same SKU.
(2) Geo-restore only: no failover group, no instance in another region, and requestedBackupStorageRedundancy Geo or GeoZone on the instance (Geo is the default).
The inventory cannot show whether replication is healthy (the status Synchronizing and the lag), whether the secondary has the logins and jobs, whether the network ports are open, which backups are visible in the pair region, or whether a database copy in the pair region is usable. Record today's DR as a failover group or as geo-restore only when the properties above confirm it, else as Unknown. Migration to a DR region that is not the pair is decided per instance by option id: failover-group builds a new secondary in the DR region and replaces the group with the pair, and geo-restore builds no replication and prepares a restore target in the DR region.

### Build
1. failover-group: take the inventory of the primary instance and of everything that the group depends on: service tier, hardware generation, vCores, storage size, update policy, DNS zone id, subnet, virtual network and its address space, network security group and route table, maintenance window, backup storage redundancy, long-term retention, the TDE protector and its key vault or managed HSM, the logins with their SIDs, the agent jobs, the auditing and alert settings, the databases (and any in a restoring state from the Log Replay Service, in-memory OLTP objects or transactional replication), and the group, if any, with its name, policy and grace period. This inventory is what TC-2 compares.
2. failover-group: check the blockers: the instance is not in an instance pool and has no Managed Instance link, both instances will be in one Microsoft Entra tenant, and no database is in a restoring state; an instance can be in one failover group only, so a group with the pair must be deleted before a group with the DR region exists (the Build step that replaces the group with the pair by the group with the DR region plans the gap).
3. failover-group: create the DR virtual network with an address space that does not overlap the primary's or any network peered with it, a subnet for the managed instance, global virtual network peering with the primary's network (or VPN or ExpressRoute), network security group rules for TCP 5022 and 11000-11999 inbound and outbound on both subnets, a route table and network security groups that are not shared across the two virtual networks, and, in a hub-and-spoke topology, a path that sends replication traffic directly between the two instance subnets.
4. failover-group: create the secondary managed instance in the DR region, empty, with the DNS zone id of the primary (the DNSZonePartner parameter, or Primary Managed Instance in the portal), the same service tier, hardware generation, vCores, storage size and update policy as the primary, and a maintenance window that differs from the primary's (for example weekday for the secondary and weekend for the primary) because the regions are not paired; set the same backup storage redundancy and long-term retention policy as the primary.
5. failover-group: give the build role the SQL Managed Instance Contributor role on the resource groups of both instances, and give the on-call database administrator role only the failover and forceFailoverAllowDataLoss actions on the same resource groups; for customer-managed TDE grant both instances the required permissions on every key vault or managed HSM that holds a protector key, and add the keys to both before the group is created (the creation fails otherwise).
6. failover-group: create on the secondary the logins with identical SIDs, the agent jobs and the other objects that depend on the system databases, the auditing configuration identical to the primary's, and the alert rules; plan how to keep them in sync after every change on the primary.
7. failover-group: estimate the initial seeding time from the data size, the number of databases and the measured link speed (Learn: up to 360 GB an hour with global virtual network peering, and 100 GB at 10 GB per hour takes about 10 hours) and compare it with the six-day limit. Then delete the failover group with the pair (the secondary in the pair keeps its databases as read-write copies that stop receiving changes, the listener DNS records are deleted, and the primary is without geo-replication until seeding completes) and create the failover group between the primary and the new secondary with the same name, the customer-managed (manual) policy, and the standby setting only when the secondary is DR-only; the same name and the same DNS zone keep the listener names unchanged. Keep the geo-redundant backup storage of the primary in place during this gap: from the deletion until seeding completes the pair instance is not a failover target (its databases are disconnected read-write copies), so the geo-redundant backups of the primary and the geo-restore runbook (with its restore target named in the runbook before this step) are the only cross-region DR. That restore target is not the new secondary, which is empty and becomes a member of the new group: name the instance in the pair or another managed instance as the target for the gap.
8. failover-group: when the status is Synchronizing, switch the application's connection strings to the listeners if they use instance names (fog-name.zone_id.database.windows.net for read-write and fog-name.secondary.zone_id.database.windows.net for read-only), with retry logic, and make sure the application tier in the DR region reaches the DR instance over the private network (the listeners cannot be reached through the public endpoint); then set Resource Health and Service Health alerts on both instances and an alert on the lag and on the group status.
9. geo-restore: check that the instance uses geo-redundant or geo-zone-redundant backup storage and that the primary region has a pair (if the instance uses locally or zone-redundant storage, changing it is an update management operation that initiates a failover and applies to future backups only, so geo-restore has backups in the pair only from after the change (an inference), and the change can take up to 24 hours to apply).
10. geo-restore: prepare the restore target in the DR region, in the same subscription as the source: a managed instance with the same or a higher update policy and enough compute and storage for the databases to restore, its subnet, network security group and route table rules, the logins and master-database permissions, auditing, alerts, the access to the TDE protector key for a customer-managed key, and a maintenance window that does not overlap the restore time; give the DR role the SQL Managed Instance Contributor or SQL Server Contributor role in the subscription.
11. geo-restore: write the restore runbook (portal, PowerShell or REST, not Transact-SQL, and not the Azure CLI), the list of databases with their sizes and restore order, and how the application is pointed at the DR instance.

### Validate
1. failover-group: run TC-2 on the secondary before the failover group is created (the parity check), and test the network path between the two subnets on the ports of the build step.
2. failover-group: after the group is created, wait for the status to change from Seeding to Synchronizing and run TC-1 (the lag over 7 consecutive days).
3. failover-group: run TC-3, a planned failover drill and the planned failback, and then TC-4 (the policy and grace period review).
4. geo-restore: run TC-5 (the backups are visible in the DR region), then TC-6 (a restore drill of a test copy into the DR instance, timed against the Estimated RTO).
5. Run TC-7 (the recovery checklist and the application smoke test) on the result of the drill of each option.
6. Record each result with its date; a time that a drill measured is Demonstrated, and everything else, including every recovery time of a Microsoft-managed failover, stays Estimated or Unknown.

### Cut over
1. failover-group: make the failover group with the DR region the DR of record in the runbook, with the DR region, the listener names, the failover policy and the roles of Failover and Failback below.
2. failover-group: remove from the runbook the steps that fail over to the instance in the pair (they cannot run after the Build step that replaces the group with the pair deleted that group), and record that the old pair instance is no longer a secondary of any group.
3. geo-restore: make the restore into the DR instance the DR of record in the runbook, replacing the restore into an instance in the pair, with the RPO and RTO that the drill of TC-6 measured, labelled Demonstrated (and Estimated where the drill did not measure them).

### Decommission
1. failover-group: after TC-1, TC-2, TC-3 and TC-4 have passed, delete the former secondary instance in the pair (its databases are read-write copies that no longer receive changes) and its network paths, peering and roles, to stop its charges.
2. geo-restore: after TC-5 and TC-6 have passed, remove the restore target that was prepared in the pair and its network paths, if one existed.
3. Leave the primary's backup storage redundancy as it is; the geo-redundant backups in the pair are built in and nothing has to be removed for them.

### Keep until cut-over
For failover-group: the geo-redundant backups of the primary and the geo-restore runbook, which are the only cross-region DR from the deletion of the old group (in the Build step that replaces the group with the pair) until the new group is Synchronizing (Learn: a failover can be initiated in that state), and which are kept after that as the fallback until TC-1, TC-2, TC-3 and TC-4 have passed; and the instance in the pair with its databases, which stay as disconnected read-write copies that stop receiving changes and are not a failover target, until the same tests have passed. For geo-restore: the restore target in the pair, the geo-redundant backup storage and the old restore runbook, until TC-5 and TC-6 have passed.

## Failover and failback

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary managed instance is unavailable and declare DR for the workload | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time, and the Resource Health and Service Health pages of the primary show the outage | The primary answers again before the declaration |
| 2 | failover-group: check that the primary and secondary instances show the status Online and note the failover group status and the last replication lag | Database administrator | Estimated unknown (a check of the portal or the API; measured in the first drill) | Both instances are Online and the status is Synchronizing, and the last lag is recorded | The status is Seeding or Failover in progress: Learn says no failover can be initiated while the group is in either state, so wait and keep checking until the status changes, and the incident manager escalates the decision when the wait passes the downtime that the application owner accepts |
| 3 | failover-group: start a failover (planned, no data loss) of the group from the secondary, with the customer-managed policy | Database administrator | Estimated 5m (Learn: switching database roles can take up to five minutes under normal conditions; typically less than 60 seconds of downtime) | The two instances have switched roles and the status has returned from Failover in progress to Synchronizing | The roles did not switch: check connectivity and the network security group and firewall rules between the instances, and do not go on before the roles switch; a planned failover is only possible when the primary is accessible, and it is unavailable while a newly added database is not yet seeded and synchronized, so when it fails or the primary is not Online go to the failover step that starts a forced failover (a forced failover is still available while a new database is being seeded) |
| 4 | failover-group: start a forced failover (potential data loss) when the planned failover of the group does not complete gracefully or the primary is not Online, after the last replication lag has been written to the incident record | Database administrator | Estimated 5m (Learn: the secondary is switched to primary without waiting for recent changes, then the roles change within the same range; set in the first drill) | The secondary is the primary and accepts writes, and the lag that was recorded is the data-loss bound reported to the application owner | The application owner does not accept the data loss that the recorded lag implies: wait and keep checking the primary's status, because a forced failover cannot be undone without a failback |
| 5 | failover-group: with the Microsoft-managed policy, wait for Microsoft to initiate the forced failover after the grace period; the customer cannot trigger it for a single group, and it cannot be rehearsed | Incident manager | Estimated unknown (Learn: the grace period cannot be set below one hour and the actual time can vary significantly) | The Azure activity log shows Failover Azure SQL failover group with a hyphen under Event initiated by | The wait passes the downtime that the application owner can accept: start the planned failover or the forced failover of the group yourself and record the decision |
| 6 | failover-group: have the application use the listeners: end the existing client connections, refresh the DNS cache and reconnect to fog-name.zone_id.database.windows.net | Application engineer | Estimated 5m (Learn: the DNS record is updated at once and the role switch can take up to five minutes, during which some databases of the new primary are still read-only) | A write through the read-write listener succeeds from the DR network, and the connection resolves to the DR instance | A write still fails after the status is Synchronizing: check the DNS cache, the network path and the roles of the databases before any other change |
| 7 | failover-group: check that the logins, agent jobs and auditing of the DR instance work, and let the full backup that starts after the failover finish before any further failover | Database administrator | Estimated unknown (the full backup is a size-of-data operation; measured in the first drill) | The logins connect, the jobs run and the backup of each database completes | A required login or job is missing: create it on the DR instance with the identical SID, then repeat the check |
| 8 | geo-restore: confirm that a geo-restore backup of each database is listed for the DR instance and write down the age of the newest backup | Database administrator | Estimated unknown (listing the backups and reading the age of the newest one; measured in the first drill) | Every database has a listed backup, and the newest backup age is within the Estimated RPO of the option | A database has no listed backup (a new database can take up to 24 hours): the application owner decides whether to wait or to rebuild the data |
| 9 | geo-restore: start the geo-restore of each database onto the DR instance (portal, PowerShell or REST; up to 200 in parallel per subscription) in the order of the runbook | Database administrator | Estimated 12h (Learn: approximately 12 hours, and it can go beyond that for large or very active databases) | The progress in sys.dm_operation_status and sys.dm_exec_requests advances, and each restored database is online on the DR instance | The restore is suspended by a system update or exceeds the Estimated RTO: record it, keep the restore running, and tell the incident manager; cancel it only when the primary is back before the application is switched over |
| 10 | geo-restore: configure the DR instance after the restore: update the connection strings to the DR instance, check the network security group and route table rules, create the logins and master-database permissions, set auditing and alerts, and give access to the TDE protector key | Application engineer | Estimated unknown (measured in the first drill) | The application connects to the DR instance with its own identity and passes the smoke test of TC-7 | A login, rule or key is missing: fix it before users are admitted |
| 11 | Run the application smoke test of TC-7 and announce that the workload runs in the DR region | Application engineer | Estimated unknown (measured in the first drill) | The smoke test passes and the announcement is recorded | The smoke test fails: stay in DR, fix the cause and repeat the test |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region and the old primary instance are available again | Incident manager | Estimated unknown (measured in the first drill) | The old primary is Online and reconnected as the secondary of the group, and the status is Synchronizing on both instances | The old primary is still unavailable, or the status is not Synchronizing (a forced failback is expected to fail if a previous forced failover did not succeed on both instances) |
| 2 | failover-group: start a manual planned failover of the group back to the original primary, because the group does not fail back by itself, with the workload quiet and no long running transactions | Database administrator | Estimated 5m (Learn: switching roles can take up to five minutes under normal conditions; a full backup after the earlier failover can lengthen it) | The instances have the original roles and the status is Synchronizing | The status is not Synchronizing, or the backup after the failover has not finished: wait, and stay on the DR instance |
| 3 | failover-group: have the application reconnect through the listeners and check the logins, jobs and auditing on the original primary | Application engineer | Estimated 5m (the DNS update is at once; clients re-resolve) | A write through the read-write listener reaches the original primary | A write fails: check DNS caches and the network path, then stay on the DR instance |
| 4 | failover-group: when the team keeps the DR region as the primary, check that the original instance has reconnected as the secondary (the group then protects the workload again and nothing is rebuilt); when the original instance is lost or is replaced, create a new secondary instance in a third region and a new group with the same name (Learn's change-the-secondary-region procedure) and plan the gap | Platform engineer | Estimated unknown (a size-of-data seeding; the time depends on the data size and the link speed) | The group shows Synchronizing with its new secondary and TC-1 is run again | Seeding does not finish within six days: the geo-redundant backups of the DR instance are a fallback only when the DR region has a pair (Learn: geo-redundant backup storage "isn't available in regions with no region pair"), otherwise the gap has no cross-region DR and the application owner accepts or shortens it; cancel the new group |
| 5 | geo-restore: repoint the application to the original instance (Learn: with geo-restore, fail back is repointing the application), after the owner of the data has decided how the changes made on the DR instance are carried back | Application engineer | Estimated unknown (Learn describes no copy of changes back to the original instance, so the data move is set by the application owner and measured in the first drill) | The original instance holds the data that the owner decided to carry and passes the smoke test of TC-7 | The changes made on the DR instance are not on the original instance and the owner has not accepted that: stay on the DR instance |

## Test criteria

### TC-1: The replication stays within the lag bound
- Applies to: failover-group
- Pass condition: for 7 consecutive days the failover group status is Synchronizing on both instances except while a seeding or a failover is under way, the largest replication_lag_sec of every database stays at or below the lag bound (the Estimated RPO of the option: the team-set starting value of 5m, or a lower bound that the team records), and the initial seeding completed within the time estimated from the data size and link speed and within the six-day limit.
- How to measure: a scheduled query on the primary reads replication_lag_sec of sys.dm_geo_replication_link_status for each database every few minutes, and a scheduled read of the failover group (portal, PowerShell or REST) records its status; the seeding duration is the time between the creation of the group and the first Synchronizing status.
- Evidence: the 7-day export of the lag per database with its maximum and the status history, the team's lag bound with its basis, and the seeding start and end times.
- Frequency: before cut-over for 7 consecutive days, then continuously with an alert on the bound

### TC-2: The secondary matches the primary
- Applies to: failover-group
- Pass condition: zero differences between the primary and the secondary instance in service tier, hardware generation, vCores, storage size, update policy, DNS zone id, backup storage redundancy, long-term retention policy and auditing; both instances share the DNS zone; the secondary holds every login of the inventory with an identical SID and every agent job; both can reach every key of a customer-managed protector; the network security group rules of both subnets allow TCP 5022 and 11000-11999; the secondary has no user database before the group is created.
- How to measure: read the properties of both instances with a read-only query or in the portal and compare them; query the logins (name and SID) and jobs of both instances; test the key access of both; list the network security group rules and the peering state; a scheduled job repeats the comparison.
- Evidence: per object type: the property comparison of the instances, the login and job lists with SIDs, the key access test result, the rule list and the peering state, each dated, with zero differences.
- Frequency: before the group is created, weekly, and after every change to either instance, its scale, its policy or its network

### TC-3: A planned failover and failback complete within the Estimated RTO
- Applies to: failover-group
- Pass condition: in a drill, a planned failover of the group makes the secondary the primary and brings the status back to Synchronizing, and the application writes through the read-write listener within the Estimated RTO of the option (5m), with no data lost (a canary row written before the failover is present after it); the planned failback returns the original roles within the same bound.
- How to measure: start the planned failover (portal, PowerShell or REST), time it from the start to the first successful write through the listener, check the activity log for the operation, and repeat for the failback; a canary table with a timestamped row is written to before each failover and read after it.
- Evidence: the drill record with its timestamps, the activity log entries, the canary row before and after, and the measured times.
- Frequency: before cut-over, then at least yearly and after every change to the group, the network or the application's connection handling

### TC-4: The failover policy and grace period are as designed
- Applies to: failover-group
- Pass condition: design check, not drillable: the failover group has the failover policy that the runbook says (customer-managed, manual, by default); when the Microsoft-managed policy is used, the grace period is not below one hour, the application owner has accepted at least one hour of unavailability and an unknown amount of data loss in writing, both instances have the same service tier, compute tier and compute size, and the runbook shows that the customer cannot trigger or rehearse a Microsoft-managed failover for a single group. What can be measured is the policy and the grace period of the resource and the alert that fires when the status of the group changes.
- How to measure: read readWriteEndpoint failoverPolicy and failoverWithDataLossGracePeriodMinutes of the group, review the application owner's acceptance and the runbook, and test the status alert.
- Evidence: the group's properties with their date, the signed acceptance when the Microsoft-managed policy is used, and the alert test record.
- Frequency: after every change to the group and yearly

### TC-5: Every database has a geo-restore backup in the DR region
- Applies to: geo-restore
- Pass condition: the backup storage redundancy of the instance is geo-redundant or geo-zone-redundant, the primary region has a pair, and every database of the inventory (older than 24 hours) has a geo-restore backup that is listed for the DR instance and no more than the Estimated RPO (1h) old, or the difference is explained and accepted by the application owner.
- How to measure: read requestedBackupStorageRedundancy of the instance, list the geo-restore backups for the DR instance in the portal (or by PowerShell or the REST API), and compare their count and newest time with the list of databases.
- Evidence: the instance property, the list of backups per database with the newest backup time, and the list of databases that are younger than 24 hours.
- Frequency: weekly, and after every change of backup storage redundancy or the addition of a database

### TC-6: A geo-restore into the DR instance meets the Estimated RTO and RPO
- Applies to: geo-restore
- Pass condition: in a drill on a test copy of the environment, each database (the largest and the most active included) is geo-restored onto the DR instance in the DR region within the Estimated RTO (12h), and the newest transaction in the restored database is no more than the Estimated RPO (1h) older than the last transaction that was written to the source before the simulated outage; every login, job and setting of the runbook is in place on the DR instance.
- How to measure: simulate the outage as Learn does (rename the source database in the test environment), start the geo-restore (portal, PowerShell or REST), track it with sys.dm_operation_status and sys.dm_exec_requests, time it from the start to the database being online, and compare the timestamp of a canary row written before the outage with the newest row of the restored database.
- Evidence: the drill record with the start and end times per database, the progress queries, the age of the newest data, and the list of items that had to be fixed by hand.
- Frequency: before cut-over, then yearly and after every change to the target instance, its network or the largest database's size by a factor that the team sets

### TC-7: The application and its dependencies work after recovery
- Applies to: failover-group, geo-restore
- Pass condition: after a drill of the option, the application connects with its own identity (through the listener for failover-group, through the DR instance's name for geo-restore), its smoke test passes (read and write of the data that the application owner names), and every item of Learn's after-recovery list is in place: connection strings, network security group and route table rules, firewall access, logins and master-database permissions, auditing and alerts, and the access to the TDE protector key; no item is open.
- How to measure: run the application owner's smoke test from the DR network, query the logins and permissions of the DR instance, test the network paths and key access, and check the auditing and alert rules against the primary's.
- Evidence: the smoke test log, the checklist with a result per item, and the queries' output, each dated.
- Frequency: with every drill of TC-3 and TC-6, and after every change to the application's connection handling
