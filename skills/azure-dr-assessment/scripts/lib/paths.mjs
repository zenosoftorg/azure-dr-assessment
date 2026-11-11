import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CliError, EXIT } from "./cli.mjs";

const HERE = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));

export function copilotHome(env = process.env) {
    return env.COPILOT_HOME || path.join(homedir(), ".copilot");
}

/** <repo>/skills/azure-dr-assessment, found from this file's location. */
export function skillRoot() {
    return path.resolve(HERE, "..", "..");
}

export function repoRoot() {
    return path.resolve(skillRoot(), "..", "..");
}

export function defaultPatternsDir() {
    return path.join(skillRoot(), "patterns");
}

/** The pattern pack to use: flag, then DR_PATTERNS_DIR, then the bundled pack. */
export function patternsDir(env = process.env, flag = null) {
    const chosen = flag || env.DR_PATTERNS_DIR || null;
    if (!chosen) return { dir: defaultPatternsDir(), isDefault: true };
    const dir = path.resolve(chosen);
    return { dir, isDefault: dir === defaultPatternsDir() };
}

export function defaultPlaybooksDir() {
    return path.join(skillRoot(), "playbooks");
}

/** The playbook folder to use: flag, then DR_PLAYBOOKS_DIR, then the bundled folder. */
export function playbooksDir(env = process.env, flag = null) {
    const chosen = flag || env.DR_PLAYBOOKS_DIR || null;
    if (!chosen) return { dir: defaultPlaybooksDir(), isDefault: true };
    const dir = path.resolve(chosen);
    return { dir, isDefault: dir === defaultPlaybooksDir() };
}

/** The first folder that holds the canvas library: the repository copy, then the user-scope install. */
export function canvasRoot(env = process.env, repo = repoRoot()) {
    const candidates = [
        path.join(repo, "extensions", "architecture-canvas"),
        path.join(copilotHome(env), "extensions", "architecture-canvas"),
    ];
    return candidates.find((dir) => existsSync(path.join(dir, "web", "edge-route.mjs"))) ?? null;
}

export async function loadCanvasModules(root = canvasRoot()) {
    if (!root) {
        throw new CliError(EXIT.ENVIRONMENT, "architecture-canvas library not found", [
            "looked in <repo>/extensions/architecture-canvas and $COPILOT_HOME/extensions/architecture-canvas",
        ]);
    }
    const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
    const [store, icons, config, layout, route] = await Promise.all([
        load("lib/store.mjs"),
        load("lib/icons.mjs"),
        load("lib/config.mjs"),
        load("web/layout.mjs"),
        load("web/edge-route.mjs"),
    ]);
    return { root, store, icons, config, layout, route };
}

/** Where fetch-icons writes: the override whether or not it exists yet, else the default cache. */
export function iconRootTarget(env = process.env) {
    return env.ARCH_CANVAS_ICON_ROOT || path.join(copilotHome(env), "extensions", "architecture-canvas", "Final SVG Icons");
}

/** Where to read icons from. The canvas config honors ARCH_CANVAS_ICON_ROOT only when that path exists. */
export function resolveIconRootForRead(canvas, flag = null) {
    if (flag) return path.resolve(flag);
    return canvas.config.resolveIconRoot(undefined);
}

export function slugify(text, max = 40, fallback = "workload") {
    const slug = String(text ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, max)
        .replace(/-+$/g, "");
    return slug || fallback;
}

/** True when an ancestor is the azure-dr-assessment plugin root or skill folder. */
export function isInsideSkillOrPlugin(dir) {
    let current = path.resolve(dir);
    for (;;) {
        const manifest = path.join(current, ".claude-plugin", "plugin.json");
        if (existsSync(manifest)) {
            try {
                if (JSON.parse(readFileSync(manifest, "utf8")).name === "azure-dr-assessment") return true;
            } catch {
                // an unreadable manifest is not ours: keep walking
            }
        }
        const skill = path.join(current, "SKILL.md");
        if (existsSync(skill) && /^name:\s*azure-dr-assessment\s*$/m.test(readFileSync(skill, "utf8").slice(0, 2000))) {
            return true;
        }
        const parent = path.dirname(current);
        if (parent === current) return false;
        current = parent;
    }
}

/** dr-assessment/{app}/ under the working directory, or the override. Never inside the skill or plugin. */
export function outputRootFor({ cwd, app, override = null }) {
    const base = path.resolve(cwd);
    const dir = override ? path.resolve(base, override) : path.join(base, "dr-assessment", app);
    if (isInsideSkillOrPlugin(dir)) {
        throw new CliError(EXIT.REFUSED, "the output folder is inside the skill or plugin directory", [
            `${dir} is inside the azure-dr-assessment skill or plugin`,
            "run from another folder, or pass --out <folder> outside the plugin",
        ]);
    }
    const relative = path.relative(base, dir);
    const shown = relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : dir;
    const text = shown.split(path.sep).join("/");
    return { dir, announce: `Output folder: ${text.endsWith("/") ? text : `${text}/`}` };
}

/** One word of a command line: left alone when it only holds safe characters, else quoted for the platform's shell. A word that starts with "=" is quoted too, because zsh expands =cmd to a path. */
export function quoteArg(text, platform = process.platform) {
    const word = String(text);
    const safe = platform === "win32" ? /^[A-Za-z0-9_@%+=:,./\\-]+$/ : /^[A-Za-z0-9_@%+=:,./-]+$/;
    if (safe.test(word) && !word.startsWith("=")) return word;
    return platform === "win32" ? `"${word.replace(/"/g, '""')}"` : `'${word.replace(/'/g, "'\\''")}'`;
}

/** The command line that runs a script of this skill from any folder: node, the script's absolute path and the arguments. */
export function scriptCommand(name, args = [], platform = process.platform) {
    return ["node", path.join(skillRoot(), "scripts", name), ...args].map((word) => quoteArg(word, platform)).join(" ");
}

export function browserCandidates(platform = process.platform, env = process.env) {
    if (platform === "darwin") {
        return [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];
    }
    if (platform === "win32") {
        const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LocalAppData].filter(Boolean);
        return roots.flatMap((root) => [
            path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
            path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        ]);
    }
    const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
    const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
    return dirs.flatMap((dir) => names.map((name) => path.join(dir, name)));
}

/**
 * When DR_BROWSER is set, returns it if it exists and null otherwise (no fallback to a system browser).
 * When unset, returns the first existing candidate for this platform, or null.
 */
export function findBrowser(env = process.env, candidates = browserCandidates(process.platform, env)) {
    if (env.DR_BROWSER) return existsSync(env.DR_BROWSER) ? env.DR_BROWSER : null;
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
