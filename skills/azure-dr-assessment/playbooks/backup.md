---
service: backup
title: Azure Backup
arm_types:
  - microsoft.recoveryservices/vaults
  - microsoft.dataprotection/backupvaults
slot: backup
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-backup
  - https://learn.microsoft.com/en-us/azure/backup/backup-create-recovery-services-vault
  - https://learn.microsoft.com/en-us/azure/backup/backup-vault-overview
  - https://learn.microsoft.com/en-us/azure/backup/backup-azure-arm-restore-vms
  - https://learn.microsoft.com/en-us/azure/backup/backup-support-matrix
  - https://learn.microsoft.com/en-us/azure/backup/backup-azure-backup-faq
  - https://learn.microsoft.com/en-us/azure/backup/backup-rbac-rs-vault
  - https://learn.microsoft.com/en-us/azure/backup/manage-backup-vault
  - https://learn.microsoft.com/en-us/azure/backup/private-endpoints
  - https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/relocation/relocation-backup
---

# Azure Backup

## Mechanisms

### Geo-redundant storage (GRS) of a vault
- Replicates: data (the backup copies and recovery points that the vault holds), asynchronously from the primary region to the paired region, where the secondary copy is held in locally redundant storage; the vault is a Recovery Services vault or a Backup vault, and in both the redundancy is chosen for the vault
- Paired: yes
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: 36h (Learn: for a region outage "expect up to 36 hours of data loss because the RPO in the primary region is 24 hours, and it can take up to 12 hours to replicate the backup data from the primary to secondary region"; the figure depends on the backup schedule)
- Estimated RTO: unknown (Learn: without Cross Region Restore the data in the secondary region is available to restore only if Azure declares a disaster in the primary region, which Microsoft "typically declares ... only after an extended period of time"; Learn names Microsoft as responsible for declaring it and publishes no figure)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-backup#geo-redundant-storage-and-cross-region-restore

### Cross Region Restore (CRR)
- Replicates: nothing of its own: it is a setting of a GRS vault that lets the customer start a restore from the secondary region recovery points, and Microsoft upgrades the vault's storage from GRS to read-access geo-redundant storage (RA-GRS) when it is on
- Paired: yes
- Nonpaired: no
- Failover: customer-managed
- Estimated RPO: 36h (Learn: for a region outage "expect up to 36 hours of data loss because the RPO in the primary region is 24 hours, and it can take up to 12 hours to replicate the backup data from the primary to secondary region"; the figure depends on the backup schedule)
- Estimated RTO: unknown (Learn: with CRR "the RTO for initiating the restoration of backups already replicated to the paired region is zero"; no figure is published for the restore itself, so TC-2 measures it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-backup#cross-region-restore

### Zone-redundant storage (ZRS) of a vault
- Replicates: data (the backup copies), synchronously across availability zones of the vault's own region; it does not reach another region
- Paired: no
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: 0 (Learn: "for a zone outage, no loss of backed-up data is expected because all data is replicated synchronously across zones")
- Estimated RTO: unknown (Learn: a few seconds of downtime for the Backup service for data sources in healthy zones, and "the RTO is undefined" for data sources in the failed zone)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-backup#resilience-to-availability-zone-failures

## Constraints

### A vault protects only data sources of its own region
Learn says "Your data sources must be located in the primary region. You can't configure backups to a vault in another region", and the support matrix says "You need a vault in every Azure region that contains VMs you want to back up. You can't back up to a different region." So the vault of a DR region protects the data sources that run in that region, and a vault in the primary region cannot protect a workload that runs in the DR region.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-support-matrix#vault-support

### Geo-redundant storage reaches paired regions only
Learn marks "GRS for Backup only works within paired Azure regions": backups are replicated to the Azure paired region of the vault's region. A vault in a region whose DR region is not its pair therefore has no vault-level replication to the DR region.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-backup#resilience-to-region-wide-failures

### Backups cannot be copied or moved to a vault in another region
Learn's FAQ says "Backup data stored in a vault can't be moved to a different vault", and, for restore points, that moving snapshots to a different region with the VM restore point APIs "isn't supported for Vault-tier recovery points". The recovery points of a vault therefore stay in that vault and its pair; as an inference, none can be carried to a vault in a nonpaired DR region.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-azure-backup-faq#can-i-copy-restore-points-created-by-the-azure-backup-service-portal-from-one-region-to-another

### A relocated workload needs a vault and a new protection in the new region
Learn's relocation guidance says Azure Backup "doesn't support the relocation of backup data from one Recovery Services vault to another" and that to continue to protect the resources "you must register and back them up to a Recovery Services vault in the new region". When a protected VM is moved to another region it can no longer be backed up to the older vault, and the backups in the old vault might start failing with the errors BCMV2VMNotFound or ResourceNotFound. After the move the data in the old vault can be kept or deleted, and kept data incurs backup charges; when protection is stopped with retained data, the recovery points remain and "don't adhere to any policy". This is Learn's relocation procedure for a permanent move. The playbook applies it to the DR region as an inference: a workload that runs in the DR region is protected by a vault of that region.
- Source: https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/relocation/relocation-backup

### Storage redundancy is fixed before the first backup, and CRR cannot be turned off
For a Recovery Services vault the storage redundancy must be configured before any workload is protected ("After you protect a workload, the setting is locked and you can't change it"), and for a Backup vault it is configured when the vault is created and then locked. ZRS and GRS must be configured on new vaults "before the first backup". Learn's way to get ZRS on an existing vault is a new vault with the workloads reassigned, which needs downtime. CRR can be enabled on existing GRS vaults and, once enabled, cannot be disabled ("After you enable CRR, you can't disable it").
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-backup#configure-multiregion-support

### Cross Region Restore is for GRS Recovery Services vaults
Cross Region Restore "is supported only for a Recovery Services vault that uses the GRS replication type". Learn also says it "currently can't be reverted to GRS or LRS after the protection starts for the first time" and that it "incurs extra charges for use". For a move from GRS to LRS after a backup is configured Learn gives two choices: delete the current protection and data in the GRS vault (destructive, after disabling soft delete) and reconfigure the backups in a new LRS vault, or stop protection with retained data and protect in the new LRS vault, where the retained recovery points in the GRS vault are paid for and restorable only while unexpired.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-create-recovery-services-vault#set-cross-region-restore

### Replication to the secondary region lags, and CRR items appear late
Backups complete in the primary region first and are then replicated asynchronously to the secondary region, which "can take up to 12 hours". After CRR is turned on, backup items "can take up to 48 hours to be available in the secondary region". So a vault that has just been given CRR cannot be restored from the secondary region at once.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-backup#cross-region-restore

### Without CRR the secondary data is restorable only after Microsoft declares a disaster
When CRR is not enabled, or the data source does not support it, the data in the secondary region "is available to restore in the secondary region only if Azure declares a disaster in the primary region. Microsoft is responsible for declaring a disaster", which it "typically" does "only after an extended period of time". Learn describes no way for the customer to start, bring forward or rehearse that declaration, so, as an inference, the declaration cannot be drilled.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-backup#behavior-during-a-region-failure

### CRR covers listed workload types only
Learn lists the management types that support Cross Region Restore: Azure VMs (including encrypted VMs) that use managed disks, but not VMs on classic deployment or unmanaged-disk legacy recovery points; SQL Server and SAP HANA databases in Azure VMs; Azure file shares; PostgreSQL; and the MARS agent in preview (not for vaults with a private endpoint). DPM and MABS are listed as not supported. The page lists no Azure Disks or Azure Blobs vaulted backup for Cross Region Restore, so, as an inference, those data sources are left to the Microsoft-declared-disaster path or to the DR-region vault.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-support-matrix#cross-region-restore

### Backup vaults: CRR is documented for PostgreSQL
For Backup vaults, Learn's Backup vault overview says Cross Region Restore is available for PostgreSQL backups protected in Backup vaults, and that such a vault is automatically charged at RA-GRS rates for those backups. It also says that, when backups are enabled with GRS, the backups in the secondary region become accessible only when Microsoft declares an outage in the primary region, unless CRR is used.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-vault-overview#cross-region-restore-support-for-postgresql-using-azure-backup

### Backup vault CRR is stated for PostgreSQL servers only
The Manage Backup vaults article enables CRR in the Backup vault properties ("Properties > Cross Region Restore > Enable") and notes "Cross Region Restore is currently only available for PostgreSQL servers". For the other Backup vault data sources, Azure Disks and Azure Blobs, Learn's page therefore gives no CRR; as an inference, they rely on the vault's GRS and the Microsoft-declared disaster, or on a vault in the DR region.
- Source: https://learn.microsoft.com/en-us/azure/backup/manage-backup-vault#perform-cross-region-restore-using-azure-portal

### Snapshot-tier restore points of VMs are not replicated
For Azure VM backups Learn says that during the backup "snapshots aren't replicated to the secondary region. Only the data stored in the vault is replicated", so secondary region restores are only vault-tier restores.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-azure-arm-restore-vms#restore-options

### Azure file share snapshots stay in the source storage account
For Azure file shares, the vault's storage replication settings "aren't relevant for Azure file share snapshot backup because the snapshots are stored in the same storage account as the backed-up file share"; they apply only to Azure file share vaulted backup. The protection of the share's snapshots in a DR region therefore follows the replication of the storage account (see the storage-account playbook), and the vault's redundancy covers only vaulted backups: this is an inference from the quoted sentence.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-create-recovery-services-vault#set-storage-redundancy

### Operational tier backups are stored outside the vault
Some data sources support operational tier backups, which "store data in another location rather than in the vault": Azure managed disks backup and AKS backups store them in disk snapshots. The vault's redundancy does not describe where those copies are held.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-backup#physical-architecture

### An Azure VM CRR restore goes to the secondary region only, with staging and roles in that region
For Azure VMs, Learn says "only support for restoring secondary region data to a secondary region is allowed". The staging location (the storage account) must be in the region that the vault treats as the secondary region; the virtual network settings of the secondary region must be provided when disks are restored in a template; the roles needed are the same as in the primary region; a CRR restore job "once triggered, can't be canceled"; Cross Region Restore is not supported with managed identities; the Replace existing disks option is not supported; and VHDs aren't created when the source VM has more than 16 disks. A customer-managed-key VM that wasn't backed up in a customer-managed-key vault is restored in the secondary region as a VM without customer-managed keys.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-azure-arm-restore-vms#cross-region-restore

### The CRR restore needs a role at the subscription of the vault
For Azure VM backup Learn's minimum-role table lists, for Cross Region Restore, Backup Operator on the subscription of the Recovery Services vault, "in addition of the restore permissions mentioned above", or a custom role that holds the Microsoft.RecoveryServices/locations backupAadProperties, backupCrrJobs, backupCrrJob, backupCrossRegionRestore, backupCrrOperationResults and backupCrrOperationsStatus permissions. The restore permissions it refers to for Restore VM are Backup Operator on the Recovery Services vault, Contributor on the resource group in which the VM is deployed, Virtual Machine Contributor on the source VM that was backed up, and Storage Account Contributor on the storage account where disks are restored. To enable backup of an Azure VM the table lists Backup Operator on the resource group that contains the vault and Virtual Machine Contributor on the VM resource; on-demand backup needs Backup Operator on the vault. Backup Contributor is listed for creating a vault, creating, modifying and deleting policies, stopping backup (retain or delete data) and disabling immutability on a vault.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-rbac-rs-vault#minimum-role-requirements-for-azure-vm-backup

### CRR is not supported when public network access to the vault is denied
Learn explains that Cross Region Restore replicates data with GRS with CRR enabled and that, when public access is denied and a private endpoint is used, replication would need a private endpoint in the secondary region, which "currently doesn't support" the configuration. CRR is therefore "not supported when Public Network access is set to Deny".
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-azure-backup-faq#why-is-cross-region-restore-not-supported-when-public-network-access-is-set-to-deny

### Private endpoints need DNS records, links and identity permissions
For a Recovery Services vault with private endpoints (the v1 experience Learn documents), the vault needs a managed identity enabled before the endpoints are created, and the DNS records are needed for the three services Backup, Blobs and Queues. When the private endpoint is integrated with Azure private DNS zones, Azure Backup adds the records, the vault's managed identity needs permission to add DNS records in the zone, and the virtual network that holds the resources to back up must be linked to all three private DNS zones. With a custom DNS server, conditional forwarders redirect the names to Azure DNS (168.63.129.16). Learn says to follow its steps in order, because otherwise the vault can be left incompatible with private endpoints and a new vault is needed.
- Source: https://learn.microsoft.com/en-us/azure/backup/private-endpoints#manage-dns-records

### Customer-managed keys of a Recovery Services vault
By default the data in a Recovery Services vault is encrypted with platform-managed keys. To use a customer-managed key, "you must specify the encryption key before any item is added to this vault" and, once enabled, the encryption with your key "can't be reversed". The steps are: enable a managed identity for the vault, assign permissions to the vault to access the key in Azure Key Vault, enable soft delete and purge protection in Key Vault, and assign the key to the vault.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-create-recovery-services-vault#set-encryption-settings

### Customer-managed keys of a Backup vault do not use the vault's managed identity
For a Backup vault Learn offers Microsoft-managed keys (the default) and customer-managed keys under Encryption settings, and says "Azure Backup service uses the Backup Management Service app to access Azure Key Vault, but not the managed identity of the Backup vault". The managed identity steps of a Recovery Services vault therefore do not carry over to a Backup vault, and this page gives no key-access procedure for it.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-vault-overview#encryption-settings-in-the-backup-vault

### The vault types protect different data sources
Learn's FAQ lists Recovery Services vault for Azure VMs, SQL in Azure VMs, Azure Files, SAP HANA in Azure VMs, Azure Backup Server, the Azure Backup agent and DPM, and Backup vault for Azure Disks, Azure Blobs, Azure Database for PostgreSQL servers and Kubernetes services (preview), and says "You need to create the appropriate vault based on the datasource type that you want to protect". Check the FAQ table against the data source at hand, because the list changes as Backup adds data sources.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-azure-backup-faq#what-are-the-various-vaults-supported-for-backup-and-restore

### No backup job runs while the vault's region is offline
When the primary region is offline, "no backup jobs can run" there: you can restore data in the vault but "can't add new data". The customer is responsible for restoring to infrastructure in the paired region and for reconfiguring load balancers, clients and other systems. When the primary region recovers, Backup automatically restores operations and jobs resume. Microsoft does not notify the customer automatically that a region is down; Resource Health and Service Health alerts are Learn's way to be told.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-backup#behavior-during-a-region-failure

### Soft delete and immutable vaults protect backups
Soft delete lets you recover deleted objects and vaults during a configurable retention period, 14 days by default and editable. Immutable vaults block operations that might lead to loss of recovery points, and the immutable setting can be locked to make it irreversible. A vault in the DR region needs these settings chosen for it, so the DR copy of the backups is no easier to delete than the primary's (this means that a decommission of a vault follows its retention and immutability settings).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-backup#resilience-to-loss-of-backup-data

### Cross Subscription Restore works with Cross Region Restore for Azure VMs
Cross Subscription Restore restores managed Azure VMs or disks to another subscription of the same tenant, subject to Azure RBAC; it works with Cross Region Restore. Vault-tier recovery points can be restored in the protected VM's subscription or the vault's subscription, and to any other subscription only when the property is enabled on the Recovery Services vault; snapshot-tier recovery points can be restored only in the protected VM's subscription.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-azure-arm-restore-vms#restore-options

## Non-paired options

### dr-region-vault: A vault in the DR region that protects the workloads running there
- Kind: workaround
- Target: dr-region
- Uses mechanism: none
- Estimated RPO: 24h (Learn: the primary region RPO is up to 24 hours with the Standard policy, https://learn.microsoft.com/en-us/azure/backup/backup-create-recovery-services-vault, and the support matrix lists one backup a day for Azure VMs; this is the interval of a workload protected in the DR region on that schedule; for other data sources and for another policy the team sets the schedule, and TC-3 proves it; the option holds no recovery points of the primary, so the pre-disaster history is not part of this figure)
- Estimated RTO: 4h (Estimated, team-set starting value: the time the team sets from the workload running in the DR region to protection enabled and a first recovery point in the DR vault, since Learn publishes no figure for it; TC-3 proves it; the restore time itself is measured by TC-4 because Learn gives no figure)
- Prerequisites: one vault of the right type for each data source type, in the DR region (a Recovery Services vault for Azure VMs, SQL Server and SAP HANA in Azure VMs and Azure Files, a Backup vault for Azure Disks, Azure Blobs and PostgreSQL; see the Constraints on the vault types and on the vault's region); the redundancy chosen when the vault is created, because it is locked afterwards (ZRS where the DR region supports it, otherwise LRS; GRS would copy the DR vault's backups to the DR region's own pair and is chosen only when that is wanted); customer-managed key encryption, when the primary vault uses it, set up per vault type (see the two Constraints on customer-managed keys: a Recovery Services vault needs it before any item is added, with a managed identity, access to the key and soft delete and purge protection on the key vault; a Backup vault does not use its managed identity for the key; the key vault's own DR is the key-vault playbook's subject); the primary vault's policies, soft delete retention, immutability, network firewall, alert notifications and diagnostic settings recreated in the DR vault; for private access, the private endpoints, the DNS records for Backup, Blobs and Queues and the links from every DR virtual network to the three private DNS zones, built in Learn's order (see the Constraint on private endpoints); for the DR operations identity (the backup operator of the tables), Backup Operator on the resource group that contains the DR vault and on the vault, and Virtual Machine Contributor on each VM to protect, to enable backup of Azure VMs, and for a restore Contributor on the target resource group, Virtual Machine Contributor on the source VM and Storage Account Contributor on the staging account (see the Constraint on the roles), plus Backup Contributor on the DR vault (policies, stop protection) for the backup administrator of the Failback table; for a Backup vault, the roles of the vault's managed identity on the source resources (Learn's Backup vault overview: RBAC is enforced through the vault's managed identities, and the identity that creates a backup instance needs read permission on the source); for each workload an agreed way to exist in the DR region (replica, redeploy or the workload's own DR option), because a cold standby has nothing to protect until it runs.
- Cost notes: a second vault and the backup storage it consumes, the backup instances for the workloads protected in DR, the private endpoints and DNS zones, and the retained recovery points of the primary vault while they are kept (see the Constraint on relocation: kept data incurs backup charges); no price.
- Gives up: the history of the primary vault in the DR region (a vault holds only its own region's data sources, and Learn describes no way to move recovery points to another vault, so the history stays in the primary vault and its pair); a cold-standby workload has no backup until it runs; a restore of old data in a nonpaired DR region has no Backup feature, because Cross Region Restore reaches the pair only.
- Recommended when: the DR region is not the primary's pair, the workloads run or can be started in the DR region, and the recovery of the backups of the primary's history is covered by the primary vault's own redundancy (GRS with CRR to the pair) or accepted as a gap.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-support-matrix#vault-support

### cross-region-restore-split: Restore from the pair region with Cross Region Restore
- Kind: split-region
- Target: pair-region
- Uses mechanism: Cross Region Restore (CRR)
- Estimated RPO: 36h (Learn: for a region outage "expect up to 36 hours of data loss because the RPO in the primary region is 24 hours, and it can take up to 12 hours to replicate the backup data from the primary to secondary region"; the figure depends on the backup schedule)
- Estimated RTO: 24h (Estimated, team-set starting value for the restore itself: Learn says with CRR "the RTO for initiating the restoration of backups already replicated to the paired region is zero" and publishes no figure for the restore; TC-2 proves it for the team's data size)
- Prerequisites: a GRS vault (a Recovery Services vault, or a Backup vault for PostgreSQL) with CRR enabled, which can be done on an existing GRS vault and not undone; data sources of a type that Learn lists for CRR (see the Constraints on the supported types), on a vault whose public network access is not denied; for the restore operators (the backup operator of the tables) Backup Operator on the vault and on the vault's subscription (or the custom CRR role), Contributor on the target resource group, Virtual Machine Contributor on the source VM and Storage Account Contributor on the staging storage account (see the Constraint on the roles); in the pair region a resource group, a virtual network with a subnet and a staging storage account (it must be in the vault's secondary region), the permission to create the restored resources, and the DNS and private access for what is restored; a network path from the DR region's virtual networks to the restore virtual network of the pair (global virtual network peering or a hub-and-spoke network), with the private DNS zone links of the DR region's networks, so that the workloads running in the DR region reach what is restored in the pair; a vault in the pair region if the restored workloads are to be backed up while they run there (a vault protects data sources of its own region).
- Cost notes: the vault's move from GRS to RA-GRS (CRR is charged at a different rate; see the Constraints on CRR), the secondary-region storage and replication, and the resources created by a drill or a restore; no price.
- Gives up: a restore target in the DR region (the restore goes to the pair only, and Learn describes no Backup feature that carries the restored resource on to another region, so, as an inference, any onward copy uses another service); the workload runs in the pair, not in the DR region; up to 36 hours of data loss; data sources that don't support CRR wait for Microsoft to declare a disaster; vaults with public network access denied have no CRR; and the CRR setting cannot be switched off.
- Recommended when: residency allows the pair region for restored data, the data sources support CRR, the vault is already GRS or can be created as GRS, and a recovery point up to 36 hours old is acceptable.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-backup#cross-region-restore

## Migration from a paired setup

### Recognise today's setup
Today's paired setup shows in an inventory as a vault in the primary region with the storage replication type Geo-redundant (Learn: GRS is the default for a Recovery Services vault) and, where it is enabled, the Cross Region Restore setting on the vault's properties, and the backup items protecting data sources in that same region. A Backup vault shows its redundancy and, for PostgreSQL, its Cross Region Restore state. No vault exists in the DR region. The inventory also shows the network access of the vault: public network access denied means no Cross Region Restore. The inventory cannot show whether Microsoft's replication is current, whether a restore from the secondary region has ever worked, whether the vault settings alone say which recovery points are vault tier and which are snapshot tier only (the tier is read per backup item, as the Build step that takes the inventory per vault does), and what the secondary region restore will cost in time. Record today's DR as the GRS replica with the Microsoft-declared disaster when CRR is off, as GRS with Cross Region Restore when it is on, and as Unknown when the inventory shows neither. Migration to a DR region that is not the pair is decided per workload by option id: dr-region-vault builds a vault in the DR region and does not change the primary vault; cross-region-restore-split builds no new vault and validates that CRR works into the pair. The two work together on one workload: the primary vault stays GRS with CRR (the paired copy), and the DR vault protects what runs in the DR region.

### Build
1. Take the inventory per vault: vault type, region, storage replication type, CRR state, public network access, soft delete and immutability settings, encryption (platform or customer-managed key), policies (schedule and retention), and per backup item the data source type, whether CRR supports it, the tier of its recovery points and the owner of the workload; TC-1 and TC-5 compare against this inventory.
2. dr-region-vault: decide for each workload how it exists in the DR region and from when it can be protected: a workload that already runs there (a replica, an active second site) is protected from the start; a cold standby is protected only after it is started, which is a Failover step.
3. dr-region-vault: create the vault of the right type in the DR region (Recovery Services vault or Backup vault), with a unique name, the redundancy that the option's Prerequisites name (set now, as it is locked after the first backup), and the same tags and Azure Policy assignments as the primary. For a vault that must reproduce a primary vault, export a template of the primary vault, check its private endpoint, backup policy and security settings, and change the name, replication type, version and target location parameters (Learn's relocation start).
4. dr-region-vault: set encryption before any item is added: platform-managed keys by default. For a Recovery Services vault with customer-managed keys, enable a managed identity on the vault, give it access to the key, enable soft delete and purge protection in Key Vault and assign the key (it cannot be reversed afterwards). For a Backup vault with customer-managed keys, set the key under Encryption settings of the vault; Learn says the Backup Management Service app, not the vault's managed identity, accesses Key Vault, and the page read gives no procedure, so check Learn's customer-managed key article for Backup vaults before the build.
5. dr-region-vault: recreate the primary's policies, soft delete retention, immutability setting, network firewall, alert notifications, workbook and diagnostic settings; send the vault's diagnostics to a log workspace, set Resource Health and Service Health alerts on the DR vault and on the primary vault, and alert on a failed or missing backup job.
6. dr-region-vault: build private access when the primary uses it (Learn's steps are for a Recovery Services vault): enable a managed identity on the vault, create the private endpoints in the DR virtual network, let Azure Backup add the DNS records in the private DNS zones (give the vault's identity permission to add them), link the DR virtual networks to the three private DNS zones (Backup, Blobs, Queues), and for a custom DNS server add conditional forwarders to Azure DNS; follow Learn's order of steps.
7. dr-region-vault: grant the roles of Learn's minimum-role table for Azure VM backup (other data sources: check the role table of their own backup article): the backup operator identity gets Backup Operator on the resource group that contains the DR vault (enable backup) and on the DR vault (on-demand backup, restore), Virtual Machine Contributor on each VM that is to be protected (enable backup of Azure VMs), and for a restore Contributor on the resource group in which the VM is deployed, Virtual Machine Contributor on the source VM and Storage Account Contributor on the staging storage account; the backup administrator identity gets Backup Contributor on the DR vault and on the primary vault (policies, stop protection) and the same Backup Operator rights on the primary vault for the failback steps; for a Backup vault the managed identity of the vault gets the roles it needs on the source resources, and the identity that creates a backup instance has read permission on the source. Assign the roles at a scope that exists before DR (for example the resource group that will hold the DR workloads), so that no role assignment has to be made during the incident.
8. dr-region-vault: protect the workloads that already run in the DR region by assigning the DR policy, run an on-demand backup, and record the first recovery point; for a cold standby write the enable-protection step into the runbook with the policy name and the vault name as parameters.
9. cross-region-restore-split: enable Cross Region Restore on each GRS vault that has CRR-supported data sources (Properties, Backup Configuration, Cross Region Restore: Enable); it cannot be turned off, it moves the storage to RA-GRS, and the items can take up to 48 hours to be visible in the secondary region. A vault whose redundancy is LRS or ZRS cannot do CRR (it is supported only for GRS) and the redundancy cannot be changed after a backup is configured, so the choice is a new GRS vault with the workloads reprotected, taken only with the data owner's decision. Learn gives no procedure for a move to GRS; as an inference, the choices follow Learn's two choices for a move from GRS to LRS (see the Decommission step for workloads that move to a new vault of lower redundancy): delete the current protection and data, or stop protection with retained data and protect again in the new vault.
10. cross-region-restore-split: for each vault whose public network access is denied, record the gap: CRR is not supported there, and the data waits for the Microsoft-declared disaster; decide with the data owner whether to change the network setting of the vault.
11. cross-region-restore-split: prepare the restore target in the pair region: a resource group, a virtual network with a subnet for restored VMs, a staging storage account in the pair region, DNS for the restored workloads, a network path from the DR region's virtual networks to the restore virtual network (peering or hub-and-spoke) with the private DNS zone links of the DR region's networks, and the permission to create resources there; grant the restore operators (the backup operator of the tables) Backup Operator on the vault and on the vault's subscription (or the custom CRR role of Learn), Contributor on the target resource group, Virtual Machine Contributor on the source VMs and Storage Account Contributor on the staging storage account, as the Constraint on the roles lists.
12. cross-region-restore-split: when a restored workload must itself be backed up in the pair region, create a vault there with the same settings as the dr-region-vault Build step that creates the vault in the DR region and grant the roles of the dr-region-vault Build step that grants Learn's minimum roles on it (a vault protects data sources of its own region); otherwise write in the runbook that restored resources are unprotected until failback.

### Validate
1. dr-region-vault: run TC-1 on every DR-region vault, then TC-3 on the protected workloads (once, then at its Frequency).
2. dr-region-vault: run TC-4, a restore of one recovery point from the DR vault into the DR region, and time it.
3. cross-region-restore-split: run TC-5 on every GRS vault, wait until the items show in the secondary region (up to 48 hours after CRR is enabled), then run TC-2, a restore of a secondary-region recovery point into the pair, and time it.
4. cross-region-restore-split: run TC-6 on the restore target of the pair and on the roles of the restore operators.
5. cross-region-restore-split: complete the design check TC-7 for the data sources that do not support CRR or have public access denied, and record the decision per data source (accept the wait for the Microsoft-declared disaster, change the vault, or move the data source to another option).
6. Record each result with its date; a time that a drill measured is Demonstrated, and every figure that is not measured, including the time Microsoft takes to declare a disaster, stays Estimated or Unknown.

### Cut over
1. dr-region-vault: put the DR vault and its policy name in the DR runbook and the enable-protection step into the workload's failover plan, so that a failover ends with a protected workload.
2. cross-region-restore-split: put the CRR restore steps (the Failover steps below) into the runbook with the restore target, the roles and the vault names as parameters, and mark the DR of the vault's data as restore from the secondary region, validated by TC-2, TC-5 and TC-6.
3. Leave the primary vault's replication and soft-delete settings as they are; nothing is switched in the primary vault.

### Decommission
1. Decide per vault, with the data owner, whether the paired copy stays: a GRS vault's redundancy cannot be reduced in place and CRR cannot be disabled, so the paired copy stays unless the data is moved to a new LRS or ZRS vault; this step happens only after TC-1 to TC-7 have passed for the replacement.
2. For a vault whose workloads move to a new vault of lower redundancy (Learn describes GRS to LRS; ZRS is an inference), follow Learn's two choices: when the previous backups need not be kept, disable soft delete, stop protection and delete the backups in the old vault (destructive and irreversible), unregister Azure file shares, SQL Server instances and SAP HANA servers, and configure the backups in the new vault; when they must be kept, Learn says "some of the workloads have limited options" and gives a keep path only for an Azure VM and for the MARS agent, and gives none for Azure file shares, SQL Server, SAP HANA or Backup vault data sources, so for those the previous backups stay in the old vault until the team decides with the data owner (this is the playbook's reading of the Learn page). For an Azure VM, stop protection with retained data in the old vault, move the VM to another resource group, and then protect it in the new vault (a VM can be added to only one vault at a time, and the VM in the new resource group is considered a different VM); for the MARS agent, stop protection with retained data and register the agent in the new vault. The retained recovery points in the old vault are paid for and restorable only while unexpired.
3. cross-region-restore-split: nothing is decommissioned, because nothing was built beyond the CRR setting; the setting stays for good.

### Keep until cut-over
For dr-region-vault: the primary vault with its GRS replica and CRR setting, and every runbook step that restores primary history from it, until TC-1, TC-3 and TC-4 have passed. For cross-region-restore-split: everything that exists today stays for good (the GRS vault, the CRR setting, the pair-region restore target and the roles); only its validation (TC-2, TC-5, TC-6 and TC-7) is new.

## Failover and failback

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Declare DR for the workload and note that no backup job runs in the primary region while it is offline | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time, and the primary vault's Resource Health or Service Health shows its state | The primary region answers again before the declaration |
| 2 | dr-region-vault: when the workload runs in the DR region, assign the DR policy to it in the DR vault (the workload's own DR option brings it up) | Backup operator | Estimated 4h (the Estimated RTO of the option, which the team sets; TC-3 proves it) | The backup item shows protected in the DR vault, with the DR policy | The workload is not running in the DR region, the identity lacks Virtual Machine Contributor on the VM (enable backup fails), or the DR vault is unreachable: leave the workload running unprotected, record the gap with its time and escalate to the platform engineer |
| 3 | dr-region-vault: run an on-demand backup of each newly protected workload | Backup operator | Estimated unknown (measured in the first drill) | The backup job completes and the DR vault holds a first recovery point | The first backup fails: check the vault's network path, DNS and role assignments, then retry; do not rely on the DR vault until a recovery point exists |
| 4 | cross-region-restore-split: for a data source that supports CRR on a vault with CRR on, choose the newest recovery point under the Secondary Region view of the vault and start the restore into the pair region (create VM or restore disks) with the staging account and virtual network of the pair | Backup operator | Estimated 24h (the Estimated RTO of the option, a team-set starting value; Learn: the restore time in the secondary region is almost the same as the vault tier restore time in the primary region, with no figure; TC-2 proves it) | The restore job under Backup Jobs, Secondary Region shows completed, and the restored resource exists in the pair region | Check before starting, since a CRR restore job cannot be cancelled once triggered: if the recovery point is older than the 36h Estimated RPO or the restore target is not ready, stop and fix first; if the restore fails, start it again with the next recovery point |
| 5 | cross-region-restore-split: for a data source that does not support CRR, or on a vault with CRR off, wait for Microsoft to declare a disaster in the primary region (Learn: Microsoft is responsible for declaring it; that the customer cannot bring it forward or rehearse it is an inference, because Learn describes no customer action for it) | Platform engineer | Estimated unknown (Learn: Microsoft "typically declares a disaster only after an extended period of time") | The backup items appear and are restorable in the secondary region | The wait passes the data-loss limit that the application owner sets in the runbook: the application owner decides between accepting the gap and a rebuild without the backup, records the decision, and the platform engineer opens a support request |
| 6 | cross-region-restore-split: validate the restored resource, reconfigure its network, DNS, load balancer and clients, and hand it to the application owner | Application engineer | Estimated unknown (measured in the first drill; the restore time is not part of it) | The restored workload answers its health check from the DR network and holds the data of the recovery point | The restored resource does not start: restore the next recovery point, or record the gap |
| 7 | cross-region-restore-split: protect the restored workload in a vault of the pair region when it must run there beyond the incident's first days | Backup operator | Estimated unknown (measured in the first drill) | The backup item shows protected in the pair-region vault | No vault exists in the pair region: leave it unprotected, record the gap and create the vault of the Build step that creates a vault in the pair region |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region and the primary vault are available again | Incident manager | Estimated unknown (measured in the first drill) | Learn: when the region recovers Backup restores operations automatically, so the primary vault's jobs resume and its data is listed | The primary vault is still unavailable or its jobs fail |
| 2 | dr-region-vault: when the workload returns to the primary region, check the protection of its backup item in the primary vault; if the item fails because the resource is not found (Learn's relocation errors BCMV2VMNotFound or ResourceNotFound), stop protection with retained data and protect the workload again; Learn describes this for a VM that moved to another region and gives no page for a failback, so this step is an inference from it | Backup administrator | Estimated unknown (measured in the first drill) | An on-demand backup in the primary vault completes and a recovery point is listed | The backup fails: keep the DR vault's protection until the primary's works |
| 3 | dr-region-vault: stop protection in the DR vault with retained data until the retention the data owner sets has passed, then delete the retained data | Backup administrator | Estimated unknown (measured in the first drill) | The DR vault lists the items as stopped, with retained data, and the date for deletion is recorded | The data owner has not accepted the retention period: keep protection on |
| 4 | cross-region-restore-split: move the restored workload back to the primary region by the workload's own failback, stop its protection in the pair-region vault with retained data, and delete the restored resources of the drill and the incident when the data owner accepts | Backup administrator | Estimated unknown (measured in the first drill) | The pair-region restore target holds no resource that the data owner still needs | A needed resource is found: keep it until the owner decides |
| 5 | Check that backups and replication to the secondary region have resumed, and run TC-5 again | Backup operator | Estimated 12h (Learn: up to 12 hours to replicate a backup from the primary to the secondary region) | A new recovery point shows in the Secondary Region view within the replication limit | The replication lag stays over 12 hours: open a support request |

## Test criteria

### TC-1: The DR-region vault is configured as planned
- Applies to: dr-region-vault
- Pass condition: every DR-region vault is in the DR region, is of the type the inventory names (a Recovery Services vault or a Backup vault), has the redundancy the design names (ZRS or LRS, and GRS only when decided), has soft delete on with the retention the team set, the immutability and encryption settings of the design, the same policies as the primary vault's (schedule and retention equal), diagnostic settings and Resource Health and Service Health alerts, and its private endpoint connection is Approved with a name that resolves from every DR network that runs the workloads; the backup operator identity holds Backup Operator on the vault and its resource group and Virtual Machine Contributor on the VMs it protects, the backup administrator identity holds Backup Contributor on the vault, and no one else holds write roles by default.
- How to measure: read the vault properties, backup configuration, policies, role assignments, private endpoint connection state and diagnostic settings with a read-only query, and resolve the vault's private endpoint names from a host in each DR network.
- Evidence: the query output and the DNS result with their date, kept per vault.
- Frequency: monthly, and after every change to the vault, its network or its roles

### TC-2: A restore from the secondary region works into the pair
- Applies to: cross-region-restore-split
- Pass condition: a restore of a recovery point from the Secondary Region view of a GRS vault with CRR completes into the pair region (restore of the VM or its disks, or the database or its files), the restored resource starts and answers its health check, the recovery point used is not older than the 36h Estimated RPO at the time of the drill, and the time from starting the restore to the answering health check is at or below the Estimated RTO of 24h of the option (the measured time is the Demonstrated restore time).
- How to measure: a drill that starts a Cross Region Restore of one recovery point per data source type into the restore target of the pair, with the restore job's start and end under Backup Jobs, Secondary Region and a health check of the restored resource; the restored resources are deleted after the drill (the drill job cannot be cancelled once started).
- Evidence: the drill record with the recovery point's time, the restore job's identifier, start and end times, the health check result and the measured time.
- Frequency: every DR drill, and at least yearly

### TC-3: Every workload in the DR region is protected and current
- Applies to: dr-region-vault
- Pass condition: every workload that runs in the DR region and is in the inventory shows as protected in a DR-region vault, its last backup job completed, and the age of its newest recovery point is at most the schedule interval the team sets for it (24 hours for an Azure VM on the Standard policy); a workload that is a cold standby has its enable-protection step in the runbook and, in a drill, is protected within the Estimated RTO of the option after it runs.
- How to measure: list the backup items and their last backup times in each DR vault and compare them with the inventory; in a drill, time the step from the workload running to the first recovery point.
- Evidence: the list of items, last backup times and the unprotected workloads (target: none), with its date; for a drill, the time of each step.
- Frequency: daily for the list; every DR drill for the cold-standby timing

### TC-4: A recovery point of the DR vault restores in the DR region
- Applies to: dr-region-vault
- Pass condition: a restore of one recovery point per data source type from a DR-region vault into the DR region completes, the restored resource starts and holds the data of the recovery point, and the restore time is at or below the restore bound that the team sets and records.
- How to measure: restore one item of each type to a test target in the DR region from the DR vault, time the job and run a health check on the result.
- Evidence: the restore job record with start, end and health check, and the measured time.
- Frequency: quarterly, and after every change to the vault's network or roles

### TC-5: Every GRS vault has CRR on and its recovery points reach the secondary region
- Applies to: cross-region-restore-split
- Pass condition: every vault of the inventory that holds CRR-supported data sources has the storage replication type Geo-redundant and Cross Region Restore enabled, public network access is not denied on it, and for each backup item the newest recovery point listed under Secondary Region is no older than 36 hours (24 hours of schedule plus up to 12 hours of replication) once the 48 hours after enabling CRR have passed.
- How to measure: read each vault's backup configuration and network settings, and compare the newest recovery point in the primary view with the newest in the Secondary Region view of each backup item.
- Evidence: the query output per vault and per backup item, with the age of the newest secondary recovery point, kept with its date.
- Frequency: weekly, and after every change to a vault's network settings

### TC-6: The restore target in the pair region and the restore roles are ready
- Applies to: cross-region-restore-split
- Pass condition: the pair region holds the restore target of the design (a resource group, a virtual network with a subnet, a staging storage account in the vault's secondary region, DNS for the restored workloads, and the network path from the DR region's virtual networks to the restore virtual network); each restore operator holds Backup Operator on the vault and on the vault's subscription (or the custom role with the six CRR permissions), Contributor on the target resource group, Virtual Machine Contributor on the source VMs and Storage Account Contributor on the staging storage account; and a vault exists in the pair region when the design protects restored workloads there.
- How to measure: read the resources and the role assignments of the restore target, the vault and the vault's subscription with a read-only query, run a what-if or a test deployment of one restored resource into the target, and test a connection from a DR-region network to the restore subnet.
- Evidence: the query output with its date, the role list and the deployment test result.
- Frequency: monthly, and after every change to the pair region's network or the roles

### TC-7: Data sources without CRR are a recorded decision (design check, not drillable)
- Applies to: cross-region-restore-split
- Pass condition: every backup item of the inventory that is not in a CRR-supported type, is on a vault with CRR off, or is on a vault with public network access denied is listed with its decision (accept the wait for the Microsoft-declared disaster, change the vault, or move the item to another option) and its owner, and the application owner has recorded a data-loss limit for the wait. Learn names Microsoft as responsible for declaring the disaster; as an inference, the customer cannot drill the wait, so it is a design check, and the time of a real declaration is recorded when it occurs.
- How to measure: a review of the inventory against the CRR support list of Learn's support matrix and the vault settings, with the decisions in the runbook.
- Evidence: the review record with its date, the list of items with decisions and owners.
- Frequency: after every change to the inventory or to the Learn support matrix, and yearly
