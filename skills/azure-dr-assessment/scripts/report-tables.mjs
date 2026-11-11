import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./lib/atomic.mjs";
import { CliError, EXIT, runCli } from "./lib/cli.mjs";
import { readInventory } from "./lib/inventory.mjs";
import { Ledger } from "./lib/ledger.mjs";
import { isInsideSkillOrPlugin } from "./lib/paths.mjs";
import { evidenceSection, injectTables, patternsSection, sourcesSection } from "./lib/report-tables.mjs";

const spec = {
    root: { type: "string", help: "The output folder: the one that holds assessment.yaml and evidence/", required: true },
    inject: { type: "string", help: "Report to update: the text between the dr-tables markers is replaced" },
};

async function readResolution(file) {
    let text;
    try {
        text = await readFile(file, "utf8");
    } catch (err) {
        throw new CliError(EXIT.INPUT, `cannot read ${file}`, [err.message]);
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new CliError(EXIT.INPUT, `${file} is not valid JSON`, [err.message]);
    }
}

async function main(values) {
    const target = values.inject ? path.resolve(values.inject) : null;
    if (target && isInsideSkillOrPlugin(path.dirname(target))) {
        throw new CliError(EXIT.REFUSED, "the report is inside the skill or plugin directory", [`${target} would hold customer data`, "keep the report below the assessment output root"]);
    }
    const evidence = path.join(path.resolve(values.root), "evidence");
    const ledger = await Ledger.load(path.join(evidence, "ledger.json"));
    const warnings = [];

    const inventoryFile = path.join(evidence, "inventory.json");
    const inventory = existsSync(inventoryFile) ? await readInventory(inventoryFile) : null;
    if (!inventory) warnings.push("evidence/inventory.json is missing");

    const resolutionFile = path.join(evidence, "pattern-resolution.json");
    let resolution = null;
    if (existsSync(resolutionFile)) {
        resolution = await readResolution(resolutionFile);
        if (resolution === null) warnings.push("evidence/pattern-resolution.json holds no resolution");
    } else {
        warnings.push("evidence/pattern-resolution.json is missing");
    }

    const sections = {
        evidence: evidenceSection({ ledger, inventory }),
        sources: sourcesSection({ ledger }),
        patterns: patternsSection({ resolution }),
    };
    let injected = null;
    if (target) {
        injected = target;
        const text = await readFile(injected, "utf8").catch((err) => {
            throw new CliError(EXIT.INPUT, "the report cannot be read", [injected, err.code ?? "read failed"]);
        });
        await writeFileAtomic(injected, injectTables(text, sections));
    }
    return { sections, injected, counts: ledger.counts(), warnings };
}

await runCli({
    name: "report-tables",
    description: "Build report sections B (evidence), C (documentation sources) and D (pattern register) from the evidence files and inject them into the report",
    spec,
    main,
});
