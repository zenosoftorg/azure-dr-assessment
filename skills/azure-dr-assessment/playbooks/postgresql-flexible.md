---
service: postgresql-flexible
title: Azure Database for PostgreSQL flexible server
arm_types:
  - microsoft.dbforpostgresql/flexibleservers
slot: data-replication.relational
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql
  - https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support
  - https://learn.microsoft.com/en-us/azure/postgresql/overview
  - https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas
  - https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas-geo
  - https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas-promote
  - https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas-virtual-endpoints
  - https://learn.microsoft.com/en-us/azure/postgresql/read-replica/how-to-create-read-replica
  - https://learn.microsoft.com/en-us/azure/postgresql/read-replica/how-to-create-virtual-endpoints
  - https://learn.microsoft.com/en-us/azure/postgresql/read-replica/how-to-switch-over-replica-to-primary
  - https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore
  - https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-business-continuity
  - https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/how-to-restore-paired-region
  - https://learn.microsoft.com/en-us/azure/postgresql/network/concepts-networking-private
  - https://learn.microsoft.com/en-us/azure/postgresql/security/security-data-encryption
---

# Azure Database for PostgreSQL flexible server

## Mechanisms

### Cross-region read replicas
- Replicates: data, asynchronously, from the primary server to a read-only replica in another Azure region by the PostgreSQL engine's native physical replication; all user accounts of the primary are replicated, while firewall rules, backups, high availability and several other settings are not (see Constraints)
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: 5m (Learn: "RPO is expected to be up to five minutes (data loss possible) except in the case of severe regional failure when the RPO can be close to the replication lag at the time of failure" — https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-business-continuity; the replicas "can lag the primary", the replication lag is "typically at least several minutes, but it can be longer", and a forced promotion permanently loses the unreplicated data, so TC-1 measures the lag over a full workload cycle)
- Estimated RTO: 3m (Learn: a forced promotion "typically completes within 1-3 minutes of being triggered"; this covers the promotion only and excludes detecting the outage, the decision to promote, the application reconnecting through the endpoint's DNS records and the work after promotion, so the end-to-end figure of an option is longer and TC-3 measures it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql#cross-region-read-replicas

### Geo-redundant backup and geo-restore
- Replicates: backups (the daily snapshot backups and the transaction logs), asynchronously through storage replication to the Azure paired region; a geo-restore creates a new server from them in that paired region
- Paired: yes
- Nonpaired: no
- Failover: manual
- Estimated RPO: 1h (Learn: transaction logs and daily backups are copied to the paired region asynchronously, "there might be up to one hour of delay", so "you can expect up to one hour of RPO when you restore", and a geo-restore uses only the last available backup data at the paired region)
- Estimated RTO: unknown (Learn: the recovery time "depends on factors like the size of the database, the last database backup time, and the amount of WAL to process" and "usually takes from a few minutes up to a few hours"; Learn gives no single figure — its business continuity table says "Varies" — so the option sets a team-set bound that TC-6 measures in a drill)
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore#geo-redundant-backup-and-restore

## Constraints

### Cross-region read replicas reach any supported region
Learn says that you can create cross-region read replicas "in any region that supports Azure Database for PostgreSQL" and that "you're not limited to Azure paired regions". You can deploy up to five read replicas per primary, which can optionally be in different Azure regions.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql#requirements

### The multiregion reference lists cross-region read replicas with virtual endpoints
Learn's list of Azure services that support multiple regions names, for Azure Database for PostgreSQL, the mechanism "Cross-region read replicas": they replicate data asynchronously to read replicas in other regions, with virtual endpoints for failover. The list shows no other multiregion mechanism for this service.
- Source: https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support

### Geo-redundant backup reaches only the paired region
Geo-redundant backup storage replicates the backups, in addition to three copies in the region of the server, "to a geo-paired region", and Learn states that "geo-redundancy is supported for servers hosted in any of the Azure paired regions". A geo-restore therefore creates the new server in the paired region and nowhere else. Learn's own advice for a DR region that is not the pair is: "Use geo-replicas as your disaster recovery (DR) strategy if you need to configure DR to any region, or if the primary region doesn't support geo-redundant backups."
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore#geo-redundant-backup-and-restore

### Geo-redundant backup is chosen at server creation and depends on the region
Geo-redundant backup can be configured "only during server creation": after a server is provisioned, the backup storage redundancy option cannot be changed. So a server that was created without it cannot gain it in place.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore#moving-from-other-backup-storage-options-to-geo-redundant-backup-storage

### The regions table lists geo-redundant backup per region
The overview of the service lists the Azure regions where the service is available, with a Geo-Redundant backup column that marks each region as supported or not. Some regions are marked as not supporting it, so the primary region is checked in that table before the option is offered.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/overview#azure-regions

### A geo-restore uses the last available backup data and cannot change the size
The backup page says "Currently, PITR of geo-redundant backups isn't available" and that you can restore only to the last available backup data at the paired region. During a geo-restore you can change the server configurations that include virtual network settings and the ability to remove geo-redundant backup from the restored server, but "changing other server configurations -such as compute, storage, or pricing tier (Burstable, General Purpose, or Memory Optimized)- isn't supported during geo-restore". The restore always creates a new server with the name you provide and never overwrites the existing one.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore#geo-redundant-backup-and-restore

### The geo-restore how-to offers restore points, which the backup page does not confirm
The how-to for a geo-restore lists, in its portal steps, the restore point choices "Latest restore point (Now)", "Select a custom restore point" and "Select Fast restore point (Restore using full backup only)", and its CLI example says that "the recovery point objective is the current time". The backup page says that PITR of geo-redundant backups isn't available and that only the last available backup data at the paired region is restored. The two pages are worded differently, so this playbook does not rely on a point-in-time choice: it plans for the last available backup data and an RPO of up to one hour, and TC-6 shows in a drill which restore points are offered and what data the restored server holds.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/how-to-restore-paired-region

### A geo-restore needs the first geo-backup
When you create a server with geo-redundant backup enabled, Learn says it can take up to one hour to create the initial backup and transfer the physical copy to the paired region. A geo-restore with not even one backup available in the paired region fails with the error "Unable to geo-restore server <server> as its geo-backups aren't available yet."
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/how-to-restore-paired-region

### A geo-restore still works while the primary region is down
The backup page says: after you create a server, wait at least one hour before initiating a geo-restore, so that the first set of backup data can replicate to the paired region. When the primary region is down, you can't create geo-redundant servers in the paired region, "because storage can't be provisioned in the primary region", until the primary region is up again; with the primary region down you can still geo-restore the source server to the paired region.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore#geo-redundant-backup-and-restore

### Geo-restore keeps the access mode of the source server
If the source server uses public access, you can restore only to public access, and you must apply firewall rules after the restore. If it uses private access (virtual network integration), you can restore only to a different virtual network, because virtual networks cannot span regions. A geo-restore across public and private access is not possible.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore#restore-and-networking

### Post-restore tasks are the customer's
After a restore, the values of all parameters of the original server are not applied automatically, and the server-level firewall rules, private endpoints and virtual network rules are not copied; logins, database-level permissions and alerts must be put in place; a server that had high availability or read replicas gets neither on the restored server unless you configure them; and clients must be redirected by changing the server name of the connection string.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore#post-restore-tasks

### Backup files cannot be exported
Learn says that backup files cannot be exported or used to create servers outside the service; for that purpose the PostgreSQL tools pg_dump and pg_restore/psql are used. So a backup cannot be used to put a server in a region other than the paired region (this follows from the geo-restore constraint), and Azure Backup long-term retention, which uses pg_dump logical backups for up to 10 years, currently restores only "as Files" to storage accounts.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore#backup-overview

### Replicas need the General Purpose or Memory Optimized tier
Read replicas are supported on the General Purpose and Memory Optimized compute tiers. The Burstable tier is not supported.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas#create-a-replica

### A replica has no high availability and no backups
Backups, including geo-backups, and high availability are listed as functions that a read replica cannot have. The system never takes backups from a read replica, and a replica is not restorable until it is promoted. After a promotion the server has no high availability and no geo-redundant backup, because geo-backup can be enabled only when a standard server is created, not on a replica.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas#configuration-management

### Promotion is never automatic and Microsoft does not announce a region outage
Learn says that you are responsible for detecting an outage in the primary region and manually promoting a read replica: "Azure doesn't promote read replicas automatically, even if there's a region failure". Microsoft does not automatically notify you when a region is down; Azure Service Health, with Service Health alerts, shows the health of the service, including region failures. A promotion cannot be left to the platform.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql#behavior-during-a-region-failure

### During a region outage only a forced promotion is possible and unreplicated data is lost
During a region outage you must perform a forced promotion, which results in the permanent loss of any unreplicated data; the amount depends on the replication lag at the time of the outage. A planned promotion, which synchronizes the data first, is for scenarios where the primary region is healthy, and it "follows a different process" from a promotion during a region outage, so a planned promotion drill does not show the behavior of a real outage.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql#behavior-during-a-region-failure

### Promote to primary server needs virtual endpoints and a symmetrical replica
Learn describes two promotions: "promote to primary server", which swaps the roles of the primary and the replica, and "promote to independent server and remove from replication", after which the two are independent read-write servers. Promote to primary server needs virtual endpoints (the writer endpoint on the current primary and the replica as the target of the reader endpoint), and the primary and the replica need identical tiers and storage sizes and the same values for the parameters that allocate shared memory. If they are not symmetrical, the only viable option is promote to independent server. The forced option, designed for regional outages, skips all checks, including server symmetry; Learn adds that using the forced option outside a region-down scenario "isn't allowed" when the requirements, especially server symmetry, are not met, because it could lead to problems such as broken replication. So a forced promotion in a drill needs the same symmetry as a planned one.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas-promote

### With virtual endpoints the old primary rejoins as a replica when its region returns
Learn describes that when you use virtual endpoints, after the primary region recovers the old primary server is automatically configured as a read replica, and you can perform another promotion to return the primary operations to your preferred primary region.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql#region-recovery

### After a promote to independent server the old primary must be removed or recreated
After a promote to independent server and remove from replication, the old primary might become active again once the original region is restored; Learn says to remove it to avoid unnecessary cost, and to recreate the read replica if you want to keep the previous topology. The application's connection strings are updated to the promoted server, because it is no longer part of the virtual endpoints.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas-geo#when-outages-impact-your-sla

### A promoted replica does not carry over several settings
A promotion does not carry over: the settings and status of the built-in PgBouncer, geo-redundant backup (it cannot be enabled on a replica), parameters that differ between primary and replica, Microsoft Entra authentication when the replica uses PostgreSQL authentication, and high availability, which must be configured on the newly promoted primary after the role reversal.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas-promote#configuration-management

### Virtual endpoints give a stable name, with limits
Virtual endpoints are a writer endpoint, which always points to the current primary, and a read-only endpoint, which can point to a read replica or to the primary, one server at a time. Only one writer and one read-only endpoint can be created per primary and one of its replicas, and endpoints are managed on the primary server. With a promote to primary server the writer endpoint points to the new primary and the read-only endpoint to the former primary, so the application's connection string does not change.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas-virtual-endpoints

### Cascading replicas have no virtual endpoints
Cascading read replicas (a replica created from another replica, in two levels, with up to five replicas per source) are a way to distribute read workloads. Learn says that "virtual endpoints aren't supported for cascading replicas" and that the promote to primary operation doesn't support intermediate read replicas with cascading read replicas. So a replica that is a DR target is created directly from the primary, because a promote to primary server needs virtual endpoints (see the constraint on promotions).
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas#create-cascading-read-replicas

### Virtual endpoints are two DNS aliases that applications must re-resolve
Creating virtual endpoints creates two fully qualified domain name aliases (CNAME records), base-name.writer.postgres.database.azure.com and base-name.reader.postgres.database.azure.com, where the base name must not be taken by another server. When a server has read replicas, the reader endpoint points to one of them by default.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/how-to-create-virtual-endpoints

### Applications must reconnect after a promotion and honor the DNS time-to-live
Learn says that a promotion drops all active connections to the primary region, that applications need to retry making connections to the promoted replica, and that virtual endpoints are updated as part of the forced promotion. Applications might also need to reconnect to the correct endpoint, and they "should honor the time-to-live (TTL) of the endpoint's DNS records" so that they reconnect quickly to the right replica after the promotion completes.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql#behavior-during-a-region-failure

### A switch-over fails without virtual endpoints that target the replica
If the server has no virtual endpoints, or the replica that you switch over to is not the target of the reader virtual endpoint, the attempt to switch over a read replica to primary fails. The data sync is Planned, which makes the replica synchronize with all the changes of the primary first, or Forced, which finishes faster and loses the changes that are committed on the primary but not yet synchronized to the replica, and the forced option needs an explicit acknowledgment of the data loss in the portal.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/how-to-switch-over-replica-to-primary

### A replica's compute and storage cannot be smaller than the source's
When you create a replica, the compute size can be any size with the same or a higher number of vCores than the source server, the storage size can be set to the same or a higher value, and the storage type cannot be different from the source's. The list of supported compute sizes can vary across regions, depending on the hardware available in each region.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/how-to-create-read-replica

### Replication is asynchronous and its lag has no bound
Replicas are updated asynchronously. The delay "typically ranges from a few seconds to minutes", and in some heavy workload or high-latency scenarios "this delay could extend to hours"; replicas in the same region lag less than geo-replicas. With persistent heavy write workloads the lag can keep growing. Learn says to monitor the lag for a complete application workload cycle, through peak and non-peak times, to assess the expected RTO and RPO.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas#considerations

### Replication lag can fill the primary's storage
Replication uses replication slots, so the primary keeps the WAL files until the replicas receive them. When storage use reaches 95% or the available capacity is below 5 GiB, the server automatically switches to read-only mode, and in rare cases the server may drop the replication slot, after which replication switches to file-based log shipping with a higher lag. Learn recommends alerts on the storage used or storage percentage and on the replication lag (its examples are 80% storage and 5 minutes of lag), and the metrics Read Replica Lag, Max Physical Replication Lag and Transaction Log Storage Used.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas#monitor-replication

### Creating a geo-replica takes time and puts the primary in an updating state
A geo-replica is created from the base backup of the primary sent over the network, so the creation time "might range from minutes to several hours, depending on the primary size". A replica is created successfully only when the entire backup is copied and the transaction logs are synchronized with no more than a 1-GB lag, so replicas are not created during heavy transactional load or bulk loads. While a replica is created, deleted or promoted, the primary is in an updating state in which management operations (parameters, high availability, firewalls) are not available, while the data plane keeps working.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas#create-a-replica

### A replica and its primary must stay in step
For the promote to primary server operation the tier and storage size of the replica must match the primary, and Learn's example of the symmetry rule is that a primary with 2 vCores and a replica with 4 vCores leaves only the promote to independent server action, so the compute size is kept equal too. Compute on the primary must always be equal to or smaller than the compute on the smallest replica. The parameters max_connections, max_prepared_transactions, max_locks_per_transaction, max_wal_senders and max_worker_processes on a replica must be equal to or greater than the primary's, so that the replica does not run out of shared memory during recovery. Compute and storage are scaled up on the replica first and then on the primary, and compute is scaled down on the primary first and then on the replica. Storage autogrow must be enabled on the replicas when it is enabled on the primary. The replica inherits the parameters of the primary at creation, and later changes on the primary are not replicated.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas

### A replica does not inherit firewall rules and connects with the primary's accounts
A new replica does not inherit the firewall rules or the virtual network service endpoint of the primary; they are set at creation or later. The replica inherits the admin account, all user accounts of the primary are replicated to it, and you can connect to a replica only with those accounts.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas#connect-to-a-replica

### Replication needs port 5432 both ways and access to the WAL archive storage account
Bidirectional communication between the primary server and read replicas is crucial: the virtual network subnet must allow sending and receiving traffic on destination port 5432, which facilitates the synchronization and also ensures that the promote mechanism works, because replicas might need to communicate in reverse order, from replica to primary, especially during promote to primary operations. Connections to the Azure storage account that stores the Write-Ahead Logging (WAL) archives must also be permitted.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas#networking

### Replication across regions needs peering and a DNS link
For replication across Azure regions with separate virtual networks in each region, connectivity across the regional virtual network boundaries is needed, which virtual network peering or a hub-and-spoke architecture through a network appliance can provide. Because DNS name resolution is scoped to a virtual network, clients in another virtual network must be given a virtual network link to the private DNS zone of the server.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/network/concepts-networking-private#replication-across-azure-regions-and-virtual-networks-with-private-networking

### Replicas in a region without a pair do not see each other after a promotion
When the primary region lacks a paired region and a regional outage affects the primary, the newly promoted replica does not automatically recognize any other replicas: applications can be pointed at the promoted replica, but the other replicas stay disconnected until the original primary region is restored. Servers must be in the Ready state to promote, except for a forced promotion in a regional outage. If the former primary fails beyond recovery during a promotion, the only option is to delete it and recreate the replica.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas-promote#considerations

### Replicas in paired regions get recovery priority and staggered updates
Learn says that you can create replicas in any supported region but get notable benefits in paired regions: in a geography-wide outage the recovery of one region from every paired set is prioritized, paired regions' updates are staggered, with a few exceptions the regions of a pair are in the same geography so data residency is met, and latency is typically low. A replica in a region that is not the pair does not get these benefits, and the residency point holds only "with a few exceptions" for the regions of a pair in one geography, so residency is checked for the DR region.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas-geo#paired-regions-for-disaster-recovery-purposes

### Customer-managed keys must be in the region of the replica or the geo-backup
For a server that uses data encryption with customer-managed keys, the key of a read replica created with its own key is kept in a Key Vault in the region where the replica resides, with a user-assigned identity in that region that is permitted to use the key; the geo-redundant backup encryption key must be in a Key Vault in the region where the geo-redundant backup is stored, and the same user-managed identity cannot be used for the Key Vault of the primary and the Key Vault of the geo-redundant backup. After a restore or the creation of a replica, the original key must not be revoked.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/security/security-data-encryption

### High availability stays inside one region
The zone-redundant and zonal high-availability configurations place a standby server in the same Azure region as the primary: Learn describes the standby "within the same Azure region". So high availability protects against a zone or node failure, and a region failure needs a mechanism that reaches another region.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/overview#architecture-and-high-availability

### A point-in-time restore right after a promotion can fail
Learn describes a known issue: a point-in-time restore can fail with an error after failover and failback operations, so after a promotion you wait for the automated backup to complete before relying on a point-in-time restore to the latest time.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas-promote#considerations

### An in-place major version upgrade removes the replicas
An in-place major version upgrade of a server requires removing any read replicas and cascading read replicas; after the upgrade the replicas can be recreated. During that time the server has no cross-region replica.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas

### Learn publishes typical RPO figures for read replicas and geo-restore
Learn's table of RTO and RPO "in a typical workload scenario" gives, for read replicas on the General Purpose and Memory Optimized tiers, an RTO of "Minutes" and an RPO "Typically ranging from 30 secs to 5 Minutes", and for geo-restore from geo-replicated backups an RTO that "Varies" and an RPO "< 1 h". For a region failure it says that when you promote a read replica "RPO is expected to be up to five minutes (data loss possible) except in the case of severe regional failure when the RPO can be close to the replication lag at the time of failure". Another Learn page says the replication lag is "typically at least several minutes, but it can be longer", so the figure of five minutes is a typical value and TC-1 measures the lag over a full workload cycle.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-business-continuity

## Non-paired options

### cross-region-replica: Cross-region read replica in the DR region with virtual endpoints
- Kind: native
- Target: dr-region
- Uses mechanism: Cross-region read replicas
- Estimated RPO: 5m (Learn: "RPO is expected to be up to five minutes (data loss possible) except in the case of severe regional failure when the RPO can be close to the replication lag at the time of failure", and a typical range of 30 seconds to 5 minutes for read replicas — https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-business-continuity; asynchronous replication, so never 0, and the lag can be longer, so TC-1 measures it over a full workload cycle)
- Estimated RTO: 15m (Estimated, team-set starting value for the switch-over target; TC-3 proves it. It covers detecting the outage, declaring DR, a forced promotion that Learn says typically completes within 1-3 minutes of being triggered, reconnection through the virtual endpoint and the post-promotion work; Learn gives only "Minutes" for read replicas and no end-to-end figure)
- Prerequisites: the primary on General Purpose or Memory Optimized (Burstable has no read replicas) and the DR region offering the service and the same compute size as the primary (the list of supported sizes varies across regions) and quota for it; a replica with the same tier, compute size and storage size as the primary (Learn's symmetry rule for promote to primary server) and, for the shared-memory parameters, values equal to or above the primary's; storage autogrow enabled on the replica when it is enabled on the primary; virtual endpoints on the primary with the replica as the target of the reader endpoint; a replica created directly from the primary, not as a cascading replica (virtual endpoints are not supported for cascading replicas); a network path in both directions on port 5432 between the primary's and the replica's subnets, with the storage account of the WAL archives allowed, built with virtual network peering or a hub-and-spoke network when each region has its own virtual network; for private access, a private DNS zone linked to every virtual network that has clients, including the DR region's, and the server name (never an IP address) in each client's configuration; firewall rules set on the replica, because it does not inherit them; the PgBouncer, Microsoft Entra authentication and parameters set on the replica as they must be after promotion; an identity with the Microsoft.DBforPostgreSQL/servers/write permission on the servers that the promotion runs on (granted in the Build step that grants the promotion permission before DR); for customer-managed key encryption, a Key Vault and a user-assigned identity with key permissions in the DR region; a runbook step and automation that enable high availability on the promoted server.
- Cost notes: the replica's compute and storage run all the time, with cross-region data transfer for replication; a standby server too once high availability is enabled after a promotion; the backup storage that the promoted server accumulates; no price.
- Gives up: automatic failover (you detect the outage and trigger a forced promotion); zero data loss (asynchronous replication loses the lag at the time of the outage); high availability and geo-redundant backup on the replica until you configure high availability after the promotion (geo-redundant backup cannot be enabled on the replica or the promoted server); other replicas of a primary in a region without a pair, which are not seen by the promoted replica; the recovery priority and staggered updates that Learn lists for paired regions.
- Recommended when: the DR region is not the primary's pair or the primary region does not support geo-redundant backup, a recovery time of minutes is needed, and a data loss of the replication lag is acceptable.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql#cross-region-read-replicas

### geo-backup-split: Geo-redundant backup restored in the pair, with the DR region reading across regions
- Kind: split-region
- Target: pair-region
- Uses mechanism: Geo-redundant backup and geo-restore
- Estimated RPO: 1h (Learn: up to one hour of delay in copying backup data to the paired region, so "up to one hour of RPO when you restore", and "RPO < 1 h" in the business continuity table — https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-business-continuity)
- Estimated RTO: 12h (Estimated, team-set starting value; TC-6 proves it. Learn: the recovery "usually takes from a few minutes up to a few hours", depending on database size, last backup time and the WAL to process, and the business continuity table says only "Varies", so the value is a conservative upper bound and not a Learn figure)
- Prerequisites: a server created with geo-redundant backup (it cannot be added later) in a primary region that the overview's regions table marks as supporting it, with a pair in the same geography; at least one hour since the creation of the server so that the first backup has reached the pair; in the pair region, a virtual network and subnet for the restored server when the server uses private access (a geo-restore goes only to a different virtual network), or the firewall rules to apply after the restore for public access; a network path from the DR region to the pair region (virtual network peering or a hub-and-spoke network) and a private DNS zone linked to the DR region's virtual network when private access is used; the same compute, storage and tier available in the pair region, because they cannot be changed during a geo-restore; an identity that can create a server in the pair region and its subnet; for customer-managed key encryption, the geo-redundant backup key in a Key Vault in the pair region and a separate user-assigned identity; a post-restore configuration list (parameters, firewall rules, private endpoints, logins and permissions, alerts, high availability, replicas); the application able to take a new server name.
- Cost notes: backup storage for the geo-redundant copy, which Learn says makes the backup twice the size of the local copy for billing; the restored server's compute and storage only when you restore it, in a drill and in a real failover; cross-region traffic from the DR region to the pair; no price.
- Gives up: a database in the DR region (the data lands in the pair and the DR region reads and writes across regions); a recovery point newer than the last copied backup (up to one hour); a quick recovery (minutes to hours, not minutes); a point-in-time choice (the backup page says PITR of geo-redundant backups isn't available and that only the last available backup data at the paired region is restored; the how-to's restore point choices are checked in TC-6); a change of compute, storage or tier at restore time; the server name (a restore creates a new server); and any way to enable the option later on a server created without geo-redundant backup.
- Recommended when: residency allows the pair region, the primary region supports geo-redundant backup, the application tolerates up to one hour of data loss and a restore time of up to several hours, and the cost of a running replica is not justified.
- Source: https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore#geo-redundant-backup-and-restore

## Migration from a paired setup

### Recognise today's setup
Two paired setups show in an inventory of microsoft.dbforpostgresql/flexibleservers. First, a geo-redundant backup: the server's backup settings show geo-redundant backup enabled (Learn's CLI output shows it as the geoRedundantBackup property of the backup settings, with Disabled as the other value), and its backup redundancy is Geo-Redundant; the region is one that has a pair and shows no resource in the pair, because the backup copy is held by the service. Second, a cross-region replica in the pair: a server in the primary's pair region whose replica settings show the role AsyncReplica (replicationRole) and a sourceServerResourceId that points to the primary, with a replication state such as Active; a virtual endpoint on the primary points to it when one is set up. Record today's DR as the cross-region read replica to the pair when such a server is listed and its region is the primary's pair, as the geo-redundant backup to the pair when only the backup setting shows it, else as Unknown. The inventory cannot show: whether the first geo-backup has reached the pair (backup files are not exposed to users), the replication lag, whether the replica is symmetrical to the primary, or whether the application uses the virtual endpoint or the server name. Migration to a DR region that is not the pair is decided per server, by option id: cross-region-replica builds a replica in the DR region; geo-backup-split builds no new server and validates that the DR region can use a geo-restore in the pair. A server can keep geo-redundant backup while it has a replica in the DR region.

### Build
1. cross-region-replica: inventory the primary: tier and compute size, storage size, type and autogrow, the values of the five shared-memory parameters (max_connections, max_prepared_transactions, max_locks_per_transaction, max_wal_senders, max_worker_processes), high availability, PgBouncer, authentication (PostgreSQL or Microsoft Entra), network mode (public or private access), firewall rules, data encryption (service-managed or customer-managed key), geo-redundant backup, existing replicas and virtual endpoints. This list is what TC-2 and TC-7 compare.
2. cross-region-replica: check that the primary is General Purpose or Memory Optimized (a Burstable server has no replica; moving it to another tier is a server change that the team plans first), that the DR region offers the service with the same compute size as the primary and has quota for it, and that the primary has no running bulk load, because a replica is not created under heavy transactional load.
3. cross-region-replica: build the network in the DR region: a virtual network and subnet (delegated for private access), connectivity with the primary's network by virtual network peering or a hub-and-spoke network, a rule that allows traffic in both directions on destination port 5432 and access to the storage account of the WAL archives, and a virtual network link from the DR region's virtual network to the server's private DNS zone so that clients in the DR region resolve the server names.
4. cross-region-replica: for a server with customer-managed key encryption, create the Key Vault and the user-assigned identity in the DR region and give the identity the permissions on the key that the replica needs; for geo-redundant backup of that kind the identity and key vault of the backup stay separate from the primary's.
5. cross-region-replica: create the replica in the DR region with az postgres flexible-server replica create and the DR region as location, directly from the primary, with the same tier, the same compute size and the same storage size as the primary (Learn's symmetry rule for promote to primary server: a replica with more vCores leaves only promote to independent server), and, because Learn says storage autogrow must be enabled on the replicas when it is enabled on the primary (it does not say whether it is set at creation or after it), check the replica's autogrow setting after the creation and enable it on the replica when it is off, before the replica is relied on (TC-2 checks it). Expect minutes to several hours for the creation, and expect the primary to be in an updating state in which its parameters, high availability and firewalls cannot be changed.
6. cross-region-replica: create virtual endpoints on the primary with az postgres flexible-server virtual-endpoint create (a writer endpoint on the primary and the reader endpoint on the replica). When virtual endpoints already point to a replica in the pair, point the reader endpoint to the DR replica instead, because only one writer and one read-only endpoint can exist per primary and one of its replicas.
7. cross-region-replica: configure what the replica does not inherit: firewall rules, PgBouncer, Microsoft Entra authentication (the authentication method can be adjusted on the replica after creation) and the maintenance schedule; keep the five shared-memory parameters at or above the primary's, and the parameters that are not shared-memory ones as they must be after the promotion.
8. cross-region-replica: set alerts on the replica's Read Replica Lag and on the primary's Max Physical Replication Lag, storage percentage and Transaction Log Storage Used, and a Service Health alert for the primary's region, because Microsoft does not notify you when a region is down.
9. cross-region-replica: change the application's database configuration to the writer endpoint (base-name.writer.postgres.database.azure.com) in every region, never an IP address, with retry and exponential backoff for transient connection errors, and make sure its connection pool honors the DNS time-to-live. Write the runbook and the automation that enables high availability, PgBouncer and the other settings on the promoted server.
10. geo-backup-split: check that the server has geo-redundant backup enabled and that the primary region is marked in the overview's regions table as supporting it. When it does not, the option needs a new server created with geo-redundant backup in the primary region, and the data moved with the Azure Database Migration Service, or with pg_dump and pg_restore for an offline move, which the overview names for migration; then continue with this list on the new server.
11. geo-backup-split: prepare the pair region for a restore: for private access a virtual network and subnet in the pair region (a geo-restore cannot use the source's virtual network), for public access the firewall rules to apply after the restore; for customer-managed keys the Key Vault and identity of the geo-redundant backup in the pair region; and a network path from the DR region to the pair region (peering or hub-and-spoke) with the private DNS zone link for the DR region's virtual network.
12. geo-backup-split: write down the post-restore configuration list (the parameter values of the original server, firewall rules, private endpoints, logins and database-level permissions, alerts, high availability and replicas), because a restored server gets none of them, and check that the pair region offers the same compute, storage and tier (a geo-restore cannot change them).
13. cross-region-replica: grant the promotion permission before DR: create a custom role (or use an existing role) that holds the Microsoft.DBforPostgreSQL/servers/write permission, and assign it to the group of the Database administrator role of the runbook, scoped to the primary and to the DR replica only. Learn names the permission on the source server for the switch-over; the replica is granted too because the promotion command targets the replica, which is this playbook's inference. Keep the group small, and have it hold no standing rights beyond these two servers. TC-2 checks the assignment.
14. geo-backup-split: grant the geo-restore rights before DR: decide the role that lets the group of the Database administrator role of the runbook create a server in the pair region's resource group and place it in the pair region's subnet (for private access), together with the Key Vault and user-assigned identity of the geo-redundant backup for customer-managed keys; assign it, scoped to the pair region's resource group and virtual network, and record it in the runbook. This playbook cites no Learn role for a geo-restore, so the team chooses it; the geo-restore drill of TC-6 proves it.

### Validate
1. cross-region-replica: run TC-2 on the replica and the virtual endpoints, then TC-1 daily for 7 consecutive days that include a peak of the workload, and TC-4 from the DR region.
2. cross-region-replica: run TC-3 in a drill: a forced promotion on a non-production copy of the setup (Learn recommends non-production because the data loss is real), and on production a planned promotion at a quiet time, with the difference between the two noted, because a planned promotion does not show the behavior of a real outage.
3. cross-region-replica: run TC-7 after the drill promotion, on the promoted server.
4. geo-backup-split: run TC-5 on the server, then TC-4 from the DR region against a restored server in the pair region.
5. geo-backup-split: run TC-6 in a geo-restore drill into the pair region, and TC-7 on the restored server; delete the drill server afterwards.
6. Record each result with its date; a time or figure that a drill measured is Demonstrated, and everything else, including every recovery time of a real regional failover, stays Estimated or Unknown.

### Cut over
1. cross-region-replica: make the DR replica and its virtual endpoints the DR path in the runbook and in the application's DR configuration (the writer endpoint), and put the failover steps for cross-region-replica in the runbook.
2. cross-region-replica: remove from the runbook the steps that promote a replica in the pair or restore into the pair.
3. geo-backup-split: change nothing in the server; put the failover steps for geo-backup-split in the runbook, with the post-restore configuration list, the pair region's virtual network and the application's connection change to the new server name, and write the data-loss window (up to one hour) and its owner in the runbook.

### Decommission
1. cross-region-replica: after TC-1 to TC-4 and TC-7 have passed, delete the old replica in the pair (the primary is in an updating state during the deletion), and remove the network paths and DNS links that only it needed.
2. cross-region-replica: leave geo-redundant backup on the primary as it is: it cannot be switched off in place, because the backup storage redundancy cannot be changed after the server is provisioned, and it only goes away when a server is created again (a geo-restore lets you remove geo-redundant backup from the restored server). Keep in mind the storage cost of the second copy.
3. geo-backup-split: nothing is decommissioned, because nothing was built; the geo-redundant backup stays the DR source for the server.

### Keep until cut-over
For cross-region-replica: the replica in the pair and the runbook steps that use it, the virtual endpoint pointed to it and every network path to the pair region, until TC-1 to TC-4 and TC-7 have passed; the geo-redundant backup stays for good. For geo-backup-split: everything that exists today stays, which means the geo-redundant backup, and only its validation (TC-4 to TC-7) is new.

## Failover and failback

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region or the primary server is unavailable (Microsoft does not announce it; use Azure Service Health and the monitoring alerts) and declare DR for the workload | Incident manager | Estimated unknown (a detection and decision time that the first drill measures; Learn publishes no figure) | The declaration is recorded with its time, and the Service Health or monitoring evidence is attached | The primary answers again before the declaration |
| 2 | cross-region-replica: read the replica's replication state and its last Read Replica Lag, and record them as the expected data loss | Database administrator | Estimated unknown (a read of metrics and the portal that the first drill measures; Learn gives no figure) | The replication state is Active and the lag value with its time is recorded | The replication state is Broken: Learn says to drop and recreate the replica, which the outage may prevent, so the application owner decides between a forced promote to independent server and a geo-restore in the pair, and records the decision |
| 3 | cross-region-replica: run the forced promotion of the DR replica (data sync option Forced), using promote to primary server with the virtual endpoints (az postgres flexible-server replica promote with promote mode SwitchOver and promote option Forced); the promote to independent server is used when the virtual endpoints are not set or the promote to primary server cannot complete | Database administrator | Estimated 3m (Learn: a forced promotion typically completes within 1-3 minutes of being triggered) | The replica's role is primary, its replication state has left Reconfiguring, and the writer endpoint resolves to the DR server | The promotion fails or the server shows Broken: promote to independent server instead, record the lost data window, and escalate through Azure support |
| 4 | cross-region-replica: reconnect the application through the writer endpoint and honor the endpoint's DNS time-to-live (with promote to independent server, change the connection string to the promoted server) | Application engineer | Estimated unknown (set by the time-to-live of the endpoint's DNS records and the pool's reconnect; TC-3 measures it) | A test write through the writer endpoint from the DR region succeeds and the application's error rate returns to its normal level | The writer endpoint still resolves to the old primary after the time-to-live: check the endpoint's target, then connect to the promoted server by name |
| 5 | cross-region-replica: configure the promoted server with what a promotion does not carry over: high availability, PgBouncer, Microsoft Entra authentication, parameters (the TC-7 list) | Database administrator | Estimated unknown (high availability adds a standby server and Learn gives no time; TC-7 measures the list in a drill) | The TC-7 list shows no difference and, when it is enabled, high availability shows a healthy standby | Enabling high availability fails: run without it, record the reduced resilience, and retry |
| 6 | cross-region-replica: check the other replicas of the primary: in a primary region without a pair they are not recognized by the promoted replica and stay disconnected until the original region returns, so do not wait for them | Database administrator | Estimated unknown (a check of the replica list that the first drill measures; Learn gives no figure) | The replica list of the promoted server shows only the replicas that it recognizes | A replica that the application needs for reads is missing: point the reads at the promoted server |
| 7 | geo-backup-split: confirm that a geo-restore is available for the server (geo-backups are in the pair) and start the geo-restore into the pair with the pair's virtual network or the public access settings (az postgres flexible-server geo-restore with the pair region as location); take the latest restore point, because the backup page says PITR of geo-redundant backups isn't available and only the last available backup data at the paired region is restored | Database administrator | Estimated unknown (Learn: a few minutes up to a few hours, depending on database size, last backup time and WAL to process) | The new server reaches the Ready state in the pair region and its newest data is no older than the last copied backup | The error that the geo-backups are not available yet appears, or the restore fails: stop, record that no restore point exists, and escalate through Azure support; the application owner decides on the data that is lost |
| 8 | geo-backup-split: apply the post-restore configuration (parameters, firewall rules or private endpoints, logins and permissions, alerts, high availability, replicas); do not create geo-redundant backup in the pair until the primary region is up | Database administrator | Estimated unknown (the list is the team's; TC-7 measures it in a drill) | The TC-7 list shows no difference and the application's database account can connect from the DR region | A parameter or permission is missing and blocks the application: apply it before releasing the application, and record the delay |
| 9 | geo-backup-split: point the application in the DR region at the new server name (the connection string changes, because a restore creates a new server) and start it | Application engineer | Estimated unknown (set by the deployment time of the configuration change; TC-6 measures it) | A test read and write from the DR region succeeds over the network path to the pair region | The DR region cannot reach the pair region: check the peering, the DNS zone link and the firewall rules before any change to the server |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region and its servers are available again and decide to fail back | Incident manager | Estimated unknown (measured in the first drill) | The primary region shows healthy in Service Health and the decision is recorded | The primary region is still degraded |
| 2 | cross-region-replica: with promote to primary server the former primary rejoins as a replica of the promoted server; wait for its replication state to be Active and its lag to be low (with promote to independent server, remove the old primary or recreate it as a replica of the promoted server) | Database administrator | Estimated unknown (depends on the data written during DR; Learn gives no figure) | The former primary shows a replica role, the state Active and a lag within the bound of TC-1 | The state is Broken: drop and recreate the replica, and stay on the DR region meanwhile |
| 3 | cross-region-replica: run a planned promotion of the former primary at a quiet time (a promote to primary server with Planned data sync, no data loss) and put the virtual endpoints back | Database administrator | Estimated 3m (Learn: about 1 to 3 minutes of brief downtime, depending on the replication lag, for planned promotions) | The former primary is the primary again, the writer endpoint resolves to it and a test write succeeds | The replicas are not symmetrical or a server is not Ready: stay on the DR region, fix the symmetry and retry |
| 4 | cross-region-replica: enable high availability and the other settings on the server that is primary again (a promotion disables high availability), and check the backups | Database administrator | Estimated unknown (high availability adds a standby server and Learn gives no time) | The TC-7 list shows no difference, and a backup exists before a point-in-time restore is relied on | High availability cannot be enabled: record the reduced resilience and retry |
| 5 | geo-backup-split: freeze writes on the server in the pair, move the data back to a server in the primary region with a logical copy (pg_dump and pg_restore, which Learn names for moving data outside the backup system, or the Azure Database Migration Service, which the overview names for migration; the pages read here describe no reverse replication for a geo-restored server), create the primary-region server with geo-redundant backup when it has to be created again, and verify it | Database administrator | Estimated unknown (depends on the database size; Learn gives no figure for a logical copy) | The row counts and checksums of the key tables on the primary-region server equal those on the pair server | The copy fails or the checks differ: keep the application on the pair server |
| 6 | geo-backup-split: move the application back to the primary-region server, restart it, and delete the server in the pair when nothing needs it | Application engineer | Estimated unknown (set by the deployment time of the configuration change) | A test write succeeds on the primary-region server and the application's error rate is normal | A write fails: switch back to the pair server |

## Test criteria

### TC-1: The replica is in the DR region, Active, and its lag stays within the bound
- Applies to: cross-region-replica
- Pass condition: the replica is in the DR region, its replication state is Active, and for 7 consecutive days that include a peak of the workload the Read Replica Lag never exceeds the lag bound, which is the Estimated RPO of the option (5m, Learn's figure) or a lower bound that the application owner sets and records (Estimated until TC-1 Demonstrates it); alert rules at that bound and on the primary's storage percentage and Transaction Log Storage Used exist and are enabled; the primary's storage stays below the level Learn names as the read-only trigger, 95%.
- How to measure: read the replica with az postgres flexible-server replica list and the replication state in the portal; read the Read Replica Lag (physical_replication_delay_in_seconds) of the replica and the Max Physical Replication Lag (physical_replication_delay_in_bytes) of the primary from Azure Monitor metrics at the finest grain over the window, and take the maximum per day; query the primary directly for the lag of each replica as a cross-check.
- Evidence: the replica list output with its date, the 7-day metric export with the daily maximum and the bound, the alert rule definitions and one alert test record.
- Frequency: daily for the first 7 days, then monitored continuously with the alert, and re-checked monthly against the stated bound

### TC-2: The replica is ready for promote to primary server
- Applies to: cross-region-replica
- Pass condition: the replica has the same tier, compute size and storage size as the primary (Learn's symmetry rule for promote to primary server), the five shared-memory parameters on the replica are greater than or equal to the primary's, storage autogrow is on the replica when it is on the primary, the virtual endpoints exist with the writer endpoint on the primary and the reader endpoint on the replica (so a promote to primary server can run), and the identity that runs the promotion holds the Microsoft.DBforPostgreSQL/servers/write permission on the servers it uses; the list of differences is empty.
- How to measure: a scheduled job reads the properties of the primary and the replica (SKU, storage, parameters, autogrow), lists the virtual endpoints with their targets and lists the role assignments of the promotion identity, then compares them with this list.
- Evidence: the job report with its date, the compared values, and an empty difference list.
- Frequency: weekly, and after every change of the primary's tier, storage or parameters

### TC-3: A promotion in a drill meets the switch-over target
- Applies to: cross-region-replica
- Pass condition: in a drill the promotion of the DR replica (a forced promotion on a non-production copy, a planned promotion on production) completes and the application's first successful write reaches the promoted server within the switch-over target in Estimated RTO of the option (15m), the data lost equals the replication lag that was read before the promotion (no more), the writer endpoint resolves to the promoted server, and the former primary rejoins as a replica when its region is available again (a promote to primary server). The planned drill on production does not show the behavior of a real outage, so the real recovery time and loss can be observed only in a real regional failover.
- How to measure: record the time of the trigger, the time the writer endpoint resolves to the DR server and the time of the first successful write; compare a marker row, written continuously to the primary before the trigger, with the newest marker on the promoted server to measure the loss; read the replication state of both servers after the region is back.
- Evidence: the drill record with its timestamps, the lag before the trigger, the marker comparison and the replication states.
- Frequency: before cut-over, then every DR drill at the interval the team sets (Learn: test "regularly") and after every change of the endpoints, the tier or the network

### TC-4: The DR region reaches the database and the application identity connects
- Applies to: cross-region-replica, geo-backup-split
- Pass condition: from the DR region's virtual network or network the server name of the DR server (for cross-region-replica the replica and the writer endpoint; for geo-backup-split a server restored in the pair region) resolves to the address the design expects, traffic in both directions on port 5432 between the primary and the replica is allowed (cross-region-replica), the application's database account connects with its real credentials or identity, and a read succeeds within the latency bound that the team sets and records with the probe.
- How to measure: a scheduled probe in the DR region resolves the server name, opens a connection on port 5432 and runs a read-only query, recording result, resolved address and latency; for geo-backup-split the probe runs against the drill server of TC-6 and its result is reviewed with the peering, the DNS zone link and the firewall rules.
- Evidence: the probe log, and the review record of the network, DNS links, firewall rules and accounts, with their date.
- Frequency: the probe daily for cross-region-replica and in each drill for geo-backup-split; the review after every change to the network, DNS or accounts

### TC-5: Geo-redundant backup is enabled and its first backup has had time to reach the pair
- Applies to: geo-backup-split
- Pass condition: design check, not drillable on its own, because backup files are not exposed to users: the server's backup settings show geo-redundant backup enabled, the primary region is marked as supporting it in the regions table of the overview, the server is older than one hour, the retention period equals the value the team set, and the date of the last TC-6 drill is recorded and is no older than the drill interval that the team sets.
- How to measure: read the backup properties (geo-redundant backup, retention) of the server with az postgres flexible-server show or the portal, and compare the region with the overview table; the drill in TC-6 is this playbook's own proof that a backup is restorable into the pair, because Learn's FAQ says "the best way to check backups is to perform periodic PITR and ensure that backups are valid and restorable" and also says that PITR of geo-redundant backups isn't available.
- Evidence: the property output and the review record with their date, and the date of the last TC-6 drill.
- Frequency: monthly, and after every server re-creation

### TC-6: A geo-restore drill meets the recovery bounds
- Applies to: geo-backup-split
- Pass condition: a geo-restore drill of the server into the pair region, with the pair's virtual network or the public access settings, reaches the Ready state with the newest data no more than 1 hour older than a marker row written to the source (the Estimated RPO), a read and a write from the DR region over the planned network path succeed, and the elapsed time from the start of the restore to the application's first successful request is recorded as the measured recovery time and is within the Estimated RTO of the option (12h, a team-set starting value that the first drill confirms or replaces).
- How to measure: write a marker row to the source continuously before the drill; start az postgres flexible-server geo-restore into the pair, record the start time, the Ready time and the time of the first successful request from the DR region, compare the newest marker on the restored server with the source, and delete the drill server afterwards.
- Evidence: the drill record with its timestamps, the marker comparison, the measured elapsed time and the deletion of the drill server.
- Frequency: before cut-over, then every DR drill at the interval the team sets (Learn: test "regularly") and after the database has grown a lot, because Learn says the recovery time depends on the size of the database

### TC-7: The server has the settings a promotion or restore does not carry over
- Applies to: cross-region-replica, geo-backup-split
- Pass condition: after the drill promotion or restore, the difference list between the original server and the promoted or restored server is empty for the items the platform does not carry over: parameters (the values the application needs), firewall rules or private endpoints and network rules, PgBouncer, Microsoft Entra authentication, logins and database-level permissions, alerts, and high availability when the primary has it; geo-redundant backup is on the list with the note that it can be set only at creation.
- How to measure: read the properties of the original and the promoted or restored server with az postgres flexible-server show and the parameter, firewall and administrator lists, and compare them with the post-promotion or post-restore list of the runbook; check the logins with a query on the server.
- Evidence: the comparison output with its date and an empty difference list, or the differences with the owner and the date they are closed.
- Frequency: in every drill of TC-3 and TC-6, and after every change of the primary's configuration
