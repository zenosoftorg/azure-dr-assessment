import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readAssessment, normalizeAssessment, serializeAssessment, validateAssessment } from "./lib/assessment.mjs";
import { writeFileAtomic } from "./lib/atomic.mjs";
import { CliError, EXIT, log, runCli } from "./lib/cli.mjs";
import { applyIntake, missingItems, storedPath } from "./lib/intake.mjs";
import { isInsideSkillOrPlugin, outputRootFor } from "./lib/paths.mjs";

const execFileAsync = promisify(execFile);
const HERE = import.meta.dirname;

const spec = {
    assessment: { type: "string", help: "assessment.yaml to read and write (default: dr-assessment/<app>/assessment.yaml under the working directory)" },
    app: { type: "string", help: "Workload name; names the output folder. Required the first time" },
    tier: { type: "string", help: "Landing zone DR tier, 0 to 3. Never inferred" },
    primary: { type: "string", help: "Primary Azure region, for example westeurope" },
    dr: { type: "string", help: "DR region; it need not be the paired region" },
    ari: { type: "string", help: "Path to the Azure Resource Inventory .xlsx export" },
    subscriptions: { type: "string", help: "Comma-separated subscription ids for a read-only live read" },
    tenant: { type: "string", help: "Tenant id for the live read" },
    rto: { type: "string", help: "Numeric RTO target such as 30m or 2h" },
    rpo: { type: "string", help: "Numeric RPO target such as 5m or 0" },
    "failure-scope": { type: "string", help: "zonal, regional or wider (default regional)" },
    environment: { type: "string", help: "Environment of the workload, for example production" },
    "scope-resource-group": { type: "string", multiple: true, help: "Resource group that belongs to the workload" },
    "scope-tag": { type: "string", help: "Tag that marks the workload: name=value" },
    "scope-subscription": { type: "string", multiple: true, help: "Subscription (name or id) that holds the workload" },
    "pause-after-current-state": { type: "boolean", help: "Stop after presentation #1 so the owner can correct it" },
    out: { type: "string", help: "Output folder for a new assessment (default: dr-assessment/<app>)" },
    "patterns-dir": { type: "string", help: "Pattern pack to evaluate the gates against (tests and operators only)" },
};

/** Run a sibling script and return its exit code and JSON envelope. Its stderr, such as the live-read announcement of ingest, is passed on as it is written. */
async function runSibling(name, args, cwd) {
    try {
        const pending = execFileAsync(process.execPath, [path.join(HERE, `${name}.mjs`), ...args], { cwd, maxBuffer: 64 * 1024 * 1024 });
        pending.child.stderr.pipe(process.stderr, { end: false });
        const { stdout } = await pending;
        return { code: EXIT.OK, json: JSON.parse(stdout) };
    } catch (err) {
        let json = null;
        try {
            json = JSON.parse(err.stdout);
        } catch {
            // not an envelope: the message below says what ran
        }
        return { code: typeof err.code === "number" ? err.code : EXIT.UNEXPECTED, json, stderr: String(err.stderr ?? "") };
    }
}

function siblingFailure(name, result) {
    const code = [EXIT.INPUT, EXIT.ENVIRONMENT].includes(result.code) ? result.code : EXIT.UNEXPECTED;
    return new CliError(code, result.json?.error ?? `${name} failed`, result.json?.details ?? [result.stderr.trim().split("\n")[0] || `${name} exited with ${result.code}`]);
}

const selectorIsSet = (a) => a.scope.resource_groups.length > 0 || a.scope.subscriptions.length > 0 || a.scope.tag !== null;

async function main(values) {
    const cwd = process.cwd();
    const given = {
        app: values.app,
        environment: values.environment,
        tier: values.tier,
        rto: values.rto,
        rpo: values.rpo,
        primary: values.primary,
        dr: values.dr,
        failureScope: values["failure-scope"],
        ari: values.ari,
        subscriptions: values.subscriptions,
        tenant: values.tenant,
        scopeResourceGroups: values["scope-resource-group"],
        scopeTag: values["scope-tag"],
        scopeSubscriptions: values["scope-subscription"],
        pauseAfterCurrentState: values["pause-after-current-state"],
    };

    let file = values.assessment ? path.resolve(cwd, values.assessment) : null;
    if (file === null && values.app?.trim()) {
        // A rerun that repeats --app updates the assessment it finds there instead of replacing it.
        // The slug is the one applyIntake gives the name.
        const app = normalizeAssessment({ workload: { name: values.app.trim() } }).workload.app;
        const found = path.join(outputRootFor({ cwd, app, override: values.out ?? null }).dir, "assessment.yaml");
        if (existsSync(found)) file = found;
    }
    const existed = file !== null && existsSync(file);
    const base = existed ? await readAssessment(file) : normalizeAssessment({});
    const { assessment, changes } = applyIntake(base, given, { cwd });
    if (!assessment.workload.name) {
        throw new CliError(EXIT.USAGE, "--app is required the first time: it names the workload and the output folder");
    }

    let outputRoot;
    let announce;
    if (file) {
        outputRoot = path.dirname(file);
        const refused = isInsideSkillOrPlugin(outputRoot);
        if (refused) {
            throw new CliError(EXIT.REFUSED, "the output folder is inside the skill or plugin directory", [`${outputRoot} is inside the azure-dr-assessment skill or plugin`]);
        }
        announce = `Output folder: ${storedPath(outputRoot, cwd)}/`;
    } else {
        ({ dir: outputRoot, announce } = outputRootFor({ cwd, app: assessment.workload.app, override: values.out ?? null }));
        file = path.join(outputRoot, "assessment.yaml");
    }
    if (!existed || values.out) assessment.outputs.directory = storedPath(outputRoot, cwd);

    const validation = validateAssessment(assessment);
    if (!validation.ok) {
        throw new CliError(EXIT.INPUT, "the assessment is not valid", validation.errors.map((error) => `${error.path}: ${error.message}`));
    }
    const text = serializeAssessment(assessment);
    const written = !existed || (await readFile(file, "utf8")) !== text;
    if (written) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFileAtomic(file, text);
        log(`wrote ${file}`);
    }

    const missing = missingItems(assessment);
    const gateArgs = ["--assessment", file, "--gates-only"];
    if (values["patterns-dir"]) gateArgs.push("--patterns-dir", path.resolve(cwd, values["patterns-dir"]));
    const gateRun = await runSibling("resolve-patterns", gateArgs, cwd);
    if (gateRun.code !== EXIT.OK) throw siblingFailure("resolve-patterns", gateRun);
    const { gates, gatesOpen, nonDefaultPack, banner } = gateRun.json;

    let needsScope = null;
    let candidates = [];
    const hasSource = Boolean(assessment.inputs.ari_file) || assessment.inputs.live.subscription_ids.length > 0;
    if (gatesOpen === 0 && hasSource) {
        if (selectorIsSet(assessment)) {
            needsScope = false;
        } else {
            const summary = await runSibling("ingest", ["--assessment", file, "--summary-only"], cwd);
            if (summary.code !== EXIT.OK) throw siblingFailure("ingest", summary);
            needsScope = summary.json.needsScope;
            candidates = summary.json.candidates;
        }
    }

    const result = {
        assessment: file,
        app: assessment.workload.app,
        outputRoot,
        announce,
        written,
        changes,
        complete: missing.length === 0,
        missing,
        gates,
        gatesOpen,
        nonDefaultPack,
        banner,
        needsScope,
        candidates,
    };
    if (gatesOpen > 0) {
        const details = gates.filter((gate) => gate.status === "open").map((gate) => `${gate.id}: ${gate.detail}`);
        throw new CliError(EXIT.REFUSED, "an intake gate is open", details, result);
    }
    return result;
}

await runCli({
    name: "intake",
    description: "Merge what the user said into assessment.yaml, write it, check the two tier gates and tell the model what is still missing",
    spec,
    main,
});
