---
service: application-gateway
title: Azure Application Gateway
arm_types:
  - microsoft.network/applicationgateways
  - microsoft.network/applicationgatewaywebapplicationfirewallpolicies
slot: ingress
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2
  - https://learn.microsoft.com/en-us/azure/application-gateway/overview
  - https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-faq
  - https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-components
  - https://learn.microsoft.com/en-us/azure/application-gateway/configuration-frontend-ip
  - https://learn.microsoft.com/en-us/azure/application-gateway/configuration-infrastructure
  - https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-autoscaling-zone-redundant
  - https://learn.microsoft.com/en-us/azure/application-gateway/key-vault-certs
  - https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-probe-overview
  - https://learn.microsoft.com/en-us/azure/application-gateway/monitor-application-gateway-reference
  - https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/configure-public-ip-application-gateway
  - https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/policy-overview
  - https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/create-waf-policy-ag
  - https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/associate-waf-policy-existing-gateway
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-use-with-application-gateway
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-point-internet-domain
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-endpoint-types
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring
---

# Azure Application Gateway

This playbook covers Application Gateway v2 (Standard_v2 and WAF_v2) and its Web Application Firewall (WAF) policy. The gateway is a regional service with no built-in multiregion replication. Learn's multiregion approach names no pair region (an inference from what the page does not say), so the same second-gateway pattern serves a pair region and a non-pair region.

## Mechanisms

### Zone-redundant deployment
- Replicates: nothing across regions. The instances of one gateway are spread across two or more availability zones of one region, and the platform redistributes traffic when a zone fails
- Paired: no
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: 0 (Learn: "Zone failures aren't expected to cause data loss because Application Gateway is a stateless service"; this covers a zone failure only)
- Estimated RTO: unknown (Learn: during a zone outage "connections might experience brief interruptions that typically last a few seconds as traffic is redistributed"; Learn gives no recovery-time figure, and Learn says you don't need to initiate or validate the failover, because Microsoft manages it, and describes no way for the customer to trigger it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2#behavior-during-a-zone-failure

### Zonal deployment with a secondary gateway in another zone
- Replicates: nothing. All instances of the gateway run in one zone that the customer selects; Learn's pattern for resilience is a separate gateway in another zone with the customer's own traffic routing and failover
- Paired: no
- Nonpaired: no
- Failover: customer-managed
- Estimated RPO: 0 (Learn: Application Gateway is a stateless service; this covers a zone failure only)
- Estimated RTO: unknown (Learn: for a zonal gateway "your gateway is unavailable until the availability zone recovers", and the customer must detect the loss and reroute traffic to a secondary gateway; Learn gives no figure)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2#behavior-during-a-zone-failure

### Backup and restore (configuration as code)
- Replicates: nothing. Learn says Application Gateway v2 is stateless and "doesn't require traditional backup and restore operations", and that its configuration data is stored in Resource Manager and can be redeployed with infrastructure as code such as Bicep files or ARM templates
- Paired: no
- Nonpaired: no
- Failover: not applicable
- Estimated RPO: 0 (stateless service; the configuration is as current as the last deployed template or export)
- Estimated RTO: unknown (Learn's Backup and restore section gives no restore time)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2#backup-and-restore

## Constraints

### Application Gateway v2 is a single-region service
Learn says Application Gateway v2 is a single-region service and that if the region becomes unavailable, the gateway is also unavailable. Zone redundancy protects against the failure of a zone, not of a region.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2#resilience-to-region-wide-failures

### Multiregion resilience is built by the customer
For multiregion resilience Learn says to deploy separate gateways in each desired region and implement traffic management across regions, and that the customer is responsible for deploying and configuring each gateway and for traffic routing and failover. Its points: keep rules and policies consistent across regions (infrastructure as code such as Bicep or Terraform helps), deploy a global load balancing solution (Azure Traffic Manager or Azure Front Door), and consider replicating the backend applications and data.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2#custom-multiregion-solutions-for-resiliency

### The FAQ names Traffic Manager for disaster recovery across datacenters
The Application Gateway FAQ answers the question on disaster recovery across datacenters with: use Azure Traffic Manager to distribute traffic across multiple application gateways in different datacenters.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-faq#how-do-i-achieve-a-disaster-recovery-scenario-across-datacenters-by-using-application-gateway

### Backend servers are outside the scope of the gateway's reliability
Learn says the reliability of the whole solution depends on the configuration of the backend servers (virtual machines, scale sets, App Service or external endpoints), and that they are not in scope of its Application Gateway article. A DR gateway is useful only when the backends it routes to exist and are healthy in the DR region; their DR is in the playbook of each backend's service.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2

### A zone-redundant gateway fails over by itself and needs no customer action
Learn says the platform fully manages traffic routing, failover and failback for zone-redundant gateways, and that because Microsoft manages this feature "you don't need to initiate or validate availability zone failure processes". Learn describes no way for the customer to trigger it (a statement about what the page does not say). For a zonal gateway Learn says you can simulate some aspects of a zone failure by explicitly stopping the gateway.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2#test-for-zone-failures

### A zonal gateway does not survive a zone outage by itself
Learn says that by itself a zonal gateway doesn't provide resiliency to an availability zone outage, and that to improve it separate gateways must be deployed into multiple zones with traffic routing and failover configured.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2#resilience-to-availability-zone-failures

### Zone support cannot be turned off
Learn says all gateways in regions that support availability zones must be either zone-redundant or zonal, so zone support can't be disabled, and that moving from zone-redundant to a zonal gateway needs a new gateway.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2#configure-availability-zone-support

### Zone support needs the v2 SKUs
Availability zone support needs the Standard_v2 or WAF_v2 SKU, in a region that supports availability zones, with at least two instances, which every gateway has.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2#requirements

### Application Gateway v1 is retired
Learn says the v1 SKUs (Standard and WAF) retired on April 28, 2026, that Microsoft no longer supports v1 resources, and that v1 deployments that aren't migrated might experience traffic disruption as the underlying hardware is decommissioned. A v1 gateway found in an inventory is not a DR design: it is migrated to v2 first.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/overview#retirement-of-application-gateway-v1

### A deleted gateway and its public IP cannot be restored
The FAQ says there is no way to restore an Application Gateway resource or its public IP after deletion, and that a new resource must be created. The configuration is therefore held as code or an export outside the gateway before anything is deleted, including at decommission.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-faq#is-there-a-way-to-restore-an-application-gateway-resource-and-its-public-ip-if-it-was-deleted

### The configuration lives in Resource Manager and is redeployed as code
For configuration management and disaster recovery Learn recommends defining the gateway configuration with Bicep files or ARM templates (or exporting an existing gateway's configuration), storing the TLS certificates in Azure Key Vault, documenting and version-controlling custom configurations, rules and policies, and using automated deployment pipelines for consistent provisioning.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2#backup-and-restore

### A WAF policy must be in the same region and subscription as the gateway
Learn's note on associating a WAF policy says the policy must be in the same region and subscription as the Application Gateway for it to be associated. The DR gateway therefore needs its own WAF policy in the DR region and in the DR gateway's subscription; the primary's policy cannot be associated with it.
- Source: https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/associate-waf-policy-existing-gateway

### A WAF policy holds all WAF settings and is associated at three scopes
A WAF policy contains the WAF settings (exclusions, custom rules, managed rules and so on). It is associated with a gateway (global), a listener (per-site) or a path-based rule (per-URI), a more specific association overrides a less specific one, and WAF policy associations are supported only for the WAF_v2 SKU. A policy must be associated to take effect, so the DR policy is associated at the same scopes as the primary's.
- Source: https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/policy-overview

### A new WAF policy starts in Detection mode
Learn says a WAF policy is in Detection mode by default: it logs matching rules and blocks no requests, and Prevention mode blocks matching requests and logs them. A DR policy that is left at its default is therefore less strict than a primary policy in Prevention mode.
- Source: https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/create-waf-policy-ag#configure-waf-rules-optional

### One WAF policy must always stay associated
Learn says that once a firewall policy is associated to a WAF there must always be a policy associated: it can be overwritten, but disassociating a policy entirely isn't supported. Assigning a policy to a gateway or listener that already has one overwrites and replaces the original.
- Source: https://learn.microsoft.com/en-us/azure/web-application-firewall/ag/create-waf-policy-ag

### The virtual network and the public IP must be in the gateway's location
Learn says the virtual network and the public IP address must be in the same location as the application gateway. A DR gateway therefore has its own virtual network and its own public IP in the DR region, a different address from the primary's (an inference from the same-location rule).
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-components#frontend-ip-addresses

### The v2 public IP is a Standard SKU static address and cannot be changed after creation
Learn says the v2 SKU supports standard SKU public IPs that are static only, and that Application Gateway doesn't support changing the public IP address after creation.
- Source: https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/configure-public-ip-application-gateway

### The public IP's zones must cover the gateway's zones
In availability zone-enabled regions the frontend public IP must be configured for all availability zones the gateway uses (the IP's zone selection must be a superset of the gateway's zones). The portal's default is Zones 1, 2 and 3, so an existing public IP deployed to a subset of zones needs the gateway to be created with the CLI, PowerShell, REST or an SDK and explicit zones.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/configuration-frontend-ip

### The gateway needs a dedicated subnet
An application gateway is a dedicated deployment that needs its own subnet, which cannot hold other resource types. Several instances and several gateways can share one subnet, but v1 and v2 gateways cannot be mixed in the same subnet.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/configuration-infrastructure#virtual-network-and-dedicated-subnet

### The subnet is sized for the instances
Learn counts one private address per instance, one for a private frontend and five reserved by Azure, supports up to 125 instances for v2, and recommends a minimum subnet size of /24 for v2 so that autoscaling expansion and maintenance upgrades have room.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/configuration-infrastructure#size-of-the-subnet

### Operators need subnet permissions
Users and service principals that create or manage a gateway need at least the Microsoft.Network/virtualNetworks/subnets/join/action and subnets/read permissions on the virtual network or subnet. Learn names the Network contributor built-in role as one that already supports them, and a custom role as the alternative.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/configuration-infrastructure#virtual-network-permission

### The gateway subnet's network security group has required rules
For a gateway without Network Isolation Learn requires: an inbound allow for client traffic from the expected clients (a source IP or range, or Any) to the gateway subnet's entire IP prefix on the listener ports (when public and private IPv4 listeners share a frontend port, the destination must include the gateway's public and private frontend IPs); an inbound allow from the GatewayManager service tag on TCP ports 65200-65535 for v2; an inbound allow from the AzureLoadBalancer tag that no manual Deny overrides; and outbound internet connectivity that is not blocked. TCP ports 65502 and 54321 and UDP port 12345 are used for platform health monitoring and operations and must not be blocked.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/configuration-infrastructure#required-security-rules

### Creating or updating a gateway needs permissions on the subnet, the public IP and the WAF policy
Learn's permissions list: for the subnet, Microsoft.Network/virtualNetworks/subnets/write and subnets/join/action to create a new one, or subnets/read and subnets/join/action to use an existing one; for the public IP, Microsoft.Network/publicIPAddresses/write and join/action to create a new one, or read and join/action to use an existing one; for ApplicationGatewayWebApplicationFirewallPolicies, create or update needs write, read and join/action. Role assignments can be made at management group, subscription, resource group or resource scope, and Learn says to allow time for the Azure Resource Manager cache to refresh after a change.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/configuration-infrastructure#permissions

### Changing the virtual network's DNS servers needs a stop and start
The gateway instances use the virtual network's DNS configuration, and after that setting changes the gateway must be stopped and started for it to take effect. A custom DNS server must be able to resolve public internet names.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/configuration-infrastructure#dns-servers-for-name-resolution

### Key Vault certificates: supported certificates and rotation
Application Gateway v2 can reference a Key Vault certificate for an HTTPS listener. Learn says only software-validated certificates are supported (HSM-validated certificates are not), the private key must be exportable, and the instances poll Key Vault at four-hour intervals for a renewed version. Any change to the gateway also forces a check, and for PowerShell, the CLI and ARM a secret identifier without a version is strongly recommended so that a newer version is rotated in automatically.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/key-vault-certs#supported-certificates

### Key Vault certificates: format and status
For TLS termination Application Gateway supports certificates in PFX format only, imported or created in the vault, and the certificate's status must be Enabled to avoid failures.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/key-vault-certs#certificate-settings-in-key-vault

### Key Vault certificates: one managed identity per gateway
Application Gateway uses a user-assigned managed identity to retrieve certificates, and only one managed identity can be used on an application gateway.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/key-vault-certs#obtain-a-user-assigned-managed-identity

### Key Vault certificates: the identity's access to the vault
With the Vault access policy model the identity needs the Get secret permission; with Azure RBAC it needs the Key Vault Secrets User role. When the vault uses Azure RBAC the user or service principal that looks up the secret identifier (for example with Get-AzKeyVaultSecret) also needs Key Vault Secrets User or equivalent permissions, because the lookup runs in the caller's security context.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/key-vault-certs#delegate-user-assigned-managed-identity-to-key-vault

### Key Vault certificates: network access to a restricted vault
Learn says that with a private endpoint on the vault the privatelink.vaultcore.azure.net private DNS zone, holding the record of the referenced vault, must be linked to the virtual network that contains the gateway. Without a private endpoint, a restricted vault needs the gateway's virtual network and subnet in its firewall with the Microsoft.KeyVault service endpoint enabled on the subnet, and the trusted-services bypass.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/key-vault-certs#verify-firewall-permissions-to-key-vault

### A listener is disabled when the gateway cannot reach its certificate
If the gateway cannot access the key vault or locate the certificate object, Learn says it automatically sets the listener to a disabled state, visible in Resource Health, and Azure Advisor shows the recommendation "Resolve Azure Key Vault issue for your Application Gateway". A DR gateway whose certificates sit only in a vault that is unavailable in the DR scenario would therefore serve with disabled listeners (an inference from this rule).
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/key-vault-certs#investigating-and-resolving-key-vault-errors

### Capacity per instance is stated differently on two pages
The reliability page (Reliability architecture overview) says each instance can handle at least 10 capacity units; the scaling page says each instance can handle up to 10 capacity units. The pages differ, and this playbook follows the stricter reading (up to 10) to size the DR gateway.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-autoscaling-zone-redundant#autoscaling-and-high-availability

### Scaling modes and limits
With autoscaling the minimum instance count ranges from 0 to 100 (zero reserves no capacity) and the maximum up to 125, with a default maximum of 10 when none is given; manual mode needs an instance count from 1 to 125 and can lose traffic when demand exceeds capacity. Learn says autoscaling should always be enabled to minimize the impact of any zonal failure.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-autoscaling-zone-redundant

### New instances take minutes to appear
Learn says provisioning a new instance may take approximately three to five minutes and that instances scale out in groups. A DR gateway that runs with a minimum of zero instances therefore needs minutes to add capacity (an inference from the figure).
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-autoscaling-zone-redundant#autoscaling-and-high-availability

### Deploying a v2 gateway takes minutes
The FAQ says most deployments that use the v2 SKU take around 6 minutes to provision, and that it can take longer depending on the type of deployment, for example across multiple availability zones with many instances.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-faq#how-long-does-it-take-to-deploy-an-instance-of-application-gateway-will-my-application-gateway-work-while-its-being-updated

### A gateway can be stopped and started, and a change starts it again
The FAQ says Azure PowerShell or the Azure CLI stop and start a gateway, that billing stops and starts with it, that any PUT operation on a stopped gateway (for example adding a tag, a health probe or a listener) triggers a start, and that Learn recommends stopping the gateway after the configuration is updated.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-faq#how-can-i-stop-and-start-application-gateway

### Billing has a fixed part and a capacity-unit part
Learn says v2 pricing has a fixed charge while the gateway is provisioned and a capacity-unit charge, and that a manual instance count or the autoscale minimum reserves 10 capacity units per instance even when utilization is lower. Learn gives current regional rates on its pricing page, not here.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/monitor-application-gateway-reference#pricing

### Backends are unhealthy until a probe succeeds
A gateway probes the backend pool servers independently, and a backend server is marked unhealthy by default until a successful probe response is received. A new DR gateway shows its backends as unhealthy until the probes succeed.
- Source: https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-probe-overview#probe-operations

### Traffic Manager takes the gateway's frontend public IP as an endpoint
Learn's process for using Application Gateway with Traffic Manager: create a Traffic Manager profile with the routing method (priority, weighted, performance or geographic), create the gateway, copy the gateway's frontend public IP address and use it to add an endpoint to the profile, then test through the Traffic Manager DNS name.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-use-with-application-gateway#process-overview-how-to-use-azure-app-gateway-with-azure-traffic-manager

### A company domain points to a Traffic Manager profile with a CNAME
Learn says Azure assigns each Traffic Manager profile a DNS name, and that to use a name from your own DNS zone you create a CNAME record that maps to the profile's domain name. A second-level domain such as contoso.com cannot be pointed to the profile, because DNS standards do not allow CNAME records for second-level domain names.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-point-internet-domain

### A public IP endpoint of Traffic Manager needs a DNS name
Learn lists PublicIPAddress resources among the supported Azure endpoints and says the publicIpAddress must have a DNS name assigned to be used in a Traffic Manager profile.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-endpoint-types#azure-endpoints

### IP-address endpoints are external endpoints and cannot be mixed with Azure endpoints
Learn says IPv4 or IPv6 address endpoints can only be external endpoints, that they let Traffic Manager check an endpoint's health without a DNS name, and that external endpoints with IP addresses as targets cannot be mixed with Azure endpoints in one profile.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-endpoint-types

### Priority routing needs unique priorities between 1 and 1000
In a Traffic Manager Priority profile each endpoint has a priority value between 1 and 1000, a lower value is a higher priority and endpoints can't share priority values. By default all traffic goes to the highest-priority endpoint, and to the next endpoint when it isn't available (based on the configured status and the endpoint monitoring).
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods#priority-traffic-routing-method

### Traffic Manager fails over through DNS, so cached answers delay the switch-over
An HTTP or HTTPS endpoint is unhealthy on a non-200 response (including a different 2xx code or a 301 or 302 redirect) unless the code is in the expected status code ranges, or on a timeout. A degraded endpoint is no longer returned in DNS answers, but earlier answers can still be cached by resolvers and clients, which keep using the endpoint until the cache expires; the cache duration is controlled by the profile's TTL. Learn's timeline example uses a 30 second probing interval, three tolerated failures, a 10 second timeout and a 30 second TTL.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#endpoint-failover-and-recovery

### Traffic Manager monitoring settings
The profile's monitoring settings are the protocol (HTTP, HTTPS or TCP), port, path, expected status code ranges (up to eight), a probing interval of 30 seconds (default) or 10 seconds (fast probing, priced separately), a tolerated number of failures from 0 to 9 (default 3), a probe timeout, and custom header settings (up to eight header:value pairs at profile or endpoint level, which Learn says can carry a host header; an asterisk in a custom Host header is unsupported).
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#configure-endpoint-monitoring

### Traffic Manager cannot health-check a private frontend
Learn says Traffic Manager health probes are designed for endpoints that its probing infrastructure can reach, that it isn't designed to probe endpoints that resolve to private, non-routable or Microsoft-internal address space, and that such endpoints must be configured as Always serve traffic, so Traffic Manager can't provide health-based failover for them. A gateway with only a private frontend therefore cannot use Traffic Manager health-based failover.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#always-serve

### Traffic Manager probes must be allowed through the gateway's network controls
Learn says that for probes to succeed any firewalls or ACLs in the path must allow traffic from all Traffic Manager IP addresses, that probes that aren't allowed may fail, and that endpoints marked unhealthy can cause unexpected traffic rerouting or downtime. The recommended way is the AzureTrafficManager service tag in network security groups or Azure Firewall.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#firewall-setup-for-health-checks

### When every Traffic Manager endpoint is degraded it answers as if all were online
Learn says that when all eligible endpoints are degraded Traffic Manager makes a best-effort attempt and responds as if all the degraded endpoints were online, and that the profile should show Online, not Degraded, to show that the health checks work. A drill therefore checks the endpoint monitor status and not only whether traffic arrives.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#traffic-routing-methods

## Non-paired options

### secondary-gateway: Second gateway and WAF policy in the DR region behind a traffic manager
- Kind: workaround
- Target: dr-region
- Uses mechanism: none
- Estimated RPO: 0 (stateless tier; Learn describes Application Gateway v2 as stateless with its configuration in Resource Manager, so the gateway holds no data to lose and the RPO of the data tier governs; the DR gateway's configuration can still lag the primary's by the drift limit that the team sets and records in the runbook, which TC-1 and TC-2 prove; the backends' data is in the playbooks of their services)
- Estimated RTO: 15m (Estimated, team-set starting value; TC-5 proves it; the switch-over target that the team sets for a DR gateway that already runs in the DR region with healthy backends; Learn gives no figure for a regional failover, and its Traffic Manager timeline example uses a 30 second probing interval, three tolerated failures, a 10 second timeout and a 30 second TTL; a stopped or not yet deployed DR gateway needs a longer target that the team sets and TC-5 proves)
- Prerequisites: Application Gateway v2 available in the DR region, with the same SKU as the primary (WAF_v2 when the primary has a WAF policy); a DR virtual network with a dedicated gateway subnet and a network security group, a Standard SKU static public IP in the DR region whose zones cover the gateway's zones, and DNS servers that resolve public names (see the constraints on the subnet, the network security group, the public IP and DNS); autoscaling with the instance limits that TC-6 sizes; a WAF policy in the DR region and in the DR gateway's subscription, associated at the same scopes as the primary's and in the same mode; for HTTPS listeners a user-assigned managed identity with Key Vault Secrets User (or the Get secret permission) on a vault that the DR gateway can reach in the DR scenario, holding software-validated PFX certificates with an exportable private key and referenced without a version, plus the private DNS zone link or service endpoint that the vault's network needs; the permissions of Learn's permissions list on the DR subnet, public IP and WAF policy for whoever deploys it (the Network contributor built-in role supports the subnet ones), and the same on the primary's scopes for whoever applies the template to the primary at failback; connectivity from the gateway subnet to the DR backends (peering or VPN for internal addresses); a global traffic manager that can reach the gateway's public IP (Azure Traffic Manager with Priority routing, which this playbook describes, or Azure Front Door, whose own playbook covers its origin group and probes); a DNS name for the application that points at the traffic manager; the primary's configuration held as infrastructure as code.
- Cost notes: a second gateway (a fixed charge while it is provisioned plus capacity units, each minimum instance reserving 10 capacity units; a stopped gateway stops billing); a second public IP, WAF policy and diagnostics; the traffic manager's health checks (fast probing is priced separately); no price.
- Gives up: a Microsoft-managed region failover (Learn describes none: the customer builds, keeps in step and fails over the second gateway); a single public IP for the application (the DR gateway has its own, so every allow-list of the primary's address needs the DR address too); an instant switch-over (DNS caching and probe tolerance delay it); health-based failover for a private-only gateway; and a warm DR gateway costs money while idle, while a stopped or undeployed one adds time to the recovery (Learn's figures for new instances and deployments are in minutes).
- Recommended when: the DR region is not the primary's pair or the team wants one DR region for all services, the application is reached through a public frontend over HTTP or HTTPS, and the backends and their data also exist in the DR region.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-application-gateway-v2#custom-multiregion-solutions-for-resiliency

## Migration from a paired setup

### Recognise today's setup
Learn lists no built-in multiregion replication for Application Gateway, so a "paired" setup is one the customer built: a second v2 gateway in the primary's pair region with its own regional WAF policy, its own Standard public IP, a gateway subnet, and a global traffic manager that points at both. In an inventory it shows as two application gateway resources of the same SKU in two regions, two WAF policies (resources of microsoft.network/applicationgatewaywebapplicationfirewallpolicies, whose association shows on the gateway), two public IPs, and a Traffic Manager profile with two endpoints (the Priority method and the priority values show which is first) or a Front Door profile with two origins. The inventory cannot show which gateway is the DR copy (names and co-location prove nothing; the priority order in the traffic manager does), whether the second gateway is kept running or stopped (an operational state, not a replication setting), how far its configuration has drifted, whether its certificates resolve from a vault that is available in a disaster, or which partner allow-lists hold which public IP. A single gateway with no second gateway means no region-level DR: zone redundancy covers only a zone failure, and the gap is recorded as such. A v1 gateway is migrated to v2 first.

### Build
1. secondary-gateway: take the baseline of the primary. Export the primary gateway's configuration or template and list its SKU tier, autoscale minimum and maximum, zones, frontend IP types, listeners (host names, protocols, TLS policy, certificate references), request routing rules, path maps, backend pools, backend settings, probes, rewrite sets and redirects, managed identity, diagnostic settings, and the WAF policy with each association scope; list the values that differ by region (backend addresses, virtual network and subnet, public IP, Key Vault references, policy resource id). TC-1 and TC-2 compare against this baseline, and the drift limit that the team sets for the DR gateway is written next to it.
2. secondary-gateway: decide the standby posture of the DR gateway and write its switch-over target in the runbook. Running with an autoscale minimum of 1 or more instances is the posture that the Estimated RTO of the option assumes. A minimum of zero reserves no capacity and a new instance takes approximately three to five minutes. A stopped gateway stops billing, and each configuration update starts it again, so stop it after every sync; to run TC-3 and TC-4 on it, start it for the check and stop it again. Not deployed means deploying from the template at failover, which takes around 6 minutes for most v2 deployments and longer in some cases, and because a deleted gateway cannot be restored the template is its only recovery. For the stopped and not-deployed postures the team sets a longer switch-over target, and TC-5 proves it.
3. secondary-gateway: choose the DR region and confirm that Application Gateway v2 is available there (the FAQ points to its list of supported v2 regions). Create the DR virtual network and the dedicated gateway subnet (no other resource types; /24 recommended; room for the maximum instance count, 5 reserved addresses and the private frontend). Create the network security group with an inbound allow for client traffic from the expected clients (or Any) to the gateway subnet's entire prefix on the listener ports (and to the public and private frontend IPs when listeners share a port), the GatewayManager inbound rule (TCP 65200-65535), the AzureLoadBalancer inbound allow, no outbound-internet deny, no block of TCP 65502 and 54321 and UDP 12345, and an inbound allow for the AzureTrafficManager service tag on the ports the probes use. Set the virtual network's DNS servers so that they resolve public names before the gateway exists (a DNS change later needs a stop and start of the gateway). Connect the subnet to the DR backends.
4. secondary-gateway: create a Standard SKU static public IP in the DR region with the zones that the gateway will use. Omit the zone list on the gateway so that it uses all zones unless there is a reason not to, as Learn recommends. When the primary also has a private frontend, choose an unused static private address in the DR subnet.
5. secondary-gateway: grant the roles before anything is deployed, because the failover and failback steps do not run without them. The deploying identity (the platform engineer's identity or pipeline, which also runs the failover step that checks that the DR gateway is serving and the failback step that applies the infrastructure as code to the primary gateway) gets the permissions of Learn's permissions list on the scopes it writes to: on the DR virtual network or subnet subnets/read and subnets/join/action (subnets/write too when the subnet is created by the same run); on the DR public IP read and join/action (write and join/action when it is created by the same run); on the DR WAF policy write, read and join/action. The Network contributor built-in role supports the subnet permissions (Learn); for the public IP and WAF policy permissions compare the role with the list or use a custom role, and assign it at the DR resource group or the resources. Give the same permissions on the primary's virtual network or subnet, public IP and WAF policy to the identity that applies the template to the primary in the failback step that applies the infrastructure as code to the primary gateway, and allow time for the role assignments to take effect. Create one user-assigned managed identity for the DR gateway and give it the Key Vault Secrets User role on the DR vault (or the Get secret permission under an access policy); give the identity or pipeline that looks up the secret identifier Key Vault Secrets User too when the vault uses Azure RBAC. Learn names no role for starting, stopping or updating a gateway, for reading its WAF policy and Resource Health, for changing the traffic manager's endpoints or the application's DNS record: decide and assign those roles to the people who hold the roles named in the failover and failback tables, and record them in the runbook.
6. secondary-gateway: make the TLS certificates available to the DR gateway. Place every certificate that an HTTPS listener serves in a vault that the DR gateway reaches in the DR scenario (software-validated, PFX, exportable private key, status Enabled), either the DR vault of the Key Vault playbook or a vault in the DR region, and reference it without a version so that the four-hour poll picks up renewals. When the vault has a private endpoint, link the privatelink.vaultcore.azure.net private DNS zone to the DR virtual network; when it is restricted without one, add the gateway's subnet to the vault's firewall with the Microsoft.KeyVault service endpoint and allow trusted services. Set an Azure Advisor alert for "Resolve Azure Key Vault issue for your Application Gateway" and a Resource Health alert for the DR gateway.
7. secondary-gateway: create the DR gateway's WAF policy as a regional WAF policy (Application Gateway) in the DR region and in the DR gateway's subscription, from the same template as the primary's, with the policy settings, managed rule set and version, rule overrides, exclusions and custom rules copied exactly and the mode set to Prevention when the primary's is (a new policy defaults to Detection). Plan the associations at the same scopes as the primary's: the whole gateway, the same listeners and the same path-based rules.
8. secondary-gateway: deploy the DR gateway from the same template as the primary with region parameters: the same SKU, the zones from the Build step that creates the DR public IP, the autoscale minimum from the Build step that decides the standby posture and the maximum from TC-6, the managed identity, the public IP, the subnet, the same listeners and host names, the Key Vault certificate references, the rules, the probes and backend pools that point at the DR backends. Associate the DR WAF policy. Send the gateway's and the WAF's resource logs to a log workspace.
9. secondary-gateway: set alerts on the DR gateway: Unhealthy Host Count above 0 per backend pool, Failed Requests, Current Capacity Units close to the maximum, Resource Health and Service Health alerts, and an alert when the last configuration sync is older than the drift limit.
10. secondary-gateway: build the traffic management. In Azure Traffic Manager create or reuse a profile with the Priority routing method: the primary gateway as the endpoint with priority 1; when a pair-region gateway already holds priority 2 in a reused profile it keeps priority 2 and the DR gateway gets priority 3 (Cut over swaps them after validation), otherwise the DR gateway gets priority 2 (priorities cannot be shared). Use one endpoint type for every gateway in the profile: Azure endpoints (each gateway's public IP resource, which needs a DNS name assigned, so set a DNS name label on it) or external endpoints with the IP addresses (no DNS name is needed, and IP-address external endpoints cannot be mixed with Azure endpoints in one profile). Set the monitoring protocol, port and path so that a listener answers with a status that the probe accepts (a 200, or set the expected status code ranges, because a redirect marks the endpoint unhealthy), and add a custom Host header because listeners match on host name. Set the probing interval, tolerated failures, timeout and DNS TTL that the team chooses and records. Point the application's DNS name at the profile's DNS name with a CNAME record (a second-level domain such as contoso.com cannot be pointed to a profile, so the application uses a name below it). When the team uses Azure Front Door instead, build its origin group, priority and probes as its playbook says, and keep every check of this playbook.
11. secondary-gateway: add the DR gateway's public IP to every allow-list that holds the primary's public IP (partner firewalls, upstream allow-rules, backend access rules that name the gateway).
12. secondary-gateway: run the first checks of TC-1 to TC-4, TC-6, TC-7 and TC-8 and record the result. Keep today's pair-region gateway and its traffic-manager endpoint in place until Validate has passed.

### Validate
1. secondary-gateway: run TC-1 and TC-2 once on the DR gateway and its WAF policy, then at the frequency of each criterion.
2. secondary-gateway: run TC-3 (certificates and Key Vault access) and TC-4 (backend health through the DR gateway), then at the frequency of each criterion.
3. secondary-gateway: run TC-6 (capacity) and TC-7 (network, subnet and public IP), then at the frequency of each criterion, and run TC-8 (allow-lists) once.
4. secondary-gateway: run TC-5 in a drill. When a pair-region gateway's endpoint is in the profile (priority 2, the DR gateway at 3), first disable the pair-region endpoint, then disable the primary gateway's endpoint, so that the only endpoint left to answer is the DR gateway's; otherwise disabling the primary endpoint is enough. Time the switch-over against the Estimated RTO of the option, then re-enable the endpoints you disabled. Record the design check of TC-5 for the part that cannot be drilled.
5. secondary-gateway: record each result with its date. A time that a drill measured is Demonstrated, and every other time stays Estimated or Unknown.

### Cut over
1. secondary-gateway: after Validate has passed, if a pair-region gateway's endpoint is in the profile, first set it to a free priority value (for example 4) and then set the DR-region gateway's endpoint to priority 2, so that the DR-region gateway is the first fallback after the primary and no two endpoints share a priority; if there is none, the DR gateway already has priority 2 and nothing changes.
2. secondary-gateway: run the drill of TC-5 again on the new order and confirm that, with only the primary's endpoint disabled, the DNS answer returns the DR-region gateway's public IP; re-enable the endpoint afterwards.
3. secondary-gateway: make the DR-region gateway and its WAF policy the DR gateway in the runbook, in the monitoring and in the records of the allow-list owners.

### Decommission
1. secondary-gateway: if a pair-region gateway exists, only after TC-1 to TC-8 have passed on the DR-region gateway, remove the pair-region gateway's endpoint from the traffic manager, and wait for the profile's DNS TTL so that cached answers expire.
2. secondary-gateway: if a pair-region gateway exists, export and keep its configuration as code (a deleted gateway and its public IP cannot be restored), then delete the pair-region gateway, then its WAF policy (so that no policy is deleted while a gateway uses it), its public IP, and its subnet, network security group and managed identity if nothing else uses them.
3. secondary-gateway: if a pair-region gateway existed, remove the pair-region public IP from the allow-lists after the gateway is deleted, and its Key Vault access grants. When there was none, nothing is decommissioned.

### Keep until cut-over
If a pair-region gateway exists, it, its WAF policy, its public IP, its subnet and network security group, its traffic-manager endpoint and priority, its allow-list entries and its access to its certificates stay in place until TC-1 to TC-8 have passed on the DR-region gateway and the drill after the cut-over has passed. The primary gateway, its WAF policy and the traffic manager profile stay for good.

## Failover and failback

Learn describes the failover of a zone-redundant gateway as Microsoft-managed: you don't need to initiate or validate it, and Learn describes no way for the customer to trigger it. The region failover below is customer-run: Traffic Manager moves traffic by itself when it marks the primary endpoint degraded, and the customer verifies and completes it, because Learn says the customer is responsible for traffic routing and failover.

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region's gateway is unavailable (Resource Health, Service Health, the traffic manager's endpoint status) and declare DR for the application | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time, and the primary gateway's endpoint is Degraded in the traffic manager | The primary gateway answers again before the declaration |
| 2 | secondary-gateway: check that the DR gateway is serving: for a running gateway, its provisioning state and Resource Health; for a stopped gateway, start it; for a gateway that is not deployed, deploy it from the template | Platform engineer | Estimated unknown (running: nothing to do; stopped: Learn gives no start time; not deployed: around 6 minutes for most v2 deployments and longer in some cases; measured in the first drill) | The DR gateway's Resource Health is Available, no listener is disabled, and Healthy Host Count of each DR backend pool equals the expected number | The gateway does not reach a running state, or a listener is disabled: fix the vault access, and if that fails the application owner decides whether to serve without that listener |
| 3 | secondary-gateway: check the DR WAF policy: it is associated at the scopes of the primary's, in the same mode, and its rule set and custom rules match the last verified copy | Security engineer | Estimated unknown (measured in the first drill) | The policy's mode, association scopes and rule set match the last TC-2 report | The policy is missing or in Detection mode while the primary's was in Prevention mode: the security owner decides whether to switch it to Prevention at once or to run in Detection with the decision recorded |
| 4 | secondary-gateway: let the traffic manager move the traffic: when the primary endpoint is Degraded the Priority profile returns the DR gateway's endpoint; when it is not (a partial failure that the probes do not see), disable the primary endpoint | Network engineer | Estimated 15m (the Estimated RTO of the option, which includes the probe tolerance and the DNS TTL that the team sets; TC-5 proves it) | The DR endpoint shows Online and a DNS query for the application name from outside both regions returns the DR gateway's public IP; the profile shows Degraded while the primary endpoint is Degraded and Online when the primary endpoint is disabled (Learn's profile monitor status) | The profile shows every endpoint Degraded, in which case it answers as if all were online: check the probe path, the Host header and the network rules for the probe before going on |
| 5 | secondary-gateway: send a synthetic HTTPS request through the application name and check the certificate, the response and the WAF | Application engineer | Estimated unknown (measured in the first drill) | The response status is the expected one, the served certificate is valid and matches the name, and the WAF's request metric or log shows the DR policy evaluating the request | A listener serves the wrong certificate, or every request is a 5xx: return to the previous endpoint order only if the primary gateway is healthy, otherwise stay and fix the certificate or the backend |
| 6 | secondary-gateway: watch the DR gateway's load while clients arrive | Platform engineer | Estimated unknown (new instances take approximately three to five minutes, Learn) | Current Capacity Units stays below the maximum instance count times 10 and Failed Requests stays near zero | Capacity Units reaches that limit: raise the maximum instance count (up to 125), and the application owner decides on rate limits until capacity catches up |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region, the primary gateway and its backends are available again | Incident manager | Estimated unknown (measured in the first drill) | The primary gateway's Resource Health is Available, no listener is disabled and its backend pools are healthy | The primary gateway is still unavailable or its backends are unhealthy |
| 2 | secondary-gateway: apply the infrastructure as code to the primary gateway and its WAF policy so that every change made on the DR gateway during DR is in the template | Platform engineer | Estimated unknown (measured in the first drill) | TC-1 and TC-2 report zero differences between the two gateways apart from the values that differ by region | A difference cannot be explained: keep the traffic on the DR gateway and find the owner of the change |
| 3 | secondary-gateway: let the traffic manager return to the primary: re-enable the primary endpoint if it was disabled and check the endpoint status | Network engineer | Estimated unknown (probe tolerance plus the DNS TTL that the team sets; measured in the first drill) | The primary endpoint shows Online, and a DNS query from outside both regions returns the primary gateway's public IP | The primary endpoint stays Degraded: check the probe path and the network rules, and stay on the DR gateway |
| 4 | secondary-gateway: send a synthetic HTTPS request through the application name and check the certificate, the response and the WAF on the primary | Application engineer | Estimated unknown (measured in the first drill) | The response status is the expected one, the certificate is valid and the primary's WAF policy evaluates the request | The primary returns errors: put the DR gateway first again |
| 5 | secondary-gateway: when requests to the DR gateway have stopped (after the DNS TTL), return it to its standby posture (stop it, or lower the autoscale minimum) and re-run TC-1 and TC-2, and TC-3 and TC-4 when the gateway stays running | Platform engineer | Estimated unknown (measured in the first drill) | The DR gateway's request rate is zero, its standby posture is as recorded, and the criteria that were re-run pass | Requests still arrive after the TTL has passed: find the clients that cache the DR address before stopping it |

## Test criteria

### TC-1: The DR gateway's configuration matches the primary's
- Applies to: secondary-gateway
- Pass condition: a comparison of the exported configuration of the DR gateway with the primary's shows zero differences in SKU tier, zones, autoscale settings other than the maximum sized by TC-6, listeners and host names, TLS policy, request routing rules, path maps, rewrite sets, redirects, probes and backend settings, apart from the listed values that differ by region, and the time between a change in the primary and the same change in the DR gateway stays within the drift limit recorded in the runbook.
- How to measure: export both gateways (the template or the resource JSON), compare them with a script that ignores the listed regional values, and read the deployment time of the last DR change from the deployment history.
- Evidence: the comparison report with its date, the list of ignored regional values, the number of differences (zero) and the measured lag of the last change.
- Frequency: weekly, and after every change to the primary gateway

### TC-2: The DR WAF policy matches the primary's and is associated
- Applies to: secondary-gateway
- Pass condition: the DR WAF policy is in the DR region and the DR gateway's subscription, is associated with the DR gateway at the same scopes (gateway, listeners, path-based rules) as the primary's policy is associated with the primary, has the same mode, managed rule set and version, rule overrides, exclusions, custom rules and policy settings, and shows zero differences in a comparison of the two policies.
- How to measure: read both policies and their associations in the portal or with a read-only query, compare them with a script, and check in the drill of TC-5 that the WAF request metric or log of the DR gateway names the DR policy.
- Evidence: the comparison report with its date, the association list of both gateways, and the metric or log extract with the policy name from the last drill.
- Frequency: weekly, and after every change to the primary gateway

### TC-3: The DR gateway serves valid certificates from a vault it can reach
- Applies to: secondary-gateway
- Pass condition: every HTTPS listener of the DR gateway presents a certificate that is valid, matches the host name and expires later than today plus the lead time that the team sets; no listener is in a disabled state; the Azure Advisor recommendation "Resolve Azure Key Vault issue for your Application Gateway" is absent; and the vault that holds each certificate is one that the DR gateway reaches in the DR scenario (in the DR region, or the DR vault of the Key Vault playbook).
- How to measure: a scheduled TLS probe against the DR gateway's public IP with each listener's host name that records the served certificate's subject and expiry; read the listener state in Resource Health and the Advisor recommendations; check the vault's location and the private DNS zone link or service endpoint of the DR network.
- Evidence: the probe output with its date and the expiry dates, the Resource Health state, the Advisor result and the vault location.
- Frequency: daily

### TC-4: The DR gateway's backends are healthy
- Applies to: secondary-gateway
- Pass condition: on each of 7 consecutive daily runs Healthy Host Count of every backend pool of the DR gateway equals the number of backend servers expected in the DR region, Unhealthy Host Count is 0, and a synthetic HTTPS request sent to the DR gateway's public IP with the application's host name returns the expected status.
- How to measure: read the HealthyHostCount and UnhealthyHostCount metrics per backend pool from Azure Monitor, read the backend health of the gateway, and send the synthetic request directly to the DR public IP (for example with curl and a host name override) so that the primary is not involved.
- Evidence: the 7-day metric export per pool with the expected counts, the backend health output and the request result with its date.
- Frequency: daily

### TC-5: The traffic manager switches to the DR gateway within the Estimated RTO
- Applies to: secondary-gateway
- Pass condition: two parts. Measured: in a drill that disables the primary gateway's endpoint in the traffic manager (and, while a pair-region gateway's endpoint is still in the profile, that endpoint first, so that only the DR gateway can answer), the profile and the DR endpoint show Online, a DNS query for the application name from outside both regions returns the DR gateway's public IP, and a synthetic HTTPS request succeeds with a valid certificate, all within the Estimated RTO of the option, and the profile's monitoring settings (interval, tolerated failures, timeout, TTL) equal the values recorded in the runbook. Design check, not drillable: a regional outage of the primary cannot be rehearsed, so this part passes when the primary gateway's endpoint is monitored with a path that returns a status the probe accepts, the probes are allowed through the gateways' network controls, no endpoint is a private-only frontend, and the runbook names the roles that may change the profile and the DNS record.
- How to measure: a drill that disables the primary endpoint and times the interval from the disabling to the first successful request through the application name, with DNS queries from a resolver outside both regions, and a review of the profile, the monitoring settings and the role assignments.
- Evidence: the drill record with its timestamps, the DNS answers and the measured time (Demonstrated), and the review record with its date.
- Frequency: every DR drill, and after every change to the traffic manager profile or the DNS name

### TC-6: The DR gateway can carry the production load
- Applies to: secondary-gateway
- Pass condition: the DR gateway's autoscale maximum times 10 capacity units (the stricter reading of Learn's two figures) is at least the primary's highest Current Capacity Units over the last 30 days plus the headroom that the team sets, the maximum does not exceed 125 instances, and the gateway subnet holds addresses for that many instances, the 5 reserved addresses and the private frontend.
- How to measure: read the CapacityUnits metric (maximum over 30 days) of the primary from Azure Monitor, read the DR gateway's autoscale settings and the subnet size, and compare them.
- Evidence: the metric export with its date and period, the autoscale settings, the subnet prefix and the calculation.
- Frequency: monthly, and after every change to the primary's autoscale limits

### TC-7: The DR gateway's network, subnet and public IP are as planned
- Applies to: secondary-gateway
- Pass condition: the DR gateway is in a dedicated subnet that holds no other resource type; its network security group has the client-traffic inbound allow for the listener ports, the GatewayManager inbound rule for TCP 65200-65535, the AzureLoadBalancer inbound allow, an AzureTrafficManager allow for the probe ports and no outbound-internet deny; its public IP is a Standard SKU static address in the DR region whose zones cover the gateway's zones; the virtual network's DNS servers resolve public names; and the managed identity holds Key Vault Secrets User (or the Get secret permission) on the vault.
- How to measure: read the subnet, the network security group rules, the public IP and the role assignments with a read-only query or in the portal, and resolve a public name from the DR network.
- Evidence: the query output with its date, the rule list, the public IP properties and the role assignment list.
- Frequency: weekly, and after every change to the DR subnet, network security group, public IP or role assignments

### TC-8: Every allow-list that names the primary gateway names the DR gateway
- Applies to: secondary-gateway
- Pass condition: for every partner firewall, upstream rule and backend access rule that lists the primary gateway's public IP, the same rule lists the DR gateway's public IP, so the count of rules missing the DR address is 0. Design check, not drillable: the rules belong to other parties and only real traffic exercises them.
- How to measure: take the inventory of every allow-list owner, compare each list with the two public IPs, and confirm with each owner in writing.
- Evidence: the inventory with its date, the owner of each list and the confirmation.
- Frequency: after every change to either gateway's public IP, and at every DR drill
