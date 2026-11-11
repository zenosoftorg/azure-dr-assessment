import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { CliError, EXIT, runCli } from "./lib/cli.mjs";
import { UnreadableLibraryError, countSvgs, displayUrl, setById } from "./lib/icon-sets.mjs";
import { canvasRoot, findBrowser, iconRootTarget, loadCanvasModules, resolveIconRootForRead, scriptCommand } from "./lib/paths.mjs";

const NODE_FLOOR = 22;
const DEFAULT_LEARN_URL = "https://learn.microsoft.com/api/mcp";
const UNVERIFIED = "Microsoft Learn guidance is labelled Unverified";

const spec = {
    live: { type: "boolean", help: "Also check the Azure CLI: az, the resource-graph extension and the sign-in" },
    offline: { type: "boolean", help: "Skip the Microsoft Learn network probe" },
    strict: { type: "boolean", help: "Exit 3 when any check is not ok" },
    "icon-root": { type: "string", help: "Check this icon library instead of the one the canvas resolves" },
};

const ok = (id, detail) => ({ id, status: "ok", detail, effect: "none" });
const firstLine = (text) => String(text).trim().split(/\r?\n/)[0] || "no output";

function checkNode() {
    const version = process.versions.node;
    const supported = Number(version.split(".")[0]) >= NODE_FLOOR;
    const check = supported
        ? ok("node", `Node ${version}`)
        : {
              id: "node",
              status: "missing",
              detail: `Node ${version} is older than ${NODE_FLOOR}`,
              effect: "the scripts are not supported on this version; the skill produces Markdown and Mermaid only",
              next: `install Node ${NODE_FLOOR} or later`,
          };
    return { node: { version, ok: supported }, check };
}

async function checkCanvas() {
    const missing = (detail) => ({
        id: "canvas-library",
        status: "missing",
        detail,
        effect: "diagrams and presentations are replaced by Markdown and Mermaid",
        next: "restore extensions/architecture-canvas from this repository",
    });
    const dir = canvasRoot();
    if (!dir) return { check: missing("not found in <repo>/extensions/architecture-canvas or $COPILOT_HOME/extensions/architecture-canvas") };
    try {
        return { check: ok("canvas-library", dir), modules: await loadCanvasModules(dir) };
    } catch (err) {
        return { check: missing(`${dir} does not load: ${err.message}`) };
    }
}

function checkIcons(flag, modules) {
    let iconRoot = flag ? path.resolve(flag) : null;
    if (!iconRoot && modules) iconRoot = resolveIconRootForRead(modules);
    if (!iconRoot && existsSync(iconRootTarget())) iconRoot = iconRootTarget();
    const azureDir = iconRoot ? path.join(iconRoot, setById("azure").dir) : null;
    let found = 0;
    let unreadable = null;
    try {
        found = azureDir ? countSvgs(azureDir).files : 0;
    } catch (err) {
        if (!(err instanceof UnreadableLibraryError)) throw err;
        unreadable = err;
    }
    if (found > 0) return ok("icons", `${found} Azure icon files in ${iconRoot}`);
    return {
        id: "icons",
        status: "missing",
        detail: unreadable ? `unreadable: ${unreadable.message}` : iconRoot ? `no Azure icon files under ${azureDir}` : "no icon library found",
        effect: "presentations are refused (zero icons) until the icons are fetched; diagram files are still built, with their icon ids unchecked",
        next: scriptCommand("fetch-icons.mjs", flag ? ["--root", iconRoot] : []),
    };
}

async function checkLearn(offline) {
    const degraded = (detail) => ({ id: "learn-network", status: "degraded", detail, effect: UNVERIFIED });
    if (offline || process.env.DR_NO_NETWORK === "1") return degraded("network probe skipped (offline)");
    const url = process.env.DR_LEARN_URL || DEFAULT_LEARN_URL;
    try {
        const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
        const detail = `${displayUrl(url)} answered HTTP ${response.status}`;
        return response.status >= 500 ? degraded(detail) : ok("learn-network", detail);
    } catch (err) {
        // fetch error messages can echo the whole URL, so only a code or a fixed phrase is reported
        const reason = err?.name === "TimeoutError" ? "timed out" : (err?.cause?.code ?? "request failed");
        return degraded(`${displayUrl(url)} is not reachable: ${reason}`);
    }
}

function runCommand(command, args) {
    return new Promise((resolve) => {
        execFile(command, args, { timeout: 30_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({ failed: Boolean(error), notFound: error?.code === "ENOENT", stdout: String(stdout), stderr: String(stderr) });
        });
    });
}

/** Only `az version` and `az account show` run here; both are on the read-only allowlist (contracts 8.4). */
async function checkAz() {
    const command = process.env.DR_AZ || "az";
    const missing = (detail, next) => ({
        id: "az",
        status: "missing",
        detail,
        effect: "live collection is unavailable; use an ARI workbook instead",
        next,
    });
    const version = await runCommand(command, ["version"]);
    if (version.notFound) return missing(`the Azure CLI (${command}) was not found`, "install the Azure CLI: https://learn.microsoft.com/cli/azure/install-azure-cli");
    if (version.failed) return missing(`\`az version\` failed: ${firstLine(version.stderr)}`, "check the Azure CLI installation");
    let extensions;
    try {
        extensions = JSON.parse(version.stdout).extensions ?? {};
    } catch {
        return missing("`az version` did not print JSON", "run: az config set core.output=json");
    }
    if (!extensions["resource-graph"]) return missing("the resource-graph extension is not installed", "az extension add --name resource-graph");
    const account = await runCommand(command, ["account", "show"]);
    if (account.failed) return missing("the Azure CLI is not signed in", "az login");
    return ok("az", `Azure CLI with resource-graph ${extensions["resource-graph"]}, signed in`);
}

function checkBrowser() {
    const browser = findBrowser();
    if (browser) return ok("browser", browser);
    return {
        id: "browser",
        status: "degraded",
        detail: "no Chrome, Edge or Chromium found (set DR_BROWSER to override)",
        effect: "presentations are built but not verified in a browser; the check is reported as not run",
    };
}

async function main(values) {
    const nodeResult = checkNode();
    const canvas = await checkCanvas();
    const [learn, az] = await Promise.all([checkLearn(Boolean(values.offline)), values.live ? checkAz() : null]);
    const checks = [nodeResult.check, canvas.check, checkIcons(values["icon-root"], canvas.modules), learn, ...(az ? [az] : []), checkBrowser()];
    const problems = checks.filter((entry) => entry.status !== "ok");
    const blocked = checks.some((entry) => (entry.id === "node" || entry.id === "canvas-library") && entry.status !== "ok");
    const summary = {
        mode: blocked ? "reasoning-only" : "full",
        node: nodeResult.node,
        checks: checks.map(({ id, status, detail, effect }) => ({ id, status, detail, effect })),
        degradations: problems.map((entry) => `${entry.id}: ${entry.effect}`),
        nextActions: problems.map((entry) => entry.next).filter(Boolean),
    };
    if (values.strict && problems.length > 0) {
        const noun = problems.length === 1 ? "check is" : "checks are";
        throw new CliError(EXIT.ENVIRONMENT, `${problems.length} preflight ${noun} not ok`, summary.degradations, summary);
    }
    return summary;
}

await runCli({
    name: "preflight",
    description: "Report what the environment can and cannot do and what degrades; it never blocks the run",
    spec,
    main,
});
