---
service: private-endpoints-dns
title: Private endpoints and private DNS zones
arm_types:
  - microsoft.network/privateendpoints
  - microsoft.network/privatednszones
slot: connectivity
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-dns-private
  - https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns
  - https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview
  - https://learn.microsoft.com/en-us/azure/dns/private-dns-overview
  - https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns-integration
  - https://learn.microsoft.com/en-us/azure/private-link/secure-private-link
  - https://learn.microsoft.com/en-us/azure/storage/common/storage-failover-private-endpoints
  - https://learn.microsoft.com/en-us/azure/cosmos-db/failover-considerations-for-private-endpoints
  - https://learn.microsoft.com/en-us/azure/dns/private-dns-virtual-network-links
  - https://learn.microsoft.com/en-us/azure/private-link/rbac-permissions
  - https://learn.microsoft.com/en-us/azure/dns/dns-protect-private-zones-recordsets
  - https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/networking
  - https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources
---

# Private endpoints and private DNS zones

## Mechanisms

### Global private DNS zone data
- Replicates: data (the records of a private DNS zone), which Learn describes as globally available: the zone is a global resource, not bound to one virtual network or region, and Microsoft replicates changes to a zone across its infrastructure. The links from the zone to virtual networks are separate child resources that the customer creates.
- Paired: yes
- Nonpaired: yes
- Failover: not applicable
- Estimated RPO: unknown (Learn describes the replication of zone changes and publishes no figure)
- Estimated RTO: 0 (Learn: if a region has an outage, name resolution continues to work because zone data is globally available; this covers the resolution of the zone only, not the reachability of the resources that its records point to)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-dns-private

### Private endpoint in one virtual network
- Replicates: nothing. A private endpoint is a network interface with a private IP address in a subnet of one virtual network; Learn describes no replication of an endpoint to another region on the pages read.
- Paired: no
- Nonpaired: no
- Failover: not applicable
- Estimated RPO: unknown (an endpoint holds no data; Learn describes no replication of it)
- Estimated RTO: unknown (Learn describes no failover of a private endpoint; so (inference) the endpoint is as available as its own region, and the private-link resource behind it has its own availability)
- Source: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview#private-endpoint-properties

### Additional private endpoints for the same private-link resource in another region
- Replicates: nothing; it is a second endpoint that the customer creates for the same private-link resource (or for the resource's DR instance) in a virtual network of the DR region, with its own private DNS zone and zone records. Learn shows it for a geo-redundant storage account and for an Azure Cosmos DB account.
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: unknown (configuration, not data: Learn publishes no figure; the team sets how long the DR copy of the configuration may lag, see the configuration drift limit of the option)
- Estimated RTO: unknown (Learn's examples need no DNS change when the target service fails over by itself, and need a change of on-premises conditional forwarders when the DNS servers of the primary region are affected; no figure is published)
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-failover-private-endpoints#architecture-concepts

### Redeploy from infrastructure as code
- Replicates: configuration (endpoints, their DNS zone records and network security rules), redeployed by the customer from infrastructure-as-code templates in source control, which Learn recommends maintaining so that the private connectivity can be redeployed in a secondary region.
- Paired: yes
- Nonpaired: yes
- Failover: manual
- Estimated RPO: unknown (the age of the last template version; Learn publishes no figure)
- Estimated RTO: unknown (the time to redeploy depends on the number of resources and is not published by Learn)
- Source: https://learn.microsoft.com/en-us/azure/private-link/secure-private-link#backup-and-recovery

## Constraints

### A private DNS zone is a global resource
When you create a private DNS zone, Azure stores the zone data as a global resource, so the zone does not depend on a single virtual network or region, and the same zone can be linked to virtual networks in different regions. Learn notes that during a regional failure private DNS zones support create, read, update and delete operations by API call through the SDKs. So (inference) the zone data needs no failover, and since Learn describes no failover of a private endpoint either, every failover step of this playbook is customer-managed: neither type has a Microsoft-managed failover that the customer triggers or rehearses.
- Source: https://learn.microsoft.com/en-us/azure/dns/private-dns-overview#private-zone-resiliency

### Name resolution survives a region outage, and records keep returning the failed region's addresses
Learn's example: with a private zone linked to virtual networks in three regions and region A down, virtual networks in the other regions can still query the zone and keep resolving the IP address of a VM in region A, even though that VM is unavailable. Learn adds that the example does not show a DR scenario and that, because private zones are global, you can recreate the VM in another region's virtual network to take over the workload. If you create networks and networking resources across regions, you plan and implement the multiregion strategy for applications that need cross-region failover.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-dns-private#resilience-to-region-wide-failures

### Azure DNS does not monitor endpoint health
Azure DNS continues to return the configured IP address of a resource that is unavailable because it does not monitor endpoint health, and when you fail over to a healthy resource you are responsible for updating the DNS record (or for putting the resources behind a zone-redundant load balancer). Learn states this in the context of an availability zone failure; its region example shows the same behaviour, so a record for a failed resource in the primary region is not changed by Azure.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-dns-private#resilience-to-availability-zone-failures

### Private DNS zones have no managed backup
Azure DNS is a stateless service and provides no managed backups or point-in-time restore for private DNS zones. Learn's advice is to define the zones by infrastructure as code (for example Bicep or Terraform), store the definitions in source control and test periodically that they can be redeployed.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-dns-private#backup-and-restore

### TTL balances failover time and query volume
Learn recommends TTL values that balance performance with recovery time: lower values enable faster failover and increase query volume, and it suggests considering 300 seconds (5 minutes) as a starting point for production workloads. If a TTL is very high and a backend fault requires redirecting to a different IP address, clients might experience delays in failover until the TTL expires. This page does not say that a value is right for a given workload, so the team sets the value and TC-4 proves it.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-dns-private

### Command-line and infrastructure-as-code tools stay usable when the portal is degraded
Learn says to prepare for scenarios where the Azure portal cannot be reached, especially when a DNS zone must be reconfigured during a platform outage, and that Azure CLI, Azure PowerShell and infrastructure as code (Bicep, Terraform) remain operational even if the portal is degraded. The failover steps of this playbook therefore name a scripted change and not a portal click.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-dns-private#resilience-to-portal-and-management-tool-outages

### A private endpoint belongs to one virtual network's region and subscription
Learn lists these properties: the private endpoint must be deployed in the same region and subscription as the virtual network; the private-link resource can be in a different region than the virtual network and the endpoint; the endpoint's read-only network interface keeps its dynamic private IP address for the whole lifecycle of the endpoint; and multiple private endpoints can be created for the same private-link resource, in the same or in different subnets. Learn's recommended practice for a single network with a common DNS server configuration is one endpoint per private-link resource, to avoid duplicate entries or conflicts in DNS resolution. So (inference) the endpoint of the primary region's network cannot serve a virtual network of the DR region: the DR region needs endpoints of its own.
- Source: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview#private-endpoint-properties

### Only an Approved connection carries traffic
Connection status is read-only: Approved, Pending (created manually, awaiting the private-link resource owner), Rejected, or Disconnected (the owner removed the connection; the endpoint becomes informative and should be deleted for cleanup). Only endpoints in the Approved state can send traffic. The approval is automatic when the creator holds the permissions on the private-link resource, otherwise the endpoint is created Pending and the resource owner approves it.
- Source: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview#access-to-a-private-link-resource-using-approval-workflow

### DNS resolution and access control are independent
Learn says a successful public DNS lookup confirms only that a resource with that exact name exists in the global Azure namespace: it does not confirm that a private endpoint is attached, reveal the endpoint's IP, or grant any data-plane access. When the resource has public network access set to Disabled, or its service firewall denies the caller, the service rejects the connection regardless of DNS resolution. So (inference) the target's network and firewall settings must allow what the DR consumers do, and a name that resolves is not evidence of access.
- Source: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns#azure-services-dns-zone-configuration

### A linked zone answers NXDOMAIN for a name it has no record for
A virtual network that uses a private DNS zone for a resource type (for example the zone for blob storage) can resolve public resources only if those resources have no private endpoint connection; otherwise the zone answers NXDOMAIN because no matching record exists. Learn names two remedies: fallback to internet on the virtual network link, or a manually entered A record with the public IP address, which Learn does not recommend because it is not updated when the public IP changes. Private endpoint zone configurations are generated automatically only when the recommended zone names are used.
- Source: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns#azure-services-dns-zone-configuration

### Do not share a zone between services, and do not reuse a zone that serves public names
Learn cautions against overriding a zone that is actively used to resolve public endpoints (use a different domain name or the suggested name of the service), and says that an existing zone linked to a single Azure service should not be associated with two different services' private endpoints, because that deletes the initial A record and causes resolution issues; it says to create a zone for each private endpoint of like services and not to place records of multiple services in one zone. This page can be read as asking for a zone per endpoint, while the storage and Cosmos DB examples use a zone per region; (inference) the playbook follows the stricter reading: the DR region gets a zone of its own, separate from the primary's.
- Source: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns

### Two endpoints to the same resource cannot share one zone
Learn's storage example says that two private endpoints cannot use the same private DNS zone for the same endpoint, so each region uses its own private DNS zone attached to the hub network of the region, and that a private DNS zone can have only one record for a private endpoint: once the first endpoint is registered in a zone, other endpoints need other zones. Neither the storage page nor the Cosmos DB page names the DR zone; (inference) because both endpoints resolve the same name, the DR region's zone carries the same zone name as the primary's, as a separate resource. The DNS integration page says that creating multiple zones with the same name for different virtual networks needs manual operations to merge the DNS records, which applies to networks that share one endpoint and not to separate endpoints, so this inference needs the check of TC-2 in each DR network.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-failover-private-endpoints#architecture-concepts

### One zone must serve every network that uses the same endpoint
For a hub-and-spoke or peered setup in which several networks share a private endpoint, Learn requires a single private DNS zone linked to all of them: creating several zones with the same name for different networks needs manual operations to merge the DNS records, and the same zones must be linked to every spoke and the hub whose clients need resolution.
- Source: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns-integration

### On-premises clients need a forwarder in a linked network
DNS queries for a private endpoint must originate from a virtual network linked to the private DNS zone, so on-premises clients resolve through a DNS forwarder (a VM, or a managed service such as Azure Firewall) deployed in a linked virtual network, with a conditional forwarder on the on-premises DNS server pointing to it. The conditional forwarding must use the public zone forwarder name of the service (for example database.windows.net) and not the privatelink name.
- Source: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns-integration#on-premises-workloads-using-a-dns-forwarder-without-azure-private-resolver

### A private DNS zone group ties the records to the endpoint
When an endpoint is integrated with a private DNS zone, a private DNS zone group is created: it updates the zone records when the endpoint changes and deletes all records of the group when the endpoint is deleted. A zone group supports up to five zones, only one zone per zone name, and a private endpoint cannot have more than one zone group.
- Source: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns-integration#private-dns-zone-group

### Virtual network links
A virtual network must be linked to a zone to resolve its records. Learn lists: only one link between a zone and a virtual network; each link has a name unique within the zone; after creating a link, check that Link Status is Completed, which can take a few minutes depending on the size of the network; deleting a virtual network deletes its links and its autoregistered records in all zones; classic virtual networks are not supported.
- Source: https://learn.microsoft.com/en-us/azure/dns/private-dns-virtual-network-links#other-considerations

### Private DNS limits
Learn lists 1000 private DNS zones per subscription, 25000 record sets per zone, 20 records per record set, 1000 virtual network links per zone (100 with autoregistration) and 1000 zones that one virtual network can be linked to.
- Source: https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#private-dns-zones

### Private endpoint limits
Learn lists 1000 private endpoints per virtual network, 4000 across peered virtual networks and 64000 per subscription; check the DR subscription and DR networks against these limits before the build.
- Source: https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#azure-private-link-limits

### Region and service gaps of private endpoints
Learn lists network security group and user-defined route support for private endpoints as unavailable in some regions (for network security groups: West India, Australia Central 2, South Africa West, Brazil Southeast, all Government regions and all China regions; for user-defined routes and application security groups the first four), and static IP address configuration as unsupported for AKS, Application Gateway, HDInsight, Recovery Services vaults and third-party Private Link services. Check the DR region and each target type against the page.
- Source: https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-overview#limitations

### Storage with geo-redundancy: no DNS change when the account fails over
In Learn's storage example, the account has private endpoints for its blob endpoint in both regions, each region with its own zone. When the account fails over to its paired region, the network routing stays the same and no DNS change is needed; when only other services fail over, on-premises conditional forwarders need updating if the DNS servers of the primary region are affected; for a whole region outage the conditional forwarders from on-premises DNS need to be updated to the secondary region. Learn also says that a jump box in the secondary region can replace the forwarder change when on-premises access is only for administration.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-failover-private-endpoints#failover-scenarios

### Cosmos DB: the same pattern, shown for that service only
Learn's Azure Cosmos DB page shows the same topology (private endpoints in both regions, each region with its own zone) and says that after a forced failover (offline region) network routing remains unchanged and no DNS modification is necessary. This is shown for storage and Cosmos DB only: whether another service keeps its name and its private-link behaviour after its own failover is stated on that service's page and is checked per target.
- Source: https://learn.microsoft.com/en-us/azure/cosmos-db/failover-considerations-for-private-endpoints#failover-scenarios

### Learn asks for documented and tested DNS steps in the DR plan
Learn recommends maintaining infrastructure-as-code templates for all private endpoints, their DNS zone records and NSG rules in version control so that you can redeploy them in a secondary region, and, for multi-region DR, documenting how clients resolve service FQDNs to the correct regional endpoint and testing the DNS changes as part of the service-specific failover process. It adds that the DNS integration guidance explains zone and resolver patterns but does not replace a full DR design.
- Source: https://learn.microsoft.com/en-us/azure/private-link/secure-private-link#backup-and-recovery

### Roles to deploy and to approve a private endpoint
To deploy a private endpoint a user needs a built-in role such as Owner, Contributor or Network Contributor, or a custom role with the listed permissions (among them subnet join and write of privateEndpoints). Approval is automatic when the creator holds the approval action on the private-link resource (Microsoft.[ServiceProvider]/[resourceType]/privateEndpointConnectionsApproval/action, plus the network permissions); otherwise Learn lists read and write of privateEndpointConnections on the resource type as the minimum permissions and the resource owner approves.
- Source: https://learn.microsoft.com/en-us/azure/private-link/rbac-permissions

### Private DNS Zone Contributor does not cover the linked virtual networks
Private DNS Zone Contributor lets you manage private DNS zone resources, but not the virtual networks they are linked to, and Network Contributor lets you manage networks. So (inference) a pipeline that creates virtual network links needs both a role on the zone and a role on the network.
- Source: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/networking#private-dns-zone-contributor

### Contributor cannot assign roles
The Contributor role grants full access to manage all resources but does not allow you to assign roles in Azure RBAC. So (inference) the role assignments for the DR identities are made by an identity that holds Role Based Access Control Administrator, User Access Administrator or Owner at the scope, roles that the same page lists.
- Source: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged#contributor

### Deleting a zone cannot be undone
When a zone is deleted in Azure DNS, all record sets in it are deleted, and this cannot be undone. Learn describes Azure RBAC with the Private DNS Zone Contributor role, resource locks (CanNotDelete, ReadOnly) and a CanNotDelete lock on a record set such as the SOA record set as protection against zone deletion; a CanNotDelete lock on a record set does not prevent it from being modified, including emptied.
- Source: https://learn.microsoft.com/en-us/azure/dns/dns-protect-private-zones-recordsets#protecting-against-zone-deletion

### Creating or deleting a lock needs its own access
Learn says that to create or delete management locks you need access to Microsoft.Authorization/* or Microsoft.Authorization/locks/* actions, and that users assigned the Owner and User Access Administrator roles have the required access. The Contributor, Network Contributor and Private DNS Zone Contributor roles of this playbook are not listed there, so (inference) the lock on a zone is created by an identity that holds one of those two roles.
- Source: https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources#who-can-create-or-delete-locks

### Monitor endpoints and connection changes
Learn recommends monitoring the Bytes In and Bytes Out metrics of private endpoints and tracking, with Azure Activity log alerts, when endpoint connections are created, approved, rejected or removed.
- Source: https://learn.microsoft.com/en-us/azure/private-link/secure-private-link#logging-and-monitoring

## Non-paired options

### dr-region-endpoints: Private endpoints and a separate private DNS zone in the DR region
- Kind: workaround
- Target: dr-region
- Uses mechanism: Additional private endpoints for the same private-link resource in another region
- Estimated RPO: 0 (stateless tier: endpoints and records hold configuration and no data, and Learn publishes no figure, so the RPO of the data tier of each target governs; the configuration drift limit is a separate team-set parameter, Estimated 1d as a starting value: a change to an endpoint, zone record or link of the primary region reaches the DR region's deployment within this time, and TC-5 proves it)
- Estimated RTO: 15m (Estimated, team-set starting value; TC-4 proves it; the time the team sets from the declaration of DR to a DR consumer resolving every name to the DR region's endpoint, including the TTL of a record that changes (Learn suggests considering 300 seconds as a starting point) and the repointing of on-premises forwarders when they are affected; Learn publishes no figure and needs no DNS change at all when the target fails over by itself with an unchanged name)
- Prerequisites: a subnet in a DR-region virtual network for the endpoints, in the subscription of that network (the endpoint must be in the same region and subscription as the virtual network); the DR region and each target type checked against the region and service gaps and against the endpoint and zone limits (Constraints); Microsoft.Network and the target's resource provider registered in the subscription (Learn: the subscription of the endpoint and the subscription of the private-link resource must be registered with the Microsoft network resource provider); a decision per target of what the DR consumers resolve: the target's own name when the target fails over by itself with an unchanged name (a second endpoint to the same resource, as Learn shows for storage and Cosmos DB), or the name of a DR instance (an endpoint to the instance in the DR region or in the pair); the recommended zone name of each target type from Learn's list, created as a separate zone for the DR region and linked to every DR network that has consumers, including the hub that runs DNS forwarders; DNS servers or an Azure DNS Private Resolver in the DR region's hub that are not in the primary region, with conditional forwarding to the public zone forwarder names, when on-premises clients or custom-DNS networks need the names; approval of each connection by the owner of the private-link resource when the creator lacks the approval action; the target's network settings (public network access, firewall) checked for what DR consumers do; roles per the Build steps (the identity that assigns them holds Role Based Access Control Administrator or User Access Administrator, because Contributor cannot assign roles); the templates of both regions in source control.
- Cost notes: each additional private endpoint is charged, traffic between regions is charged when a DR consumer reaches a target in another region, and global virtual network peering has a data transfer cost between regions (Learn: https://learn.microsoft.com/en-us/azure/storage/common/storage-failover-private-endpoints#cross-region-traffic-costs); DNS forwarder VMs or a resolver in the DR hub, and the template pipeline runs; no price.
- Gives up: any Microsoft-managed failover of endpoints or zone records (Learn describes none: the DR copy is configuration that the team keeps current, see the configuration drift limit of the Estimated RPO line); an automatic record change for a DR instance with a different name, because Azure DNS does not monitor endpoint health and the customer updates the record or the consumer's configuration; the failover of the target itself (each target's own playbook decides it: the endpoint only gives the DR network a private path to it); a second set of endpoints, zone records and links to operate and pay for; for on-premises clients, a manual change of conditional forwarders when the DNS servers of the primary region are affected.
- Recommended when: the DR region is not the primary's pair, the DR workloads resolve private-link resources through private endpoints and private DNS zones, and each target either fails over by itself with an unchanged name or has a DR instance that the DR consumers can use.
- Source: https://learn.microsoft.com/en-us/azure/storage/common/storage-failover-private-endpoints#architecture-concepts

## Migration from a paired setup

### Recognise today's setup
Private endpoints and private DNS zones have no paired-region replication of their own: Learn describes the zone as a global resource and the endpoint as a resource of one network's region. So "paired DR" shows in an inventory as the place of the endpoints and links, not as a setting:
- Private endpoints (microsoft.network/privateendpoints): the location, the subnet (and so the virtual network and its region), the private-link resource ID and sub-resource (group IDs), the connection state and the DNS zone group. Record a DR relationship only when it is observed or confirmed: observed means a second endpoint, in a virtual network of another region, whose private-link resource ID is the same target resource as a primary-region endpoint (or a target that the target service's own playbook shows as its DR partner), with an Approved connection and a zone link from that network; confirmed means the owner of the workload confirms it. An endpoint's location, its name or the region of its network alone proves nothing: without that evidence, record the DR networking of the endpoint as Unknown.
- Private DNS zones (microsoft.network/privatednszones): the zone name, resource group, record sets, and the virtual network links (child resources of the zone, each with its virtual network ID and its registration or resolution setting). A zone has no region (its location is global), so the region of its consumers is read from its links: links only to primary-region (or hub) networks mean the DR networks cannot resolve the names yet.
- The inventory cannot show: the DNS servers of each virtual network (a custom DNS server setting is on the virtual network, another type), DNS forwarders, Private Resolver rules and the conditional forwarders of on-premises DNS, the failover behaviour of each target service, whether a target keeps its name after its own failover, the application's own caches and TTLs, and virtual networks and peering (covered by Learn's own pages for those types). Record today's DR for these two types as Supported by configuration only when the DR region's network already holds a linked zone and an Approved endpoint for each target, as Gap when the inventory covers the DR region's networks and shows neither, and as Unknown otherwise; mark what the inventory cannot show as Unknown.

Migration to a DR region that is not the pair builds the DR region's endpoints, zone, links and forwarding (option dr-region-endpoints) next to what exists, validates them, and only then reduces any endpoints and links that were built in the pair region.

### Build
1. dr-region-endpoints: take the inventory of the endpoints and zones that DR consumers use: for each endpoint its name, target resource ID and sub-resource, subnet, connection state, DNS zone group and private IP address; for each zone its name, resource group, links (network IDs, link status, registration or resolution) and the record sets that belong to endpoints; for each virtual network its DNS server setting; the on-premises conditional forwarders and the resolvers or forwarder VMs of the hubs. This inventory is what TC-1 compares.
2. dr-region-endpoints: decide per target what the DR consumers resolve (see Prerequisites): the same name through a second endpoint to the same resource (for a target that fails over by itself and keeps its name, as Learn shows for storage and Cosmos DB; check this on the target's own page first), or the name of a DR instance through an endpoint to that instance. Write the decision, the target's recommended zone name and the sub-resource per target.
3. dr-region-endpoints: check the DR region and the targets against the Constraints: the region and service gaps, the endpoint and zone limits, the provider registrations, and the target's network settings.
4. dr-region-endpoints: have an identity that holds Role Based Access Control Administrator or User Access Administrator assign the roles, each at the narrowest scope: the deployment identity gets Network Contributor on the resource group of the DR networks (endpoint creation and subnet join, whose permissions Learn lists in rbac-permissions, and, as an inference from the role descriptions, the creation of the virtual network links) and Private DNS Zone Contributor on the resource group of the DR zones; the DR operations role gets Private DNS Zone Contributor on the resource group of the DR zones (the failover and failback steps change records and zone group settings there) and Network Contributor on the DR networks' resource group (a Disconnected endpoint is recreated there); and the same operations role gets Reader on the resource groups of the primary region's endpoints, zones and networks, which the failback checks read. The owners of the private-link resources grant the approval action (privateEndpointConnectionsApproval/action) to the deployment identity and to the DR operations role (so that an endpoint recreated in a failover or failback is approved automatically), or approve the Pending connections themselves. The change of the on-premises conditional forwarders is made by the DNS administrator with rights on the on-premises DNS servers, which Azure RBAC does not grant. Nobody gets Owner for the pipeline.
5. dr-region-endpoints: create the DR zones as separate resources with the recommended zone name of each target type (one zone per name; records of different services stay in different zones), in the resource group chosen in the Build step that assigns the deployment and DR operations roles, and set the TTL of records that the failover may change to the value the team sets (Learn suggests considering 300 seconds as a starting point). Never reuse the primary's zone resource for the DR networks.
6. dr-region-endpoints: create the endpoints in the DR networks' subnets, one per target sub-resource, with a DNS zone group that points to the DR zone (the group creates and updates the records, and removes them when the endpoint is deleted); set the connection approval method by the roles of the Build step that assigns the deployment and DR operations roles, and wait for the connection state Approved on each. Record each endpoint's private IP address (it stays the same for the life of the endpoint).
7. dr-region-endpoints: link each DR zone to every DR network that has consumers (the DR hub and the DR spokes: one zone linked to all networks that share the endpoint), wait for Link Status Completed on each link (it can take a few minutes), and do not link the DR zone to primary-region networks, so that each region resolves to its local endpoint as in Learn's storage example (this is a design choice, not a Learn rule).
8. dr-region-endpoints: build the DNS path of the DR region where it is needed: forwarder VMs or an Azure DNS Private Resolver in the DR hub, inside a network linked to the DR zones, with conditional forwarding for the public zone forwarder names (for example database.windows.net, not the privatelink name); set the DNS server setting of the DR networks to that path where the networks use custom DNS; prepare, but do not apply, the change that points each on-premises data center's conditional forwarders to the DR resolvers.
9. dr-region-endpoints: set the target's network settings for the DR path: allow what the DR consumers do over the DR endpoints and, when the primary does the same, disable public network access on the target only after the connectivity checks of Validate (Learn recommends disabling it after confirming endpoint connectivity).
10. dr-region-endpoints: protect the DR configuration: have an identity that holds Owner or User Access Administrator on the resource group of the DR zones apply a CanNotDelete lock on the SOA record set of each DR zone (Learn's alternative that blocks zone deletion while records stay editable; Learn says that creating or deleting a lock needs Microsoft.Authorization/locks/* access, which the Owner and User Access Administrator roles have and the roles of the Build step that assigns the deployment and DR operations roles do not), and put the endpoints, zones, zone groups, links, records and network security rules of both regions in templates under source control, deployed by one pipeline to both regions.
11. dr-region-endpoints: set alerts: the Activity log alert on endpoint connection state changes (created, approved, rejected, removed) of the DR endpoints, the Bytes In and Bytes Out metrics of the DR endpoints, and an alert when the last successful deployment of the DR configuration is older than the configuration drift limit (Estimated 1d, a team-set starting value that the team records in the runbook).
12. dr-region-endpoints: write the DNS part of the runbook (which names change, which records or forwarders, who does it, with what script, which scenario of Learn's list applies: target fails over, only other services fail over, whole region), using scripted tools only.

### Validate
1. dr-region-endpoints: run TC-1 once, then check TC-5 (what-if shows no drift between the templates and both regions) and TC-6 (roles, locks and alerts).
2. dr-region-endpoints: run TC-2 from a host in each DR network and, where on-premises clients are in scope, from an on-premises host through the DR resolvers, then TC-3 (daily) for 7 consecutive days.
3. dr-region-endpoints: run TC-7, the design check of the DR resolution path.
4. dr-region-endpoints: run TC-4 in a drill: make the primary region's DNS path unavailable to a test client in the DR region (for example the Azure Chaos Studio DNS outage scenario, or turning off the primary hub's forwarders in a test network), switch the forwarders and records by the runbook, and time the switch-over against the Estimated RTO.
5. dr-region-endpoints: record each result with its date; a time that a drill measured is Demonstrated, and a design check stays a design check (a real region outage cannot be rehearsed).

### Cut over
1. dr-region-endpoints: make the DR zones, endpoints and forwarders the DNS path of the DR deployment in the runbook and in the application's DR configuration (names and zone names only, never an IP address).
2. dr-region-endpoints: put the failover and failback rows of this playbook into the runbook with the scripted commands and the roles of the Build step that assigns the deployment and DR operations roles.
3. dr-region-endpoints: keep the on-premises forwarder change approved and ready, not applied; it is applied only in a declared DR or in the drill.

### Decommission
1. dr-region-endpoints: after TC-1 to TC-7 passed, remove the endpoints, links and zones that were built in the pair region only for the paired DR, one target at a time. Before deleting an endpoint, read its zone group: deleting an endpoint deletes all records of its group, so confirm that no other client still resolves through those records, and a Disconnected endpoint is deleted for cleanup (Learn).
2. dr-region-endpoints: remove from the runbook every step that points DR consumers at the pair region's resolvers or endpoints.
3. dr-region-endpoints: leave the primary region's endpoints, zones and links as they are; they are the live path, not part of the paired DR.

### Keep until cut-over
The endpoints, zones, links, resolvers and conditional forwarders of the paired setup (and every primary-region endpoint and zone for good) stay in place until TC-1 to TC-7 have passed and the cut-over is done; so does the runbook step that repoints on-premises DNS to the pair region's resolvers.

## Failover and failback

Neither type has a Microsoft-managed failover that the customer triggers or rehearses, and every step below is customer-managed (see the constraint "A private DNS zone is a global resource"). Which steps apply depends on the scenario (target fails over by itself with an unchanged name, only other services fail over, whole region).

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Declare DR and name the Learn scenario that applies to each target: the target fails over by itself, only other services fail over, or the whole region is down | Incident manager | Estimated unknown (measured in the first drill) | The declaration and the scenario per target are recorded with their time | The primary answers again before the declaration |
| 2 | dr-region-endpoints: fail over the targets and the workloads by their own steps (other playbooks); this playbook adds only the DNS and endpoint steps below | Platform engineer | Estimated unknown (set by the target's own playbook) | Each target in the DR scope reports available in its own check | A target does not become available: the DNS steps below do not fix it; stop and follow that target's playbook |
| 3 | dr-region-endpoints: check that every DR endpoint is Approved and every DR zone holds its records, read-only, with scripts | Network engineer | Estimated unknown (measured in the first drill) | The endpoints show Approved and each name has its A record with the private IP of its endpoint in the DR zone (the TC-1 query) | An endpoint is Pending, Rejected or Disconnected, or a record is missing: delete a Disconnected endpoint, recreate it and write the record by script (Network Contributor and Private DNS Zone Contributor on the DR resource groups; the approval action of the Build step that assigns the deployment and DR operations roles approves it), and if it stays Pending the owner of the target approves it, before the workloads start |
| 4 | dr-region-endpoints: for a target that fails over by itself with an unchanged name and whose own page shows that no DNS change is needed (Learn shows it for storage and Cosmos DB), change nothing in DNS; for a DR instance with a different name, update the DR zone's record (or the consumer's configuration) to the DR instance, by script and not by portal | Network engineer | Estimated 15m (the Estimated RTO of the option, for this step and the failover step that repoints the on-premises conditional forwarders together; TC-4 proves it) | The name resolves from a DR network to the DR instance's private IP, within the TTL that the team set | The name still resolves to the old address after the TTL: check the zone link status and the record, then escalate to the DNS owner |
| 5 | dr-region-endpoints: when the DNS servers or resolvers of the primary region are affected, repoint the on-premises conditional forwarders to the resolvers of the DR hub; skip this step when the on-premises DNS reaches the DR resolvers already, or when on-premises access is only for administration and a jump box in the DR region is used | DNS administrator | Estimated unknown (included in the 15m of the failover step that updates the DR zone's record; TC-4 proves it) | From an on-premises host, each name resolves to the private IP of the DR endpoint and not to a public address | A name resolves to a public address or fails: revert the forwarder change and use the jump box, or hold the on-premises clients until the DR resolvers are checked |
| 6 | dr-region-endpoints: start the workloads in the DR region and run the connectivity probe | Application engineer | Estimated unknown (measured in the first drill) | The probe of TC-3 succeeds over the DR endpoint of each target | The probe fails with the name resolving correctly: check the target's network settings (public access, firewall) and the endpoint state before changing DNS |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region and its DNS path are healthy again: from a primary network, each name resolves to the primary endpoint's private IP | Network engineer | Estimated unknown (measured in the first drill) | The resolution from the primary networks is correct (Reader on the primary resource groups is enough) | A name does not resolve from the primary networks: stay on the DR path |
| 2 | dr-region-endpoints: fail back the targets and the workloads by their own steps (other playbooks) | Platform engineer | Estimated unknown (set by the target's own playbook) | Each target is available in the primary region by its own check | A target is not ready: stay on the DR path |
| 3 | dr-region-endpoints: revert the DNS changes made in the failover: point the on-premises conditional forwarders back and restore the DR zone's record that was changed by the failover step that updates the record for a DR instance with a different name, from the template | DNS administrator | Estimated 15m (one switch-over, as in the failover; TC-4 proves it) | From an on-premises host and from a primary network, each name resolves to the primary endpoint's private IP; the what-if of the templates shows no drift in the DR zone | A name resolves to a stale address after the TTL: restore the DR path for that name and check the records |
| 4 | dr-region-endpoints: check that every DR endpoint is still Approved (Learn's Cosmos DB page says that failing the account back restores the original write region without requiring any changes to the network configuration; the storage page says only that the account can be failed back; Learn defines Disconnected as a connection removed by the private-link resource owner, so only an endpoint whose connection the owner removed, for example when the target was recreated, needs this) and delete and recreate any that is Disconnected | Network engineer | Estimated unknown (measured in the first drill) | TC-1 shows every DR endpoint Approved with its record | An endpoint cannot be approved: the owner of the target approves it, or the DR path stays degraded and the owner of the target decides |
| 5 | dr-region-endpoints: run TC-2 and TC-3 from the DR networks again | Network engineer | Estimated unknown (measured in the first drill) | The DR names resolve to the DR endpoints and the probe succeeds | A check fails: open a fix on the DR configuration before the next incident |

## Test criteria

### TC-1: Every DR endpoint exists, is Approved and has its record
- Applies to: dr-region-endpoints
- Pass condition: for every target in the DR scope of the inventory there is a private endpoint in a DR-region subnet with connection state Approved, a DNS zone group that points to the DR zone, and an A record in the DR zone whose private IP equals the IP address of the endpoint's network interface; the count of DR endpoints equals the count of targets in the DR scope, and no DR zone holds a record of an endpoint that no longer exists.
- How to measure: a scheduled script lists the private endpoints of the DR resource groups (with their connection states, network interface IP addresses and zone groups) and the record sets of each DR zone, and compares them with the inventory of the targets, for example with Azure Resource Graph or the CLI.
- Evidence: the script report with its date, the number of targets and endpoints compared, and the list of differences (zero); for endpoints the connection state and IP address, for zones the record set names and addresses.
- Frequency: monthly, and after every change to the endpoints of the primary region or to the DR networks

### TC-2: DR names resolve to the DR endpoints from every DR network
- Applies to: dr-region-endpoints
- Pass condition: from a host in each DR network (and from an on-premises host through the DR resolvers, where on-premises clients are in scope), every name of the inventory resolves to the private IP of its DR endpoint, not to a public address and not with NXDOMAIN; every virtual network link of a DR zone shows Link Status Completed; zero names fail.
- How to measure: a probe on a host in each DR network runs name resolution (nslookup or dig) for every name and compares the answer with the endpoint IP of TC-1; a script reads the link status of each link.
- Evidence: the probe output per network and per name with the resolved address, the link list with status, and the date.
- Frequency: weekly, and after every change to zones, links, forwarders or DNS server settings

### TC-3: DR consumers connect over the DR endpoint
- Applies to: dr-region-endpoints
- Pass condition: for 7 consecutive days, a probe in each DR network connects to the data plane of every target over the DR endpoint (name resolved by TC-2, connection established, a minimal authenticated request answered) in 100% of the runs, within the connect time that the team sets and records with the probe.
- How to measure: a scheduled synthetic probe per target in the DR subnet of the consumers, recording result, resolved address and connect time; the Bytes In and Bytes Out metrics of the endpoint show the traffic.
- Evidence: the probe log with result, address and latency per run, and the metric export.
- Frequency: daily

### TC-4: The DNS switch-over completes within the Estimated RTO
- Applies to: dr-region-endpoints
- Pass condition: in a drill with the primary region's DNS path unavailable to the test client, the time from the declaration to the first correct resolution of every name in the DR scope (to the DR endpoint or DR instance, from a DR network and from an on-premises test host where in scope) is within the Estimated RTO of the option, and the TTL used is the one that the team set; for a target that fails over by itself with an unchanged name the measured DNS change is none.
- How to measure: a drill that follows the failover steps of this playbook, with the primary DNS path made unavailable (for example the Azure Chaos Studio DNS outage scenario, which applies a network security group rule that blocks outbound traffic on port 53 and does not cause an outage of Azure DNS, or a test network with the primary forwarders switched off), timing each step.
- Evidence: the drill record with timestamps per step, the resolution output of each name and the TTL in force.
- Frequency: every DR drill, at least once before cut-over, and after every change to the forwarders, resolvers or TTL

### TC-5: The DR configuration follows the primary within the configuration drift limit
- Applies to: dr-region-endpoints
- Pass condition: for every change to an endpoint, zone record or link of the primary region merged in the last 30 days, the deployment of the same change to the DR region completed within the configuration drift limit of the option (Estimated 1d, a team-set starting value that is recorded in the runbook; the Estimated RPO of the option is 0 because the endpoints hold no data); a what-if of the templates against both regions shows no change; and a redeploy of the DR templates into an empty resource group in a test subscription creates every endpoint, zone, zone group, link and record of the DR scope.
- How to measure: compare the merge time of each template change with the completion time of its deployment run for the DR region; run the what-if of the deployment tool (for example the Azure CLI or PowerShell what-if); run the test redeploy.
- Evidence: the table of changes with the lag per change and its maximum, the what-if output and the test redeploy report with their dates.
- Frequency: monthly

### TC-6: Roles, locks and alerts are as planned
- Applies to: dr-region-endpoints
- Pass condition: the deployment identity and the DR operations role hold only the roles of the Build step that assigns the deployment and DR operations roles at the scopes named there (no Owner and no Contributor); the SOA lock of every DR zone exists; the alerts of the Build step that sets the Activity log, metric and deployment-age alerts fire on a test (a test endpoint state change and a test deployment delay).
- How to measure: list the role assignments of the DR resource groups, the locks of the zones, and trigger each alert once.
- Evidence: the role assignment and lock lists with their date, and the alert test records.
- Frequency: monthly

### TC-7: The DR resolution path does not depend on the primary region (design check, not drillable)
- Applies to: dr-region-endpoints
- Pass condition: design check, not drillable (a real region outage cannot be triggered): for each DR network, every DNS server, forwarder, resolver and zone link in its resolution path is in the DR region or is a global resource (the private DNS zone) and none sits in the primary region; the list has zero entries in the primary region. What can be measured is TC-4, which simulates the loss of the primary DNS path.
- How to measure: a review of the DNS server setting of each DR network, the forwarders and resolvers, the zone links and the on-premises conditional forwarder targets, with the topology as recorded in the inventory.
- Evidence: the review record with the dependency list per DR network and its date.
- Frequency: before cut-over, and after every change to the DR network's DNS design
