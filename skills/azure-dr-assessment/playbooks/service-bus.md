---
service: service-bus
title: Azure Service Bus
arm_types:
  - microsoft.servicebus/namespaces
slot: data-replication.messaging
version: 1
verified_on: 2026-11-09
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus
  - https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication
  - https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-dr
  - https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-outages-disasters
  - https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-federation-overview
  - https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-migrate-standard-premium
  - https://learn.microsoft.com/en-us/azure/service-bus-messaging/authenticate-application
  - https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged
---

# Azure Service Bus

## Mechanisms

### Zone redundancy
- Replicates: configuration, metadata and message data, synchronously across the availability zones of one region
- Paired: no
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: 0 (Learn: no data loss occurs during a zone failure because messages are replicated synchronously across zones before acknowledgment)
- Estimated RTO: unknown (Learn: a zone failure "might cause a few seconds of downtime"; no figure is published, and Learn says the customer does not need to validate zone failure processes)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#resilience-to-availability-zone-failures

### Geo-Replication
- Replicates: metadata (queues, topics, subscriptions, filters, namespace configuration) and data (messages, message state changes, property changes) from a primary region to a secondary region, synchronously or asynchronously
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: unknown (Learn gives no figure for the asynchronous mode: its comparison table says "RPO within configured lag, possible data loss on forced promotion", so the asynchronous RPO is the maximum replication lag that the team configures; synchronous mode is a separate statement, "RPO 0, no data loss on promotion", and the option states which mode its number covers — https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#replication-modes)
- Estimated RTO: 10m (Learn: a promotion "typically takes about 5 to 10 minutes" and DNS entries can take longer; a planned promotion first replicates data, which can take up to the length of the replication lag; another Learn page says under two minutes and the longer figure is used; TC-3 proves it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#geo-replication

### Metadata Geo-Disaster Recovery
- Replicates: configuration and metadata only (entities, configuration, properties), continuously and asynchronously, from a primary namespace to a paired secondary namespace reached through an alias; no message data
- Paired: yes
- Nonpaired: yes
- Failover: manual
- Estimated RPO: unknown (Learn: message data is not replicated, so messages in the primary are unavailable while its region is down; metadata replication is asynchronous and recent changes might not replicate; Learn publishes no figure)
- Estimated RTO: 10m (Learn's reliability article: failover "typically occurs within 5 to 10 minutes" and can take longer for DNS; the Geo-Disaster Recovery article says "nearly instantaneous once initiated"; the pages differ and the longer figure is used; TC-7 proves it)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#metadata-geo-disaster-recovery

### Active replication across namespaces
- Replicates: message data, by the sender application: every operation uses entities in both namespaces, a sender sends two copies tagged with the same unique identifier, and the receiver reads both entities and suppresses the second copy
- Paired: yes
- Nonpaired: yes
- Failover: not applicable
- Estimated RPO: unknown (Learn publishes no figure; the replication logic is in the sender applications, and TC-8 proves what the build delivers)
- Estimated RTO: unknown (Learn publishes no figure; both entities are used for every operation, so the pattern has no switch-over step, and TC-8 measures the first successful send and receive after one namespace is unreachable)
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-outages-disasters#active-replication

### Passive replication across namespaces
- Replicates: message data, by the sender application: a sender uses one entity and, when an operation fails with an error code that indicates the datacenter might be unavailable, sends a copy to the backup entity and the two entities switch roles; receivers read both
- Paired: yes
- Nonpaired: yes
- Failover: customer-managed
- Estimated RPO: unknown (Learn: in this pattern messages can be delayed, lost or received twice, and it publishes no figure)
- Estimated RTO: unknown (Learn publishes no figure; the switch happens when a send fails, and the sender's error handling decides it)
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-outages-disasters#passive-replication

### All-active replication across namespaces
- Replicates: message data, by replication tasks that copy messages between one topic per namespace, each topic having one replication subscription for every other topic, so that every message becomes available in all replicas
- Paired: yes
- Nonpaired: yes
- Failover: not applicable
- Estimated RPO: unknown (Learn publishes no figure; the lag of the replication tasks belongs to the solution the team builds, and no test criterion of this playbook covers it)
- Estimated RTO: unknown (Learn publishes no figure; consumers in each region already see all messages, so the pattern has no switch-over step)
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-federation-overview#all-active-replication

## Constraints

### Both native multiregion features need the Premium tier
Learn says Service Bus provides two types of multiregion support, Geo-Replication and metadata Geo-Disaster Recovery, "both of which require Premium tier namespaces". Namespaces in the Basic and Standard tiers "don't include native multiregion features", and Learn points them to application-level replication patterns with multiple namespaces across regions.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#resilience-to-region-wide-failures

### Microsoft never starts a Geo-Replication promotion
A customer manually triggers a promotion, "either explicitly through a command or through client owned business logic that triggers the command", and "Azure never triggers a promotion".
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#promotion-flow

### Microsoft never starts a Geo-Disaster Recovery failover
A customer manually triggers a failover, "either explicitly through a command or through client owned business logic that triggers the command", and "Azure never triggers a failover".
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-dr#failover-flow

### Learn tells the customer to test a promotion or failover
Learn's "Test for region failures" sections say to test Geo-Replication by temporarily promoting the secondary region and validating that clients switch, and to test Geo-Disaster Recovery with a planned failover during a maintenance window, in a nonproduction environment that mirrors production. For both, Learn adds "After testing, you can fail back to the original configuration". For Geo-Disaster Recovery this sits next to the Geo-Disaster Recovery article's "You can't fail back to the previous primary replica", so this playbook reads "fail back" there as the new-namespace return of the one-way constraint, not a reversal of the failover. This means the customer can drill both.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus

### The secondary region need not be the primary's pair
For Geo-Replication and for metadata Geo-Disaster Recovery the reliability article says "You can choose any Azure region that supports Service Bus", "You don't need to use Azure paired regions", and the secondary is selected on latency, compliance or data residency (in the Requirements subsection of each).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus

### A Geo-Replication secondary on another continent adds replication lag
If the secondary region is on another continent, the choice affects replication lag, so for availability Learn says to choose secondary regions "at least on the same continent where possible".
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#secondary-region-selection

### Geo-Replication and Geo-Disaster Recovery exclude each other
Learn says "You can't use this feature in combination with the Azure Service Bus Geo-Disaster Recovery feature", and its migration from Geo-Disaster Recovery to Geo-Replication starts by breaking the pairing on the primary namespace and then follows the Geo-Replication setup.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication

### Geo-Replication has one secondary and no large messages
Learn's note says "Currently only a single secondary region is supported" and its Important block says "Large messages aren't supported yet".
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#azure-service-bus-geo-replication

### A Geo-Replication secondary is not accessible and the hostname follows the primary
Secondary regions are hot stand-by regions: "you can't read or write on the secondary regions". The namespace hostname "always points to the primary region" and points to the new primary after a promotion.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#basic-concepts

### Synchronous and asynchronous replication trade latency and availability for data safety
With synchronous replication every request is committed in the primary and the secondary before the acknowledgment, so latency is longer and an unavailable or lagging secondary makes the primary throttle. With asynchronous replication the primary acknowledges first, the team configures the maximum lag, the primary throttles when the lag of an active secondary exceeds it, and "data loss or duplication might occur when forced promotion is used". Queues and topics are replicated synchronously whichever mode is set, and topic subscriptions follow the selected mode. To continue in the primary when a secondary lags or is unavailable, remove that secondary. Switching from asynchronous to synchronous takes effect once the lag reaches zero, which can mean pausing publishers.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#replication-modes

### Planned and forced promotion differ in data loss and in what must be available
A planned promotion waits for the lag to catch up and puts the namespace in read-only mode (new messages and consumer operations are rejected) until it completes. A forced promotion starts immediately, can lose data or metadata that is not replicated and can cause duplicates (for example when a Complete or Defer was not replicated), and the lost data stays lost. After a forced promotion Learn's current best practice is to delete the old primary region and add a new secondary rather than let it resynchronize.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#promotion-flow

### A planned promotion needs every region available
Learn's reliability article says a planned promotion "requires all of the primary and secondary regions to be available", so it might not be possible during a region outage, and that during an outage of the primary region you typically need a forced promotion. After a promotion starts the primary does not accept writes until it finishes.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#geo-replication

### Learn gives two promotion times for Geo-Replication
The Geo-Replication article's private endpoint section says a promotion "typically completes in under two minutes", while the reliability article says it typically takes about 5 to 10 minutes and DNS can take longer. The pages differ, so this playbook follows the longer figure for estimates and TC-3 measures the real time. The same article says the hostname update "can take several minutes" and suggests promoting when connectivity is lost for longer than 15 to 20 minutes.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#private-endpoints

### Replication lag is observed with two Azure Monitor metrics
ReplicationLagDuration (seconds, per entity) is the time-based distance of the outstanding replication work and is the metric to use for time-based alerts; ReplicationLagCount is the number of outstanding replication-log operations. Neither is a count of unreplicated messages or predicts how many a forced promotion loses. A current value of `--` does not mean zero, and the configured maximum lag is a setting, not a measurement. For a sustained breach Learn recommends a static-threshold metric alert on the Minimum aggregation over a lookback such as 10 to 15 minutes, checked every minute.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#monitoring-data-replication

### Geo-Replication side effects on auto-delete and Event Grid
When a failover is performed the timer of entities with auto-delete on idle is reset. With Event Grid integration, Event Grid replicates to the geo-paired location and not to the secondary region of Geo-Replication, a promotion does not fail Event Grid over, and removing the initial primary region from the configuration breaks the integration.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#azure-service-bus-geo-replication

### Private endpoints with Geo-Replication are per region and survive a promotion
Clients behind a private endpoint reach the new primary automatically after promotion, with the same connection string. Private endpoints are regional resources, so create one in each region's virtual network, with one `privatelink.servicebus.windows.net` private DNS zone per region linked to that region's network only; a shared zone has one A record that points to whichever endpoint was attached last and then needs cross-region peering. On-premises clients resolve to the nearest region's endpoint by conditional forwarding or a maintained record.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#private-endpoints

### Geo-Replication costs a full set of messaging units per replica plus replicated data
Each replica runs on the same number of messaging units as the primary, the bill covers all replicas, and a data transfer charge applies to the data replicated. Learn's pricing page holds the figures; this playbook quotes none.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#pricing

### Geo-Disaster Recovery replicates no messages, role assignments or several settings
It "doesn't replicate the messages held in queues or topic subscriptions, or dead-letter queues", and Learn's tip says not to lean on it for active/active use or for replicating queue contents (use Geo-Replication or the replication guidance). Role assignments to entities are not replicated and are created manually in the secondary. Not replicated: virtual network configurations, private endpoint connections, all networks access, trusted service access, public network access, default network action, identities and encryption settings (customer-managed key or BYOK), enable auto scale, disable local authentication and Event Grid subscriptions. A partitioned namespace cannot be paired with a nonpartitioned one, and an entity with AutoDeleteOnIdle might not be present in the secondary at failover.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-dr#important-points-to-consider

### Geo-Disaster Recovery needs two Premium namespaces in different regions
Setup creates a primary Premium namespace and a secondary Premium namespace in a different region and pairs them. The setup steps say "Select an existing secondary namespace or create one in a different region", and Learn also says "You can only add new namespaces to your failover pairing"; this playbook plans a new namespace for the secondary as the stricter reading. A safe failover waits for pending replications and "fails if the primary and secondary namespaces aren't in the same Azure subscription"; a forced or manual failover does not wait.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-dr#setup

### Geo-Disaster Recovery sessions, scheduled messages and sync speed
Because no data is replicated, active sessions are not replicated and duplicate detection and scheduled messages might not work (new ones work). Synchronizing entities takes "approximately 50-100 entities per minute", and subscriptions and rules count as entities. Learn suggests promoting when connectivity is lost for longer than 15 to 20 minutes and rehearsing a failover at least once.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-dr#considerations

### Geo-Disaster Recovery failover is one-way
Failing over repoints the alias to the secondary, activates it and breaks the pairing. Learn says "Only fail-forward semantics are supported" and you "can't fail back to the previous primary replica"; after the failover "set up another secondary namespace and update the pairing", and the former primary is pulled for its messages once available and then used "for regular messaging outside of your Geo-Disaster Recovery setup, or delete the old primary namespace". The reliability article describes recovery as a new pairing with the recovered region as secondary and then "optionally" another failover, with potential loss of messages sent to the temporary primary. The pages differ in wording; this playbook follows the stricter one: a return is a new pairing with a new namespace in the original region and a second failover to it, never a reversal and never a re-pairing of the old primary.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-dr#failover-flow

### Private endpoints must exist on both namespaces before they are paired
Pairing a primary with a private endpoint and a secondary without one fails, and the validation checks only that an endpoint exists, not that it works after failover. If a pairing already exists, create the private endpoint on the secondary first and then on the primary. Learn's recommended configuration gives both namespaces private endpoints in the virtual networks of both the primary and the secondary application instance.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-dr#private-endpoints

### An alias is the connection point, also after a Standard to Premium migration
Applications connect through the alias, a stable FQDN. For a namespace migrated from Standard to Premium, its connection string and DNS name already are an alias to the Premium namespace, so the pairing is created through PowerShell, CLI or REST with that preexisting alias (the portal handles it).
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-dr#service-bus-standard-to-premium

### A Standard to Premium migration copies entities and shared access policies, not messages or RBAC
The message data is not copied (drain the old namespace through the post-migration name) and RBAC settings are not migrated (add them manually). The migration cannot be undone, downtime is approximately 5 minutes, Basic must go to Standard first, and an existing Premium target must have no entities and no partitioning.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-migrate-standard-premium

### Multiple namespaces put the replication logic in the application
Learn says active and passive replication are general concepts, not Service Bus features: the replication logic (sending to two namespaces) is in the sender applications and the receiver needs custom logic for duplicate detection. The pattern is for when Geo-Disaster Recovery or Geo-Replication cannot meet the requirements.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-outages-disasters#replication-types

### Active replication doubles operations and needs a unique identifier on both copies
Both copies are tagged with the same identifier (MessageId, Subject or a custom property), the receiver keeps a list of messages it already received, and the approach "doubles the number of operations", so it can cost more.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-outages-disasters#active-replication

### All-active replication copies every message to every topic
Every message sent to any topic is copied to every topic, so application code in each region sees and processes all messages; Learn says this suits shared data or redundant processing, and that processing each message once needs another pattern. Each replication subscription has a rule whose filter is on the `replication` property (`replication IS NULL`) and whose action sets it to 1, so a copy is not replicated back. To model a queue, each topic has one regular subscription that all consumers share.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-federation-overview#all-active-replication

### Replication tasks can run in Azure Functions or Azure Logic Apps
Azure Functions can run under a managed identity so that replication tasks use the RBAC rules of the source and target services without managed secrets, and integrates with virtual networks. Azure Logic Apps has predefined replication tasks for Service Bus.
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-federation-overview#replication-applications-in-azure-functions

### Azure built-in roles grant data-plane access to a namespace
Learn lists Azure Service Bus Data Owner (full access to the Service Bus resources), Azure Service Bus Data Sender (send) and Azure Service Bus Data Receiver (receive) as built-in roles for authorizing access to a namespace. It names no built-in role for starting a promotion or failover, so the team decides that role (see Build).
- Source: https://learn.microsoft.com/en-us/azure/service-bus-messaging/authenticate-application#azure-built-in-roles-for-azure-service-bus

### Role Based Access Control Administrator writes role assignments
Learn describes the built-in role Role Based Access Control Administrator as managing "access to Azure resources by assigning roles using Azure RBAC"; its actions include creating a role assignment at the specified scope (Microsoft.Authorization/roleAssignments/write), and it includes the `*/read` action for the control plane.
- Source: https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged#role-based-access-control-administrator

### Service Bus keeps no backup of message data
Learn says Service Bus is not designed for long-term data storage and "doesn't provide any backup and restore capabilities" for message data, and suggests application-level archiving to Azure Storage or other durable storage where long retention is needed.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#backup-and-restore

### The secondary must be able to carry the full load
Both regions need enough capacity for the full load if one fails; for Geo-Disaster Recovery Learn says to plan how the secondary is scaled, that provisioning in advance reduces downtime and that scaling during or after failover is an option "if you can tolerate extra downtime".
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#capacity-planning-and-management

## Non-paired options

### geo-replication: Geo-Replication to the DR region
- Kind: native
- Target: dr-region
- Uses mechanism: Geo-Replication
- Estimated RPO: 5m (asynchronous mode; Estimated, team-set starting value, TC-2 proves it. Learn gives no figure for asynchronous mode and states "RPO within configured lag, possible data loss on forced promotion", so the number is the maximum replication lag that the team configures, and a forced promotion "might" lose recent messages that are not replicated. Synchronous mode is a separate statement: Learn says "RPO 0, no data loss on promotion", and that mode needs its own statement in the runbook and TC-2 — https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-replication#replication-modes)
- Estimated RTO: 10m (Learn: a promotion typically takes about 5 to 10 minutes plus DNS time; another Learn page says under two minutes and the longer figure is used; TC-3 proves it — https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#geo-replication)
- Prerequisites: a Premium namespace (a Standard namespace is migrated first); a DR region that supports Service Bus, chosen for latency and residency, same continent where possible, not required to be the pair; no Geo-Disaster Recovery pairing on the namespace; no large messages; the replication mode and the maximum lag recorded as parameters; a private endpoint in each region's virtual network and one `privatelink.servicebus.windows.net` zone per region linked to that network only; the roles decided and assigned in Build (start a promotion; add or delete a secondary region and change capacity) and the data-plane roles Azure Service Bus Data Sender and Azure Service Bus Data Receiver for each workload identity; alerts on ReplicationLagDuration; consumers that tolerate duplicates; a plan for Event Grid, which does not follow a promotion.
- Cost notes: every replica is billed at the primary's messaging units, plus a charge for replicated data; private endpoints in each region; no price.
- Gives up: a promotion that Microsoft starts for you; access to the secondary; a second secondary region (Learn: a single one is supported); large messages; in asynchronous mode, the assurance that every message is in the secondary before it is acknowledged, and data lost in a forced promotion is not recoverable; in synchronous mode, write latency and write availability that depend on the secondary region.
- Recommended when: the namespace is or can be Premium, the application has a low tolerance for message loss, and a DR region outside the primary's pair is needed (Learn names Geo-Replication as the choice for most applications that must survive region outages).
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#geo-replication

### metadata-geo-dr: Metadata Geo-Disaster Recovery to a namespace in the DR region
- Kind: workaround
- Target: dr-region
- Uses mechanism: Metadata Geo-Disaster Recovery
- Estimated RPO: unknown (message data is not replicated, so no RPO exists for messages: the messages in the primary are unavailable while its region is down and can be read from the old primary after it recovers, and metadata replication is asynchronous; Learn publishes no figure, and a team-set number would describe the application's own message recovery and not this mechanism, so it stays unknown until the application owner records the accepted message loss in TC-7)
- Estimated RTO: 10m (Learn: typically 5 to 10 minutes plus DNS time for the alias switch, from the failover start; the application's own message recovery is not part of it; another Learn page says "nearly instantaneous once initiated" and the longer figure is used; TC-7 proves it — https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#metadata-geo-disaster-recovery)
- Prerequisites: two Premium namespaces in different regions, the secondary in the DR region, with the same partitioning as the primary (Learn's setup allows an existing or a new secondary and also says "You can only add new namespaces to your failover pairing"; plan a new one as the stricter reading); private endpoints on both namespaces before pairing when the primary uses one; the alias connection string in every client (the preexisting alias for a namespace migrated from Standard); every non-replicated setting copied by hand and the RBAC assignments recreated on the secondary; both namespaces in one subscription if the safe failover is to be usable; capacity in the secondary provisioned in advance, or a decision to scale after failover; an application design for messages lost with the primary; the roles decided and assigned in Build (start the failover; create namespaces, pairings and capacity).
- Cost notes: both namespaces are billed (Learn: "you pay for both the primary and secondary namespaces"), and capacity is held in the passive secondary; private endpoints on both; no price.
- Gives up: all message data (queues, subscriptions and dead-letter queues); active sessions, and possibly duplicate detection and scheduled messages; failback to the previous primary (the pairing is removed at failover, and a return is a new pairing with a new namespace and a second failover); replication of the settings and RBAC assignments the constraint lists.
- Recommended when: the application replicates its own data or can tolerate losing messages in flight (Learn gives the example of messages that can be reconstructed), or Geo-Replication does not fit, and the namespaces are Premium.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#metadata-geo-disaster-recovery

### active-active-namespaces: Two namespaces, one in the DR region, used together by the application
- Kind: workaround
- Target: dr-region
- Uses mechanism: Active replication across namespaces
- Estimated RPO: 15m (Estimated, team-set starting value; TC-8 proves it. Learn publishes no figure and the replication logic is in the sender applications the team builds, so the number is the longest time the team accepts between a message existing in one namespace and in the other, and a message that exists in only one namespace when it is lost is lost)
- Estimated RTO: 10m (Estimated, team-set starting value; TC-8 proves it. Learn publishes no figure; with active replication both entities are used for every operation, so there is no switch-over step, and the number is the time the sender's timeouts and retries need before the surviving namespace carries the traffic alone, measured as the first successful send and receive after one namespace is made unreachable)
- Prerequisites: a second namespace in the DR region (Learn describes active and passive replication for the Standard tier and as the fallback when "you use a Service Bus tier that doesn't support" the native features), with every entity created identically in both namespaces; sender code that tags both copies with the same unique identifier and receiver code that keeps a list of identifiers already received; Azure Service Bus Data Sender and Azure Service Bus Data Receiver for the application identities on both namespaces; private endpoint, DNS zone link, RBAC and capacity for the full load, built on each namespace separately because nothing replicates between them. Scope: this option, its Build, Failover, Failback and TC-8 cover active replication, the one mechanism it uses. Passive replication and all-active replication with replication tasks are Learn mechanisms of section 1 that need different sender, receiver and task logic; they are not covered by the steps below.
- Cost notes: two namespaces are billed; active replication doubles the number of operations (Learn); private endpoints on both; no price.
- Gives up: a managed replication service, because the sender applications do it and the team owns their failures; single-copy processing (the receiver must suppress duplicates); the single hostname or alias of the native features, because the application addresses two namespaces.
- Recommended when: the namespaces are Basic or Standard, or the team needs custom replication or several active regions at once, and the application can carry duplicate suppression and idempotent consumers.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-service-bus#custom-multiregion-solutions-for-resiliency

## Migration from a paired setup

### Recognise today's setup
Service Bus has no Microsoft-managed replication to the pair: each multiregion feature is configured by the customer, so the inventory shows the paired DR through these properties, or not at all:
- Geo-Replication to the pair: a Premium namespace whose `properties.geoDataReplication.locations` holds an entry with `roleType` Secondary and the secondary region in `locationName` (Learn's Azure Resource Graph query lists them; an empty result is not proof, because Resource Graph indexes asynchronously, so confirm on the Geo-Replication page of the portal, which also shows the secondary's state, the replication mode and the maximum lag).
- Metadata Geo-Disaster Recovery to the pair: a Geo-Recovery alias on a Premium namespace (portal Geo-Recovery page; `az servicebus georecovery-alias` or the disaster-recovery-configs REST API manage it), with a second `microsoft.servicebus/namespaces` resource in the pair region. By inference, the same API lists the pairing.
- Two namespaces used by the application's own logic: no inventory property shows this pattern. Two `microsoft.servicebus/namespaces` resources, even with the same entity names or in the pair region, prove nothing about DR (GC-13: never infer a DR relationship from names or co-location). Record it as Unknown until the owner or the application's configuration confirms that both namespaces are used together.
- Nothing: a Basic or Standard namespace has no native multiregion feature (zone redundancy is automatic in a region with availability zones and is not a regional DR).

The inventory cannot show the effect of the replication mode on the application, the replication lag, whether clients connect through the alias or the namespace name, whether consumers tolerate duplicates, or what the application does when a namespace is unreachable. Record today's DR as Geo-Replication or Geo-Disaster Recovery only when the properties above confirm it, as application-level replication only when the owner or the application's configuration confirms it, else as Unknown; a region or a name alone never proves it. The move to a DR region that is not the pair is decided per namespace by option id: geo-replication replaces the secondary region, metadata-geo-dr builds a new secondary namespace in the DR region and re-pairs, and active-active-namespaces builds a second namespace in the DR region and the replication logic. A namespace never has both Geo-Replication and a Geo-Disaster Recovery pairing.

### Build
1. geo-replication: inventory each namespace: tier, partitioning, messaging units, entities, large messages, auto-delete on idle, Event Grid integration, private endpoints and DNS zones, an existing Geo-Disaster Recovery pairing, role holders and the connection string or alias each client uses. Choose the DR region (any region that supports Service Bus, same continent as the primary where possible, within residency limits), the replication mode and, for asynchronous, the maximum replication lag (starting value 5m, the Estimated RPO of the option); record them as parameters with the reason.
2. geo-replication: if the namespace is Standard, migrate it to Premium first (create a Premium namespace, `az servicebus migration start`, `show`, then `complete`), then drain the old namespace through its post-migration name, send those messages to the Premium namespace and delete the old one. The migration cannot be undone, downtime is approximately 5 minutes, and RBAC is not migrated: add it again on the Premium namespace.
3. geo-replication: if a Geo-Disaster Recovery pairing exists, break it on the primary namespace before enabling Geo-Replication. If Geo-Replication to the pair exists, delete the paired secondary region before adding the DR region (an inference from the single-secondary limit); deleting a secondary deletes its data, and until the new secondary shows Ready there is no usable secondary, so agree the window with the workload owner and write the gap in the runbook.
4. geo-replication: enable Geo-Replication with the DR region as secondary and the chosen mode, in the portal (Add secondary region, Synchronous replication or the maximum lag) or in the template (`geoDataReplication` with the primary and secondary `locations` and `maxReplicationLagDurationInSeconds`), and wait until the secondary shows Ready.
5. geo-replication: build private access in both regions: a private endpoint in each region's network, one `privatelink.servicebus.windows.net` zone per region linked to that network only, peering if one zone is shared, and conditional forwarding or a maintained record to the nearest region's endpoint for on-premises clients. Deploy the application in the DR region against the local endpoint.
6. Decide and assign the roles that the Failover and Failback steps use, and record the roles and their holders in the runbook. Learn names only the data-plane roles Azure Service Bus Data Sender (send), Azure Service Bus Data Receiver (receive) and Azure Service Bus Data Owner (full control) and names no built-in role for the management operations, so the team decides them: for the DR operator, a custom role with the least privilege that allows the promotion or failover operation on the namespace (and read access to its state and metrics); for the Platform engineer, management rights on the namespaces and the resource group for the operations the steps use (add or delete a secondary region, change capacity, create a namespace, create or break a pairing, create private endpoints), Azure Service Bus Data Owner on both namespaces for entity checks and fixes (Learn: full access to the Service Bus resources), and, because the steps recreate role assignments on a secondary, Role Based Access Control Administrator scoped to the resource group or groups in which those namespaces are created and not wider (the role page lists an assignable scope of "/"; the narrower scope is this playbook's design, and a new namespace does not exist yet when this step runs, so a scope on the namespaces themselves cannot cover it), which is the built-in role that Learn describes as creating role assignments; for the Application engineer and each workload identity, only Data Sender and Data Receiver (also on the old primary, to read what remains in it), scoped to the narrowest entity that works. Whether role assignments on a Geo-Replication namespace also apply to its secondary region after a promotion is not stated on the pages read (inference: the secondary is part of one namespace, so assignments are made once); TC-3 checks in the drill that the workload identities, with their role assignments, work after the promotion. For the other two options the assignments are made on each namespace.
7. geo-replication: alert on ReplicationLagDuration per entity (static threshold, Greater than, Minimum over a 10 to 15 minute lookback, checked every minute, threshold from the maximum lag recorded in the Build step that inventories each namespace), set Azure Service Health alerts, and for Event Grid integration write down that it does not follow the promotion and what the team does about it.
8. geo-replication: configure clients with the namespace hostname (never a regional name), the SDK retry policy with exponential backoff to ride out the promotion, and idempotent consumers, because a forced promotion can redeliver a message whose Complete or Defer was not replicated.
9. metadata-geo-dr: take the same namespace inventory as for geo-replication (tier, partitioning, messaging units, entities, large messages, auto-delete on idle, Event Grid integration, private endpoints and DNS zones, an existing Geo-Disaster Recovery pairing, role holders and the connection string or alias each client uses) plus the number of entities (subscriptions and rules count; the first sync runs at about 50 to 100 entities per minute), the partitioning, the non-replicated settings and the RBAC assignments of the primary. Migrate a Standard namespace to Premium first, with the same migration as for geo-replication (create a Premium namespace, `az servicebus migration start`, `show`, then `complete`, drain the old namespace and add RBAC again), and keep its connection string as the alias. Choose the DR region.
10. metadata-geo-dr: create the new Premium secondary in the DR region (same partitioning as the primary, same subscription so that the safe failover can be used). When the primary uses a private endpoint, create private endpoints on the secondary first and then on the primary, in the networks of both application instances, with DNS zone links for both.
11. metadata-geo-dr: pair the namespaces and create the alias (portal Geo-Recovery, Initiate pairing; or the georecovery-alias CLI; for a migrated namespace, the preexisting alias through CLI, PowerShell or REST) and switch every client to the alias connection string. If a pairing with a namespace in the pair region exists, break it before pairing the new secondary: Learn allows breaking a pairing at any time but does not say whether a primary can hold two pairings. Between the break and the moment the new secondary has synchronized (about 50 to 100 entities per minute) the workload has no metadata DR; agree that window with the workload owner and write it in the runbook.
12. metadata-geo-dr: after the namespaces are paired, copy every non-replicated setting by hand, recreate the RBAC assignments on the secondary (namespace-scoped assignments at once, entity-scoped assignments once the pairing has synchronized the entities), and decide the capacity (provision in advance, or write in the runbook that it is scaled during failover and accept the extra downtime). The roles for these steps are those decided in the Build step that assigns the roles of the Failover and Failback steps.
13. metadata-geo-dr: design for lost message data: which messages the application can resend or rebuild, how consumers read what remains in the old primary after it recovers (Microsoft does not restore it in the secondary), and what happens to sessions, scheduled messages and duplicate detection after failover. Add alerts on both namespaces and Service Health alerts, and the monitoring that tells the team when to fail over.
14. active-active-namespaces: this option covers active replication (sender sends two copies tagged with the same unique identifier, receivers read both entities and suppress the second copy); passive replication and all-active replication with replication tasks are other mechanisms and are not built here. Record the tier of each namespace and the time the team sets for the first successful send and receive on the surviving namespace after one namespace is lost (the parameter that TC-8 proves), with its reason, in the runbook. Create the second namespace in the DR region and every entity in both under the same name and settings, with its own private endpoint, DNS zone link, RBAC, network rules and capacity for the full load.
15. active-active-namespaces: implement the pattern. Senders tag both copies with a unique MessageId and handle the failure of one namespace without blocking the other; receivers read both entities and keep a list of processed identifiers. Alert on both namespaces and on the duplicate rate seen by the receivers, and set Service Health alerts.

### Validate
1. geo-replication: run TC-1 weekly, TC-4 weekly and TC-2 daily (for 7 consecutive days before the cut-over), and TC-9 monthly.
2. geo-replication: run TC-3 in a promotion drill on a namespace that mirrors production, once before the cut-over and at every DR drill after it, and TC-5 in the same drill.
3. metadata-geo-dr: run TC-6 weekly and TC-4 weekly, and TC-9 monthly.
4. metadata-geo-dr: run TC-7 in a failover drill on a namespace pair that mirrors production, once before the cut-over and at every DR drill after it, and TC-5 in the same drill.
5. active-active-namespaces: run TC-8 before the cut-over, monthly after it and at every DR drill, TC-4 weekly, TC-9 monthly and TC-5 in the drill of TC-8.
6. Record each result with its date; a time that a drill measured is Demonstrated, and everything from Learn or not measured stays Estimated or Unknown.

### Cut over
1. geo-replication: record the secondary region as the namespace's DR region in the runbook and the application's DR configuration, with the mode, the maximum lag and the role holders recorded in the Build step that assigns the roles, and remove the runbook steps that depended on the old paired secondary.
2. metadata-geo-dr: make the alias the only connection string in every client, record the secondary namespace as the DR namespace with its role holders, and put the message recovery plan of the Build step that designs for lost message data and the rule that a failover is followed by a new pairing with a new namespace (and that a return is another pairing and failover, not a reversal) into the runbook.
3. active-active-namespaces: switch the application to the two-namespace logic in production and record both namespaces and the behaviour when either is unreachable in the runbook.

### Decommission
1. geo-replication: after validation passed, remove the private endpoints, DNS zone links and runbook entries that served only the old pair region.
2. metadata-geo-dr: after validation passed, read what you still need from the old pairing's secondary namespace in the pair region, then delete it with its private endpoints, DNS zone links and role assignments.
3. active-active-namespaces: after validation passed, remove the single-namespace configuration and any Geo-Disaster Recovery alias or Geo-Replication setup that still points at the old pair region.

### Keep until cut-over
For geo-replication: Learn supports a single secondary, so the old paired secondary cannot be kept next to the new one (an inference); keep the runbook that describes the gap and the application's current connection string. For metadata-geo-dr: the existing pairing does not stay, because Build breaks it before the new pairing (Learn does not say whether a primary can hold two); what stays until TC-6 and TC-7 passed is the old secondary namespace, which is not deleted until Decommission, and the old failover runbook, and the window without metadata DR is the one Build wrote down. For active-active-namespaces: the existing DR arrangement and the single-namespace configuration stay as the way back until TC-8 passed and the cut-over is accepted.

## Failover and failback

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region or namespace is unavailable or degraded and declare DR for the workload; Microsoft does not start a promotion or failover, so the customer decides | Incident manager | Estimated unknown (a decision; measured in the first drill) | The declaration is recorded with its time and its Service Health or metric evidence | The primary answers again before the declaration |
| 2 | geo-replication: read the state of the secondary region on the Geo-Replication page and ReplicationLagDuration per entity | Platform engineer | Estimated unknown (a portal and metric read; measured in the first drill) | The secondary shows Ready and the lag per entity is recorded as the data at risk of a forced promotion | The secondary shows InBuild: Learn says to check the state before promoting, so the application owner decides whether to promote anyway and records it |
| 3 | geo-replication: choose the promotion type: forced when the primary region is in outage, planned only when both regions are available (a planned promotion rejects new messages and consumer operations until it completes) | Incident manager | Estimated unknown (a decision; measured in the first drill) | The type and the reason are recorded | A planned promotion is chosen while a region is unavailable: choose forced instead |
| 4 | geo-replication: start the promotion in the portal (Promote, then follow the pop-up pane, where the planned or forced type is chosen), or with `az servicebus namespace failover --namespace-name <namespace> --resource-group <group> --primary-location <DR region>`; Learn's page shows that command without any option for the promotion type, so use the portal for a forced promotion unless the Azure CLI reference confirms an option for it | DR operator (role decided in Build) | Estimated 10m (Learn: about 5 to 10 minutes plus DNS time; TC-3 proves it) | The hostname resolves to the DR region (Learn: `ping <namespace FQDN>` shows the current primary region) | The hostname still points to the old primary after the Estimated duration and the clients' DNS time-to-live: open a support request with Azure support |
| 5 | geo-replication: start or release the application in the DR region and let clients reconnect to the namespace hostname through the local private endpoint | Application engineer | Estimated unknown (measured in the first drill of the application) | Senders and receivers work in the DR region, errors during the promotion were retried and consumers handle redelivered messages | A consumer fails on duplicates: stop it, keep the rest in DR and record the gap for the application owner |
| 6 | geo-replication: after a forced promotion, once the old primary region is reachable, delete it from the configuration and add a new secondary region (Learn's recommended steps) | Platform engineer | Estimated unknown (depends on the data to resynchronize; measured in the drill) | The new secondary shows Ready and TC-1 passes | The old region is not reachable: leave the namespace without a secondary and repeat when it is |
| 7 | metadata-geo-dr: check the secondary namespace before any client uses it: entities, non-replicated settings, private endpoints and RBAC assignments (Learn: recent metadata changes might not have replicated) | Platform engineer | Estimated unknown (entity count at about 50 to 100 entities per minute plus the checks; measured in the drill) | The secondary's entities and settings equal the primary's last known configuration (TC-6 evidence) | A missing entity or setting: create it in the secondary, or record the gap that the application owner accepts |
| 8 | metadata-geo-dr: choose the failover type: safe failover when the primary region is available and both namespaces are in one subscription, otherwise forced | Incident manager | Estimated unknown (a decision; measured in the first drill) | The type and the reason are recorded | A safe failover is chosen while the primary region is in outage or the namespaces are in different subscriptions (Learn: it fails): choose forced instead |
| 9 | metadata-geo-dr: start the failover (Failover in the portal, typing the alias, or the georecovery-alias CLI or REST) | DR operator (role decided in Build) | Estimated 10m (Learn: typically 5 to 10 minutes, DNS can take longer; TC-7 proves it) | The alias resolves to the secondary namespace and the pairing is removed | The alias still points to the old primary after the Estimated duration and the clients' DNS time-to-live: open a support request with Azure support |
| 10 | metadata-geo-dr: scale the secondary to the full load if it was not provisioned in advance | Platform engineer | Estimated unknown (the scaling time is not published; measured in the drill) | The secondary shows the planned capacity and no throttling at the load of the day | The secondary cannot carry the load: shed load by the application owner's priority order and record it |
| 11 | metadata-geo-dr: start the application in the DR region on the alias, record that message data in the old primary is unavailable and start the application's recovery of lost messages | Application engineer | Estimated unknown (depends on the recovery plan; measured in the drill) | Senders and receivers work on the secondary and the lost messages are listed | The recovery plan cannot rebuild messages: the application owner decides on the gap and records it |
| 12 | metadata-geo-dr: create a new namespace and its private endpoints, pair it with the secondary that is now primary, to have DR again (the failover is one-way and the old primary is not re-paired), then recreate the non-replicated settings, the namespace-scoped RBAC assignments and, once the entities have synchronized, the entity-scoped RBAC assignments (as in the failback step that pairs a new namespace in the recovered region) | Platform engineer | Estimated unknown (depends on the entity count at about 50 to 100 entities per minute plus the settings; measured in the drill) | The new pairing shows on the alias page and TC-6 passes for the new pair | The pairing fails (for example a private endpoint is missing on the new namespace): fix it, and the workload runs without DR until it holds |
| 13 | active-active-namespaces: confirm which namespace is unreachable, check that senders keep sending to the other and receivers keep receiving from it, and let duplicate suppression run | Application engineer | Estimated unknown (measured in the drill of TC-8) | Messages sent after the loss are received once from the surviving namespace and the duplicate rate is recorded | A sender blocks waiting for the unreachable namespace: switch it to the surviving namespace through the application's configuration |
| 14 | active-active-namespaces: check that the surviving namespace carries the full load and add capacity if not | Platform engineer | Estimated unknown (the capacity change time is not published; measured in the drill) | The surviving namespace shows no throttling at the load of the day | Throttling persists: shed load by the application owner's priority order |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the original region and its namespace are available again | Incident manager | Estimated unknown (measured in the first drill) | The original region answers and Service Health shows no open issue for it | The region is still degraded or unavailable |
| 2 | geo-replication: add the original region as a new secondary region (after a forced promotion delete the old primary region first, as in the failover step that adds a new secondary region after a forced promotion) and wait for it to show Ready with the lag back within the recorded maximum | Platform engineer | Estimated unknown (depends on the data to resynchronize; measured in the drill) | The secondary shows Ready and TC-1 and TC-2 pass | The secondary stays InBuild or the lag stays above the maximum: stay in the DR region |
| 3 | geo-replication: promote the original region back with a planned promotion in a maintenance window (the same promotion process; both regions are available, so a planned promotion is possible) | DR operator (role decided in Build) | Estimated 10m (Learn: about 5 to 10 minutes plus DNS time; TC-3 proves it) | The hostname resolves to the original region and the new secondary shows Ready | The hostname does not move or data differs: stay in the DR region and open a support request with Azure support |
| 4 | metadata-geo-dr: create a new namespace in the recovered region with its private endpoints and pair it with the namespace that is now primary (a return is a new pairing with a new namespace and a second failover, never a reversal; Learn says the former primary is used for regular messaging outside the setup, or deleted), recreate the non-replicated settings and the namespace-scoped RBAC assignments, wait for the entities to synchronize, and then recreate the entity-scoped RBAC assignments | Platform engineer | Estimated unknown (entity count at about 50 to 100 entities per minute plus the settings; measured in the drill) | TC-6 passes for the new pair | The pairing fails (for example a private endpoint is missing on the new namespace): fix it, the workload stays on the temporary primary |
| 5 | metadata-geo-dr: read the messages that remain in the old primary and process them in the application (Microsoft does not restore them in the secondary), then decide whether to fail over again; Learn notes potential loss of messages sent to the temporary primary | Application engineer | Estimated unknown (depends on message volume; measured in the drill) | The remaining messages are processed and counted | A message cannot be processed: record it for the application owner and do not fail over again until the decision is made |
| 6 | metadata-geo-dr: if returning, repeat the failover steps that choose the failover type and start the failover, with the new namespace in the original region as the target, then pair again with another new namespace | DR operator (role decided in Build) | Estimated 10m (Learn: typically 5 to 10 minutes plus DNS time) | The alias resolves to the new namespace in the original region | The new namespace's configuration differs from the temporary primary's: stay on the temporary primary |
| 7 | active-active-namespaces: restore the recovered namespace: compare its entities with the other and recreate any that differ | Platform engineer | Estimated unknown (measured in the drill of TC-8) | The entities of both namespaces are the same | An entity cannot be recreated with the same settings: keep sending to the surviving namespace only |
| 8 | active-active-namespaces: drain and reconcile the messages left in the recovered namespace and resume sending to both | Application engineer | Estimated unknown (measured in the drill of TC-8) | TC-8 passes for both namespaces | Reconciliation finds messages in only one namespace that cannot be processed twice: keep sending to the surviving namespace only |

## Test criteria

### TC-1: Geo-Replication is configured as planned
- Applies to: geo-replication
- Pass condition: Learn's Azure Resource Graph query returns the namespace as Premium with exactly one Secondary location, which is the DR region; the secondary shows Ready on the Geo-Replication page; the mode and maximum replication lag equal the values recorded in Build; and no Geo-Disaster Recovery pairing exists on the namespace.
- How to measure: run the Resource Graph query on `microsoft.servicebus/namespaces` (`properties.geoDataReplication.locations`, `roleType` Secondary), read the Geo-Replication page (an empty result is not proof, since Resource Graph is asynchronous), and list Geo-Recovery aliases with the georecovery-alias CLI.
- Evidence: the query output and a portal capture with their date, the secondary region and state, the mode and the lag setting.
- Frequency: weekly

### TC-2: The replication lag stays within the recorded maximum
- Applies to: geo-replication
- Pass condition: for 7 consecutive days, with the asynchronous maximum replication lag recorded in Build set to 5 minutes (the Estimated RPO bound of asynchronous mode, a team-set starting value to replace with the team's own), the ReplicationLagDuration of every entity stays below that maximum, the namespace does not throttle because of lag, and in synchronous mode (whose Estimated RPO of 0 is Learn's separate statement) no write fails because the secondary is unavailable.
- How to measure: Azure Monitor metrics ReplicationLagDuration and ReplicationLagCount split by EntityName (Maximum to see peaks, Minimum over the lookback to see sustained lag), the alert on ReplicationLagDuration set in Build, and a Log Analytics query on AzureMetrics for MetricName ReplicationLagDuration; count throttled and failed requests in the same period.
- Evidence: the 7-day metric export with the maximum per entity, the alert history and the throttling and failure counts.
- Frequency: daily

### TC-3: A promotion moves the workload to the DR region
- Applies to: geo-replication
- Pass condition: in a promotion drill on a namespace that mirrors production, the hostname resolves to the DR region within the Estimated RTO of the option; the application in the DR region sends and receives through its local private endpoint, authenticating with its workload identities and their role assignments (a refused or unauthorized request counts as a failure); a planned promotion loses no message (count sent equals count received); lost or duplicated messages of a forced promotion are counted and are no more than the application owner accepted; and the old primary becomes a secondary.
- How to measure: send numbered messages before and during the drill with the workload identities (not an administrator identity), time the promotion from the start command to the first successful send and receive from the DR region, check `ping <namespace FQDN>` and the Geo-Replication page, read the authorization failures in the namespace logs, and compare the sent, received and duplicate counts.
- Evidence: the drill record with timestamps, the command output, the counts and the measured time (Demonstrated); a real outage's time stays Estimated until observed.
- Frequency: once before cut-over and at every DR drill after it

### TC-4: Private access works from every region's network
- Applies to: geo-replication, metadata-geo-dr, active-active-namespaces
- Pass condition: from each application network, the namespace name (the alias, or each namespace's name) resolves to the local private endpoint's private IP address through that region's `privatelink.servicebus.windows.net` zone, every private endpoint connection is Approved and a test send and receive succeeds over it; for metadata-geo-dr both namespaces have a private endpoint in both application networks. Design check, not drillable: the path after a real regional failure cannot be caused by the customer, so the check measures the path before it.
- How to measure: resolve the name from inside each network, list private endpoint connections and DNS zone links, and send and receive a test message from each network; for Geo-Disaster Recovery send Learn's Get queues request to the secondary from outside the virtual network and verify that the service returns an error.
- Evidence: the resolution output, the connection list, the test message result and the zone link list, with their date.
- Frequency: weekly

### TC-5: Consumers and senders tolerate duplicates, delays and retries
- Applies to: geo-replication, metadata-geo-dr, active-active-namespaces
- Pass condition: when the drill redelivers a batch of messages that carry the same MessageId (as a forced promotion or a second copy can), each message is processed once and the duplicates are counted; senders retry through the promotion or failover window without losing an acknowledged message; for metadata-geo-dr, sessions, scheduled messages and duplicate detection are exercised after failover and the result is recorded against the application owner's expectation.
- How to measure: a harness that sends a numbered batch with unique MessageIds twice, and a drill step that runs the consumers across a promotion or failover; compare processed counts with sent counts and read the application's duplicate log.
- Evidence: the harness report with sent, processed and duplicate counts and the retry log.
- Frequency: every DR drill

### TC-6: The secondary namespace matches the primary
- Applies to: metadata-geo-dr
- Pass condition: the secondary has the same entities (queues, topics, subscriptions, rules) and partitioning as the primary, a private endpoint in the networks of both application instances, the same value as the primary for each setting that Learn lists as not replicated (network configuration, private endpoint connections, network access and default action, identities and encryption, auto scale, local authentication, Event Grid subscriptions), and the primary's RBAC assignments recreated.
- How to measure: list the entities of both namespaces and diff them (allow for about 50 to 100 entities per minute of synchronization after a change), and read the namespace properties and role assignments of both with a read-only query or in the portal.
- Evidence: the diff output and the property and role assignment lists of both namespaces with their date.
- Frequency: weekly

### TC-7: A failover moves the alias to the secondary namespace
- Applies to: metadata-geo-dr
- Pass condition: in a failover drill on a namespace pair that mirrors production, the alias resolves to the secondary within the Estimated RTO of the option, the pairing is removed, senders and receivers work on the secondary at the planned capacity, and a new pairing is created afterwards. Design check, not drillable: message data in the primary is unavailable in a real regional outage, so this part passes when the runbook holds the application's plan for lost messages and for reading the old primary's messages after it recovers.
- How to measure: time the failover from the start command to the first successful send and receive on the alias, check that the pairing is gone, and review the runbook and the recovery plan against the message types in the namespace.
- Evidence: the drill record with timestamps and the measured time (Demonstrated), the pairing state after the failover and the review record.
- Frequency: once before cut-over and at every DR drill after it

### TC-8: Both namespaces receive the traffic and duplicates are suppressed
- Applies to: active-active-namespaces
- Pass condition: over a test window every message sent through the application's logic exists once in each namespace, and the longest time between its existence in the first and in the second namespace is within the Estimated RPO of 15 minutes (a team-set starting value to replace with the team's own); receivers process each unique identifier once; and with one namespace made unreachable in a drill, the first successful send and receive on the surviving namespace is measured within the Estimated RTO of 10 minutes, with no acknowledged message lost.
- How to measure: send numbered messages with unique identifiers, compare the message counts per entity in both namespaces, read the receivers' processed and suppressed counts, and block one namespace with a network rule and time the first successful send and receive.
- Evidence: the counts per namespace and entity, the receivers' counts and the measured times (Demonstrated).
- Frequency: before cut-over, then monthly and at every DR drill

### TC-9: The DR side has the capacity of the primary
- Applies to: geo-replication, metadata-geo-dr, active-active-namespaces
- Pass condition: the DR side has at least the messaging units of the primary (for Geo-Replication each replica runs on the same number as the primary; for the other two options the secondary namespace's capacity equals the primary's, or the runbook records the decision to scale during failover), and a load test at the peak load of the day shows no throttling on the DR side.
- How to measure: read the messaging units of each namespace or replica, and run a load test against the DR side in a drill while reading the throttling metrics.
- Evidence: the capacity list of both sides, the load test report and the throttling counts, with their date.
- Frequency: monthly
