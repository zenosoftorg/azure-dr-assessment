import { mkdir } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./lib/atomic.mjs";
import { CliError, EXIT, runCli } from "./lib/cli.mjs";
import { collectFit, collectInventory } from "./lib/live.mjs";
import { isInsideSkillOrPlugin } from "./lib/paths.mjs";
import { isSecretName, isSecretValue } from "./lib/secrets.mjs";

const spec = {
    subscriptions: { type: "string", help: "Subscription ids, comma separated (inventory mode)" },
    tenant: { type: "string", help: "Tenant id to require (default: whatever az is signed in to)" },
    mode: { type: "string", help: "inventory (default) or fit" },
    location: { type: "string", help: "DR region for fit mode, for example swedencentral" },
    sizes: { type: "string", help: "VM sizes to check in fit mode, comma separated" },
    out: { type: "string", help: "Write the collected data to this JSON file (required for fit mode)" },
    first: { type: "string", help: "Resource Graph page size, 1 to 1000 (default 1000)" },
};

const list = (text) => (text ?? "").split(",").map((item) => item.trim()).filter(Boolean);

/** GC-07 backstop: the same checks as validateInventory, applied to the rows before anything is written. Offenders are dropped and listed. */
function dropSecrets(live) {
    const resources = live.resources.map((resource) => {
        const dropped = [...resource.droppedFields];
        const fields = {};
        for (const [name, value] of Object.entries(resource.fields ?? {})) {
            if (isSecretName(name) || isSecretValue(value)) dropped.push(name);
            else fields[name] = value;
        }
        const tags = {};
        for (const [name, value] of Object.entries(resource.tags ?? {})) {
            if (isSecretName(name) || isSecretValue(value)) dropped.push(`tags.${name}`);
            else tags[name] = value;
        }
        return { ...resource, fields, tags, droppedFields: [...new Set(dropped)].sort() };
    });
    return { ...live, resources };
}

async function write(file, data) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, `${JSON.stringify({ schemaVersion: 1, ...data }, null, 2)}\n`);
}

await runCli({
    name: "collect-live",
    description: "Read-only live collection through az: Resource Graph inventory, or DR-region fit (VM sizes and vCPU quota)",
    spec,
    async main(values) {
        const mode = values.mode ?? "inventory";
        if (!["inventory", "fit"].includes(mode)) throw new CliError(EXIT.USAGE, "--mode must be inventory or fit");
        const first = values.first === undefined ? 1000 : Number(values.first);
        if (!Number.isInteger(first) || first < 1 || first > 1000) throw new CliError(EXIT.USAGE, "--first must be a whole number from 1 to 1000");
        const out = values.out ? path.resolve(values.out) : null;
        const subscriptionIds = list(values.subscriptions);
        if (out && isInsideSkillOrPlugin(path.dirname(out))) {
            throw new CliError(EXIT.REFUSED, "--out is inside the skill or plugin directory", [`${out} would hold customer data`, "write the collection below the assessment output root"]);
        }

        if (mode === "fit") {
            if (!values.location) throw new CliError(EXIT.USAGE, "fit mode needs --location");
            if (!out) throw new CliError(EXIT.USAGE, "fit mode needs --out");
            const fit = await collectFit({ location: values.location, sizes: list(values.sizes), subscriptionIds, tenantId: values.tenant ?? null });
            await write(out, { mode, ...fit });
            return {
                mode, tenantId: fit.tenantId, subscriptions: [fit.subscription], queries: fit.queries, rows: fit.usage.length + fit.skus.length,
                permissionGaps: [], out, warnings: fit.warnings,
            };
        }
        if (subscriptionIds.length === 0) throw new CliError(EXIT.USAGE, "inventory mode needs --subscriptions");
        const live = dropSecrets(await collectInventory({ subscriptionIds, tenantId: values.tenant ?? null, first }));
        if (out) await write(out, { mode, ...live });
        return {
            mode, tenantId: live.tenantId, subscriptions: live.subscriptions, queries: live.queries, rows: live.resources.length,
            permissionGaps: live.permissionGaps, out, warnings: live.warnings,
        };
    },
});
