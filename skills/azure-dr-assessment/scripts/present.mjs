import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CliError, EXIT, runCli } from "./lib/cli.mjs";
import { isInsideSkillOrPlugin, skillRoot } from "./lib/paths.mjs";
import { secretPaths } from "./lib/secrets.mjs";

const STORY_SUFFIX = ".story.mjs";
const DATA_SUFFIX = ".story-data.json";
const REASONS = {
    "zero-icons": "no icon could be read from the icon library, so the presentation was not built (run fetch-icons or pass --icon-root)",
    "unresolved-labels": "the story refers to labels that are not in the diagram",
};

const spec = {
    story: { type: "string", required: true, help: "Story module, presentations/{id}.story.mjs" },
    diagram: { type: "string", help: "Diagram .arch.json (default: architectures/{id}.arch.json beside the presentations folder)" },
    out: { type: "string", help: "Output HTML (default: the story path with .story.mjs replaced by .html)" },
    "icon-root": { type: "string", help: "Icon library root (default: ARCH_CANVAS_ICON_ROOT, then the standard locations)" },
};

/** Defaults follow the naming of contracts 4.5: presentations/<id>.story.mjs, architectures/<id>.arch.json, presentations/<id>.html. */
function locate(values, story) {
    const named = story.endsWith(STORY_SUFFIX);
    const id = named ? path.basename(story, STORY_SUFFIX) : null;
    if (!values.diagram && !named) {
        throw new CliError(EXIT.USAGE, "pass --diagram: the story file is not named <id>.story.mjs, so the diagram cannot be derived from it");
    }
    const diagram = values.diagram ? path.resolve(values.diagram) : path.join(path.dirname(story), "..", "architectures", `${id}.arch.json`);
    const out = values.out ? path.resolve(values.out) : named ? path.join(path.dirname(story), `${id}.html`) : story.replace(/\.mjs$/, ".html");
    return { diagram: path.resolve(diagram), out: path.resolve(out) };
}

/**
 * GC-07: the narration in presentations/<id>.story-data.json ends up in a customer-facing HTML file, and the templates
 * cannot hold this rule (they import only node: built-ins, because the model copies them to the output folder). A string
 * in it that looks like a secret stops the build before the builder runs; the details name the path and never the value.
 * A data file that cannot be read or parsed is left to the template to report, and a story with no data file beside it
 * (a custom story module) is not screened.
 */
function screenStoryData(story) {
    if (!story.endsWith(STORY_SUFFIX)) return;
    const dataFile = `${story.slice(0, -STORY_SUFFIX.length)}${DATA_SUFFIX}`;
    let data;
    try {
        data = JSON.parse(readFileSync(dataFile, "utf8"));
    } catch {
        return;
    }
    const found = secretPaths(data);
    if (found.length > 0) {
        throw new CliError(
            EXIT.INPUT,
            "the story data holds text that looks like a secret, so the presentation was not built",
            found.map((at) => `${path.basename(dataFile)}: ${at || "(the whole file)"} looks like a secret (key, token, password or connection string) and must not appear in a presentation`),
        );
    }
}

function runBuilder(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
            process.stderr.write(chunk);
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

function lastJson(text) {
    const line = text.trim().split("\n").filter(Boolean).pop();
    try {
        const parsed = JSON.parse(line);
        return parsed !== null && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

await runCli({
    name: "present",
    description: "Build a presentation HTML file from a diagram and a story module with the architecture-presentation builder",
    spec,
    async main(values) {
        const story = path.resolve(values.story);
        const { diagram, out } = locate(values, story);
        if (out === story || out === diagram) {
            throw new CliError(EXIT.USAGE, "--out would overwrite an input", [`${out} is the ${out === story ? "story" : "diagram"} file; choose another output path`]);
        }
        if (isInsideSkillOrPlugin(path.dirname(out))) {
            throw new CliError(EXIT.REFUSED, "the output folder is inside the skill or plugin directory", [
                `${out} would hold customer data`,
                "write the presentation below the assessment output root",
            ]);
        }
        const builder = path.join(skillRoot(), "..", "architecture-presentation", "scripts", "build-presentation.mjs");
        if (!existsSync(builder)) throw new CliError(EXIT.ENVIRONMENT, "the presentation builder is missing", [builder]);
        screenStoryData(story);

        const args = [builder, diagram, story, out, ...(values["icon-root"] ? ["--icon-root", path.resolve(values["icon-root"])] : []), "--json"];
        const { code, stdout, stderr } = await runBuilder(args);
        const report = lastJson(stdout);
        if (code === 0 && report?.ok === true) {
            return { out: path.resolve(report.out ?? out), icons: report.icons, missingIcons: report.missingIcons ?? [], scenes: report.scenes, bytes: report.bytes };
        }
        if (report && Number.isInteger(code) && code >= 1 && code <= 4) {
            const extra = {};
            for (const field of ["reason", "unresolved", "missingIcons", "iconRoot"]) {
                if (report[field] !== undefined) extra[field] = report[field];
            }
            throw new CliError(code, report.error ?? REASONS[report.reason] ?? report.reason ?? "the presentation builder refused", [...(report.details ?? []), ...(report.unresolved ?? [])], extra);
        }
        throw new CliError(EXIT.UNEXPECTED, "the presentation builder failed without a report", [`exit code ${code}`, ...stderr.trim().split("\n").filter(Boolean).slice(-5)]);
    },
});
