// The scope selector (contracts 7.2) and the groupings built from normalized resources.

const WORKLOAD_TAGS = ["app", "application", "workload"];
const MIN_TAGGED_RESOURCES = 3;

const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (set) => [...set].sort(order);

/** The assessment's scope (snake_case) as the selector stored in inventory.json. */
export function selectorFromScope(scope) {
    const s = scope ?? {};
    return {
        resourceGroups: [...(s.resource_groups ?? [])],
        tag: s.tag?.name && s.tag?.value ? { name: s.tag.name, value: s.tag.value } : null,
        subscriptions: [...(s.subscriptions ?? [])],
    };
}

export function selectorIsSet(selector) {
    return selector.resourceGroups.length > 0 || selector.tag !== null || selector.subscriptions.length > 0;
}

/** A resource matches when it satisfies every selector that is set. Everything compares case-insensitively. */
export function matchesScope(resource, selector) {
    if (selector.resourceGroups.length > 0 && !selector.resourceGroups.some((rg) => same(rg, resource.resourceGroup))) return false;
    if (
        selector.subscriptions.length > 0 &&
        !selector.subscriptions.some((s) => same(s, resource.subscription) || same(s, resource.subscriptionId))
    ) {
        return false;
    }
    if (selector.tag) {
        const entry = Object.entries(resource.tags ?? {}).find(([name]) => same(name, selector.tag.name));
        if (!entry || !same(entry[1], selector.tag.value)) return false;
    }
    return true;
}

export function sortSummary(rows) {
    const key = (row) => [row.subscription ?? "", row.resourceGroup ?? "", row.location ?? "", row.armType ?? ""].join("\u0000");
    return [...rows].sort((a, b) => order(key(a), key(b)));
}

/** One row per (subscription, resource group, location, ARM type) with the number of resources. */
export function buildSummary(resources) {
    const rows = new Map();
    for (const r of resources) {
        const id = [r.subscription, r.resourceGroup, r.location, r.armType].join("\u0000");
        const row = rows.get(id) ?? { subscription: r.subscription, resourceGroup: r.resourceGroup, location: r.location, armType: r.armType, count: 0 };
        row.count++;
        rows.set(id, row);
    }
    return sortSummary([...rows.values()]);
}

function addTo(map, key, resource) {
    const group = map.get(key) ?? { key, subscriptions: new Set(), resourceGroups: new Set(), resources: 0 };
    if (resource.subscription) group.subscriptions.add(resource.subscription);
    if (resource.resourceGroup) group.resourceGroups.add(resource.resourceGroup);
    group.resources++;
    map.set(key, group);
}

const finish = (group) => ({
    key: group.key,
    subscriptions: sorted(group.subscriptions),
    resourceGroups: sorted(group.resourceGroups),
    resources: group.resources,
});

/**
 * Candidate workloads: one per (subscription, resource group) pair, plus one per tag value that at least
 * three resources share under a tag named app, application or workload. Keys: rg:<sub>/<rg> and tag:<name>=<value>.
 */
export function buildCandidates(resources) {
    const pairs = new Map();
    const tagged = new Map();
    for (const r of resources) {
        addTo(pairs, `rg:${r.subscription ?? ""}/${r.resourceGroup ?? ""}`, r);
        for (const [name, value] of Object.entries(r.tags ?? {})) {
            const tagName = name.trim();
            const tagValue = String(value ?? "").trim();
            if (!tagValue || !WORKLOAD_TAGS.includes(tagName.toLowerCase())) continue;
            // Grouped case-insensitively, shown the way the first resource spelled it.
            const id = `${tagName.toLowerCase()}=${tagValue.toLowerCase()}`;
            const group = tagged.get(id) ?? { display: `tag:${tagName}=${tagValue}`, members: new Map() };
            group.members.set(r.ref, r);
            tagged.set(id, group);
        }
    }
    const tagCandidates = new Map();
    for (const { display, members } of tagged.values()) {
        if (members.size < MIN_TAGGED_RESOURCES) continue;
        for (const r of members.values()) addTo(tagCandidates, display, r);
    }
    const byKey = (a, b) => order(a.key, b.key);
    return [...[...pairs.values()].map(finish).sort(byKey), ...[...tagCandidates.values()].map(finish).sort(byKey)];
}

/** The workload cannot be told from the inventory when it holds more than one candidate. */
export function needsScope(candidates) {
    return candidates.length > 1;
}
