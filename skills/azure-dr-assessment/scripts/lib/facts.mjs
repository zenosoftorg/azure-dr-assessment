/** Fields whose header or property name suggests DR relevance (contracts 8.11). */
export const DR_FIELD = /(sku|tier|zone|redundan|replica|replication|secondary|backup|geo|failover|availability|state|retention|soft delete|capacity|kind)/i;

const MAX_CLAIM_VALUE = 200;

function describe(value) {
    const text = typeof value === "string" ? value : String(value);
    return text.length > MAX_CLAIM_VALUE ? `${text.slice(0, MAX_CLAIM_VALUE)}…` : text;
}

/**
 * Write the ledger facts for an inventory: Observed identity and DR-relevant field facts for every
 * in-scope resource, then Unknown facts for sheets that were not assessed or only partly read and for
 * omissions that are not sheets (live permission gaps). Returns the number of facts added.
 */
export function addInventoryFacts(ledger, inventory) {
    const sourceType = inventory.source.kind === "live" ? "live" : "ari-xlsx";
    const place = sourceType === "live" ? "property" : "column";
    const before = ledger.entries.length;
    const observed = (resource, property, value, detail, claim) =>
        ledger.add({
            kind: "fact", strength: "Observed", subject: resource.ref, claim, property, value,
            source: { type: sourceType, ref: resource.ref, detail },
        });
    const unknown = (subject, claim, detail) =>
        ledger.add({ kind: "fact", strength: "Unknown", subject, claim, property: null, value: null, source: { type: sourceType, ref: subject, detail } });

    for (const resource of inventory.resources) {
        const label = resource.name;
        observed(resource, "name", resource.name, "resource name", `${label} is present in the inventory`);
        if (resource.armType) observed(resource, "type", resource.armType, "resource type", `${label} type is ${resource.armType}`);
        if (resource.resourceGroup) observed(resource, "resourceGroup", resource.resourceGroup, "resource group", `${label} resource group is ${resource.resourceGroup}`);
        if (resource.location) observed(resource, "location", resource.location, "location", `${label} location is ${resource.location}`);
        for (const [name, value] of Object.entries(resource.fields)) {
            if (DR_FIELD.test(name)) observed(resource, name, value, `${place} ${name}`, `${label} ${name} is ${describe(value)}`);
        }
    }
    for (const sheet of inventory.sheets) {
        if (!sheet.assessed) unknown(`sheet:${sheet.name}`, `Sheet ${sheet.name} was not assessed: ${sheet.reason}`, sheet.reason);
        else if (sheet.reason) unknown(`sheet:${sheet.name}`, `Sheet ${sheet.name} was only partly read: ${sheet.reason}`, sheet.reason);
    }
    for (const omission of inventory.omissions) {
        if (omission.what.startsWith("sheet:")) continue;
        const id = omission.what.replace(/^subscription:/, "");
        unknown(omission.what, `Resources of subscription ${id} were not collected: ${omission.reason}`, omission.reason);
    }
    return ledger.entries.length - before;
}
