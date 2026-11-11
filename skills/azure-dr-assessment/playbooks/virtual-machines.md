---
service: virtual-machines
title: Azure Virtual Machines
arm_types:
  - microsoft.compute/virtualmachines
  - microsoft.compute/disks
slot: data-replication.vm-disks
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-virtual-machines
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-site-recovery
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-disk
  - https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-architecture
  - https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-support-matrix
  - https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-common-questions
  - https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-how-to-enable-zone-to-zone-disaster-recovery
  - https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-tutorial-enable-replication
  - https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-how-to-enable-replication
  - https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-tutorial-dr-drill
  - https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-tutorial-failover-failback
  - https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-tutorial-failback
  - https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-how-to-reprotect
  - https://learn.microsoft.com/en-us/azure/site-recovery/monitor-site-recovery
  - https://learn.microsoft.com/en-us/azure/backup/backup-azure-arm-restore-vms
  - https://learn.microsoft.com/en-us/azure/backup/backup-create-rs-vault
  - https://learn.microsoft.com/en-us/azure/backup/backup-rbac-rs-vault
  - https://learn.microsoft.com/en-us/azure/virtual-machines/azure-compute-gallery
  - https://learn.microsoft.com/en-us/azure/site-recovery/site-recovery-backup-interoperability
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-steps
---

# Azure Virtual Machines

## Mechanisms

### Azure Site Recovery Azure-to-Azure replication
- Replicates: data (the VM and its data, replicated to a secondary region; the disk-level detail and the target settings are in the Constraints, and who starts the failover is in the constraint "Failover is started by the customer")
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: 5m (Learn: "Site Recovery creates a crash-consistent recovery point every five minutes. You can't change this frequency", so this covers crash-consistent recovery points only; app-consistent recovery points have a minimum frequency of one hour; Learn: "There's no defined SLA for RPO", so the figure is the recovery point frequency and not a service commitment; TC-1 reads the logged RPO per protected machine) (https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-common-questions)
- Estimated RTO: 1h (Learn's RTO SLA of one hour for the failover of a VM, see the constraints on the RTO SLA; the recovery time of the workload adds the team's own steps, which TC-2 measures)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-virtual-machines#custom-multiregion-solutions-for-resiliency

### Azure Backup Cross Region Restore
- Replicates: data (the recovery points stored in a geo-redundant Recovery Services vault; snapshots are not replicated, so a restore in the secondary region is a vault-tier restore) to the paired region of the vault
- Paired: yes
- Nonpaired: no
- Failover: customer-managed
- Estimated RPO: 36h (Learn: for Azure VM backups the secondary region RPO can be up to 36 hours in the worst case, which is up to 24 hours for the primary region with the Standard policy plus up to 12 hours for replication to the secondary region)
- Estimated RTO: unknown (Learn: the restore time in the secondary region is "almost the same" as the vault-tier restore time in the primary region, and publishes no figure)
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-azure-arm-restore-vms

### Availability zones and zone-redundant disks
- Replicates: data between availability zones of one region only (zone-redundant storage disks); a zonal VM is pinned to one zone and VMs in other zones are the customer's own copies
- Paired: no
- Nonpaired: no
- Failover: not applicable
- Estimated RPO: unknown (in-region mechanism: Learn says zonal LRS disks might be unavailable during a zone failure and that the customer is responsible for data replication between VMs, so it gives no region-level RPO)
- Estimated RTO: unknown (in-region mechanism: Learn says VMs remain down until the availability zone recovers and that the customer is responsible for rerouting traffic, so it gives no region-level RTO)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-virtual-machines#resilience-to-availability-zone-failures

## Constraints

### A VM is a single-region resource with no built-in multiregion failover
Learn says that VMs are single-region resources and that if the region becomes unavailable, the VM is also unavailable. For a multiregion design the customer deploys multiple VMs in different regions and implements replication, load balancing and failover, or uses Site Recovery.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-virtual-machines#resilience-to-region-wide-failures

### Site Recovery reaches almost any region, so a nonpaired DR region is supported
Learn says you can select "almost any Azure region" as the Site Recovery secondary region, "including nonpaired region combinations". The support matrix reads more broadly ("any two Azure regions"; see the next constraint), and the stricter reading, "almost any", applies. So (inference) the primary's pair plays no part in whether a DR region is allowed; the restricted-region list and Products available by region decide.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-virtual-machines#custom-multiregion-solutions-for-resiliency

### Restricted regions are reserved for in-country disaster recovery
The support matrix says that Site Recovery can replicate and recover VMs "between any two Azure regions in the world" and that replication can be limited to a geographic cluster for data sovereignty. It also says that support for restricted regions is reserved for in-country or in-region disaster recovery: Switzerland West for Switzerland North customers, France South for France Central, Norway West for Norway East, JIO India Central for JIO India West, Brazil Southeast for Brazil South, South Africa West for South Africa North, Germany North for Germany West Central and UAE Central for UAE North. To use a restricted region as primary or recovery region, request access for both the source and the target subscription. Brazil South can be used only as a source region, and Brazil Southeast only as a target region. If a region is not visible when you enable replication, the subscription needs permission to create VMs in that region.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-support-matrix#region-support

### Two regions cannot hold an Azure-to-Azure vault, but they can be source or target
Azure-to-Azure disaster recovery does not support Recovery Services vaults created in South Central India and North East US 5. These regions can be a source or target region when the vault is in a supported Site Recovery region.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-support-matrix#region-support

### The vault region decides whether failover can be started
The vault stores the replication settings and not the replicated data. Replication continues during an outage in the vault's region, but "you can't perform Site Recovery management operations, including failover and failback" until that region recovers. Learn therefore recommends deploying the vault in the target region, which also keeps an outage in a third region from affecting failover. If the vault is in the region you usually use as the target, that region becomes the source after a failover and reprotection, and a later problem there can block failback until both regions are healthy. The customer is responsible for verifying that the target region supports the VM types needed and has the capacity.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-site-recovery#considerations

### The vault can be in any region except the source region
The tutorial says to create the Recovery Services vault "in any region, except in the source region" from which you replicate.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-tutorial-enable-replication#create-a-recovery-services-vault

### Failover is started by the customer
Failover is not automatic: it starts with one click in the portal or with PowerShell.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-common-questions#is-failover-automatic

### Failover does not need the primary region
Site Recovery does not need connectivity from the primary region to do the failover.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-common-questions#what-if-theres-an-unexpected-outage-in-the-primary-region

### The VM is created in the target region at failover
When you initiate a failover, the VMs are created in the target resource group, target virtual network, target subnet and target availability set, and any recovery point can be used.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-architecture#failover-process

### A region failure stops replication
For Azure-to-Azure replication you can trigger a failover when the source region is unavailable, and replication stops until the source VM is healthy again. If the target region fails, replication stops and failover is unavailable until it recovers.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-site-recovery#behavior-during-a-region-failure

### Failover capacity is best effort unless a capacity reservation exists
Failover capacity in the target region is available "on a best-effort basis" unless you configure an on-demand capacity reservation that supports the exact target VM size, region or zone and deployment configuration. Capacity Reservation does not support every GPU, M-series, ND, HB or HC size, and it is not compatible with Ultra Disk, availability sets, Dedicated Hosts, proximity placement groups or Spot VMs.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-common-questions#how-do-we-ensure-capacity-in-the-target-region

### The RTO SLA is one hour
Site Recovery has an RTO SLA of one hour, and "most of the time" it fails over VMs "within minutes"; to calculate the RTO of a failover, review the failover job, which shows the time it took to bring up a VM.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-common-questions#what-is-the-rto-of-a-virtual-machine-failover

### The RTO SLA has conditions
The RTO is the time from when you trigger a failover (or your scripts trigger it) to when the target VM runs, and it excludes manual actions or script execution. To be eligible for the SLA you must retry failed failover attempts at least every 30 minutes, and the SLA provides service credits only when the secondary region has sufficient compute capacity.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-site-recovery#service-level-agreement

### There is no defined SLA for RPO
Learn states for Azure-to-Azure zone-to-zone disaster recovery that the SLA for RTO is the same as the SLA for Site Recovery overall ("an RTO of up to one hour") and that "There's no defined SLA for RPO". So the five-minute crash-consistent recovery point frequency is a recovery point frequency, not an RPO commitment, and the RPO of a failover depends on the recovery point chosen (Latest, Latest processed or Latest app-consistent) and on the churn of the VM.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-how-to-enable-zone-to-zone-disaster-recovery#faqs

### Recovery points: five-minute crash-consistent
Site Recovery creates crash-consistent recovery points every five minutes and the setting cannot be changed. App-consistent snapshots are taken only if you specify a frequency, which should be shorter than the retention.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-architecture#snapshots-and-recovery-points

### The default replication policy keeps one day and no app-consistent snapshots
When you enable replication, the default policy keeps recovery points for one day and has an app-consistent snapshot frequency of zero hours (disabled).
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-architecture#replication-policy

### Multi-VM consistency affects performance
VMs in a replication group have shared crash-consistent and app-consistent recovery points at failover; multi-VM consistency impacts workload performance and should only be used for workloads that need consistency across all machines.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-architecture#multi-vm-consistency

### Retention reaches 15 days and app-consistent points are hourly at best
The oldest recovery point you can use is 15 days with managed disks, and app-consistent recovery points have a minimum frequency of one hour.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-common-questions

### The recovery point option trades RPO against RTO
At failover you choose Latest processed (no time spent processing data, so a low RTO), Latest (processes all data already sent to Site Recovery first, so the lowest RPO and a higher RTO), Latest app-consistent, or Custom (a single VM, without a recovery plan). Committing a failover deletes all available recovery points for the VM in Site Recovery and the recovery point can no longer be changed.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-tutorial-failover-failback#run-a-failover

### The failed-over VM lacks RBAC assignments and extensions
Learn says that Azure RBAC policies on the VM and VM extensions are not replicated to the failover VM in the target region and that extensions have to be installed manually. User-generated tags are carried and replicate every 24 hours. Local NVMe data and nested guests are not protected.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-support-matrix#replicated-machines-compute-settings

### Source VMs that Site Recovery does not support
The support matrix lists as not supported: Arm64 VM sizes, Confidential VMs and Azure Dedicated Host. A VM needs at least two active vCPUs and 1 GiB RAM. Virtual Machine Scale Sets in Flexible orchestration are supported for the availability scenario and not for the scalability scenario.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-support-matrix#replicated-machines-compute-settings

### Disk types, limits and churn
Premium SSD v2 and Ultra Disk sources need the High Churn option, use Premium SSD v1 replica disks and keep their own type for the failover disk. Not supported: the temporary disk (always excluded), ephemeral OS disks, mixed SCSI and NVMe controllers, guest iSCSI disks, Azure Elastic SAN volumes as VM disks, Storage Replica, DRBD disks and FIPS encryption; Write Accelerator must be disabled before enabling replication and re-enabled after failover on a supported M-series VM, and the encryption at host setting is not preserved (re-enable it after failover). Unmanaged disks retired on March 31, 2026: disable and re-enable protection after migrating the VM to managed disks. Azure Disk Encryption is supported for managed disks but not with HSM-protected keys. A data disk is 1 GiB to 32,767 GiB, up to 64 data disks per VM, an OS disk up to 4,095 GiB, and up to 3,000 protected disks per subscription (1,200 for Trusted Launch VMs). Hot remove of a disk is not supported (disable and re-enable replication) and an offline change to a protected disk triggers a full resynchronization. Normal Churn supports up to 54 MB/s per VM; High Churn limits depend on the configuration (up to 500 MB/s per VM for eligible ones).
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-support-matrix

### The cache storage account stays in the source region
The cache storage account must be in the same region as the VM and in the same subscription as the source VMs. Use a General-purpose v2 account (v1 has no ZRS) or a Premium block blob account for High Churn. Soft delete is not supported on it. With a storage firewall, allow trusted Microsoft services and all subnets that hold source VMs. The number of disks per account is limited (for example 750 disks at 4 MBps churn on a v2 account). The support matrix also lists LRS, ZRS, GRS and read-access GRS as supported cache redundancy, while the reliability article says not to use GRS (next constraint); the stricter reading applies: not GRS.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-support-matrix

### The cache storage account is not geo-redundant
The reliability article says the cache storage account is only a temporary location for data before it is replicated, so "you shouldn't configure it to use geo-redundant storage (GRS)".
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-site-recovery#configure-multiregion-support

### Outbound connectivity for replication
The VMs need outbound HTTPS (port 443) to the Storage, Microsoft Entra ID, Site Recovery and Event Hubs service tags of the source and target regions, and Site Recovery "never needs inbound connectivity to the VM".
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-architecture#connectivity-requirements

### Network behaviour after failover
Public (internet) load balancers are not supported in the DR region; internal load balancers, public IPs and NSGs are associated by a script in a recovery plan or by hand. A static private IP is kept when it is free in the target subnet, otherwise the next free address is used. Azure Traffic Manager, Azure DNS and custom DNS are supported. Application security groups, IPv6-only configurations, authenticated proxies and Palo Alto network appliances are not supported.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-support-matrix#replicated-machines-networking

### A public IP address is not kept after failover
You cannot keep the public IP address of a production app after a failover; an Azure public IP address resource that is available in the target region is assigned manually or by a recovery plan.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-common-questions#can-i-keep-a-public-ip-address-after--failover

### The mobility agent must stay current
If the mobility agent falls more than four versions behind, replication is turned off and the recoverability of the workload is compromised, so Learn strongly recommends automatic updates for the agents.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-site-recovery#resilience-to-service-maintenance

### Replication health turns Critical after 60 minutes without a recovery point
If a recovery point has not been generated in the last 60 minutes, the replication health of the VM becomes critical.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-how-to-enable-replication#enable-replication-for-added-disks

### Replication health is read from Azure Monitor Logs
There are no automatically collected platform metrics for Site Recovery; resource logs routed to a Log Analytics workspace carry replication health, test failover status, Site Recovery events, recovery point objectives for protected machines and disk change rates, for Azure-to-Azure replication.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/monitor-site-recovery

### Initial replication and resynchronization take hours, by disk size
Learn gives planning estimates, "not service-level commitments", for fully used Premium SSD v1 disks: initial replication of 4 hours for 1 TB, 8 hours for 2 TB and 16 hours for 4 TB, and checksum-based resynchronization or reprotection of 6, 12 and 24 hours for the same sizes. Premium SSD v2 and Ultra Disk take longer. Actual times vary with distance, bandwidth, disk throughput, write pattern and throttling.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-common-questions#initial-replication-reprotection-and-resynchronization-duration-estimates

### Permissions for Site Recovery
Creating a vault needs admin or owner permissions on the subscription. Managing Site Recovery operations in the vault needs the built-in Site Recovery Contributor role. Creating VMs in the target region needs the built-in Virtual Machine Contributor role or specific permissions to create a VM in the selected virtual network, write to a storage account and write to a managed disk. The subscription needs enough resources in the target region for the VM sizes that match the source.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-tutorial-enable-replication

### Enabling replication: up to ten VMs at a time, availability type fixed
The enable-replication wizard selects up to 10 VMs. The target resource group can be in any region except the one that hosts the source VMs. The availability type (single instance, availability set or zone) cannot be changed after replication is enabled; disable and re-enable replication to change it.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-how-to-enable-replication#enable-replication

### A replicated item has one target, and Learn describes no change of it
The target settings that Learn says can be modified after replication works are the target resource group, name and VM size; the target availability type cannot be updated. Learn lists no operation that changes the target region of an existing replicated item. So (inference) moving the replication from the pair to another region is a disable of the old replication and an enable of a new one, with a window in which the VM has no Site Recovery protection.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-architecture#managing-target-resources

### After failover the VMs are unprotected until they are reprotected
After a failover the VMs start in the target region in an unprotected state. Reprotection needs the failover to be committed (status Failover committed) and the primary region to be available with permission to create resources there. Reprotection compares the disks and transfers only the differences when the source VM data still exists, so its time is at least the checksum calculation time plus the transfer and processing times, and it is not supported if the source VM's data was deleted, corrupted or inaccessible (for example by a resource group change or deletion). During reprotection Site Recovery locks the source machine as read-only until failback completes.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-how-to-reprotect

### Failback needs the source VM shut down
Before a failback the source region VM must be shut down, because changes are synced from the failover VM disks to the source region disks and a running source VM fails and fails the failback. For VMs with managed disks Site Recovery cleans up the machines in the DR region after failback and reprotection; VMs with unmanaged disks are not cleaned up.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-tutorial-failback

### Drills use a test failover into a non-production network
A test failover creates the VM in the target region from a chosen recovery point and a virtual network you select; Learn recommends a non-production network, and a cleanup deletes the VMs created by the test.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-tutorial-dr-drill#run-a-test-failover

### Learn recommends regular drills, the vault in the target region and updated agents
Learn recommends test failovers as part of DR drills "every quarter or biannually", deploying the vault in the target region, a ZRS cache storage account, on-demand capacity reservations for the target region, automatic updates for mobility agents, and monitoring with alerts on replication health. It also recommends the High Churn feature for VMs with a high rate of data change.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-site-recovery#production-deployment-recommendations-for-reliability

### Azure CLI is not a supported deployment method
Azure portal, Azure PowerShell and the REST API are supported for Azure-to-Azure disaster recovery; Azure CLI is "not currently supported". Automation of replication and failover therefore uses PowerShell or REST.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-support-matrix#deployment-method-support

### Cross Region Restore reaches only the paired region, and only from a geo-redundant vault
Cross Region Restore restores Azure VMs in a secondary region that is an Azure paired region. It is supported only for a Recovery Services vault that uses geo-redundant storage. It might take up to 48 hours after enabling it for backup items to be available in the secondary region, it cannot be reverted to GRS or LRS after protection starts for the first time, and it costs extra.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-create-rs-vault#set-cross-region-restore

### The vault storage replication type is set before the first backup
Learn says to change the storage replication type of a Recovery Services vault before you configure a backup in the vault; after you configure a backup, the option to modify is disabled.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-create-rs-vault#set-storage-redundancy

### Writing Azure RBAC role assignments needs a role that can assign roles
To assign roles you must be signed in with a role that has role assignments write permission (`Microsoft.Authorization/roleAssignments/write`), such as Role Based Access Control Administrator at the scope. Learn's privileged administrator roles that can assign roles are Owner, Role Based Access Control Administrator and User Access Administrator; Contributor "can't assign roles in Azure RBAC".
- Source: https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-steps

### Cross Region Restore limits for VMs
Cross Region Restore applies to managed VMs (including encrypted VMs), for the options Create a VM and Restore disks, and only restoring secondary region data to a secondary region is supported. Learn lists these limits: more than 16 source disks means VHDs are not created, Replace existing disks is not supported, a customer-managed-key VM that was not backed up in a CMK-enabled vault is restored as a non-CMK VM, "Cross Region Restore isn't supported with managed identities", and jobs cannot be canceled once triggered. The staging storage account must be in the region that the vault treats as secondary. The roles needed to restore in the secondary region are the same as in the primary region, and Backup Admins and App admins can perform the restore. The restore-VM article says CRR is not supported for machines on Ultra Disks, while the vault article says it is also supported for them; the stricter reading applies: Ultra Disk VMs are not covered by Cross Region Restore.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-azure-arm-restore-vms

### A restored VM is a new resource
After a restore, extensions present during backup are installed but not enabled, RBAC role assignments scoped to the original VM do not carry over, a static IP address becomes dynamic, and a restored VM has no availability set (with Restore disks, one can be specified). A cloud-init Linux VM blocks the password after restore.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-azure-arm-restore-vms#post-restore-steps

### Roles for a restore in the secondary region
The Azure roles that Learn lists for restoring a VM are Backup Operator on the Recovery Services vault, Contributor on the resource group in which the VM will be deployed, Virtual Machine Contributor on the source VM that got backed up, and Storage Account Contributor on the storage account used for the restore. For a Cross Region Restore the same page adds a row: Backup Operator on the subscription of the Recovery Services vault, in addition to the restore permissions.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-rbac-rs-vault#minimum-role-requirements-for-azure-vm-backup

### Backups do not keep an application available
VM backups provide recovery points for accidental deletion or data corruption, "but they don't keep an application available during infrastructure failures". Use backups with the availability and disaster recovery approaches.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-virtual-machines#backup-and-restore

### Compute Gallery is not a global resource
Azure Compute Gallery is not a global resource: for disaster recovery the best practice is at least two galleries in separate regions, because if the region of one gallery is down you cannot create new gallery resources or update existing ones there, although image versions replicated to other regions can still be used. Each image version can be replicated to chosen regions, which can take a few hours, and all public regions can be targets (some need an access request).
- Source: https://learn.microsoft.com/en-us/azure/virtual-machines/azure-compute-gallery

### Disks have no native multiregion option; Learn names four approaches
Azure Disk Storage is a single-region service that provides no native multiregion capabilities and no automatic failover between regions. For standalone disks and data that Site Recovery does not cover, Learn names Site Recovery, Azure Backup (disk backup, and cross-region restore for VMs), a self-built solution that copies disk snapshots across regions, and the replication of the application or database itself (for example SQL Server Always On availability groups), and says the customer manages resources in every region and coordinates and synchronizes data.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-storage-disk#resilience-to-region-wide-failures

### Backup restore and Site Recovery interoperate, but a restore needs replication re-enabled
Site Recovery and Azure Backup are interoperable and can be configured together. If you restore a VM or a group of VMs, or a backed-up disk, there is no current support for it with replication: you need to disable and re-enable replication for the VM. Restoring files on the source-side VMs does not change replication health.
- Source: https://learn.microsoft.com/en-us/azure/site-recovery/site-recovery-backup-interoperability

## Non-paired options

### site-recovery: Azure Site Recovery replication to the DR region
- Kind: native
- Target: dr-region
- Uses mechanism: Azure Site Recovery Azure-to-Azure replication
- Estimated RPO: 5m (Learn: "Site Recovery creates a crash-consistent recovery point every five minutes. You can't change this frequency"; this covers crash-consistent recovery points only, app-consistent recovery points have a minimum frequency of one hour, and Learn states "There's no defined SLA for RPO"; TC-1 reads the logged RPO against it) (https://learn.microsoft.com/en-us/azure/site-recovery/azure-to-azure-common-questions)
- Estimated RTO: 1h (Learn's RTO SLA for the failover of the VM; the recovery plan with its scripts and the application checks add their own time, and TC-2 measures the whole plan against the RTO the team sets)
- Prerequisites: a Recovery Services vault in the DR region (or another supported region that is not the source; not South Central India or North East US 5), created by an owner or admin of the subscription; Site Recovery Contributor on the vault and Virtual Machine Contributor (or the create-VM, storage and disk write permissions) in the DR region and in the primary region for failback; a subscription that can create VMs in the DR region (allow list for a restricted region) and quota for the matching VM sizes there; supported source VMs (Windows or Linux on a supported OS, managed disks, x64, at least two active vCPUs, no Confidential VM, no Dedicated Host, no ephemeral OS disk); a target network in the DR region (virtual network, subnets, NSGs, DNS, and the route to on-premises and to the other DR services) mapped to the source network, with a non-production network for drills; a cache storage account per source region (General-purpose v2 with ZRS, or Premium block blob for High Churn, with trusted Microsoft services allowed if a firewall is on); outbound HTTPS from the VMs to the service tags of both regions and no authenticated proxy; an on-demand capacity reservation in the DR region for the VM sizes that support it; a Log Analytics workspace for the resource logs and an Azure Automation account for the agent updates; for encrypted VMs, the disk encryption keys and the vault they live in reachable in the DR region (Azure Disk Encryption with HSM-protected keys is not supported).
- Cost notes: Site Recovery is billed per protected VM instance; replica managed disks and the cache storage account; the High Churn Premium block blob account; the retained snapshot of Premium SSD v2 and Ultra Disk sources (it can be deleted after initial replication); recovery point retention beyond the default; a capacity reservation; the VMs of each test failover until cleanup; cross-region data transfer; no price.
- Gives up: a failover that Microsoft starts (the customer starts it, and during a vault-region outage cannot); the extensions, RBAC assignments, encryption at host and Write Accelerator setting on the failover VM, which are rebuilt after failover; capacity that is only best effort without a reservation; a public IP address that is kept; a VM in the DR region that is unprotected after failover until reprotection; replication of unsupported VM configurations, which fall to the other options.
- Recommended when: the VMs are on supported sizes and disks, the DR region is the region the customer chooses, the pair or not (see the constraint "Site Recovery reaches almost any region, so a nonpaired DR region is supported"), and a recovery time of about an hour for the VM layer (plus the recovery plan) and crash-consistent recovery points every five minutes are acceptable.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-virtual-machines#custom-multiregion-solutions-for-resiliency

### redeploy-from-code: Redeploy the VMs in the DR region from code and replicated data
- Kind: workaround
- Target: dr-region
- Uses mechanism: none
- Estimated RPO: 1h (Estimated, team-set starting value: the data-replication or snapshot-copy interval the team sets for the data of the VMs; Learn publishes no figure and says the customer implements the replication; TC-5 proves it)
- Estimated RTO: 4h (Estimated, team-set starting value: the redeploy time the team sets for the pipeline, the data restore and the cut-over; Learn publishes no figure; TC-4 proves it)
- Prerequisites: every VM described as code (template or script) with its region and name as parameters, deployable in the DR region without manual steps; images the VMs start from available in the DR region (Azure Compute Gallery image versions replicated to the DR region, with a second gallery in another region); VM sizes and disk types that exist in the DR region and quota for them (Learn: some VM types and sizes are available only in specific regions or zones, checked with Products available by region and the VM SKU availability check); a data path for each disk that carries state: application or database replication such as SQL Server Always On availability groups, a self-built copy of incremental disk snapshots across regions, or a restore from backup; the DR virtual network, NSGs, load balancer or Traffic Manager, DNS and role assignments built beforehand and kept in step with the primary; a pipeline identity with Virtual Machine Contributor (or the create-VM permissions) in the DR region; secrets, certificates and encryption keys the VMs need available in the DR region.
- Cost notes: the always-on part of the DR deployment (network, images, data replicas, storage for snapshot copies), the VMs while they run in a drill or a failover, cross-region data transfer, the pipeline runs; no price.
- Gives up: continuous VM-level replication and the Estimated RTO of 1h of Site Recovery; the in-guest state of a VM that is not in the code or in replicated data; a quick start in an outage, because VMs are built when DR is declared; the effort of keeping the code, images and DR network in step with the primary.
- Recommended when: the VMs are stateless or rebuilt from images, or their state lives in a service or application that replicates it itself, or the VM configuration is not supported by Site Recovery.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-virtual-machines#custom-multiregion-solutions-for-resiliency

### cross-region-restore-split: Restore VMs in the paired region from a geo-redundant vault
- Kind: split-region
- Target: pair-region
- Uses mechanism: Azure Backup Cross Region Restore
- Estimated RPO: 36h (Learn: up to 36 hours in the worst case for Azure VM backups in the secondary region)
- Estimated RTO: 24h (Estimated, team-set starting value: Learn says the restore time in the secondary region is almost the same as a vault-tier restore in the primary region and gives no figure; TC-7 proves it in a restore drill)
- Prerequisites: the primary region has a pair and the residency of the data allows it; a Recovery Services vault with geo-redundant storage chosen before the first backup is configured, Cross Region Restore enabled in its Backup Configuration (it cannot be reverted to GRS or LRS after protection starts for the first time), and up to 48 hours of wait after enabling it; the VMs are protected by a backup policy in that vault and are managed VMs (not managed identities, not Ultra Disk, up to 16 disks if VHDs are needed); in the pair region a staging storage account, a virtual network and subnets, quota and capacity for the VM sizes; Backup Operator on the vault and on the subscription of the vault (Learn's Cross region restore row), Contributor on the resource group of the restored VM, Virtual Machine Contributor on the source VM and Storage Account Contributor on the staging account; a network path from the pair region to the services that fail over to the DR region, which the network engineer plans (an inference: Learn does not describe it).
- Cost notes: geo-redundant vault storage and the Cross Region Restore charge; the staging storage account; the restored VMs and disks while they run; cross-region traffic between the pair region and the DR region; no price.
- Gives up: an Estimated RPO measured in hours (up to 36h) against minutes; a recovery time without a published figure; snapshots (only vault-tier restores); Replace existing disks; the workload in the pair region while other services run in the DR region, with the latency and egress between them (inference); extensions, RBAC assignments, static IP address and availability set of the restored VM, which are rebuilt; a restore that cannot be canceled once triggered.
- Recommended when: residency allows the pair region, the workload can tolerate up to 36 hours of data loss and a restore-time recovery, and the VM configuration is one that Cross Region Restore supports.
- Source: https://learn.microsoft.com/en-us/azure/backup/backup-azure-arm-restore-vms#cross-region-restore

## Migration from a paired setup

### Recognise today's setup
Today's paired DR of a VM shows in an inventory in three ways. First, Site Recovery replication into the pair: the evidence is a replicated item of a Recovery Services vault that names the VM as its source and the pair as its target region. Site Recovery also creates, in the pair, replica managed disks with the suffix -ASRReplica (the disk state is ActiveSAS and it carries a tag with the prefix ASR-ReplicaDisk) and a resource group, a virtual network and an availability set with the suffix asr, and a cache storage account in the source region, but these names, suffixes and locations alone prove nothing: without the replicated item, record the VM's DR relationship as Unknown. No VM exists in the pair until a failover. Second, Backup with Cross Region Restore: a Recovery Services vault with geo-redundant storage that has Cross Region Restore enabled and backup items that are visible in its secondary region. Third, nothing that the inventory shows: a VM with no replicated item and no backup item in the inventoried vaults has no DR that can be observed (record it as Unknown until the owner confirms that it has none), and a standalone managed disk has no multiregion protection (Learn: a disk is a single-region resource). The inventory does not show whether the replication is healthy, the Estimated RPO it reaches, what the recovery plans contain, whether a drill was ever run, or what the application does after failover; record those as Unknown until TC-1 and TC-2 have run. The migration is decided per VM, by option id: site-recovery moves the replication to the DR region, redeploy-from-code replaces it for VMs that Site Recovery does not support or that are rebuilt from code, and cross-region-restore-split keeps the pair as the place where backed-up VMs are restored and builds nothing new in the DR region.

### Build
1. site-recovery: take the inventory of every VM and disk in scope with its size, OS and generation, disks (type, size, count, Ultra Disk or Premium SSD v2), zone, availability set and proximity placement group, NICs and IP configuration, load balancer membership, encryption (Azure Disk Encryption, customer-managed keys, encryption at host), managed identities, extensions, tags and the replicated item it has today; check each VM against the support matrix and mark each as site-recovery, redeploy-from-code or cross-region-restore-split; this inventory is what TC-1 compares.
2. site-recovery: check the DR region: the subscription can create VMs there (an allow-list request for a restricted region, for both the source and the target subscription), the VM sizes exist there and quota is enough; request a quota increase first if it is not.
3. site-recovery: create the Recovery Services vault in the DR region (not in the source region, and not in South Central India or North East US 5) with a resource group of its own; its redundancy matters for Backup but not for Site Recovery.
4. site-recovery: grant the roles before the first replication: the platform engineer group gets Site Recovery Contributor on the vault and Virtual Machine Contributor (or specific create-VM, storage and disk write permissions) on the target resource group in the DR region and on the source resource group for failback; a vault is created by an owner or admin; the access administrator role gets Role Based Access Control Administrator (or User Access Administrator) on the target and source resource groups, because Learn says RBAC assignments on the VM are not replicated and that a role must hold the roleAssignments write permission to assign roles (Contributor cannot); give nobody more than these.
5. site-recovery: build the target network in the DR region: virtual network and subnets (same address plan as the source where the application needs it), NSGs, DNS settings, the route to the shared services, an internal load balancer in the recovery virtual network, a public IP or Azure Traffic Manager endpoint as the public entry point (an internet load balancer is not supported in the DR region), and a separate non-production network for drills; give the network engineer role the rights to change the DNS records or Traffic Manager endpoints that the failover steps use.
6. site-recovery: create the cache storage accounts in each source region: General-purpose v2 with ZRS (not GRS), Premium block blob for high-churn VMs, no soft delete, trusted Microsoft services and the source subnets allowed if a firewall is on, and few enough disks per account for the limits of the support matrix.
7. site-recovery: allow outbound HTTPS from the VMs to the Storage, Microsoft Entra ID, Event Hubs and Site Recovery service tags of both regions (and the Automation tag for agent updates), bypass 169.254.169.254 in any proxy, remove any authenticated proxy, and open port 20004 between VMs only for a multi-VM consistency group.
8. site-recovery: create a replication policy for the retention and app-consistent frequency the application needs (default: one day and no app-consistent snapshots; at least one hour between app-consistent points, and shorter than the retention); group VMs only when they need shared recovery points.
9. site-recovery: reserve capacity in the DR region with on-demand capacity reservation groups for the sizes that support it, and assign the group in the target compute settings of each VM.
10. site-recovery: enable replication to the DR region for a pilot of non-production VMs that match the production configurations (up to 10 VMs per run): target region, target subscription, target resource group, failover virtual network and subnet, availability option (fixed once enabled), capacity reservation, High Churn where needed, the replication policy, and automatic agent updates through an Automation account; wait for the initial replication (Learn's planning estimate: 4 hours for 1 TB of a Premium SSD v1 disk).
11. site-recovery: send the Site Recovery resource logs to a Log Analytics workspace, register the built-in Azure Monitor alerts (replication health critical, agent version expiry, failover failure, enable-replication failure), and alert on a latest recovery point older than 60 minutes.
12. site-recovery: build the recovery plan per application: groups in start order (database tier before application tier), a script that associates the internal load balancer, public IP and NSG (Learn: an Azure Automation script in the recovery plan), manual actions for installing the extensions, re-enabling encryption at host and Write Accelerator where used, re-creating the RBAC role assignments (the access administrator) and the DNS or Traffic Manager switch (the network engineer); recovery plans cannot be used for Custom recovery points.
13. cross-region-restore-split: set the Recovery Services vault storage replication to geo-redundant before the first backup is configured, enable Cross Region Restore in its Backup Configuration (it takes up to 48 hours until items appear in the secondary region and it cannot be reverted after protection starts), protect the VMs by a policy, and build in the pair region a staging storage account, virtual network, subnets and quota; grant Backup Operator on the vault and on the subscription of the vault, Contributor on the restore resource group, Virtual Machine Contributor on the source VMs and Storage Account Contributor on the staging account, and, so that restored VMs can be protected again at failback, Backup Operator on the resource group of the vault and Virtual Machine Contributor on each VM; the access administrator role covers the role assignments of the restored VMs.
14. redeploy-from-code: write or complete the templates and scripts for every VM with region and name as parameters; create a second Azure Compute Gallery in another region and replicate each image version the VMs use to the DR region; build the DR network and role assignments, and grant the pipeline identity Virtual Machine Contributor (or the create-VM permissions) in the DR region and in the primary region for failback; choose the data path per disk (application replication, copied incremental snapshots across regions, or backup restore) and run it at the interval the team sets (1h); keep a changelog check that the code deploys the same configuration as production.
15. Record each VM's option, the application owner who accepts the Estimated RPO and Estimated RTO of that option (1 owner per application), and the runbook owner.

### Validate
1. site-recovery: run TC-1 on the pilot and then on every VM once its replication is enabled, daily for seven consecutive days after the initial replication of the last VM finishes.
2. site-recovery: run TC-2 (test failover of the recovery plan into the non-production network, then cleanup) once on the pilot and once on each recovery plan before it is relied on, then quarterly.
3. site-recovery: run TC-3 monthly on the DR region.
4. redeploy-from-code: run TC-3 monthly on the DR region.
5. cross-region-restore-split: run TC-3 monthly on the DR region and on the pair region.
6. redeploy-from-code: run TC-4 in a drill with the primary unreachable from the DR region, and run TC-5 daily for seven days.
7. cross-region-restore-split: run TC-6 weekly once the items are visible in the secondary region, and run TC-7 once in a restore drill, then quarterly.
8. site-recovery: complete TC-8, a design check that is not drillable, and record its result with its date.
9. A time that a drill measured is Demonstrated; the RPO of a VM that no test failover has used and every figure that comes from Learn's SLA stay Estimated.

### Cut over
1. site-recovery: move the production VMs wave by wave (up to 10 VMs per enable-replication run): for each VM in a wave, disable the replication into the pair and enable replication to the DR region with the settings of the pilot; Learn describes one target per replicated item, so the VM has no Site Recovery protection from the disable until its initial replication ends (inference); schedule the wave outside the change window and keep the Backup protection of the VM in place as the interim recovery path; if a wave fails, enable replication into the pair again.
2. site-recovery: after each wave, run TC-1 on the wave and run TC-2 for the recovery plans of its applications before the next wave starts.
3. site-recovery: put the DR region, the vault, the recovery plans and the Failover steps for site-recovery in the runbook, with the incident manager as the person who decides, and write the recovery point rule (Latest processed for a low Estimated RTO, Latest for the lowest Estimated RPO) per application.
4. redeploy-from-code: put the pipeline, its parameters and the Failover steps for redeploy-from-code in the runbook, and name the owner of the data path.
5. cross-region-restore-split: put the restore in the secondary region, with its staging account, virtual network and roles, in the runbook, and record that the workload then runs in the pair region while the other services run in the DR region.

### Decommission
1. site-recovery: only after TC-1 has passed for seven consecutive days and TC-2 has passed for each recovery plan, list what Site Recovery left in the pair region for the replications that were disabled (replica managed disks with the suffix -ASRReplica, the resource group, virtual network and availability set with the suffix asr, the cache storage accounts, the old recovery plans) and remove only the resources that belong to a disabled replication; leave anything that an enabled replication still uses (an ActiveSAS replica disk is in use).
2. site-recovery: delete the old vault only when it holds no replicated item and no backup item.
3. cross-region-restore-split: nothing is decommissioned in the vault; Cross Region Restore stays enabled, and the Site Recovery replication into the pair stays only if the owner decides to keep it next to the Backup restore (a choice of the application owner, because it gives a better Estimated RPO than Cross Region Restore).

### Keep until cut-over
For each VM, the Site Recovery replication into the pair and its Failover steps stay until the wave that moves that VM; the Backup protection and its recovery points of every VM stay for good, as the interim recovery path during the window without Site Recovery protection (Learn says Site Recovery and Backup are interoperable, but a restore of a VM or disk from Backup needs replication to be disabled and enabled again, so the interim path is a restore followed by a new enable-replication); the old vault, its recovery plans and the pair-region network stay until the Decommission step that removes what Site Recovery left in the pair region has run; for cross-region-restore-split everything stays, because it is the DR itself.

## Failover and failback

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Declare DR for the workload and record the time; Site Recovery failover is started by the customer and cannot be left to Microsoft | Incident manager | Estimated unknown (decision time, measured in the first drill) | The declaration is recorded with its time and the affected applications | The primary region answers again before the declaration |
| 2 | site-recovery: check that the region of the vault and the DR region are healthy in Service Health and Resource Health | Platform engineer | Estimated unknown (measured in the first drill) | The vault opens and shows the replicated items as Protected, with the DR region as target | The vault region is down: failover and failback cannot be started from it, so fall back to redeploy-from-code or Backup restore for the affected VMs and open an Azure support request |
| 3 | site-recovery: choose the recovery point per application: Latest processed for a low Estimated RTO, Latest for the lowest Estimated RPO, Latest app-consistent for application consistency; do not tick a shutdown that cannot happen | Application owner | Estimated unknown (decision time, measured in the first drill) | The time stamp of the recovery point is shown and its age is compared with the Estimated RPO bound in the runbook | The age exceeds the Estimated RPO bound: the application owner decides whether to go on and records the decision |
| 4 | site-recovery: start the failover of the recovery plan to the DR region, with the option to shut down the source machines (the failover continues if the shutdown fails) | Platform engineer (Site Recovery Contributor on the vault, Virtual Machine Contributor in the DR region) | Estimated 1h (Learn: the RTO SLA of one hour from the trigger until the target VM runs, excluding scripts and manual actions; TC-2 measures the plan) | The failover job succeeds and every VM of the plan exists and is running in the target resource group of the DR region | A job fails: retry at least every 30 minutes (Learn's SLA condition) and check capacity and quota; a size has no capacity: start that VM on the redeploy-from-code path or open a support request |
| 5 | site-recovery: run the post-failover steps of the recovery plan: associate the internal load balancer, public IP and NSG (script of the plan), then install extensions, re-create the RBAC role assignments, re-enable encryption at host and Write Accelerator, and set the Windows Client license (manual actions) | Platform engineer; access administrator (role assignments only) | Estimated unknown (measured in TC-2) | Every extension is installed and enabled, the role assignments exist, and the VMs answer on their private IP addresses | A script fails: do it by hand from the runbook and record the gap |
| 6 | site-recovery: switch the entry point to the DR region (DNS record or Traffic Manager endpoint) and validate the application | Network engineer | Estimated unknown (the DNS or endpoint time-to-live the team sets; measured in the first drill) | The application's synthetic transaction succeeds through the DR entry point | The transaction fails: keep the old endpoint disabled, fix the application, and do not commit |
| 7 | site-recovery: commit the failover when the application owner accepts it; commit deletes the recovery points | Platform engineer | Estimated unknown (measured in the first drill) | The VM status is Failover committed | The application owner is not satisfied: use Change recovery point instead of commit |
| 8 | redeploy-from-code: run the pipeline that deploys the VMs and the DR network parameters in the DR region, restore or promote the data from the replicated copy, and validate | Platform engineer | Estimated 4h (the redeploy time the team sets; TC-4 proves it) | The pipeline succeeds, the data copy is no older than the Estimated RPO of the option, and the application's synthetic transaction succeeds | A VM size has no quota or capacity: choose the next size in the runbook or open a quota request; the data copy is older than the Estimated RPO: the application owner decides |
| 9 | cross-region-restore-split: in the secondary region of the vault, choose the latest recovery point of each VM and start Create a VM or Restore disks into the staging account, virtual network and resource group of the pair region (a triggered job cannot be canceled) | Backup administrator (Backup Operator on the vault and on the subscription of the vault, Contributor on the restore resource group, Virtual Machine Contributor on the source VM, Storage Account Contributor on the staging account) | Estimated unknown (Learn: almost the vault-tier restore time of the primary region, no figure) | The restore job succeeds, the VM boots, and the newest recovery point is no older than 36 hours | The chosen recovery point or target is wrong: confirm before starting, because the job cannot be canceled; the job fails: restart with another recovery point |
| 10 | cross-region-restore-split: rebuild what a restore does not carry (extensions, RBAC role assignments, static IP address, availability set) and reconnect the VM to the services in the DR region | Platform engineer; access administrator (role assignments only) | Estimated unknown (measured in TC-7) | Extensions are enabled, role assignments exist and the application's synthetic transaction succeeds | A dependency in the DR region is not reachable from the pair region: the network engineer opens the path |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region is healthy, resources can be created and accessed in it, and the failed-over VMs are committed | Incident manager | Estimated unknown (measured in the first drill) | Service Health shows the primary region healthy and every failed-over VM shows Failover committed | The primary region is still impaired: stay in the DR region |
| 2 | site-recovery: reprotect the VMs from the DR region to the primary region (check the target settings; resources marked new are created) | Platform engineer (Site Recovery Contributor on the vault, Virtual Machine Contributor in the primary region) | Estimated unknown (Learn: usually a few hours when the source data still exists, at least the duration of the original enable-replication job, plus checksum transfer, one fifth of that time for recovery points, and 20 to 30 minutes for auto scale) | The reprotect job succeeds and the VMs show Protected with replication from DR to primary | Source VM data is deleted or inaccessible: Learn says reprotection is not supported, so disable the protection and enable a new protection from the current region |
| 3 | site-recovery: stop writes in the DR region, wait for the last data to be sent, and shut down the source VM in the primary region | Application engineer | Estimated unknown (the maintenance window the team sets; measured in the first drill) | The source VM is shut down and the application is quiet | The source VM cannot be shut down: Learn says a running source VM makes the failback fail, so do not start it |
| 4 | site-recovery: fail over from the DR region to the primary region with Latest, and shut down the DR machines first | Platform engineer | Estimated unknown (Learn: failback takes about as long as the failover did) | The VMs run in the primary region and the failover job succeeds | The job fails: stay in the DR region and retry after checking the source VM state |
| 5 | site-recovery: re-run the post-failover steps (script of the plan for load balancer, public IP and NSG; manual actions for extensions, role assignments and encryption settings), switch the entry point back, and commit the failback (Learn's reprotect article requires status Failover committed before reprotection, while the failback tutorial lists no commit step; the stricter reading applies) | Platform engineer; access administrator (role assignments only); network engineer (entry point) | Estimated unknown (measured in the first drill) | The application's synthetic transaction succeeds through the primary entry point and the VM status is Failover committed | The transaction fails: switch back to the DR entry point and do not commit |
| 6 | site-recovery: reprotect the VMs from the primary region to the DR region and wait until TC-1 passes | Platform engineer | Estimated unknown (Learn: initial data and then delta replication; as the failback step that reprotects the VMs from the DR region to the primary region) | TC-1 passes for the VMs | The reprotect fails: enable replication again from the primary to the DR region and track the initial replication time |
| 7 | redeploy-from-code: redeploy the VMs in the primary region from code, copy the data back by the data path of the option, switch the entry point and remove the DR deployment | Platform engineer | Estimated 4h (the redeploy time the team sets) | The synthetic transaction succeeds through the primary, and the data in the primary is newer than the last DR write | The data copy back fails: keep the DR deployment |
| 8 | cross-region-restore-split: move the workload and its data back to the primary region by the application's own means (Learn describes no Cross Region Restore failback, an inference), protect the VM again with the backup policy of the vault, and decommission the VMs in the pair region | Application engineer | Estimated unknown (no Learn figure) | The VM runs in the primary region, shows a backup item in the vault and a recovery point, and the pair-region VMs are removed | The data cannot be moved back: stay in the pair region |

## Test criteria

### TC-1: Replicated VMs are protected in the DR region and inside the recovery point bound
- Applies to: site-recovery
- Pass condition: 100% of the VMs of the inventory have a replicated item in the vault with the DR region as target; none has replication health Critical or a latest recovery point older than 60 minutes; for seven consecutive days the logged recovery point objective of each VM stays at or below the Estimated RPO of 5m of the option (a pass or fail check; Learn: no defined SLA for RPO), and the highest logged value of each VM over the period is recorded in the runbook as the Demonstrated RPO; every VM runs a mobility agent that is not more than four versions behind.
- How to measure: read the replicated items of the vault in the portal, PowerShell or the REST API (the Azure CLI is not supported), and run a log query on the Site Recovery resource logs in the Log Analytics workspace for the logged Estimated RPO, replication health and agent versions; compare the list with the inventory.
- Evidence: per VM, an export of the replicated item with its target region, health, latest recovery point time and agent version; per vault, the list of inventory VMs without a replicated item (must be empty); per disk, the replica disk with its type; the daily series of the logged Estimated RPO.
- Frequency: daily

### TC-2: A test failover of the recovery plan starts the application in the DR region
- Applies to: site-recovery
- Pass condition: a test failover of each recovery plan into the non-production network completes, every VM of the plan runs in the target region, the application's synthetic transactions succeed, the post-failover steps (extensions, role assignments, load balancer, public IP, NSG) leave no gap, and the duration of the Site Recovery job plus the post-steps is within the Estimated RTO that the application owner records in the runbook (1h is Learn's RTO SLA for the VM failover alone, and the post-steps come on top); the test VMs are cleaned up afterwards.
- How to measure: run the test failover with Latest processed and once with Latest app-consistent, read the job duration in Site Recovery jobs (the test failover of a recovery plan is how Learn finds the Estimated RTO of the plan), add the time of the scripts and checks, and run the synthetic transactions; run cleanup and save the notes.
- Evidence: the job record with its duration and the chosen recovery point, the test result of each synthetic transaction, the list of post-failover gaps, and the cleanup record; per VM and per disk, the list of resources created and deleted.
- Frequency: quarterly

### TC-3: The DR region has the capacity, quota and settings that the options need
- Applies to: site-recovery, redeploy-from-code, cross-region-restore-split
- Pass condition: for every VM of the inventory the VM size and disk type exist in the DR region (and in the pair region for cross-region-restore-split) with quota for the total vCPUs of the inventory; for each size that supports Capacity Reservation the reservation exists and covers the VM count the team sets in the runbook; the target network, subnets, NSGs and DNS exist and match the plan; the images and templates of redeploy-from-code deploy a VM in the DR region without error.
- How to measure: compare the inventory with the VM SKU availability and the quota of the DR region, list the capacity reservation groups and their allocated counts, and run the deployment of the templates in what-if or test mode.
- Evidence: the comparison table by VM size with quota and reservation, the network checklist, and the deployment result.
- Frequency: monthly

### TC-4: The VMs are redeployed from code in the DR region within the Estimated RTO
- Applies to: redeploy-from-code
- Pass condition: in a drill with the primary unreachable from the DR region, the pipeline deploys every VM of the option in the DR region without manual steps, the data is restored from the replicated copy, the application's synthetic transactions succeed, and the time from the start of the drill to the first successful transaction is within the Estimated RTO of 4h of the option.
- How to measure: a drill that blocks the primary from the DR region and times the pipeline and the data restore.
- Evidence: the pipeline run with its timestamps, the deployed VM list with its sizes and disk types, the data restore log, and the measured time.
- Frequency: every DR drill, and after every change to the templates, images or DR network

### TC-5: The data copy stays inside the Estimated RPO
- Applies to: redeploy-from-code
- Pass condition: for seven consecutive days the age of the newest replicated copy of each stateful disk or database stays at or below the Estimated RPO of 1h of the option.
- How to measure: compare the time of the last change in the primary with the time of the newest copy in the DR region (the snapshot copy time, the replication lag of the application) and add one canary write that is made every day.
- Evidence: the seven-day export per disk or database with the maximum age; per standalone disk, the newest snapshot copy and its region.
- Frequency: daily

### TC-6: Cross Region Restore is enabled and every VM has a recent recovery point in the secondary region
- Applies to: cross-region-restore-split
- Pass condition: every VM of the inventory has a backup item that is visible under Secondary Region in the Recovery Services vault; the vault uses geo-redundant storage with Cross Region Restore enabled; the newest recovery point of each item in the secondary region is no older than 36 hours; no VM of the option uses a managed identity or an Ultra Disk.
- How to measure: read the vault's Backup Configuration and the backup items of the secondary region in the portal or by REST, list the recovery points per item, and check the inventory for managed identities and Ultra Disks.
- Evidence: the vault configuration, the list of items with the newest recovery point time in the secondary region, and the list of VMs that fail the managed identity or Ultra Disk check.
- Frequency: weekly

### TC-7: A VM is restored in the paired region and starts
- Applies to: cross-region-restore-split
- Pass condition: a restore of one VM per application in the secondary region (Create a VM, or Restore disks and create the VM) completes into the staging account, virtual network and resource group of the pair region with the roles that Build granted; the VM boots, the post-restore gaps (extensions, RBAC, static IP, availability set) are rebuilt, the application's synthetic transactions succeed, and the measured restore time, including the rebuild of the gaps, is within the Estimated RTO of 24h of the option and is recorded as the Demonstrated RTO.
- How to measure: run the restore from the Secondary Region view of the vault with a recovery point of the last 36 hours, time the job and the rebuild, and run the synthetic transactions; delete the restored VM afterwards.
- Evidence: the restore job record with its timestamps and the recovery point used, the post-restore gap list, the synthetic transaction result, and the measured time.
- Frequency: quarterly

### TC-8: The failback path is ready (design check, not drillable)
- Applies to: site-recovery
- Pass condition: two parts. Design check, not drillable: Learn describes reprotection and failback only after a failover has been committed, so they cannot be rehearsed by a test failover; the check passes when the runbook names the person who shuts down the source VM, the roles that create VMs in the primary region, the reprotect settings, and the vault region that is not the primary region. Measured: the runbook records the duration of the original enable-replication job per VM (Learn: the minimum of the checksum time of a reprotection) and the number it implies for the reprotect window.
- How to measure: review the runbook and the role assignments in the primary region, read the duration of each enable-replication job in Site Recovery jobs, and compute the reprotect window from them.
- Evidence: the review record with its date, the role assignment list, and the table of enable-replication durations per VM.
- Frequency: quarterly
