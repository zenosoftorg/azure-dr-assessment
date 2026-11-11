// The first set of service playbooks, as fixed by the v3 contracts, section 7 (a maintainers' planning
// document that is not part of this repository). An authoring task that drops or adds an option
// amends that table and this list in the same commit.
export const FIRST_SET = [
    {
        service: "key-vault",
        armTypes: ["microsoft.keyvault/vaults"],
        slot: "secrets-keys",
        options: [["secondary-vault-sync", "workaround"], ["paired-failover-split", "split-region"]],
    },
    {
        service: "sql-database",
        armTypes: ["microsoft.sql/servers", "microsoft.sql/servers/databases"],
        slot: "data-replication.relational",
        options: [["failover-group", "native"], ["active-geo-replication", "native"], ["geo-restore", "backup-restore"]],
    },
    {
        service: "sql-managed-instance",
        armTypes: ["microsoft.sql/managedinstances"],
        slot: "data-replication.relational",
        options: [["failover-group", "native"], ["geo-restore", "backup-restore"]],
    },
    {
        service: "postgresql-flexible",
        armTypes: ["microsoft.dbforpostgresql/flexibleservers"],
        slot: "data-replication.relational",
        options: [["cross-region-replica", "native"], ["geo-backup-split", "split-region"]],
    },
    {
        service: "mysql-flexible",
        armTypes: ["microsoft.dbformysql/flexibleservers"],
        slot: "data-replication.relational",
        options: [["cross-region-replica", "native"], ["geo-restore", "backup-restore"], ["geo-backup-split", "split-region"]],
    },
    {
        service: "storage-account",
        armTypes: ["microsoft.storage/storageaccounts"],
        slot: "data-replication.storage",
        options: [["object-replication", "workaround"], ["scheduled-copy", "workaround"], ["geo-redundant-split", "split-region"]],
    },
    {
        service: "cosmos-db",
        armTypes: ["microsoft.documentdb/databaseaccounts"],
        slot: "data-replication.nosql",
        options: [["add-dr-region", "native"]],
    },
    {
        service: "redis",
        armTypes: ["microsoft.cache/redis", "microsoft.cache/redisenterprise"],
        slot: "data-replication.cache",
        options: [["geo-replication", "native"], ["rebuild-in-dr", "workaround"]],
    },
    {
        service: "backup",
        armTypes: ["microsoft.recoveryservices/vaults", "microsoft.dataprotection/backupvaults"],
        slot: "backup",
        options: [["dr-region-vault", "workaround"], ["cross-region-restore-split", "split-region"]],
    },
    {
        service: "virtual-machines",
        armTypes: ["microsoft.compute/virtualmachines", "microsoft.compute/disks"],
        slot: "data-replication.vm-disks",
        options: [["site-recovery", "native"], ["redeploy-from-code", "workaround"], ["cross-region-restore-split", "split-region"]],
    },
    {
        service: "app-service",
        armTypes: ["microsoft.web/sites", "microsoft.web/serverfarms"],
        slot: "compute",
        options: [["secondary-app", "workaround"], ["secondary-app-dns", "workaround"], ["backup-restore", "backup-restore"]],
    },
    {
        service: "aks",
        armTypes: ["microsoft.containerservice/managedclusters"],
        slot: "compute",
        options: [["secondary-cluster", "workaround"], ["aks-backup-split", "split-region"]],
    },
    {
        service: "container-registry",
        armTypes: ["microsoft.containerregistry/registries"],
        slot: "compute",
        options: [["geo-replication", "native"], ["secondary-registry-import", "workaround"]],
    },
    {
        service: "container-apps",
        armTypes: ["microsoft.app/containerapps", "microsoft.app/managedenvironments"],
        slot: "compute",
        options: [["secondary-environment", "workaround"]],
    },
    {
        service: "service-bus",
        armTypes: ["microsoft.servicebus/namespaces"],
        slot: "data-replication.messaging",
        options: [["geo-replication", "native"], ["metadata-geo-dr", "workaround"], ["active-active-namespaces", "workaround"]],
    },
    {
        service: "event-hubs",
        armTypes: ["microsoft.eventhub/namespaces"],
        slot: "data-replication.messaging",
        options: [["geo-replication", "native"], ["metadata-geo-dr", "workaround"], ["active-active-namespaces", "workaround"]],
    },
    {
        service: "application-gateway",
        armTypes: ["microsoft.network/applicationgateways", "microsoft.network/applicationgatewaywebapplicationfirewallpolicies"],
        slot: "ingress",
        options: [["secondary-gateway", "workaround"]],
    },
    {
        service: "load-balancer",
        armTypes: ["microsoft.network/loadbalancers"],
        slot: "ingress",
        options: [["global-load-balancer", "native"], ["secondary-load-balancer", "workaround"]],
    },
    {
        service: "front-door",
        armTypes: ["microsoft.cdn/profiles", "microsoft.network/frontdoors"],
        slot: "ingress",
        options: [["global-origin-failover", "native"]],
    },
    {
        service: "api-management",
        armTypes: ["microsoft.apimanagement/service"],
        slot: "ingress",
        options: [["multi-region-gateway", "native"], ["secondary-instance", "workaround"]],
    },
    {
        service: "private-endpoints-dns",
        armTypes: ["microsoft.network/privateendpoints", "microsoft.network/privatednszones"],
        slot: "connectivity",
        options: [["dr-region-endpoints", "workaround"]],
    },
    {
        service: "monitor",
        armTypes: ["microsoft.operationalinsights/workspaces", "microsoft.insights/components"],
        slot: "detection",
        options: [["workspace-replication", "native"], ["dr-region-workspace", "workaround"]],
    },
];

/** The row of the first set for a service, or null. */
export function firstSetRow(service) {
    return FIRST_SET.find((row) => row.service === service) ?? null;
}

/** A parsed playbook in the shape of a first-set row, for comparison. */
export function asFirstSetRow(playbook) {
    return { service: playbook.service, armTypes: playbook.armTypes, slot: playbook.slot, options: playbook.options.map((o) => [o.id, o.kind]) };
}
