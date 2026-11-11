// Suggestion engine.
//
// When a node is added, propose components that commonly accompany it, the
// connector that should join them, and the clarifying questions an architect
// would ask. Rules are keyword-matched against the icon name; each suggestion
// resolves against the live icon catalog, so a suggestion can never reference
// an icon that doesn't exist (guarded by scripts/verify-rules.mjs).
//
// Suggestion entry shape:
//   { icon, label, dir, dashed, color }
//     icon   exact catalog name
//     label  edge label
//     dir    "out"  source -> suggested   (default)
//            "in"   suggested -> source
//            "none" add the node, draw no edge
//     dashed dashed connector (use for telemetry / config / implicit links)

const GREY = "#64748b";
const GREEN = "#1a7f37";
const AMBER = "#bf8700";

const RULES = [
    {
        id: "aks",
        match: /kubernetes|aks\b/i,
        topic: "Azure Kubernetes Service",
        suggests: [
            { icon: "Container Registries", label: "pulls images", dir: "out" },
            { icon: "Key Vaults", label: "secrets", dir: "out", dashed: true, color: AMBER },
            { icon: "Log Analytics Workspaces", label: "logs + metrics", dir: "out", dashed: true, color: GREY },
            { icon: "Application Gateways", label: "ingress", dir: "in", color: GREEN },
            { icon: "Virtual Networks", label: "deployed into", dir: "out", dashed: true, color: GREY },
            { icon: "Managed Identities", label: "workload identity", dir: "out", dashed: true, color: AMBER },
        ],
        questions: [
            { id: "aks-ingress", text: "How does traffic reach the cluster?", options: ["Application Gateway + WAF", "Azure Front Door", "Internal only (private cluster)", "Public load balancer"] },
            { id: "aks-identity", text: "How do pods authenticate to Azure services?", options: ["Workload identity (recommended)", "Managed identity", "Service principal + secret"] },
            { id: "aks-registry", text: "Where do container images come from?", options: ["Azure Container Registry", "Docker Hub", "GitHub Container Registry"] },
        ],
    },
    {
        id: "appservice",
        match: /app services?|web app|static web/i,
        topic: "App Service",
        suggests: [
            { icon: "Application Insights", label: "telemetry", dir: "out", dashed: true, color: GREY },
            { icon: "Key Vaults", label: "secrets", dir: "out", dashed: true, color: AMBER },
            { icon: "Azure Database PostgreSQL Server", label: "queries", dir: "out" },
            { icon: "Front Door and CDN Profiles", label: "routes to", dir: "in", color: GREEN },
            { icon: "Virtual Networks", label: "VNet integration", dir: "out", dashed: true, color: GREY },
        ],
        questions: [
            { id: "appsvc-net", text: "Does the app need private connectivity to backends?", options: ["Yes - VNet integration + private endpoints", "No - public endpoints are fine"] },
            { id: "appsvc-slots", text: "Do you need zero-downtime deployments?", options: ["Yes - staging slots", "No"] },
        ],
    },
    {
        id: "functions",
        match: /function apps?|functions/i,
        topic: "Azure Functions",
        suggests: [
            { icon: "Storage Accounts", label: "runtime state", dir: "out", dashed: true, color: GREY },
            { icon: "Application Insights", label: "telemetry", dir: "out", dashed: true, color: GREY },
            { icon: "Azure Service Bus", label: "triggers", dir: "in", color: GREEN },
            { icon: "Event Grid Topics", label: "triggers", dir: "in", color: GREEN },
            { icon: "Key Vaults", label: "secrets", dir: "out", dashed: true, color: AMBER },
        ],
        questions: [
            { id: "fn-trigger", text: "What triggers the function?", options: ["HTTP", "Queue / Service Bus", "Event Grid", "Timer", "Blob"] },
            { id: "fn-plan", text: "Which hosting plan?", options: ["Consumption", "Premium (VNet + no cold start)", "Dedicated / App Service plan"] },
        ],
    },
    {
        id: "sql",
        match: /sql database|sql server|sql managed/i,
        topic: "Azure SQL",
        suggests: [
            { icon: "Key Vaults", label: "connection secrets", dir: "out", dashed: true, color: AMBER },
            { icon: "Private Link", label: "private endpoint", dir: "in", dashed: true, color: GREY },
            { icon: "Managed Identities", label: "passwordless auth", dir: "out", dashed: true, color: AMBER },
            { icon: "Backup Vault", label: "backups", dir: "out", dashed: true, color: GREY },
            { icon: "Log Analytics Workspaces", label: "audit logs", dir: "out", dashed: true, color: GREY },
        ],
        questions: [
            { id: "sql-access", text: "How is the database reached?", options: ["Private endpoint", "Service endpoint", "Public with firewall rules"] },
            { id: "sql-auth", text: "How do apps authenticate?", options: ["Microsoft Entra ID (passwordless)", "SQL auth + Key Vault secret"] },
            { id: "sql-ha", text: "What availability do you need?", options: ["Zone redundant", "Geo-replication / failover group", "Single region is fine"] },
        ],
    },
    {
        id: "cosmos",
        match: /cosmos/i,
        topic: "Cosmos DB",
        suggests: [
            { icon: "Private Link", label: "private endpoint", dir: "in", dashed: true, color: GREY },
            { icon: "Managed Identities", label: "RBAC data plane", dir: "out", dashed: true, color: AMBER },
            { icon: "Monitor", label: "RU + latency", dir: "out", dashed: true, color: GREY },
            { icon: "Function Apps", label: "change feed", dir: "out", color: GREEN },
        ],
        questions: [
            { id: "cosmos-api", text: "Which Cosmos API?", options: ["NoSQL", "MongoDB", "Cassandra", "Gremlin", "Table"] },
            { id: "cosmos-geo", text: "Multi-region writes?", options: ["Yes - active/active", "No - single write region"] },
        ],
    },
    {
        id: "storage",
        match: /storage accounts?|blob|data lake/i,
        topic: "Storage",
        suggests: [
            { icon: "Private Link", label: "private endpoint", dir: "in", dashed: true, color: GREY },
            { icon: "Key Vaults", label: "CMK", dir: "out", dashed: true, color: AMBER },
            { icon: "Managed Identities", label: "RBAC", dir: "out", dashed: true, color: AMBER },
            { icon: "Monitor", label: "diagnostics", dir: "out", dashed: true, color: GREY },
        ],
        questions: [
            { id: "storage-access", text: "How is storage accessed?", options: ["Private endpoint", "Public with firewall", "Service endpoint"] },
            { id: "storage-tier", text: "Access pattern?", options: ["Hot", "Cool", "Archive", "Mixed with lifecycle rules"] },
        ],
    },
    {
        id: "messaging",
        match: /service bus|event hub|event grid|queue/i,
        topic: "Messaging",
        suggests: [
            { icon: "Function Apps", label: "consumes", dir: "out", color: GREEN },
            { icon: "Managed Identities", label: "auth", dir: "out", dashed: true, color: AMBER },
            { icon: "Private Link", label: "private endpoint", dir: "in", dashed: true, color: GREY },
            { icon: "Application Insights", label: "telemetry", dir: "out", dashed: true, color: GREY },
        ],
        questions: [
            { id: "msg-guarantee", text: "What delivery guarantee do you need?", options: ["At-least-once", "Exactly-once (sessions + dedup)", "Best effort"] },
            { id: "msg-dlq", text: "How are poison messages handled?", options: ["Dead-letter queue + alert", "Retry then drop", "Not decided yet"] },
        ],
    },
    {
        id: "apim",
        match: /api management|api center/i,
        topic: "API Management",
        suggests: [
            { icon: "Front Door and CDN Profiles", label: "edge", dir: "in", color: GREEN },
            { icon: "Application Gateways", label: "WAF", dir: "in", color: GREEN },
            { icon: "Entra ID Protection", label: "validates tokens", dir: "out", dashed: true, color: AMBER },
            { icon: "Application Insights", label: "telemetry", dir: "out", dashed: true, color: GREY },
            { icon: "Key Vaults", label: "certificates", dir: "out", dashed: true, color: AMBER },
        ],
        questions: [
            { id: "apim-auth", text: "How are callers authenticated?", options: ["Entra ID / OAuth 2.0", "Subscription keys", "Client certificates", "Anonymous"] },
            { id: "apim-tier", text: "Do you need VNet injection?", options: ["Yes - Premium / Developer", "No - Standard or Consumption"] },
        ],
    },
    {
        id: "ai",
        match: /openai|cognitive|machine learning|ai (studio|foundry|services)|bot services|speech/i,
        topic: "AI workload",
        suggests: [
            { icon: "Azure OpenAI", label: "inference", dir: "out", color: GREEN },
            { icon: "Cognitive Search", label: "grounding (RAG)", dir: "out", color: GREEN },
            { icon: "API Management Services", label: "gateway + quota", dir: "in", color: GREEN },
            { icon: "Key Vaults", label: "keys", dir: "out", dashed: true, color: AMBER },
            { icon: "Storage Accounts", label: "source documents", dir: "out", dashed: true, color: GREY },
            { icon: "Private Link", label: "private endpoint", dir: "in", dashed: true, color: GREY },
            { icon: "Application Insights", label: "telemetry", dir: "out", dashed: true, color: GREY },
            { icon: "Managed Identities", label: "auth", dir: "out", dashed: true, color: AMBER },
        ],
        questions: [
            { id: "ai-ground", text: "What grounds the model?", options: ["Azure AI Search (RAG)", "Fine-tuned model", "Prompt only", "MCP tools / function calling"] },
            { id: "ai-net", text: "Should model endpoints be private?", options: ["Yes - private endpoints only", "No - public with keys"] },
            { id: "ai-quota", text: "Have you planned quota / TPM?", options: ["Yes - PTU reserved", "Pay-as-you-go", "Not yet"] },
        ],
    },
    {
        id: "data",
        match: /data factory|synapse|databricks|fabric|stream analytics/i,
        topic: "Data platform",
        suggests: [
            { icon: "Data Lake Storage Gen1", label: "reads + writes", dir: "out", color: GREEN },
            { icon: "Key Vaults", label: "linked service secrets", dir: "out", dashed: true, color: AMBER },
            { icon: "Managed Identities", label: "auth", dir: "out", dashed: true, color: AMBER },
            { icon: "Monitor", label: "pipeline runs", dir: "out", dashed: true, color: GREY },
            { icon: "Purview", label: "lineage", dir: "out", dashed: true, color: GREY },
        ],
        questions: [
            { id: "data-mode", text: "Batch or streaming?", options: ["Batch", "Streaming", "Both (lambda / medallion)"] },
            { id: "data-gov", text: "Is data governance in scope?", options: ["Yes - Purview catalog + lineage", "No"] },
        ],
    },
    {
        id: "network",
        match: /virtual network|firewall|front door|application gateway|load balancer|dns|vpn|expressroute/i,
        topic: "Networking",
        suggests: [
            { icon: "Network Security Groups", label: "filters", dir: "out", dashed: true, color: GREY },
            { icon: "Firewalls", label: "egress control", dir: "out", color: GREEN },
            { icon: "Private Link", label: "private endpoints", dir: "out", dashed: true, color: GREY },
            { icon: "Monitor", label: "flow logs", dir: "out", dashed: true, color: GREY },
            { icon: "Bastions", label: "admin access", dir: "in", dashed: true, color: AMBER },
        ],
        questions: [
            { id: "net-topology", text: "What network topology?", options: ["Hub and spoke", "Azure Virtual WAN", "Single VNet", "Not decided"] },
            { id: "net-egress", text: "How is outbound traffic controlled?", options: ["Azure Firewall", "NAT Gateway", "Default egress"] },
        ],
    },
    {
        id: "identity",
        match: /entra|active directory|identity|managed identit/i,
        topic: "Identity",
        suggests: [
            { icon: "Key Vaults", label: "secret access", dir: "out", dashed: true, color: AMBER },
            { icon: "Conditional Access", label: "policy", dir: "out", dashed: true, color: AMBER },
            { icon: "Entra Privleged Identity Management", label: "just-in-time roles", dir: "out", dashed: true, color: AMBER },
            { icon: "Entra ID Protection", label: "risk signals", dir: "out", dashed: true, color: GREY },
        ],
        questions: [
            { id: "id-model", text: "How do workloads authenticate?", options: ["Managed identity (no secrets)", "Workload identity federation", "Service principal + secret"] },
            { id: "id-ca", text: "Is Conditional Access enforced?", options: ["Yes", "No", "Not decided"] },
        ],
    },
    {
        id: "monitor",
        match: /monitor|log analytics|application insights|sentinel/i,
        topic: "Observability",
        suggests: [
            { icon: "Log Analytics Workspaces", label: "workspace", dir: "out", dashed: true, color: GREY },
            { icon: "Application Insights", label: "app telemetry", dir: "in", dashed: true, color: GREY },
            { icon: "Azure Sentinel", label: "SIEM", dir: "out", dashed: true, color: GREY },
        ],
        questions: [
            { id: "obs-retention", text: "How long must logs be retained?", options: ["30 days", "90 days", "1 year+", "Regulated / archive to storage"] },
        ],
    },
    {
        id: "compute",
        match: /virtual machine|vmss|scale set|container instance|container apps?|batch/i,
        topic: "Compute",
        suggests: [
            { icon: "Virtual Networks", label: "deployed into", dir: "out", dashed: true, color: GREY },
            { icon: "Managed Identities", label: "identity", dir: "out", dashed: true, color: AMBER },
            { icon: "Key Vaults", label: "secrets", dir: "out", dashed: true, color: AMBER },
            { icon: "Monitor", label: "metrics", dir: "out", dashed: true, color: GREY },
            { icon: "Backup Vault", label: "backups", dir: "out", dashed: true, color: GREY },
        ],
        questions: [
            { id: "compute-scale", text: "How does this scale?", options: ["Autoscale on metrics", "Scheduled scale", "Fixed size"] },
            { id: "compute-ha", text: "Availability requirement?", options: ["Availability zones", "Availability set", "Single instance"] },
        ],
    },
];

// Applied to any Azure component that has no more specific rule.
const AZURE_BASELINE = {
    topic: "Azure baseline",
    suggests: [
        { icon: "Log Analytics Workspaces", label: "diagnostics", dir: "out", dashed: true, color: GREY },
        { icon: "Key Vaults", label: "secrets", dir: "out", dashed: true, color: AMBER },
        { icon: "Managed Identities", label: "identity", dir: "out", dashed: true, color: AMBER },
    ],
    questions: [
        { id: "baseline-env", text: "Which environments will this exist in?", options: ["Dev only", "Dev + Prod", "Dev / Test / Prod"] },
    ],
};

/** Accept both the plain-string and object forms of a suggestion entry. */
function normalizeEntry(entry) {
    if (typeof entry === "string") return { icon: entry, label: "", dir: "out", dashed: false, color: null };
    return {
        icon: entry.icon,
        label: entry.label || "",
        dir: entry.dir || "out",
        dashed: Boolean(entry.dashed),
        color: entry.color || null,
    };
}

/**
 * @param {import("./icons.mjs").IconCatalog} catalog
 * @param {{name: string, collection?: string}} node  the icon just added
 * @param {string[]} existingIconIds  ids already on the canvas, to avoid dupes
 */
export function suggestFor(catalog, node, existingIconIds = []) {
    const name = node?.name || "";
    const present = new Set(existingIconIds);

    const matched = RULES.filter((rule) => rule.match.test(name));
    const effective = matched.length
        ? matched
        : node?.collection === "azure"
          ? [AZURE_BASELINE]
          : [];

    const seen = new Set();
    const suggestions = [];
    const questions = [];

    for (const rule of effective) {
        for (const raw of rule.suggests || []) {
            const entry = normalizeEntry(raw);
            const icon = catalog.resolve(entry.icon);
            if (!icon || present.has(icon.id) || seen.has(icon.id)) continue;
            seen.add(icon.id);
            suggestions.push({
                iconId: icon.id,
                name: icon.name,
                collectionLabel: icon.collectionLabel,
                reason: rule.topic,
                edge: {
                    label: entry.label,
                    dir: entry.dir,
                    dashed: entry.dashed,
                    color: entry.color,
                },
            });
        }
        for (const question of rule.questions || []) {
            if (questions.some((q) => q.id === question.id)) continue;
            questions.push({ ...question, topic: rule.topic });
        }
    }

    return {
        topic: effective.map((r) => r.topic).join(" + ") || null,
        suggestions: suggestions.slice(0, 8),
        questions: questions.slice(0, 4),
    };
}

export const ruleCount = RULES.length;
