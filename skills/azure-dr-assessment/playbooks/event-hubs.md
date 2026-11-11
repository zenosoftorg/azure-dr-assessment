---
service: event-hubs
title: Azure Event Hubs
arm_types:
  - microsoft.eventhub/namespaces
slot: data-replication.messaging
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs
  - https://learn.microsoft.com/en-us/azure/event-hubs/geo-replication
  - https://learn.microsoft.com/en-us/azure/event-hubs/use-geo-replication
  - https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-geo-dr
  - https://learn.microsoft.com/en-us/azure/event-hubs/configure-geo-disaster-recovery
  - https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-federation-overview
  - https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-federation-patterns
  - https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-federation-replicator-functions
  - https://learn.microsoft.com/en-us/azure/event-hubs/move-across-regions
  - https://learn.microsoft.com/en-us/azure/event-hubs/private-link-service
  - https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-quotas
  - https://learn.microsoft.com/en-us/azure/event-hubs/authorize-access-azure-active-directory
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/permissions/integration
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged
---

# Azure Event Hubs

## Mechanisms

### Geo-replication
- Replicates: metadata (entities, configuration and properties) and event data of the namespace, continuously, from a primary region to one or more secondary regions; the namespace hostname always points to the current primary
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: unknown (Learn gives no figure for the asynchronous mode: its comparison table says "RPO > 0, possible data loss on promotion" and that offsets stay within the maximum replication lag configured for the namespace, so the asynchronous RPO is bounded by the lag that the team configures; synchronous mode is a separate statement, "RPO 0, no data loss on promotion", and the option states which mode its number covers — https://learn.microsoft.com/en-us/azure/event-hubs/geo-replication#replication-modes)
- Estimated RTO: 10m (the upper end of Learn's "about 5 to 10 minutes" for a promotion, which "can sometimes take longer" for DNS; another Learn page says under two minutes, see the constraint on promotion duration, so the stricter figure is used; TC-3 measures it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#geo-replication

### Metadata geo-disaster recovery
- Replicates: metadata only (event hubs, consumer groups and their settings; schema registry metadata but not the schemas), continuously and asynchronously from a primary namespace to a secondary namespace behind one alias; event data is not replicated
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: unknown (event data is not replicated, so events in the primary namespace at the time of the disaster are not in the secondary; metadata replication is asynchronous and Learn publishes no lag figure)
- Estimated RTO: 10m (the upper end of Learn's "typically within 5 to 10 minutes", which "can take longer" for DNS; another Learn page says "nearly instantaneous", see the constraint on failover duration, so the stricter figure is used; TC-3 measures it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#metadata-geo-disaster-recovery

### Zone redundancy
- Replicates: configuration, metadata and event data across three availability zones of one region, synchronously; an in-region mechanism that does not protect against the loss of the region
- Paired: no
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: 0 (Learn: "No data loss occurs during a zone failure because Event Hubs synchronously replicates events across zones before acknowledgment")
- Estimated RTO: unknown (Learn: a zone failure "might cause a few seconds of downtime"; no figure is published)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#resilience-to-availability-zone-failures

## Constraints

### Microsoft never fails over or promotes for the customer
Learn states that geo-replication and metadata geo-disaster recovery "require you to manually initiate failover or promotion of a secondary region to become the new primary region", and that Microsoft doesn't perform it automatically, "even if your primary region is down". Microsoft doesn't automatically notify the customer that a region is down either; Learn names Azure Service Health and Service Health alerts. A runbook, an owner and a monitoring signal are therefore part of the design.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#resilience-to-region-wide-failures

### The tier decides which mechanism exists
Learn's feature table lists geo-replication for Premium and Dedicated only, geo-disaster recovery for Standard, Premium and Dedicated, and neither for Basic; it lists private link as not available on Basic as well. A Basic namespace has no built-in DR mechanism and a Standard namespace has no geo-replication, so a customer-built pattern is what remains for Basic (inference from the table).
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-quotas#basic-vs-standard-vs-premium-vs-dedicated-tiers

### Geo-replication works with any region that supports Event Hubs
Learn: "You can choose any Azure region that supports Event Hubs as your primary region or secondary regions. You don't need to use Azure paired regions", so the secondary can be chosen for latency, compliance or data residency.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#requirements-1

### Metadata geo-disaster recovery works with any region that supports Event Hubs
Learn says the same for the primary and the secondary namespace of metadata geo-disaster recovery: any Azure region that supports Event Hubs, no need for paired regions.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#requirements-2

### Geo-replication regions, tier and distance
Geo-replication needs primary and secondary regions where the feature is enabled, and primary and secondary copies on the same tier (not across tiers). A secondary on another continent has "a major impact on replication lag"; for availability Learn advises secondary regions on the same continent where possible, so a DR region outside the pair is acceptable only when the lag it causes fits the replication mode the team chooses (inference).
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/geo-replication#secondary-region-selection

### Geo-replication needs clusters or processing units in each region and both regions are paid for
For Dedicated, at least two dedicated clusters in separate regions are needed (they can host other namespaces) and enabling geo-replication adds a bandwidth charge for replicated data; for Premium the secondary region gets the same number of processing units as the primary, and the bandwidth for replicated data is charged. This playbook quotes no price.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/geo-replication#pricing

### Metadata geo-disaster recovery pays for both namespaces
Learn: "When you enable metadata geo-disaster recovery, you pay for both the primary and secondary namespaces."
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#cost-2

### Synchronous and asynchronous replication trade latency and availability
With synchronous replication every request is committed in the secondary before the primary commits: latency is longer, availability depends on two regions, and if the secondary lags or is unavailable the primary does not acknowledge or commit and throttles incoming requests (Learn's comparison table: no data loss on promotion). With asynchronous replication the primary commits first and the team sets a maximum replication lag; beyond it the primary throttles incoming requests, and data loss or duplication might occur. Event hubs (top-level entities) are replicated synchronously in both modes. To keep using the namespace when a secondary lags or is unavailable, remove that secondary. The mode can be switched later; from asynchronous to synchronous the secondary becomes synchronous once the lag reaches zero, which can require pausing publishers.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/geo-replication#replication-modes

### The secondary of geo-replication cannot be used
Learn: "You can't read or write on the secondary regions" and "you can't interact with the secondary region". So the secondary can be observed through metrics, and its content can be checked only after a promotion (inference).
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/geo-replication#basic-concepts

### Planned and forced promotion
A planned promotion waits for the secondary to catch up, which eliminates data loss but introduces downtime, and during a region outage it might not be possible because it needs all regions to be available. A forced promotion does not wait for replication: with synchronous replication no data loss is expected, with asynchronous replication recent events not yet replicated might be lost, and Learn says lost data cannot be recovered even after the primary region becomes available. The primary does not accept write operations during the promotion.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#behavior-during-a-region-failure

### Starting a geo-replication promotion
A promotion is started in the portal (the failover icon, then planned or forced, then the word "promote"); you can select forced after starting a planned promotion, and a forced promotion is still possible when the primary region goes down completely. For a planned promotion, once it is initiated the new primary rejects any new events until the failover is completed; promotion needs no change to clients.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/use-geo-replication#promote-secondary

### Geo-replication promotion takes about 5 to 10 minutes
The reliability article says the promotion process typically takes about 5 to 10 minutes after replication completes, and that DNS entries can take longer to update and fully replicate to clients. After the promotion the namespace FQDN points to the new primary region, subject to the DNS time-to-live of the clients' servers.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#behavior-during-a-region-failure

### One Learn page gives a shorter geo-replication promotion time
The geo-replication article's private endpoint section says "Promotion typically completes in under two minutes, during which clients might see transient errors and reconnect" and asks for a retry policy. It differs from the 5 to 10 minutes of the reliability article; this playbook uses the stricter 5 to 10 minutes for its estimates and treats the shorter time as a best case that a drill can show.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/geo-replication#private-endpoints

### Consumers: offsets, checkpoints and the checkpoint format
Consumer operations aren't supported from the moment promotion starts until it finishes. With Kafka clients (Apache Kafka or librdkafka 2.1.0 or later, and the API versions Learn lists) offsets are committed to Event Hubs and replicated, so consumers resume where they left off. With the Event Hubs SDK and AMQP the application keeps its own checkpoint store (for example Azure Blob storage), and after a failover the secondary region must have the checkpoint store. Checkpoints written after the pairing use a new format, and a forced promotion right after pairing but before a new checkpoint is stored can lose new data published after promotion. After a forced promotion offsets can differ across regions, consumers start from the last committed offset, and duplicate processing must be handled on the client side.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/geo-replication#consuming-data

### Metadata geo-disaster recovery does not replicate data, so offsets cannot be reused
By design no data is replicated, so the old offset of the primary cannot be reused on the secondary: restart receivers with EventPosition.FromStart(), FromEnd() or FromEnqueuedTime(dateTime). Active sessions are not replicated, and duplicate detection and scheduled messages "might not work" (new sessions, new scheduled messages and new duplicates work). Synchronising entities takes "approximately 50-100 entities per minute". The data plane of the secondary is read-only while the pairing is active (GET requests are accepted to validate client connectivity and access controls), and some management-plane aspects of the secondary are read-only.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-geo-dr#failover-considerations

### Metadata geo-disaster recovery failover duration differs between two Learn pages
The geo-disaster recovery article says "The failover is nearly instantaneous once initiated". The reliability article says "typically occurs within 5 to 10 minutes" and that clients can take longer to update DNS entries (see the Metadata geo-disaster recovery mechanism). This playbook uses the stricter 5 to 10 minutes.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-geo-dr

### Metadata geo-disaster recovery is one-way and fail-forward
Failing over activates the secondary namespace and removes the primary namespace from the pairing. Learn requires two things afterwards: set up another passive namespace and update the pairing so a further failover is possible, and pull messages from the former primary once it is available again, then use it for regular messaging or delete it. Only fail-forward semantics are supported: failing back to the previous primary replica isn't supported.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/configure-geo-disaster-recovery#initiate-failover

### Only new namespaces can be added to a pairing
Learn: "Only new namespaces can be added to your failover pairing." The secondary can be created beforehand or while creating the pairing.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/configure-geo-disaster-recovery#set-up-geo-disaster-recovery-pairing

### Returning to the original region after a metadata geo-disaster recovery failover
The reliability article describes it as a new pairing with the recovered region as secondary and another failover, with potential data loss of events sent to the temporary primary. Unless the disaster caused the loss of all zones, event data left in the old primary is recoverable once access is restored; if all zones used by the primary were lost, the data might be unrecoverable, and Microsoft doesn't restore events into the secondary. The previous constraints say only new namespaces can be paired and failback to the previous primary replica isn't supported, so this playbook follows the stricter reading: a new namespace is created in the original region and paired.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#region-recovery-1

### Role assignments are not replicated by metadata geo-disaster recovery
Microsoft Entra RBAC assignments to entities in the primary namespace "aren't replicated to the secondary namespace"; they are created manually in the secondary. Learn's geo-replication article does not say how role assignments behave for a geo-replicated namespace.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-geo-dr#role-based-access-control-rbac

### Private endpoints with metadata geo-disaster recovery
A pairing between a primary with a private endpoint and a secondary without one fails; it succeeds only if both have private endpoints, and the validation checks only that an endpoint exists on the secondary, not that it works after failover (the customer's responsibility). With an existing pairing, creating a private endpoint on the primary fails until one exists on the secondary. Learn's recommended configuration is private endpoints for both namespaces in the virtual networks that host both application instances, so that application-only failover and namespace-only failover both work.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-geo-dr#private-endpoints

### Private endpoints with geo-replication
Clients behind a private endpoint connect to the new primary after promotion without a change. Private endpoints are regional, so Learn advises a private endpoint in each region's virtual network, one privatelink.servicebus.windows.net private DNS zone per region linked to that region's network only (a shared zone holds one A record and then needs cross-region virtual network peering), and for on-premises clients conditional forwarding or a manually maintained record; promotion needs no on-premises DNS change.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/geo-replication#private-endpoints

### A private endpoint sits in its network's region
The private endpoint and its virtual network must be in the same region, while the namespace can be in another region; the person creating it needs Owner or contributor permissions on the namespace and on the virtual network.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/private-link-service#prerequisites

### The secondary has to carry the full load
Learn says both regions need capacity for the full load if one region fails, that the passive secondary of metadata geo-disaster recovery must immediately handle traffic after failover, and that capacity provisioned in advance reduces downtime (scaling during or after the failover adds downtime).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#capacity-planning-and-management

### Customer-built replication is Learn's answer where the built-in features do not fit
Learn says some tiers don't support geo-replication or geo-disaster recovery, a team might need custom replication or several active regions at once, and many patterns deploy multiple namespaces and use services such as Azure Functions to replicate events between them.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#custom-multiregion-solutions-for-resiliency

### Customer-built replication does not make exact clones
Replication through Azure Functions or Azure Stream Analytics "doesn't aim to assure the creation of exact 1:1 clones". It preserves the relative order of events that share a partition key; offset, enqueue time and sequence number are replaced by new service-assigned values in the target (the sample helpers keep the originals in the repl-enqueue-time, repl-sequence and repl-offset user properties), so a consumer finds its position with time-based positions and not with the old offset.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-federation-patterns#replication

### One-way replication is a one-way failover; merge is two-way
Pure replication is unidirectional: after producers and consumers switch, the old primary no longer receives new events and is abandoned, and a new secondary has to be created in another region. The merge pattern replicates between two or more event hubs, annotating events so that the replication target ignores them, and the event hubs hold the same events in an eventually consistent fashion; their contents are not identical and the absolute order may differ.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-federation-overview#resiliency-against-regional-availability-events

### Customer-built failover needs identical namespaces and a switch signal
Learn assumes the namespaces are structurally identical (identically named event hubs and consumer groups, shared access signature or RBAC rules set up the same way; the guidance for moving namespaces, without its cleanup step, creates and updates the secondary). Producers and consumers learn which namespace to use from a location that is easy to reach and update, for example DNS SRV records in a DNS the customer controls (Azure DNS is globally replicated) or a plain-text file with only the endpoint name, never a connection string. Event Hubs doesn't allow its endpoints to be aliased directly with CNAME records, so DNS is a lookup for endpoint addresses.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-federation-patterns#failover

### Event Hubs is not a backup; Capture keeps copies in storage
Event Hubs isn't designed as a long-term storage location. To keep a copy of events Learn points to Event Hubs Capture, which saves copies to an Azure Blob Storage account, and to the retention period set per event hub and tier.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#backup-and-restore

### Data-plane access is granted with Azure RBAC roles
Learn's built-in data-plane roles are Azure Event Hubs Data Owner, Azure Event Hubs Data Sender and Azure Event Hubs Data Receiver. A DR namespace is a separate scope, so its identities need their own assignments (inference from RBAC scoping).
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/authorize-access-azure-active-directory#azure-built-in-roles-for-azure-event-hubs

### Promotion and failover are control-plane actions that Learn names but assigns to no built-in role
Learn's permission list for Microsoft.EventHub names Microsoft.EventHub/namespaces/failover/action ("Failover Namespace Resource") and, for the pairing, Microsoft.EventHub/namespaces/disasterRecoveryConfigs/failover/action ("Invokes a GEO DR failover and reconfigures the namespace alias to point to the secondary namespace"), plus breakPairing/action, write, read and delete (delete "can only be invoked via the primary namespace"). Learn's Event Hubs articles name no built-in role for starting a promotion or failover. That the namespaces/failover action is the one a geo-replication promotion uses is an inference from its name, which the first drill confirms.
- Source: https://learn.microsoft.com/en-us/azure/role-based-access-control/permissions/integration#microsofteventhub

### Role Based Access Control Administrator writes role assignments
Learn describes the built-in role Role Based Access Control Administrator as managing "access to Azure resources by assigning roles using Azure RBAC"; its actions include creating a role assignment at the specified scope (Microsoft.Authorization/roleAssignments/write), and it includes the `*/read` action for the control plane. The role page lists an assignable scope of "/"; a narrower scope is this playbook's design.
- Source: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged#role-based-access-control-administrator

## Non-paired options

### geo-replication: Geo-replication to a secondary in the DR region
- Kind: native
- Target: dr-region
- Uses mechanism: Geo-replication
- Estimated RPO: 5m (asynchronous mode; Estimated, team-set starting value, TC-1 proves it. Learn gives no figure for asynchronous mode and states "RPO > 0, possible data loss on promotion" with offsets within "the maximum replication lag configured for the namespace", so the number is the maximum replication lag that the team configures, and a forced promotion may lose events within that lag. Synchronous mode is a separate statement: Learn says "RPO 0, no data loss on promotion", and the runbook records which mode applies — https://learn.microsoft.com/en-us/azure/event-hubs/geo-replication#replication-modes)
- Estimated RTO: 10m (the upper end of Learn's "about 5 to 10 minutes", plus for a planned promotion a catch-up that can take up to the replication lag; one Learn page says under two minutes, the stricter figure is used; TC-3 measures it — https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#geo-replication)
- Prerequisites: a Premium or Dedicated namespace; a DR region where geo-replication is enabled; for Dedicated a dedicated cluster in the DR region too, for Premium the same number of processing units there; capacity for the full load; a replication mode decided with the data owner and, for asynchronous, a maximum replication lag; Application Metrics logs; applications that use the namespace hostname, retry with exponential backoff and process events idempotently; Kafka clients at the versions Learn lists or the latest SDKs, and for AMQP consumers a checkpoint store reachable from the DR region; for private access a private endpoint and a privatelink.servicebus.windows.net zone per region, linked to that region's network only; role assignments for the DR workload identities (Azure Event Hubs Data Sender and Data Receiver) and a role for the promotion operators (decided and recorded in the runbook, because Learn names none).
- Cost notes: the secondary's compute (processing units for Premium, a dedicated cluster for Dedicated), bandwidth for replicated data, the private endpoints and Application Metrics logs; no price.
- Gives up: a secondary that cannot be read, written or tested without a promotion; with synchronous replication, write availability that depends on both regions and longer latency; with asynchronous replication, possible loss and duplication on a forced promotion (lost data cannot be recovered afterwards) and throttling when the lag reaches its maximum; a promotion that needs a human decision and takes minutes; Premium or Dedicated cost for a namespace that might run on Standard.
- Recommended when: the namespace is Premium or Dedicated, event loss must be bounded (zero with synchronous replication), and the DR region supports the feature, whether or not it is the primary's pair.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#geo-replication

### metadata-geo-dr: Metadata geo-disaster recovery pairing with a namespace in the DR region
- Kind: workaround
- Target: dr-region
- Uses mechanism: Metadata geo-disaster recovery
- Estimated RPO: unknown (event data is not replicated, so no RPO exists for events: the events in the primary at the time of the disaster are not in the secondary and are recoverable from the old primary only when access is restored, and metadata replicates asynchronously with no published lag; a team-set number would describe the application's own recovery of events and not this mechanism, so it stays unknown until the application owner records the accepted loss in TC-4)
- Estimated RTO: 10m (the upper end of Learn's "typically within 5 to 10 minutes"; another Learn page says "nearly instantaneous", the stricter figure is used; consumers also restart at a position they choose; TC-3 measures it — https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#metadata-geo-disaster-recovery)
- Prerequisites: a Standard, Premium or Dedicated primary and a new secondary namespace in the DR region on a supported tier pair (not in the same dedicated cluster); the secondary's capacity provisioned for the full load; private endpoints on both namespaces in the networks that host both application instances (the secondary first when a pairing exists); role assignments created by hand on the secondary (Azure Event Hubs Data Sender and Data Receiver) and a role for the operators who run the pairing and failover (decided and recorded in the runbook, because Learn names none); applications that connect through the alias and start receivers at an explicit event position; a checkpoint store reachable from the DR region for AMQP consumers; monitoring that supports the decision to fail over (Learn's example: connectivity lost for longer than 15 to 20 minutes); a plan to pair a new namespace after a failover.
- Cost notes: both namespaces are paid for; the secondary's capacity, its private endpoints and the monitoring; no price.
- Gives up: event data that was not yet consumed in the primary at the time of the disaster (no data replication); a secondary whose data plane is read-only for the whole pairing; a one-way failover with no failback to the old pairing and a new pairing to build afterwards; active sessions and the state of duplicate detection and scheduled messages; role assignments that must be kept in step by hand.
- Recommended when: the namespace is Standard (no geo-replication), or the team accepts losing in-flight event data, and the application can restart receivers at a chosen position and quickly resume sending new events.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-event-hubs#metadata-geo-disaster-recovery

### active-active-namespaces: Two namespaces with customer-built event replication
- Kind: workaround
- Target: dr-region
- Uses mechanism: none
- Estimated RPO: 15m (Estimated, team-set starting value; TC-6 proves it. It is the lag target of the customer-run replication tasks; Learn publishes no figure for the Azure Functions or Azure Stream Analytics patterns, and an event that exists in only one namespace when it is lost is lost)
- Estimated RTO: 10m (Estimated, team-set starting value; TC-7 proves it. It is the switch-over target that the team sets for clients to read the endpoint lookup and reconnect; Learn publishes no figure)
- Prerequisites: a second namespace in the DR region that is structurally identical to the first (event hubs, consumer groups, authorization or RBAC rules); a replication host in Azure Functions (stateless copy) or Azure Stream Analytics (stateful) with a managed identity that holds Azure Event Hubs Data Receiver on the source and Data Sender on the target; an endpoint lookup that clients consult (DNS SRV records in a DNS the team controls, or a file with only the endpoint name) and a role to change it, decided and recorded in the runbook; clients that keep a checkpoint store per namespace and start by timestamp; private endpoints, DNS zone links and capacity in the DR region; a decision between one-way replication and the merge pattern.
- Cost notes: the second namespace, the replication host (a consumption plan scales to zero but wakes slowly), traffic between the regions, the private endpoints and the monitoring; no price.
- Gives up: Microsoft-built replication of offsets and exact event copies (offset, enqueue time and sequence number differ in the target); ordering across partition keys; a published lag figure; the team owns, patches and monitors the replication code, and with pure replication the failover is one-way.
- Recommended when: the namespace is on a tier without geo-replication or geo-disaster recovery (Basic), or both regions must accept events at the same time, or events must be transformed on the way.
- Source: https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-federation-overview#resiliency-against-regional-availability-events

## Migration from a paired setup

### Recognise today's setup
Event Hubs has no Microsoft-managed failover to a paired region: both built-in features are manual and accept any region (see Constraints). A paired setup is therefore one that a team built with the pair as the secondary. In an inventory of microsoft.eventhub/namespaces it shows as one of these: (a) a Premium or Dedicated namespace whose Geo-replication configuration lists a secondary location equal to the pair of the primary region (portal: Geo-replication blade, which also shows the mode and the maximum lag); (b) a namespace with a geo-disaster recovery configuration, an alias with a partner namespace in the pair (the permission names that Learn lists include Microsoft.EventHub/namespaces/disasterRecoveryConfigs, so the pairing is a child configuration of the primary namespace, an inference); (c) two namespaces, one in the pair, with replication tasks (Azure Functions apps or Stream Analytics jobs) that copy events; (d) a namespace with no DR (Basic, or no secondary): one namespace and nothing in the pair. The inventory cannot show whether applications connect through the alias, the namespace hostname or a direct endpoint, where the checkpoint store of AMQP consumers lives, whether the secondary has private endpoints and role assignments, the current replication lag, or whether a promotion was ever rehearsed. Record today's DR as geo-replication, metadata geo-disaster recovery or custom replication only when the inventory shows it, otherwise as Unknown. Migration to a DR region that is not the pair is decided per namespace by option id: geo-replication adds the DR region as a secondary and later removes the pair's; metadata-geo-dr builds a new namespace in the DR region and re-pairs; active-active-namespaces builds a second namespace and replication tasks. The options are not mixed on one namespace.

### Build
1. geo-replication: confirm the namespace is Premium or Dedicated and that geo-replication is enabled in the DR region; for Dedicated create a dedicated cluster in the DR region (Learn: at least one dedicated cluster is needed in each region); for Premium plan the same number of processing units in the DR region; record the capacity for the full load in the runbook.
2. geo-replication: build the private access in the DR region before the secondary is added: a private endpoint in the DR virtual network, a privatelink.servicebus.windows.net private DNS zone for that region linked to the DR network only (the A record is added when the DNS zone group is attached), cross-region virtual network peering if one shared zone is kept, and conditional forwarding or a manual record for on-premises clients; the network engineer needs Owner or contributor permissions on the namespace and the virtual network.
3. geo-replication: decide the replication mode with the data owner: synchronous when no data loss on promotion is required and writes may depend on both regions, otherwise asynchronous with a maximum replication lag in minutes that the team sets and records with its basis (starting value 5m, the Estimated RPO of the option); Learn warns that a DR region on another continent increases the lag.
4. geo-replication: add the DR region as a secondary (portal: namespace > Geo-replication > Add secondary region, the region, its cluster for Dedicated, and the mode); Learn says secondary regions can be added and removed, so the pair's secondary stays until Decommission; wait until the initial replication has completed (Learn: complete replication can take a while depending on how much data the primary holds; its progress is the lag).
5. geo-replication: enable Application Metrics logs on the namespace and send them to a log workspace, produce and consume data for a few minutes, create the alert on the replication lag query (AzureDiagnostics, Category ApplicationMetricsLogs, ActivityName_s ReplicationLag, column count_d in seconds) and Service Health alerts for both regions; decide which role gives the incident manager and the platform engineer read access to the workspace and the metrics, and record it.
6. geo-replication: assign roles: the DR workload identities get Azure Event Hubs Data Sender and Data Receiver on the namespace (Learn: role assignments can take up to five minutes to propagate); decide which role the promotion operators hold (Learn names none; it has to hold Microsoft.EventHub/namespaces/failover/action, an inference from its name that TC-3 confirms), assign it, and record the decision and the assignee list in the runbook; decide and assign the role that the consumer identities need on the checkpoint store in the DR region, and record it.
7. geo-replication: prepare the applications: connect through the namespace hostname, retry with exponential backoff, process events idempotently, use the latest SDK versions (the checkpoint format changes after pairing) or the Kafka client versions Learn lists, and for AMQP consumers put a checkpoint store in the DR region (Kafka consumers need none, their offsets replicate).
8. geo-replication: after the pairing, wait until each consumer has stored a new checkpoint before any forced-promotion rehearsal (Learn warns that new data published after a forced promotion made before a new checkpoint can be lost).
9. metadata-geo-dr: confirm the tier pair (Standard with Standard or Dedicated, Premium with Premium, Dedicated with Dedicated) and create a new namespace in the DR region (only new namespaces can be added to a pairing; for a Dedicated primary the secondary is in a different cluster); provision its capacity for the full load in advance.
10. metadata-geo-dr: create the private endpoints on the secondary and then on the primary in the virtual networks that host both application instances, with the private DNS zone link for each; the pairing fails when the primary has a private endpoint and the secondary none, and the validation does not check that the endpoint works after failover, so TC-5 does.
11. metadata-geo-dr: create the role assignments on the secondary by hand (Azure Event Hubs Data Sender and Data Receiver for the workload identities); decide the role for the operators who run the failover and the pairing (it has to hold the disasterRecoveryConfigs failover, breakPairing, write and delete actions that Learn lists and the right to create namespaces; Learn names no built-in role), assign it, and record both in the runbook; decide and assign the role that the consumer identities need on the checkpoint store in the DR region, and record it. Because the failover step that pairs a new passive namespace with the new primary and the failback step that pairs a new namespace in the original region recreate role assignments on a new namespace, also assign Role Based Access Control Administrator to the platform engineer, scoped to the resource group or groups in which the new namespaces are created and not wider (the role page lists an assignable scope of "/"; the narrower scope is this playbook's design, and a new namespace does not exist yet when this step runs, so a scope on the namespaces themselves cannot cover it); record it in the runbook.
12. metadata-geo-dr: prepare the applications: connect through the alias, agree with the application owner the start position of receivers after a failover (FromStart(), FromEnd() or FromEnqueuedTime(dateTime)), make consumers idempotent, and write down that active sessions and the state of scheduled messages and duplicate detection are not carried over.
13. metadata-geo-dr: do not pair yet, because the new pairing replaces the old one and is made in Cut over; rehearse the failover on a non-production pair that mirrors production first (Learn: test in a non-production environment that mirrors production) and record the measured duration.
14. active-active-namespaces: create the second namespace in the DR region with the same event hubs, consumer groups and authorization or RBAC rules as the first (Learn's guidance for moving namespaces, exporting and redeploying a template without its cleanup step, creates and updates the secondary), with its private endpoints, DNS zone link and capacity.
15. active-active-namespaces: build the replication host: an Azure Functions app (stateless copy, Event Hubs trigger and output) or an Azure Stream Analytics job (stateful), with a managed identity that holds Azure Event Hubs Data Receiver on the source and Data Sender on the target (a second host or task for the reverse direction, used by the merge pattern and by the failback step that brings the events produced during DR to the original namespace, holds Data Receiver on the DR namespace and Data Sender on the original namespace), on a hosting plan with virtual network integration when the namespaces are reached through private endpoints; copy events grouped by partition key, keep the source's enqueue time and sequence number in the repl-enqueue-time and repl-sequence properties, and set a retry policy (an unlimited retry count pauses the checkpoint of the affected partition until the send succeeds).
16. active-active-namespaces: choose one-way replication (one-way failover, the old primary abandoned) or the merge pattern (replication in both directions, so the identity of each direction holds Data Receiver on its source and Data Sender on its target as in the Build step that builds the replication host, with a technique that stops already-replicated events from being replicated again; Learn points to its EventHubToEventHubMerge sample).
17. active-active-namespaces: build the endpoint lookup (DNS SRV records in a DNS the team controls with a CNAME in the application's zone, or a file with only the endpoint name, never a connection string), set the clients to consult it on frequent or persistent errors, decide and assign the role that may change it, and record it in the runbook; Event Hubs endpoints cannot be aliased directly with a CNAME record.
18. active-active-namespaces: monitor the replication host (Azure Functions monitoring, Application Insights) and alert on failed or stalled replication.

### Validate
1. geo-replication: run TC-1 at its Frequency for 7 consecutive days after the initial replication has completed.
2. geo-replication and metadata-geo-dr: run TC-5 on the DR region's namespace and network; active-active-namespaces: run TC-2 and TC-5.
3. geo-replication: run TC-3 as a planned promotion to the DR region and back in a non-production namespace that mirrors production, once before cut-over, then TC-4.
4. metadata-geo-dr: run TC-3 and TC-4 on the non-production pair of the Build step that rehearses the failover before pairing, and run TC-2 on the production pair after the cut-over step that breaks the old pairing and initiates the new one.
5. active-active-namespaces: run TC-6 at its Frequency for 7 consecutive days, then TC-7 and TC-4 once.
6. Record each result with its date; a duration or figure measured in a drill is Demonstrated, everything else stays Estimated or Unknown, and a design check is labelled as one.

### Cut over
1. geo-replication: make the DR region the planned promotion target in the runbook, record the replication mode and lag bound, and add the Failover and Failback steps of this playbook.
2. metadata-geo-dr: in a maintenance window break the old pairing (portal: primary namespace > Geo-recovery > Break pairing), then initiate the new pairing (Initiate pairing) with the new secondary and an alias, and wait for the entities to synchronise (Learn: approximately 50-100 entities per minute); the namespace has no DR between the two actions, so the window is kept short, and TC-2 is run at its end.
3. metadata-geo-dr: if applications used the old alias, update them to the new alias; Learn does not say whether an alias name can be reused after the old pairing is deleted, so try it first on the non-production pair.
4. active-active-namespaces: put the endpoint lookup and the Failover and Failback steps into the runbook and enable the replication tasks for production traffic.

### Decommission
1. geo-replication: only after TC-1, TC-3, TC-4 and TC-5 passed, remove the pair's secondary (portal: Geo-replication > select the secondary > Remove, enter "delete"); the data it held is deleted and adding it again replicates the primary's data from the start.
2. geo-replication: delete or reuse the dedicated cluster of the pair region according to what else it hosts (Learn: such clusters can host other namespaces).
3. metadata-geo-dr: only after TC-2, TC-3, TC-4 and TC-5 passed, retire the old secondary: the pairing was broken in the cut-over step that breaks the old pairing and initiates the new one, and Learn says "If you want to use the paired namespaces as regular namespaces, delete the alias", so delete the old alias; then process what the old secondary holds and delete it or reuse it for regular messaging outside the geo-recovery setup.
4. active-active-namespaces: only after TC-6 and TC-7 passed, stop the replication tasks that target the pair's namespace, process the events it holds, and then delete it (Learn's relocation guidance asks to make sure all events were processed before a namespace is deleted).

### Keep until cut-over
geo-replication: the pair's secondary, its private endpoint and DNS zone link, and the runbook steps for the old target, until TC-1, TC-3, TC-4 and TC-5 have passed. metadata-geo-dr: the old pairing, alias and secondary with their private endpoints, role assignments and runbook steps, until the new pairing is made and TC-2, TC-3, TC-4 and TC-5 have passed on the new secondary. active-active-namespaces: the replication tasks and the pair's namespace, until TC-6 and TC-7 have passed.

## Failover and failback

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region's Event Hubs namespace is unavailable (Azure Service Health, the namespace's metrics, a test publish) and declare DR for the workload | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time and the evidence used | The namespace answers again before the declaration (Learn's example for the decision is connectivity lost for longer than 15 to 20 minutes) |
| 2 | geo-replication: read the last replication lag (ReplicationLag, count_d in seconds), note whether each consumer stored a checkpoint after the pairing, and choose the promotion type: planned when the primary is available, forced when it is not | Platform engineer | Estimated unknown (a log query and a decision; measured in the first drill) | The last lag value, its time and the checkpoint status are recorded | The metric is unavailable: choose forced only when the data owner accepts the loss that the last known lag implies |
| 3 | geo-replication: promote the DR region (portal: namespace > Geo-replication > failover icon, planned or forced, enter "promote"); a planned promotion can be switched to forced after it starts | Platform engineer | Estimated 10m (Learn: about 5 to 10 minutes; a planned promotion adds a catch-up that can take up to the replication lag; the stricter figure; TC-3 measures it) | The Geo-replication blade shows the DR region as primary, and the namespace hostname answers a test publish and a test read | A planned promotion does not finish within the Estimated duration because the secondary cannot catch up: the incident manager decides on forced and records the accepted loss; the promotion is refused for lack of permission: use an assignee of the role recorded in the runbook |
| 4 | geo-replication: let clients' DNS follow, restart consumers (Kafka consumers resume from the replicated offsets; AMQP consumers read their checkpoints from the checkpoint store in the DR region) and let producers retry | Application engineer | Estimated unknown (depends on the DNS time-to-live and the clients' retry policy; measured in the first drill) | Producers publish without errors for the agreed observation window and consumer lag falls to the pre-incident level; after a forced promotion duplicates are absorbed by idempotent consumers | A consumer cannot read its checkpoint: start it from a time-based position chosen by the application owner and record the possible duplicates |
| 5 | metadata-geo-dr: check the secondary before clients use it: the event hubs, consumer groups and settings of the primary exist, role assignments exist, the private endpoints work from the application's networks, and the capacity is provisioned | Platform engineer | Estimated unknown (a checklist run; measured in the first drill) | TC-2 and TC-5 checks repeated on the secondary show no difference | The primary is unreachable and an entity is missing: create it from the inventory after the failover instead of before |
| 6 | metadata-geo-dr: initiate the failover (portal: primary namespace > Geo-recovery > Failover, the Azure CLI command az eventhubs georecovery-alias fail-over, or the Set-AzEventHubGeoDRConfigurationFailOver cmdlet); it removes the pairing and is one-way | Platform engineer | Estimated 10m (Learn: typically within 5 to 10 minutes; another page says nearly instantaneous; the stricter figure; TC-3 measures it) | The alias resolves to the secondary namespace and a test publish through the alias succeeds | The failover is rejected or does not complete: record the error text, retry once, then open a support request with Azure support |
| 7 | metadata-geo-dr: start receivers at the position that the application owner chose (FromStart(), FromEnd() or FromEnqueuedTime(dateTime)) and resume producers | Application engineer | Estimated unknown (measured in the first drill) | Producers publish and consumers read new events from the secondary through the alias | A consumer depends on a session, a scheduled message or duplicate-detection state from before: the application owner decides how it is rebuilt |
| 8 | metadata-geo-dr: create a new passive namespace in a region of choice with private endpoints in the virtual networks that host both application instances (and the private DNS zone links), pair it with the new primary so that another failover is possible (the old primary is not re-paired: only new namespaces can be added), then create the namespace-scoped role assignments (Azure Event Hubs Data Sender and Data Receiver for the workload identities) and, once the entities have synchronised, the entity-scoped ones | Platform engineer | Estimated unknown (the pairing plus the entity sync at approximately 50-100 entities per minute plus the endpoints and role assignments; measured in the first drill) | The new pairing is listed as active, the private endpoint connections of the new namespace are Approved, and TC-2 and TC-5 pass for the new pair | The pairing fails (for example no private endpoint on the new namespace while the primary has one): fix it and retry; the chosen region has no capacity: pair later; in both cases the workload runs without DR until the pairing holds and the period is recorded in the runbook |
| 9 | active-active-namespaces: change the endpoint lookup to the DR namespace (the CNAME of the DNS record, or the endpoint name in the file) and let clients pick it up | Platform engineer | Estimated unknown (the switch-over target the team sets; TC-7 measures it) | A client that resolves the lookup connects to the DR namespace and a test publish and a test read succeed | The lookup cannot be updated: tell the application owners to change their configuration directly |
| 10 | active-active-namespaces: start consumers on the DR namespace at a time-based position (the repl-enqueue-time property of replicated events helps to skip what was already handled when the old checkpoint store is still reachable) | Application engineer | Estimated unknown (measured in the first drill) | Consumers read events and the lag falls to the pre-incident level | Events before the chosen position are missing: the application owner decides on a replay from the old primary when it is reachable |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the original primary region and its namespace are available again and stable | Incident manager | Estimated unknown (measured in the first drill) | The namespace of the original region answers and Service Health shows no open incident | The region is still unstable: stay on the DR region |
| 2 | geo-replication: confirm that the demoted region is a healthy secondary (Learn: the previous primary becomes a secondary after the promotion) and that the replication lag falls to its normal value | Platform engineer | Estimated unknown (the catch-up time depends on the data replicated since the promotion; measured in the first drill) | The ReplicationLag query shows a lag within the configured maximum | The lag does not fall: keep running on the DR region and investigate |
| 3 | geo-replication: promote the original region with the same process, as a planned promotion in a maintenance window (it needs both regions available and the primary rejects writes during it); a forced promotion can lose what was not replicated and lost data cannot be recovered | Platform engineer | Estimated 10m plus the catch-up (Learn: a planned promotion first replicates data to the secondary, which usually completes quickly and might take up to the replication lag, and the promotion then typically takes about 5 to 10 minutes; TC-3 measures the total) | The Geo-replication blade shows the original region as primary and a test publish succeeds | The planned promotion does not finish: keep the DR region as primary and ask the incident manager before choosing forced |
| 4 | geo-replication: restart consumers as in the geo-replication failover step that restarts consumers | Application engineer | Estimated unknown (measured in the first drill) | Consumer lag falls to the normal level and TC-4 checks pass | A consumer cannot read its checkpoint: start it from a time-based position chosen by the application owner |
| 5 | metadata-geo-dr: pull the remaining events from the former primary when access is back and process them in the application (Learn: Microsoft doesn't restore them into the secondary) | Application engineer | Estimated unknown (depends on how much remained in the former primary) | The count of events read from the former primary matches the application owner's list of what was in flight | The former primary cannot be read, or all its zones were lost: record the loss for the data owner |
| 6 | metadata-geo-dr: to return to the original region, create a new namespace there with private endpoints in the virtual networks that host both application instances (and the private DNS zone links), pair it as the secondary of the current primary, create the namespace-scoped role assignments (Azure Event Hubs Data Sender and Data Receiver) and, once the entities have synchronised, the entity-scoped ones, then perform another failover in a window; events sent to the temporary primary can be lost when they are not consumed first | Platform engineer | Estimated unknown (pairing, sync at approximately 50-100 entities per minute, failover and switch; measured in the first drill) | The alias points to the namespace of the original region, and TC-2 and TC-5 pass on the new secondary before the failover | The pairing fails (for example no private endpoint on the new namespace while the primary has one) or any other step fails: fix it and retry; the workload stays on the current primary (failing back to the previous primary replica isn't supported) |
| 7 | active-active-namespaces: make sure the events produced during DR reached the original namespace (the merge pattern, or a one-time replication task in the reverse direction), then switch the endpoint lookup back | Platform engineer | Estimated unknown (the replication time of the DR period; measured in the first drill) | Event counts of the DR period are equal on both namespaces for the partition keys checked | The counts differ: leave the lookup on the DR namespace and run the replication again |
| 8 | active-active-namespaces: restart consumers at a time-based position on the original namespace and retire the extra replication direction if it is not needed | Application engineer | Estimated unknown (measured in the first drill) | Consumers read new events and the lag falls to the normal level | Events are missing in the original namespace: leave the consumers on the DR namespace |

## Test criteria

### TC-1: Replication lag stays within the configured bound
- Applies to: geo-replication
- Pass condition: for 7 consecutive days, the ReplicationLag query returns values (count_d, in seconds) on every day, their maximum is lower than the maximum replication lag that the team configured (asynchronous replication, a team-set starting value of 5 minutes that matches the Estimated RPO of the option) or lower than the bound that the team sets from the value of the first run (synchronous replication, whose Estimated RPO of 0 is Learn's separate statement; Learn does not say what the metric shows in that mode), and no throttling of publishers caused by the lag is recorded.
- How to measure: enable Application Metrics logs on the namespace, produce and consume data, run the AzureDiagnostics query with Category ApplicationMetricsLogs and ActivityName_s ReplicationLag over the window, and alert when the value approaches the configured maximum.
- Evidence: the query result with its date and window, the configured mode and maximum lag, and the alert rule.
- Frequency: daily

### TC-2: Entities and settings of the secondary equal the primary's
- Applies to: metadata-geo-dr, active-active-namespaces
- Pass condition: the secondary namespace holds every event hub and consumer group of the primary with the same names and settings (partition count, retention, authorization or RBAC rules), the number of differences is 0, and for metadata-geo-dr a new entity of the primary appears in the secondary within its count divided by 50 entities per minute (the lower end of Learn's approximate synchronisation rate). For geo-replication the secondary cannot be read, so this is a design check, not drillable here; parity is shown by the entity listing after the promotion in TC-3.
- How to measure: list event hubs, consumer groups and their properties in both namespaces with the management API, CLI or PowerShell and compare by name; for metadata-geo-dr create a test event hub in the primary and time its appearance in the secondary; for active-active-namespaces compare after every deployment of the namespace template.
- Evidence: both listings with their dates, the empty diff, and the timing of the test entity.
- Frequency: weekly, and after every change to the entities of the primary

### TC-3: A promotion or failover drill completes and clients follow
- Applies to: geo-replication, metadata-geo-dr
- Pass condition: in a drill on a non-production namespace or pair that mirrors production, the promotion (planned for geo-replication, then back) or the failover (metadata-geo-dr) completes within the Estimated RTO of the option (for a planned promotion plus the catch-up, which is measured and recorded separately), the namespace hostname or the alias answers a test publish and a test read from the DR region's application, the entity listing of the new primary equals the old primary's, and the role recorded in the runbook is accepted for the action.
- How to measure: run the Failover table steps on the non-production namespace or pair with a stopwatch from the start of the promotion or failover to the first successful test read and write from a client in the DR region; for geo-replication also run the Failback table steps; for metadata-geo-dr re-pair afterwards and time it.
- Evidence: the drill record with its timestamps, the measured duration labelled Demonstrated, the entity listing after the drill and the role that was used.
- Frequency: before cut-over, then at the interval of the team's DR drills (Learn says to rehearse at least once and gives no interval)

### TC-4: Consumers resume at the right position without a loss beyond the bound
- Applies to: geo-replication, metadata-geo-dr, active-active-namespaces
- Pass condition: after the drill every consumer reads from the DR namespace with no manual step beyond the runbook; for geo-replication with synchronous replication no event is missing between the last checkpoint and the first event read, and with asynchronous replication no more events are missing than were produced within the configured maximum replication lag; metadata-geo-dr and active-active-namespaces consumers start at the position the application owner recorded; duplicate events cause no duplicate side effects.
- How to measure: publish numbered test events before and during the drill, run each consumer type (Kafka, and AMQP with its checkpoint store), compare the sequence numbers processed with those published, count duplicates and check their effect in the downstream store.
- Evidence: the numbered event log, the consumers' processed lists, the counts of missing and duplicate events per consumer type, and the checkpoint store location used.
- Frequency: every DR drill, and after a change of the SDK, the checkpoint store or the consumer's start-position logic

### TC-5: Network, identity and capacity exist in the DR region
- Applies to: geo-replication, metadata-geo-dr, active-active-namespaces
- Pass condition: the private endpoint connection of the DR namespace (for metadata-geo-dr, of both namespaces) is Approved and the namespace name resolves to a private IP address from every DR network that runs clients; the workload identities hold Azure Event Hubs Data Sender and Data Receiver on the DR namespace (for metadata-geo-dr and active-active-namespaces the assignments are made by hand and 0 are missing against the primary's); the operators hold the role recorded in the runbook; the DR namespace's throughput, processing or capacity units are at least the primary's, or the runbook records the planned scale-up and its owner; for metadata-geo-dr a read from a DR network as the DR identity succeeds on the secondary (Learn: GET requests are accepted on its data plane).
- How to measure: read the private endpoint connection state, resolve the namespace name from inside each DR network, list the role assignments on the namespace scope and compare them with the primary's, compare the capacity settings of both namespaces, and send a read request (for example Get Event Hub) from the DR network.
- Evidence: the connection state, the resolved addresses, both role assignment lists with the diff, the capacity settings and the test read result.
- Frequency: weekly, and after every change to the DR network, DNS, role assignments or capacity

### TC-6: The customer-built replication keeps up
- Applies to: active-active-namespaces
- Pass condition: for 7 consecutive days, the time from a canary event produced in the source namespace to its presence in the target namespace, with the same partition key and with its repl-enqueue-time and repl-sequence properties set, stays below the lag target of 15 minutes that the team sets (the Estimated RPO of the option, a starting value to replace with its own), and the number of events produced equals the number replicated for the canary partition keys.
- How to measure: a scheduled producer sends a canary event per partition key every few minutes, a reader in the target namespace records the arrival time, and the source's enqueue time (from repl-enqueue-time) is compared with it; counts are compared per partition key.
- Evidence: the 7-day export of lag per canary event with its maximum, the counts, and the replication host's failure and retry log.
- Frequency: daily

### TC-7: The endpoint switch moves clients to the DR namespace
- Applies to: active-active-namespaces
- Pass condition: when the endpoint lookup is changed to the DR namespace in a drill, every producer and consumer of the test set connects to the DR namespace within the switch-over target of 10 minutes that the team set (the Estimated RTO of the option, a starting value to replace with its own), publishes and reads successfully, and returns to the original namespace when the lookup is changed back.
- How to measure: change the DNS record or the file that holds the endpoint name, then time from the change to the first successful publish and read of each client in the set; repeat for the switch back.
- Evidence: the drill record with timestamps per client, the measured switch-over time labelled Demonstrated, and the lookup values before and after.
- Frequency: before cut-over, then at every DR drill
