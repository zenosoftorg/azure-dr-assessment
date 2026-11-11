import { readFileSync } from "node:fs";
import path from "node:path";
import { skillRoot } from "./paths.mjs";

/**
 * Readable names for ARM types that no playbook names: the bundled Learn catalogue first, then the ARI sheet map,
 * then the last segment of the type split into words. Both maps are static assets of the skill, read once.
 */
const asset = (name) => JSON.parse(readFileSync(path.join(skillRoot(), "assets", name), "utf8"));
const DEFAULT_MAPS = { learn: asset("learn-service-map.json"), ari: asset("ari-sheet-map.json") };

/** The well-known abbreviations of types without a playbook, used as reply short names (VNET, not VI). */
export const KNOWN_SHORTS = {
    "microsoft.network/virtualnetworks": "VNET",
    "microsoft.network/networkinterfaces": "NIC",
    "microsoft.network/networksecuritygroups": "NSG",
    "microsoft.network/applicationsecuritygroups": "ASG",
    "microsoft.network/publicipaddresses": "PIP",
    "microsoft.network/routetables": "UDR",
    "microsoft.network/natgateways": "NAT",
    "microsoft.network/virtualnetworkgateways": "VNG",
    "microsoft.network/bastionhosts": "BAS",
    "microsoft.managedidentity/userassignedidentities": "UAMI",
};

/** Words of ARM type segments, longest first wins on a tie in word count. */
const WORDS = [
    "access", "account", "accounts", "action", "address", "addresses", "agent", "alert", "alerts", "analytics", "api", "apis", "app", "application",
    "applications", "apps", "assigned", "assignment", "assignments", "automation", "availability", "backup", "balancer", "balancers", "bastion",
    "cache", "certificate", "certificates", "circuit", "circuits", "cluster", "clusters", "component", "components", "configuration",
    "configurations", "connection", "connections", "container", "containers", "data", "database", "databases", "definition", "definitions",
    "deployment", "deployments", "diagnostic", "disk", "disks", "dns", "domain", "domains", "door", "doors", "endpoint", "endpoints",
    "environment", "environments", "event", "express", "factory", "factories", "farm", "farms", "firewall", "firewalls", "flow", "front",
    "gallery", "galleries", "gateway", "gateways", "group", "groups", "host", "hosts", "hub", "hubs", "identities", "identity", "image",
    "images", "instance", "instances", "interface", "interfaces", "ip", "ips", "key", "keys", "link", "links", "load", "local", "log", "logs",
    "machine", "machines", "managed", "management", "manager", "metric", "monitor", "nat", "namespace", "namespaces", "network", "networks",
    "peering", "peerings", "plan", "plans", "policies", "policy", "pool", "pools", "prefix", "prefixes", "private", "profile", "profiles",
    "protection", "public", "queue", "queues", "record", "records", "recovery", "registries", "registry", "relay", "replica", "replicas", "resource",
    "resources", "role", "roles", "route", "routes", "rule", "rules", "scale", "schedule", "schedules", "search", "secret", "secrets", "security",
    "server", "servers", "service", "services", "set", "sets", "share", "shares", "site", "sites", "slot", "slots", "snapshot", "snapshots",
    "storage", "subnet", "subnets", "table", "tables", "topic", "topics", "traffic", "user", "vault", "vaults", "virtual", "watcher", "watchers",
    "web", "workspace", "workspaces", "zone", "zones",
];
const VOCABULARY = new Set(WORDS);

/**
 * The words of a lower-case ARM type segment ("virtualnetworks" gives virtual, networks): the split into known words
 * with the fewest unknown letters, then the fewest words. A segment with no known word stays whole.
 */
export function splitTypeWords(segment) {
    const text = String(segment).toLowerCase();
    // best[i]: the cheapest split of text.slice(0, i) as [unknown letters, words, pieces]
    const best = [[0, 0, []]];
    for (let i = 1; i <= text.length; i++) {
        let pick = null;
        for (let j = 0; j < i; j++) {
            const [unknown, count, pieces] = best[j];
            const word = text.slice(j, i);
            const candidate = [unknown + (VOCABULARY.has(word) ? 0 : word.length), count + 1, [...pieces, word]];
            if (!pick || candidate[0] < pick[0] || (candidate[0] === pick[0] && candidate[1] < pick[1])) pick = candidate;
        }
        best[i] = pick;
    }
    // adjacent unknown pieces read as one word
    const words = [];
    for (const piece of best[text.length][2]) {
        if (words.length > 0 && !VOCABULARY.has(piece) && !VOCABULARY.has(words.at(-1))) words[words.length - 1] += piece;
        else words.push(piece);
    }
    return words.length > 0 ? words : [text];
}

/** The service name of the Learn catalogue when all its entries for the type name one service, else null. */
function learnName(type, learn) {
    const names = [...new Set((learn?.types?.[type] ?? []).map((entry) => entry.service).filter(Boolean))];
    return names.length === 1 ? names[0] : null;
}

/** The ARI sheet name of the type: the entry whose key is the type's last segment, else the only entry, else null. */
function ariName(type, ari) {
    const entries = Object.entries(ari?.resources ?? {}).filter(([, entry]) => entry.armType === type);
    const segment = type.split("/").at(-1).replace(/[^a-z0-9]/g, "");
    const own = entries.find(([key]) => key === segment) ?? (entries.length === 1 ? entries[0] : null);
    return own ? own[1].sheet : null;
}

/** A readable display name of an ARM type: Learn catalogue, ARI sheet, or its last segment split into words. */
export function typeTitle(type, maps = DEFAULT_MAPS) {
    const key = String(type).toLowerCase();
    const named = learnName(key, maps.learn) ?? ariName(key, maps.ari);
    if (named) return named;
    const words = splitTypeWords(key.split("/").at(-1)).join(" ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}
