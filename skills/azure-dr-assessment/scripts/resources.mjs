import { existsSync } from "node:fs";
import path from "node:path";
import { CliError, EXIT, runCli } from "./lib/cli.mjs";
import { readInventory } from "./lib/inventory.mjs";
import { Ledger } from "./lib/ledger.mjs";

const spec = {
    assessment: { type: "string", help: "assessment.yaml of the run; the evidence is read from the evidence folder next to it", required: true },
    type: { type: "string", help: "Only resources of this ARM type, such as microsoft.sql/servers/databases" },
    "resource-group": { type: "string", help: "Only resources of this resource group (not case sensitive); (none) selects the resources that have no resource group" },
    limit: { type: "string", help: "At most this many rows (default 100)" },
    offset: { type: "string", help: "Skip this many rows (default 0)" },
};

const NO_GROUP = "(none)";
const groupOf = (resource) => resource.resourceGroup ?? NO_GROUP;
// Ties are broken by code unit, never by locale, so the list is the same on every machine.
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function count(value, name, fallback, minimum) {
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum) throw new CliError(EXIT.USAGE, `--${name} must be a whole number of at least ${minimum}`);
    return number;
}

async function main(values) {
    const limit = count(values.limit, "limit", 100, 1);
    const offset = count(values.offset, "offset", 0, 0);
    const evidence = path.join(path.dirname(path.resolve(values.assessment)), "evidence");
    const inventoryFile = path.join(evidence, "inventory.json");
    const ledgerFile = path.join(evidence, "ledger.json");
    for (const file of [inventoryFile, ledgerFile]) {
        if (!existsSync(file)) {
            throw new CliError(EXIT.INPUT, "there is no evidence to list yet", [`${file} does not exist`, "run ingest first: node skills/azure-dr-assessment/scripts/ingest.mjs --assessment <path>"]);
        }
    }
    const inventory = await readInventory(inventoryFile);
    const ledger = await Ledger.load(ledgerFile);
    // The first Observed name fact of a resource names it: a fact that comes later, an Inferred one included, never replaces it.
    const identity = new Map();
    for (const entry of ledger.entries) {
        if (entry.kind === "fact" && entry.strength === "Observed" && entry.property === "name" && !identity.has(entry.subject)) identity.set(entry.subject, entry.id);
    }

    const wantedType = values.type?.toLowerCase();
    const wantedGroup = values["resource-group"]?.toLowerCase();
    const matches = inventory.resources.filter((resource) => (!wantedType || resource.armType?.toLowerCase() === wantedType) && (!wantedGroup || groupOf(resource).toLowerCase() === wantedGroup));
    // Resource group names are not case sensitive: one group per lower-cased name, shown the way the first resource spelled it.
    const groups = new Map();
    for (const resource of inventory.resources) {
        const name = groupOf(resource);
        const group = groups.get(name.toLowerCase()) ?? { name, resources: 0 };
        group.resources++;
        groups.set(name.toLowerCase(), group);
    }

    return {
        total: inventory.resources.length,
        matched: matches.length,
        offset,
        shown: Math.min(limit, Math.max(0, matches.length - offset)),
        resourceGroups: [...groups.values()].sort((a, b) => b.resources - a.resources || byCodeUnit(a.name, b.name)),
        resources: matches.slice(offset, offset + limit).map((resource) => ({
            id: identity.get(resource.ref) ?? null,
            ref: resource.ref,
            name: resource.name,
            armType: resource.armType,
            resourceGroup: resource.resourceGroup ?? null,
            location: resource.location ?? null,
            sku: resource.sku ?? null,
            zones: resource.zones ?? null,
        })),
    };
}

await runCli({
    name: "resources",
    description: "List the in-scope inventory resources, one compact row each with the id of the ledger fact that names it, for the stage 4 diagram",
    spec,
    main,
});
