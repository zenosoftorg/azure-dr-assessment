---
service: api-management
title: Azure API Management
arm_types:
  - microsoft.apimanagement/service
slot: ingress
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management
  - https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-deploy-multi-region
  - https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-disaster-recovery-backup-restore
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/integration
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/networking
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged
  - https://learn.microsoft.com/en-us/azure/api-management/api-management-capacity
---

# Azure API Management

## Mechanisms

### Microsoft-managed multiregion deployment
- Replicates: the gateway component of one instance to regional gateways in other regions: the gateway configuration (APIs and policy definitions) is synchronized between the primary region and each added region. The management plane and the developer portal are not replicated (they stay in the primary region), and rate limit counters and the internal cache are region-specific and not replicated
- Paired: yes
- Nonpaired: yes
- Failover: Microsoft-managed
- Estimated RPO: 10s (Learn: configuration changes are replicated to each region "within approximately 10 seconds" and propagation "normally takes less than 10 seconds"; changes not yet replicated can be lost; rate limit counters and cache are not replicated, so their loss is not bounded by this figure)
- Estimated RTO: 0 (Learn: "No gateway downtime is expected" and traffic is routed around the failed region to the next closest gateway; this is the gateway only: Learn gives no recovery time for the management plane or the developer portal, which are unavailable while the primary region is offline, and active requests in the failed region might be dropped)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management#microsoft-managed-multiregion-deployment

### Service backup and restore
- Replicates: a point-in-time backup of the service configuration, written by the customer to a storage account, that includes runtime data such as users and subscriptions; it can be restored into another API Management instance of the same pricing tier. It is not a replication: nothing is copied until a backup and a restore are run
- Paired: yes
- Nonpaired: yes
- Failover: manual
- Estimated RPO: unknown (the interval at which the team runs backup and restore; Learn gives no figure, and a backup expires after 30 days, so TC-5 proves the interval the team sets)
- Estimated RTO: unknown (Learn: backup and restore are long-running operations that "may take several minutes"; Learn gives no recovery time for a whole DR switch-over, so TC-6 proves the switch-over the team designs)
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-disaster-recovery-backup-restore

### Availability zone support
- Replicates: within one region, the gateway units (and, in the primary region, the management plane and developer portal) across availability zones of a Premium (classic) instance with automatic or zone-redundant configuration
- Paired: no
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: 10s (Learn: gateway configuration is replicated between the zones "within approximately 10 seconds"; cache and rate limit counters might be lost or not up to date)
- Estimated RTO: 0 (Learn: no downtime is expected for automatic and zone-redundant instances during a zone outage; this protects against a zone failure and not a region failure)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management#resilience-to-availability-zone-failures

## Constraints

### Multiregion deployment needs the Premium (classic) tier
Learn states that "Multiregion deployments are only supported in the Premium (classic) tier of API Management". Premium v2 and Standard v2 support availability zones but "don't currently support multiregion deployments"; Basic v2, Standard, Basic, Developer and Consumption support no multiregion deployment. The "only" sentence is in the section on resilience to region-wide failures and the tier list is in the section on service tiers.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management

### Any region that supports API Management can be added
Learn says multiregion deployments can be created in the Premium (classic) tier "with any Azure region that supports API Management", and sends the reader to the product availability by region table. Learn names no pairing rule for the added region, which means (inference) that the DR region does not have to be the primary's pair. Whether the DR region offers the tier is read in that table.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management#microsoft-managed-multiregion-deployment

### Only the gateway is replicated; the management plane and developer portal stay in the primary region
Only the gateway component is replicated to the added regions. "The instance's management plane and developer portal remain hosted only in the primary region". If the primary region goes offline, the management plane and the developer portal become unavailable, and the secondary regions "continue to serve API requests by using the most recent gateway configuration". This means no configuration change can be made through the instance while the primary region is offline (inference from "unavailable"). The rate-limit and rate-limit-by-key policies count calls separately at each regional gateway in the deployment and do not aggregate all call data for the instance, and the azure-openai-token-limit and llm-token-limit policies count token usage separately at each regional gateway.
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-deploy-multi-region#about-multi-region-deployment

### Configuration is replicated in about 10 seconds; counters and cache are not replicated
Gateway configuration such as APIs and policy definitions is regularly synchronized between the primary and the added regions, and propagation normally takes less than 10 seconds. "Rate limit counters and data in the internal cache are region-specific, so they're not replicated between regions". The counters and the cache of the DR gateway are therefore not copied from the primary region's gateway.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management#behavior-when-all-regions-are-healthy

### Behavior during a region failure
Learn says API Management is responsible for detecting a failure in a region and automatically failing over to a gateway in one of the other regions. Active requests in the faulty region might be dropped and the client should retry them. If the primary region has an outage, configuration changes that are not yet replicated might be lost, and API requests are automatically routed around the failed region to the next closest gateway. When the primary region recovers, API Management automatically restores units in the region and reroutes traffic between your units (the section on region recovery).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management

### Default routing, custom routing and internal virtual network mode
With default routing, public HTTP requests (external virtual network mode and non-networked mode) go to the regional gateway with the lowest latency, and "it isn't possible to override this setting in API Management"; a customer-owned Traffic Manager with custom routing rules can be used instead, with the regional endpoints and the regional status endpoints configured in it. In internal virtual network mode, private traffic isn't routed or load-balanced to the regional gateways by default, and "users own the routing" and must bring their own solution for private load balancing across regions.
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-deploy-multi-region

### The backend is not made regional by the gateways
By default each API forwards to a single backend service URL, so even with gateways in several regions the requests go to the one region that hosts the backend. Learn advises deploying backend services in the same regions as the instance and routing with the set-backend policy, conditional choose policies and the context.Deployment.Region property, or fronting the backends with Azure Traffic Manager (Geographic routing is recommended for distribution and failover; Weighted is not recommended with API Management backends). The DR of the backend itself is a separate decision of the backend's own service.
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-deploy-multi-region#route-api-calls-to-regional-backend-services

### Capacity in the DR region is not reserved and only the primary region autoscales
"In a region-down scenario, there's no guarantee that requests for more capacity in another region succeed", so Learn advises over-provisioning the instance to account for losing a region. "In multiregion deployments, autoscaling applies only to the primary region. Secondary regions require manual scaling adjustments or custom tools that you control."
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management#microsoft-managed-multiregion-deployment

### Disabling routing to a regional gateway simulates some aspects of a region failure
Learn says that "Under some conditions, you might need to temporarily disable routing to one of the regional gateways" and lists a planned disaster recovery drill that simulates an unavailable region, and a regional failure, as uses (the sentence that disabling routing can "simulate some aspects of a region failure" is in the region failure test constraint below). Setting the disableGateway property of an added location to true (REST API, az apim update, Set-AzApiManagement or another Azure tool) disables routing to that regional gateway. It can be set only with default routing and not when the instance is in a virtual network in internal mode, and Learn's example sets it on an entry of additionalLocations, so Learn shows no way to disable the primary region's gateway. The update might take a few minutes, and routing is restored by setting the value to false.
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-deploy-multi-region#disable-routing-to-a-regional-gateway

### Networking of an added region
When the instance is injected in a virtual network, the virtual network and subnet region "should match" the secondary location; each regional network is configured independently, and the virtual networks "don't need to be peered". Every region added with a virtual network gets a public virtual IP address (management traffic on port 3443; in external mode also public HTTP traffic), and in internal mode a private IP address too. In internal mode each regional gateway needs outbound connectivity on port 1433 to the Azure SQL database of the instance, which is "only in the primary region", by its FQDN or IP address (the Azure SQL service endpoint can't be used).
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-deploy-multi-region#virtual-networking

### Adding a region takes 15 minutes or longer
Infrastructure changes such as region additions can take 15 minutes or longer, longer still for an instance with more scale units or a multiregion configuration. While the service is updating, other infrastructure changes can't be made, but APIs, products, policies and user settings can be configured, and the gateway keeps serving (except in the Developer tier).
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-deploy-multi-region

### Backup and restore is a feature of four tiers
Learn says backup is supported in the Developer, Basic, Standard and Premium (classic) tiers, and that backups expire after 30 days. Learn's tier table marks backup and restore as not supported in Premium v2, Standard v2, Basic v2 and Consumption. For backup or restoration of some service components, Learn names customer-managed options such as APIOps tooling and infrastructure as code (IaC), which also applies to the tiers that have no backup (inference: Learn names them next to backup, not as a replacement for it).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management

### A restore needs the same tier and a backup younger than 30 days
A restore after 30 days fails with "Cannot restore: backup expired". "The pricing tier of the service being restored into must match the pricing tier of the backed-up service being restored." Backup and restore aren't supported in instances with associated workspace gateways. Restore does not change the custom hostname configuration of the target.
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-disaster-recovery-backup-restore

### What a backup does not hold
A backup does not include usage data for analytics, custom domain TLS/SSL certificates, custom CA certificates, virtual network integration settings, managed identity configuration, Azure Monitor diagnostic configuration, protocols and ciphers settings, or developer portal content. It does include runtime data such as users and subscriptions, which Learn says "might not always be desirable". A standby restored from a backup therefore needs each excluded item configured on its own.
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-disaster-recovery-backup-restore#what-is-not-backed-up

### Backup and restore operating rules
Management changes should be avoided while a backup is in progress, and changes made during a backup "might be excluded from the backup and will be lost"; changes made during a restore "could be overwritten". During a backup the gateway keeps handling requests but the service state is Updating. The storage account must not have CORS enabled on its Blob service; when it has a firewall, Learn recommends the instance's system-assigned managed identity and that the account grants access to trusted Azure services. Access by managed identity needs the identity in both the source and the target instance with the Storage Blob Data Contributor role on the storage account, and REST API version 2021-04-01-preview or later.
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-disaster-recovery-backup-restore

### A standby is reached by a DNS change when the hostname is the same
Learn recommends the same custom hostname and TLS certificate for the active and the standby service, so that "after restore operation completes, the traffic can be re-directed to the standby instance by a simple DNS CNAME change". Learn also says to be ready to reconstitute the service in another region at any time and, depending on the recovery time objective, to keep a standby service in one or more regions, kept in sync according to the recovery point objective.
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-disaster-recovery-backup-restore

### Traffic Manager Priority routing sends traffic to the first available endpoint
Learn says a Traffic Manager profile with the Priority method holds a prioritized list of endpoints: by default all traffic goes to the primary (highest-priority) endpoint, and if it isn't available the traffic goes to the second one. Availability of an endpoint is based on its configured status (enabled or disabled) and the ongoing endpoint monitoring, and a lower priority value is a higher priority.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods#priority-traffic-routing-method

### The built-in role API Management Service Contributor manages the service
Learn lists API Management Service Contributor as "Can manage service and the APIs", with the action Microsoft.ApiManagement/service/* ("Create and manage API Management service"). Its actions also include Authorization read, Insights alert rules, Resource Health read, Resources deployments, resource group read and Support, and no Microsoft.Network action.
- Source: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/integration#api-management-service-contributor

### DNS Zone Contributor, Traffic Manager Contributor and Network Contributor
Learn lists DNS Zone Contributor ("Lets you manage DNS zones and record sets in Azure DNS, but does not let you control who has access to them"), Traffic Manager Contributor ("Lets you manage Traffic Manager profiles, but does not let you control who has access to them") and Network Contributor ("Lets you manage networks, but not access to them") among the networking built-in roles.
- Source: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/networking

### Contributor does not assign roles
Learn says the Contributor role "Grants full access to manage all resources, but does not allow you to assign roles in Azure RBAC", and lists Role Based Access Control Administrator ("Manage access to Azure resources by assigning roles using Azure RBAC") and Owner ("including the ability to assign roles in Azure RBAC") as roles that assign roles.
- Source: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged

### The capacity metric is read per location and has a general scaling rule
Learn says that, for an instance deployed to multiple locations, "you should always look at a capacity metric breakdown per location", and, in a note on autoscaling, that "In multi-region deployments, only scaling the primary location is allowed". As a general rule it advises to upgrade or scale an instance when a capacity metric value exceeds 60% - 70% for a long period (for example 30 minutes), and says that different values may work better for a service or scenario. When an instance reaches its capacity it "won't throttle": it acts like an overloaded web server with increased latency, dropped connections and time-out errors.
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-capacity

### A region failure test
Learn says that to be ready for unexpected region outages, the customer should regularly test its responses to region failures, and that it can "simulate some aspects of a region failure by disabling routing to a regional gateway".
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management#test-for-region-failures

## Non-paired options

### multi-region-gateway: Add the DR region as a regional gateway of the Premium instance
- Kind: native
- Target: dr-region
- Uses mechanism: Microsoft-managed multiregion deployment
- Estimated RPO: 10s (Learn: configuration propagation to the regional gateways normally takes less than 10 seconds, and changes are replicated to each region within approximately 10 seconds, so the figure covers the gateway configuration only; configuration changes not yet replicated when the primary region fails might be lost, and rate limit counters and cache are not replicated; TC-3 measures it; https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-deploy-multi-region and https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management#microsoft-managed-multiregion-deployment)
- Estimated RTO: 0 (Learn: "No gateway downtime is expected" and requests are routed around the failed region (https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management#microsoft-managed-multiregion-deployment); gateway only: the management plane and developer portal are not available in the DR region, and the figure holds only if the DR region's capacity and backend can carry the load, which TC-4 and TC-7 check)
- Prerequisites: the Premium (classic) tier; a DR region that supports API Management and the tier (product availability by region table); units in the DR region sized for losing the primary region (over-provisioned, because Learn gives no assurance that requested capacity in another region is available and secondary regions are scaled by hand), with automatic availability zone configuration when the DR region has zones; when the instance is in a virtual network: a virtual network and subnet in the DR region, in the same subscription, with the network security group rules that Learn says are "generally the same" as the requirements for the primary region's network and a public IP address, and for internal mode outbound access on port 1433 to the instance's Azure SQL database in the primary region and the team's own routing and load balancing across regions; for DR routing either default routing (external or non-networked mode) or a customer-owned Traffic Manager with the regional endpoints and regional status endpoints; each backend of the instance deployed or reachable in the DR region and a set-backend policy or Traffic Manager in front of it; an identity with the API Management Service Contributor role on the instance and, when the instance is in a virtual network, a network role such as Network Contributor on the DR network's resource group (the Service Contributor role has no Microsoft.Network action; the Build step that adds the DR region proves the pair is enough); DNS for the instance's custom domain that points to the instance's routing (the Traffic Manager when custom routing is used).
- Cost notes: Learn says "Adding regions incurs costs"; the DR region's units, the DR network and the backend capacity in the DR region are further costs that the team prices itself (inference); no price.
- Gives up: the management plane and the developer portal stay in the primary region (no configuration changes or portal while it is down); rate limit counters and cache are not replicated, so limits count per region; the secondary region does not autoscale; Learn gives no assurance of capacity in the DR region; and the option is limited to the Premium (classic) tier.
- Recommended when: the instance is, or can be moved to, the Premium (classic) tier; gateway availability in the DR region matters more than management-plane availability during the outage; and the backends are available in the DR region.
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-deploy-multi-region

### secondary-instance: A second instance in the DR region, kept in sync by backup and restore (or, as an inference, by infrastructure as code)
- Kind: workaround
- Target: dr-region
- Uses mechanism: Service backup and restore
- Estimated RPO: 1d (Estimated, team-set starting value; TC-5 proves it; the sync interval the team sets for the standby; for the backup variant it is the backup and restore interval, shorter than the 30 days after which a backup expires, and the 30-day limit applies to the backup variant only; for the IaC variant, which uses no backup (inference), it is the interval of the deployment from the repository; Learn publishes no figure for this design)
- Estimated RTO: 15m (Estimated, team-set starting value; TC-6 proves it; the switch-over time the team designs: the time to live of the DNS record the team sets, plus the probe interval of a Traffic Manager when one is used; Learn publishes no figure; the standby already exists, because Learn says infrastructure changes can take 15 minutes or longer and the design cannot wait for a build)
- Prerequisites: two variants by tier. Backup variant: an API Management instance in the DR region in the same pricing tier as the primary (a restore requires the tier to match), the tier being one that supports backup (Developer, Basic, Standard or Premium (classic)); an Azure storage account for the backup blobs reachable from the DR region, with no CORS on its Blob service, and a managed identity enabled in both instances holding Storage Blob Data Contributor on that storage account (the system-assigned identity is recommended when the account has a firewall, which must grant access to trusted Azure services). IaC variant (inference: Learn names APIOps tooling and infrastructure as code only as customer-managed options next to backup, in the reliability article's backup and restore section, https://learn.microsoft.com/en-us/azure/reliability/reliability-api-management#backup-and-restore; the IaC variant uses no mechanism of the Mechanisms section): for Premium v2, Standard v2, Basic v2 and Consumption, which Learn lists without backup, a standby built and kept current from the same infrastructure as code or APIOps repository as the primary, which carries no runtime data (users and subscriptions are created again or kept by their own source). For both variants: an identity with the API Management Service Contributor role on both instances (the primary's and the DR instance's resource groups) and a role that can manage the DNS record or the Traffic Manager profile (DNS Zone Contributor or Traffic Manager Contributor on that resource), and, when an instance is in a virtual network, a network role such as Network Contributor on the DR network's resource group; the same custom hostname and TLS certificate on both instances, and the custom CA certificates, protocols and ciphers settings, managed identity, diagnostic settings and virtual network settings of the DR instance configured by hand or from the repository (a backup does not carry them); the developer portal content published again in the DR instance; backends reachable from the DR region; and, for the backup variant, a decision on the runtime data (users and subscriptions) that the backup copies.
- Cost notes: Learn gives no cost statement for a standby; the DR instance, the backup storage and runs (backup variant), the DR network and the backend capacity in the DR region are costs that the team prices itself (inference); no price.
- Gives up: the Microsoft-managed gateway failover and its automatic sync; configuration changes made after the last backup (the interval the team sets); a switch-over by DNS instead of Microsoft's rerouting; one logical instance: the DR instance is a separate service with its own gateway hostname, rate limit counters, cache and developer portal content to publish; usage data for analytics, the certificates, the network, identity and diagnostic settings (not backed up); and backup is not available for instances with workspace gateways.
- Recommended when: the tier is not Premium (classic), or the DR region must not depend on the primary region's management plane (the DR instance has its own), or the instance is not allowed to be a multiregion instance, and a DNS-level switch-over is acceptable.
- Source: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-disaster-recovery-backup-restore

## Migration from a paired setup

### Recognise today's setup
Three shapes show in an inventory. (1) A Premium (classic) instance whose locations include the primary's pair region as an added location (the portal's Locations list, or the additionalLocations property that az apim show reads): the paired DR is a regional gateway in the pair, replicated by Microsoft. (2) Two API Management instances, the second in the pair region: the second is recorded as the paired DR standby only with evidence of the relationship, which is a backup and restore pipeline or schedule that targets it (with a storage account that holds the backup blobs), a DNS or Traffic Manager record that targets the second instance, or the owner's confirmation; region or name alone never proves it, and without such evidence record Unknown. With the evidence, the paired DR is a standby restored by backup and restore. (3) One instance in one region, in any tier: no cross-region DR shows, and v2 and Consumption tiers cannot have a multiregion deployment or a backup. The inventory cannot show whether a backup schedule runs, how often, whether the standby's hostname and certificate match, whether backends exist in the pair region, or how the DNS record or Traffic Manager routes. Mark such facts Unknown until read from the team. Migration to a DR region that is not the pair is decided per instance, by option id: multi-region-gateway adds the DR region as a gateway location; secondary-instance builds or moves a standby in the DR region. Never both on one instance.

### Build
1. multi-region-gateway: confirm the instance is Premium (classic) and that the DR region appears in the product availability table for API Management; if the tier is lower, plan the tier upgrade first or use secondary-instance. Read the current locations and the units per location with az apim show.
2. multi-region-gateway: create the resource group of the DR network first (the Build step that creates the DR virtual network and subnet creates the network in it), then grant the platform engineer the API Management Service Contributor role on the instance (scope: the instance, which lives in the primary region's resource group) and, when the instance is in a virtual network, Network Contributor on the resource group of the DR network (the Service Contributor role has no Microsoft.Network action); the assignments are made by an identity that holds Role Based Access Control Administrator or Owner, because Contributor "does not allow you to assign roles in Azure RBAC". The same roles are needed for the disableGateway rehearsal and the failback steps. If the Build step that adds the DR region fails for lack of a permission, add the role the error names and record it here.
3. multi-region-gateway: when the instance is in a virtual network, create the virtual network and subnet in the DR region in the instance's subscription, with network security group rules for the DR network (Learn: the connectivity requirements are "generally the same" as for the primary region's network, so compare each rule with the primary's and record every difference) and a public IP address; for internal mode allow outbound port 1433 to the FQDN or IP address of the instance's Azure SQL database (Network > Network status of the instance shows its name) in the routes and firewall rules of the DR network.
4. multi-region-gateway: add the DR region: Locations > Add > the DR region > the number of units sized for losing the primary region (over-provisioned) > Automatic availability zones when the region has them > the DR virtual network settings when networked > Add > Save; allow 15 minutes or longer. Record the regional URL of the DR gateway (Learn's host pattern is `<service-name>-<region>-01.regional.azure-api.net`).
5. multi-region-gateway: make the backends regional: deploy or make reachable a backend in the DR region and add a set-backend policy with choose conditions on context.Deployment.Region, or front the backends with Traffic Manager using Geographic routing; keep Weighted routing away from API Management backends.
6. multi-region-gateway: decide routing: default routing (external or non-networked mode) needs nothing more; for custom routing or internal mode create the customer-owned Traffic Manager (or other private load balancer), point the custom domain at it, add the regional endpoints and the regional status endpoints (the /status-0123456789abcdef path) and choose the routing method; grant the network engineer the roles that the failover and failback steps use, at these scopes and assigned by an identity that holds Role Based Access Control Administrator or Owner: Traffic Manager Contributor on the Traffic Manager profile, DNS Zone Contributor on the DNS zone that holds the entry hostname, and for a private load balancer Network Contributor on the resource group that holds it (or the role that the owner of another routing solution defines; Learn names none).
7. multi-region-gateway: size and set the DR region's units by hand (secondary regions do not autoscale) from a load test at the peak that the application owner sets, and write the unit count and the last review date in the runbook.
8. secondary-instance: record the primary's tier, units, custom hostname, certificates, virtual network mode, managed identities, diagnostic settings and the number of APIs, products, named values and subscriptions; this inventory is what TC-5 and TC-8 compare.
9. secondary-instance: choose the variant per instance by tier. Backup variant (Developer, Basic, Standard, Premium (classic): the tiers where Learn lists backup): create the API Management instance in the DR region in the same tier as the primary (a restore needs the tiers to match). IaC variant (Premium v2, Standard v2, Basic v2, Consumption: no backup in Learn's table; inference that IaC or APIOps tooling is the way to keep a standby): create the instance in the DR region in the tier you choose and deploy it from the same infrastructure as code or APIOps repository as the primary, with no runtime data copy. For both: automatic availability zones when the tier and region support them, and a virtual network in the DR region when the primary is networked (create its resource group first: the Build step that grants roles on both instances grants Network Contributor on it, and a role cannot be assigned on a scope that does not exist).
10. secondary-instance: configure what a backup does not carry, by hand or from the repository (both variants): the same custom hostname and the same TLS certificate (installed in each instance by its own process), custom CA certificates, protocols and ciphers settings, managed identity, Azure Monitor diagnostic settings, virtual network settings, and the developer portal content.
11. secondary-instance: grant roles, assigned by an identity that holds Role Based Access Control Administrator or Owner: the platform engineer and the pipeline identity get API Management Service Contributor on both instances (their two resource groups) and, for a networked instance, Network Contributor on the DR network's resource group; the DNS operator gets DNS Zone Contributor on the DNS zone or Traffic Manager Contributor on the profile that the failover uses. Backup variant only: create the storage account for the backup blobs (reachable from the DR region, no CORS on the Blob service, a firewall that grants trusted Azure services when it has one), enable a system-assigned managed identity on both instances and assign each identity Storage Blob Data Contributor on that storage account only.
12. secondary-instance: build the sync pipeline on the interval the team sets (the 1d of the Estimated RPO). Backup variant: run Backup-AzApiManagement on the primary with the managed identity access type, then Restore-AzApiManagement into the DR instance from the same blob (the same two operations exist as REST calls; Learn's az apim backup and az apim restore sample uses the storage access key, so prefer the cmdlets or the REST call with a managed identity), keep the interval shorter than 30 days, wait for the backup to finish before the restore and make no configuration change on either instance while either operation runs. IaC variant: deploy the repository to the DR instance on the same interval. Both: alert when a run fails or the last success is older than the interval.
13. secondary-instance: run the first sync, publish the developer portal content again in the DR instance, check that the custom hostname of the DR instance is unchanged (backup variant: restore does not change it), and put the DNS record or Traffic Manager in front of both instances with the primary as the active endpoint (a Traffic Manager Priority profile sends all traffic to the primary endpoint until it is unavailable), with the DNS time to live and the probe interval the team sets so that the switch-over fits the Estimated RTO of the option (15m, a team-set starting value), and record both in the runbook.
14. secondary-instance: make the backends reachable from the DR instance, with a regional backend or a routing policy that reaches the DR backend, and write the runbook with the DNS or Traffic Manager steps of Failover.

### Validate
1. multi-region-gateway: run TC-8 on the instance, then TC-1 once and TC-3 as often as its Frequency says.
2. multi-region-gateway: run TC-4 and TC-9 against the DR regional gateway, then run TC-2 (the disableGateway rehearsal, only with default routing and not in internal mode; with custom routing or internal mode rehearse the customer's own routing instead).
3. multi-region-gateway: run TC-7, the load test of the DR region, and write its result in the runbook.
4. secondary-instance: run TC-8 on the primary and the DR instance, then TC-5 once and again at its Frequency, and TC-4 and TC-9 against the DR instance.
5. secondary-instance: run TC-6, the switch-over drill, and time it from the DNS change to the first successful call through the DR instance.
6. Record each result with its date; a time that a drill measured is Demonstrated. Learn shows no way to disable the primary region's gateway (its example sets disableGateway on additionalLocations), so the drill of TC-2 simulates some aspects of a region failure but not the loss of the primary region; the time of Microsoft's rerouting for a primary region loss therefore stays Estimated.

### Cut over
1. multi-region-gateway: put the DR gateway region, the regional URL, the routing mode and the Failover steps for multi-region-gateway in the runbook; change nothing else when default routing is used.
2. multi-region-gateway: when custom routing is used, switch the Traffic Manager to the final endpoint set (primary and DR region endpoints, with their status endpoints) and remove the endpoint of the old pair region.
3. secondary-instance: change the runbook so that the DR instance in the DR region is the standby, and point the DNS record or Traffic Manager failover target at it.
4. secondary-instance: remove the runbook steps that restore into or switch to the standby in the pair region.

### Decommission
1. multi-region-gateway: after the validation passed, remove the pair region: Locations > the pair location > ... > Delete > Save (allow 15 minutes or longer), only when no consumer uses the regional URL of the pair region and no Traffic Manager endpoint points to it.
2. secondary-instance: after the validation passed, stop the sync pipeline toward the pair region's standby, then delete the standby instance in the pair region and, in the backup variant, its backup blobs; keep the DR instance.
3. Remove the role assignments, DNS records and Traffic Manager endpoints that only served the pair region.

### Keep until cut-over
The pair region's gateway location (multi-region-gateway) or the standby instance in the pair region with its backup pipeline and DNS path (secondary-instance), the backends in the pair region, and the runbook steps for the paired DR, until TC-1, TC-2, TC-4 and TC-7 (multi-region-gateway) or TC-5, TC-6 and TC-8 (secondary-instance) have passed.

## Failover and failback

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region is down for the API Management instance and declare DR for the workload | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time and the evidence (health of the instance and of the backends) | The primary instance answers again before the declaration |
| 2 | multi-region-gateway: with default routing the failover is Microsoft-managed: API Management detects the failure and routes around the failed region (Learn describes no customer-initiated failover for it, which means, as an inference, that the customer waits for it; disableGateway simulates only some aspects of a region failure); watch the DR regional URL and the client error rate | Platform engineer | Estimated 0 (Learn: no gateway downtime is expected; the first clients may see dropped active requests and retry) | A call to the DR regional gateway URL returns the expected response and clients that retry succeed | The DR gateway returns errors that are not caused by the backend: go to the failover step that removes or deprioritises the failed region's endpoint, then escalate to Azure support |
| 3 | multi-region-gateway: with custom routing or internal virtual network mode, remove or deprioritise the failed region's endpoint in the customer-owned Traffic Manager or private load balancer (Microsoft does not route in these modes) | Network engineer | Estimated unknown (the endpoint monitoring and DNS time to live the team sets; measured in the first drill) | Requests to the entry hostname resolve and reach the DR regional gateway | Requests still reach the failed region after the DNS time to live has elapsed: check the endpoint status and the status endpoint path before any change |
| 4 | multi-region-gateway: do not plan configuration changes: the management plane and developer portal are unavailable while the primary region is offline, so announce a change freeze and note that unreplicated changes of the last 10 seconds might be lost | Platform engineer | Estimated unknown (a decision and an announcement of the change freeze; measured in the first drill) | The freeze is recorded in the runbook and the last change made before the outage is listed for the owners | A change is required in DR: wait for the primary region, or use secondary-instance if it was built |
| 5 | multi-region-gateway: check the capacity of the DR gateway (the units set in Build) and the DR backend | Application engineer | Estimated unknown (measured in the first drill) | The capacity metric of the DR region (the Capacity metric split by location) and the backend error rate stay at or below the bounds of TC-7 | Capacity is above the bound: Learn says secondary regions need "manual scaling adjustments or custom tools that you control" and that the management plane is unavailable while the primary region is offline, so scaling may not be possible (inference); shed or throttle load with policies that already exist, scale if the management plane answers, and record the gap |
| 6 | secondary-instance: check the last successful sync into the DR instance and, in the backup variant, the age of the newest backup blob | Platform engineer | Estimated unknown (a read of the pipeline log and the blob list; measured in the first drill) | The last sync is within the Estimated RPO of the option and, in the backup variant, the blob is younger than 30 days | In the backup variant the newest backup is older than 30 days: it cannot be restored (the restore fails with Cannot restore: backup expired), so the DR instance runs on its last restored configuration |
| 7 | secondary-instance: when the newest source is newer than the last sync, apply it to the DR instance and make no change on the instance while it runs: restore the newest backup blob (backup variant) or deploy the latest committed repository state (IaC variant) | Platform engineer | Estimated unknown (Learn: restore "may take several minutes"; measured in the first drill) | The restore returns 200 OK on the Location URL it gave (backup variant), or the deployment succeeds (IaC variant) | The restore or deployment fails: stop, keep the last synced configuration and record the gap |
| 8 | secondary-instance: check the items that a backup does not carry: custom hostname, TLS certificate validity, network settings, managed identity and diagnostics on the DR instance | Platform engineer | Estimated unknown (a configuration check; measured in the first drill) | The custom hostname answers with a valid certificate and TC-8's items are as planned | The certificate is expired or missing: install it in the DR instance, then continue |
| 9 | secondary-instance: switch the entry hostname to the DR instance: change the DNS CNAME, or lower the priority number of the DR endpoint in the Traffic Manager (or disable the primary endpoint) | DNS operator | Estimated 15m (the option's team-set starting value, covering the DNS time to live and the probe interval recorded in the Build step that puts the DNS record or Traffic Manager in front of both instances; TC-6 proves it) | The entry hostname resolves to the DR instance and a call returns the expected response through it | The name still resolves to the primary after the time to live: check the record, the profile and the endpoint status |
| 10 | Check that the backends of the DR region respond through the DR gateway and that rate limit counters and cache are not copied from the primary (Learn: region-specific, not replicated) | Application engineer | Estimated unknown (a smoke test; measured in the first drill) | Test calls to each API of the smoke list return the expected status, and calls reach the DR backend | A backend does not respond: the owner of the backend service starts its own DR; stop routing that API if it must not reach the primary |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region and the primary instance are available again | Incident manager | Estimated unknown (measured in the first drill) | The primary instance and its management plane answer, and its gateway answers a test call | The instance is still unavailable or its calls fail |
| 2 | multi-region-gateway: confirm that API Management has restored the units of the primary region and rerouted traffic, and set disableGateway back to false on a location that a drill or an earlier step disabled | Platform engineer | Estimated unknown (Learn: infrastructure changes can take 15 minutes or longer and gives no restoration time for the primary region's units; measured in the first drill) | az apim show lists every location with Disabled false and each regional URL answers | A location stays unavailable: keep traffic on the DR region and escalate to Azure support |
| 3 | multi-region-gateway: with custom routing or internal mode, add the primary region's endpoint back to the Traffic Manager or load balancer | Network engineer | Estimated unknown (the endpoint monitoring and DNS time to live the team sets) | Requests reach both regional gateways and the status endpoints are healthy | The primary gateway fails the status endpoint check: leave it out |
| 4 | multi-region-gateway: re-apply the configuration changes that were frozen or might have been lost (the last 10 seconds before the outage) and compare the APIs and policies of both regions | Platform engineer | Estimated unknown (depends on the number of changes) | A test call that exercises each re-applied change returns the same result from both regional gateways | A difference remains: stop failback of that API and fix it in the management plane |
| 5 | secondary-instance: choose the source of truth: if configuration or subscriptions changed in the DR instance, carry them to the primary (backup variant: back up the DR instance and restore it into the primary, the tier matches; IaC variant: commit the changes to the repository and deploy it to the primary), otherwise keep the primary | Platform engineer | Estimated unknown (Learn: backup and restore "may take several minutes"; measured in the first drill) | The primary holds the same APIs, products and named values as the DR instance (and, in the backup variant, the same subscriptions) by the TC-5 comparison | The restore or deployment fails or the primary instance was lost: rebuild it from infrastructure as code or the last backup and keep the traffic on the DR instance |
| 6 | secondary-instance: check the custom hostname and the certificate of the primary (a restore does not change the hostname), then switch the DNS CNAME or the Traffic Manager priority back | DNS operator | Estimated unknown (the DNS time to live the team sets; measured in the first drill) | The entry hostname resolves to the primary and a test call succeeds | The primary fails the call: switch back to the DR instance |
| 7 | secondary-instance: restart the scheduled sync (backup and restore, or the repository deployment) from the primary into the DR instance and run TC-5 once | Platform engineer | Estimated unknown (measured in the first drill) | The first sync succeeds and TC-5 shows zero differences | The sync fails: keep the alert open and run it by hand until fixed |
| 8 | Run the smoke test of the APIs through the entry hostname and close DR | Application engineer | Estimated unknown (a smoke test; measured in the first drill) | Each API of the smoke list returns the expected status from the primary | A call fails: stay on the DR region and record the gap |

## Test criteria

### TC-1: The DR gateway serves every API on its own
- Applies to: multi-region-gateway
- Pass condition: a call to each API of the smoke list through the regional URL of the DR gateway (Learn's host pattern is `<service-name>-<region>-01.regional.azure-api.net`) returns the expected status and body. Design check, not drillable: Learn shows no way to disable the primary region's gateway, so this probe proves that the DR gateway serves with the replicated configuration and not what a real primary region loss does, which is only observed in one.
- How to measure: a scheduled probe that calls the DR regional URL with the test subscription key and compares the responses with the expected ones.
- Evidence: the probe log with each call's status and time.
- Frequency: daily

### TC-2: Routing is redirected when a regional gateway is disabled
- Applies to: multi-region-gateway
- Pass condition: after disableGateway is set to true on the DR location (default routing, not internal mode), calls to the DR regional URL are redirected to another region and keep returning the expected response, and after the value is set back to false the DR gateway serves again.
- How to measure: the drill of Learn's disable routing procedure: az apim show with the locations query, az apim update with the disableGateway value, a call to the DR regional URL, and the restore of the value; for custom routing or internal mode, the same drill is done by disabling the endpoint in the customer-owned routing.
- Evidence: the az apim show output before and after, the redirected call log and the time of the redirect.
- Frequency: every DR drill

### TC-3: Configuration reaches the DR gateway within the Estimated RPO
- Applies to: multi-region-gateway
- Pass condition: for 5 test changes on different days (a policy edit and an API change), the change is visible on the DR regional gateway within 10 seconds of the save on the primary; a longer time is recorded and the Estimated RPO of the option is raised to it.
- How to measure: change a marker value in a test policy, then call the DR regional URL in a loop and record the time until the new value is returned.
- Evidence: the loop log with the save time, the first response with the new value and the difference.
- Frequency: monthly

### TC-4: The DR gateway reaches a DR-region backend
- Applies to: multi-region-gateway, secondary-instance
- Pass condition: a call through the DR gateway or the DR instance is answered by the backend that the routing policy or Traffic Manager selects for the DR region, which the response shows (a region header or body marker the backend sets), and no API forwards to a backend in the primary region when the primary region is blocked from the DR region by a network rule or by disabling the endpoint.
- How to measure: add a region marker to the backend's response and call each API through the DR regional URL or the DR instance, with the primary backend unreachable.
- Evidence: the call log showing the marker per API.
- Frequency: every DR drill

### TC-5: The standby holds the primary's configuration and is not older than the Estimated RPO
- Applies to: secondary-instance
- Pass condition: the number of APIs, products, named values, groups and policies of the DR instance equals the primary's after the last sync (zero differences), the time from a configuration change on the primary to its presence in the DR instance stays below the Estimated RPO of the option, and for the backup variant the subscriptions also match and the newest backup blob is younger than 30 days.
- How to measure: a scheduled job lists these object types on both instances through the management API and compares their counts and names, reads the completion time of the last sync run (backup and restore, or the repository deployment), and for the backup variant reads the age of the newest blob in the storage account.
- Evidence: the job report with its date, the counts per object type, the last run times and, for the backup variant, the blob age.
- Frequency: daily

### TC-6: The switch-over to the DR instance completes within the Estimated RTO
- Applies to: secondary-instance
- Pass condition: in a drill, the time from the DNS change (or the Traffic Manager endpoint change) to the first successful call through the entry hostname to the DR instance is at most the Estimated RTO of the option, with a valid TLS certificate for the custom hostname.
- How to measure: run the DR switch-over of the runbook in a test window, time it, and call the entry hostname in a loop from outside the primary region.
- Evidence: the drill record with its timestamps, the resolved addresses and the measured time (a Demonstrated figure).
- Frequency: every DR drill

### TC-7: The DR region carries the load of the lost primary region
- Applies to: multi-region-gateway
- Pass condition: a load test through the DR regional gateway at the peak request rate that the application owner sets keeps the error rate below the bound the owner sets and the Capacity metric of the DR location (the metric split by location) at or below the bound the team sets. Basis of the bound: Learn's general rule is to scale when the metric exceeds 60% - 70% for a long period (for example 30 minutes) and says other values may work better, so the team records its bound and the reason when it is above 70%. Design check, not drillable: Learn gives no assurance of capacity in another region, so the result holds only for the units provisioned at the time.
- How to measure: a load test at the owner's peak through the DR regional URL, reading the Capacity metric split by location and the gateway error rate.
- Evidence: the load test report with the rate, the units, the Capacity metric of the DR location, the bound with its basis and the error rate.
- Frequency: quarterly

### TC-8: Every instance is configured as planned
- Applies to: multi-region-gateway, secondary-instance
- Pass condition: for multi-region-gateway the instance is Premium (classic), lists the DR region as a location with the planned units and zones, none of its locations has disableGateway true outside a drill, the roles of the multi-region-gateway Build step that grants the platform engineer roles on the instance are in place, and the DR network and routing exist as planned. For secondary-instance both instances are in the same tier, the DR instance has the same custom hostname and a valid certificate, in the backup variant its managed identity holds Storage Blob Data Contributor on the backup storage account only, the roles of the secondary-instance Build step that grants roles on both instances are in place, and the DNS record or Traffic Manager profile has the planned primary and DR endpoints.
- How to measure: read the properties of each instance and its locations (az apim show), the role assignments of the storage account and instances, the certificate expiry date, and the DNS or Traffic Manager configuration, with read-only queries.
- Evidence: the query output with its date, the role assignment list and the certificate expiry date.
- Frequency: monthly

### TC-9: Rate limits and cache behave as a separate region
- Applies to: multi-region-gateway, secondary-instance
- Pass condition: with the rate limit exhausted on the primary region's gateway (multi-region-gateway: its regional URL) or on the primary instance (secondary-instance), calls through the DR regional gateway or DR instance are still accepted up to the configured limit, because the counters are not copied from the primary (Learn: counters and cache are region-specific and not replicated; for secondary-instance Learn says only that a backup copies runtime data such as users and subscriptions, so this measures it), a cached response of the primary is not served by the DR gateway or instance, and the application owner has recorded that limits apply per region or instance and not across them. Design check, not drillable for a real failure: what happens in a real failover is only observed in one.
- How to measure: call a rate-limited API through the primary regional URL or instance until the limit response, then through the DR regional URL or instance and count the calls until its limit response; compare the first call of a cached API through the DR gateway with a cache-miss response time.
- Evidence: the call log with the count at the limit on each side and the owner's record.
- Frequency: after every change to rate limit or cache policies
