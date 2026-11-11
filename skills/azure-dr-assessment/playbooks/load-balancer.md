---
service: load-balancer
title: Azure Load Balancer
arm_types:
  - microsoft.network/loadbalancers
slot: ingress
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer
  - https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support
  - https://learn.microsoft.com/en-us/azure/load-balancer/cross-region-overview
  - https://learn.microsoft.com/en-us/azure/load-balancer/tutorial-cross-region-portal
  - https://learn.microsoft.com/en-us/azure/load-balancer/skus
  - https://learn.microsoft.com/en-us/azure/load-balancer/move-across-regions-azure-load-balancer
  - https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-custom-probe-overview
  - https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-standard-diagnostics
  - https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-addresses
  - https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/load-balancing-overview
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-endpoint-types
  - https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-faqs
  - https://learn.microsoft.com/en-us/azure/traffic-manager/secure-traffic-manager
---

# Azure Load Balancer

## Mechanisms

### Global load balancer
- Replicates: nothing. It is the Global tier of a Standard public load balancer: one static anycast IP address in front of regional public load balancers, which route to the closest healthy regional load balancer. The load balancer holds no application data; the data of the back ends needs its own mechanism.
- Paired: yes
- Nonpaired: yes
- Failover: Microsoft-managed
- Estimated RPO: 0 (Learn: Load Balancer is a network pass-through service that does not store or replicate application data; the RPO of the data in the back ends is set by the data tier and is not covered here)
- Estimated RTO: unknown (Learn: the global load balancer probes each regional load balancer every 5 seconds and takes one out of rotation when its availability drops to 0, and traffic "automatically switches to healthy regions without DNS changes"; Learn publishes no total failover time, so TC-3 measures it in a drill that the customer can run)
- Source: https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support#list-of-azure-services

### Zone-redundant front-end IP configuration
- Replicates: nothing. The front end is served from independent infrastructure in several availability zones of one region; the configuration state of the load balancer is replicated synchronously across zones. It does not reach another region.
- Paired: no
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: 0 (Learn: no data loss occurs at the load balancer layer, and the configuration state is replicated synchronously across zones)
- Estimated RTO: 0 (Learn: "No downtime is expected for zone-redundant load balancers because the load balancer continues to work from healthy zones"; existing TCP and UDP flows in the failed zone are reset and clients must retry, and back-end instances in the failed zone might be unavailable)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer#behavior-during-a-zone-failure

## Constraints

### A load balancer is a regional resource
Public and internal load balancers are deployed into a single Azure region, and if the region becomes unavailable, the load balancers in that region become unavailable too. Learn names the global load balancer as the native multiregion support and says that other load-balancing services can also route and fail over across regions.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer#resilience-to-region-wide-failures

### The multiregion reference lists the global load balancer for paired and nonpaired regions
Learn's list of services that support multiple regions marks the Load Balancer global load balancer for both paired and nonpaired regions, with a footnote that such services have region selection constraints to review before designing. Which constraints the footnote means is not stated; the home-region list below is the region constraint that this playbook found (inference).
- Source: https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support#list-of-azure-services

### The global tier needs Standard Load Balancer; Basic is retired
Azure Load Balancer has three SKUs: Basic (retired), Standard and Gateway. Basic Load Balancer was retired on September 30, 2025, and Standard Load Balancer supports the Global tier for public load balancers, which Basic does not. A Standard public load balancer needs a Standard SKU public IP address. A Standard load balancer takes VMs or virtual machine scale sets in a single virtual network as back-end pool endpoints, and a Standard internal load balancer is supported through global virtual network peering.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/skus#sku-comparison

### The global front end uses a Global tier public IP address
A public IP address can be created with the Global tier option, which creates a global anycast IP for cross-region load balancers. The Global tier is supported for Standard public IPs, "not yet supported" for Standard v2, and not supported for Basic.
- Source: https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-addresses#sku

### A global load balancer or its Global tier IP is deployed only in a home region
The home region is where the global load balancer or the Global tier public IP address is deployed; a participating region is where the Global public IP is advertised. Learn lists Central US, East Asia, East US 2, North Europe, Southeast Asia, UK South, US Gov Virginia, West Europe, West US and China North 2 as home regions, and says the global load balancer or Global tier public IP can be deployed only in one of them. The home region does not affect how traffic is routed, and if it goes down, traffic flow is unaffected.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/cross-region-overview#home-regions-and-participating-regions

### Regional load balancers behind a global load balancer can be in any publicly available region
Learn says regional load balancers can be deployed in any publicly available Azure region and are not limited to participating regions. Learn's global load balancer pages do not mention region pairs, so the DR region does not have to be the primary's pair (inference from the absence of a pairing condition and from the multiregion reference above).
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/cross-region-overview#participating-regions-in-azure

### The global back-end pool holds regional load balancers
Learn says the back-end pool of a global load balancer contains one or more regional load balancers, and that existing load balancer deployments can be added to it for a highly available, global deployment.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/cross-region-overview#build-cross-region-solution-on-existing-azure-load-balancer

### The global load balancer cannot front internal load balancers
Global front-end IP configurations are public only (an internal front end is not currently supported), and a private or internal load balancer cannot be added to the back-end pool of a global load balancer. Regional load balancers cannot be upgraded to the global tier: only new load balancers can be created as the global tier.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/cross-region-overview#limitations-of-global-load-balancer

### Learn's tutorial needs two Standard regional load balancers in two regions
The tutorial's prerequisite is two Standard SKU load balancers with back-end pools deployed in two different Azure regions, onto which it builds the global load balancer.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/tutorial-cross-region-portal#prerequisites

### Learn's tutorial tests the failover by stopping back ends
To test, the tutorial connects to the global public IP address, stops the virtual machines in the back-end pool of one regional load balancer, and refreshes to observe the connection failing over to the other regional load balancer.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/tutorial-cross-region-portal#test-the-load-balancer

### Other limits of the global load balancer
NAT64 translation is not supported (front-end and back-end IPs must be the same type), UDP traffic on port 3 is not supported, outbound rules are not supported (use outbound rules on the regional load balancer or a NAT gateway), and ICMP is not supported. When the same NICs sit behind several regional load balancers, every regional rule must use the same front-end port for the same back-end port.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/cross-region-overview#limitations-of-global-load-balancer

### The global rule's back-end port matches the regional front-end port
A note at the top of the page says the back-end port of the load-balancing rule on the global load balancer should match the front-end port of the rule or inbound NAT rule on the regional Standard load balancer.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/cross-region-overview

### Routing is geo-proximity, and Learn describes no active-passive setting
Traffic first enters the closest participating region, which is not necessarily a region where a regional load balancer is deployed, then crosses the Microsoft backbone to the closest regional deployment; the geo-proximity algorithm uses the location of the users and of the regional deployments, and the distribution mode of the regional load balancers is used for the final decision when several are candidates. The page describes no priority, weight or standby setting, so every healthy regional load balancer is a target by proximity: this means a "DR-only" region still receives the clients that are closest to it while the primary is healthy (inference).
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/cross-region-overview#ultra-low-latency

### Regional deployments can be added or removed behind the global endpoint
When the global endpoint is exposed to customers, regional deployments can be added or removed behind it without interruption.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/cross-region-overview#ability-to-scale-up-or-down-behind-a-single-endpoint

### Regional failure detection is a probe of each regional load balancer every 5 seconds
The global load balancer's health probe gathers the availability of each regional load balancer every 5 seconds. If one regional load balancer drops its availability to 0, the failure is detected and that regional load balancer is taken out of rotation. Learn gives no time from the failure to the switch.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/cross-region-overview#regional-redundancy

### The global load balancer relies on the health probes of the regional load balancers
The global load balancer uses the health of the back-end regional load balancers when deciding where to distribute traffic; its health checks happen automatically every 5 seconds, given that health probes are set up on the regional load balancers.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/cross-region-overview#health-probes

### The global front end is one static anycast IP address
Learn says a global load balancer provides a single static anycast IP address that routes traffic to the closest healthy regional load balancer, and that if the back ends in one region have a problem, traffic switches to healthy regions without DNS changes because the anycast IP address remains constant.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer#global-load-balancers

### Back-end instances decide the resilience of the solution
A note at the top of the reliability article says that the reliability of the overall solution depends on the configuration of the back-end instances (such as Azure VMs or virtual machine scale sets) and that the article does not cover them.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer

### The SLA needs two healthy back-end VMs
The SLA applies when there are at least two healthy VMs configured as back-end instances, and it excludes downtime from SNAT port exhaustion and from NSGs that block traffic.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer#service-level-agreement

### Zone-redundant front ends are recommended, and regions without zones are nonzonal
Learn recommends zone-redundant load balancers for all workloads. In a region without availability zones, Azure creates all load balancers in a nonzonal (regional) configuration, and if the region experiences an outage, the nonzonal load balancers might experience downtime.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer#resilience-to-availability-zone-failures

### A zone-redundant front end is set on the front-end IP configuration
For a public load balancer the front-end IP configuration takes the zone configuration of its public IP address (Azure configures public IPs as zone redundant by default); for an internal load balancer the zone type is set on the front-end IP configuration. Changing the zone configuration of an existing load balancer means replacing the front-end IP configuration, which requires clients to be reconfigured and might require downtime. A DR load balancer is therefore created with its intended zone configuration from the start (inference from that rule).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer#configure-availability-zone-support

### Zone-redundant public IPs need three live zones (Learn pages differ)
The reliability article says zone-redundant load balancers can be deployed into any region that supports availability zones, and the Availability Zone section of the public IP article says Standard public IPs can be zonal or zone-redundant in regions that support availability zones, while the table of the public IP article says zone-redundant public IPs can only be created in regions where three availability zones are live. This playbook follows the stricter statement: check that the DR region has three live zones before planning a zone-redundant public front end, and otherwise record the front end as nonzonal.
- Source: https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-addresses#sku

### On a failed zone, existing flows are reset
When a zone fails, existing TCP and UDP flows in the zone are reset and the clients must retry, so clients need transient fault handling with automated retries. Learn describes this for zone failures and gives no statement for flows through a regional load balancer that fails with its region.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer#behavior-during-a-zone-failure

### Standard load balancers are closed to inbound traffic until an NSG allows it
Learn's SKU comparison says Standard Load Balancer is closed to inbound flows unless allowed by a network security group, and that internal traffic from the virtual network to an internal load balancer is allowed.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/skus#sku-comparison

### Health probes need their source address allowed
For a probe to mark an instance up, 168.63.129.16 must be allowed in NSGs and local firewall policies; the `AzureLoadBalancer` service tag identifies it and permits probe traffic by default. IPv6 probes use the link-local source address fe80::1234:5678:9abc, and a dual-stack load balancer needs an NSG rule for the IPv6 probe.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-custom-probe-overview#probe-source-ip-address

### With all probes down, a Standard load balancer lets established TCP flows continue
When one instance's probe is down, new TCP connections go to the remaining healthy instances and established connections to that instance continue. When all probes are down, no new flows are sent to the pool and Standard Load Balancer lets established TCP flows continue if the pool has more than one back-end instance, while all UDP flows terminate. A regional load balancer whose back ends are all down therefore stops taking new flows, which is the condition that the global load balancer's probe reports as availability 0 (inference).
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-custom-probe-overview#probe-down-behavior

### Probe design guidance, and Learn's guidance on testing a probe failure contradicts itself
The design guidance says not to configure the virtual network with the Microsoft-owned range that contains 168.63.129.16, that a stopped instance is not probed until it is started again, and that a fluctuating probe makes the load balancer wait longer before it puts the back end back into the healthy state. It says to use an NSG rule to block the probe port or source IP to simulate a probe failure, and in the same list calls blocking the probe IP or port with NSG rules an unsupported scenario that can make the probes misreport availability. This playbook follows the stricter statement: a drill stops the back-end instances (the method of Learn's global load balancer tutorial) or makes the application's own probe response fail, which the guidance also describes, and does not block the probe with an NSG.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-custom-probe-overview#design-guidance

### Metrics come from Standard Load Balancer
Standard Load Balancer exposes Data Path Availability, Health Probe Status, SYN Count, Byte Count and Packet Count as metrics for public and internal load balancers, and the SNAT metrics for public load balancers only (average is the recommended aggregation for the first two, and the data path metric can take up to 10 minutes to appear after a create or update). SYN Count reports the number of TCP SYN packets received, and the load balancer does not terminate TCP connections, so the metrics hold no count of open connections. Learn lists the metrics for public and internal load balancers and does not say whether the Global tier exposes them, so the tests read the regional load balancers' metrics (inference about the Global tier).
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-standard-diagnostics#monitor-azure-load-balancer-with-multi-dimensional-metrics

### A stopped or deallocated back end stops reporting its probe metric
Learn says the load balancer does not send health probes to deallocated virtual machines and stops reporting metrics for such an instance; unavailable metrics appear as a dashed line in the portal. The Health Probe Status of a stopped back end can therefore be empty.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-standard-diagnostics#view-your-load-balancer-metrics-in-the-azure-portal

### The load balancer stores no state and no application data
Load Balancer is a network pass-through service that does not store or replicate application data. Session persistence adjusts the hashing so that requests reach the same back-end instance, but the load balancer stores no state and does not ensure session persistence; when the back-end pool changes, it recomputes the distribution. Session state and application data therefore live in the back ends or in the data tier.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer#behavior-when-all-zones-are-healthy

### Learn's inbound availability alerts use data path availability and health probe status
Learn's example alert on data path availability fires when a load-balancing rule becomes unavailable, with the condition less than or equal to 0 split by front-end port and IP address; its alert on health probe status is split by back-end IP address and port, with the Average aggregation. If a back-end pool is empty, the data path availability metric is not available and its alerts do not trigger.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-standard-diagnostics#inbound-availability-alerting

### A load balancer cannot be moved to another region, only re-created from a template
Learn says that in a literal sense an Azure load balancer cannot be moved from one region to another: the configuration and public IP address are exported to a template, changed to the target region (names, region, SKU, zones, resource ids) and deployed there. An external load balancer is associated with resources in the target region, and exporting and deploying the template needs the Network Contributor role or higher. The target subscription must allow the load balancers in the target region (contact support to enable the quota).
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/move-across-regions-azure-load-balancer#move-an-external-load-balancer-to-another-region-using-the-azure-portal

### An internal load balancer is re-created with its virtual network first
For an internal load balancer, the virtual network configuration must be included and done first, and the load balancer's template is changed to reference the target virtual network and subnet; the new internal load balancer is associated with resources in the target region, and the source network layout must be identified first.
- Source: https://learn.microsoft.com/en-us/azure/load-balancer/move-across-regions-azure-load-balancer#move-an-internal-load-balancer-to-another-region-using-the-azure-portal

### Traffic Manager is a DNS-based load balancer that fails over more slowly than Front Door
Learn describes Traffic Manager as a DNS-based traffic load balancer that distributes traffic across global Azure regions; it load balances only at the domain level, so it cannot fail over as quickly as Azure Front Door, because DNS caching and systems that ignore DNS time-to-live (TTL) values often cause the delay. Learn describes Front Door as global load balancing for web applications with Layer-7 capabilities, and Load Balancer as a Layer-4 service with a regional and a cross-region topology.
- Source: https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/load-balancing-overview#azure-load-balancing-services

### Traffic Manager routes only to internet-facing endpoints
A Traffic Manager endpoint can be any internet-facing service inside or outside Azure. Learn says that for endpoints inside a private network (for example an internal Azure Load Balancer), or users making DNS requests from such internal networks, Traffic Manager cannot be used to route this traffic. An internal load balancer therefore needs another switch-over method (inference).
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-faqs#what-types-of-traffic-can-be-routed-using-traffic-manager

### A public IP endpoint of Traffic Manager needs a DNS name
Traffic Manager Azure endpoints can be PublicIPAddress resources, which can be connected to VMs directly or through an Azure Load Balancer, and the publicIpAddress must have a DNS name assigned to be used in a Traffic Manager profile.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-endpoint-types#azure-endpoints

### Priority routing sends all traffic to the first available endpoint
A Traffic Manager profile with the Priority method sends all traffic to the primary (highest-priority) endpoint and, if it is not available, to the second, and so on. The ARM priority property is between 1 and 1000, a lower value is a higher priority, and endpoints cannot share a priority value. Availability depends on the configured endpoint status and on ongoing endpoint monitoring.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-routing-methods#priority-traffic-routing-method

### Traffic Manager monitoring is configured per profile
Protocol (HTTP, HTTPS or TCP; HTTPS monitoring does not check that the certificate is valid, only that it is present), port, path (HTTP and HTTPS only), probing interval (30 seconds, or 10 seconds for fast probing, with its own pricing), tolerated number of failures (0 to 9, default 3), probe timeout and expected status codes are profile-level settings, and all endpoints of a profile share them.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#configure-endpoint-monitoring

### A failed Traffic Manager endpoint is removed after consecutive failures, recovers when a check succeeds, and existing connections are not moved
In Learn's worked timeline (HTTP, 30-second interval, 3 tolerated failures, 10-second timeout, DNS TTL 30 seconds) an endpoint becomes Degraded after the fourth consecutive failure, and clients keep using it until their DNS cache expires, which the TTL controls. Monitoring continues while an endpoint is Degraded, and the endpoint comes back into rotation when a check succeeds again; traffic returns as cached DNS answers expire. Because Traffic Manager works at the DNS level it cannot influence existing connections: other endpoints might continue to receive traffic through existing connections until those sessions end, and Learn advises that applications limit the session duration so that traffic can drain.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#endpoint-failover-and-recovery

### When all endpoints are Degraded, Traffic Manager answers as if they were online
If all eligible endpoints are Degraded, Traffic Manager makes a best-effort attempt and responds as if all of them were online, so failover cannot happen when health checks are misconfigured; Learn says to check that the profile shows an Online status and not Degraded. A disabled endpoint is not monitored and is not included in DNS responses.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#traffic-routing-methods

### Traffic Manager health checks must reach the endpoint
For probes to succeed, firewalls and ACLs in the path must allow Traffic Manager's IP addresses; Learn recommends the AzureTrafficManager service tag in NSGs or Azure Firewall, and says that probes might fail otherwise and cause unexpected rerouting or downtime.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring#firewall-setup-for-health-checks

### Traffic Manager failover speed depends on four settings
Learn says that with probing interval 10 seconds, the minimum probe timeout of 5 seconds, tolerated failures 0 and a TTL as low as 0, Traffic Manager can provide failovers under 10 seconds after an endpoint goes unhealthy and a DNS query is made. A tolerated-failure value of 0 can take endpoints out of rotation because of any transient issue.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-faqs#how-fast-does-traffic-manager-move-my-users-away-from-an-unhealthy-endpoint

### Traffic Manager is resilient to the failure of an Azure region
By design, the Traffic Manager components (DNS name servers, API, storage layer and endpoint monitoring service) are resilient to the complete failure of any Azure region, so applications deployed in several regions can rely on it to direct traffic to an available instance.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-faqs#is-traffic-manager-resilient-to-azure-region-failures

### Traffic Manager access uses the Traffic Manager Contributor role
Learn recommends granting the Traffic Manager Contributor role to users who manage Traffic Manager profiles and endpoints and Reader for view-only access, and a CanNotDelete lock on production profiles because deleting a profile stops DNS-based routing for all its endpoints. For endpoints in other subscriptions the operator needs read access to the endpoint resources.
- Source: https://learn.microsoft.com/en-us/azure/traffic-manager/secure-traffic-manager#identity-and-access-management

## Non-paired options

### global-load-balancer: Global load balancer in front of a regional load balancer in the DR region
- Kind: native
- Target: dr-region
- Uses mechanism: Global load balancer
- Estimated RPO: 0 (stateless tier; Learn: the load balancer stores no application data, so the RPO of the data tier governs and is set by its own mechanism, in the playbook of the data service)
- Estimated RTO: 5m (Estimated, team-set starting value; TC-3 proves it; Learn publishes no failover time for the global load balancer, only that the regional load balancer is probed every 5 seconds and taken out of rotation when its availability drops to 0; the value is a conservative team-set starting value derived from that mechanism (a probe every 5 seconds and no DNS change on the client side), and TC-3 bounds it)
- Prerequisites: Standard SKU, public regional load balancers in the primary region and in the DR region (any publicly available Azure region, not only a participating region and not only the pair), each with healthy back-end instances in the virtual network of its own region (at least two per back-end pool, the condition of the SLA) and a health probe, because the global load balancer relies on the regional probes; internal load balancers are not eligible; a Standard, Global tier, static public IP address and the global load balancer deployed in one of the home regions of Learn's list (the home region does not affect routing; check that your residency rules allow the resource to sit there); every regional rule uses the same front-end port as the global rule's back-end port; NSGs on the back ends allow the client traffic (Standard is closed by default) and the probe source 168.63.129.16; identity and RBAC: Learn names Network Contributor for exporting and deploying load balancer templates and names no role for creating a global load balancer or for adding and removing a regional front end in its pool, so decide the role, assign it to the network operator on the global load balancer and on the regional load balancers (which can sit in other resource groups than the global one, as in Learn's tutorial), and record it in the runbook; DNS: a name that clients use points at the static global IP address (A and AAAA records), which does not change when a region fails; client or firewall allow-lists that pin the old regional IP address are updated before the cut-over; any Basic load balancer in the inventory is upgraded to Standard first (Basic is retired).
- Cost notes: a second regional load balancer (rules and data processed), the global load balancer and its Global tier public IP, public IPv4 addresses, and the DR region's running back ends; no price.
- Gives up: Layer 4 only (a pass-through load balancer, with no URL or TLS handling); public front ends only (an internal or private workload cannot use it); no outbound rules, ICMP, NAT64 or UDP port 3 on the global tier; no priority or standby setting is documented, so the DR region takes client traffic by proximity while the primary is healthy and its back ends run warm and sized for that load (inference); clients whose flows ran through the failed region must reconnect (inference); the global load balancer cannot be created from an existing regional load balancer (a new IP address and a new resource); the failover time is not published.
- Recommended when: the workload is public, TCP or UDP, on Standard SKU regional load balancers, the DR region is not the primary's pair, no HTTP(S) features are needed at the front door (Learn lists Front Door as the global HTTP(S) service; see that playbook), and the team can keep the DR back ends running and sized.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer#global-load-balancers

### secondary-load-balancer: Second regional load balancer in the DR region with DNS-based switch-over
- Kind: workaround
- Target: dr-region
- Uses mechanism: none
- Estimated RPO: 0 (stateless tier; Learn: the load balancer stores no application data, so the RPO of the data tier governs; the configuration of the secondary is as current as the last deployment from the same template, so TC-1 proves parity)
- Estimated RTO: 5m (Estimated, team-set starting value; TC-4 proves it; the switch-over target the team sets for a public load balancer behind Traffic Manager; the probing interval, tolerated failures, probe timeout and DNS TTL are chosen to fit it, with Learn's worked example (30 seconds, 3 failures, 10 seconds, TTL 30 seconds) as the reference; Learn publishes no total; for an internal load balancer the target is the time of the team's DNS or configuration change, proved by the same criterion)
- Prerequisites: a Standard SKU regional load balancer in the DR region with its own virtual network and subnets, built from the template of the primary (export it, change the names, region, zones, IP configuration and resource ids, and deploy it, which is Learn's re-creation method; for an internal load balancer deploy the virtual network first), with the same front-end ports, rules, probes and back-end pool design and an intended zone configuration (zone-redundant where the DR region allows it, since it cannot be changed without replacing the front end); a Standard static public IP with a DNS name label for a public front end, because Traffic Manager's Azure endpoint needs a DNS name; back-end instances in the DR virtual network, sized and kept ready by their own playbooks, at least two healthy per pool; NSGs that allow client traffic, the probe source 168.63.129.16 and the AzureTrafficManager service tag; for a public front end a Traffic Manager profile with Priority routing, both load balancers as endpoints, and a custom name that clients use as a CNAME (or an alias or linked record at a zone apex); for an internal front end a switch-over that does not use Traffic Manager, namely a record in the private DNS zone or the application configuration that the team changes at failover, and a DR virtual network that clients can reach (Learn: a Standard internal load balancer is supported through global virtual network peering); identity and RBAC: Network Contributor (named by Learn for exporting and deploying load balancer templates) for the pipeline, on the resource groups it exports from and deploys into; Traffic Manager Contributor on the profile and read access to both public IP resources for the network operator (Learn); a role to delete the replaced pair-region resources, and roles for private DNS records, reading metrics and changing alert rules, for which Learn's pages name no role: decide the role, assign it and record it in the runbook; quota for load balancers and public IPs in the DR region (contact support to enable it when the subscription does not allow it).
- Cost notes: a second load balancer (rules and data processed) and its public IP, the Traffic Manager profile (DNS queries and health checks, and fast probing has its own pricing), the DR region's back ends, and the pipeline that deploys and compares the template; no price.
- Gives up: a static anycast IP (clients see a different IP address after the switch, and cached DNS answers delay it by the TTL); the switch-over is DNS-based, so existing connections are not moved, and Learn says Traffic Manager cannot fail over as quickly as Azure Front Door; Traffic Manager cannot route to an internal load balancer, so an internal workload switches by a private DNS or configuration change that the team runs (a manual step); both load balancers must be kept in step by the team's pipeline, and drift is only found by TC-1; priority routing returns traffic to the primary as soon as its probes succeed, which can happen before the data tier is ready (the team decides in Build whether the primary endpoint stays disabled until failback).
- Recommended when: the load balancer is internal, or the public workload cannot use the global load balancer (a feature of the global tier is missing, or the DR region's regional load balancers cannot be put behind one), and a DNS-level switch-over time that includes the TTL is acceptable.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-load-balancer#custom-multiregion-solutions-for-resiliency

## Migration from a paired setup

### Recognise today's setup
Load Balancer has no built-in replication, so a paired DR setup shows as separate resources and no property of one load balancer says "paired". In an inventory of `microsoft.network/loadbalancers`:

- A regional load balancer in the primary region and a second load balancer with the same SKU, rule set and probes in the primary's pair region (a template copy, often with the same name pattern), plus a Traffic Manager profile with Priority routing and both public IP addresses (or their DNS names) as endpoints, or DNS records that the team changes by hand. Record it as today's DR "secondary regional load balancer in the pair" when both exist and the DNS or Traffic Manager link is visible, else as Unknown.
- A global load balancer shows as a load balancer with the Standard SKU in the Global tier (Learn's PowerShell creates it with SKU Standard and tier Global), a Global tier public IP, and a back-end pool whose members are the front ends of regional load balancers. If the inventory has one, record that DR already uses the native option and check which regions its members are in.
- The SKU of each load balancer (Basic is retired and has no Global tier), the front-end type (public IP address or subnet address, that is, public or internal), the zone configuration of each front end (zone-redundant, zonal or none) and the probes and rules.

The inventory cannot show whether the DR copy still matches the primary, whether back ends exist and are sized in the DR region, which DNS records, firewall allow-lists and clients use which IP address, and whether any failover was ever rehearsed. Migration to a DR region that is not the pair is decided per load balancer, by option id: global-load-balancer is for public Standard load balancers (build a regional load balancer in the new DR region and a global load balancer in front); secondary-load-balancer is for internal load balancers and for public ones that cannot use the global tier (build the load balancer in the new DR region and a switch-over). Both can be mixed across the load balancers of one workload, never on one front end.

### Build
1. Take the inventory of each load balancer to protect and record its SKU, type (public or internal), front-end IP configurations with their zone setting, rules (ports, protocol, floating IP, session persistence), probes, back-end pool design, NAT rules, outbound rules, the NSGs on the back ends' subnets and NICs, and its owner; upgrade any Basic load balancer or Basic public IP to Standard first (Basic is retired and has no Global tier). The inventory is what TC-1 compares.
2. Choose the option per load balancer: global-load-balancer only for a public Standard load balancer on a Layer 4 workload that needs no outbound rule on the global tier; secondary-load-balancer for an internal load balancer and for the public ones that fail those tests. Record the choice, the reason and the team's failover target in the runbook.
3. Build the DR network and the DR load balancer: the virtual network and subnets of the DR region (first, when the load balancer is internal), a regional Standard load balancer made from the primary's exported template (Learn's re-creation method: change names, region, SKU Standard, zones and the ids that point to the target network and public IP), a Standard static public IP (zone-redundant when the DR region has three live zones), the same rules, ports and probes, and a back-end pool with at least two instances. The back-end instances are built by the playbook of their service.
4. secondary-load-balancer: on a public front end, give the DR public IP a DNS name label.
5. Set the NSGs on the DR subnets and NICs to allow the client traffic (Standard is closed by default) and the probe source 168.63.129.16.
6. secondary-load-balancer: on a public front end, also allow the AzureTrafficManager service tag in those NSGs.
7. Assign the roles and record them in the runbook: Network Contributor (Learn's role for exporting and deploying load balancer templates) to the deployment pipeline on the resource group of the primary load balancer, which it exports from, and on the DR resource group, which it deploys into; to the network operator, for global-load-balancer, a role on the global load balancer and on both regional load balancers (Learn names no role for adding and removing a regional front end: decide the role and record it), and for secondary-load-balancer (public) Traffic Manager Contributor on the profile plus read access to both public IP resources (Learn: the operator who configures the profile needs read access to the endpoint resources); a role that may delete the replaced resources in the pair region (the Decommission steps), and roles for private DNS records, reading metrics and changing alert rules: Learn names none, so decide each role, assign it, record it. No role is held by a person who is not on the failover roster.
8. global-load-balancer: create the Global tier Standard static public IP and the global load balancer in a home region of Learn's list (pick the one your residency rules allow, since the home region does not affect routing), with a front-end IP configuration for that IP, a back-end pool that holds the front ends of the primary and DR regional load balancers, and a load-balancing rule whose back-end port equals the regional front-end port (Learn's tutorial sets protocol, port, back-end pool, session persistence, idle timeout, TCP reset and floating IP). Check that every regional rule behind it uses the same front-end port for the same back-end port.
9. secondary-load-balancer: for a public front end, create the Traffic Manager profile with the Priority routing method, add the primary load balancer's public IP resource as the endpoint with priority 1 and the DR load balancer's public IP resource as priority 2 (both are Azure endpoints and each public IP needs its DNS name label), set the monitoring protocol, port and path (TCP, or HTTP(S) with a path that reports the health of the application; the port is one that a load-balancing rule of the load balancer serves, an inference), the probing interval, the tolerated number of failures, the probe timeout and the TTL to the values that fit the failover target in the runbook (Learn's FAQ lists the four settings that decide the speed), and decide whether the primary endpoint is disabled during a DR event so that traffic does not return before the data tier is ready; record the decision. Learn recommends a CanNotDelete lock on production Traffic Manager profiles; this playbook does not require one, so if the team applies it, it records in the runbook who may lift it and lifts it before the deletions of the Decommission steps.
10. secondary-load-balancer: for an internal front end, decide and document the switch-over that Traffic Manager cannot do (Learn: it routes only internet-facing endpoints): the name that clients use is a record in a private DNS zone (or an application setting) that points at the primary internal front end, with a TTL the team sets, and the DR front-end IP address is documented and reachable from the clients' networks (for example by global virtual network peering); write the exact change that fails over and the exact change that fails back into the runbook.
11. Set the alerts: Azure Monitor alerts on Data Path Availability (less than or equal to 0, split by front-end IP and port) and Health Probe Status (split by back-end IP and port) of the regional load balancers in both regions, Resource Health alerts and Service Health alerts for both.
12. secondary-load-balancer: set an alert when the Traffic Manager endpoint monitor status of either endpoint is not Online.
13. secondary-load-balancer: put the deployment of the secondary in a pipeline that deploys from the primary's template with the region, names and addresses as parameters, runs on every change to the primary load balancer, and then runs TC-1; no change is made to the secondary by hand.
14. Write the runbook: the failover and failback tables of this playbook with the names, ids, roles and failover target filled in, who decides, and the clients, firewall rules and DNS records that point at each IP address.

### Validate
1. Run TC-2 on the DR load balancer after the back ends are in place and keep running it at its Frequency (daily, by an automated metric check); do not go on while a back end is unhealthy.
2. global-load-balancer: run TC-6 and keep running it at its Frequency (monthly).
3. secondary-load-balancer: run TC-1 and TC-5 and keep running them at their Frequency (TC-1: weekly, and after every change to the primary load balancer; TC-5: weekly).
4. global-load-balancer: run the failover drill TC-3 in a maintenance window and keep running it at its Frequency (every 6 months, and after any change to the back-end pool of the global load balancer); record the Demonstrated failover and failback times.
5. secondary-load-balancer: run the switch-over drill TC-4 and the drain check TC-7 in a maintenance window and keep running them at their Frequency (TC-4: every 6 months, and after any change to the Traffic Manager profile or the DR load balancer; TC-7: every 6 months, together with TC-4); record the Demonstrated switch-over time. An internal front end runs the same drill with the team's DNS or configuration change.
6. Keep the evidence of every criterion with the runbook; a criterion that fails stops the cut-over.

### Cut over
1. global-load-balancer: lower the TTL of the DNS records that clients use (at least one old TTL before the change), then point the name at the static IP address of the global load balancer (A and AAAA records) and update firewall allow-lists and client configuration that pin the old IP address; do not remove the old regional front end.
2. secondary-load-balancer: for a public front end, lower the TTL of the DNS record that clients use, then point it as a CNAME at the Traffic Manager profile name (an alias or linked record at a zone apex) once both endpoints show Online; keep the old record value in the runbook.
3. secondary-load-balancer: for an internal front end, confirm the private DNS record or application setting that clients use, with its TTL, and that the DR front-end address is reachable from clients' networks; no change of the live record is made until a failover.
4. Observe for the period the team sets: client errors, Data Path Availability and Health Probe Status of both regional load balancers, the endpoint monitor status, and the share of requests by region (for the global load balancer the DR region takes the clients closest to it, and the DR back ends must carry that load).
5. Switch the monitoring and the runbook to the new setup and mark the paired-region setup as scheduled for decommission.

### Decommission
1. Only after TC-1 (secondary), TC-2, TC-3 (global) or TC-4 and TC-7 (secondary) and TC-5 or TC-6 have passed on the new setup: the role that the Build step assigning the roles gives for deleting the replaced resources in the pair region removes from the pair region the load balancer, public IP address, NSGs and DNS records or Traffic Manager endpoints that the new setup replaces, in that order (lifting any lock first), and confirms that no back-end pool, NAT rule or client still uses them.
2. If the pair-region back ends are no longer in the DR design, retire them by the playbook of their service and remove the pair region's alerts and runbook entries; keep the template of the removed load balancer in the pipeline repository until the next successful drill.
3. Store the drill evidence; do not delete a Traffic Manager profile that other applications still use (Learn: deleting a profile stops DNS-based routing for all of its endpoints).

### Keep until cut-over
The paired-region load balancer (or its Traffic Manager endpoint), its public IP and its DNS records, the old public IP of the primary load balancer, the firewall allow-lists and client settings that pin them, the primary's front end (it stays in the global back-end pool and keeps its own IP address), and the runbook of the paired failover. Until TC-3 or TC-4 has passed and the cut-over has been observed, the old setup stays as the fallback.

## Failover and failback

### Failover
Failover of the global load balancer is Microsoft-managed: the global load balancer takes a regional load balancer out of rotation by itself when its availability drops to 0. Learn describes no customer-triggered failover for the global tier, so the customer cannot trigger that step (inference); the customer can rehearse it (stop the back ends of one region, as Learn's tutorial does) and can remove a regional front end from the pool as a manual step. Failover of a secondary load balancer behind Traffic Manager happens by itself when the primary endpoint becomes Degraded, and the team can force it by disabling the endpoint; an internal front end switches by the team's manual DNS or configuration change.

| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm the regional impairment of the primary load balancer from Service Health and Resource Health and from the Data Path Availability and Health Probe Status metrics of the primary regional load balancer, and decide to fail over | Incident manager | Estimated unknown (a decision time; Learn gives no figure; measured in the first drill) | The Service Health or Resource Health entry and the metric values are written in the incident log | Stop if the primary's metrics are healthy and the problem is in a back end (use the back-end service's runbook) |
| 2 | global-load-balancer: check that the DR regional load balancer is healthy: Data Path Availability and Health Probe Status are at full availability for its front ends and back ends, with at least two healthy instances | Network operator | Estimated unknown (reading the metrics of the DR load balancer; Learn gives no figure; measured in the first drill) | The metric screenshot or query output is in the incident log | Do not continue if the DR load balancer has no healthy back-end instance; start or scale the DR back ends with the playbook of their service first |
| 3 | global-load-balancer: let the global load balancer fail over: no customer action takes the failed region out of rotation (Learn: probes every 5 seconds, a regional load balancer whose availability drops to 0 is taken out of rotation, no DNS change); watch the response of the global IP address from a client outside both regions | Network operator | Estimated 5m (team-set starting value of the option; Learn publishes no total failover time; TC-3 proves it and records the Demonstrated time) | Requests to the global IP address are answered by the DR region and the error rate returns to the baseline | Go to the failover step that removes the primary front end from the global back-end pool if the primary regional load balancer is still served after 5 minutes |
| 4 | global-load-balancer: when the primary regional load balancer is impaired but its availability has not dropped to 0, remove its front end from the global back-end pool (a manual, customer-managed step; Learn: regional deployments can be added or removed without interruption) | Network operator (the role that the Build step assigning the roles gives for adding and removing a regional front end) | Estimated unknown (one change on the global load balancer; Learn gives no figure; measured in the first drill) | The pool lists only the DR regional load balancer and the client probe is answered by the DR region | Do not remove it if the DR load balancer has no healthy back end (the failover step that checks that the DR regional load balancer is healthy) or if it would leave the pool with no healthy member |
| 5 | secondary-load-balancer: check that the DR load balancer is healthy before the switch: Data Path Availability and Health Probe Status at full availability, at least two healthy instances, and for a public front end the DR endpoint's monitor status is Online (not Degraded) | Network operator | Estimated unknown (reading the metrics and the endpoint status; Learn gives no figure; measured in the first drill) | The DR endpoint shows Online and the metrics are in the incident log | Do not switch while the DR back ends are not healthy; Learn says Traffic Manager answers as if all endpoints were online when all are Degraded, so a switch to an unhealthy DR would not protect the clients |
| 6 | secondary-load-balancer: for a public front end, let Traffic Manager fail over (the primary endpoint turns Degraded after the tolerated failures and Priority routing returns the DR endpoint); to switch earlier, or when the primary is impaired but still answering, disable the primary endpoint | Network operator (Traffic Manager Contributor on the profile) | Estimated 5m (the switch-over target the team sets from the probing interval, tolerated failures, timeout and TTL; TC-4 gives the Demonstrated time) | The primary shows Degraded or Disabled and the DR shows Online, and a DNS query for the profile name returns the DR address | Stop if the DR endpoint is not Online; do not disable the primary when the DR endpoint is not serving |
| 7 | secondary-load-balancer: for an internal front end, change the private DNS record (or the application setting) that clients use to the DR internal front-end address, as written in the runbook | DNS operator | Estimated unknown (the change of the private DNS record or setting, plus its TTL; Learn describes no step for it; measured in the first TC-4 drill) | A client in a network that reaches the DR region resolves the name to the DR address and connects | Stop if the DR virtual network is not reachable from the clients that must be served |
| 8 | secondary-load-balancer: drain the old path: new connections go to the DR load balancer after the DNS TTL expires, but existing connections stay with the primary until their sessions end, so clients with a long connection are restarted or reconnected | Application engineer | Estimated unknown (the profile TTL plus the longest session duration that the application owner sets) | Connections to the primary fall to the level the application owner set; the error rate returns to the baseline | Stop draining and escalate if errors stay above the baseline after the longest session duration |
| 9 | Confirm end to end from a client outside the primary region (a synthetic request through the front name, with the response naming the region) and record the Demonstrated time from the failover step that confirms the impairment and decides to fail over to the first successful response | Application engineer | Estimated unknown (a synthetic request through the front name; Learn gives no figure; measured in the first drill) | The synthetic request succeeds and is answered by the DR region | Escalate to the incident manager if the request fails after the failover target in the runbook |

### Failback
Do not return traffic before the data tier is back in step: the load balancer layer holds no data, so its failback is only a traffic switch and is ordered by the data tier's failback.

| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region is recovered (Service Health closed, Resource Health available) and that the primary regional load balancer is stable: Data Path Availability and Health Probe Status at full availability for the observation period the team sets | Incident manager | Estimated unknown (it follows the recovery of the primary region and the failback of the data tier; no figure is published) | The metrics for the observation period and the data tier's readiness are written in the incident log | Stay on the DR side if the probes fluctuate (Learn: the load balancer waits longer to mark a fluctuating back end healthy) or the data tier is not back in step |
| 2 | global-load-balancer: if the primary front end was removed from the global pool (by the failover step for a primary that is impaired but has not dropped to 0), add it back; otherwise check that the primary regional load balancer is serving again (Learn describes the removal from rotation but does not describe the return, so TC-3 checks it) | Network operator | Estimated unknown (one change on the global load balancer, or a check; Learn gives no figure; measured in the first drill) | The pool lists both regional load balancers and the client probes are answered by the closest region | Do not add it back while any back end of the primary is unhealthy |
| 3 | secondary-load-balancer: for a public front end, enable the primary endpoint again if it was disabled; if it was not, it returns by itself when its checks succeed (Learn: Traffic Manager brings a healthy endpoint back into rotation, as cached answers expire) | Network operator (Traffic Manager Contributor on the profile) | Estimated unknown (the profile TTL plus the failback target recorded before the TC-4 drill; measured in that drill) | The primary endpoint shows Online, a DNS query returns the primary address, and the DR endpoint stays Online | Keep the primary endpoint disabled while the data tier is not back in step or the primary is not stable |
| 4 | secondary-load-balancer: for an internal front end, change the private DNS record or the application setting back to the primary internal front-end address, as written in the runbook | DNS operator | Estimated unknown (the change of the private DNS record or setting, plus its TTL; Learn gives no figure; measured in the first TC-4 drill) | A client resolves the name to the primary address and connects | Stop if the primary front end does not answer, and keep the DR record |
| 5 | Drain the DR path (existing connections stay until they end), then check the load of the DR back ends and the response from a client outside the DR region | Application engineer | Estimated unknown (the profile TTL or DNS TTL plus the longest session duration that the application owner sets) | Requests are answered by the primary and, for the global load balancer, by the closest region; the error rate is at the baseline | Roll back to the DR side (the failover step that lets Traffic Manager fail over for a public front end, or the one that changes the private DNS record for an internal front end) if the error rate rises above the baseline |
| 6 | secondary-load-balancer: restore the standby: compare the secondary with the primary template (TC-1), check that the Traffic Manager profile settings, priorities and both endpoint monitor statuses are as in the runbook (TC-5), and re-enable the alerts | Network operator | Estimated unknown (one pipeline run and one check; Learn gives no figure; measured in the first drill) | TC-1 shows no difference and TC-5 passes | Redeploy the secondary from the template if TC-1 shows a difference, and do not close the incident before |
| 7 | Close the incident with the Demonstrated failover and failback times, the evidence and the changes to the runbook | Incident manager | Estimated unknown (writing the incident record; Learn gives no figure; measured in the first drill) | The incident record holds the times and the evidence | Do not close while a runbook change is open |

## Test criteria

### TC-1: Configuration parity of the secondary load balancer
- Applies to: secondary-load-balancer
- Pass condition: the comparison of the primary and the secondary load balancer (SKU, type, rules and ports, probes, back-end pool design, NSG rules, zone configuration of the front end) shows 0 differences other than the listed ones (names, region, IP addresses and resource ids), and the latest pipeline deployment of the secondary is newer than the latest change of the primary
- How to measure: export the template or the properties of both load balancers (`az network lb show`, or the exported ARM template), normalise the allowed differences and diff them; read the pipeline's last successful run time
- Evidence: the diff output with the list of allowed differences and the pipeline run id and time, kept per load balancer
- Frequency: weekly, and after every change to the primary load balancer

### TC-2: DR load balancer is healthy and ready to take traffic
- Applies to: global-load-balancer, secondary-load-balancer
- Pass condition: for every front end of the DR regional load balancer, the average of Data Path Availability and of Health Probe Status shows no sample below full availability over the last 24 hours (inference: the full value of both metrics is 100), at least 2 back-end instances are healthy in each pool, and the front end is zone-redundant where the DR region has three live zones, or the exception is recorded
- How to measure: Azure Monitor metrics for the DR load balancer with the Average aggregation, split by front-end IP, port and back-end IP; the instance count of the back-end pool; the zone setting of the front-end IP configuration
- Evidence: the metric export or screenshot for the 24 hours, the instance count and the zone setting, per DR load balancer
- Frequency: daily, by an automated metric check

### TC-3: Global load balancer failover and failback drill
- Applies to: global-load-balancer
- Pass condition: after all back-end instances of the primary regional load balancer are stopped, (a) the first response served from the DR region reaches a client outside both regions within 5 minutes (the Estimated RTO of the option, a team-set starting value; Learn publishes none), (b) 0 requests in the following 5 minutes are answered from the primary region, (c) after the primary back ends are started again, the primary regional load balancer is serving the clients closest to it within the failback target recorded before the drill; the Demonstrated times of (a) and (c) are recorded
- How to measure: a client outside both regions sends one request per second to the global IP address and records the time and the region name that the application returns; stop and start the back-end instances of the primary (Learn's tutorial method; the probe is not blocked with an NSG); read Data Path Availability of the front ends of both regional load balancers (Learn: it degrades when no healthy VMs remain in the back-end pool); Health Probe Status of a stopped back end can be empty (Learn: no probe metric is reported for a stopped or deallocated instance), so it is not the proof
- Evidence: the client log with timestamps and region names, the Data Path Availability graphs for both regional load balancers, the recorded targets and the Demonstrated times, and the list of errors seen by clients while the switch happened
- Frequency: every 6 months, and after any change to the back-end pool of the global load balancer

### TC-4: Secondary load balancer switch-over drill
- Applies to: secondary-load-balancer
- Pass condition: from the moment the primary becomes unavailable (its back ends stopped, or its Traffic Manager endpoint disabled for a planned drill), a new connection from a client reaches the DR load balancer within 5 minutes (the Estimated RTO of the option), the DNS answer for the profile name (or the private DNS record, for an internal front end) shows the DR address, and after failback the primary serves new connections within the failback target recorded before the drill; the Demonstrated times are recorded
- How to measure: a client outside both regions queries the name and connects once per second and records time, answer and responding region; read the endpoint monitor status and the profile settings with `az network traffic-manager`; for an internal front end the timed run of the DNS or configuration change in the runbook
- Evidence: the client log, the endpoint status history, the profile settings used (probing interval, tolerated failures, timeout, TTL), and the Demonstrated times
- Frequency: every 6 months, and after any change to the Traffic Manager profile or the DR load balancer

### TC-5: Traffic Manager profile settings (design check, not drillable)
- Applies to: secondary-load-balancer
- Pass condition: 0 differences between the profile and the runbook: the Priority method, distinct priorities with the primary lower than the DR value, Azure endpoints that are public IP resources with DNS names, protocol, port, path, probing interval, tolerated failures, timeout and TTL as recorded, both endpoint monitor statuses Online (not Degraded), and the AzureTrafficManager service tag allowed on the NSGs of both load balancers' subnets
- How to measure: read the profile and endpoints with `az network traffic-manager profile show` and `az network traffic-manager endpoint list`, and the NSG rules
- Evidence: the exported profile, the endpoint monitor statuses and the NSG rule, per profile
- Frequency: weekly

### TC-6: Global load balancer configuration (design check, not drillable)
- Applies to: global-load-balancer
- Pass condition: all of these hold: the global load balancer and its Global tier public IP are Standard, static and in a home region of Learn's list; the back-end pool holds the front ends of at least 2 Standard public regional load balancers in different regions, one in the DR region; every regional load balancer has probes and healthy back ends; the global rule's back-end port equals the regional front-end port; no regional front end is internal; the DNS record that clients use points at the global IP address
- How to measure: list the global load balancer (`az network cross-region-lb show` or the portal), the pool members and their regions, the rules and ports, the public IP tier, and the DNS record
- Evidence: the exported configuration, the pool member list with regions and the DNS record, per global load balancer
- Frequency: monthly

### TC-7: Existing connections drain after a switch
- Applies to: secondary-load-balancer
- Pass condition: after the DNS switch of TC-4, the number of connections still open to the primary front end falls to 0 (or to the level the application owner set) within the longest session duration that the application owner recorded, and the client error rate returns to the baseline in that time
- How to measure: during the TC-4 drill, count the open connections to the primary front end's address on the back ends or in the application (the load balancer metrics hold no open-connection count; SYN Count on the primary front end can serve as a proxy for new connection attempts), and read the application's error rate
- Evidence: the open-connection or SYN Count series over time for the primary and the DR path, and the application owner's session-duration limit
- Frequency: every 6 months, together with TC-4
