---
service: key-vault
title: Azure Key Vault
arm_types:
  - microsoft.keyvault/vaults
slot: secrets-keys
version: 1
verified_on: 2026-11-10
learn_sources:
  - https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault
  - https://learn.microsoft.com/en-us/azure/key-vault/general/backup
  - https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support
  - https://learn.microsoft.com/en-us/azure/key-vault/general/migrate-key-workloads
  - https://learn.microsoft.com/en-us/azure/key-vault/keys/about-keys-details
  - https://learn.microsoft.com/en-us/azure/key-vault/keys/hsm-protected-keys-byok
  - https://learn.microsoft.com/en-us/azure/key-vault/certificates/about-certificates
  - https://learn.microsoft.com/en-us/azure/key-vault/certificates/overview-renew-certificate
  - https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide
  - https://learn.microsoft.com/en-us/azure/key-vault/general/private-link-service
  - https://learn.microsoft.com/en-us/azure/key-vault/general/key-vault-recovery
  - https://learn.microsoft.com/en-us/azure/key-vault/general/event-grid-overview
  - https://learn.microsoft.com/powershell/module/az.keyvault/restore-azkeyvaultkey
  - https://learn.microsoft.com/en-us/rest/api/keyvault/keys/import-key/import-key
---

# Azure Key Vault

## Mechanisms

### Microsoft-managed replication and failover
- Replicates: data (the keys, secrets and certificates of the vault), asynchronously to the paired region when the pair is in the same geography as the primary region
- Paired: yes
- Nonpaired: no
- Failover: Microsoft-managed
- Estimated RPO: unknown (Learn: replication to the paired region is asynchronous and "there might be some data loss if changes aren't replicated to the secondary region before the primary region fails"; no figure is published)
- Estimated RTO: unknown (Learn: Microsoft decides on and triggers the failover, which "can take several hours after the loss of the primary region, or longer in some scenarios"; Learn describes no customer-initiated failover, so the figure cannot be measured in a drill)
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault#microsoft-managed-failover-to-a-paired-region

## Constraints

### The multiregion reference lists paired regions only
Learn's list of Azure services that support multiple regions marks the Microsoft-managed failover of Key Vault for paired regions and not for nonpaired regions, and points nonpaired regions to a custom multiregion solution.
- Source: https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support

### Paired replication only reaches a pair in the same geography
The contents of a vault are replicated to the paired region only when the region has a paired region in the same geography as the primary region. Learn lists failing over to a region that is not the primary's pair, and a vault in a nonpaired region, as cases where the Microsoft-managed failover is not suitable.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault#custom-multiregion-solutions-for-resiliency

### Regions without Microsoft-managed replication
Brazil South, Brazil Southeast, West US 3 and any region that has no paired region do not support Microsoft-managed replication or failover across regions.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault#microsoft-managed-failover-to-a-paired-region

### Microsoft-managed failover is triggered by Microsoft on a best-effort basis
Microsoft triggers the failover. It is likely to occur after a significant delay, it is done on a best-effort basis, and it can happen at a different time from the failover of other Azure services. Learn names Microsoft as the only party that triggers it and describes no customer-initiated failover, failover setting or failover drill: the customer cannot start the failover, cannot bring it forward and cannot rehearse it, so a recovery time for it can only be observed in a real regional failover. While the failover is in progress the vault might be unavailable for a few minutes, and active requests during it might fail and have to be retried.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault#microsoft-managed-failover-to-a-paired-region

### The vault is read-only after a Microsoft-managed failover
After the failover the vault supports only list and get of certificates and secrets, list of keys and get (properties of) keys, and encrypt, decrypt, wrap, unwrap, verify, sign and backup. The list has no create, import, update, delete or renew operation, so nothing can be written or renewed while the vault is read-only. Vault properties, access policies and firewall settings cannot be changed while the vault operates in the secondary region, so every network rule and access setting that DR needs is made before the failover.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault#considerations

### Private Link reconnects up to 20 minutes after a region failover
When the vault is reached through Private Link, the connection can take up to 20 minutes to be re-established after the region failover. This is the only figure Learn gives for the path after the failover, and it can be observed only in a real failover.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault#behavior-during-a-region-failure

### Backups restore only in the same subscription and geography
A backup is an encrypted blob that cannot be decrypted outside Azure, and it can be restored only into a key vault in the same Azure subscription and Azure geography. Backup and restore therefore cannot copy objects into a vault in another geography. Within one subscription and one geography the target does not have to be the pair: the restriction is the geography, not the pairing.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/general/backup#design-considerations

### Backups are per object and point in time
Keys, secrets and certificates are backed up one object at a time: there is no backup of a whole vault in one operation. A backup is a point-in-time snapshot that does not follow later changes, and a backup of an object with more than 500 past versions is not supported and may result in an error.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/general/backup#limitations

### A restored copy is independent of the original
A key restored into another vault is fully independent of the original: disabling, deleting or purging the original has no effect on the restored copy, and Key Vault has no way to revoke a backup blob or a key that was already restored. Every disable, rotation or deletion that has to reach the DR vault is applied to the DR vault as well, and the permission to back up and restore is limited to the identities that need it.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/general/backup#security-considerations

### Keys cannot be exported, only backed up or imported
Key Vault does not support an export operation: when a key is created, the service generates the value and does not release it, and once a key is provisioned its material cannot be extracted. To move a key, use backup and restore, and a backup cannot be used outside the service. A key created in the vault therefore has no copy outside the vault, "create it again" gives different key material, and data wrapped or encrypted under the original key (for example the customer-managed key of another service) cannot be unwrapped or decrypted with the new key. The one exception is a key created with a key release policy, which is released only to confidential computing environments that you define. A key that was imported has its source outside the vault, and Get returns only the public part of an asymmetric key.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/keys/about-keys-details#key-operations

### A key restore creates the key with all its versions and never overwrites
Learn's Restore-AzKeyVaultKey page says that restoring a backup creates a key that is a replica of the backed-up key and has the same name, that all versions in the backup are restored, and that the restore fails instead of overwriting when the vault already has a key of that name. A restore can therefore seed a key that does not yet exist in the DR vault, but it cannot add a later version to a key that is already there.
- Source: https://learn.microsoft.com/powershell/module/az.keyvault/restore-azkeyvaultkey

### Importing under an existing key name adds a new version
The Key Vault REST API says that when a key is imported and the named key already exists, Key Vault creates a new version of the key. A BYOK key that is imported again under the same name in each vault therefore follows the versions of its source.
- Source: https://learn.microsoft.com/en-us/rest/api/keyvault/keys/import-key/import-key

### The same key material in two geographies needs bring your own key
Each Azure geography has its own security domain, so a vault in one geography cannot share key material with a vault in another geography, and backup and restore does not cross it. To use the same key material in vaults of different geographies, create the key in an HSM that you control and import it into each vault with bring your own key (BYOK), which needs a Key Vault Premium (or Managed HSM) as the target for an HSM-protected key and a supported HSM with its vendor's BYOK tool. Each vault holds the key under a different key URI even though the material is the same, so each regional deployment must reference its own key URI. For an Azure service that uses a customer-managed key, Learn's pattern is to create a new key in the new vault, give the workload access to it and update the workload to use it.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/general/migrate-key-workloads#using-the-same-key-material-across-multiple-key-vaults-or-managed-hsms-in-different-geographies

### HSM-protected BYOK import needs a Premium vault and an import-only key exchange key
To import an HSM-protected key, generate a key exchange key (KEK) in the target vault: an RSA-HSM key of 2,048, 3,072 or 4,096 bits whose only allowed operation is import, which only a Key Vault Premium or Managed HSM supports. The KEK must be in the same vault where the target key is imported, and it is not exportable. The key transfer file made by the HSM vendor's tool is then uploaded to that vault, so the import is repeated for each vault. Learn's Import Key operation also imports a software key (Hsm false), which needs no HSM, so Premium is required for HSM-protected imports only.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/keys/hsm-protected-keys-byok#generate-a-kek

### Certificates are renewed in each vault and a non-exportable private key cannot be read
A certificate whose policy marks the key as exportable can be read with its private key as a secret in PFX or PEM format; if the key is non-exportable, the private key is not part of the secret value, and HSM keys are non-exportable. Certificate issuers are objects of one vault and can be used only with certificates of that vault, and certificate contacts are shared by the certificates of one vault. A certificate that an integrated certificate authority (DigiCert or GlobalSign) issues with an autoRenew lifetime action is renewed by the vault that holds it, as a new version with a new identifier, so a second vault renews its own certificate and does not receive the first vault's renewal.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/certificates/about-certificates#exportable-or-non-exportable-key

### Renewal creates a new version with a new identifier
A certificate is a versioned object: each new version is conceptually a new certificate made of a key and a blob that ties it to an identity. When an integrated-CA certificate is renewed, a new secret version with a new Key Vault identifier is created, and a certificate from a non-integrated CA needs a new version made by the owner (a CSR signed by the CA and merged). Consumers therefore refer to the object name without a version, so that they follow renewals.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/certificates/overview-renew-certificate#renew-an-integrated-ca-certificate

### Key Vault events fire only for new versions and near expiry
Event Grid notifies on a secret, key or certificate that is about to expire (30 days before expiration), has expired or has a new version. The events fire only for new versions, and the subscription must exist on the vault before the events are sent. Deletes and property changes are not in this list, so an event-triggered sync always needs a scheduled reconciliation next to it.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/general/event-grid-overview

### Access is granted per vault with Azure RBAC roles
For vaults that use the Azure role-based access control permission model, the data-plane built-in roles are Key Vault Administrator, Key Vault Reader (metadata only), Key Vault Secrets User and Key Vault Secrets Officer, Key Vault Certificates Officer, Key Vault Crypto User, Key Vault Crypto Officer and Key Vault Crypto Service Encryption User (wrap and unwrap only), and Key Vault Data Access Administrator manages their assignments. Key Vault Secrets User reads the secret portion of a certificate, including its private key. Key Vault Contributor is for the control plane only and gives no access to keys, secrets or certificates. A role assignment belongs to one vault (or a scope above it), so the DR vault needs its own assignments, and a custom role can limit a pipeline to the key read, backup and restore data actions.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide#azure-built-in-roles-for-key-vault-data-plane-operations

### Private access needs a private endpoint, a DNS zone and a link per network
A private endpoint and its virtual network must be in the same region, while the vault can be in another region. The private endpoint targets the sub-resource vault and needs a private DNS zone with the exact name privatelink.vaultcore.azure.net, linked to every virtual network that calls the vault, with an A record for the vault name (a conditional forwarder for vault.azure.net and vaultcore.azure.net serves on-premises callers). Without the link the name resolves to the public IP address. The number of private endpoints per vault is limited.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/general/private-link-service#prerequisites

### The custom multiregion solution has three parts
Learn's custom solution creates separate key vaults in different regions, uses backup and restore to keep the secrets consistent across the regions, and implements application-level logic that fails over between the vaults. Learn also names backup and restore as a way to replicate the contents of a vault to another region of your choice. Backup and restore works only within one geography (see the constraint on backups), so the custom solution has to be completed for keys and certificates that cannot cross it.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault#custom-multiregion-solutions-for-resiliency

### Soft delete and purge protection are recommended
Learn recommends soft delete (a default retention of 90 days) and purge protection for production vaults, against accidental or malicious deletion. Key vault names are globally unique, so the DR vault needs a name other than the primary's and other than any soft-deleted vault. Once soft delete is enabled it cannot be disabled, and once purge protection is enabled nobody can disable it, so a vault removed in a drill keeps its name until the retention period elapses.
- Source: https://learn.microsoft.com/en-us/azure/key-vault/general/key-vault-recovery#what-are-soft-delete-and-purge-protection

## Non-paired options

### secondary-vault-sync: Second vault in the DR region, synced by a pipeline
- Kind: workaround
- Target: dr-region
- Uses mechanism: none
- Estimated RPO: 15m (Estimated, team-set starting value: the sync interval the team sets for the pipeline for the secrets, imported keys and copied certificates it carries (a restored key is carried once per key name and has no sync interval); Learn publishes no figure for a custom multiregion solution; TC-2 proves it)
- Estimated RTO: 30m (Estimated, team-set starting value: the switch-over time the team designs for the application to use the DR vault; Learn publishes no figure; TC-3 proves it)
- Prerequisites: a DR vault with its own globally unique name in the DR region, with soft delete, purge protection, the Azure RBAC permission model and a private endpoint, private DNS zone link and A record in the DR network; an inventory of every secret, key and certificate with its origin class (secret; imported key; vault-generated key; certificate whose key is exportable; certificate from an integrated certificate authority; certificate whose key is not exportable) and a DR path per class, because a vault-generated key has no source outside the vault and a backup restores only within the same subscription and geography; for imported keys an HSM or other source you control (and a Premium DR vault when the key is HSM-protected); a pipeline identity with write roles on the DR vault only and read or backup roles on the primary; the DR deployment's own vault URI and key URIs in its configuration.
- Cost notes: a second vault (Premium when HSM-protected or BYOK keys are used), its operations, the private endpoint and the pipeline runs; no price.
- Gives up: the Microsoft-managed failover; the same key material for vault-generated keys when the DR region is in another geography (the DR vault then holds its own key and the owner of each consumer decides how data under the primary key is handled in DR); in-place rotation of a vault-generated key that is carried by restore (a restore cannot add a version, so such a key is rotated under a new name); a certificate from an integrated certificate authority or with a non-exportable key is not a copy but a second certificate that the DR vault orders or creates itself.
- Recommended when: the DR region is not the primary's pair or lies outside the primary's geography, and the application can switch to a second vault, and every key has a DR path in the inventory.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault#custom-multiregion-solutions-for-resiliency

### paired-failover-split: Rely on the Microsoft-managed failover to the pair and read across regions
- Kind: split-region
- Target: pair-region
- Uses mechanism: Microsoft-managed replication and failover
- Estimated RPO: unknown (no Learn number: Learn says replication to the paired region is asynchronous and "There might be some data loss if changes aren't replicated to the secondary region before the primary region fails"; no team-set value is given, because the replication and the failover are controlled by Microsoft and the customer can neither drive nor drill them, so no test criterion could prove a team-set value)
- Estimated RTO: unknown (no Learn number: Learn says the failover "can take several hours after the loss of the primary region, or longer in some scenarios" and that the vault "might be unavailable for several hours or until Microsoft initiates failover", which is not a figure; no team-set value is given, because the failover is Microsoft-triggered and the customer cannot drive or drill it; Learn describes no customer-initiated failover)
- Prerequisites: the primary region has a pair in the same geography and is not Brazil South, Brazil Southeast or West US 3; a network path from the DR region to the vault that works after the failover, built before DR because firewall and access settings cannot be changed while the vault is read-only (a private endpoint in the DR region's virtual network, the private DNS zone privatelink.vaultcore.azure.net linked to that network, the vault name and not an IP address in the application's configuration, and an allowance for the up to 20 minutes that Private Link needs to reconnect); role assignments for the DR workload identity on the vault (Key Vault Secrets User, Key Vault Crypto User or Key Vault Crypto Service Encryption User); a residency check for the pair region; the application needs only the operations of a read-only vault while in DR; no secret or certificate it needs expires within the vault outage limit that the application owner sets.
- Cost notes: Learn lists no extra cost for the built-in replication; the private endpoint and cross-region traffic from the DR region to the vault; no price.
- Gives up: a vault in the DR region; writes and renewals during DR (the vault is read-only after the failover); control over when the failover happens, and any way to drill it.
- Recommended when: residency allows the pair region, the application only reads secrets and uses keys during DR, and a recovery time of several hours or more for the vault is acceptable.
- Source: https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault#microsoft-managed-failover-to-a-paired-region

## Migration from a paired setup

### Recognise today's setup
A vault in a region whose pair is in the same geography, and that is not Brazil South, Brazil Southeast or West US 3, relies today on the Microsoft-managed replication to the pair. The replication is built in, so the inventory shows no setting for it: it shows one vault per application and no vault in the DR region. Record today's DR as the Microsoft-managed failover to the pair when the region list in Constraints confirms it, else as Unknown. Migration to a DR region that is not the pair is decided per vault, by option id: secondary-vault-sync builds a second vault and a pipeline; paired-failover-split builds nothing in the vault and only validates that DR consumers in the new DR region can read the vault in the pair and live with a read-only vault. The two can be mixed across the vaults of one workload (for example a vault with only secrets on paired-failover-split and a vault with keys that must be writable on secondary-vault-sync), never on one vault.

### Build
1. secondary-vault-sync: take the inventory of every secret, key and certificate the application uses (a vault holds no whole-vault export, so list each object) and record for each its name, type, origin class (secret; imported key; vault-generated key; certificate whose key is exportable; certificate from an integrated certificate authority; certificate whose key is not exportable), consumers, expiry date, number of versions (a backup of an object with more than 500 past versions is not supported and may result in an error) and the owner of each consumer; this inventory is what TC-1 compares.
2. secondary-vault-sync: decide the DR path per key from the inventory: an imported key is imported again into the DR vault from its HSM or source (BYOK into a Premium DR vault when the key is HSM-protected, a software key import otherwise); a vault-generated key is backed up in the primary and restored once in the DR vault (a restore creates the key with all its versions and cannot add a version to an existing key) when the DR vault is in the same subscription and geography; a vault-generated key with the DR region in another geography cannot be copied, so the DR vault gets its own key and the owner of each consumer records how data under the primary key is handled in DR (re-encrypted under the DR key, or rebuilt in DR with its own data keys); going forward such a key can be created in an HSM you control and imported into both vaults.
3. secondary-vault-sync: create the DR vault in the DR region with a globally unique name (not the primary's, not a soft-deleted vault's), the same SKU as the primary (Premium when it holds HSM-protected keys or receives HSM-protected BYOK keys), the Azure RBAC permission model, soft delete with the retention you choose (it cannot be disabled afterwards) and purge protection (nobody can disable it afterwards), and the same tags and Azure Policy assignments as the primary; deploy it from the same template as the primary with the region and the name as parameters.
4. secondary-vault-sync: build the private access in the DR region: a subnet and a private endpoint with the target sub-resource vault in the DR virtual network (the endpoint and the network must be in the same region), the private DNS zone privatelink.vaultcore.azure.net (create it, or reuse the zone that the primary's network already uses) linked to every virtual network that runs DR consumers and to the pipeline's network, an A record for the DR vault name that points to the endpoint's private IP address, conditional forwarders for vault.azure.net and vaultcore.azure.net to an Azure DNS Private Resolver for on-premises callers, and public network access disabled with the firewall default action set to deny when the primary does the same.
5. secondary-vault-sync: assign the Azure RBAC roles on the DR vault scope and allow several minutes for them to take effect: the DR workload's managed identity gets Key Vault Secrets User (secrets and the private key of a certificate), Key Vault Crypto User or Key Vault Crypto Service Encryption User (keys) and Key Vault Reader only if it must read metadata; the pipeline identity gets Key Vault Secrets Officer, Key Vault Certificates Officer and Key Vault Crypto Officer on the DR vault, and on the primary only Key Vault Secrets User, Key Vault Reader and a custom role such as Learn's Backup Keys Operator (keys read, backup and restore data actions) for the keys that are backed up; nobody gets Key Vault Administrator for the pipeline, and no human holds write roles on the DR vault, so the pipeline is its only writer. For failback, name in the runbook the primary vault's writer (the identity that writes secrets and certificates to the primary in normal operation) and check that it holds Key Vault Secrets Officer and Key Vault Certificates Officer on the primary vault, so that the changes made during DR can be written back there; the pipeline gets no write role on the primary.
6. secondary-vault-sync: send the diagnostic logs of both vaults to a log workspace and alert on the KeyBackup, KeyRestore, SecretBackup, SecretRestore, CertificateBackup and CertificateRestore operations of any identity other than the pipeline's; set Resource Health alerts and Service Health alerts on both vaults; set an alert when the pipeline's last successful run is older than the Estimated RPO.
7. secondary-vault-sync: build the secret sync in the pipeline: for each secret in the inventory read the current value from its source of truth (or from the primary vault when the primary is the source) and write it to the DR vault under the same name, with the same content type, activation and expiry dates and tags, as a new version only when the value changed; the pipeline never prints a value and the job logs hold names and hashes only. Trigger it from an Event Grid subscription on the primary vault for new-version events (create the subscription first, because events are sent only after it exists) and from a schedule at the sync interval the team sets (the 15m of the Estimated RPO), because deletes and property changes raise no event.
8. secondary-vault-sync: build the key sync per class from the Build step that decides the DR path per key: for restored keys run the backup of the key in the primary and the restore of the blob in the DR vault once per key name, which creates the key with all its versions at that time; a restore fails when the DR vault already holds a key of that name, so a new version made in the primary later (by hand or by a rotation policy) cannot be added to the DR copy by another restore; set no rotation policy on these keys, and rotate one by creating a new key under a new name in the primary, backing it up, restoring it in the DR vault, pointing every regional deployment at the new key name, and keeping the old key until the data under it is re-wrapped (a soft-deleted key keeps its name until it is purged, and purge protection blocks the purge until the retention period elapses); compare the public part of the key in both vaults; for imported keys repeat the BYOK import in the DR vault for every new key version (importing under an existing name adds a new version; use a key exchange key with the import operation only, created in the DR vault, and the transfer file from your HSM tool); for DR-own keys create the key in the DR vault with the same type, size or curve and permitted operations as the primary's and record its key URI.
9. secondary-vault-sync: build the certificate sync per class, reading the exportable flag in each certificate's policy (an imported certificate gets a default policy that the service reads from the X.509 certificate, so do not assume that its key is exportable): for a certificate whose policy marks the key as exportable, read the certificate with its private key as a secret in the primary after each renewal and import it into the DR vault (a copy; if the source of truth is a PFX or PEM file outside the vault, import from there); for a certificate from an integrated certificate authority create the issuer object in the DR vault (issuers belong to one vault) with its own requester credentials, the same policy (subject, subject alternative names, key type, validity, autoRenew lifetime action) and certificate contacts (shared by the certificates of one vault), so that the DR vault orders and renews its own certificate; for a certificate whose policy does not mark the key as exportable (including every certificate with an HSM key), do the same or create a signing request in the DR vault; the last two classes are second certificates, so every consumer (TLS listener, pinning client, trust store) must accept both.
10. secondary-vault-sync: configure the application: each regional deployment gets its own vault URI and its own key URIs as deployment parameters (for example an app setting, environment variable or configuration entry that the release pipeline sets per region), its own managed identity, secrets and certificates referenced by name without a version so that renewals are followed, SDK retry with exponential backoff, and no vault URI, key URI or IP address in code; the DR deployment points at the DR vault from deployment time, so switching to DR is a configuration decision and not a code change.
11. secondary-vault-sync: run the first full sync, then check the vault configuration and access (TC-6) and the object parity and key material (TC-1), and record which objects are copies and which are second certificates or DR-own keys; keep the runbook of the Microsoft-managed failover in place until Validate has passed.
12. paired-failover-split: no vault is built and no data is copied, because the replication is built in; the only changes are on the DR side, made before DR: a private endpoint in the DR virtual network for the vault in the pair, the private DNS zone link, role assignments for the DR workload identity (Key Vault Secrets User, Key Vault Crypto User or Key Vault Crypto Service Encryption User), the vault name (not an IP address) in the DR deployment's configuration, and the application's read-only DR mode. Then go to Validate.

### Validate
1. secondary-vault-sync: run TC-6 on the DR vault (network and roles included), then TC-1 once, then TC-1 daily and TC-2 for 7 consecutive days.
2. secondary-vault-sync: run TC-3 in a drill with the primary vault unreachable from the DR region, and time the switch-over against the Estimated RTO.
3. Run TC-6 on every vault of the workload.
4. paired-failover-split: run the daily probe of TC-4 from the DR region, then complete its design check (the post-failover path cannot be drilled because the customer cannot trigger the Microsoft-managed failover).
5. paired-failover-split: run TC-5 (the review of the application's calls, the drill with a read-only identity, and the expiry check against the vault outage limit).
6. Record each result with its date; a time or figure that a drill measured is Demonstrated, and everything else, including every recovery time of the Microsoft-managed failover, stays Estimated or Unknown.

### Cut over
1. secondary-vault-sync: make the DR vault the vault of the DR deployment in the runbook and in the application's DR configuration.
2. secondary-vault-sync: remove the runbook steps that wait for the Microsoft-managed failover of the vault.
3. paired-failover-split: change nothing in the vault or the replication; put the Failover steps for paired-failover-split in the runbook, write the vault outage limit and its owner in the runbook, and mark the vault's DR as Microsoft-managed failover with a read-only vault, validated by TC-4, TC-5 and TC-6 and never drilled.

### Decommission
1. secondary-vault-sync: remove the consumer configuration and the network paths that pointed DR consumers at the vault in the pair.
2. secondary-vault-sync: leave the primary vault as it is: its replication to the pair is built in, and nothing has to be removed for it.
3. paired-failover-split: nothing is decommissioned, because nothing was built; the vault in the pair stays the DR vault for the workload.

### Keep until cut-over
For secondary-vault-sync: the runbook steps for the Microsoft-managed failover of the vault and every network path to the pair region that today's DR relies on, until TC-1, TC-2, TC-3 and TC-6 have passed. For paired-failover-split: everything that exists today stays for good, which means the replication to the pair, the private endpoint and DNS link in the DR region, the role assignments and the read-only DR mode; only their validation (TC-4, TC-5 and TC-6) is new.

## Failover and failback

### Failover
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary vault is unavailable and declare DR for the workload | Incident manager | Estimated unknown (measured in the first drill) | The declaration is recorded with its time | The primary vault answers again before the declaration |
| 2 | secondary-vault-sync: check the last successful sync into the DR vault and the list of objects that are second certificates or DR-own keys | Platform engineer | Estimated unknown (measured in the first drill) | The pipeline log shows a successful run within the Estimated RPO, and TC-1 of the last day shows zero differences | The last successful run is older than the Estimated RPO: the application owner decides whether to go on |
| 3 | secondary-vault-sync: start the application in the DR region with the DR vault | Application engineer | Estimated 30m (the Estimated RTO of the option; TC-3 proves it) | The DR vault name resolves to its private IP address from the DR network, every secret the application needs at startup resolves from the DR vault, every certificate it serves is valid, and a wrap and unwrap with each key it uses succeeds | A secret does not resolve: write it from the source of truth, then retry; a key or certificate is missing or invalid: the owner of the consumer decides on the DR-own key or second certificate path |
| 4 | paired-failover-split: wait for the Microsoft-managed failover of the vault; the customer cannot trigger or bring it forward | Platform engineer | Estimated unknown (Learn: several hours after the loss of the primary region, or longer) | Azure Resource Health shows the vault available again | The wait passes the vault outage limit that the application owner set in the runbook (TC-5 proves that nothing expires inside it): the application owner decides between running on the secrets the application already holds in memory and accepting the gap, records the decision, and the platform engineer opens a support request with Azure support |
| 5 | paired-failover-split: check the read path from the DR region to the vault in the pair | Network engineer | Estimated 20m (Learn: up to 20 minutes for Private Link to reconnect after the failover) | A read of a test secret from the DR region succeeds, over the private endpoint and the private IP address of the DR network, within the probe latency bound of TC-4 | The read path still fails after 20 minutes: escalate to the network team, then check the DNS zone link and the private endpoint connection state before any change to the vault, which cannot be changed in read-only mode |
| 6 | paired-failover-split: start the application in its read-only DR mode | Application engineer | Estimated unknown (measured in the first drill of the application; the vault's failover time is not part of it) | The application starts, and its calls to the vault are only list and get of secrets and certificates, list of keys, get of key properties, encrypt, decrypt, wrap, unwrap, verify, sign and backup | A call is refused because it writes: stop that function, keep the rest in DR and record the gap for the application owner |

### Failback
| # | Step | Role | Estimated duration | Verification | Abort condition |
|---|---|---|---|---|---|
| 1 | Confirm that the primary region and the primary vault are available again | Incident manager | Estimated unknown (measured in the first drill) | The primary vault answers reads and writes | The primary vault is still unavailable or read-only |
| 2 | secondary-vault-sync: record every change made during DR (new secret versions, reissued or renewed certificates in the DR vault, DR-own key versions); write the new secret values and certificates back to their source of truth, or to the primary vault with the primary vault's writer named in the Build step that assigns the Azure RBAC roles on the DR vault (the pipeline has no write role on the primary), and record the DR-own key versions in the runbook; then run the sync from the source of truth or the primary into the DR vault | Platform engineer (with the primary vault's writer named in the Build step that assigns the Azure RBAC roles) | Estimated unknown (the write-back is measured in the first drill; the sync that follows takes one sync interval, which TC-2 proves) | The source of truth or the primary vault holds every change recorded for the DR period, and TC-1 shows zero differences between the inventory, the source of truth and the DR vault | The write-back or the sync fails: keep the application on the DR vault |
| 3 | secondary-vault-sync: switch the application back to the primary region and the primary vault | Application engineer | Estimated unknown (measured in the first drill) | Every secret the application needs resolves from the primary vault | A secret does not resolve: switch back to the DR vault |
| 4 | paired-failover-split: when the vault accepts writes again, move the consumers back to the primary region | Platform engineer | Estimated unknown (Learn describes no failback timing) | A write of a test secret succeeds from the primary region | Writes still fail: stay read-only and escalate through Azure support |

## Test criteria

### TC-1: Every secret, key and certificate is in the DR vault
- Applies to: secondary-vault-sync
- Pass condition: every object of the inventory exists and is enabled in the DR vault, the DR vault holds no object that the inventory lacks, and the evidence of each object type matches its origin class: for a secret, the SHA-256 hash of its current value equals the source's; for a key (which cannot be hashed), its type, size or curve and permitted operations equal the primary's, and for a restored or imported key the public part (the only part a key read returns) equals the primary's and a test value wrapped with the primary's key is unwrapped to the same value by the DR vault's key, while a DR-own key is expected to differ, is listed as such, and has a record from the owner of each consumer of how the consumer's data is protected in DR (re-encrypted under the DR key, or rebuilt in DR with its own data keys); for a certificate that is a copy, the subject, subject alternative names, expiry date and public certificate equal the primary's, while a second certificate (integrated certificate authority or non-exportable key) is valid, outside the renewal window of its own policy, and has the subject and subject alternative names of the primary's.
- How to measure: a scheduled job lists the objects of the DR vault, compares them with the inventory and the source of truth by type as the pass condition says, wraps a random test value in the primary and unwraps it in the DR vault for each restored key and for each imported key version, and computes hashes in memory without writing or logging a value.
- Evidence: the job report with its date, the number of objects compared per type and origin class, the list of DR-own keys and second certificates, and zero differences; the report holds names, attributes and hashes, never values.
- Frequency: daily

### TC-2: The sync lag stays below the Estimated RPO
- Applies to: secondary-vault-sync
- Pass condition: for 7 consecutive days, the time from a change in the source of truth to its presence in the DR vault stays below the Estimated RPO of the option, for secrets, imported keys and copied certificates.
- How to measure: compare the creation time of the new version in the source (or the primary vault) with the completion time of the pipeline run that wrote it to the DR vault, for every change, and add one canary secret that the pipeline's own test changes every day so that a day without a real change still gives one measurement.
- Evidence: the 7-day export of the pipeline runs with the lag per change and its maximum.
- Frequency: before cut-over, then monthly

### TC-3: The application starts in the DR region from the DR vault
- Applies to: secondary-vault-sync
- Pass condition: with the primary vault unreachable from the DR region, the application in the DR region starts using only the DR deployment's configuration (no code change), every secret it needs resolves from the DR vault over the private endpoint, every certificate it serves is valid, every key operation it needs succeeds with the DR vault's key, and the switch-over completes within the Estimated RTO of the option.
- How to measure: a drill that blocks the primary vault from the DR region with a network rule and times the switch-over from its start to the first successful request.
- Evidence: the drill record with its timestamps, the application log of the secret, certificate and key operations and the measured time.
- Frequency: every DR drill, and after every change to how the application selects its vault

### TC-4: The DR region reads the vault, and the path after the failover is a design check
- Applies to: paired-failover-split
- Pass condition: two parts. Measured: every day a probe in the DR region resolves the vault name to the private IP address of the DR network and reads a test secret over the planned private endpoint, and the read succeeds within the probe latency bound that the team sets and records with the probe. Design check, not drillable: the customer cannot trigger the Microsoft-managed failover, so the path after it, including the up to 20 minutes that Private Link needs to reconnect, can only be observed in a real failover; the check passes when the DR network holds the private endpoint, the DNS zone link and the role assignments before DR, the DR deployment uses the vault name and no IP address or regional endpoint, the runbook allows 20 minutes for the reconnect, and a Resource Health alert on the vault fires on a test.
- How to measure: the scheduled probe records result, resolved address and latency; the design check is a review of the DR network, DNS, role assignments, application configuration and runbook, with a test of the alert. In a real failover, record the time from the loss of the primary region to the first successful read in DR.
- Evidence: the probe log, the review record with its date and the alert test record; after a real failover, the observed time.
- Frequency: the probe daily, the design check after every change to the DR network, DNS, vault access or application configuration

### TC-5: The application works with a read-only vault
- Applies to: paired-failover-split
- Pass condition: in DR mode the application uses only the operations Learn lists for a vault after failover (list and get of secrets and certificates, list of keys, get (properties of) keys, encrypt, decrypt, wrap, unwrap, verify, sign and backup), a drill in which it runs with an identity that holds only read and cryptographic roles (Key Vault Secrets User, and Key Vault Crypto User or Key Vault Crypto Service Encryption User, as assigned in Build) raises no error and no refused write, and every secret, key and certificate it needs in DR has an expiry date later than today plus the vault outage limit that the application owner sets in the runbook (or no expiry date), because the read-only vault supports no create, import or renew operation. The drill simulates the read-only mode; the real read-only mode can only be observed in a real failover.
- How to measure: a review of the application's calls to the vault, then a drill of the DR mode with that identity, with the vault's diagnostic log checked for refused write operations; a scheduled job lists the expiry dates of the vault's objects and compares them with the vault outage limit, next to an Event Grid subscription that raises the near-expiry events (30 days before expiration) to the owners.
- Evidence: the review record, the drill log with the log query result, and the expiry job report with its date, the limit it used, the earliest expiry date and the objects inside the limit.
- Frequency: every release that changes how the application uses the vault; the expiry job daily

### TC-6: Every vault is configured as planned
- Applies to: secondary-vault-sync, paired-failover-split
- Pass condition: soft delete and purge protection are enabled on every vault of the workload. For the DR vault of secondary-vault-sync also: its private endpoint connection is Approved, its name resolves to its private IP address from every DR network that runs consumers, public network access is as planned, the DR workload identity holds only the read roles it needs (Key Vault Secrets User, Key Vault Crypto User or Key Vault Crypto Service Encryption User), the pipeline identity is the only identity with write roles (Key Vault Secrets Officer, Key Vault Certificates Officer, Key Vault Crypto Officer) on it, and no one holds Key Vault Administrator on it by default. For paired-failover-split: the DR network holds the private endpoint to the vault, the DNS zone link and the role assignments of the DR workload identity.
- How to measure: read the properties of each vault with a read-only query or in the portal; for the DR vault a scheduled job also reads the private endpoint connection state, resolves the vault name from inside each DR network and lists the role assignments of the vault scope.
- Evidence: the query output and the job report with their date, the resolved addresses and the role assignment list.
- Frequency: monthly for soft delete and purge protection; weekly for the network and role checks, and after every change to the DR network, DNS or role assignments
