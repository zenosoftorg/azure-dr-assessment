import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CliError, EXIT, runCli } from "./lib/cli.mjs";
import { isInsideSkillOrPlugin, loadCanvasModules } from "./lib/paths.mjs";

const MANIFEST = ".dr-assessment-link.json";

const spec = {
    root: { type: "string", help: "The output folder: the one that holds assessment.yaml and architectures/", required: true },
    "canvas-dir": { type: "string", help: "The folder the canvas lists diagrams from (default: the canvas's own rule, $ARCH_CANVAS_DIAGRAM_DIR else <workspace>/architectures)" },
    force: { type: "boolean", help: "Overwrite a canvas copy that was edited after it was linked" },
};

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function readManifest(file) {
    try {
        const manifest = JSON.parse(readFileSync(file, "utf8"));
        if (manifest && typeof manifest.files === "object" && manifest.files !== null) return manifest;
    } catch {
        // no manifest yet, or an unreadable one: start a new one
    }
    return { schemaVersion: 1, files: {} };
}

async function main(values) {
    const source = path.join(path.resolve(values.root), "architectures");
    const names = existsSync(source) ? readdirSync(source).filter((name) => name.endsWith(".arch.json")).sort() : [];
    if (names.length === 0) throw new CliError(EXIT.INPUT, "no diagrams to link", [`no *.arch.json files under ${source}`]);

    const canvas = await loadCanvasModules();
    const canvasDir = path.resolve(values["canvas-dir"] ?? canvas.config.resolveDiagramDir(process.env.COPILOT_WORKSPACE_PATH || process.cwd()));
    if (isInsideSkillOrPlugin(canvasDir)) {
        throw new CliError(EXIT.REFUSED, "the canvas folder is inside the skill or plugin directory", [`${canvasDir} would hold customer data`, "pass --canvas-dir below your working folder"]);
    }
    if (canvasDir === source) {
        return { canvasDir, linked: [], warnings: [], note: "the canvas already lists this folder; nothing to copy" };
    }

    mkdirSync(canvasDir, { recursive: true });
    const manifestFile = path.join(canvasDir, MANIFEST);
    const manifest = readManifest(manifestFile);
    const linked = [];
    const warnings = [];
    for (const name of names) {
        const from = path.join(source, name);
        const to = path.join(canvasDir, name);
        const fresh = sha256(from);
        let status = "copied";
        if (existsSync(to)) {
            const current = sha256(to);
            if (current === fresh) status = "unchanged";
            else if (current === manifest.files[name]?.sha256 || values.force) status = "updated";
            else {
                status = "kept";
                warnings.push(`${name}: the canvas copy was edited after it was linked; the regenerated diagram stays at ${from} (use --force to overwrite)`);
            }
        }
        if (status === "copied" || status === "updated") copyFileSync(from, to);
        if (status !== "kept") manifest.files[name] = { sha256: fresh, from, linkedAt: new Date().toISOString() };
        linked.push({ id: name.replace(/\.arch\.json$/, ""), from, to, status });
    }
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    return { canvasDir, linked, warnings, note: null };
}

await runCli({
    name: "canvas-link",
    description: "Copy the generated diagrams into the folder the architecture canvas lists, so they can be opened there",
    spec,
    main,
});
