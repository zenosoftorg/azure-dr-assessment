import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./lib/atomic.mjs";
import { CliError, EXIT, runCli } from "./lib/cli.mjs";
import { buildDiagram } from "./lib/diagram-spec.mjs";
import { Ledger } from "./lib/ledger.mjs";
import { isInsideSkillOrPlugin, loadCanvasModules, resolveIconRootForRead } from "./lib/paths.mjs";
import { validateResolution } from "./lib/resolve.mjs";

const spec = {
    spec: { type: "string", required: true, help: "Diagram spec, architectures/{id}.spec.json" },
    ledger: { type: "string", required: true, help: "Evidence ledger, evidence/ledger.json" },
    out: { type: "string", help: "Output .arch.json (default: the spec path with .spec.json replaced by .arch.json)" },
    resolution: { type: "string", help: "pattern-resolution.json; required for a proposed-dr spec (completed and valid); its nonDefaultPack flag adds the title suffix" },
    "icon-root": { type: "string", help: "Icon library root (default: ARCH_CANVAS_ICON_ROOT, then the standard locations)" },
};

async function readJson(file, what) {
    let text;
    try {
        text = await readFile(file, "utf8");
    } catch (err) {
        throw new CliError(EXIT.INPUT, `cannot read the ${what}`, [`${file}: ${err.message}`]);
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new CliError(EXIT.INPUT, `the ${what} is not valid JSON`, [`${file}: ${err.message}`]);
    }
}

function defaultOut(specFile) {
    return `${specFile.replace(/(\.spec)?\.json$/, "")}.arch.json`;
}

await runCli({
    name: "build-diagram",
    description: "Validate a diagram spec against the evidence ledger and write the laid-out .arch.json",
    spec,
    async main(values) {
        const specFile = path.resolve(values.spec);
        const out = path.resolve(values.out ?? defaultOut(specFile));
        const ledgerFile = path.resolve(values.ledger);
        const resolutionFile = values.resolution ? path.resolve(values.resolution) : null;
        if (out === specFile || out === ledgerFile || out === resolutionFile) {
            const input = out === specFile ? "spec" : out === ledgerFile ? "ledger" : "resolution";
            throw new CliError(EXIT.USAGE, "--out would overwrite an input", [`${out} is the ${input} file; choose another output path`]);
        }
        if (isInsideSkillOrPlugin(path.dirname(out))) {
            throw new CliError(EXIT.REFUSED, "the output folder is inside the skill or plugin directory", [
                `${out} would hold customer data`,
                "write the diagram below the assessment output root",
            ]);
        }
        const diagramSpec = await readJson(specFile, "diagram spec");
        const resolution = values.resolution ? await readJson(path.resolve(values.resolution), "pattern resolution") : undefined;
        if (resolution !== undefined && (resolution === null || typeof resolution !== "object" || Array.isArray(resolution))) {
            throw new CliError(EXIT.INPUT, "the pattern resolution must be a JSON object", [path.resolve(values.resolution)]);
        }
        const ledger = await Ledger.load(ledgerFile);
        if (diagramSpec?.kind === "proposed-dr") {
            if (resolution === undefined) {
                throw new CliError(EXIT.INPUT, "a proposed-dr spec needs --resolution", ["pass evidence/pattern-resolution.json, completed and checked with resolve-patterns --validate"]);
            }
            const verdict = validateResolution(resolution, { ledgerIds: new Set(ledger.entries.map((entry) => entry.id)) });
            if (!verdict.ok) {
                throw new CliError(EXIT.INPUT, "the pattern resolution is not complete", verdict.errors.map(({ path: at, message }) => `${at}: ${message}`));
            }
        }
        const canvas = await loadCanvasModules();
        const catalog = await canvas.icons.buildCatalog(resolveIconRootForRead(canvas, values["icon-root"] ?? null));
        const { diagram, genericIcons, closestIcons } = buildDiagram(diagramSpec, { ledger, catalog, modules: canvas, resolution });

        const warnings = [];
        if (catalog.size === 0) warnings.push("no icon library found: icon ids come from the table and are not checked; run fetch-icons");
        const used = new Set([...diagram.nodes.map((node) => node.group), ...diagram.groups.map((group) => group.parent)]);
        for (const group of diagram.groups) {
            if (!used.has(group.id)) warnings.push(`group ${JSON.stringify(group.label)} holds no node`);
        }

        await mkdir(path.dirname(out), { recursive: true });
        await writeFileAtomic(out, `${JSON.stringify(diagram, null, 2)}\n`);
        return {
            out, id: diagramSpec.id, kind: diagramSpec.kind, nodes: diagram.nodes.length, edges: diagram.edges.length, groups: diagram.groups.length,
            genericIcons, closestIcons, warnings,
        };
    },
});
