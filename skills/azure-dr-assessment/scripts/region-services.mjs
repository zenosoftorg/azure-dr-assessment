import { existsSync } from "node:fs";
import path from "node:path";
import { readAssessment } from "./lib/assessment.mjs";
import { CliError, EXIT, runCli } from "./lib/cli.mjs";
import { readInventory } from "./lib/inventory.mjs";
import { catalogueAge, defaultMapFile, loadLearnMap, typeHints } from "./lib/learn-map.mjs";
import { playbooksDir } from "./lib/paths.mjs";
import { readPlaybooks } from "./lib/playbooks.mjs";

const spec = {
    assessment: { type: "string", help: "assessment.yaml of the run; the inventory is read from evidence/inventory.json next to it", required: true },
    inventory: { type: "string", help: "Read this inventory.json instead" },
    map: { type: "string", help: "Use this Learn service map instead of the bundled catalogue (tests)" },
    "playbooks-dir": { type: "string", help: "Playbook folder (default: the bundled playbooks; DR_PLAYBOOKS_DIR is also honored)" },
};

// Ties are broken by code unit, never by locale, so the worklist is the same on every machine.
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

async function main(values) {
    const assessmentFile = path.resolve(values.assessment);
    const assessment = await readAssessment(assessmentFile);
    const inventoryFile = path.resolve(values.inventory ?? path.join(path.dirname(assessmentFile), "evidence", "inventory.json"));
    if (!existsSync(inventoryFile)) {
        throw new CliError(EXIT.INPUT, "there is no inventory to analyze yet", [`${inventoryFile} does not exist`, "run ingest first: node skills/azure-dr-assessment/scripts/ingest.mjs --assessment <path>"]);
    }
    const inventory = await readInventory(inventoryFile);
    const map = loadLearnMap(values.map ? path.resolve(values.map) : defaultMapFile());
    const books = playbooksDir(process.env, values["playbooks-dir"] ?? null);
    const { set } = await readPlaybooks(books.dir, { isDefault: books.isDefault });

    const regionsOfType = new Map();
    const resourcesIn = new Map();
    for (const resource of inventory.resources) {
        if (resource.armType && resource.location) {
            const key = resource.armType.toLowerCase();
            regionsOfType.set(key, (regionsOfType.get(key) ?? new Set()).add(resource.location));
        }
        if (resource.location) resourcesIn.set(resource.location, (resourcesIn.get(resource.location) ?? 0) + 1);
    }
    const types = typeHints(inventory.resources, map).map((hint) => ({
        armType: hint.armType,
        count: hint.count,
        regions: [...(regionsOfType.get(hint.armType) ?? [])].sort(),
        mapped: hint.mapped,
        learn: hint.learn,
        playbook: set.byType.get(hint.armType)?.service ?? null,
    }));

    return {
        catalogue: catalogueAge(map),
        declared: { primary: assessment.regions.primary, dr: assessment.regions.dr },
        resources: inventory.resources.length,
        regions: [...resourcesIn.entries()].map(([region, resources]) => ({ region, resources })).sort((a, b) => b.resources - a.resources || byCodeUnit(a.region, b.region)),
        types,
        unmapped: types.filter((type) => !type.mapped).map((type) => type.armType),
    };
}

await runCli({
    name: "region-services",
    description: "List the distinct services in the in-scope inventory with the Learn catalogue's hint for each, as the stage 5 worklist",
    spec,
    main,
});
