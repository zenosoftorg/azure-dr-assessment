---
service: container-apps
title: Azure Container Apps
arm_types:
  - microsoft.app/containerapps
  - microsoft.app/managedenvironments
slot: compute
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps
  - https://learn.microsoft.com/en-us/azure/container-apps/relocate-region
  - https://learn.microsoft.com/en-us/azure/container-apps/networking
  - https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks
  - https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets
  - https://learn.microsoft.com/en-us/azure/container-apps/how-to-integrate-with-azure-front-door
  - https://learn.microsoft.com/en-us/azure/container-apps/how-to-zone-redundancy
  - https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication
  - https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods
  - https://learn.microsoft.com/en-us/azure/frontdoor/health-probes
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-steps
  - https://learn.microsoft.com/en-us/azure/container-registry/container-registry-concepts
  - https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-overview
---

# Azure Container Apps

## Mechanisms

### Zone redundancy
- Replicates: the underlying infrastructure of one environment and the replicas of its apps across the availability zones of one region (replicas are scheduled across zones by the platform); control plane metadata (app configurations, scaling rules and secrets) is replicated across zones, and application data is not
- Paired: no
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: 0 (for a zone failure only: Learn says "No data loss occurs at the Container Apps platform level because the service is designed for stateless workloads", and data in ephemeral storage is lost when the replica terminates; the mechanism does not cover a region failure)
- Estimated RTO: unknown (for a zone failure only: Learn says applications "experience minimal to no downtime", that rerouting "typically occurs in about 30 seconds" depending on the health probe configuration, and gives no fixed figure; the mechanism does not cover a region failure)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps#resilience-to-availability-zone-failures

### Automatic health monitoring
- Replicates: nothing; the built-in ingress controller load balances across healthy replicas, restarts failed containers or creates replacement replicas, and keeps the specified replica count, inside one environment
- Paired: no
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: unknown (nothing is replicated by this capability, and Learn publishes no figure for it)
- Estimated RTO: unknown (Learn describes the recovery as automatic and publishes no figure; it applies inside one region, so it gives no recovery from the loss of the region)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps#reliability-architecture-overview

## Constraints

### Container Apps is a single-region service with no built-in multiregion support
Learn says "Container Apps is a single-region service. If the region becomes unavailable, your environment and apps are also unavailable." Learn's region-wide failure section offers only a custom multiregion solution, and describes no Microsoft-managed failover, no paired-region behavior and no customer-initiated failover. So neither the paired region nor a nonpaired region receives a copy of an environment from the platform (inference from the absence of such a mechanism in Learn): every DR region, paired or not, is built by the customer in the same way.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps#resilience-to-region-wide-failures

### The custom multiregion solution has three parts
Learn's custom solution deploys the applications to environments in each region (each environment needs its own virtual network configuration, and the subnet requirements apply independently to each regional deployment), makes the container images available from all regions ("which you can achieve by using Azure Container Registry with geo-replication enabled"), configures load balancing and failover policies with a service like Azure Front Door or Azure Traffic Manager, and replicates the data across regions "so that you can recover your last application state".
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps#custom-multiregion-solutions-for-resiliency

### There is no built-in backup, and the platform holds no application data to restore
Learn says "Container Apps doesn't provide built-in backup capabilities for your applications or data": it is a stateless container hosting platform, containers and their local file systems are ephemeral, and "any data stored locally is lost when replicas restart or move". There is therefore no backup-restore option for Container Apps, and the data of the application is recovered through the services that hold it (databases, storage, messaging), each under its own playbook.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps#backup-and-restore

### Stateful data belongs in services that replicate it themselves
Learn says Container Apps does not replicate application data between zones because it is designed for stateless workloads, and that data in ephemeral storage is deleted when the container or replica shuts down. For stateful needs it names mounting an Azure Files file share configured for zone-redundant storage, or using other Azure services like Azure Cosmos DB or Azure SQL Database that provide their own cross-zone replication capabilities (a zone statement: the DR region's copy of such data is a matter of those services' own cross-region mechanisms).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps#behavior-when-all-zones-are-healthy

### An environment is region-bound and cannot be moved or reused in another region
Learn's relocation article says Container Apps "doesn't support in-place region migration" and "doesn't support live region migration": existing resources are not moved, they are recreated in the target region, and "Managed environments are region-bound and can't be reused across regions". The container app template must point at the managed environment of the target region.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/relocate-region

### The target region must support the same features and have quota
The relocation prerequisites are that Container Apps is available in the target region, that the target region supports the same Container Apps features, workload profiles and networking options as the source, that quota is sufficient in the target region, and that dependent Azure resources such as Key Vault, storage accounts, databases, virtual networks and messaging services are either already available in the target region or have a redeployment plan.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/relocate-region#prerequisites

### Dependent resources that must exist in the target region before cutover
Learn's list of dependent resources that must exist in the target region before cutover is Azure Key Vault, storage accounts, databases and messaging services (such as Azure Service Bus and Azure Cosmos DB), virtual networks, subnets and private endpoints, network security groups and user-defined routes, private DNS zones, Log Analytics workspaces, and Dapr components if used.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/relocate-region#identify-dependencies

### Exported templates do not carry secrets, certificates or custom domains
Learn says secrets, certificates, custom domains and secure configuration values "aren't preserved" in exported templates and must be recreated manually in the target region from their original sources, and that an exported template is a starting point that may contain read-only properties to remove.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/relocate-region#prepare

### Managed identities are recreated in the target region
For a system-assigned identity, recreating the app generates a new principal ID, so every RBAC role and downstream permission must be assigned again. User-assigned managed identities are regional resources that cannot be moved across regions, so a new one is created in the target region and given its permissions before deployment.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/relocate-region#plan-for-managed-identity-changes

### The FQDN of the DR app differs from the primary's
After redeployment the application's fully qualified domain name changes, so custom DNS records and traffic routing are updated at cut-over. Learn tells to review the ingress configuration and to recreate secrets by using Azure Key Vault references or application configuration instead of exported values.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/relocate-region#modify-the-container-app-template

### Relocation limitations: no revision history, new outbound IP addresses, downtime at cutover
Learn's limitations list says that the revision history isn't retained in the target deployment, that secrets, certificates and custom domains must be recreated, that outbound IP addresses change (which might affect the allow lists of downstream services), and that downtime is required during cutover. Learn's wording is for a relocation, where DNS propagation and routing changes drive the downtime; with a standing DR environment the same routing and DNS delay applies, which is an inference.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/relocate-region#limitations

### Permissions for redeploying
Learn lists Owner or Contributor on the resource group in the source and target subscriptions, and recommends the Container Apps Contributor role, which "includes wildcard permissions that grant access to Container Apps secret values".
- Source: https://learn.microsoft.com/en-us/azure/container-apps/relocate-region#prerequisites

### Contributor cannot assign roles
Learn's list of privileged administrator roles says Contributor grants full access to manage all resources but "can't assign roles in Azure RBAC"; Owner, Role Based Access Control Administrator and User Access Administrator can assign roles. So the redeployment role that Learn's relocation article names (Owner or Contributor) is not enough on its own for the role assignments that a DR environment needs (AcrPull, Key Vault Secrets User, downstream roles): a holder of a role that can assign roles makes them.
- Source: https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-steps#privileged-administrator-roles

### Several built-in roles can read secret values
Learn says Container Apps exposes separate listSecrets operations that return secret values in plain text, and that built-in roles with wildcard permissions (Container Apps Contributor, and Container Apps Operator and Container Apps Jobs Operator among them) grant the ability to read secret values even when the role name or description suggests narrower access. The effective access depends on the scope of the assignment, so a role is assigned only to the identities that need it, at the narrowest scope that covers the apps.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets#permissions-for-managing-secrets

### Key Vault references need a managed identity and the Key Vault Secrets User role
Learn says a secret defined as a reference to Azure Key Vault needs a managed identity on the container app that holds the Azure RBAC role Key Vault Secrets User on the vault. Without a version in the secret URI the app retrieves the latest version, and newer versions are picked up "within 30 minutes" with a restart of the active revisions that use the secret in an environment variable; for full control of which version is used, the URI carries the version. A DR app in another region therefore references the secret URI of a vault it can reach with its own identity holding the role on that vault (the vault itself is covered by the Key Vault playbook).
- Source: https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets#reference-secret-from-key-vault

### Key Vault reference errors have five documented causes
Learn's troubleshooting table for Key Vault references lists these causes: managed identity not enabled, identity not found (not created or not assigned to the app), secret disabled in Key Vault, authentication failed (the identity lacks Key Vault Secrets User on the vault), and RBAC permission denied (insufficient role assignment on the vault). It does not name a log where the error is shown.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets#troubleshoot-key-vault-references

### The virtual network type is fixed at creation
After an environment is created with either the default Azure network or an existing virtual network, "you can't change the network type".
- Source: https://learn.microsoft.com/en-us/azure/container-apps/networking#virtual-network-type

### The subnet is dedicated and its size is fixed at creation
With an own virtual network the environment needs a subnet dedicated exclusively to it, and the subnet size cannot be modified after the environment is created. A workload profiles environment needs at least a /27 subnet delegated to Microsoft.App/environments, a Consumption-only environment needs at least a /23 subnet that is not delegated to any service, and the subnet ranges must not overlap 169.254.0.0/16, 172.30.0.0/16, 172.31.0.0/16 and 192.0.2.0/24 (reserved for AKS), nor, for a workload profile environment, the four 100.100.x.x ranges that Learn names. So the DR environment's address space is planned before it is created.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks#subnet

### Zone redundancy is set at environment creation and needs a virtual network
Zone redundancy is available in all regions that support Container Apps and availability zones (Learn points to the product availability by region table for Container Apps). It is enabled during environment creation and cannot be changed after the environment is created, it requires a virtual network whose region supports availability zones with an adequately sized subnet, and the minimum replica count must be at least two for replicas to be spread across zones. It protects against a zone failure, not a region failure (Learn's region failure section is separate), so the DR environment's zone redundancy is decided when it is created.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps#requirements

### Zone redundancy can be verified on the environment
Learn's verification is the JSON of the environment: the property `zoneRedundant` holds true when zone redundancy is enabled (portal JSON view or `az containerapp env show`; in PowerShell the ZoneRedundant property).
- Source: https://learn.microsoft.com/en-us/azure/container-apps/how-to-zone-redundancy#verify-zone-redundancy

### Container images must be reachable from the DR region
Learn's relocation prerequisites require the container images to be in a registry accessible from the target region (for example Azure Container Registry or a supported external registry). Its tip says that Azure Container Registry geo-replication makes the images available in the target region without redeploying the registry (`az acr replication create` with the target location).
- Source: https://learn.microsoft.com/en-us/azure/container-apps/relocate-region#prerequisites

### Registry geo-replication requires the Premium SKU
Geo-replication of Azure Container Registry requires the Premium SKU. To copy images between separate registries, Learn points to importing container images. The registry side (replication, import into a second registry) is covered by the container-registry playbook.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication

### The DR app's identity needs AcrPull on the registry before deployment
Learn says to confirm that the identity of the container app (system-assigned or user-assigned managed identity) has the AcrPull role on the target Azure Container Registry, and that if the registry is in a different subscription or region the permissions are configured in advance to prevent image pull failures during deployment.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/relocate-region#validate-container-registry-access

### Registry geo-replication is eventually consistent
ACR replicates in the background: "a pushed image or tag might not be immediately available for pull in other geo-replicas", and pushing to one geo-replica and immediately pulling from another can fail with `manifest unknown` until replication catches up. The time to create a new geo-replica scales with the total size of the registry, and webhooks can notify when replication of a pushed image completes in each geo-replica.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#consistency-model

### Registry roles for the build, the import and the checks
Learn's recommended roles by scenario for an Azure Container Registry are: for creating and configuring geo-replications, network access and registry endpoints, `Container Registry Contributor and Data Access Configuration Administrator` (a control plane role that includes no data plane operations and no role assignment capability); for identities that import with `az acr import`, `Container Registry Data Importer and Data Reader`; for identities that pull (Azure Container Apps among them), `AcrPull` on a registry with "RBAC Registry Permissions" and `Container Registry Repository Reader` on a registry with "RBAC Registry + ABAC Repository Permissions", which view tags and repositories but do not grant repository catalog list permissions; and for control plane read-only access to list registries and inspect configuration, `Container Registry Configuration Reader and Data Access Configuration Reader`. Learn names no role for `az acr manifest list-metadata` itself; that the pull role above covers it is an inference.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-rbac-built-in-roles-overview#recommended-built-in-roles-by-scenario

### The global registry endpoint routes to the best replica, which is usually the closest
Learn says Azure routes requests to the geo-replica with the best network performance profile for the client, which is usually the closest geo-replica, but "if the client is equidistant to multiple geo-replicas or the closest geo-replica is unavailable, requests might be routed elsewhere". This means (inference) that a check from the DR region through the global endpoint does not prove that the DR region's replica answered.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication

### Regional endpoints of a registry are a Preview opt-in on Premium
Learn marks regional endpoints (`myregistry.<region>.geo.azurecr.io`, one per geo-replica) as Preview, available only on Premium registries, to be enabled when creating or updating a registry; health-aware failover does not apply to them, so a client that uses one has to implement its own failover.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#regional-endpoints-of-a-geo-replicated-registry-preview

### Manifests of a registry are listed with az acr manifest list-metadata
Learn's registry concepts article lists the manifests of a repository with `az acr manifest list-metadata --name <repositoryName> --registry <acrName>`.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-concepts#artifact

### A registry home-region outage stops configuration changes, not image pulls
If the home region of the registry is unavailable, data plane operations continue through the remaining geo-replicas, but registry configuration changes such as replication settings cannot be made until the home region recovers, and ACR Tasks do not run.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#home-region-outage-behavior

### Replication status is read with az acr replication list
Learn's health-aware failover section says to check replication status with `az acr replication list --registry myregistry --output table`, and that geo-replicas experiencing issues show a status other than `online`.
- Source: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-geo-replication#health-aware-failover

### Private endpoints need public network access disabled
To create private endpoints in a Container Apps environment, public network access must be set to Disabled. An internal environment has no public endpoint and its public network access cannot be changed to accept internet traffic; an external environment can change the setting after creation.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/networking#public-network-access

### Azure Front Door reaches an environment over Private Link only from Premium, for workload profile environments
Learn's private link tutorial states that the feature is supported only for workload profile environments, that private link is not supported for origins in the Standard tier of Azure Front Door (Premium is required), that the target sub-resource is managedEnvironments, that the private endpoint connection request has to be approved on the environment, that private endpoints on Azure Container Apps support only inbound HTTP traffic (TCP is not supported) and carry additional charges in both the Dedicated and Consumption plans, that Azure Front Door has a known issue where it might create multiple connection requests, and that the feature is available only in the regions of Front Door's private link region list. For zone-redundant environments with an internal virtual IP, the topology Front Door, Private Link Service and internal load balancer is unavailable, and Learn tells to use a private endpoint instead.
- Source: https://learn.microsoft.com/en-us/azure/container-apps/how-to-integrate-with-azure-front-door

### Azure Front Door routes by availability, priority, latency and weight
Learn's decision flow selects the origins that are enabled and healthy (a 200 OK health probe response), then the top priority among them, then the origins inside the latency range, then splits by weight.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods#overall-decision-flow

### Azure Front Door Priority routing is the active-passive method
Learn says that to ensure high availability, backup services are deployed to take over if the primary service fails, a setup "known as Active/Standby or Active/Passive deployment", and that the Priority routing method of Azure Front Door implements it: a primary origin handles all traffic and a secondary origin is the backup if the primary becomes unavailable.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods#priority-based-traffic-routing

### Azure Front Door counts any answer other than 200 OK as a probe failure
Front Door treats a 200 OK status code as a healthy origin and counts any other status code, or the absence of a valid HTTP response, as a probe failure.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/health-probes#health-probe-responses

### Azure Traffic Manager Priority routing sends traffic to the primary endpoint first
The Priority routing method sends all traffic to the primary endpoint and moves to the next endpoint when the primary is not available. The priority value is between 1 and 1000, a lower value is a higher priority, and endpoints cannot share a value.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods#priority-traffic-routing-method

### Azure Traffic Manager fails over by DNS
Endpoint monitoring marks an endpoint Degraded after the tolerated number of failures and stops returning it in DNS answers. Recursive DNS caches keep the old answer until the TTL expires and existing connections are not influenced. Learn's worked timeline uses a 30 seconds probing interval, 3 tolerated failures, a 10 seconds timeout and a 30 seconds DNS TTL.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#endpoint-failover-and-recovery

### Azure Traffic Manager answers with all endpoints when all are degraded
Learn says that when all eligible endpoints have a degraded status Traffic Manager makes a "best effort" attempt and responds as if all the Degraded endpoints were online, so a profile whose health checks are not configured correctly can look as if it works while "endpoint failover cannot happen".
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#traffic-routing-methods

### Azure Traffic Manager cannot probe private addresses
Learn says Traffic Manager is not designed to probe endpoints that resolve to addresses within private, non-routable or Microsoft-internal network spaces, which must be configured as Always serve traffic endpoints, so it cannot provide health-based failover for them. This means (inference) that an internal Container Apps environment cannot be the monitored endpoint of a Traffic Manager profile.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#enable-or-disable-health-checks

## Non-paired options

### secondary-environment: Second environment in the DR region, deployed from code, behind Front Door or Traffic Manager
- Kind: workaround
- Target: dr-region
- Uses mechanism: none
- Estimated RPO: 0 (stateless compute tier only: Container Apps holds no application data to replicate, and Learn says it "doesn't provide built-in backup capabilities" and is designed for stateless workloads, so the second environment adds no data loss of its own, and the data tier's Estimated RPO governs the application, each data service under its own playbook; the application's configuration and images follow the deployment and image replication interval the team sets, which TC-1 and TC-2 prove — https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps#backup-and-restore)
- Estimated RTO: 30m (Estimated, team-set starting value; TC-3 proves it. It is the switch-over target that the team sets as the parameter of this option, with 30m as the starting value to replace with its own: the time for Front Door or Traffic Manager health detection plus scale-up of a standing DR environment that is already deployed; it is a team-set design target, not a Learn figure, because Learn publishes no figure for a custom multiregion solution, and TC-3 proves it. A cold variant that deploys the apps at the time of the disaster has no target here and is measured in the first drill)
- Prerequisites: Container Apps and the same features, workload profiles and networking options available in the DR region, with enough quota there; a DR virtual network and a dedicated subnet of the size the environment type needs (/27 workload profiles, /23 Consumption-only), planned before creation, plus a zone-redundant environment where the DR region has availability zones and the primary is zone-redundant; the container images available in the DR region (Azure Container Registry Premium with a geo-replica in the DR region, or another registry the DR region can reach); a DR copy of every dependency (Key Vault, storage, databases, messaging, private DNS zones, Log Analytics workspace, Dapr components), each recovered under its own playbook; a user-assigned or system-assigned managed identity for the DR apps with AcrPull on the registry and Key Vault Secrets User on the vault the DR app reaches; the app's configuration as code (the exported templates are a starting point only) and the source of truth for every secret, certificate and custom domain, because the exports do not carry them; a traffic routing service in front of both environments (Azure Front Door, Premium for private link origins, or Azure Traffic Manager for publicly reachable endpoints) or a DNS change with a lowered TTL; a health path in every app that the routing service can probe.
- Cost notes: a second environment and its apps (more when kept warm with a higher minimum replica count), the managed resources that come with an environment in an own virtual network (a load balancer and public IP addresses, billed at their rates), private endpoints, an ACR geo-replica and its cross-region data transfer, a Front Door Premium profile or a Traffic Manager profile, and the pipeline runs; zone redundancy adds no Container Apps charge; no price.
- Gives up: a Microsoft-managed failover (there is none), the same app identity (a system-assigned identity gets a new principal ID, user-assigned identities are regional), the FQDN, the custom domain bindings, the managed certificates and the outbound IP addresses of the primary (the DR app has its own and downstream allow lists change), the revision history, any application data that the data services do not replicate on their own, and a free standby (the DR environment is a second deployment that is kept in step with the primary).
- Recommended when: the DR region is not the primary's pair or the pair is not acceptable, the application is stateless on the Container Apps side (state held by services that have a DR path into the same DR region), and the team can run a second environment and keep its configuration in step with the primary by pipeline; the only option for Container Apps that Learn documents for any region.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps#custom-multiregion-solutions-for-resiliency

## Migration from a paired setup

### Recognise today's setup
Container Apps has no built-in replication to the pair, so a paired DR shows only as a second deployment that someone built. A second environment in the paired region, or one with a similar name, is never proof by itself that it is the DR of the primary: region, name or co-location alone never proves the relationship. Treat it as DR only on evidence of the relationship:
- a second managed environment (`microsoft.app/managedenvironments`) in the paired region with container apps (`microsoft.app/containerapps`) in it, tied to the primary by at least one of: a Front Door or Traffic Manager profile whose origins or endpoints point at both, deployment definitions or pipelines that target both, or tags that the owner set to say so;
- a Front Door profile or Traffic Manager profile with two origins or endpoints, one of them the FQDN of an app in the paired region (a priority or an enabled state that makes it the backup), or a DNS record that is changed by hand (this routing is itself one of the pieces of evidence above);
- an Azure Container Registry geo-replica in the paired region, or an image copy in a registry there;
- the environment's zone redundancy flag (`zoneRedundant`) and its virtual network, subnet size and public network access setting.
If the inventory shows only one environment and no second deployment at all, today's DR is none: Learn lists no built-in mechanism, so record it as "no DR for Container Apps" (Gap), never as a Microsoft-managed failover. If it shows a second environment without evidence of the relationship, record the DR as Unknown, never as DR. The inventory cannot show whether the paired environment is current (image digests, scale and secrets), whether its secrets and certificates exist, whether its data services replicate, the DNS TTL in use, or whether the routing service probes the right path; those are checked in Validate. Migration to a DR region that is not the pair uses the single option secondary-environment: it builds the same second deployment in the new DR region and moves the routing there.

### Build
1. secondary-environment: take the inventory of the primary: every environment (type, region, zone redundancy, virtual network type, subnet size, public network access, workload profiles, Log Analytics workspace) and every app and job (image and digest, ingress, scale rules and minimum and maximum replica counts, secrets by name and source, environment variables by name, identity, volumes, Dapr components, custom domains and certificates), and the dependencies they use (Key Vault, storage, databases, messaging). This inventory is what TC-1 compares.
2. secondary-environment: confirm the DR region against the prerequisites of Learn's relocation article: Container Apps and the features, workload profiles and networking options in use are available there, and quota covers the primary's maximum replica counts; where quota is short, request more before going on.
3. secondary-environment: grant the roles first, because Contributor cannot assign roles (Learn: "can't assign roles in Azure RBAC"). The platform engineer role gets Contributor (Learn lists Owner or Contributor, and recommends Container Apps Contributor) on the DR resource group and on the resource group of the primary environment (Learn names the resource group of both the source and the target; the failback step that brings the primary environment to the current images and configuration deploys to the primary); the network engineer role gets Contributor on the resource group that holds the Front Door or Traffic Manager profile so that it can disable or re-enable an endpoint (this scope is an inference: Learn's relocation article names the roles for the redeployment only); the access administrator role (a different holder from the platform engineer) gets Role Based Access Control Administrator, User Access Administrator or Owner (the roles that Learn lists as able to assign roles) on the DR resource group, the registry (every registry assignment above is made by this role), the vault and the scopes of the downstream services, and makes the role assignments of the Build steps that create the DR managed identity and recreate what the exports do not carry; the platform engineer role also gets `Container Registry Contributor and Data Access Configuration Administrator` on the registry (the control plane role Learn names for configuring geo-replications; the registry may be in another resource group or subscription, so the scope is the registry itself) and, when the images are imported instead, `Container Registry Data Importer and Data Reader` on the source and the DR registry; the identity of the TC-2 check job gets the pull role of the registry's role assignment permissions mode (`AcrPull`, or `Container Registry Repository Reader` on a registry with ABAC repository permissions) and `Container Registry Configuration Reader and Data Access Configuration Reader` on the registry, which Learn names for viewing registry configuration (that these suffice for `az acr manifest list-metadata` is an inference, so the TC-2 job is tested once with them); the data platform engineer role gets the roles that the playbooks of the data services name; the application engineer role gets Reader on the DR resource group and read access to the Log Analytics workspace of the DR environment. Keep the roles with secret-reading wildcard permissions (Container Apps Contributor, Container Apps Operator, Container Apps Jobs Operator) limited to the identities that need them.
4. secondary-environment: build the DR network: a virtual network and a dedicated subnet in the DR region (a /27 or larger delegated to Microsoft.App/environments for a workload profiles environment, a /23 or larger not delegated for a Consumption-only environment; no overlap with the reserved ranges Learn lists, and, for a Consumption-only environment created with a custom service CIDR (the only case where Learn states it), none between the app's subnet or any peered subnet and that range), the network security groups and user-defined routes of the primary, the private DNS zones, and the private endpoints of the dependencies in the DR region.
5. secondary-environment: make the images available in the DR region: add a geo-replica of the registry in the DR region (Premium SKU; `az acr replication create --registry <registry> --location <DR region>`), or import the images into a registry the DR region can reach (container-registry playbook), and set a webhook or a check so that the replication of a pushed image can be confirmed (TC-2).
6. secondary-environment: the platform engineer role creates the DR user-assigned managed identity in the DR region (or plans for the new principal ID of a system-assigned identity), and the access administrator role assigns AcrPull on the registry and Key Vault Secrets User on the vault the DR app reads secrets from, before the first deployment.
7. secondary-environment: create the DR environment from the exported or templated configuration with the location, name, Log Analytics workspace, virtual network and zone redundancy set (zone redundancy and the network type cannot be changed afterwards, so decide them now), then deploy the apps and jobs into it with the same images (by digest where the pipeline pins them) and the same configuration, using the pipeline that deploys the primary with the region and the environment as parameters (`az containerapp env create`, `az deployment group create`).
8. secondary-environment: recreate what the exports do not carry: secrets as Key Vault references from the source of truth (a reference without a version follows the latest version within 30 minutes, with a version it stays), certificates, custom domains and their DNS validation records, IP allow lists and the downstream allow lists for the new outbound IP addresses, and (made by the access administrator role) the role assignments of the new identities on their downstream services; reconfigure ingress and the Dapr components so that they reference the DR region's resources.
9. secondary-environment: set a minimum replica count for the DR apps that the team chooses for the standby and set the production minimum count for failover (at least 2 where zone redundancy is used), and write both values in the runbook.
10. secondary-environment: build the routing: add the DR app as the second origin of the Front Door origin group with a lower priority than the primary (priority routing, a health probe path that returns 200 OK only when the app and its critical dependencies work), or as the second Traffic Manager endpoint with Priority routing and a probe path and probing settings the team sets, or prepare the DNS record with a lowered TTL (Learn's example is 60 seconds). For an environment with public network access disabled, create the Front Door Premium origin with Private Link (target sub-resource managedEnvironments) and approve every private endpoint connection request on the DR environment; an internal environment cannot be a monitored Traffic Manager endpoint (inference above), so route it with Front Door or with a DNS or load balancer path that the team probes.
11. secondary-environment: set up monitoring in the DR region: Container Apps metrics alerts on replica count drops and request failure rates, Service Health alerts for the DR region, the routing service's endpoint health (Front Door origin health, Traffic Manager endpoint status) and an alert when the last successful DR deployment is older than the deployment interval the team set.
12. secondary-environment: run the first deployment and the first image replication check, record the DR FQDN of each app and go to Validate.

### Validate
1. secondary-environment: run TC-1 once on the DR environment and daily afterwards, and fix every difference that is not region-specific.
2. secondary-environment: run TC-2 for every image that the DR apps use, after every release and weekly.
3. secondary-environment: run TC-4 (identities, secrets, certificates and custom domains) weekly, and after every change of a secret source, role or certificate.
4. secondary-environment: run TC-5 (the dependencies in the DR region) weekly and after every change of a dependency.
5. secondary-environment: run TC-7 daily to confirm that both origins or endpoints are healthy and that the DR path serves a request, and its alert test monthly.
6. secondary-environment: run TC-6 monthly (zone redundancy, scale and quota), then run TC-3 in a drill that disables the primary origin or endpoint without taking the primary down, and time the switch-over against the Estimated RTO.
7. secondary-environment: record each result with its date; a time that a drill measured is Demonstrated, everything else stays Estimated or Unknown.

### Cut over
1. secondary-environment: make the DR environment and the routing service the DR path of the runbook and of the application's DR configuration, and set the Front Door priority or the Traffic Manager priority so that the primary is first, the new DR environment second and the paired environment last.
2. secondary-environment: remove from the runbook every step that relied on the paired region's environment (its endpoint in the routing service, its DNS record, its registry replica).
3. secondary-environment: leave the paired environment's endpoint in the routing service as a last-priority backup during the rollback window (Learn suggests keeping the source running during a rollback window such as 24 to 48 hours); it is removed in Decommission, not now.

### Decommission
1. secondary-environment: only after TC-1 to TC-7 have passed, remove the paired environment's endpoint from the Front Door origin group or the Traffic Manager profile and monitor that requests reach the DR environment.
2. secondary-environment: after the rollback window, delete the apps of the paired environment, then the paired managed environment if it is no longer needed (Learn's clean-up order), and remove its unused container images, networking resources and identity assignments.
3. secondary-environment: remove the geo-replica or image copy in the paired region only if no other workload uses it, and update dashboards and alert rules that referenced the paired resources (Learn's clean-up list).

### Keep until cut-over
The paired environment, its apps, its endpoint in the routing service, its registry geo-replica and image copy, its DNS record, its role assignments and its alert rules, until TC-1, TC-2, TC-3, TC-4, TC-5, TC-6 and TC-7 have passed for the DR environment in the new DR region and the rollback window has passed. The primary environment is never part of the decommission.

## Failover and failback

The failover is customer-managed: Container Apps has no Microsoft-managed region failover and no customer-triggered failover feature (Learn describes only the custom multiregion solution), so every step below is the customer's and the customer can rehearse it end to end with TC-3. The zone failover of a zone-redundant environment is Microsoft-managed and is not a step of this table: Learn says that feature is fully managed, so you "don't need to initiate or validate availability zone failure processes".

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region or its environment is unavailable and declare DR for the workload | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time, and Azure Service Health or the application's probes show the primary failing | The primary environment answers its health path again before the declaration |
| 2 | secondary-environment: check the readiness of the DR environment: the last TC-1 and TC-2 results, the provisioning state of the DR environment and the running state of its apps | Platform engineer | Estimated unknown (measured in the first drill) | TC-1 of the last day shows zero unexplained differences, every image digest in use resolves in the DR region, and every DR app is running (for example `az containerapp show` returns the running status and the FQDN) | The DR apps are not deployed: deploy them from the pipeline (the cold variant, `az deployment group create`), recreate the secrets from the source of truth, and treat the Estimated RTO as unknown for this run |
| 3 | secondary-environment: bring the data services up in the DR region per their own playbooks, and confirm that the DR apps reach them | Data platform engineer | Estimated unknown (the RTO of each data service, taken from its playbook) | Each dependency of the TC-5 inventory answers from the DR network, and the managed identity of the DR app can read its secrets and reach each service | A data service is not available in the DR region: the application owner decides whether the application runs degraded or waits, and records the decision |
| 4 | secondary-environment: scale the DR apps to the production minimum replica count set in Build | Platform engineer | Estimated unknown (measured in TC-6; Learn, for a zone outage, says new replicas must start and return a healthy readiness probe before they receive requests) | The replica count of each DR app is at the production minimum, the replicas are Ready, and the quota covers the maximum | Quota or capacity in the DR region is exhausted: lower non-critical apps' counts, open a quota request and record which apps run reduced |
| 5 | secondary-environment: route traffic to the DR environment. When Front Door (priority routing) or Traffic Manager (Priority routing) health probes detect the primary as unhealthy the routing is automatic: verify it. When the primary still answers partially, disable the primary origin or endpoint. Without a routing service, change the DNS records to the DR FQDN | Network engineer | Estimated unknown (the probe interval, the tolerated failures and the DNS TTL that the team sets; Learn's Traffic Manager example timeline uses 30 s probing, 3 tolerated failures, 10 s timeout and 30 s TTL; TC-3 measures it) | The routing service shows the DR endpoint as the only healthy one (Front Door origin health, or Traffic Manager endpoint status Online and the primary Degraded or Disabled), and a request to the public name reaches the DR environment | Both endpoints show as degraded (Traffic Manager then returns all of them): check the probe path and settings before anything else; DNS caches keep answering with the old address until the TTL expires, so wait one TTL before judging |
| 6 | secondary-environment: run the application's synthetic transaction against the public name and against the DR FQDN, and check the custom domain certificate | Application engineer | Estimated unknown (measured in the first drill) | The transaction succeeds, the certificate on the custom domain is valid, and the latest revision of each DR app is running with the Key Vault reference causes of TC-4 ruled out | A transaction fails because a secret, certificate or downstream allow list is missing: restore it from the source of truth, then retry; the application owner decides on running degraded |
| 7 | secondary-environment: confirm that the downstream allow lists already hold the DR environment's outbound IP addresses (added in the Build step that recreates what the exports do not carry) and tell the owners of the integrated systems that the FQDN and the outbound IP addresses of the application changed | Platform engineer | Estimated unknown (depends on the number of integrations; measured in the first drill) | Calls from the DR apps to each downstream system succeed | A downstream system refuses the DR environment's addresses: its owner adds them, and the application owner decides on running without that integration until then |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region and its environment are available again | Incident manager | Estimated unknown (measured in the first drill) | The primary environment answers its health path and Azure Service Health shows no open incident for the region | The primary is still unavailable or unstable |
| 2 | secondary-environment: copy back the data written during DR with the data services' own failback steps | Data platform engineer | Estimated unknown (the failback time of each data service, taken from its playbook) | Each data service holds the data of the DR period (counts and checks of the data owner) | A data service cannot copy back safely: stay on the DR environment |
| 3 | secondary-environment: bring the primary environment and its apps to the current images and configuration with the pipeline, and run TC-1 against both environments | Platform engineer | Estimated unknown (measured in the first drill) | TC-1 shows zero unexplained differences between the primary and the DR environment, and the primary apps are running | The primary environment is missing or broken: rebuild it by the Build steps, and stay on the DR environment |
| 4 | secondary-environment: re-enable the primary origin or endpoint, or move the DNS records back, with the DR environment as the backup | Network engineer | Estimated unknown (the probe settings and the DNS TTL the team sets; Traffic Manager returns traffic as cached DNS answers expire) | The routing service shows the primary Online or healthy, and requests reach the primary | Requests to the primary fail: put the DR endpoint first again |
| 5 | secondary-environment: keep the DR environment running during the rollback window, then return its replica counts to the standby values set in Build | Platform engineer | Estimated 24h to 48h (the rollback window that Learn's relocation article suggests; the team sets its own) | TC-1, TC-2 and TC-7 pass again for the standby, and the replica counts equal the standby values | An error rate above the bound the application owner set appears on the primary: switch back to the DR environment |

## Test criteria

### TC-1: The DR environment and apps match the primary
- Applies to: secondary-environment
- Pass condition: every environment, app and job in the inventory of the primary exists in the DR environment and is running; the image digest, ingress configuration, scale rules (minimum and maximum replicas), environment variable names, secret names and volume mounts are equal to the primary's except for the documented region-specific values (the environment ID, FQDN, identity, outbound IP addresses, virtual network and subnet); the zone redundancy flag of the DR environment equals the primary's where the DR region has availability zones; and the DR region holds no app that the inventory lacks.
- How to measure: a scheduled job exports both environments and their apps (`az containerapp env show`, `az containerapp show` or the ARM export) and compares them by object with the documented exceptions; it never prints secret values and reads names only.
- Evidence: the comparison report with its date, the number of objects compared per type, the list of documented exceptions and zero unexplained differences.
- Frequency: daily

### TC-2: Every image in use is pullable in the DR region within the replication bound
- Applies to: secondary-environment
- Pass condition: every image digest that the primary apps run can be pulled from the registry endpoint that the DR apps use, from the DR region, and a newly pushed image digest is present in the DR region within the replication bound that the team sets and records with the test (Learn gives no figure: ACR replicates with eventual consistency).
- How to measure: for each digest of the TC-1 inventory list the manifests of its repository with `az acr manifest list-metadata --name <repository> --registry <registry>` from a client in the DR region (through the global endpoint, which usually but not always answers from the closest geo-replica; where the Preview regional endpoints are enabled, use the DR replica's regional endpoint to pin the check to it), and time the difference between a test push and its presence there with a registry webhook, which notifies when replication completes in each geo-replica; list the replicas with `az acr replication list --registry <registry> --output table` and check that the DR region's replica shows the status online.
- Evidence: the query output with its date, the digests compared, the replication status of the DR region and the maximum lag measured.
- Frequency: after every release and weekly

### TC-3: Traffic reaches the DR environment within the Estimated RTO
- Applies to: secondary-environment
- Pass condition: in a drill that disables the primary origin or endpoint (or blocks the probe path of the primary) without taking the primary down, the routing service sends requests to the DR environment, the synthetic transaction of the application succeeds against the public name from a client, and the time from the disablement to the first successful response from the DR environment is within the switch-over target that is the Estimated RTO of the option (30m as written, or the value the team set instead and recorded in the runbook).
- How to measure: the drill times the interval from the disablement to the first successful request, reads the routing service's endpoint health (Front Door origin health, Traffic Manager endpoint status) during the drill, and records the probe interval, the tolerated failures and the DNS TTL in use.
- Evidence: the drill record with its timestamps, the routing service's status history, the application's transaction log and the measured time.
- Frequency: every DR drill, and after every change of the routing settings or the application's health path

### TC-4: Identities, secrets, certificates and custom domains work in the DR environment
- Applies to: secondary-environment
- Pass condition: in the DR environment every app's identity holds AcrPull on the registry and Key Vault Secrets User (or the role the app needs) on the vault it reads; every secret that is a Key Vault reference has none of the five error causes of Learn's troubleshooting table (identity assigned, identity found, secret enabled in Key Vault, Key Vault Secrets User held on the vault, no RBAC denial) and the app's latest revision is running; every custom domain has a certificate that is valid and not expired; and the roles that can read secret values (Container Apps Contributor, Container Apps Operator, Container Apps Jobs Operator, and the wildcard roles) are assigned only to the identities named in the runbook.
- How to measure: list the role assignments on the registry, the vault and the DR resource group; read the apps' secret references and the revisions' state with `az containerapp show`, check each cause of Learn's troubleshooting table for each reference (identity on the app, secret enabled in the vault, role on the vault), read the custom domains and their certificate expiry dates on the DR apps; compare the role list with the runbook's list.
- Evidence: the role assignment list, the per-reference check result, the certificate expiry dates, and the comparison with the runbook, each with its date.
- Frequency: weekly, and after every change of a secret source, role or certificate

### TC-5: The dependencies of the apps exist in the DR region and answer from the DR network
- Applies to: secondary-environment
- Pass condition: every dependency of the inventory (Key Vault, storage, databases, messaging, private DNS zones, Log Analytics workspace, Dapr components) has a counterpart in the DR region, the name of each resolves to the expected address from the DR environment's network, and a connectivity probe from the DR app to each succeeds; this is a design check for the data's own recovery: the data's Estimated RPO is that of the data service and is measured in that service's playbook, not here.
- How to measure: a probe job in the DR network resolves and connects to each dependency, and a review compares the dependency list with the inventory and with the recovery targets of the data services' playbooks.
- Evidence: the probe log with its date, the dependency list with the DR counterpart of each, and the review record.
- Frequency: weekly, and after every change of a dependency

### TC-6: The DR environment has capacity and the intended zone redundancy
- Applies to: secondary-environment
- Pass condition: the DR environment's `zoneRedundant` property is true when the primary's is true and the DR region has availability zones; the DR apps scale to the primary's production minimum replica count in the drill and the replicas are Ready; and the DR region's quota covers the primary's maximum replica counts and cores with the margin the team sets.
- How to measure: read `zoneRedundant` from the environment's JSON; in a drill set each DR app to the production minimum and read the replica count and its state; compare the quota usage of the DR region with the primary's maximum.
- Evidence: the environment JSON excerpt, the drill's replica table with its date, and the quota comparison.
- Frequency: monthly, and before every DR drill

### TC-7: Both origins are monitored and the DR path serves a request
- Applies to: secondary-environment
- Pass condition: the routing service lists the primary and the DR environment (Front Door origins with their priorities, or Traffic Manager endpoints with Priority values) with the primary first; the DR origin or endpoint is healthy (a 200 OK health probe response) and not Degraded; the health path of the DR app returns 200 OK when called through its own FQDN; the DNS TTL in use is at or below the value the team recorded for the Estimated RTO; and the alert on a degraded endpoint fires in a test.
- How to measure: read the routing service's configuration and health with a read-only query or in the portal, call the DR app's health path, read the DNS TTL of the public name, and trigger the alert test.
- Evidence: the configuration and health output with its date, the health call result, the TTL and the alert test record.
- Frequency: daily for the health check, monthly for the alert test
