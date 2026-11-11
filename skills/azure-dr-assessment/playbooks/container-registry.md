---
service: container-registry
title: Azure Container Registry
arm_types:
  - microsoft.containerregistry/registries
slot: compute
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-container-registry
  - https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication
  - https://learn.microsoft.com/en-us/azure/container-registry/container-registry-import-images
  - https://learn.microsoft.com/en-us/azure/container-registry/container-registry-skus
  - https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-overview
  - https://learn.microsoft.com/en-us/azure/container-registry/container-registry-private-endpoints
  - https://learn.microsoft.com/en-us/azure/container-registry/container-registry-transfer-prerequisites
---

# Azure Container Registry

## Mechanisms

### Geo-replication
- Replicates: data and metadata of the registry (container images, artifacts and their tags) to the regions that you choose, as replicas of one registry; Learn names it Container Registry's "native multiregion support" and it needs the Premium tier. The home region keeps the control plane (registry configuration, authentication configuration and replication policies)
- Paired: yes
- Nonpaired: yes
- Failover: Microsoft-managed
- Estimated RPO: 15m (Learn: after a region failure "typically, the data loss is expected to be less than 15 minutes", with Learn adding that this is not assured; replication is asynchronous with eventual consistency and "there's no guarantee on data replication timing")
- Estimated RTO: unknown (two Learn pages differ and the stricter reading is kept: the reliability article says a small amount of data plane downtime "typically takes 1 to 2 minutes" while failover completes, and the geo-replication article says end-to-end rerouting "is on the order of minutes" and that DNS TTL might add propagation delay; Learn gives no customer-invocable trigger, so TC-3 measures the client side only)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-registry#resilience-to-region-wide-failures

### Zone redundancy
- Replicates: registry data, including images, manifests and metadata, asynchronously across availability zones inside one region; it is enabled by default for all registries in regions that support availability zones, and for every replica in such a region
- Paired: no
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: 15m (Learn: for a zone failure the data loss "is typically expected to be less than 15 minutes", with Learn adding that this is not assured; this is a zone figure and not a region figure)
- Estimated RTO: unknown (Learn: downtime during an automatic zone failover "is typically a few seconds for most registry operations"; it protects against a zone failure only, never against the loss of a region)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-registry#resilience-to-availability-zone-failures

### Image import
- Replicates: images and OCI artifacts (including Helm 3 charts), copied on demand from a source registry into a target registry with `az acr import`; the source can be a public registry, an Azure container registry in the same subscription, tenant or another subscription or tenant, or a non-Azure private registry. It is a copy that you trigger: Learn describes no schedule, trigger or continuous replication for it
- Paired: yes
- Nonpaired: yes
- Failover: manual
- Estimated RPO: unknown (a copy that you trigger: its age is the interval at which the team runs the import, and Learn publishes no figure; the option that uses it sets the interval)
- Estimated RTO: unknown (Learn publishes no figure; the option that uses it sets the switch-over the team designs)
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-import-images

### ACR Transfer
- Replicates: images and other OCI artifacts, exported from a source registry to a blob in a storage account, copied to a target storage account and imported into a target registry; Learn says it is "ideal for air-gapped or cross-cloud scenarios" and names image import as the recommended alternative for connected registries
- Paired: yes
- Nonpaired: yes
- Failover: manual
- Estimated RPO: unknown (a copy that you trigger or that an import pipeline runs when a blob arrives; Learn publishes no figure)
- Estimated RTO: unknown (Learn publishes no figure)
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-transfer-prerequisites

## Constraints

### Geo-replication needs the Premium tier and does not rely on paired regions
Learn says to use the Premium tier to enable geo-replication, which is "available in all Azure regions where the Premium tier is supported", and that you "can replicate to any combination of regions, regardless of whether Azure pairs those regions". Basic and Standard have no geo-replication. This is a statement about the choice of replica regions, not a table of which region supports which feature: the Premium tier must be checked in the DR region.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-registry#requirements

### Premium features and the SKU change
Geo-replication, private link with private endpoints, dedicated data endpoints, content trust and customer-managed keys are Premium features in Learn's SKU table. A registry can move freely between SKUs when the target SKU has the required maximum storage capacity, with no downtime, but moving from Premium to a lower SKU disables the Premium features, and any geo-replications must be deleted before the switch to Standard or Basic.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-skus#change-registry-sku

### Replication is active-active
All geo-replicas are active and writable: you can push, pull and delete images from any replica, not only the home region's, unlike a primary-secondary model where only one region accepts writes.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#replication-model

### Replication is eventually consistent
A change in any replica is replicated to the others in the background, and a replica "might not have the latest content or metadata" until it completes. Learn lists the failure modes to plan for: a push to one replica followed by an immediate pull from another can fail with `manifest unknown`; re-pushing a tag with different content can leave replicas resolving the tag to different digests; a delete takes time to propagate; and a multi-layer push that spans a failover or a DNS bouncing event can leave layers on one replica and the manifest on another. The mitigations are pull retries with backoff, or webhooks that notify when replication of a pushed image completes in each replica.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#consistency-model

### Health-aware failover is platform-managed and has no customer trigger
Container Registry monitors each replica and reroutes global endpoint traffic away from replicas that can't reliably serve requests. Learn says "there's no customer-invocable trigger" and that it is "fully platform-managed", so the health-aware failover itself cannot be started by the customer. The customer can still remove a replica from global endpoint routing (see the drill constraint below). It evaluates health per registry and not per region, takes "the order of minutes" end to end (DNS TTL might add delay) and is not triggered by HTTP 429 throttling responses. Failback is automatic once the regional health evaluation passes again. Learn's ways to confirm a failover are the registry's Resource health in the Azure portal, `az acr replication list` (replicas with issues show a status other than `online`) and Azure Monitor platform metrics and resource logs.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#health-aware-failover

### The reliability article gives a shorter failover time than the geo-replication article
The reliability article says data plane downtime while failover completes "typically takes 1 to 2 minutes"; the geo-replication article says rerouting is "on the order of minutes" and that DNS TTL might add delay. The pages differ, so this playbook follows the stricter reading (no single figure) and records observed times. Microsoft doesn't automatically notify you when a region is down: use Azure Service Health alerts and the regional endpoints' availability metrics in Azure Monitor.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-registry#behavior-during-a-region-failure

### Health-aware failover covers only the global endpoint
It applies only to the global endpoint (`<registry>.azurecr.io`). With a regional endpoint (`<registry>.<region>.geo.azurecr.io`, a Preview feature in Learn) you talk to one replica and "ACR doesn't automatically reroute": the client implements failover by switching to a different regional endpoint. Once a registry endpoint redirects a layer download to a dedicated data endpoint, the client stays on that region's data endpoint for the download. Regional endpoints are enabled for the whole registry (not per replica), need the Premium tier and Azure CLI 2.86.0 or later, and container tools store credentials per hostname, so a switch needs a new `az acr login` for that hostname.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#regional-endpoints-of-a-geo-replicated-registry-preview

### Throttling is per replica
Throttling limits on API operations are per replica, and failover shifts traffic to the remaining replicas. Learn says to plan at least two or three replicas: a registry with only two regions "can hit per-replica throttling limits more easily when one region is unavailable".
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#health-aware-failover

### The home region holds the control plane and is fixed at creation
The home region hosts the control plane and "is fixed at creation and can't be changed afterward"; moving it is a redeployment procedure (a new registry), not an in-place change. If the home region is unavailable, data plane push, pull and delete, authentication (Microsoft Entra ID, service principals, managed identities and repository-scoped tokens), webhook delivery for available replicas and the other regional endpoints continue to work through the remaining replicas. Unavailable are the home region's regional endpoint, changes to registry configuration ("network rules, replication settings, or availability zone configurations") and ACR Tasks, which are bound to the home region and do not run.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#home-region-outage-behavior

### Replicas can be removed, the home region registry cannot
Learn says you can change the replication regions at any time and disable geo-replication by removing individual regional replicas in the Azure portal or with command-line tools, and that "the home region registry can't be removed".
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-registry#configure-multiregion-support

### A region failure cannot be simulated
Learn says you "can't simulate the failure of one of the regions associated with your registry", but you can test the application's ability to fail over by temporarily disabling geo-replicas, which removes them from Traffic Manager routing, and checking that container operations use the other regions.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-registry#test-for-region-failures

### A replica can be excluded from global endpoint routing for a drill
Setting `--global-endpoint-routing` to false for a replica (`az acr replication update`) stops the global endpoint from routing requests to it, and this can include the home region's replica, whose data plane traffic "can be safely excluded from global routing". Data keeps syncing bidirectionally with that replica, storage quota and cost continue to accrue, and its regional endpoint (if enabled) keeps working. Clients with a long-lived DNS cache for the global endpoint keep resolving to the excluded replica until the cache expires. In Azure CLI 2.86.0 and later, `--region-endpoint-enabled` was renamed to `--global-endpoint-routing`, and `--name` is the replication resource name and not the region.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#temporarily-exclude-a-geo-replica-from-global-endpoint-routing

### Replication is not a backup
Geo-replication "doesn't create an independent recovery point for deleted or corrupted artifacts". Learn says to copy critical container images and artifacts to external storage or another registry: ACR Transfer (for Premium registries) exports artifacts to external storage, and standard Docker commands or ORAS copy artifacts to another registry. This means that a delete or a bad tag overwrite, which Learn's consistency model says is replicated to all replicas, cannot be recovered from another replica (inference).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-registry#backup-and-restore

### Storage limits are shared across replicas and API rate limits are per replica
Service tier limits apply to each replica independently, but the storage limit of the tier is shared across all replicas (a 1 GiB image replicated to 5 replicas counts 1 GiB toward the limit), and API rate limits are specific to each replica.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#service-tier-and-limits-considerations

### Storage is billed per replica
Storage is billed per replica (1 GiB replicated to 5 replicas is charged as 5 GiB), and cross-region data transfer charges still apply when content is replicated to other replicas as part of eventual consistency.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#pricing-considerations

### Adding a replica needs the replication permissions
To manage geo-replicas the identity needs `Microsoft.ContainerRegistry/registries/read` and `write`, and `registries/replications/read`, `write` and `delete` (and `replications/operationStatuses/read`).
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#permissions-needed

### One registry has one set of credentials, role assignments and network rules
Learn says that with geo-replication you "maintain a single set of credentials, role assignments, networking rules, and registry configuration across all geo-replicas", reference one global endpoint in all builds and deployments, and push tags and digests once.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication

### Roles of the identities that use a registry
For a registry with "RBAC Registry Permissions", Learn's recommended role for identities that pull images (developers, pipelines and orchestrators such as the AKS kubelet identity, Azure Container Apps or Azure Container Instances) is `AcrPull`, for build pipelines that push `AcrPush`, and for identities that import with `az acr import` `Container Registry Data Importer and Data Reader`. For a registry with "RBAC Registry + ABAC Repository Permissions" the pull role is `Container Registry Repository Reader` and the push role `Container Registry Repository Writer`. The control plane role `Container Registry Contributor and Data Access Configuration Administrator` configures geo-replications, network access and registry endpoints, and it is the role Learn names for running `az` CLI commands on a registry, including `az acr login`. Roles are assigned on a registry, so a second registry needs its own assignments (inference).
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-overview#recommended-built-in-roles-by-scenario

### Role assignments need Owner or Role Based Access Control Administrator
To perform role assignments you must have either the `Owner` role or the `Role Based Access Control Administrator` role on the registry.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-overview#perform-role-assignments-to-grant-permissions

### Private endpoints consume subnet addresses per replica
A private endpoint uses 1 private IP address for the global endpoint and 1 per replica for the dedicated data endpoint, which registries with private endpoints get automatically, and 1 per replica for the regional endpoint when regional endpoints are enabled (a registry with 3 replicas and regional endpoints consumes 7 per virtual network that has a private endpoint). When a replica is added and any private endpoint subnet of any connected virtual network lacks free addresses, the replication provisioning fails and rolls back, and the error does not say which subnet is exhausted. Learn recommends at least a `/27` subnet for private endpoint subnets on geo-replicated registries.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-private-endpoints#plan-subnet-ip-capacity-for-private-endpoints

### Each replica needs its own DNS records in the private zone
For a geo-replicated registry with private endpoints Learn says to create additional DNS settings for each replica: an A record for the replica's data endpoint (`<registry>.<replica-region>.data`) in the private zone `privatelink.azurecr.io`, pointing to the private IP address of that endpoint.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-private-endpoints#additional-records-for-geo-replicas

### Static IP private endpoints, locks and permissions can block a replica
Creating a replica for a private endpoint-enabled registry needs the identity to hold `Microsoft.Network/privateEndpoints/privateLinkServiceProxies/write`, or creation gets stuck. A private endpoint with static IP allocation does not add the member of a new replica, so replica creation fails, and Learn recommends dynamic IP allocation. A Delete or Read-only lock on the private DNS zone makes deleting a replica fail with `ScopeLocked`.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#troubleshooting

### Private endpoints in several regions need their own DNS zone
For private endpoints in several regions Learn says to use a separate resource group in each region with its own virtual network and private DNS zone, which prevents unpredictable DNS resolution from sharing one zone.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-private-endpoints#dns-configuration-options

### Customer-managed keys depend on the key vault's own recovery
Learn notes that a registry that uses a customer-managed key should follow the key vault failover and redundancy guidance for maximum resilience.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#data-plane-high-availability

### Import from an Azure registry reads the home region and writes the home region
When the import source is an Azure container registry, you can import "only from the source ACR's home region"; the source's regional endpoints are not supported as import sources and you specify the source registry's global endpoint. An import "always writes content to the downstream ACR's home region". The maximum number of manifests for an imported image is 50. Learn's list of limitations gives no restriction on the region of the target registry, so a second registry can be in the DR region (inference).
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-import-images#limitations

### Import needs the importer role on the target registry
Learn says the identity must have permissions to trigger imports on the target registry, which is the `Container Registry Data Importer and Data Reader` role.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-import-images#prerequisites

### Import from a registry in the same tenant needs the role on both registries
For a source Azure registry in the same Microsoft Entra tenant (same or another subscription), the identity needs `Container Registry Data Importer and Data Reader` on both the source and the target registry; when public access to the source is disabled, the source is specified by resource ID; and a source or target registry with a private endpoint or firewall rules must allow trusted services.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-import-images#import-container-images-from-an-azure-container-registry-in-the-same-microsoft-entra-tenant

### Import across subscriptions needs the registry resource provider for both regions
Learn's note says that to import an image from one registry to another, the source and target registries must ensure that both regions are registered for Azure Container Registry under the subscription's resource providers.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-import-images#import-container-images-from-a-registry-in-a-different-subscription

### Import to or from a restricted registry needs trusted services, and external sources need RFC 7233 ranges
To import to or from a network-restricted registry, the restricted registry must allow access by trusted services; the setting is enabled by default, and if you create a registry with a private endpoint or firewall rules and don't enable it, import fails. Importing from an external registry requires support for RFC 7233 ranges.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-import-images

### Cross-tenant import is not supported over a registry with public access disabled
Importing from a registry in a different Microsoft Entra tenant needs the source's login server name and credentials with pull access (a service principal with `Container Registry Repository Reader` for ABAC-enabled registries or `AcrPull` otherwise, a repository-scoped token, or an access token). Learn says "cross-tenant import isn't supported over public access disabled registry".
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-import-images#import-container-images-from-an-azure-container-registry-in-a-different-tenant

### ACR Transfer needs Premium registries and has size limits
Both registries must be in the Premium service tier, a PipelineRun transfers a maximum of 50 artifacts and ACR Transfer "supports artifacts with layer sizes up to 8 GB". It needs a storage account (and a key vault with a SAS token, or a managed identity with a role such as `Storage Blob Data Contributor`) on each side. Learn says it is intended for movement across physically disconnected clouds.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-transfer-prerequisites

## Non-paired options

### geo-replication: Geo-replica in the DR region
- Kind: native
- Target: dr-region
- Uses mechanism: Geo-replication
- Estimated RPO: 15m (Learn: the data loss after a region failure "is typically expected to be less than 15 minutes", with Learn adding that this is not assured, and replication timing has no guarantee; TC-2 measures the replication time of a probe image)
- Estimated RTO: 5m (Estimated, team-set starting value; TC-3 proves it. Learn's two pages differ: the reliability article says data plane downtime while failover completes "typically takes 1 to 2 minutes" and the geo-replication article says end-to-end rerouting "is on the order of minutes" and that DNS TTL might add propagation delay, so the longer end-to-end reading (client rerouting plus the DNS TTL, which TC-3 measures) is used and not the 1 to 2 minute figure; the health-aware failover has no customer-invocable trigger, so TC-3 measures only the client side of an excluded replica — https://learn.microsoft.com/en-us/azure/reliability/reliability-container-registry#resilience-to-region-wide-failures and https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#health-aware-failover)
- Prerequisites: the registry is Premium and the DR region supports the Premium tier; the replica region may be any region, paired or not; a replica created in a region that has availability zones is zone-redundant automatically; permissions to create the replica (the `registries/replications` permissions and a role such as `Container Registry Contributor and Data Access Configuration Administrator`) for the platform role that runs the build, and `Owner` or `Role Based Access Control Administrator` on the registry for whoever assigns roles; at least two or three replicas where throttling matters; consumers in the DR region that pull from the global endpoint (or a regional endpoint with client-side failover), each with `AcrPull` (or `Container Registry Repository Reader` on an ABAC registry) on the registry, which already holds for every replica because roles belong to the registry; the DR network: a private endpoint of the registry in the DR virtual network with free subnet addresses (at least a `/27`, dynamic IP allocation), the private DNS zone `privatelink.azurecr.io` and the replica's data endpoint record in the DR region's own resource group and zone, and a client DNS cache that is short-lived for the global endpoint; for a customer-managed key, the key vault's own DR path; ACR Tasks, if used, have a plan outside the home region because they run only there.
- Cost notes: each replica is billed separately at the Premium rate of its region, storage is billed per replica while the storage limit is shared, and cross-region data transfer applies to the initial and ongoing replication; deleting the pair replica after the migration ends its per-replica billing (inference from Learn's per-replica billing); no price.
- Gives up: control over the failover (Microsoft-managed, no customer trigger); registry configuration changes, replication changes and ACR Tasks while the home region is down (the control plane stays in the home region); an independent recovery point (deletes and bad tag overwrites replicate); strict immediacy (eventual consistency: images pushed shortly before the loss might be missing).
- Recommended when: the registry is, or can be, Premium, the DR region is not the primary's pair or any region of choice is allowed, and the workloads can pull through the global endpoint (or implement client-side failover for regional endpoints).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-registry#resilience-to-region-wide-failures

### secondary-registry-import: Second registry in the DR region, filled by import
- Kind: workaround
- Target: dr-region
- Uses mechanism: Image import
- Estimated RPO: 1h (Estimated, team-set starting value; TC-5 proves it. It is the import interval that the team sets for the job that runs `az acr import`, longer than the replication figure because a scheduled copy cannot be fresher than its interval plus its run time; Learn publishes no figure and describes no schedule for import, and images pushed to the primary since the last run are not in the second registry)
- Estimated RTO: 30m (Estimated, team-set starting value; TC-6 proves it. It is the switch-over that the team designs for the DR deployment to pull from the second registry, which the pipeline fills before DR; Learn publishes no figure)
- Prerequisites: a second registry with its own login server name in the DR region (Premium when it needs private endpoints, which Basic and Standard do not support; Learn lists no region restriction for import); the registry resource provider registered for both regions in the subscription; the import job identity with `Container Registry Data Importer and Data Reader` on both registries; trusted services allowed on any network-restricted registry; the DR registry's own private endpoint, `privatelink.azurecr.io` DNS and role assignments (`AcrPull`, or `Container Registry Repository Reader` on an ABAC registry, for the DR workload identities; `AcrPush`, or `Container Registry Repository Writer`, for the DR build pipeline); an inventory of the repositories and tags (or digests) the DR deployment needs; DR deployment manifests that reference the DR registry's login server from deployment time.
- Cost notes: a second registry (Premium when it needs Premium features) and its storage, the compute that runs the import job, the cross-region transfer of each import and the private endpoint; no price.
- Gives up: automatic, continuous synchronisation and the single registry endpoint (the DR registry has its own name and its own credentials, role assignments, network rules and configuration to build and keep in line); newer images than the last import run (the Estimated RPO is the import interval); and the primary's content when the primary's home region is down: Learn allows an import from an Azure registry only from the source's home region, so this means nothing can be imported from the primary while its home region is unavailable (inference). It also gives up nothing on independence: the copy is a separate registry that a delete in the primary does not reach unless the job propagates it (inference).
- Recommended when: Premium geo-replication is not an option (Basic or Standard registry, a DR region without Premium, or a separate subscription or tenant for DR), or an independent copy is wanted next to or instead of replication, and the DR deployment can reference another login server.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-import-images

## Migration from a paired setup

### Recognise today's setup
Today's paired DR of a registry shows in an inventory in one of three ways. First, a Premium registry with a replica located in the primary's pair: Learn's permissions name the child resource type `Microsoft.ContainerRegistry/registries/replications` (so a replica is a child resource: inference), and `az acr replication list --registry <name> --output table` lists the replicas. Second, a second registry in the pair that is filled by import, `docker` or ORAS copies, or ACR Transfer: record it as today's DR only with evidence of that relationship, which is an import pipeline, task or job that targets it, client or deployment configuration that points at it, or the owner's confirmation. Its region or its name alone never proves it (a registry in the pair, or with a name that resembles the primary's, may be unrelated), and without evidence record the relationship as Unknown. Third, no cross-region setup: a Basic or Standard registry, or a Premium registry with only the home region, whose "DR" is its zone redundancy; the `zoneRedundancy` property can show `false` while zone redundancy is active. The inventory cannot show how consumers reach the registry (global endpoint, regional endpoint or a second registry's name), their DNS cache lifetime, ACR Tasks use or home-region dependence of pipelines: read those from the image references, the registry's endpoints and the pipeline configuration. Migration to a DR region that is not the pair is decided per registry, by option id: `geo-replication` adds a replica in the DR region and removes the pair replica after validation; `secondary-registry-import` builds a second registry and an import job and leaves the primary as it is.

### Build
1. geo-replication: confirm the registry is Premium (`az acr show`) and that the DR region supports the Premium tier; if the registry is Basic or Standard, change the SKU with `az acr update --sku Premium` (Learn: no downtime), and record the registry's home region, its current replicas and the endpoint each consumer uses.
2. geo-replication: grant, before the build, the roles that this playbook's steps use: the Platform engineer role gets `Container Registry Contributor and Data Access Configuration Administrator` on the registry (it configures geo-replications and the network settings), assigned by a holder of `Owner` or `Role Based Access Control Administrator`; the DR workload identities get `AcrPull` (or `Container Registry Repository Reader` on an ABAC registry); the build pipeline keeps `AcrPush` (or `Container Registry Repository Writer`); the Platform engineer identity also holds `AcrPull` (or `Container Registry Repository Reader`) for the pulls by digest of Failover and Failback, and the identity that runs `az acr login` from the runbook holds `Container Registry Contributor and Data Access Configuration Administrator`, which Learn names for `az acr login`; the Platform engineer identity, which creates the replica in the Build step that creates the DR replica, also holds `Microsoft.Network/privateEndpoints/privateLinkServiceProxies/write` (Learn: the identity creating a geo-replica for a private endpoint-enabled registry needs it); the Release engineer identity gets `Container Registry Tasks Contributor` (Learn's role to manage ACR Tasks, used in Failback to restore them) next to the build pipeline's push role; a Network engineer identity holds the right to create the private endpoint and the DNS records.
3. geo-replication: prepare the DR network before the replica exists: a subnet of at least `/27` for the registry's private endpoint in the DR virtual network with free addresses (1 global, 1 data endpoint per replica, 1 regional endpoint per replica when enabled), a dynamic-IP private endpoint (a static-IP endpoint does not add a new replica's members), the private DNS zone `privatelink.azurecr.io` in the DR region's own resource group with its virtual network link, no Delete or Read-only lock on that zone, and a short-lived DNS cache for the global endpoint on clients.
4. geo-replication: the Platform engineer creates the replica with `az acr replication create --registry <name> --location <dr-region>`, then add the DNS records for the replica's data endpoint (and regional endpoint when enabled) in the zone and wait until `az acr replication list` shows the replica with status online (Learn: creation time scales with the registry size, and existing replicas keep serving traffic meanwhile).
5. geo-replication: set up webhooks that notify when replication of a pushed image completes in each replica (one event per replica; deduplicate), Service Health alerts and Resource health for the registry, and an alert when `az acr replication list` shows a replica whose status is other than `online`.
6. geo-replication: configure the DR consumers: they pull from the global endpoint `<registry>.azurecr.io`; where workloads must be pinned, enable regional endpoints (`az acr update --regional-endpoints enabled`, Premium, Azure CLI 2.86.0 or later, Preview) and give each region's deployment its own regional endpoint with a client-side failover to another one; where AKS authenticates with a managed identity and the node image is older than Learn's named version (`202607.29`), use an image pull secret or the global endpoint; pipelines retry pulls after a cross-region push with backoff, pin pushes to one replica (regional endpoint or short-lived DNS cache) and make publish steps idempotent.
7. geo-replication: remove ACR Tasks from the DR critical path or document that they stop while the home region is down (they run only in the home region), and for a registry with a customer-managed key, record the key vault's own DR path.
8. secondary-registry-import: take the inventory of the repositories, tags and digests that the DR deployment needs (the images of the current release and the base images) and record each consumer's image reference.
9. secondary-registry-import: create the second registry in the DR region (Premium when private endpoints are needed), register the Azure Container Registry resource provider for the DR region in the subscription, build its private endpoint, the DNS zone `privatelink.azurecr.io` in the DR region's own resource group and its role assignments: the DR workload identities get `AcrPull` (or `Container Registry Repository Reader`), the DR build pipeline `AcrPush` (or `Container Registry Repository Writer`), and the import job identity `Container Registry Data Importer and Data Reader` on both the second registry and the primary registry (assigned by a holder of `Owner` or `Role Based Access Control Administrator`).
10. secondary-registry-import: allow trusted services on any network-restricted registry on either side (import fails if the setting is disabled), then run the import job: `az acr import --name <second-registry> --source <primary>.azurecr.io/<repo>:<tag> --image <repo>:<tag>` through the primary's global endpoint (the source must be the global endpoint), for every item of the inventory, by digest where a version must be exact, and schedule it at the import interval the team sets (1h in the Estimated RPO); an imported image can have at most 50 manifests.
11. secondary-registry-import: change the DR deployment manifests to reference the second registry's login server (a deployment parameter that the release pipeline sets per region, never code), and keep the primary's references for the primary deployment.
12. Record the current replica list, the endpoint each consumer uses and the time of the build, then go to Validate.

### Validate
1. geo-replication: run TC-1 on the new replica and on the registry, then TC-1 weekly.
2. geo-replication: run TC-2 daily for 7 consecutive days to measure the replication time of a probe image against the Estimated RPO, then TC-2 daily.
3. geo-replication: run TC-3 in a drill window: exclude the primary-region replica from global endpoint routing and time a pull from a DR-region client; repeat after every change to the DR network or the consumers' endpoints.
4. geo-replication: complete the design check of TC-4 (control plane dependence, ACR Tasks, regional endpoint clients, DNS cache), and again after every change to the registry's network, endpoints or consumers.
5. secondary-registry-import: run TC-5 daily for 7 consecutive days, and TC-6 in a drill that blocks the primary registry from the DR region.
6. Run TC-7 on the registry (or registries) of the workload weekly, and run TC-8 once and then quarterly.
7. Record each result with its date; a time that a drill measured is Demonstrated, and every recovery time of the Microsoft-managed failover stays Estimated or Unknown.

### Cut over
1. geo-replication: confirm that every DR consumer uses the global endpoint (or the DR region's regional endpoint with client-side failover), repoint any client pinned to the pair's regional endpoint, and put the Failover steps for geo-replication in the runbook.
2. geo-replication: remove from the runbook any step that relies on the pair-region replica.
3. secondary-registry-import: make the second registry the image source of the DR deployment in the runbook and the DR configuration, and put the Failover steps for secondary-registry-import in the runbook.

### Decommission
1. geo-replication: after TC-1, TC-2, TC-3, TC-4 and TC-7 passed (the DR replica exists before the pair replica goes, so the registry never has fewer regions than before; Learn recommends two or three replicas), delete the pair replica with `az acr replication delete --registry <name> --name <replica-name>` (the replication resource name from `az acr replication list`, not the region), then remove its data endpoint DNS record, after unlocking the private DNS zone if a lock blocks the deletion.
2. geo-replication: if the pair-region replica is the home region replica it cannot be removed: leave it and record that the control plane stays in that region (the home region is fixed at creation and moving it is a redeployment).
3. secondary-registry-import: remove the consumer references that pointed DR workloads at a second registry in the pair, and delete that registry only after TC-5, TC-6 and TC-8 passed on the new second registry and no consumer references it. Leave the primary registry as it is.

### Keep until cut-over
For geo-replication: the pair-region replica, its private endpoint and DNS records, and every consumer's current endpoint until TC-1, TC-2, TC-3 and TC-4 have passed on the DR replica. For secondary-registry-import: the current DR registry in the pair, its import job and the consumers' references to it, until TC-5, TC-6 and TC-7 have passed on the new second registry.

## Failover and failback

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm the loss of the primary region from Azure Service Health and the registry's Resource health, and declare DR for the workload (Microsoft does not notify you of a region failure automatically) | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time | The registry answers on its global endpoint again before the declaration |
| 2 | geo-replication: check the replicas with `az acr replication list --registry <name> --output table` and a pull of the current release by digest through the global endpoint from the DR region; the registry's health-aware failover is Microsoft-managed and has no customer-invocable trigger (the customer can only exclude a replica from global endpoint routing, as in TC-3) | Platform engineer | Estimated unknown (Learn's pages differ: 1 to 2 minutes, or on the order of minutes plus possible DNS TTL delay) | The DR replica lists as online and the pull succeeds from the DR region for the digests of the release | The DR replica does not list as online and no other replica serves the release: do not start DR workloads on this registry; the application owner decides, and the platform engineer opens a support request with Azure support |
| 3 | geo-replication: for clients pinned to a regional endpoint of the failed region, switch to the DR region's regional endpoint and sign in to it again (`az acr login --name <name> --endpoint <region>`, which needs the control plane role granted in Build); clients on the global endpoint need no change | Application engineer | Estimated unknown (measured in the first drill) | Pulls from the DR regional endpoint succeed for the release's digests | Pulls fail with an authorisation error: check that the identity holds `AcrPull` (or `Container Registry Repository Reader`) on the registry |
| 4 | geo-replication: start the DR workloads and let them pull through the global endpoint, retrying pulls with backoff | Application engineer | Estimated 30m (the DR workload start the team designs; TC-3 times the registry side) | The workloads pull their images and report ready; a `manifest unknown` from a pull is retried until replication catches up | A required image or tag is missing in the DR replica: use the digest of the previous release and record the gap |
| 5 | geo-replication: stop changes to registry configuration and ACR Tasks while the home region is down (the control plane is unavailable, Tasks do not run) and keep pipeline pushes on the global endpoint with retries (data plane push works through any available replica) | Release engineer | Estimated unknown (a decision during the incident) | A test push of a probe image succeeds through the global endpoint and shows up on the DR replica (webhook or pull by digest) | A push fails with manifest errors: pin the push to one replica with a regional endpoint or a short-lived DNS cache and retry |
| 6 | secondary-registry-import: check the last successful import into the second registry and that the release's digests exist in it | Platform engineer | Estimated unknown (measured in the first drill) | The import job's last successful run is within the Estimated RPO and every digest of the release is present in the second registry | The last run is older than the Estimated RPO: the application owner decides whether to go on with the older images |
| 7 | secondary-registry-import: start the DR workloads with the DR deployment configuration that references the second registry's login server | Application engineer | Estimated 30m (the Estimated RTO of the option; TC-6 proves it) | The DR registry's name resolves to its private IP address from the DR network, and the workloads pull by digest and report ready | A pull fails: check the private endpoint, the DNS record and `AcrPull` on the second registry before any change to the images |
| 8 | secondary-registry-import: point DR builds and pipeline pushes at the second registry (new images exist only there; an import from the primary's home region is not possible while it is down) | Release engineer | Estimated unknown (a decision during the incident) | A test push of a probe image to the second registry succeeds with `AcrPush` (or `Container Registry Repository Writer`) | The push is refused: check the pipeline identity's role on the second registry |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region and the registry's control plane are available again (Service Health, Resource health) | Platform engineer | Estimated unknown (measured in the first drill) | The registry's control plane answers and `az acr replication list` lists every replica as online | The home region is still unavailable or a replica is not online |
| 2 | geo-replication: wait for the global endpoint to route back (Learn: failback is automatic once the regional health evaluation passes, and changes that occurred during the outage synchronise by eventual consistency); if a drill excluded a replica from routing, set `--global-endpoint-routing true` again, and re-run any registry configuration change that was held back | Platform engineer | Estimated unknown (Learn: automatic, no figure; for a drill re-enable, a replica is "immediately ready to serve traffic with no catch-up window") | The replica list shows the replicas online and routing enabled, and the digests of the release resolve identically through the global endpoint | A replica stays non-online: keep the workloads on the working endpoint and open a support request with Azure support |
| 3 | geo-replication: restore ACR Tasks and resume the paused pipelines, and move pinned clients back to their regional endpoints (sign in to each again) | Release engineer | Estimated unknown (measured in the first drill) | Pulls from each regional endpoint succeed, and a Task run starts in the home region | A client fails to pull: stay on the global endpoint |
| 4 | geo-replication: compare the tag-to-digest list of the DR replica with that of the home replica (webhook events and `az acr manifest list-metadata`) | Platform engineer | Estimated unknown (a comparison of the two tag-to-digest lists; measured in the first drill) | The lists are equal and no `manifest unknown` appears on pulls | The lists still differ after one replication window: investigate before any removal of images |
| 5 | secondary-registry-import: import the images built during DR from the second registry into the primary through the second registry's global endpoint (`az acr import --name <primary> --source <second-registry>.azurecr.io/<repo>:<tag> --image <repo>:<tag>`), with the import job identity | Release engineer | Estimated unknown (depends on the number and size of the images built during DR; Learn publishes no figure) | Every digest built during DR exists in the primary registry | An import fails: check `Container Registry Data Importer and Data Reader` on both registries and the trusted services setting |
| 6 | secondary-registry-import: point builds and workloads back to the primary registry and resume the scheduled import into the second registry | Application engineer | Estimated unknown (measured in the first drill) | Workloads pull from the primary, and the next import run into the second registry succeeds | A pull fails: keep the workloads on the second registry |

## Test criteria

### TC-1: The DR replica exists, is online and the registry is Premium
- Applies to: geo-replication
- Pass condition: the registry's SKU is Premium; `az acr replication list` lists a replica in the DR region; its status shows online (Learn: replicas with issues show a status other than `online`), and no replica of the registry shows another status; every DR network that runs consumers holds the registry's private endpoint with the replica's data endpoint record resolving to a private address (when private endpoints are used); and the registry has at least the number of replicas the team set (two or three where throttling matters).
- How to measure: read the registry with `az acr show` and `az acr replication list --output table`, and resolve the registry's global and data endpoint names from inside each DR network.
- Evidence: the command output with its date, the resolved addresses per DR network and the replica count.
- Frequency: weekly, and after every change to the registry's replicas, SKU or network

### TC-2: Images replicate within the Estimated RPO
- Applies to: geo-replication
- Pass condition: a probe image pushed to the registry is reported as replicated by the webhook of the DR replica within the Estimated RPO of 15 minutes on each of 7 consecutive daily runs, and the tag-to-digest lists of the home replica and the DR replica are equal for every repository of the workload when the job ends. A run that exceeds 15 minutes fails this check and is reported with its measured time.
- How to measure: a scheduled job pushes a probe image (a small image and an image of the size of the largest of the workload), records the push time, waits for the webhook events of each replica and compares the manifest digests per replica (`az acr manifest list-metadata` or a pull by digest from a regional endpoint where enabled).
- Evidence: the job log with push time, per-replica webhook time and the measured lag, and the digest comparison.
- Frequency: daily

### TC-3: Clients keep pulling when a replica is excluded from global endpoint routing
- Applies to: geo-replication
- Pass condition: with the primary-region replica excluded by setting `--global-endpoint-routing` to false, a client in the DR region pulls the current release by digest through the global endpoint with no configuration change, and the time from the exclusion to the first successful pull is recorded and is within the Estimated RTO of 5 minutes (DNS cache lifetime of the clients included; a run above 5 minutes fails this check and is reported with its measured time); after the drill the setting is back to true and the replica list shows routing enabled. Design check, not drillable: the Microsoft-managed health-aware failover and the unavailable control plane of a lost home region cannot be triggered, so the drill measures only the client side of the exclusion.
- How to measure: a drill that disables routing for the primary-region replica with `az acr replication update`, repeats a pull from a DR-region client at short intervals until it succeeds and re-enables the setting; in a real failover, record the time from the loss of the region to the first successful pull in DR.
- Evidence: the drill record with its timestamps, the pull log, the client DNS cache setting and the replica list before and after; after a real failover, the observed time.
- Frequency: every DR drill, and after every change to the DR network, the clients' DNS cache or the consumers' endpoints

### TC-4: The DR path does not depend on the home region's control plane
- Applies to: geo-replication
- Pass condition: design check, not drillable (the home region's control plane cannot be taken away in a drill): no DR step needs a registry configuration change, a replication change or an ACR Task (or each has a documented path that avoids the home region), every consumer uses the global endpoint or implements client-side failover for a regional endpoint with its own `az acr login` for that hostname, the DR network holds the private endpoint, the DNS zone and the role assignments before DR, the DNS cache for the global endpoint is short-lived, and for a customer-managed key the key vault has its own DR path.
- How to measure: a review of the consumers' image references, the pipeline definitions, the registry's endpoints and network settings and the runbook.
- Evidence: the review record with its date, the list of consumers with the endpoint each uses and the list of Tasks and their DR path.
- Frequency: after every change to the registry's network, endpoints, tasks or consumers, and every DR drill

### TC-5: The second registry holds the release and is no older than the import interval
- Applies to: secondary-registry-import
- Pass condition: every repository and tag (or digest) of the inventory exists in the second registry with the same manifest digest as in the primary, and the import job's last successful run is no older than the import interval of 60 minutes that the team sets, on each of 7 consecutive daily checks. Where a digest differs, the check fails (Learn does not state whether an import keeps the digest, so a difference is a finding to resolve and not an assumption).
- How to measure: a scheduled job lists the manifests of the inventory's repositories in both registries (`az acr manifest list-metadata`), compares tag-to-digest, and reads the last successful run time of the import job.
- Evidence: the job report with its date, the compared digests and the job's last successful run time.
- Frequency: daily

### TC-6: The DR deployment runs from the second registry within the Estimated RTO
- Applies to: secondary-registry-import
- Pass condition: with the primary registry unreachable from the DR region, the DR deployment starts using only its own configuration (no code change), every image of the release is pulled from the second registry by digest over the private endpoint, and the switch-over completes within the Estimated RTO of 30 minutes.
- How to measure: a drill that blocks the primary registry from the DR region with a network rule and times the DR deployment from start to the first workload ready, with the pull log of the second registry.
- Evidence: the drill record with its timestamps, the pull log and the measured time.
- Frequency: every DR drill, and after every change to how the DR deployment selects its registry

### TC-7: The DR registry path is configured as planned
- Applies to: geo-replication, secondary-registry-import
- Pass condition: for the registry or registries of the workload, the role assignments are the planned ones (DR workload identities hold `AcrPull` or `Container Registry Repository Reader`, the pipeline identity holds `AcrPush` or `Container Registry Repository Writer` where it pushes, the import job identity holds `Container Registry Data Importer and Data Reader` on both registries for secondary-registry-import, the Release engineer identity holds `Container Registry Tasks Contributor`, and the platform role holds `Container Registry Contributor and Data Access Configuration Administrator` only where it runs the build), the private endpoint connection is Approved, its name resolves to a private IP address from every DR network that runs consumers, the private endpoint subnet has free addresses for another replica, the private DNS zone has no Delete or Read-only lock that would block replica deletion, and trusted services access is enabled on a network-restricted registry that takes part in import.
- How to measure: read the registry properties, the private endpoint connection state and the role assignments of the registry scope, resolve the endpoint names from inside each DR network, check the subnet's free addresses and the zone's locks.
- Evidence: the query output with its date, the resolved addresses, the role assignment list and the subnet's free address count.
- Frequency: weekly, and after every change to the DR network, DNS or role assignments

### TC-8: A deleted image can be re-created from a copy that replication does not touch
- Applies to: geo-replication, secondary-registry-import
- Pass condition: every repository and digest of the release exists in a copy outside the registry's replica set (a second registry, an ORAS or Docker copy, or an ACR Transfer export in storage) with the same digest, and a test tag deleted in a test repository is re-created in the registry from that copy within the restore bound that the team sets and records. For secondary-registry-import the second registry is the copy, and the check passes only if its import job does not propagate deletes from the primary.
- How to measure: list the copy's digests and compare them with the release's, then delete a test tag in a test repository, restore it from the copy (`az acr import`, ORAS or Docker push) and time it.
- Evidence: the digest comparison, the restore drill log with its timestamps and the measured time.
- Frequency: quarterly
