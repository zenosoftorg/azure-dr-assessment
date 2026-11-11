---
service: front-door
title: Azure Front Door
arm_types:
  - microsoft.cdn/profiles
  - microsoft.network/frontdoors
slot: ingress
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods
  - https://learn.microsoft.com/en-us/azure/frontdoor/health-probes
  - https://learn.microsoft.com/en-us/azure/frontdoor/origin
  - https://learn.microsoft.com/en-us/azure/frontdoor/front-door-faq
  - https://learn.microsoft.com/en-us/azure/frontdoor/private-link
  - https://learn.microsoft.com/en-us/azure/frontdoor/high-availability
  - https://learn.microsoft.com/en-us/azure/frontdoor/standard-premium/how-to-monitor-metrics
  - https://learn.microsoft.com/en-us/azure/frontdoor/monitor-front-door-reference
  - https://learn.microsoft.com/en-us/azure/private-link/manage-private-endpoint
  - https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-front-door
  - https://learn.microsoft.com/en-us/azure/architecture/guide/networking/global-web-applications/overview
  - https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/overview
---

# Azure Front Door

## Mechanisms

### Priority-based traffic routing
- Replicates: nothing to a DR location (inference: Learn describes no replication by Front Door; it can cache responses at its edge, which is not a DR copy). Front Door routes HTTP and HTTPS requests from its edge locations to the origins of an origin group, sends them to the healthy origins with the highest priority, and routes to the next priority level when no origin at the higher priority is available
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: unknown (Front Door replicates no application data to a DR location, so it has no RPO of its own: the RPO of a workload behind it is that of the data tier of the origins, which the playbooks of those services give)
- Estimated RTO: unknown (Learn publishes no failover time for Front Door: the move to the next priority follows the health probe settings that the team sets and the retry behaviour Learn describes; Front Door does the failover itself from the customer's configuration, so the customer can rehearse it; the option below gives the target the team sets, and TC-2 proves it)
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods#priority-based-traffic-routing

### Weighted and latency-based traffic routing
- Replicates: nothing. Front Door distributes requests among available origins by latency (the default method, with a latency sensitivity of 0 ms by default) and by weight (an integer between 1 and 1,000, default 50)
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: unknown (Front Door replicates no application data to a DR location; an active-active origin group needs a data tier that accepts writes where the traffic lands (inference), which the playbooks of those services decide)
- Estimated RTO: unknown (Learn publishes no failover time: an origin that fails its health evaluation leaves the available origins and the others take the traffic, so, by inference, there is no switch-over step when every remaining origin can carry the full load; the probe settings the team sets decide how fast a failed origin leaves)
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods

### Origin health probes and load-balancing settings
- Replicates: nothing. Each Front Door edge location periodically sends HTTP or HTTPS probes to the configured origins; Front Door excludes disabled origins and origins with probe errors, where an origin is healthy when at least the configured number of its last probe responses are healthy
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: unknown (no data is replicated; health probes only observe the origin)
- Estimated RTO: unknown (Learn publishes no failover time: detection depends on the probe interval, sample size and successful samples that the team sets)
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/health-probes#how-front-door-determines-origin-health

## Constraints

### Front Door is a global service and its profile has no region
Learn says Azure Front Door "isn't limited to any Azure region, but operates globally": the only location chosen at creation is the location of the resource group, which determines where the resource group's metadata is stored, and the Front Door profile is a global resource whose configuration is distributed to all edge locations worldwide. So, by inference, the profile has no paired or nonpaired region to fail over to: DR for an application behind Front Door is about the origins and their region.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/front-door-faq#in-which-regions-can-i-deploy-azure-front-door-services

### The resource group location routes control plane operations
Learn says the resource group stores metadata about resources, that control plane operations on its resources are routed through the group's location, and that when the group's region is temporarily unavailable Azure Resource Manager reroutes the control plane requests to a backup region; this covers the control plane only, not data plane access, and Learn recommends the resource group and its resources in the same region. Front Door has no region, so the resource group location is a deliberate, recorded choice (inference). The manual levers in the Failover table are control plane changes; the probe-based move of traffic needs no change request (inference).
- Source: https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/overview#which-location-should-i-use-for-my-resource-group

### Tiers and the retirement of Front Door (classic)
The routing methods page applies to Front Door Standard, Premium and classic. Learn says Front Door (classic) retires on March 31, 2027: it no longer supports profile creation, new domain onboarding or managed certificates, and Learn tells owners to migrate to Standard or Premium. In classic, "backend pool" means origin group. Both ARM types of this playbook are in scope, and a classic profile gets a migration in its plan before that date.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods

### Origin groups can span regions
Learn says an origin group is a logical grouping of application instances across the world that receive the same traffic, that its origins can be deployed across different regions or within the same region, and that all origins can run in an Active/Active or Active/Passive configuration. Nothing on this page ties an origin to the primary's paired region, so, by inference, a DR origin can be in any region.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/origin#origin-group

### An origin needs a public address unless it uses Private Link
The FAQ says an origin must have a public IP address or a publicly resolvable DNS hostname, and that backends from different zones and regions, or outside Azure, can be mixed as long as they are publicly accessible. Origin types include Storage, App Service, Static Web App, API Management, Application Gateway, public IP addresses, Container Instances, Container Apps and any custom public host name.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/front-door-faq#what-type-of-resources-are-currently-compatible-as-an-origin

### Origin reachability is not validated when the origin is configured
Learn warns that during configuration the APIs do not validate that the origin is accessible from the Front Door environment, and tells the owner to make sure Front Door can reach it. A DR origin that was added but cannot be reached is found only by probes or traffic.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/origin#origin

### A disabled origin gets neither traffic nor probes
Learn says that when an origin is disabled, both routing and health probes to the origin are disabled.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/origin#origin

### The priority range
An origin's priority is a value between 1 and 5, lower values mean higher priority, and several origins can share a value.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods#configuring-priority-for-origins

### Weight and latency sensitivity
Weight is an integer between 1 and 1,000, with a default of 50, and traffic is distributed by weight among the origins that meet the latency sensitivity. With a latency sensitivity of 0 ms, weights only take effect if two origins have the same network latency.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods#weighted-traffic-routing-method

### Health-based failover is built in
Learn states that all Front Door configurations include backend health monitoring and automated global failover. So (inference) the failover of an origin group is done by Front Door from the customer's origin group, priority and probe settings: it is not a Microsoft-managed failover, and the customer can rehearse it. Learn describes no failover of the Front Door service itself that a customer triggers.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods

### Priority routing falls back by health and retries on a best-effort basis
By default Front Door routes to healthy origins with the highest configured priority, and to the next priority level when none is available at that priority. If Front Door cannot establish a TCP connection to the selected origin it makes a best-effort attempt to retry on another eligible origin, even when probes report the origin as healthy. After a connection is established it retries only requests that can be safely retried, such as idempotent requests, and only before response headers are sent; if no alternative origin is eligible it might retry the same origin, and Learn says retries are not promised for every request or failure. A non-idempotent request in flight when the primary fails can therefore fail (inference).
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods#priority-based-traffic-routing

### Every configured origin is probed
Learn says each Front Door profile periodically sends health probes to the configured origins, that each edge location sends them so the volume can be high, and that at the default frequency of 30 seconds the volume per origin is roughly two requests per minute per edge location (fewer when not every edge location gets traffic). Learn describes the probing of every configured origin and does not exempt origins at a lower priority, so a standby DR origin has to answer its probe path with 200 OK to count as available (inference).
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/health-probes

### Probe protocol, port and answer
Probes are sent over HTTP or HTTPS on the same TCP ports configured for routing client requests, and the ports cannot be overridden. A 200 OK status is healthy; any other status code or the absence of a valid HTTP response counts as a probe failure.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/health-probes#supported-protocols

### Probe method
Probes use GET or HEAD; for new Front Door profiles the default is HEAD, and Learn tells owners to use HEAD to lower load and cost on the origins.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/health-probes#supported-http-methods-for-health-probes

### Origin health is evaluated over a sample of probes
Front Door excludes disabled origins, then excludes origins with probe errors: it looks at the last n probe responses (the SampleSize property) and the origin is healthy if at least x of them are healthy (the SuccessfulSamplesRequired property). How many consecutive failed probes make an origin unhealthy follows from n and x (inference).
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/health-probes#how-front-door-determines-origin-health

### The probe interval
The interval defines how often each Front Door environment probes an origin; Learn says that for faster failovers the interval is set to a lower value, and that the lower the value the higher the probe volume the origins receive (30 seconds with 100 Front Door points of presence gives about 200 probe requests per minute per backend).
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/origin#health-probes

### Sample size and the worked example
Learn's example: a probe interval of 30 seconds, sample size 5 and successful sample size 3 means the last five samples over 150 seconds (5 x 30) are looked at, and at least three successful probes are required to declare the origin healthy.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/origin#load-balancing-settings

### When every origin fails its probes Front Door routes to all of them
If health probes fail for every origin in an origin group, Front Door considers all origins unhealthy and routes traffic round robin across all of them, and resumes the normal algorithm when an origin returns to a healthy state. A DR origin that is also unhealthy therefore does not stop traffic from reaching the primary (inference).
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/health-probes#complete-health-probe-failure

### Probes can be disabled only for a single-origin group
Learn says an origin group with a single origin can have health probes disabled, and an origin group with more than one enabled origin cannot. A group that today has one origin and probes disabled therefore needs probes enabled when the DR origin is added (inference).
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/health-probes#disabling-health-probes

### The rules engine can override the origin group
Learn says that with the rules engine a rule can override the route configuration (the backend pool in classic) for a request, and that the origin group set by the rules engine overrides the routing process of the routing methods page. A rule that pins a path to the primary's origin group therefore bypasses the failover to the DR origin for that path (inference).
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods

### Session affinity keeps a session on one origin
With session affinity Front Door adds the cookies ASLBSA and ASLBSACORS, with the lifetime of the user's session; the first request of a session follows the normal routing and subsequent requests go to the origin that was selected, and affinity is not established when the origin sends a cacheable response.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods#session-affinity

### Learn advises against session affinity for reliability
The Well-Architected guide says that, from a reliability perspective, it does not recommend keeping user connections on the same origin server during a session, and to avoid session affinity as much as possible: a single origin might become overloaded while others are idle, and if that origin becomes unavailable the user experience might be disrupted.
- Source: https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-front-door#reliability

### The origin host header
The host header that Front Door sends to an origin comes from the origin's host header setting; when it is not set (for example when the origin is created from a template without it), Front Door sends the incoming host name.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/origin#origin-host-header

### The certificate name of the origin is validated
For Front Door Standard and Premium, during the TLS connection from Front Door to the origin Front Door validates that the request host name matches the host name in the certificate provided by the origin, and Microsoft does not recommend disabling that check. A DR origin therefore needs a certificate valid for the name Front Door uses to reach it (inference).
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/origin#origin

### Use the same host name on each layer
The Well-Architected guide recommends preserving the original HTTP host name when a reverse proxy such as Front Door is in front of a web application, so that cookies and redirect URLs work.
- Source: https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-front-door#reliability

### Back ends accept only the host name Front Door uses
The Well-Architected guide says to configure the back-end services to accept only requests with the same host name that Front Door uses externally. A DR origin needs the same rule (inference).
- Source: https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-front-door#security

### The origin must admit Front Door
The Well-Architected guide says to secure the connections from Front Door to the origins: enable Private Link to supported origins, and, if the origin does not support Private Link, use service tags and the X-Azure-FDID header to verify that the request comes from the owner's Front Door profile, so that all traffic flows through Front Door. The restriction on the primary origin does not carry over to a DR origin by itself, so each origin gets its own (inference).
- Source: https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-front-door#security

### Private Link needs Premium and an approval at each origin
Private Link to origins is a Front Door Premium feature. Front Door creates a private endpoint from a Front Door managed regional private network and the owner must approve the private endpoint connection at the origin before traffic can pass; after approval it can take a few minutes to establish and requests meanwhile get a Front Door error message.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/private-link#how-private-link-works

### One private endpoint per resource, group and region
Within one profile, origins with the same resource ID, group ID and region share one private endpoint, so one approval; if the region, resource ID or group ID changes, extra private endpoints are created and each needs to be approved. Enabling Private Link on origins of other profiles creates extra private endpoints that need approval. When a profile is deleted, its private endpoints are deleted too.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/private-link#association-of-a-private-endpoint-with-an-azure-front-door-profile

### Private Link origin types
Direct private endpoint connectivity is limited to App Service (Web App, Function App), Blob Storage, Storage static website, internal load balancers (and services that expose them such as AKS), API Management, Application Gateway and Azure Container Apps; it is not supported with App Service slots and Azure Static Web App.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/private-link#supported-origins

### Private Link regions
Private Link is available only in the listed regions, which have Availability Zone support (the list includes Germany West Central and Sweden Central); for an origin in an unlisted region the owner picks the next nearest listed region, which adds a network hop.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/private-link#region-availability

### The resource owner manages the connection state
Learn says Private Link works on an approval model in which the service provider (the owner of the Private Link resource) can approve, reject or remove each private endpoint connection on its resources; removing a connection leaves the private endpoint disconnected, and Learn says it should be deleted for cleanup. A connection that was rejected cannot be approved later: it has to be removed and created again.
- Source: https://learn.microsoft.com/en-us/azure/private-link/manage-private-endpoint#private-endpoint-connections

### Private Link: no mixed origin groups, and regional limits
Public and private origins cannot be mixed in one origin group; the error "Origin Group can only have origins with private links or origins without private links" can occur when Private Link is enabled for several public origins of one group at the same time, so one origin is converted at a time. Health probes of a Private Link origin follow the same network path as traffic. Each Front Door regional cluster is limited to 7,200 requests per second per profile (429 above it). Learn recommends several origins, each with a different Private Link region, in one origin group, so that traffic is spread and the group survives an unreachable regional cluster.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/private-link#frequently-asked-questions

### Configuration changes take up to 15 minutes to propagate
Learn says a single create, update, delete or WAF operation might take up to 15 minutes, back-to-back changes can extend it to about 30 minutes, each configuration update (routing changes and origin updates included) is a global operation, and operations submitted meanwhile are queued. Custom TLS certificate updates might take up to an hour. Updates to routes or origin groups do not cause downtime when the new configuration is correct. A failover that needs a configuration change is therefore not immediate, and the health-probe path is the one that needs no change (inference).
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/front-door-faq#what-is-the-estimated-time-for-deploying-an-azure-front-door-does-my-front-door-remain-operational-during-the-update-process

### A warm spare, and what Front Door does not do for the origin
Learn describes active-active (several stamps serve traffic) and active-passive (only the primary region handles traffic and fails over to the secondary), including an active-passive model with a warm spare: the secondary deploys with the minimum possible compute and data sizing, runs without load, and scales to handle the primary's load upon failover. It recommends redundant application instances that each expose an origin, and a health endpoint that aggregates the state of the critical services and dependencies the application needs. Front Door routes requests and does not scale, start or promote the origin or its data tier (inference), so the application and data tiers of the DR region come up through the playbooks of those services.
- Source: https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-front-door#reliability

### Certificates and Key Vault
Learn says Front Door managed certificates are the default choice for ease of operations; to manage the certificate lifecycle yourself, use your own certificates in custom domain endpoints and store them in Key Vault. A custom certificate in a Key Vault of the primary region ties that part of the ingress to that Key Vault's own DR (inference): the key-vault playbook covers it.
- Source: https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-front-door#security

### The WAF sits at the edge, in front of every origin
Learn says the web application firewall is integrated with Front Door, that WAF rules on the front ends protect applications at the network edge, that the WAF rule sets that detect and block malicious traffic are available on the Premium tier, and to test a WAF policy in detection mode for a few weeks and adjust false positives before deploying it. The policy is attached to the profile and not to an origin, so the DR origin sits behind the same one (inference from the edge placement).
- Source: https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-front-door#security

### Front Door itself is a potential single point of failure
Learn says Front Door is a globally distributed service that runs as a singleton in an environment, that it is a potential single point of failure, and that if it fails clients cannot access the application during the downtime. Redundant implementations can be complex and costly and are to be considered only for mission-critical workloads with a very low tolerance to outage.
- Source: https://learn.microsoft.com/en-us/azure/well-architected/service-guides/azure-front-door#reliability

### Redundant global routing has trade-offs
Learn says designs for platform-wide outages of the routing service are complex and costly, that in most situations the architecture is not needed, and that extra components can add failure points and lower overall reliability; it names financial cost, operational complexity (a new Front Door capability needs an equivalent on the alternate path), performance (extra CNAME lookups) and opportunity cost.
- Source: https://learn.microsoft.com/en-us/azure/architecture/guide/networking/global-web-applications/overview#tradeoffs

### Learn's alternate ingress path is a manual break-glass pattern
Learn's high-availability guide fails over manually from Front Door to an alternate content delivery network or to Application Gateway WAF instances in two regions through Azure Traffic Manager (weighted routing, endpoint monitoring off, DNS time to live of 300 to 600 seconds). It says not to configure the primary Traffic Manager for automatic failover because its probes originate only from US-based Azure regions, that Front Door managed certificates must be replaced with your own for the pattern, that Private Link origins are not recommended for it, and to test the failover endpoints quarterly. This protects against the loss of Front Door, not of an origin region, and is not an option of this playbook.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/high-availability#considerations-for-production-environments

### The access log names the origin (Standard and Premium)
For Front Door Standard and Premium the access log records the OriginName and OriginURL of the origin that received a request, the status code and the point of presence; OriginName and OriginURL are "N/A" when the request was served from the Front Door cache. The classic pivot of the same page lists a different schema, with BackendHostname (the backend the request was forwarded to) and no OriginName or OriginURL.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/standard-premium/how-to-monitor-metrics#access-log

### The health probe log holds failed probes (Standard and Premium)
Learn says Front Door logs every failed health probe request; the entries carry the OriginName and the origin IP address, and a Result field whose value is either success or a description of the error the probe received. Learn does not say whether successful probes are logged, so no step or criterion of this playbook relies on a success entry: "failed-probe entry" here means an entry whose Result is not success, and the origin health percentage metric is the other measure (inference). For classic the page lists diagnostic logs only, with no health probe log.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/standard-premium/how-to-monitor-metrics#health-probe-log

### The origin health percentage metric
For Standard and Premium (microsoft.cdn/profiles) Learn's metric Origin Health Percentage (OriginHealthPercentage) is the percentage of successful health probes from Front Door to backends, with the dimensions Origin and OriginGroup; for classic (microsoft.network/frontdoors) the metric is Backend Health Percentage (BackendHealthPercentage), with the dimensions Backend and BackendPool.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/monitor-front-door-reference#metrics

## Non-paired options

### global-origin-failover: Active-passive origin group with the DR origin in the DR region
- Kind: native
- Target: dr-region
- Uses mechanism: Priority-based traffic routing
- Estimated RPO: 0 (stateless tier; Front Door replicates no application data to a DR location, so the RPO of the data tier of the origins governs, which the playbooks of those services give and prove)
- Estimated RTO: 5m (Estimated, team-set starting value; TC-2 proves it; the switch-over target the team sets for the origin group: Learn's worked example evaluates the last five probe samples at a 30-second interval, a 150-second window, and the team sets the interval, the sample size and the successful samples required so that detection fits the target; Learn publishes no failover time for Front Door; the time to bring up the DR origin and its data tier is not in this figure)
- Prerequisites: Front Door Standard or Premium, or classic until its retirement on March 31, 2027 (Premium when the origin is reached with Private Link or when the WAF managed rule sets are needed); a DR origin in the DR region, from the same application version, as a warm spare that can scale, of the same kind as the primary origin (public or private, which cannot be mixed in one origin group), with its data tier promoted or promotable by the playbooks of those services; a health endpoint on the DR origin that returns 200 OK when it is ready to serve, on the protocol and port Front Door uses for client requests; the same host name handling as the primary and a certificate valid for the name Front Door uses; an access restriction that admits only this Front Door profile (Private Link approved for the DR origin in a Private Link region that the list supports, or the Front Door service tag and the X-Azure-FDID header); networking: the DR origin reachable from Front Door (a public IP address or publicly resolvable DNS name, or a private endpoint), with its own firewall, network security groups and DNS records in place; identity and RBAC: a role on the Front Door profile that allows updating origin groups and origins, a role that allows approving and removing private endpoint connections at the DR origin (and removing them at the pair-region origin at Decommission), and a read role on metrics and logs, each assigned to a team role and recorded in the runbook (Learn names no role on the pages read); DNS: the client-facing custom domain keeps pointing at the Front Door endpoint, so no client DNS change is part of this option (inference); the rules engine rules and the session affinity setting reviewed so that nothing pins traffic to the primary; diagnostic settings sending the logs of the profile's type to a workspace (Standard and Premium: the access log, the health probe log and the WAF log; classic: its diagnostic logs); the profile in infrastructure as code.
- Cost notes: the DR origin as a warm spare (compute and data tier of the DR region at minimum size, scaled up in DR); the health probe traffic that every edge location sends to the DR origin; Private Link and Premium when used; the logs sent to a workspace; no price.
- Gives up: instant failover (Front Door moves traffic mainly after the probes of the origin fail the health evaluation, and retries are best effort, so requests in flight during the switch can fail); the DR origin's data currency (Front Door replicates no data); Front Door as the single entry point stays a single point of failure that this option does not remove; traffic returns to the primary automatically when it is healthy again (it has the highest priority), before its data is current, unless the primary is held back; a configuration change used as a manual lever takes up to 15 minutes; session affinity cannot be relied on across a failover; when every origin is unhealthy Front Door routes to all of them.
- Recommended when: the workload is reached over HTTP or HTTPS through Front Door, the DR region is not the primary's pair (the origin group works the same when it is), the origin in the DR region can be run as a warm spare, and the team accepts that the data tier is replicated by other services and that Front Door itself has no DR here.
- Source: https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods#priority-based-traffic-routing

## Migration from a paired setup

### Recognise today's setup
Front Door has no paired setup of its own: the profile is global, so a paired DR shows as an origin group whose origins sit in the primary's region and in its pair. In an inventory, look for a profile of type microsoft.cdn/profiles (Standard or Premium; its SKU shows which) or microsoft.network/frontdoors (classic) with an origin group (backend pool in classic) of two or more origins whose priorities differ (for example 1 and 2: active-passive) or are equal with weights (active-active), and whose host names or Private Link resources resolve to resources in two regions, of which one is the primary's pair. For a Private Link origin its Private Link location, resource ID and group ID show the Private Link region (which is not necessarily the origin's own). A host name alone does not show a region: the region of each origin is read from the Azure resource behind it, and an origin outside Azure has none. A profile with one origin in the primary's region and health probes disabled has no Front Door-level DR: its DR, if any, is elsewhere (a DNS switch, Traffic Manager, another profile). The inventory cannot show whether the pair-region origin is a warm spare, whether its health endpoint reports real readiness, or how its data is replicated: those come from the playbooks of the services behind it. Record today's DR for the origin as Front Door origin failover to the pair when the priorities and origin regions show it, else as Unknown. The migration to a DR region that is not the pair adds one origin to the origin group: global-origin-failover is the only option.

### Build
1. global-origin-failover: inventory every profile, route and origin group: type, tier (Standard, Premium, classic), custom domains and their certificate source, the routes and the origin group each uses, each origin's type, host name, host header, priority, weight, enabled state and region (read from the resource behind it, or its Private Link location), the probe path, protocol, method and interval, the sample size and successful samples required, the session affinity setting, every rules engine rule that overrides the origin group, the WAF association, the diagnostic settings and the resource group location; this inventory is what TC-1 compares.
2. global-origin-failover: when the profile is classic, plan the migration to Standard or Premium first (classic retires on March 31, 2027); the steps below apply to each type with these differences: classic says "backend pool" for "origin group", sets session affinity at the frontend host and not at the origin group, has no Private Link (a Premium feature), and has the diagnostic logs and the BackendHealthPercentage metric instead of the health probe log, the WAF log and OriginHealthPercentage.
3. global-origin-failover: decide and assign the roles of the runbook, and record them in it: a role that updates origin groups and origins of the profile (the Failover and Failback steps that enable, disable or reprioritise an origin need it), a role that approves and removes private endpoint connections on the DR origin resource (and removes them on the pair-region origin resource at Decommission), and a read role on the Front Door metrics and logs; assign each to a team role, not to a person.
4. global-origin-failover: build the DR origin in the DR region by the playbooks of its services (App Service, Container Apps, AKS with an internal load balancer, Application Gateway, API Management, a storage static website, or an origin outside Azure): the same application version and host name handling, a certificate valid for the name Front Door uses, a warm spare at minimum size with a documented scale-up, and its data tier prepared for promotion by the playbook of that service.
5. global-origin-failover: build the DR origin's health endpoint: it aggregates the critical dependencies, answers 200 OK only when the DR origin is ready to serve (or, by an explicit design decision of the application owner, when its application tier is up while the failover steps promote the data tier), answers on the protocol and port Front Door uses for client requests, and is cheap to call because every edge location probes it; then decide the probe path, the method (HEAD unless the body is needed), the interval, the sample size and the successful samples required from the target the team sets (the 5m of the Estimated RTO; Learn's worked example is 30 seconds, sample size 5 and 3 successful samples) and from the probe volume the origin can take (about two requests per minute per edge location at 30 seconds).
6. global-origin-failover: set up the DR origin's access restriction as the primary's is: for a Private Link origin, enable Private Link in the nearest supported Private Link region and approve the private endpoint connection at the DR origin resource (convert one origin at a time, and never mix public and private origins in one group); for a public origin, allow the Front Door service tag and require the X-Azure-FDID header with the profile's identifier; check that the DR origin's firewall, network security groups and DNS let Front Door reach it, because the APIs do not validate reachability.
7. global-origin-failover: add the DR origin to the origin group, enabled, with the primary's weight and the origin host header and certificate name as the primary's, the primary staying at priority 1: when the paired setup has a pair-region origin (priority 2), it stays at priority 2 and the DR origin gets priority 3 (the range is 1 to 5, and the priorities differ), and Cut over swaps them after validation; when there is none, the DR origin gets priority 2; when the group had one origin and its probes were disabled, enable the probes with the settings of the Build step that builds the DR origin's health endpoint in the same change; allow up to 15 minutes for the change to propagate, and keep changes separate, because back-to-back changes can take about 30 minutes in all.
8. global-origin-failover: review what could bypass the failover: every rules engine rule that overrides the origin group or pins a path to the primary's origins, session affinity (turn it off unless the application cannot work without it, and then record the failover behaviour as a known gap), a route that does not use this origin group, and a custom certificate and its Key Vault (see the key-vault playbook for its DR).
9. global-origin-failover: turn on the diagnostic settings (Standard and Premium: the access log, the health probe log and the WAF log; classic: its diagnostic logs) and create Azure Monitor alerts on the origin health percentage of each origin (OriginHealthPercentage, or BackendHealthPercentage in classic) and, in Standard and Premium, on failed-probe entries for the DR origin (a DR origin that is silently unhealthy removes the DR it was built for); in this playbook "origin health percentage" means that metric, "origin name" in the access log means OriginName (BackendHostname in classic), the health probe log exists for Standard and Premium only, and it holds failed probes only; keep the profile's configuration in infrastructure as code so that every origin group change is a reviewed change.
10. global-origin-failover: run Validate; the pair-region origin stays as it is until Cut over.

### Validate
1. global-origin-failover: run TC-1 once, then weekly, and after every change to the profile, the origin group, the probe settings or the DR origin.
2. global-origin-failover: run TC-3 daily from the first day the DR origin is in the group, and keep it as an alert.
3. global-origin-failover: run TC-5 once, then monthly, and after every change to the origin's network, certificate or Front Door restriction.
4. global-origin-failover: run TC-2 as a drill, then quarterly, and after every change to the probe settings or the DR origin, with the pair-region origin (when there is one) disabled for the drill so that the DR-region origin is the next priority, enabled again afterwards, and compare the measured time with the Estimated RTO (the 5m target).
5. global-origin-failover: run TC-4 in a DR drill, and quarterly with TC-2, so that a full transaction runs through Front Door against the DR origin with its data tier promoted by the playbooks of those services.
6. global-origin-failover: run TC-6 as a drill with TC-2 (the hold on the primary and the failback), and quarterly.
7. global-origin-failover: complete TC-7 (the design check on Front Door itself) once, then yearly; record each result with its date: a time that a drill measured is Demonstrated, and everything else stays Estimated or Unknown.

### Cut over
1. global-origin-failover: after TC-1 to TC-6 passed, when a pair-region origin is in the group, first set the pair-region origin to priority 4 and then, as a separate change, the DR-region origin to priority 2 (waiting up to 15 minutes for each; the primary stays at priority 1, and no two origins ever share a priority, because origins with the same priority share the traffic by weight); when there is none, the DR origin already has priority 2 and nothing changes; run TC-1 and TC-3 again.
2. global-origin-failover: put the Failover and Failback steps for global-origin-failover into the runbook with the roles of the Build step that decides and assigns the roles of the runbook, the probe settings and the Estimated RTO target, and mark the origin's DR as Front Door origin failover to the DR region, validated by TC-1 to TC-6 and rehearsed in drills.
3. global-origin-failover: when the DR before the migration was outside Front Door (a DNS switch or another traffic manager), remove its steps from the runbook only after the first successful TC-2 drill on the new setup, and keep the decision of TC-7 in the runbook.

### Decommission
1. global-origin-failover: disable the pair-region origin (a disabled origin gets neither traffic nor probes) and watch the origin health percentage and the access log for one team-set review period; a request to it means a client or a rule still points at it.
2. global-origin-failover: remove the pair-region origin from the origin group and its probe alerts; then review the private endpoint connections at the pair-region resource that came from this profile and, using the role of the Build step that decides and assigns the roles of the runbook, remove those that no other origin of the profile uses (the same resource, group and region share one private endpoint; Learn says the owner of the Private Link resource can remove a connection, which leaves the endpoint disconnected, and says private endpoints are deleted when a profile is deleted but not that removing an origin removes its endpoint, so this is a design step).
3. global-origin-failover: reduce the pair-region application and data tier resources only by the playbooks of those services, and only after TC-1 to TC-6 passed on the new setup.
4. global-origin-failover: remove old DNS or Traffic Manager entries that pointed at the pair region, when there were any.

### Keep until cut-over
The pair-region origin stays enabled in the origin group at its current priority, with its probes, access restriction, private endpoint approval and application and data tier in the pair region, until TC-1 to TC-6 have passed for the DR-region origin and the cut-over change is verified. The runbook of the existing DR, and any DNS or Traffic Manager switch, stay too. Nothing else in the Front Door profile is removed by this migration.

## Failover and failback

The failover of this option is done by Front Door from the customer's origin group, priority and probe settings; it is not a Microsoft-managed failover, and the customer can rehearse it (see the constraint "Health-based failover is built in").

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary origin is failing (origin health percentage, user-facing errors and, in Standard and Premium, the failed-probe entries of the health probe log) and declare DR for the workload | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time, and the origin health percentage of the primary origin has dropped (in Standard and Premium the health probe log shows failed probes of the primary origin from the edge locations, not only of one probe path) | The origin health percentage of the primary origin is normal and the error rate is normal: this is not an origin failure, stop |
| 2 | global-origin-failover: bring the DR origin to serving state: scale its compute to production capacity and promote its data tier by the playbooks of those services, so that its health endpoint reports ready | Application engineer | Estimated unknown (the compute and data tier steps of those playbooks; measured in the first drill) | The DR origin's health endpoint answers 200 OK from the DR network, and a test write and a test read succeed | The data tier cannot be promoted: the application owner decides between a read-only mode or a maintenance response and waiting, records the decision, and the primary origin is not disabled |
| 3 | global-origin-failover: when the DR origin is a Private Link origin, check that its private endpoint connection is Approved and that probes reach it | Network engineer | Estimated unknown (Learn: a few minutes to establish a connection after approval; the connection was approved in Build, so this is a check) | The connection state is Approved and the origin health percentage of the DR origin is 100 percent, with no failed-probe entry for it in the health probe log | The connection is pending: approve it with the role of the Build step that decides and assigns the roles of the runbook and recheck. The connection is rejected: a rejected connection cannot be approved, so remove it with the same role, create the private endpoint request again from the origin's Private Link setting, approve the new connection and recheck. If it stays unavailable, stop and escalate to the application owner, because the DR origin cannot take traffic |
| 4 | global-origin-failover: wait for Front Door to move traffic by its health evaluation; watch the origin health percentage and the access log | Platform engineer | Estimated 5m (the switch-over target the team sets; TC-2 proves it) | New requests in the access log show the DR origin's name (OriginName; BackendHostname in classic), the primary origin receives no new requests, and a request through the Front Door host name succeeds | After the target the traffic is still on the primary or errors persist: go to the failover step that disables the primary origin or gives the DR origin the lower priority number |
| 5 | global-origin-failover: when traffic has not moved and the DR origin is healthy, disable the primary origin in the origin group, or give the DR origin a lower priority number than the primary after recording both original priorities; a disabled origin gets no routing and no probes | Platform engineer | Estimated 15m (Learn: a single configuration change can take up to 15 minutes to propagate) | The origin group shows the primary disabled (or the DR origin at the lower priority number) and the access log shows no requests to the primary | The DR origin is not healthy: do not disable the primary (Learn: when every origin fails its probes Front Door routes to all of them); fix the DR origin first |
| 6 | global-origin-failover: hold the DR: keep the primary origin disabled or at a higher priority number than the DR origin (skip when the failover step that disables the primary origin or gives the DR origin the lower priority number did it) so that a recovering primary does not take traffic back before its data is current | Platform engineer | Estimated 15m (the same propagation as the failover step that disables the primary origin or gives the DR origin the lower priority number) | The origin group shows the primary disabled or at the higher priority number | The DR origin becomes unhealthy while the primary is disabled: enable the primary and escalate to the application owner |
| 7 | global-origin-failover: run a full transaction through the Front Door host name (sign in, read, write, TLS certificate, WAF allowed) and check the error rate and latency | Application engineer | Estimated unknown (measured in the first drill) | The transaction passes, the TLS certificate is valid for the host name, and the error rate stays within the baseline the application owner set | A step fails: stop the function that fails, keep the rest in DR and record the gap for the application owner |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region and the primary origin are available again and that its data is current again by the playbooks of those services | Incident manager | Estimated unknown (measured in the first drill) | The primary origin's health endpoint answers 200 OK from a test client and the primary's data tier is current | The primary is still failing or its data is not current: stay in DR with the primary held back |
| 2 | global-origin-failover: run a test transaction against the primary origin directly (while the primary is disabled in Front Door, Front Door sends no probes to it) | Application engineer | Estimated unknown (measured in the first drill) | The transaction passes with the primary's own certificate and data | The transaction fails: stay in DR |
| 3 | global-origin-failover: enable the primary origin when it was disabled, and restore the priorities recorded in the failover step that disables the primary origin or gives the DR origin the lower priority number (the primary at its original priority, the DR origin back at its standby priority) when they were changed | Platform engineer | Estimated 15m (Learn: a single configuration change can take up to 15 minutes to propagate) | The origin group shows the primary enabled at its original priority, and the origin health percentage of the primary is 100 percent with no failed-probe entry for it in the health probe log after the change | The origin health percentage of the primary does not recover: disable the primary again (or give the DR origin the lower priority number again) and stay in DR |
| 4 | global-origin-failover: confirm that traffic returns to the primary (the highest priority healthy origin) and watch the error rate and latency for the observation period that the application owner sets | Platform engineer | Estimated unknown (the observation period the application owner sets) | The access log shows the primary's name (OriginName; BackendHostname in classic) for new requests, and the error rate stays within the baseline | The error rate rises above the baseline: disable the primary again (propagation up to 15 minutes) and stay in DR |
| 5 | global-origin-failover: return the DR origin to standby: scale it down by its playbook, turn the replication of its data tier back toward the DR region by the playbooks of those services, and keep the DR origin enabled at its lower priority with a health endpoint that answers 200 OK | Application engineer | Estimated unknown (the scale-down and re-replication steps of those playbooks) | TC-3 passes again (the origin health percentage of the DR origin is 100 percent, with no failed-probe entry) and TC-1 shows no differences | The DR origin is not healthy as a standby: keep it at full size until it is |
| 6 | Record the measured times of the event or drill in the runbook (a time that a drill measured is Demonstrated) and review the origin group, the probes and the alerts | Incident manager | Estimated unknown (measured in the first drill) | The record holds the times and the access log excerpt | The record is incomplete: repeat the review before the next drill |

## Test criteria

### TC-1: The origin group is built as designed
- Applies to: global-origin-failover
- Pass condition: zero differences between the recorded design and the profile for every item of this list: the DR origin exists in the origin group, is enabled, is of the same kind (public or private) as the primary, and has a priority number greater than the primary's, within 1 to 5; the probe path, protocol, method, interval, sample size and successful samples required equal the runbook values; probes are enabled; no rules engine rule overrides the origin group or pins a path to the primary's origins; session affinity is off or recorded as a known gap; the origin host header and the certificate name check are as designed; for a Private Link origin the private endpoint connection of the DR origin is Approved and its Private Link region is one the list supports.
- How to measure: read the profile, route, origin group, origin and rules engine configuration with a read-only query or the portal, and compare it with the inventory of the Build step that inventories every profile, route and origin group and the runbook values, item by item.
- Evidence: the exported configuration with its date, the difference list (expected empty) and the runbook values it was compared with; for a classic profile the same list for the backend pool.
- Frequency: weekly, and after every change to the profile, the origin group, the probe settings or the DR origin

### TC-2: Traffic moves to the DR origin within the Estimated RTO
- Applies to: global-origin-failover
- Pass condition: in a drill with the pair-region origin (when there is one) disabled and the primary origin's health endpoint made to answer a non-200 status (or the primary origin stopped in a non-production copy), the time from the moment the drill makes the primary fail (the drill's own timestamp; in Standard and Premium the first failed-probe entry of the health probe log is the same moment seen by Front Door) to the first request served by the DR origin in the access log (OriginName; BackendHostname in classic) is below the Estimated RTO target of the option (5m), no new request is served by the primary after that, and the origin health percentage of the DR origin stays at 100 percent throughout.
- How to measure: a drill that fails the primary origin's health endpoint and records its own start time, the last request to the primary and the first request to the DR origin (access log, with a non-cacheable synthetic request every 10 seconds through the Front Door host name, because OriginName and OriginURL are "N/A" for a request served from the cache, and HttpStatusCode), the first failed-probe entry of the health probe log in Standard and Premium, and the origin health percentage of the DR origin; the drill also counts the failed requests during the switch.
- Evidence: the drill record with its timestamps, the two log excerpts, the count of failed requests during the switch and the measured time (Demonstrated).
- Frequency: quarterly, and after every change to the probe settings or the DR origin

### TC-3: The DR origin is healthy as a standby
- Applies to: global-origin-failover
- Pass condition: over the last 24 hours the health probe log (Standard and Premium) holds no failed-probe entry for the DR origin, outside a maintenance window that the team records, and the origin health percentage of the DR origin (OriginHealthPercentage; BackendHealthPercentage in classic, which has no health probe log) for the same period is 100 percent; an alert fires within the evaluation window set in its rule when the metric of the DR origin falls below 100 percent.
- How to measure: query the health probe log by OriginName for the DR origin and read the origin health percentage metric for it; test the alert once by failing the DR origin's health endpoint briefly in a non-production copy.
- Evidence: the query output with its date, the metric chart for the period and the alert test record.
- Frequency: daily

### TC-4: A full transaction runs on the DR origin with its data tier
- Applies to: global-origin-failover
- Pass condition: with the primary disabled in a drill, a synthetic transaction through the Front Door host name (sign in, a read, a write, and the file or API call that the application owner lists) succeeds on the DR origin with its data tier promoted by the playbooks of those services, the TLS certificate is valid for the host name, the WAF does not block it, and the data written in the transaction is the data that the application owner expects (the Estimated RPO of the data tier is checked in the playbook of that service, not here).
- How to measure: a scripted transaction run through the Front Door host name during the drill, with the access log checked for the DR origin's name and the HTTP status codes, and the WAF log checked for blocks.
- Evidence: the script output with its date, the access log excerpt and the application owner's sign-off on the data check.
- Frequency: quarterly with TC-2, and after every release that changes how the application is called

### TC-5: The DR origin accepts Front Door and refuses everything else
- Applies to: global-origin-failover
- Pass condition: a request that reaches the DR origin through Front Door is accepted, and a request sent to the DR origin's address directly (without Front Door, or with another profile's identifier) is refused; for a Private Link origin the private endpoint connection of the DR origin is Approved and the public endpoint is closed as designed; the DR origin's certificate is valid for the name Front Door uses and is not inside the renewal window of its own policy.
- How to measure: send one request through the Front Door host name, one to the origin's address from an unrelated client, and one with a wrong X-Azure-FDID header (or from outside the Private Link path), and read the private endpoint connection state and the certificate dates of the DR origin.
- Evidence: the three results with their date, the connection state and the certificate expiry date.
- Frequency: monthly, and after every change to the origin's network, certificate or Front Door restriction

### TC-6: The hold on the primary and the failback act within the propagation time
- Applies to: global-origin-failover
- Pass condition: after the primary origin is disabled in the origin group (or given a higher priority number than the DR origin), the access log shows no new request to it within 15 minutes (Learn's figure for one configuration change), and none for the whole hold period of the drill while its health endpoint answers 200 OK; after it is enabled (and its priority restored), the access log shows new requests to it within 15 minutes and its origin health percentage is 100 percent with no failed-probe entry in the health probe log; the time of each step is recorded.
- How to measure: during the drill, change the primary origin's enabled state or priority, record the time of each change, and read the access log (OriginName; BackendHostname in classic) every minute until the change shows, with the origin health percentage and, in Standard and Premium, the health probe log for the primary.
- Evidence: the drill record with the change times, the access log excerpts for the hold and the return, and the measured times (Demonstrated).
- Frequency: quarterly with TC-2

### TC-7: Front Door itself is a recorded decision (design check, not drillable)
- Applies to: global-origin-failover
- Pass condition: a design check, not drillable: the customer cannot rehearse a failure of the Front Door service, so the check passes when the runbook records, with an owner and a date, the decision to accept Front Door as a single entry point or to build an alternate ingress path (Learn's manual Traffic Manager pattern), the profile's configuration is in infrastructure as code that can recreate it, the resource group location of the profile is recorded, and the origin's own host name and access path are documented so that an alternate path could reach it.
- How to measure: review the runbook, the infrastructure as code repository and the profile's resource group; where an alternate path exists, test its manual failover in a non-production setup, as Learn recommends (quarterly for the alternate path).
- Evidence: the review record with its date and the decision record; for an alternate path, its test record.
- Frequency: yearly, and after every change to the entry architecture
