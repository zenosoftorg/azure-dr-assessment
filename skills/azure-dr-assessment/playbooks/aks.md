---
service: aks
title: Azure Kubernetes Service
arm_types:
  - microsoft.containerservice/managedclusters
slot: compute
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-aks
  - https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support
  - https://learn.microsoft.com/en-us/azure/aks/reliability-multi-region-deployment-models
  - https://learn.microsoft.com/en-us/azure/aks/active-passive-solution
  - https://learn.microsoft.com/en-us/azure/aks/passive-cold-solution
  - https://learn.microsoft.com/en-us/azure/aks/quotas-skus-regions
  - https://learn.microsoft.com/en-us/azure/aks/manage-azure-rbac
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/containers
  - https://learn.microsoft.com/en-us/azure/kubernetes-fleet/overview
  - https://learn.microsoft.com/en-us/azure/kubernetes-fleet/faq
  - https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-backup-overview
  - https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix
  - https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-concept
  - https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup
  - https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-restore
  - https://learn.microsoft.com/en-us/azure/backup/tutorial-restore-aks-backups-across-regions
---

# Azure Kubernetes Service

## Mechanisms

### Multi-region deployment models
- Replicates: nothing by itself. Learn's three models (active-active, active-passive, passive-cold) are two independent AKS clusters in two Azure regions that the customer builds and operates; the application state is replicated by the data services the workload uses (Learn's guidance is to "plan for application state across multiple clusters" and to "replicate storage across multiple regions"). Paired and Nonpaired: Learn says the two regions are "typically paired regions" and names no pair requirement; it does not say that non-paired regions work, so Paired yes is Learn's example and Nonpaired yes is this playbook's inference
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: unknown (Learn gives no figure: its table lists "no data loss or inconsistency during failover" as a pro of active-active, "potential for data loss or inconsistency during failover" for active-passive and "high risk of data loss or inconsistency during failover" for passive-cold; the figure is that of the data services behind the clusters)
- Estimated RTO: unknown (Learn gives no figure; it lists a longer recovery time for active-passive than for active-active and the longest for passive-cold, and no recovery time for any model)
- Source: https://learn.microsoft.com/en-us/azure/aks/reliability-multi-region-deployment-models#multi-region-deployment-model-implementations

### Azure Kubernetes Fleet Manager
- Replicates: no data. Learn describes Fleet Manager here as a way to manage a set of AKS clusters in multiple Azure regions as a single unit, automate cluster and node image upgrades and spread traffic across the clusters; it describes no replication of application data or persistent volume content, so this playbook treats those as not covered (inference). The Paired and Nonpaired answers rest on Learn's multiregion reference (see the constraint on that reference)
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: unknown (Learn gives no figure and describes no data replication by Fleet Manager)
- Estimated RTO: unknown (Learn gives no figure; the customer creates the fleet, joins the clusters and configures the traffic distribution, and Learn says these traffic distribution capabilities can then "automatically fail over if a region is unavailable", so the failover is customer-configured and automatic once configured)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-aks#custom-multiregion-solutions-for-resiliency

### AKS backup with Cross Region Restore
- Replicates: the cluster state (cluster resources in a blob container) and the Azure Disk persistent volumes (as disk snapshots, one recovery point per day moved to the Vault Tier) into a geo-redundant Backup vault, which copies the Vault Tier recovery points to the Azure paired region; restore is into an AKS cluster of the paired region
- Paired: yes
- Nonpaired: no
- Failover: manual
- Estimated RPO: 36h (Learn: in the Vault Tier "only one scheduled recovery point is created per day, providing a Recovery Point Objective (RPO) of upto 24 hours in the primary region", and replication to the secondary region "can take up to 12 another hours, resulting in an effective RPO of up to 36 hours")
- Estimated RTO: unknown (Learn gives no restore duration; a restore needs a target cluster that already exists, a staging location and a hydration step, and snapshot and restore of Premium SSD v2 and Ultra Disks "may take longer")
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#supported-scenarios-and-limitations-specific-for-vaulted-backup-and-cross-region-restore

### Availability zone support
- Replicates: nothing across regions. The control plane is zone resilient by default; node pools need zones enabled, and data on Azure disks needs zone-redundant storage to be replicated across zones. This is an in-region mechanism and does not protect against a region failure
- Paired: no
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: 0 (Learn: with zone-redundant storage "a zone failure isn't expected to cause any data loss"; an expectation, not a measured value)
- Estimated RTO: 0 (Learn: when zone resiliency is configured correctly for the cluster and pods, "a zone failure isn't expected to cause downtime for your AKS workload"; an expectation, not a measured value; the control plane fails over by itself, node pools need the autoscaler)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-aks#resilience-to-availability-zone-failures

## Constraints

### An AKS cluster is a single-region resource
Learn: "AKS clusters are single-region resources. If the region is unavailable, your AKS cluster is also unavailable." Learn names no Microsoft-managed failover of a cluster to another region, so there is nothing for the customer to wait for: a regional failover needs a second cluster (Fleet Manager or a manual active-active or active-passive model) or a restore from backup into another cluster.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-aks#resilience-to-region-wide-failures

### Availability zones and node redundancy do not protect against a region failure
Learn: by default AKS provides high availability by using multiple nodes in a Virtual Machine Scale Set, "but these nodes don't protect your system from a region failure".
- Source: https://learn.microsoft.com/en-us/azure/aks/reliability-multi-region-deployment-models#scope-definition

### Availability zone support is fixed when the cluster is created
Learn: you "can't enable availability zone support after you create a cluster" and cannot disable it either; the way to change it is to create a new cluster and delete the existing one. A DR cluster that is meant to be zone resilient is therefore created with zones from the start, in a DR region that supports availability zones.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-aks#configure-availability-zone-support

### The multiregion reference lists Fleet Manager for paired and nonpaired regions and AKS backup for paired regions only
Learn's list of services that support multiple regions marks Azure Kubernetes Fleet Manager for both paired and nonpaired regions ("manages multiple AKS clusters across regions with centralized orchestration and multi-cluster workload routing") and the AKS backup row for paired regions only ("with support for restoring to a paired region using the Vault Tier").
- Source: https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support

### Learn names three multi-region deployment models
Active-active (two clusters that both serve traffic; pros: no data loss or inconsistency during failover; cons: complex, higher cost, needs a load balancer and traffic routing), active-passive (only one cluster serves traffic; cons: potential for data loss or inconsistency, longer recovery time, underutilized resources) and passive-cold (the cold cluster is inactive until a user activates it; lowest cost; "requires manual intervention to activate cluster and trigger backup"). The page calls passive-cold "out-of-scope" for its own recommendations.
- Source: https://learn.microsoft.com/en-us/azure/aks/reliability-multi-region-deployment-models#multi-region-deployment-model-implementations

### Learn names region pairs as examples, not as a requirement
The deployment models page describes two independent AKS clusters "in two different Azure regions (typically paired regions...)", and the active-passive and passive-cold solution overviews describe their example architectures as "two paired Azure regions". None of these says a cluster pair must be a region pair, and Fleet Manager joins clusters "in any Azure subscription and region" (see the constraint on joining member clusters). This playbook therefore treats a DR cluster in a region that is not the primary's pair as workable (inference); the DR region still has to pass the regional availability, capacity and quota checks.
- Source: https://learn.microsoft.com/en-us/azure/aks/reliability-multi-region-deployment-models#active-passive-disaster-recovery-deployment-model

### The active-passive model needs a traffic router, although Learn's table says it does not
The comparison table lists as a pro of active-passive that it "doesn't require a load balancer or traffic manager". The same page's active-passive architecture routes all traffic through Azure Front Door ("All traffic must go through the Azure Front Door traffic manager for this system to work") and uses priority-based routing. The pages disagree; this playbook follows the stricter statement and designs a global traffic router (or Fleet Manager DNS-based load balancing) for active-active and active-passive.
- Source: https://learn.microsoft.com/en-us/azure/aks/reliability-multi-region-deployment-models#active-passive-disaster-recovery-deployment-model

### The secondary cluster has to absorb the whole load
Learn's guidance for a regional failover: right-size network and compute resources "to absorb any sudden increase in traffic due to region failover" (for Azure CNI, a subnet that supports all pod IPs under a spiked load), use the Horizontal Pod Autoscaler to increase the replica count and the cluster autoscaler to increase the node count.
- Source: https://learn.microsoft.com/en-us/azure/aks/active-passive-solution#failover-process

### The secondary application is autoscaled to the primary's instance count
Learn's active-passive steps: configure autoscaling rules for the secondary application so it "scales to the same instance count as the primary when the primary region becomes inactive"; while inactive it does not need to be scaled up, which helps reduce costs.
- Source: https://learn.microsoft.com/en-us/azure/aks/reliability-multi-region-deployment-models#active-passive-disaster-recovery-deployment-model

### A cold cluster is not suited to time-sensitive applications
Learn: the cold cluster "can take a couple minutes to come online, as it has been turned off and needs to complete the setup process. This approach isn't ideal for time-sensitive applications"; for those Learn points to active-active. The activation condition is set by manual input every time or by an event the customer specifies.
- Source: https://learn.microsoft.com/en-us/azure/aks/passive-cold-solution#failover-process

### Learn offers no way to take a whole region down for a test
Learn: "no mechanisms currently exist within AKS to take down an entire region of deployment for testing purposes"; Azure Chaos Studio can simulate an availability zone outage for the node pools. A regional failover of the cluster is therefore not drillable by removing the region; what can be drilled is the switch-over to the secondary cluster (traffic, scale-out, dependencies) and a restore.
- Source: https://learn.microsoft.com/en-us/azure/aks/active-passive-solution#failover-testing-strategy

### Regional capacity, VM sizes and subscription quota can block a deployment
Learn: "Even in supported regions, regional capacity, VM version availability, and subscription quota can affect deployment." Learn also gives per-region cluster quotas per subscription type and says upgrades temporarily consume extra IP addresses and vCPU quota. The DR region's quota and the node VM size are checked before DR, and no figure proves that capacity is free during a regional event.
- Source: https://learn.microsoft.com/en-us/azure/aks/quotas-skus-regions#region-availability

### The SLA applies to the Standard and Premium tiers only
Learn: the SLA applies "only if you deploy a cluster in the Standard or Premium pricing tier"; the Free tier "enables you to use AKS to test your workloads". A DR cluster for production uses the tier of the primary.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-aks#service-level-agreement

### The customer owns everything outside the cluster
Learn: Microsoft manages the control plane and other managed components; it is the customer's responsibility to "manage any components outside of the AKS cluster, including storage and databases" and verify they meet the reliability requirements. A cluster failover does not move the databases, storage or secrets that the workload uses; each is covered by its own playbook.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-aks#reliability-architecture-overview

### Learn recommends stateless clusters and external state
Learn: "Strive to use stateless clusters that minimize the need for backup. Store data in external storage systems and databases instead of within your cluster." Backups complement availability; they recover cluster resources and persistent volume data after deletion or corruption.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-aks#backup-and-restore

### Learn's reference architecture has regional Key Vault, registry replication and regional monitoring
In the active-passive architecture: a hub-spoke pair per regional cluster with Azure Firewall Manager policies, an Azure Key Vault "in each region", regional Log Analytics instances, and a single Azure Container Registry whose geo-replication replicates images to the selected regions so images stay available during a regional outage.
- Source: https://learn.microsoft.com/en-us/azure/aks/active-passive-solution#components

### Fleet Manager joins clusters of any region in the same tenant
Learn: Fleet Manager allows adding any AKS cluster "in any Azure subscription and region as long as the Azure subscription is associated with the same Microsoft Entra ID tenant as the Fleet Manager". Cluster resource placement (ClusterResourcePlacement) propagates cluster-scoped resources and whole namespaces to member clusters; ResourcePlacement propagates namespace-scoped resources.
- Source: https://learn.microsoft.com/en-us/azure/kubernetes-fleet/faq#what-kubernetes-clusters-can-i-join-as-members

### Fleet Manager is itself a regional resource
Learn: "Fleet Manager is a regional resource. Support for region failover for disaster recovery use cases is on the roadmap." So the Fleet Manager resource (and its hub cluster, when there is one) is a regional dependency of the multi-cluster tooling; it is placed in a region that is not the primary's, and the DR runbook must work without it (inference).
- Source: https://learn.microsoft.com/en-us/azure/kubernetes-fleet/faq#is-fleet-manager-a-regional-or-global-resource

### Fleet Manager traffic and networking features are preview
Learn lists DNS-based load balancing across service endpoints on multiple AKS clusters and cross-cluster networking as "(preview)" capabilities of Fleet Manager, next to its multi-cluster updates and resource placement.
- Source: https://learn.microsoft.com/en-us/azure/kubernetes-fleet/overview

### AKS backup reaches the paired region only, through the Vault Tier
Learn: the Disaster Recovery feature "is only available between Azure Paired Regions" with a geo-redundant Backup vault that has Cross Region Restore enabled, and "the backup data is only available in an Azure paired region". Learn describes no AKS backup restore into a region that is not the pair.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#supported-scenarios-and-limitations-specific-for-vaulted-backup-and-cross-region-restore

### A restore into another region uses a Vault Tier backup and a staging location
Learn's overview: "Only backups stored in the Vault Tier can be used to do a restore to a cluster in a different region (Azure-paired region)". To restore a Vault Tier backup you must provide a staging location where the backup data is hydrated, "a resource group and a storage account within the same region and subscription as the target cluster"; the hydration resources (blob container, disk, disk snapshots) are created during the restore.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-backup-overview#restore-from-a-backup

### Operational Tier restores stay in the region of the backups
Learn: when restoring from the Operational Tier, "the target AKS cluster must be in the same region as the backups"; a different region (within an Azure paired region) is possible only for Vault Tier backups in a geo-redundant vault with Cross Region Restore enabled.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#supported-scenarios

### Vault Tier availability is a per-region list, separate from the region pair
Learn: Operational Tier backups are available in all Azure public regions and Azure Government clouds, and Vault tier backups "are available in all Azure public regions except Indonesia Central, Malaysia South, Mexico Central, Qatar Central, Southeast US, and West India", and not in Azure Government clouds. This is a list of where Vault tier backup is offered; it does not say how it applies to the secondary region of a pair, so both the primary region and its pair are checked against it (inference).
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#supported-regions

### The Vault Tier gives one scheduled recovery point per day and an effective Estimated RPO of up to 36 hours
Learn, the basis of the Estimated RPO of the option: one scheduled recovery point per day, up to 24 hours in the primary region plus up to 12 more hours for replication to the secondary region, "resulting in an effective RPO of up to 36 hours"; moving an Operational Tier backup into the Vault Tier "may take up to four hours" to begin. The Operational Tier supports a minimum frequency of 4 hours, but only the first successful backup in a 24-hour period is eligible for the Vault Tier.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#supported-scenarios-and-limitations-specific-for-vaulted-backup-and-cross-region-restore

### On-demand backups can be moved to the Vault Tier
Learn: for scheduled backups only one recovery point per day is eligible to be transferred to the Vault Tier, but "you can move any number of on-demand backups to the Vault Tier by associating them with a retention rule in the policy that has Vault Tier storage enabled". The support matrix limits on-demand backups to 10 per day per backup instance.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-backup-overview#which-backup-storage-tier-does-aks-backup-support

### Geo-redundancy and Cross Region Restore cannot be turned off
To protect clusters from a regional outage the Backup vault is created with the backup storage redundancy Geo-Redundant and the Cross Region Restore parameter Enabled. Learn: "Once the redundancy for a vault is set, you can't disable it", and the same for Cross Region Restore. Every recovery point stored in the Vault-standard datastore of such a vault is in the secondary region. The Learn tutorial calls the redundancy "Globally Redundant" in the portal.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup#create-a-backup-vault

### The Vault Tier covers Azure Disk volumes only and disks must be eligible
Learn: Vault Tier support is available only for Azure Disk-based volumes, with disks up to 1 TB ("disks with the higher size are skipped"), up to 100 disks per backup instance, and only disks with public network access enabled, Microsoft Entra data access authentication disabled and no Disk Encryption Set; otherwise "the tiering operation will fail".
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#supported-scenarios-and-limitations-specific-for-vaulted-backup-and-cross-region-restore

### Azure Files volumes have no cross-region path
Learn: Azure Files volumes are backed up to the Operational Tier only (maximum retention 30 days), a backup instance with different targets for disks and files needs separate backup instances, and "Azure Files-based volumes can only be restored to clusters within the same subscription and region. Cross-region and cross-subscription restore is not supported for Azure Files volumes."
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-restore#before-you-start

### Only CSI Azure Disk and Azure Files (SMB) volumes are backed up
Learn: unsupported persistent volume types (in-tree volumes, Azure Files NFS, Azure Blob and Azure Container Storage volumes) "are automatically skipped during the backup process". The namespaces `kube-system`, `kube-node-lease`, `kube-public` and `gatekeeper-system` are skipped and cannot be configured. The how-to article lists only the first three; the pages differ and this playbook follows the support matrix, which lists more.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#unsupported-scenarios-and-limitations

### Limits per backup instance and vault
Learn's limits: 800 namespaces per backup instance, 10 on-demand backups per day per backup instance, 10 restores per day per backup instance, 5,000 backup instances and 5,000 policies per Backup vault.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#unsupported-scenarios-and-limitations

### The Backup vault must be in the cluster's region, and the pages differ on subscriptions
Learn's backup overview: "The Backup vault and the AKS cluster that you want to back up or restore must be in the same region and subscription." The support matrix and the how-to article say the vault and the cluster can be in different subscriptions within the same tenant. The pages disagree; this playbook follows the stricter statement and keeps the vault and the extension's storage account in the region and subscription of the cluster that is backed up. The restore target in the pair region is a different cluster, reached through the Vault Tier copy in the secondary region.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-backup-overview#configure-backup

### The overview and the support matrix differ on the subscription of a restore target
The overview says in its description of how AKS backup works that you can restore to the original cluster or to a different cluster "in the same subscription and region", and says in its section on restoring that backups of the Operational Tier and the Vault Tier can be restored "to a cluster in the same or a different subscription"; the support matrix says the target can be in a different subscription (Cross-Subscription Restore). The pages (and the overview itself) disagree; this playbook restores into a target cluster in the subscription of the source cluster unless a drill has shown another subscription to work.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-backup-overview#how-does-aks-backup-work

### The Backup extension must be installed in the source and the target cluster
Learn: the extension (namespace `dataprotection-microsoft` by default) is needed "on both the source cluster to be backed up and the target cluster where backup is to be restored"; it creates a user-assigned managed identity in the node pool resource group; the `Microsoft.KubernetesConfiguration` resource provider must be registered; a storage account with a blob container that holds only backup files is the backup location, and the Backup vault must have Trusted Access to the cluster, with the predefined role `Microsoft.DataProtection/backupVaults/backup-operator`.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-concept#backup-extension

### Cluster prerequisites of AKS backup
Learn's support matrix: clusters on a service principal are not supported (system-assigned or user-assigned managed identity is); CSI drivers and snapshots must be enabled; the extension installs only on Linux (Ubuntu or Azure Linux) node pools, not on Windows node pools; the extension's storage account must be in the cluster's region and be General-purpose v2 (Premium storage accounts are not supported); a private-network cluster needs a private endpoint for backup operations; both the cluster and the extension pods must be running and healthy before any backup or restore.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#supported-scenarios

### Roles that AKS backup and restore need
Learn's roles table: Reader for the Backup vault on the AKS cluster and on the snapshot resource group; Contributor for the AKS cluster on the snapshot resource group; Storage Blob Data Contributor for the extension identity on the backup storage account; Data Operator for Managed Disks and Disk Snapshot Contributor for the Backup vault on the snapshot resource group; Storage Blob Data Reader for the Backup vault on the storage account; for Vault Tier restore, Contributor for the Backup vault on the staging resource group and Storage Account Contributor plus Storage Blob Data Owner on the staging storage account. For the user: Owner on the cluster, Backup Contributor on the vault's resource group, and Owner on the storage account and the snapshot resource group as the preferred roles. The backup overview says the extension identity gets the Storage Account Contributor role on the backup storage account instead; the pages disagree and Build grants both on that one storage account.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-concept#required-roles-and-permissions

### A restore needs an existing target cluster and a staging location
Learn: restore goes "to the original AKS cluster (the backed-up cluster) and to an alternate AKS cluster"; Azure Backup "doesn't automatically scale out AKS nodes - it only restores data and associated resources", so the target cluster has to exist and have enough resources. To restore a Vault Tier backup, a storage account is provided as the staging location.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-restore#before-you-start

### Staging resources are not cleaned up by the restore job
The overview says the hydration resources "are cleared after the restore operation is complete". The restore article and the support matrix say the restore job "doesn't automatically clean up the resources hydrated in the staging resource group and storage account. Delete these resources manually." The pages disagree; this playbook follows the stricter statement.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-restore#restore-the-aks-clusters

### The staging storage account of the secondary-region restore needs public access
The tutorial for the restore in the secondary region says that "resources created in the staging location can't belong within a Private Endpoint" and to "enable public access on the storage account provided as a staging location"; the restore is tracked as a backup job named CrossRegionRestore, and the Restore Region is set to Secondary Region.
- Source: https://learn.microsoft.com/en-us/azure/backup/tutorial-restore-aks-backups-across-regions#restore-in-secondary-region

### The support matrix differs on staging network access
The support matrix says staging storage accounts are supported "regardless of whether public network access is enabled or disabled" and asks for a private endpoint between a target cluster in a private virtual network and the staging storage account. This differs from the tutorial's statement (see the constraint on the staging storage account of the secondary-region restore). This playbook follows the tutorial for the secondary-region restore and proves any private-cluster target in the restore drill (TC-9).
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#supported-scenarios-and-limitations-specific-for-vaulted-backup-and-cross-region-restore

### Restore conflicts and existing resources
Learn: on a name clash a restore skips by default (or patches mutable fields), and AKS backup "doesn't currently delete and re-create resources in the target cluster if they already exist"; to restore Persistent Volumes in the original location, delete the existing ones first.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-backup-overview#restore-from-a-backup

### A restore into a cluster of another version may fail or warn
Learn: if the target AKS cluster version differs from the version used during backup, the restore operation "may fail or complete with warnings", for example for deprecated resources in the newer version.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#supported-scenarios-and-limitations-specific-for-vaulted-backup-and-cross-region-restore

### Snapshots are crash consistent
Learn: the persistent volume snapshots of the Operational Tier backup are crash consistent by nature, and AKS backup does not take snapshots of all volumes at the same instant.
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-cluster-backup-support-matrix#supported-scenarios

### Custom hooks give application-consistent snapshots
Learn: custom backup hooks (PreHooks and PostHooks) run commands in a pod to take application-consistent snapshots of volumes used by databases deployed as containers, and restore hooks run commands after a restore; "if you're performing restore to the same namespace that was backed up, the restore hook isn't executed".
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-backup-overview#restore-hooks

## Non-paired options

### secondary-cluster: Second AKS cluster in the DR region with traffic routing
- Kind: workaround
- Target: dr-region
- Uses mechanism: Multi-region deployment models
- Estimated RPO: 15m (Estimated, team-set starting value: the interval the team sets within which a change to the desired state of the primary cluster, that is its manifests, node pool settings and configuration, reaches the DR cluster; it covers cluster definitions only: persistent and application data have the Estimated RPO of the external data services they live in, which Learn does not set for AKS; TC-3 proves it)
- Estimated RTO: 30m (Estimated, team-set starting value: the switch-over target the team sets for scaling the DR cluster to the load of the primary and moving traffic; Learn gives no figure for it; TC-5 proves it)
- Prerequisites: a DR region where AKS is offered and where regional capacity, the node VM size and subscription quota are checked, with availability zones when the DR cluster is to be zone resilient (fixed at creation); the Standard or Premium tier like the primary; a DR virtual network with room for all pod and node IP addresses at the primary's load; a traffic router for active-active and active-passive (Azure Front Door priority routing in Learn's architecture, or the preview Fleet Manager DNS-based load balancing), whose own DR is in its playbook; a Key Vault, a Log Analytics workspace and a geo-replicated registry replica in the DR region (their own playbooks); the data services already replicated or failed over to the DR region (their own playbooks); one source of truth (repository and pipeline, or Fleet Manager cluster resource placement) that deploys the same manifests to both clusters; managed Microsoft Entra integration with Azure RBAC for Kubernetes authorization on the DR cluster, and the roles Azure Kubernetes Service Contributor Role (platform engineers) and Azure Kubernetes Service RBAC Cluster Admin (break-glass group); an inventory of every persistent volume with its DR path (TC-1).
- Cost notes: the DR cluster (nodes at the level of the chosen model: Learn lists active-active as higher cost, active-passive as lower cost and passive-cold as lowest cost), the traffic router, registry geo-replication, regional Key Vault and Log Analytics, cross-region data replication and traffic; no price.
- Gives up: the replication of in-cluster persistent volume content (Learn names no cross-region replication of in-cluster state other than AKS backup, and its guidance is to "plan for application state across multiple clusters" and "replicate storage across multiple regions", so state lives in external services or is replicated by the application); simplicity (two clusters to build, upgrade and keep in step, so drift is a risk); for passive-cold, manual activation and a longer recovery, which Learn says is not ideal for time-sensitive applications.
- Recommended when: the DR region is not the primary's pair or the workload cannot accept an Estimated RPO of up to 36 hours and a restore time, the workload is stateless or its state lives in replicated external services, and a second cluster can be paid for and operated.
- Source: https://learn.microsoft.com/en-us/azure/aks/reliability-multi-region-deployment-models#multi-region-deployment-model-implementations

### aks-backup-split: Back up to the pair with Cross Region Restore and restore into a cluster in the pair
- Kind: split-region
- Target: pair-region
- Uses mechanism: AKS backup with Cross Region Restore
- Estimated RPO: 36h (Learn: effective RPO of up to 36 hours for Vault Tier recovery points in the secondary region)
- Estimated RTO: 24h (Estimated, team-set starting value for the restore: Learn gives no restore duration; it depends on the target cluster being ready, the size of the data hydrated through the staging location and the disk SKU; TC-9 proves it and a measured value becomes Demonstrated)
- Prerequisites: the primary region and its pair both offer the Vault Tier (the primary is not Indonesia Central, Malaysia South, Mexico Central, Qatar Central, Southeast US or West India, and the pair is checked against the same list); a cluster on a managed identity with CSI drivers and snapshots, Linux node pools and a supported Kubernetes version; a geo-redundant Backup vault with Cross Region Restore enabled, in the primary cluster's region and subscription; a General-purpose v2 storage account with a blob container in the cluster's region for the extension; a snapshot resource group; a policy with Vault-standard retention; persistent volumes on CSI Azure Disks of 1 TB or less with public network access, no Entra data access authentication and no Disk Encryption Set (other volumes are not carried across regions); a target AKS cluster that already exists in the pair region with the Backup extension, a managed identity, enough node capacity, a version close to the source's, Trusted Access to the vault, the roles of the roles table, and a staging resource group and storage account in its region and subscription; the registry, Key Vault and data services reachable from the pair region (their own playbooks) at a latency the application owner accepts, also for the services that fail over into the DR region.
- Cost notes: Learn lists a protected instance fee per namespace per month, snapshot storage and a Backup storage fee for the Vault Tier; plus the standing target cluster in the pair region, the staging storage account, geo-redundant vault storage and cross-region traffic to the services in the DR region; no price.
- Gives up: a recovery within hours (Estimated RPO of up to 36 hours and a restore that is manual); the region of the cluster (the workload then runs in the pair while its data services fail over elsewhere, so every call crosses regions); Azure Files and non-CSI volumes (no cross-region path) and disks above 1 TB; the cluster itself (the restore recreates data and resources in an existing cluster, not the cluster, its node pools or its networking); the possibility to drill an actual region outage.
- Recommended when: the workload is mostly stateless or can lose up to 36 hours of in-cluster state, the pair region meets residency, and a standing empty cluster in the pair is acceptable; when the other services of the workload fail over into a different region, use it only after the cross-region latency from the pair region has been tested (TC-10).
- Source: https://learn.microsoft.com/en-us/azure/backup/azure-kubernetes-service-backup-overview#restore-from-a-backup

## Migration from a paired setup

### Recognise today's setup
An AKS cluster has no multi-region setting of its own (Learn: it is a single-region resource), so the cluster resource alone shows no DR. Paired DR of AKS shows in an inventory in three ways. First, a Backup vault (a data protection backup vault, covered by the backup playbook) whose storage redundancy is geo-redundant and whose Cross Region Restore setting is enabled, with a backup instance of the cluster and a policy that has Vault-standard retention; on the cluster the Backup extension is installed and Trusted Access to the vault is bound. Second, a second AKS cluster in the primary's pair region together with a traffic router whose origins carry two priorities, or a Fleet Manager with member clusters. Third, no cluster-side evidence at all, in which case the DR of the cluster is the Azure region's guidance only and the status is Gap. A cluster in the pair region is a DR cluster only when such evidence (tags, deployment definitions, router origins, Fleet membership) shows it; its region or name alone never proves it, so record Unknown otherwise. The inventory cannot show whether the vault holds a Vault Tier recovery point in the secondary region, whether the target cluster is ready, whether the secondary cluster is in step with the primary, what the persistent volumes hold, or how the workload reaches its data services. Migration to a DR region that is not the pair is decided per cluster by option id: secondary-cluster builds a second cluster in the new DR region; aks-backup-split builds nothing in the new DR region and validates the restore into a standing cluster in the pair region.

### Build
1. secondary-cluster: take the inventory of every workload on the cluster with its owner, its persistent volumes (storage class, size, CSI Azure Disk or Azure Files or other), the data services it uses, the images it pulls and the secrets it reads; record for each persistent volume its DR path (a replicated external service, application-level replication, or none, which is a gap); this inventory is what TC-1 checks.
2. secondary-cluster: choose the model per workload from Learn's three (active-active, active-passive, passive-cold), record the Estimated RPO and Estimated RTO the owner accepts, and keep passive-cold for workloads that are not time-sensitive.
3. secondary-cluster: check the DR region before building: AKS is offered, the node VM size is available, subscription quota covers the vCPUs of the primary's node pools at the level the chosen model scales to and the number of clusters per region, zones are supported if the DR cluster is meant to be zone resilient, and the subnet has room for all pod and node IP addresses; record the findings (TC-4 repeats them).
4. secondary-cluster: create the DR cluster from the template of the primary with the region and names as parameters: same pricing tier, a managed identity, managed Microsoft Entra integration with Azure RBAC for Kubernetes authorization enabled (needed for the Kubernetes API roles of the Build step that grants access on the DR cluster), zones enabled at creation when supported, node pools of the same VM size, the cluster autoscaler on, the same Kubernetes minor version (this playbook's choice, so that the same manifests apply), and the same network plugin, policy and add-ons.
5. secondary-cluster: grant access on the DR cluster before DR: Azure Kubernetes Service Contributor Role (Azure control plane) to the platform engineer group, Azure Kubernetes Service RBAC Cluster Admin (Kubernetes API) to the break-glass group, and Azure Kubernetes Service RBAC Writer scoped to namespaces for the application engineers; the traffic router's change role comes from its own playbook and goes to the network engineer group.
6. secondary-cluster: build the regional dependencies in the DR region: a Key Vault, a Log Analytics workspace, a hub-spoke network with its firewall policy, and an image source that the DR cluster pulls from in the DR region (a geo-replicated registry replica, see the container registry playbook); the data services are replicated or failed over to the DR region by their own playbooks.
7. secondary-cluster: deploy from one source of truth to both clusters (a repository with a pipeline, or Fleet Manager cluster resource placement with the DR cluster as a member); set the autoscaling of the secondary application so it scales to the same instance count as the primary when the primary becomes inactive, with the Horizontal Pod Autoscaler and the cluster autoscaler sized to the primary's load; for passive-cold keep node pools at the lowest level the activation procedure allows.
8. secondary-cluster: build the traffic path: for active-active and active-passive create the router profile with an endpoint, the origin of the primary at priority 1 (the DR origin at priority 2 for active-passive, or also at priority 1 for active-active), a route, and limit access to the workload endpoints to the router only; for passive-cold write the activation condition (manual input or event) into the runbook.
9. secondary-cluster: for every persistent volume with no external DR path decide: move the state to a replicated external service, accept the gap in writing with its owner, or (only if the pair region is acceptable for it) protect it with the aks-backup-split steps; Learn names no cross-region replication of persistent volume content other than AKS backup.
10. secondary-cluster: set Resource Health alerts and Service Health alerts on both clusters (Learn describes them for zone failures; using them for region events is this playbook's inference), and an alert when the desired-state sync to the DR cluster has not succeeded within the Estimated RPO of the option.
11. aks-backup-split: check that the primary region and the pair region both offer the Vault Tier, and take the inventory of volumes as the secondary-cluster Build step that inventories every workload does (storage class, size, CSI driver and DR path of each persistent volume); every volume that is not a CSI Azure Disk of 1 TB or less with public network access, no Entra data access authentication and no Disk Encryption Set has no cross-region path through this option and gets a recorded alternative.
12. aks-backup-split: create the Backup vault in the primary cluster's region and subscription with the backup storage redundancy Geo-Redundant and Cross Region Restore Enabled (neither can be disabled afterwards), register the `Microsoft.KubernetesConfiguration`, `Microsoft.DataProtection` and `Microsoft.ContainerService` resource providers, and create the backup policy with Vault-standard retention (one scheduled recovery point per day), so that every recovery point stored in the vault datastore is in the secondary region.
13. aks-backup-split: on the primary cluster install the Backup extension with a General-purpose v2 storage account and an empty blob container in the cluster's region, enable Trusted Access to the vault, create the snapshot resource group, and grant the roles of the roles table: Reader for the vault on the cluster and on the snapshot resource group, Contributor for the cluster on the snapshot resource group, Data Operator for Managed Disks and Disk Snapshot Contributor for the vault on the snapshot resource group, Storage Blob Data Reader for the vault on the storage account, and for the extension identity both Storage Blob Data Contributor and Storage Account Contributor on that storage account (the pages differ, see the constraint on roles); for the separate Azure Files instance of the Build step that configures the backup instance also Storage File Data Privileged Contributor for the cluster on the storage account that hosts the file shares (the vault assigns it automatically for dynamically provisioned volumes; assign it by hand for statically provisioned ones); allow several minutes for the role assignments to take effect.
14. aks-backup-split: configure the backup instance: select the namespaces (the namespaces `kube-system`, `kube-node-lease`, `kube-public` and `gatekeeper-system` are skipped), the volume type Azure Disk only for the instance that goes to the Vault Tier (a separate instance for Azure Files volumes, which stay in the Operational Tier), include secrets only if needed, add backup hooks for databases that run as containers so that the snapshots are application consistent, and run an on-demand backup moved to the Vault Tier to get the first recovery point without waiting for the daily one.
15. aks-backup-split: build the standing target in the pair region: a cluster of the same pricing tier with a managed identity, Linux node pools, CSI drivers and snapshots enabled, a Kubernetes version close to the primary's, node capacity sized for the workload (a restore does not scale nodes), the Backup extension installed with its own storage account, Trusted Access to the vault, a staging resource group and a staging storage account in the pair region and in the same subscription as the target cluster with public network access (see the constraints on the staging account), and the roles: Contributor for the target cluster on the snapshot resource group, Storage Blob Data Contributor for the target's extension identity on the staging storage account, and for the vault Contributor on the staging resource group plus Storage Account Contributor and Storage Blob Data Owner on the staging storage account.
16. aks-backup-split: grant the people who run the failover restore Backup Contributor on the vault's resource group, and the platform engineers on the target cluster the roles that the secondary-cluster Build step grants on the DR cluster before DR, so that nobody needs the Owner role during DR; give the registry, Key Vault and data service access of the target cluster as in the secondary-cluster Build step that builds the regional dependencies in the DR region (a DR network path from the pair region to the DR region is built by the network playbooks).
17. aks-backup-split: keep the template of the primary cluster deployable in the pair region and record its parameters in the runbook, because a restore creates no cluster, node pools or networking (Learn: it restores data and associated resources).
18. aks-backup-split: build the return path for the failback step that moves the state written in the pair region back (an inference: Learn describes no failback of AKS backup): repeat the Build steps that create the Backup vault, install the Backup extension on the primary cluster and build the standing target in the pair region, in the reverse direction, that is a geo-redundant Backup vault with Cross Region Restore and a Vault-standard policy in the pair region for the restored cluster, the extension, Trusted Access and roles of the Build step that installs the Backup extension on the primary cluster on that cluster, and for the primary region's cluster the extension, Trusted Access to the pair-region vault, a staging resource group and storage account in the primary region and the roles of the Build step that builds the standing target in the pair region; the Backup Contributor role of the Build step that grants the failover restore roles is also granted on the pair-region vault's resource group; the first drill of TC-9 in the reverse direction proves it.

### Validate
1. Run TC-1 on the volume inventory (quarterly).
2. secondary-cluster: run TC-2 for the desired-state parity of the two clusters (daily) and TC-3 for the sync lag over 7 consecutive days (weekly afterwards).
3. secondary-cluster: run TC-4 for the capacity of the DR region (quarterly) and TC-6 for the dependencies in the DR region (monthly).
4. secondary-cluster: run TC-5, the switch-over drill, and time it against the Estimated RTO of the option; this is rerun at least every six months.
5. aks-backup-split: run TC-7 on the protection state of every protected cluster (daily) and TC-8 on the readiness of the target cluster (weekly).
6. aks-backup-split: run TC-9, the cross-region restore drill, once before cut-over and then at least every six months, and TC-10 for the data path from the pair region to the DR region (at least every six months); TC-6 (monthly) covers the dependencies of the target cluster.
7. Record each result with its date; a time that a drill measured is Demonstrated, and everything else stays Estimated or Unknown.

### Cut over
1. secondary-cluster: make the DR cluster the DR target of the workload in the runbook: its router origin at the DR priority (or Fleet membership), its manifests deployed by the pipeline, and its dependencies in the DR region.
2. secondary-cluster: remove from the runbook the steps that activate or fail over to the cluster in the pair region.
3. aks-backup-split: change nothing in the primary cluster or the vault; put the Failover steps for aks-backup-split in the runbook with the target cluster in the pair region as the restore target, the Estimated RPO of up to 36 hours as the accepted data loss, and the roles of Build as the access list.

### Decommission
1. secondary-cluster: after TC-2, TC-3, TC-5 and TC-6 have passed, remove the DR origin of the pair cluster from the traffic router and the pair cluster from the Fleet membership, and confirm that no other workload uses it.
2. secondary-cluster: scale the pair cluster's node pools down and delete the cluster only when its owner confirms that nothing else depends on it, and remove its regional Key Vault, registry replica and Log Analytics workspace only through their own playbooks.
3. aks-backup-split: nothing is removed for the vault, which keeps the geo-redundant storage and Cross Region Restore (neither can be disabled); a pair-region cluster that is no longer the restore target is deleted only after TC-9 has passed against the new target.

### Keep until cut-over
Keep the pair-region cluster, its router origin, its regional dependencies and the runbook steps that activate it until TC-2, TC-3, TC-5 and TC-6 have passed for secondary-cluster. Keep the Backup vault with Cross Region Restore, the backup instance, the recovery points in the secondary region and the standing target cluster in the pair region until TC-7, TC-8 and TC-9 have passed for aks-backup-split.

## Failover and failback

AKS has no Microsoft-managed failover of a cluster to another region and no setting the customer can trigger or rehearse by taking the region down (Learn: single-region resource, no mechanism to take a region down for a test). The only Microsoft-managed failover is the control plane across availability zones inside one region. A regional failover is a decision and a set of customer steps.

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region or its cluster is unavailable and declare DR for the workload | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time, with the Service Health and Resource Health evidence of the cluster | The primary cluster answers again before the declaration |
| 2 | Confirm that every external data service the workload needs is failed over or available in the DR region, by the steps of its own playbook | Data platform engineer | Estimated unknown (set by the playbooks of the data services) | Each service answers reads and writes from the DR region | A data service is not available: the workload stays down for it, and the application owner decides whether to start in a degraded mode |
| 3 | secondary-cluster: check the DR cluster (nodes Ready, system pods running, the desired-state sync current) and its dependencies (Key Vault, image source, Log Analytics) | Platform engineer | Estimated unknown (measured in the first drill) | All nodes are Ready, no application pod is in an error state and the last desired-state sync is within the Estimated RPO of the option | The sync is older than the Estimated RPO: the application owner decides whether to go on with older definitions |
| 4 | secondary-cluster: for passive-cold, activate the cold cluster as the runbook says | Platform engineer | Estimated unknown (Learn: a cold cluster "can take a couple minutes to come online"; the team measures its own time in TC-5) | The cluster API answers and system pods are running | The cluster does not come online: fall back to the Fleet or pipeline deployment to a new cluster, and escalate to Azure support |
| 5 | secondary-cluster: scale the secondary application to the instance count of the primary (autoscaler and Horizontal Pod Autoscaler rules, manual node pool scale if needed) | Platform engineer | Estimated unknown (included in the 30m switch-over target of the failover step that moves traffic to the DR cluster; TC-5 proves it) | The replica count equals the primary's recorded count and no pod is Pending | Pods stay Pending for quota, capacity or IP address reasons: request quota or move load to a smaller SKU, and tell the application owner of the reduced capacity |
| 6 | secondary-cluster: move traffic to the DR cluster: check that the router moved to the priority-2 origin (active-passive) or lower the weight of the primary origin (active-active), or set the cluster as the target by hand (passive-cold, or a Fleet DNS-based load balancer) | Network engineer | Estimated 30m (the switch-over target the team sets for this step and the failover step that scales the secondary application together, from the start of the scaling step to the first successful request served by the DR cluster; TC-5 proves it) | Synthetic requests through the public name are answered by the DR cluster and the router shows the DR origin healthy | The router still sends traffic to the failed origin: set the priority or weight by hand, then check DNS |
| 7 | secondary-cluster: run the application checks in DR: secrets resolve from the DR Key Vault, images pull from the DR image source, writes reach the DR data services | Application engineer | Estimated unknown (the application checks; measured in the TC-5 drill) | A synthetic transaction passes end to end, with no ImagePullBackOff and no secret mount error | A dependency still points at the primary region: stop the affected function and fix the configuration before opening traffic |
| 8 | aks-backup-split: check the standing target cluster in the pair region: the API answers, all nodes are Ready, the Backup extension pods are running and healthy, Trusted Access to the vault is in place, the staging resource group and storage account exist in that region and subscription, and the Kubernetes version is close to the backup's | Platform engineer | Estimated unknown (measured in the first drill) | The checks of TC-8 pass; Learn requires the cluster and the extension pods to be running and healthy before any restore | The target cluster or the extension is unhealthy: do not start the restore; repair it first, or build the cluster from the template and install the extension |
| 9 | aks-backup-split: open the restore for the protected cluster in the backup management view: data source Kubernetes Services, Restore Region Secondary Region, and pick the latest Vault Tier recovery point; record its time | Backup operator | Estimated unknown (measured in the first drill) | The recovery point's time is recorded and the data loss (declaration time minus recovery point time) is compared with the Estimated RPO of up to 36 hours | No recovery point exists in the secondary region: rebuild the workload from source control without in-cluster state, and the application owner records the loss |
| 10 | aks-backup-split: set the restore parameters: target cluster in the pair region, the namespaces or resources to restore, the conflict policy (Skip or Patch), and the staging resource group and storage account; run Validate, then Restore | Backup operator | Estimated unknown (Learn gives no restore duration; TC-9 measures it) | Validation passes, and the CrossRegionRestore job ends as Completed | Validation fails on roles, Trusted Access or staging access: fix per Build and rerun Validate; never start a restore that failed validation; if the restore fails or completes with warnings, read the job error (a version difference is a known cause) and rebuild from source control |
| 11 | aks-backup-split: check the restored workload: pods Running, persistent volume claims Bound, a data sample read, and the application's own checks | Application engineer | Estimated unknown (measured in the first drill) | The restored namespaces have no failing pods, all claims are Bound and the sample matches the recovery point | A claim is not Bound or a pod fails: fix or restore again with the Patch policy after deleting the clashing resource (a restore does not recreate existing resources) |
| 12 | aks-backup-split: point traffic and the application's data service settings at the restored workload in the pair region and the services in the DR region | Network engineer | Estimated unknown (measured in the first drill) | Requests through the public name reach the restored workload and its calls to the DR region services succeed within the latency bound of TC-10 | The latency or the data path fails: hold traffic and decide with the application owner whether to run degraded |
| 13 | aks-backup-split: delete the staging resources of the restore | Platform engineer | Estimated unknown (a manual clean-up: the restore job does not remove the staging resources, and Learn gives no duration) | The staging resource group and storage account hold no hydrated data | Do this after traffic is stable; never delete the staging resources while the restore job runs |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region and its cluster (or the template to rebuild it) are available again | Incident manager | Estimated unknown (measured in the first drill) | The primary cluster API answers and its nodes are Ready, or the cluster is rebuilt from the template | The primary region is still impaired |
| 2 | Fail the external data services back by the steps of their own playbooks | Data platform engineer | Estimated unknown (set by the playbooks of the data services) | Each service is writable in the primary region | A data service cannot fail back: keep the workload in DR |
| 3 | secondary-cluster: deploy the current manifests to the primary cluster and check that the two clusters are in step | Platform engineer | Estimated unknown (a deployment of the current manifests to the primary cluster and a comparison; measured in the first drill) | The out-of-sync object count of the primary against the source of truth is zero (TC-2) | The primary is not in step: keep traffic on the DR cluster |
| 4 | secondary-cluster: move traffic back to the primary cluster (router priority or weight, or Fleet DNS settings) | Network engineer | Estimated unknown (measured in the first drill) | Synthetic requests are answered by the primary cluster | Errors appear on the primary: switch traffic back to the DR cluster |
| 5 | secondary-cluster: scale the DR cluster back to its standby level (passive-cold: deactivate it as the runbook says) | Platform engineer | Estimated unknown (measured in the first drill) | The DR cluster is back at its planned size and the desired-state sync continues | The primary shows a problem within the hold period the application owner sets: keep the DR cluster at full size |
| 6 | aks-backup-split: move the state written in the pair region back. Learn describes no failback of AKS backup; this step is an inference: protect the restored cluster with a Backup vault in the pair region (geo-redundant, Cross Region Restore enabled, built in the Build step that builds the return path), run an on-demand backup of it moved to the Vault Tier first (Learn: on-demand backups can be moved to the Vault Tier by a retention rule with Vault Tier storage enabled, so state written since the last daily point is not left out; Learn gives the up to four hours before tiering begins and up to 12 more hours for the secondary region), and restore that Vault Tier recovery point into the primary region's cluster, or move the data at application level | Backup operator | Estimated unknown (Learn describes no failback timing for AKS backup) | The primary workload shows the state written in the pair region; the restore job ends as Completed | The Vault Tier of the pair region is not offered or the restore fails: move the data at application level, and keep the workload in the pair region |
| 7 | aks-backup-split: switch traffic and the application's settings back to the primary region and check the services | Network engineer | Estimated unknown (measured in the first drill) | End-to-end synthetic transactions pass against the primary cluster | A failure on the primary: stay on the restored cluster |
| 8 | aks-backup-split: restore protection of the primary: run an on-demand backup moved to the Vault Tier and confirm a recovery point in the secondary region; return the target cluster in the pair region to its standing role | Backup operator | Estimated unknown (a recovery point reaches the secondary region within up to 12 hours of the Vault Tier point, per Learn) | A new recovery point is visible with Restore Region Secondary Region (TC-7) | The backup job fails: keep the old restore path in the runbook and raise the failure |

## Test criteria

### TC-1: Every persistent volume has a recorded DR path
- Applies to: secondary-cluster, aks-backup-split
- Pass condition: every persistent volume claim of the cluster is in the inventory with its storage class, size, owner and DR path (an external replicated service, application-level replication, the Vault Tier of AKS backup, or an accepted gap with its owner); for aks-backup-split every volume claimed to be carried across regions is a CSI Azure Disk of 1 TB or less, public network access enabled, Entra data access authentication disabled and no Disk Encryption Set, and the count of such volumes per backup instance is at most 100; no volume is on an in-tree plugin, Azure Files (SMB or NFS) or Azure Blob storage while it is listed as protected for a cross-region restore.
- How to measure: list the persistent volumes, claims and storage classes through the Kubernetes API and the disks behind them in Azure, and compare them with the inventory; compare each disk's size, network access, authentication and encryption settings with the eligibility list.
- Evidence: the list of volumes with the DR path column and the eligibility result per disk, the number of accepted gaps and their owners.
- Frequency: quarterly

### TC-2: The DR cluster matches the primary
- Applies to: secondary-cluster
- Pass condition: the DR cluster exists in the DR region, runs a supported Kubernetes version of the same minor version as the primary, has the same pricing tier, zones as designed, node pool VM sizes and autoscaler settings as the template, and zero objects are out of sync between the source of truth and the DR cluster (out-of-sync count is 0).
- How to measure: a scheduled job reads the cluster and node pool properties of both clusters with a read-only query and compares them, and reads the sync status of the pipeline, GitOps or Fleet Manager placement for the DR cluster.
- Evidence: the job report with its date, the property comparison and the out-of-sync count.
- Frequency: daily

### TC-3: The desired-state lag stays below the Estimated RPO
- Applies to: secondary-cluster
- Pass condition: for 7 consecutive days, the time from a change in the source of truth to its presence on the DR cluster stays below the Estimated RPO of the option (15m), and no run fails without an alert.
- How to measure: compare the commit or release time of each change with the time the DR cluster reports it applied, and add one canary object that the pipeline changes every day so that a day without a real change still gives a measurement.
- Evidence: the 7-day export with the lag per change and its maximum.
- Frequency: weekly

### TC-4: The DR region has the capacity to scale the secondary cluster
- Applies to: secondary-cluster
- Pass condition: the free regional vCPU quota of the node VM size is at least the vCPUs needed to scale the DR cluster to the primary's instance count, the free IP addresses of the node and pod subnets are at least the count the scaled cluster needs, the cluster quota per region has room, and a scale-out test to the primary's instance count ends with 0 Pending pods. Design check, not drillable: capacity during a regional event cannot be proven (Learn: regional capacity can affect deployment), so only quota, addresses and the scale-out test are measured.
- How to measure: read the quota and usage for the subscription and region, count free addresses in the subnets, run a scale-out of the secondary application in the DR cluster (a test namespace is enough) and count Pending pods.
- Evidence: the quota and address report with its date and the scale-out test record.
- Frequency: quarterly

### TC-5: The switch-over to the DR cluster completes within the Estimated RTO
- Applies to: secondary-cluster
- Pass condition: in a drill that shifts traffic to the DR cluster by the Failover steps (a regional outage cannot be simulated: Learn names no way to take a region down), the time from the start of the switch-over to the first successful request served by the DR cluster at the primary's instance count is at most 30m, the Estimated RTO of the option; the measured time becomes Demonstrated; and the checks of the failover step that runs the application checks in DR pass.
- How to measure: run the drill by lowering the priority or weight of the primary origin (or disabling it) with a timer and synthetic requests through the public name; record the time of each step, the replica count and the router's origin health.
- Evidence: the drill record with timestamps per step, the measured time and the application check output.
- Frequency: at least every six months, and after a change to the router, the cluster or its autoscaling rules

### TC-6: The dependencies in the DR region work
- Applies to: secondary-cluster, aks-backup-split
- Pass condition: from the DR cluster (or the target cluster in the pair region) with the primary region's registry and Key Vault endpoints blocked, 0 pods are in ImagePullBackOff, 0 pods fail to mount or read a secret, the logs reach the regional Log Analytics workspace, and the data services answer from the DR cluster.
- How to measure: deploy the workload to a test namespace of the cluster with a network rule that blocks the primary region's registry and Key Vault endpoints, then count failing pods and read the logs and probe results.
- Evidence: the test record with the blocked endpoints, the failing pod count and the probe output.
- Frequency: monthly

### TC-7: Every protected cluster has a recent recovery point in the secondary region
- Applies to: aks-backup-split
- Pass condition: the Backup vault has storage redundancy Geo-Redundant and Cross Region Restore Enabled; the policy has Vault-standard retention; the newest recovery point visible with Restore Region Secondary Region is younger than 36h, the Estimated RPO of the option; the Vault Tier backup jobs of the last 7 days show 0 failures and 0 skipped disks.
- How to measure: read the vault properties and the backup instance's recovery points for the secondary region, and the backup job list with the tiering outcomes, through the backup management view or a read-only query.
- Evidence: the vault properties, the recovery point list with times and the job report with their date.
- Frequency: daily

### TC-8: The standing target cluster in the pair region is ready
- Applies to: aks-backup-split
- Pass condition: the target cluster exists in the pair region and the vault's subscription, all nodes are Ready, the Backup extension pods are running and healthy, Trusted Access to the vault is in place, a managed identity is used, the Kubernetes version differs from the source by no more than the difference the last drill proved, the staging resource group and storage account exist in the target's region and subscription, the role assignments of Build are present (including those for the vault on the staging resource group and storage account), and the restore Validate step of the backup management view passes against the target.
- How to measure: read the target's properties, the extension status and the role assignments with read-only queries and run the Validate step of a restore (without starting it) against the latest recovery point.
- Evidence: the property and role listing with its date and the Validate result.
- Frequency: weekly

### TC-9: A Vault Tier recovery point restores into a cluster of the pair region
- Applies to: aks-backup-split
- Pass condition: a restore of a Vault Tier recovery point into the target cluster ends as Completed (the CrossRegionRestore job when it is offered), 100% of the restored claims are Bound, 0 pods fail beyond those the application owner lists, a sample of data (a checksum or a row count) equals the recovery point's, and the measured time from start to the application check is at most 24h, the Estimated RTO of the option, and is recorded as Demonstrated; when the private-cluster case applies, the staging access that the target needs is proven here. Learn's AKS pages describe the secondary-region restore for an outage and do not say whether the choice of Secondary Region is offered while the primary region is healthy; if it is not offered, the drill is a restore of a Vault Tier recovery point from the primary region into a test cluster of the primary region (Learn allows restoring Vault Tier backups to a cluster in the same region), and the region step is a design check, not drillable.
- How to measure: run the restore in the backup management view with the parameters of the failover step that sets the restore parameters, time it, then read the cluster for pods and claims and compare the sample data; clean up the staging resources by hand afterwards.
- Evidence: the drill record with the recovery point time, the restore job, the measured time, the pod and claim listing and the sample comparison; whether Secondary Region was offered.
- Frequency: at least every six months, and after a change to the vault, the target cluster or the staging setup

### TC-10: The data path from the pair region to the services in the DR region works
- Applies to: aks-backup-split
- Pass condition: from the target cluster in the pair region, the workload's data services in the DR region answer within the latency bound the application owner sets and records, the error rate of 100 probe calls is at most the rate the owner sets, and the network, DNS and role assignments for the path exist before DR.
- How to measure: run a probe workload in the target cluster that calls each data service of the workload in the DR region 100 times and records latency and errors; review the network paths, private DNS links and role assignments.
- Evidence: the probe report with the latency percentiles and error rate, and the review record with its date.
- Frequency: at least every six months, and after a change to the network or the data services
