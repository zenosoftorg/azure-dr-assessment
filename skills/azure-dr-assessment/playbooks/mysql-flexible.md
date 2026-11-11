---
service: mysql-flexible
title: Azure Database for MySQL flexible server
arm_types:
  - microsoft.dbformysql/flexibleservers
slot: data-replication.relational
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-database-mysql
  - https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-read-replicas
  - https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore
  - https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-business-continuity
  - https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-read-replicas-portal
  - https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-read-replicas-cli
  - https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-restore-server-portal
  - https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-restore-server-cli
  - https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-networking-vnet
  - https://learn.microsoft.com/en-us/azure/mysql/flexible-server/overview
  - https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support
  - https://learn.microsoft.com/azure/templates/microsoft.dbformysql/flexibleservers
---

# Azure Database for MySQL flexible server

## Mechanisms

### Zone-redundant and local-redundant high availability
- Replicates: data, synchronously from the primary server to a warm standby replica server in the same region (in another availability zone for zone-redundant HA, in the same zone for local-redundant HA)
- Paired: no
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: 0 (Learn: data changes on the primary server are synchronously replicated to the standby "to ensure zero data loss during a failure of the primary server"; the mechanism stays inside one region, so it gives no region DR)
- Estimated RTO: unknown (Learn says the server automatically fails over to the standby replica server and publishes no figure on the pages read; it does not help against a region outage)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-mysql#resilience-to-availability-zone-failures

### Cross-region read replicas
- Replicates: data (the whole server, asynchronously), to a read-only server that is a separate Azure Database for MySQL server in another region; the user accounts of the source are replicated with it
- Paired: yes
- Nonpaired: yes
- Failover: manual
- Estimated RPO: 1h (Learn: "RPO < 1 h" for a read replica used as DR solution, and "can be much higher in some cases" on the business continuity page https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-business-continuity#unplanned-downtime-mitigation; replication is asynchronous, "replication lag is typically at least several minutes, but it can be much longer" on the reliability page, "in most cases, replica lag ranges between a few seconds to a couple of minutes" on the read replica page, and the lag at the time of the stop "indicates how much data is lost")
- Estimated RTO: unknown (Learn: stopping replication "typically completes within two minutes after you trigger the action", the business continuity page says "The RTO in most cases is a few minutes", and the time to reconfigure the application is added and is not published; TC-3 measures it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-mysql#cross-region-read-replicas

### Geo-redundant backup with geo-restore
- Replicates: data, as the automated backups (snapshot backups and transaction log backups); with geo-redundant backup storage the backups are copied to the geo-paired region, with a delay of up to an hour, and a geo-restore creates a new server from the most recent geo-redundant backup, in the geo-paired region or in any other region where the service is available except Brazil South, USGov Virginia and West US 3 (the copy lives in the pair, the restore target may be any of those regions)
- Paired: yes
- Nonpaired: yes
- Failover: manual
- Estimated RPO: 1h (Learn: "There's a delay between when a backup is taken and when it's replicated to a different region. This delay can be up to an hour, so if a disaster occurs, there can be up to one hour data loss")
- Estimated RTO: unknown (Learn: the recovery time depends on the size of the databases, the transaction log size, the network bandwidth and the number of databases recovering in the same region at the same time, and publishes no figure; TC-4 measures it in a drill)
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#geo-restore

## Constraints

### The multiregion reference marks read replicas with manual failover
Learn's list of Azure services that support multiple regions describes Azure Database for MySQL cross-region read replicas as replicating data asynchronously to read replicas in other regions with manual failover.
- Source: https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support

### Cross-region read replicas are not limited to the paired region
Learn says that you can create cross-region read replicas in any region that supports Azure Database for MySQL, and that you aren't limited to Azure paired regions. This means a DR region that is not the primary's pair is a supported replica target, so the replica is the native option for a non-paired DR region.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-mysql#requirements

### The read replica page names the paired region and the universal replica regions
The read replica page says that Azure Database for MySQL Flexible Server allows a read replica "in any Azure supported regions" where the service is available, and that a source server can have a replica in its paired region or the universal replica regions. It points to the regions list of the service overview, so the DR region is checked against that list before it is chosen.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-read-replicas#cross-region-replication

### Read replicas need the General Purpose or Memory Optimized tier
The read replica feature is only available for servers in the General Purpose or Memory-Optimized pricing tiers, and a replica on a server in the Burstable pricing tier is not supported. The source server has to be in one of these tiers.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-read-replicas

### A replica is a new server and the number of replicas is limited
A read replica is created as a new Azure Database for MySQL Flexible Server instance: an existing server can't be made into a replica, and creating a replica of another read replica isn't supported. A source server can replicate to up to 10 replicas, and each replica is billed on its own provisioned compute and storage.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-read-replicas#considerations-and-limitations

### The replica can only be created while the source is reachable
Learn says that you can configure replicas after you create the source server only if the source server is running and reachable. This means the DR replica is built before the disaster, and a replica cannot be created as a reaction to a region outage.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-mysql#configure-multiregion-support

### The read replica page says that creating a replica needs no restart
The read replica page says that no restart or downtime is needed when creating a read replica, and that the operation is online.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-read-replicas#considerations-and-limitations

### The CLI page says that the first replica restarts the source
The page about the Azure CLI says that when you create a replica for a source that has no existing replicas, "the source will first restart to prepare itself for replication", and advises an off-peak period. Learn's pages differ on this, so plan the first replica of a source in an off-peak window until the first build shows what happens.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-read-replicas-cli#create-a-read-replica

### Replication is asynchronous and a failover can lose data
Cross-region read replicas use asynchronous replication, so replicas can lag behind the source. Learn says that replication lag is typically at least several minutes but can be much longer, that Azure doesn't fail over to read replicas automatically even if a region failure occurs, and that the failover, which stops replication, results in permanent loss of the unreplicated data, the amount depending on the replication lag at the time of the outage.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-mysql#behavior-during-a-region-failure

### Replication lag is monitored with the Replication lag in seconds metric
The Replication lag in seconds metric of Azure Monitor is available for replicas only and is calculated from the seconds_behind_master value of the MySQL replication status. Learn advises an alert on a threshold that is unacceptable for the workload, and says that the replica's IO status shown by the MySQL replication status is always "No" because replication is storage-based, so the replication metrics Replica IO Status and Replica SQL Status give the status. Learn also says that the lag at the time the replica is unlinked indicates how much data is lost.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-read-replicas#monitor-replication

### There is no automated failover and stopping replication is irreversible
There is no automated failover between a source and its replicas. The customer fails over by stopping replication, which promotes the replica to a standalone read-write server; the action is irreversible, the standalone server can't be made into a replica again, and the server loses all links to its previous source and to other replica servers.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-read-replicas#stop-replication

### Stopping replication typically takes about two minutes and the application must be re-pointed
After stop replication is started, the backend process typically takes about two minutes. Each server has a unique connection string, so the application is updated to point to the former replica instead of the source, and the downtime depends on when the issue is detected and when both steps are complete.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-read-replicas#failover

### A promoted replica has no high availability
Read replicas can't have HA enabled, and when they are failed over to become the primary server they don't have HA either. The customer is responsible for configuring HA after failing over to a replica, manually or in automation.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-mysql#considerations

### A replica inherits connectivity, accounts and settings from the source
When you create a replica it inherits the connectivity method of the source server and can't change it (a source that uses private access gives a replica that can't use public access), inherits the admin account, and receives all user accounts of the source; you can connect to a replica only with accounts available on the source. The replica is created with the same server configuration as the source, and afterwards compute generation, vCores, storage, backup retention and the compute tier can be changed independently. Learn says to update the replica to equal or greater values before the source configuration is changed, so that the replica can keep up.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-read-replicas#connect-to-a-replica

### A replica is created in the source's resource group and subscription
The replica server is always created in the same resource group and the same subscription as the source server, and it can be moved to another resource group or subscription after creation.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-read-replicas-portal#create-a-read-replica

### Some server parameters and table designs affect replicas
The server parameters innodb_file_per_table and log_bin_trust_function_creators are locked on both the source and the replica, and event_scheduler is locked on the replica; to update one on the source, delete the replicas, update the value and recreate the replicas. Learn does not recommend adding an AUTO_INCREMENT primary key column to a table after a replica exists, because this breaks replication, and advises that source tables have primary keys because a lack of them might result in replication latency. In-memory tables might cause replicas to become out of sync. GTID is off by default; if it is enabled on the source, new replicas enable it, and once it is enabled it can't be turned off without contacting support.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-read-replicas#considerations-and-limitations

### Deleting the source stops replication to every replica
When the source server is deleted, replication stops to all replicas, and the replicas become standalone servers that accept reads and writes. This means a deleted or recreated source never leaves a replica that still replicates.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-read-replicas-portal#delete-a-source-server

### Failback means a new replica and a second failover
When the region recovers, Microsoft doesn't move the primary server automatically. Learn's approach is to create a new read replica in the primary region and then perform another failover, either by taking the application offline and waiting for replication to catch up (downtime of about the replication lag) or by failing over at once and accepting the loss of unreplicated data. Learn adds that the creation time of a replica depends on the amount of data on the source and the time since the last weekly full backup, and ranges from a few minutes to several hours.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-mysql#region-recovery

### Learn advises regular failover tests in a nonproduction environment
Learn advises to regularly test read replica failover procedures against the RTO and RPO. A read replica can be failed over at any time, even when all regions are healthy, and Learn recommends nonproduction tests because the test can cause data loss and requires manual failback.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-mysql#test-for-region-failures

### Geo-redundant backup storage replicates to the geo-paired region and is tier-listed
Geo-redundant backup storage stores copies in the region of the server and replicates the backups to the geo-paired region, and Learn says that geo redundancy is supported for servers hosted in any of the Azure paired regions. The backup redundancy options are listed for the Basic, General Purpose and Memory-Optimized tiers, while the reliability article lists Burstable as a compute tier too, so the tier of the server is checked before geo-redundant backup is counted on. The backup storage used for a geo-redundant server is twice that of a locally redundant server.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#backup-redundancy-options

### The regions table governs where geo-redundant backup is available
The overview of the service lists the Azure regions where Azure Database for MySQL flexible server is available, with one column per capability: availability, local-redundant HA, zone-redundant HA and geo-redundant backup (Yes or No for each region). The Geo-redundant backup column of that table, read for the source's region, is the check for whether a server there can use geo-redundant backup; the pairing of the region is not the check. This means the sentence of the backup page about paired regions is not read as a complete rule, and a region's value is taken from the table and from backup.geoRedundantBackup of the server.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/overview#azure-regions

### Geo-redundancy is set at creation or moved from locally redundant storage
Geo-redundancy can be enabled at server creation, and a server on locally redundant backup storage can move to geo-redundant storage after creation by enabling geo-redundancy in the Compute + Storage configuration. A server with zone-redundant backup storage can't be converted through that setting: Learn gives two ways, a point-in-time restore to a server with the wanted configuration, or a new server with the data migrated by dump and restore. For a zone-redundant HA server, geo-redundancy can be enabled or disabled only at server creation.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#move-from-other-backup-storage-options-to-geo-redundant-backup-storage

### Geo-restore can target the paired region or any other supported region
Learn says that a server with geo-redundant backups can be restored to its geo-paired region or to any other Azure supported region where the service is available, except Brazil South, USGov Virginia and West US 3, and calls the ability to restore a geo-redundant backup to any region "Universal Geo-restore". The restore uses the most recent backup of the server. The copy of the backup is stored in the paired region, but the restore target is not limited to it, so the recovery region can be a DR region that is not the pair, with the three exclusions above. A server with zone-redundant HA that is geo-restored is deployed as a single non-HA server (see the constraint on restored servers).
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#geo-restore

### Geo-restore is the default recovery option and costs up to one hour of data
Learn says geo-restore is the default recovery option when an incident in the region makes the server unavailable. It uses the most recent backup, and the delay between a backup and its replication to another region can be up to an hour, so up to one hour of data can be lost.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#geo-restore

### Geo-restore while the primary region is down needs geo-redundancy turned off
When the primary region is down, geo-redundant servers can't be created in the geo-paired region because storage can't be provisioned in the primary region. The source server can still be geo-restored to the geo-paired region by disabling the geo-redundancy option in the Compute + Storage settings of the restore experience, which restores it as a locally redundant server.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#geo-restore

### A restore creates a new server and virtual network rules are not copied
Restoring creates a new server, and a restore to the same server name isn't supported, so a different name is used. A geo-restored server has the same server admin sign-in name and password that was valid for the existing server when the restore started, and networking settings (virtual network settings and firewall rules) can be configured during the restore. Learn says that virtual network rules aren't copied from the original server, so connectivity, logins, database-level permissions and alerts are checked after the restore and clients are redirected to the new server. Learn names only virtual network rules here; the pages differ on what else a restore carries over (see the next two constraints), so the networking of a restored server is set in the restore and checked, not assumed.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-restore-server-portal#perform-post-restore-tasks

### A point-in-time restore inherits tags and settings such as virtual network and firewall
For a point-in-time restore, Learn says that the new server has the original server's configuration for the compute tier, number of vCores, storage size, backup retention period and backup redundancy option, and that the restored server also inherits tags and settings such as virtual network and firewall from the source server. Learn says this for the point-in-time restore, in the same region as the source, and not for a geo-restore.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#point-in-time-restore

### The CLI geo-restore example keeps the network setting
The CLI page geo-restores a server in one region to its geo-paired location "with the same network setting", with az mysql flexible-server geo-restore and the location of the target. It is an example for the geo-paired location and says nothing about a restore into another region.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/how-to-restore-server-cli#geo-restore-a-server-from-geo-backup-to-a-new-server

### A restored server is a non-HA server
After a restore, a server that had high availability enabled becomes non-HA, for both point-in-time restore and geo-restore. A zone-redundant HA server that is geo-restored is configured in the geo-paired region and deployed as a single server in non-HA mode.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#restore

### Restore time depends on environment-specific factors
The estimated time of a restore depends on the size of the databases, the number of transaction logs and the activity to replay, the network bandwidth if the restore is to a different region, the number of concurrent restore requests in the target region and the presence of primary keys in the tables. Learn gives no figure for a restore.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#restore

### Learn advises testing the recovery time of a point-in-time restore
In the point-in-time restore section Learn says that the estimated time of recovery depends on several factors, including the compute size of the SKU and the time of the restore, and that to estimate the accurate recovery time you test it in your environment because it has many environment-specific variables. The geo-restore section lists its own factors and gives no such advice, so the geo-restore time is measured in a drill (TC-4) and not taken from a figure.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#point-in-time-restore

### Backups cannot be exported
Backup files can't be exported and can be used only for restore operations in Azure Database for MySQL Flexible Server. To copy a database to another place, Learn points to mysqldump from a MySQL client, and if you delete the server, all backups that belong to it are also deleted and can't be recovered.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#on-demand-backup

### Private access needs a delegated subnet in a virtual network in the server's region
A server with private access (virtual network integration) must be in a virtual network in the same Azure region as the server, in a subnet delegated to Microsoft.DBforMySQL/flexibleServers. Client connectivity is supported from virtual networks in the same region and, through global peering, from virtual networks in other regions. Learn gives no region rule for the private DNS zone: its name must end with mysql.database.azure.com, and a client in another virtual network needs the server's private DNS zone linked to its network. The private DNS integration configuration can't be changed after deployment, and the server can't be moved to another virtual network or subnet. This means a replica or restored server in the DR region (or the pair region) needs its own virtual network prepared in that region.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-networking-vnet#virtual-network-concepts

### The ARM schema defines the replication, backup and tier properties
The ARM template reference of Microsoft.DBforMySQL/flexibleServers defines the property replicationRole ('None', 'Replica' or 'Source'), sourceServerResourceId (the source MySQL server id), createMode ('Default', 'GeoRestore', 'PointInTimeRestore', 'Rename' or 'Replica'), backup.geoRedundantBackup ('Disabled' or 'Enabled') and sku.tier ('Burstable', 'GeneralPurpose' or 'MemoryOptimized'). The page defines the schema of a deployment and does not say what an inventory read returns, so using these properties to recognise today's DR is this playbook's reading, and the first inventory run and TC-7 confirm it.
- Source: https://learn.microsoft.com/azure/templates/microsoft.dbformysql/flexibleservers

### The reader endpoint (preview) does not support geo-replicas
Learn lists, among the limitations of the reader endpoint during public preview, that geo-replicas aren't supported yet. This means a reader endpoint does not apply to a cross-region replica.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-read-replicas#reader-endpoint-preview

### Learn publishes RPO figures for read replicas and geo-restore
Learn's table of unplanned failure scenarios gives, for a geo-restore from the paired region, "RTO: Varies RPO <1 h" and for a region failure "RPO in most cases would be <1 h and RTO would vary". For a read replica used as a DR solution (stop the replication, which makes the replica read-write, and redirect the traffic) it says "The RTO in most cases is a few minutes and RPO < 1 h. RTO and RPO can be much higher in some cases depending on various factors including latency between sites, the amount of data to be transmitted, and importantly the primary database write workload." These are typical values and not commitments.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-business-continuity#unplanned-downtime-mitigation

## Non-paired options

### cross-region-replica: Cross-region read replica in the DR region, promoted manually
- Kind: native
- Target: dr-region
- Uses mechanism: Cross-region read replicas
- Estimated RPO: 1h (Learn: "RPO < 1 h" for a read replica used as DR solution, with the remark that "RTO and RPO can be much higher in some cases depending on various factors including latency between sites, the amount of data to be transmitted, and importantly the primary database write workload" — https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-business-continuity#unplanned-downtime-mitigation; replication is asynchronous, the lag is "typically at least several minutes" and the lag when the replica is unlinked is the data lost; TC-2 monitors the lag against an alert threshold that the team sets and does not change this figure)
- Estimated RTO: 30m (Estimated, team-set starting value for the switch-over target covering stopping replication, re-pointing the application and enabling HA; TC-3 proves it. Learn says "The RTO in most cases is a few minutes" and that stopping replication typically takes about two minutes, with no published figure for the rest)
- Prerequisites: the source in the General Purpose or Memory Optimized tier (Burstable is not supported) and a DR region where the service is available (not limited to the pair); the replica built before any outage, while the source is running and reachable, in the same resource group and subscription as the source, and with the Azure RBAC permissions of your access model to create, update, promote and delete flexible servers there (the Learn pages read name no role or permission for it, so the platform owner decides the role and records it in the runbook); compute, vCores and storage on the replica equal to or greater than the source; primary keys on the source tables, and the locked server parameters (innodb_file_per_table, log_bin_trust_function_creators) and GTID decided before the replica is created; networking: the replica inherits the connectivity method of the source, so when the source uses private access the DR region needs its own virtual network with a subnet delegated to Microsoft.DBforMySQL/flexibleServers, a private DNS zone whose name ends with mysql.database.azure.com that is linked to the network of the DR application tier, and a network path (peering) from the DR application tier to it (the need for a network in the DR region is this playbook's reading of the Learn rules, and TC-5 proves the path); DNS: the application uses the server's fully qualified domain name and never its IP address, and holds the connection string of the replica for DR; identity inside the database: the replica receives the accounts of the source, so no accounts are created on it and the DR application uses the same ones.
- Cost notes: a second server (compute and storage billed per replica), cross-region data transfer for the replication, the HA standby that has to be added after the failover; no price. Learn says the reader endpoint (preview) doesn't support geo-replicas, so none applies.
- Gives up: automatic failover (the customer detects the outage and promotes the replica); the unreplicated data (the asynchronous lag); the replica as a replica (stopping replication is irreversible and the stopped server can't be made a replica again, so every drill or failover consumes the replica and a new one is built for failback and for the next DR copy); high availability on the promoted server until the customer enables it; the connection string (the application is re-pointed to the replica's own address).
- Recommended when: the DR region is not the primary's pair or the DR region is chosen for another reason, the server is in the General Purpose or Memory Optimized tier, the workload accepts the asynchronous lag as its data-loss tolerance, and the team can promote the replica by hand and re-point the application.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-database-mysql#cross-region-read-replicas

### geo-restore: Geo-restore of the geo-redundant backup into the DR region
- Kind: backup-restore
- Target: dr-region
- Uses mechanism: Geo-redundant backup with geo-restore
- Estimated RPO: 1h (Learn: "RPO < 1 h" for a geo-restore and "up to one hour data loss", because of the delay between a backup and its replication to another region — https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-business-continuity#unplanned-downtime-mitigation; TC-4 measures what a drill restores)
- Estimated RTO: 12h (Estimated, team-set starting value; TC-4 proves it. Learn says only that the recovery time "would vary" with the size of the databases, the transaction log size, the network bandwidth and the number of databases recovering in the same region at the same time, so the value is a conservative upper bound and not a Learn figure)
- Prerequisites: the source in a region whose Geo-redundant backup column in the service's regions table is Yes, with geo-redundant backup storage enabled (backup.geoRedundantBackup 'Enabled'; the regions table governs, see the constraint on it; it is a create-time choice for a server with zone-redundant HA, and a server with zone-redundant backup storage can't be converted through the Compute + Storage setting); a tier for which Learn lists geo-redundant backup (Basic, General Purpose and Memory-Optimized; Burstable is not in that list); a DR region where the service is available and that is not Brazil South, USGov Virginia or West US 3; networking in the DR region, ready before the outage, when the restored server uses private access: a virtual network, a subnet delegated to Microsoft.DBforMySQL/flexibleServers and a private DNS zone ending with mysql.database.azure.com linked to the virtual network of the DR application tier (the restore experience offers the networking settings); identity: the Learn pages read name no role or permission for a restore, so the platform owner decides the role that may restore into the DR resource group and records it in the runbook; the restored server has the server admin sign-in name and password that were valid for the source when the restore started, and the database logins and permissions are checked after the restore (Learn's post-restore task), with the runbook saying how a missing one is created; DNS: a restore always creates a server with a new name, so the DR deployment takes the restored server's fully qualified domain name from its configuration and never an IP address.
- Cost notes: geo-redundant backup storage (Learn: the backup storage used for a geo-redundant server is twice that of a locally redundant server), the restored server's compute and storage while it exists (and during drills), and network traffic to it from the DR application tier; no price.
- Gives up: live replication (the recovery point is the latest replicated backup, up to one hour old); a standing server in the DR region (the server is created at restore time, so the recovery time includes the restore and Learn publishes no figure for it); high availability on the restored server (it is non-HA after the restore); the virtual network rules, which Learn says are not copied (Learn's pages differ on what else a restore carries over, so the networking is set and checked in the restore); a DR region among Brazil South, USGov Virginia and West US 3; and a source region whose Geo-redundant backup column in the regions table is No.
- Recommended when: the DR region is not the primary's pair and no standing replica is wanted (budget, or a workload that accepts a recovery point of up to an hour and a recovery time that a drill measures), or the team accepts a recovery that starts from a backup although the server is in a tier that supports replicas.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#geo-restore

### geo-backup-split: Geo-redundant backup restored in the paired region
- Kind: split-region
- Target: pair-region
- Uses mechanism: Geo-redundant backup with geo-restore
- Estimated RPO: 1h (Learn: "RPO < 1 h" for a geo-restore and "up to one hour data loss", because of the delay between a backup and its replication to another region — https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-business-continuity#unplanned-downtime-mitigation; TC-4 measures what a drill restores)
- Estimated RTO: 12h (Estimated, team-set starting value; TC-4 proves it. Learn says only that the recovery time "would vary" with the size of the databases, the transaction log size, the network bandwidth and the number of databases recovering in the same region at the same time, so the value is a conservative upper bound and not a Learn figure)
- Prerequisites: the source in a region whose Geo-redundant backup column in the service's regions table is Yes and that has a geo-paired region (the restore target), with geo-redundant backup storage enabled (backup.geoRedundantBackup 'Enabled'; enabling it needs a tier that Learn lists for it, and for a server with zone-redundant HA it is a create-time choice only); a restore target in the pair region, with a virtual network, a subnet delegated to Microsoft.DBforMySQL/flexibleServers and a private DNS zone ending with mysql.database.azure.com ready there when the restored server uses private access (the restore experience offers networking settings); a network path from the DR application tier in the DR region to the restored server in the pair (global peering and the private DNS zone link); identity: the Learn pages read name no role or permission for a restore, so the platform owner decides the role that may restore into the target resource group and records it in the runbook; the admin sign-in of the restored server is the one valid for the source when the restore started, and the database logins and permissions are checked after the restore (Learn's post-restore task); the application uses the server's fully qualified domain name and takes the restored server's name from its DR configuration, because a restore always creates a server with a new name.
- Cost notes: geo-redundant backup storage (Learn: the backup storage used for a geo-redundant server is twice that of a locally redundant server), the restored server only when it exists (and during drills), and cross-region traffic from the DR application tier; no price.
- Gives up: replication of live data (the recovery point is the latest replicated backup, up to one hour old); a standing server in the DR copy (the server is created at restore time, so the recovery time includes the restore); high availability on the restored server (it is non-HA after the restore); the virtual network rules, which Learn says are not copied (Learn's pages differ on what else a restore carries over, so the networking is set and checked in the restore); the DR region as the place of the data (the data is restored in the pair, and the DR application tier reaches it across regions; geo-restore places it in the DR region itself).
- Recommended when: the DR region may use the paired region for the data and a recovery point of up to an hour and a recovery time that the drill measures are acceptable, for example when the DR region is one of the three regions that geo-restore excludes, or residency or capacity favours the pair.
- Source: https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore#geo-restore

## Migration from a paired setup

### Recognise today's setup
Today's paired DR of a MySQL flexible server shows in the inventory as one of two things, both on microsoft.dbformysql/flexibleservers resources. This reading rests on properties that the ARM schema defines (see the constraint on the ARM schema); an inventory read that does not return them leaves the server Unknown, and TC-7 reads them. First, a geo-redundant backup: backup.geoRedundantBackup is 'Enabled' on a server and no other server has it as a source (replicationRole 'None'); this is the paired DR by backup, which today means a geo-restore into the pair. Second, a cross-region read replica in the pair: a server with replicationRole 'Replica' (createMode 'Replica') whose sourceServerResourceId is the primary server, in the region that is the pair of the primary's region, while the primary shows replicationRole 'Source'. A replica in a region that is not the pair is already the target of cross-region-replica, and a server with both signals has both. The inventory cannot show the replication lag, the state of the replication (the Replica IO Status and Replica SQL Status metrics do), whether a geo-restore has ever been tried, which regions the application can reach, or the connection strings of the DR deployment. Migration to a DR region that is not the pair is decided per server, by option id, as the option that the runbook fails over to first: cross-region-replica builds a replica in the DR region; geo-restore builds nothing and validates a geo-restore into the DR region; geo-backup-split builds nothing and validates a geo-restore in the pair and the access to it from the DR region. The options can differ across the servers of one workload. On one server the geo-redundant backup stays on whichever option is chosen, because geo-restore and geo-backup-split need it and Learn says to use backups together with the multiregion approaches; what differs per server is the option that the runbook uses first.

### Build
1. cross-region-replica: take the inventory of the source (sku.tier, version, backup.geoRedundantBackup, high availability, the connectivity method and the network it uses, its replicas with their locations, tables without primary keys, the GTID and locked server parameters) and compare the tier with General Purpose or Memory Optimized; a Burstable source can't have a replica, and Learn's pages read give no migration procedure for the tier change, so the platform engineer decides how the source moves to a supported tier.
2. cross-region-replica: set what can't be changed once a replica exists: the locked parameters innodb_file_per_table and log_bin_trust_function_creators, the GTID mode decision (it can't be turned off afterwards without support), and add missing primary keys to the source tables, then do not add AUTO_INCREMENT primary key columns later.
3. cross-region-replica: build the network in the DR region when the source uses private access: a virtual network, a subnet delegated to Microsoft.DBforMySQL/flexibleServers (at least /29, and Learn recommends two addresses per server because HA can be enabled later), a private DNS zone whose name ends with mysql.database.azure.com linked to the virtual network of the DR application tier, and peering between that network and the DR application tier (global peering for a network in another region), and DNS traffic to AzurePlatformDNS not blocked by a network security group (Learn: "you must not block DNS traffic to AzurePlatformDNS using NSG").
4. cross-region-replica: create the replica in the DR region from the Replication page of the source (Add Replica, name, location in the DR region; the Faster Provisioning option boosts IOPS during creation), with compute, vCores and storage equal to or greater than the source, in an off-peak window when the source has no replica yet (Learn's pages differ on a source restart); record the creation time, which depends on the amount of data and the time since the last weekly full backup.
5. cross-region-replica: set the monitoring: an alert on the Replication lag in seconds metric of the replica at the lag alert threshold that the team sets (TC-2; the Estimated RPO of the option is Learn's 1h), alerts on the Replica IO Status and Replica SQL Status metrics, and Service Health alerts for the source's region (Learn says Microsoft doesn't notify you automatically when a region is down).
6. cross-region-replica: put the replica's fully qualified domain name in the DR deployment's configuration as a deployment parameter (not in code and not as an IP address), with retry and exponential backoff, and write the runbook step to enable HA on the promoted server.
7. geo-restore: check backup.geoRedundantBackup on the server: when it is 'Disabled' on a server with locally redundant backup storage, enable geo-redundancy in Compute + Storage; when the server has zone-redundant backup storage, use a point-in-time restore to a server with the wanted configuration or a new server with the data migrated by dump and restore (Learn's two ways); a server whose region shows No in the Geo-redundant backup column of the service's regions table can't be expected to use geo-redundant backup, so check that column for the source's region first, and when it is No this option does not apply to that server.
8. geo-backup-split: check backup.geoRedundantBackup on the server: when it is 'Disabled' on a server with locally redundant backup storage, enable geo-redundancy in Compute + Storage; when the server has zone-redundant backup storage, use a point-in-time restore to a server with the wanted configuration or a new server with the data migrated by dump and restore (Learn's two ways); a server whose region shows No in the Geo-redundant backup column of the service's regions table can't be expected to use geo-redundant backup, so check that column for the source's region first, and when it is No this option does not apply to that server.
9. geo-restore: record the DR region as the restore target after checking that it is a region where the service is available and is not Brazil South, USGov Virginia or West US 3; prepare the DR region for a restore: a virtual network, a delegated subnet and a private DNS zone ending with mysql.database.azure.com when the restored server uses private access, linked to the virtual network of the DR application tier, and the DR deployment's configuration that takes the restored server's name as a parameter.
10. geo-backup-split: record the paired region as the restore target and prepare the pair region for a restore: a virtual network, a delegated subnet and a private DNS zone ending with mysql.database.azure.com when the restored server uses private access, the peering and the private DNS zone link that give the DR application tier a path to it, and the DR deployment's configuration that takes the restored server's name as a parameter.
11. Decide the role that runs the database steps of the Failover and Failback tables (the Database administrator role: promote or stop replication, restore a geo-redundant backup, create replicas, enable high availability and geo-redundant backup, delete servers), assign it to the identity or group of the failover roster on the resource group of the source and on the resource group where the replica or the restored server is created (the target region of the option), and record it in the runbook; the pages read for this playbook name no built-in role for these operations, so the team chooses it.
12. Keep the paired setup in place and go to Validate.

### Validate
1. cross-region-replica: run TC-7 on the source and the replica, then TC-1 once and weekly, and TC-2 for 7 consecutive days.
2. cross-region-replica: run TC-5 from the DR application tier against the replica (read access over the planned private path).
3. cross-region-replica: run TC-3 in a drill in a nonproduction environment (the replica is consumed by the drill), then rebuild the replica and run TC-1 again; run TC-6 on the promoted drill server.
4. geo-restore: run TC-7, then TC-4 as a geo-restore drill into the DR region (Learn says a restore creates a new server from the original server's backups and says nothing about its effect on the source, so run the first drill on a nonproduction copy or outside peak hours), then TC-5 against the restored server and TC-6 on it, and delete the drill server afterwards.
5. geo-backup-split: run TC-7, then TC-4 as a geo-restore drill into the pair region (same caution as for geo-restore), then TC-5 against the restored server and TC-6 on it, and delete the drill server afterwards.
6. Record each result with its date; a time or figure that a drill measured is Demonstrated, and everything else stays Estimated.

### Cut over
1. cross-region-replica: make the replica in the DR region the DR target in the runbook and in the DR deployment's configuration, with the Failover steps for cross-region-replica.
2. geo-restore: put the Failover steps for geo-restore in the runbook, with the DR region as the restore target and the DR deployment's parameter for the restored server's name; no data is moved.
3. geo-backup-split: put the Failover steps for geo-backup-split in the runbook, with the pair region as the restore target and the DR deployment's parameter for the restored server's name; no data is moved.

### Decommission
1. cross-region-replica: after TC-1, TC-2, TC-3, TC-5, TC-6 and TC-7 have passed, delete the read replica in the pair region (Replication page of the source, Delete replica), because it is no longer the DR target; the source and the replica in the DR region are not touched.
2. geo-restore: after TC-4, TC-5, TC-6 and TC-7 have passed, delete a read replica in the pair region if one exists and the runbook no longer uses it, because it is no longer the DR target; the geo-redundant backup stays on.
3. geo-backup-split: nothing is decommissioned, because nothing was built; the geo-redundant backup stays on.

### Keep until cut-over
For cross-region-replica: the replica in the pair region and the runbook steps that use it, until the replica in the DR region has passed the criteria; the geo-redundant backup (backup.geoRedundantBackup 'Enabled') stays for good, as the fallback of the replica (Learn says to use backups together with the multiregion approaches). For geo-restore: the replica in the pair region (if any) and its runbook steps, until TC-4, TC-5 and TC-6 have passed; the geo-redundant backup stays for good. For geo-backup-split: everything that exists today stays for good, which means the geo-redundant backup, the pair-region network that the restore uses and the access validated by TC-4, TC-5 and TC-6; only their validation is new.

## Failover and failback

None of the three options has a Microsoft-managed failover: Learn says that Azure doesn't fail over to read replicas automatically, and the customer triggers the replica promotion and the geo-restore, so the customer can rehearse each of them.

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region or the primary server is unavailable and declare DR for the workload (Microsoft doesn't notify you that a region is down; use Service Health and your own probes) | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time | The primary server answers again before the declaration |
| 2 | cross-region-replica: read the Replication lag in seconds of the replica and the Replica IO Status and Replica SQL Status, and record the lag (when the source is unreachable, take the last recorded value) | Database administrator | Estimated unknown (measured in the first drill) | The lag value and its time are recorded as the data at risk, and the replica is reachable | The replica is not reachable or is not in the DR region: use the geo-restore or geo-backup-split steps of the runbook for this server (the geo-redundant backup stays on as the fallback), else escalate to Azure support |
| 3 | cross-region-replica: stop replication on the replica (Promote on the Replication page of the source, or stop-replication in the CLI), which is irreversible | Database administrator | Estimated 2m (Learn: the backend process typically takes about two minutes) | The former replica is a standalone server that accepts writes and the replication shows as stopped | The primary answers again and the application owner decides within the incident to stay on it: do not promote, because the stop is irreversible; the promotion does not finish within the abort time that the team writes in the runbook as a multiple of the two minutes: open a support request |
| 4 | cross-region-replica: point the application in the DR region to the fully qualified domain name of the former replica (the DR deployment's parameter) and restart it | Application engineer | Estimated unknown (counted in the 30m switch-over target; measured by TC-3) | The application connects with its normal accounts, reads and writes succeed, and a canary row written now is read back | Connections fail: check the network path and the private DNS zone link (TC-5), then the accounts; do not go back to the old source |
| 5 | cross-region-replica: enable high availability on the promoted server (it has none) and the backup settings the primary had | Database administrator | Estimated unknown (Learn gives no duration for enabling HA on a promoted server) | HA shows as enabled and healthy on the promoted server, and its backup redundancy and retention are as planned | HA can't be enabled (tier or region): run without HA and record the gap with the application owner |
| 6 | geo-restore: start the geo-restore of the source from its most recent geo-redundant backup (Geo-redundant restore in the portal, or az mysql flexible-server geo-restore with the location) into the DR region; Learn's rule to restore as a locally redundant server while the primary region is down is stated for the geo-paired region only, so use the restore settings as the portal offers them for the DR region and, if the restore can't be created with geo-redundant storage, retry with geo-redundancy disabled (this retry is the playbook's inference, not Learn's); set the networking of the restored server | Database administrator | Estimated unknown (Learn: depends on database size, transaction log size, network bandwidth and concurrent restores in the region; measured by TC-4) | The restored server reaches the ready state, and the newest canary transaction in it is not older than one hour before the outage | The restore fails or runs past the recovery time that the team measured in the drill: open a support request and keep the application in its degraded mode |
| 7 | geo-backup-split: start the geo-restore of the source from its most recent geo-redundant backup (Geo-redundant restore in the portal, or az mysql flexible-server geo-restore with the location) into the pair region; when the primary region is down, restore as a locally redundant server by disabling geo-redundancy in the restore settings (Learn states this for the geo-paired region); set the networking of the restored server | Database administrator | Estimated unknown (Learn: depends on database size, transaction log size, network bandwidth and concurrent restores in the region; measured by TC-4) | The restored server reaches the ready state, and the newest canary transaction in it is not older than one hour before the outage | The restore fails or runs past the recovery time that the team measured in the drill: open a support request and keep the application in its degraded mode |
| 8 | geo-restore: check the post-restore tasks of Learn on the restored server: the virtual network rules (Learn: not copied from the original server), the firewall rules, the logins and database-level permissions, and the alerts; note that the server is non-HA after the restore, and decide with the application owner whether to enable HA now (Learn: an existing server changes to zone-redundant HA only by migrating to a new server); do not enable geo-redundancy now: Learn gives no rule for a region that is not the pair, so waiting for the primary region is the playbook's precaution (an inference) | Database administrator | Estimated unknown (measured in the first drill) | The DR application tier reaches the restored server over the planned path, a login of the application succeeds, and the alerts exist | A login or rule is missing: create it from the runbook before the application is started |
| 9 | geo-backup-split: check the post-restore tasks of Learn on the restored server: the virtual network rules (Learn: not copied from the original server), the firewall rules, the logins and database-level permissions, and the alerts; note that the server is non-HA after the restore, and decide with the application owner whether to enable HA now (Learn: an existing server changes to zone-redundant HA only by migrating to a new server); do not enable geo-redundancy now: Learn says that while the primary region is down geo-redundant servers can't be provisioned in the geo-paired region and to wait for the primary region | Database administrator | Estimated unknown (measured in the first drill) | The DR application tier reaches the restored server over the planned path, a login of the application succeeds, and the alerts exist | A login or rule is missing: create it from the runbook before the application is started |
| 10 | geo-restore: point the DR application tier to the restored server's fully qualified domain name (the new name of the restore) and start it | Application engineer | Estimated unknown (measured by TC-4 and TC-5) | The application reads and writes, and a canary row written now is read back | Reads or writes fail: stop the application and check the network path, then the accounts |
| 11 | geo-backup-split: point the DR application tier to the restored server's fully qualified domain name (the new name of the restore) and start it | Application engineer | Estimated unknown (measured by TC-4 and TC-5) | The application reads and writes, and a canary row written now is read back | Reads or writes fail: stop the application and check the network path, then the accounts |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region is available again and decide whether the data written in DR must be brought back or the loss of the DR changes is accepted | Incident manager | Estimated unknown (measured in the first drill) | The decision and its time are recorded | The primary region is still impaired: stay in DR |
| 2 | cross-region-replica: create a new read replica in the primary region from the promoted server in the DR region (the old source is not made a replica again; it is deleted or kept as the application owner decides) | Database administrator | Estimated unknown (Learn: the creation time depends on the data and the time since the last weekly full backup, from a few minutes to several hours) | The new replica reports replicationRole Replica with the promoted server as source, and its lag is falling | The replica can't be created: stay in DR and use a dump with mysqldump to copy the data back, as the application owner decides |
| 3 | cross-region-replica: take the application offline and wait for the replication to catch up (downtime of about the replication lag), or accept the loss of unreplicated data | Application engineer | Estimated unknown (Learn: about the replication lag when the application is offline) | The Replication lag in seconds of the new replica is 0 and a canary row written last in DR is on the replica | The lag doesn't fall: keep the application on the DR server |
| 4 | cross-region-replica: stop replication on the new replica in the primary region and point the application to it | Database administrator | Estimated 2m (Learn: stopping replication typically takes about two minutes) | The server in the primary region accepts writes and the application reads and writes through its address | The application can't write: point the application back to the DR server (still the primary of the data) |
| 5 | cross-region-replica: enable high availability on the server in the primary region, and build a new replica in the DR region (the Build steps that create the replica in the DR region and set its monitoring) | Database administrator | Estimated unknown (measured in the first drill) | HA is enabled, and TC-1 passes again for the new replica | The new replica can't be built: record the gap in DR coverage and fix it before the next outage |
| 6 | geo-restore: bring the data back to the primary region: create a read replica of the restored server in the primary region (this means the restored server is a source like any other General Purpose or Memory Optimized server, as an inference from Learn's replica rules), wait for the lag to reach 0 with the application offline, stop replication and point the application to it; when no replica is possible, copy the data with mysqldump | Database administrator | Estimated unknown (depends on the data volume; measured in the first drill) | The server in the primary region holds the data of the DR period (row counts and a canary row compare equal) and the application reads and writes there | The data doesn't compare equal: keep the application on the restored server |
| 7 | geo-backup-split: bring the data back to the primary region: create a read replica of the restored server in the primary region (this means the restored server is a source like any other General Purpose or Memory Optimized server, as an inference from Learn's replica rules), wait for the lag to reach 0 with the application offline, stop replication and point the application to it; when no replica is possible, copy the data with mysqldump | Database administrator | Estimated unknown (depends on the data volume; measured in the first drill) | The server in the primary region holds the data of the DR period (row counts and a canary row compare equal) and the application reads and writes there | The data doesn't compare equal: keep the application on the restored server |
| 8 | geo-restore: once the primary region is up again, enable geo-redundant backup on the server in the primary region (Learn: a locally redundant server moves to geo-redundant storage by enabling geo-redundancy in Compute + Storage), then delete the restored server after the retention decision of the application owner | Database administrator | Estimated unknown (measured in the first drill) | backup.geoRedundantBackup is 'Enabled' on the primary server | The primary server can't use geo-redundant backup (tier or region): record the gap |
| 9 | geo-backup-split: once the primary region is up again, enable geo-redundant backup on the server in the primary region (Learn: a locally redundant server moves to geo-redundant storage by enabling geo-redundancy in Compute + Storage), then delete the restored server after the retention decision of the application owner | Database administrator | Estimated unknown (measured in the first drill) | backup.geoRedundantBackup is 'Enabled' on the primary server | The primary server can't use geo-redundant backup (tier or region): record the gap |

## Test criteria

### TC-1: The replica in the DR region replicates and is built as planned
- Applies to: cross-region-replica
- Pass condition: the replica exists in the DR region with replicationRole 'Replica' and sourceServerResourceId equal to the source's, its Replica IO Status and Replica SQL Status metrics show the replication running, its vCores, storage and compute tier are equal to or greater than the source's, and the number of replicas of the source does not exceed 10.
- How to measure: read the properties of the source and the replica with a read-only query or in the portal (Replication page, Metrics), compare the sizes, and read the two replication status metrics of the replica in Azure Monitor.
- Evidence: the property export and the metric values with their date, and the comparison of the two sizes.
- Frequency: weekly, and after every change to the source's size

### TC-2: The replication lag is monitored against an alert threshold
- Applies to: cross-region-replica
- Pass condition: for 7 consecutive days the maximum of the Replication lag in seconds metric of the replica stays below the lag alert threshold that the team sets (Estimated, team-set starting value 15m; a monitoring threshold, not the Estimated RPO of the option, which is Learn's 1h), an alert on that threshold exists and fires on a test, and the highest lag measured is recorded as the Demonstrated lag against the Estimated RPO of 1h.
- How to measure: export the Replication lag in seconds metric of the replica with its maximum per day from Azure Monitor, and test the alert by lowering its threshold for a short time.
- Evidence: the 7-day export with the daily maximum, the alert rule and the test record.
- Frequency: before cut-over, then monthly; the alert runs permanently

### TC-3: A promotion drill finishes within the Estimated RTO
- Applies to: cross-region-replica
- Pass condition: in a drill in a nonproduction environment (the promotion is irreversible and consumes the replica), the time from the start of the stop replication to the first successful write of the application in the DR region, with HA enabled on the promoted server, is within the Estimated RTO of the option (30m), and the lag recorded at the stop is within the Estimated RPO (1h).
- How to measure: record the lag, start the stop replication, time each step of the Failover table, change the DR deployment's parameter to the promoted server's address, write a canary row and read it back, enable HA, and note the end time.
- Evidence: the drill record with its timestamps per step, the lag at the stop and the measured total.
- Frequency: before cut-over, then every 6 months and after a change to the application's way of connecting

### TC-4: A geo-restore recovers the data within the recovery point
- Applies to: geo-restore, geo-backup-split
- Pass condition: backup.geoRedundantBackup is 'Enabled' on the source, a geo-restore into the target region (the DR region for geo-restore, the pair region for geo-backup-split) creates a server that reaches the ready state, the newest canary transaction in it is not older than one hour before the drill started (the up to one hour of data loss that Learn names), the row counts of the checked tables equal those of the source at that time, and the elapsed time from the start of the restore to the ready state is recorded as the demonstrated recovery time and is within the Estimated RTO of the option (12h, a team-set starting value that the first drill confirms or replaces).
- How to measure: write a canary row to the source every minute during the drill, start a geo-restore of the source to the target region (portal Geo-redundant restore or az mysql flexible-server geo-restore), time it, and compare the newest canary row and the row counts with the source.
- Evidence: the drill record with the target region, the start and ready times, the canary comparison, the row counts and the deletion of the drill server.
- Frequency: before cut-over, then every 6 months

### TC-5: The DR application tier reaches the DR server over the planned path
- Applies to: cross-region-replica, geo-restore, geo-backup-split
- Pass condition: from the DR application tier the fully qualified domain name of the replica (or of the drill-restored server) resolves to its private IP address when the source uses private access, a connection with an application account succeeds within the latency bound that the team sets and records with the probe, and a read of a canary table returns rows; for cross-region-replica the connection is read-only until promotion.
- How to measure: a scheduled probe in the DR application tier resolves the name, connects with an application account and reads a canary table, recording result, resolved address and latency; for geo-restore and geo-backup-split the probe runs during the TC-4 drill.
- Evidence: the probe log with date, resolved address, latency and the account used.
- Frequency: the probe daily for cross-region-replica; for geo-restore and geo-backup-split in each TC-4 drill and after every change to the network of the target region or the DR application tier

### TC-6: The promoted or restored server is configured like the primary
- Applies to: cross-region-replica, geo-restore, geo-backup-split
- Pass condition: on the promoted drill server or the restored drill server, the HA state is as the runbook decided (enabled on a promoted server; on a restored server enabled, or recorded as a gap by the application owner), the server parameters time_zone and event_scheduler are compared with the primary's and every difference is listed (Learn says in its point-in-time restore section that these two reset to defaults after a restore and doesn't say whether this holds for a geo-restore or a promoted replica, so the drill checks them), the backup retention is as planned and the backup redundancy equals the one chosen in the restore settings and recorded in the runbook, the application's logins and database-level permissions exist, and the alerts of the runbook exist.
- How to measure: compare the server parameters, the HA state, the backup settings and the accounts of the drill server with the primary's with read-only queries, and list the alert rules.
- Evidence: the comparison report with its date and the list of differences, each with its decision.
- Frequency: in each TC-3 and TC-4 drill, and after every change to the primary's parameters or accounts

### TC-7: The source and the DR region meet the prerequisites
- Applies to: cross-region-replica, geo-restore, geo-backup-split
- Pass condition: design check, not drillable as one measurement, with a measured part. For cross-region-replica, sku.tier of the source is 'GeneralPurpose' or 'MemoryOptimized' and the DR region is in the service's list of regions; for geo-restore, the Geo-redundant backup column of the service's regions table is Yes for the source's region, backup.geoRedundantBackup is 'Enabled', sku.tier is a tier that Learn lists for geo-redundant backup, and the DR region is a region where the service is available other than Brazil South, USGov Virginia and West US 3 (no pair of the primary is needed for the DR region); for geo-backup-split the same checks, plus the source's region has a geo-paired region, which is the target; for cross-region-replica, no table of the source lacks a primary key, and for every option the DR region network (delegated subnet, private DNS zone ending with mysql.database.azure.com and its link) exists as planned when the server uses private access.
- How to measure: a scheduled read-only query of the sku.tier, backup.geoRedundantBackup and replicationRole properties of every server of the workload (when the inventory read doesn't return one of them, the server is Unknown), a query of the tables without primary keys on the source, and a review of the DR network resources.
- Evidence: the query output and the review record with their date.
- Frequency: monthly, and after every change to the source's tier or backup settings
