import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CliError, EXIT, log, runCli } from "./lib/cli.mjs";
import { DEFAULT_SET_IDS, UnreadableLibraryError, countSvgs, displayUrl, parseSetList, parseUrlOverrides, resolveSetUrl, setById } from "./lib/icon-sets.mjs";
import { iconRootTarget, quoteArg } from "./lib/paths.mjs";
import { ZipError, extractZip } from "./lib/zip.mjs";

const DOWNLOAD_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_DOWNLOAD_MB = 100;
const MANIFEST = ".fetch-manifest.json";

const spec = {
    root: { type: "string", help: "Icon library root (default: $ARCH_CANVAS_ICON_ROOT, else <COPILOT_HOME>/extensions/architecture-canvas/Final SVG Icons)" },
    sets: { type: "string", help: "Comma-separated set ids or all (default: azure). Ids: azure, entra, power, dynamics, fabric, m365" },
    mirror: { type: "string", help: "Base URL that serves <collection folder>.zip for every set (default: $DR_ICON_MIRROR)" },
    url: { type: "string", multiple: true, help: "Download one set from this URL instead: <set>=<url>" },
    force: { type: "boolean", help: "Download again even when the set is already present" },
    "dry-run": { type: "boolean", help: "Report what would be downloaded and change nothing" },
};

/** SVG entries only, and never the AppleDouble files (`__MACOSX/`, `._name.svg`) that macOS-made archives carry. */
const wantedEntry = (name) => /\.svg$/i.test(name) && !/(^|\/)(__MACOSX\/|\._)/.test(name);

class DownloadError extends Error {}

/** The largest archive that is accepted: $DR_ICON_MAX_DOWNLOAD_MB megabytes when that is a positive number, else 100. */
function maxDownloadBytes() {
    const megabytes = Number(process.env.DR_ICON_MAX_DOWNLOAD_MB);
    return (megabytes > 0 ? megabytes : DEFAULT_MAX_DOWNLOAD_MB) * 1024 * 1024;
}

const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.round(bytes / 1024)} KB`);

async function download(url) {
    const limit = maxDownloadBytes();
    const tooLarge = () => new DownloadError(`${displayUrl(url)} is larger than ${sizeText(limit)}`);
    try {
        const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
        if (!response.ok) {
            await response.body?.cancel();
            throw new DownloadError(`${displayUrl(url)} answered HTTP ${response.status}`);
        }
        if (Number(response.headers.get("content-length")) > limit) {
            await response.body?.cancel();
            throw tooLarge();
        }
        const chunks = [];
        let received = 0;
        for await (const chunk of response.body ?? []) {
            received += chunk.length;
            if (received > limit) throw tooLarge();
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    } catch (err) {
        if (err instanceof DownloadError) throw err;
        // fetch error messages can echo the whole URL, query string included, so only a code or a fixed phrase is reported
        const reason = err?.name === "TimeoutError" ? `timed out after ${DOWNLOAD_TIMEOUT_MS / 1000} s` : (err?.cause?.code ?? "request failed");
        throw new DownloadError(`cannot reach ${displayUrl(url)}: ${reason}`);
    }
}

/** Extract into <folder>.partial and swap it in only when every entry verified. */
async function install(set, archive, root) {
    const target = path.join(root, set.dir);
    const partial = `${target}.partial`;
    rmSync(partial, { recursive: true, force: true });
    try {
        const { files, bytes } = await extractZip(archive, partial, { filter: wantedEntry });
        if (files.length === 0) throw new ZipError("the archive holds no .svg files");
        rmSync(target, { recursive: true, force: true });
        renameSync(partial, target);
        return { files: files.length, bytes };
    } catch (err) {
        rmSync(partial, { recursive: true, force: true });
        throw err;
    }
}

async function fetchSet(set, { root, url, force, dryRun }) {
    const dir = path.join(root, set.dir);
    const existing = countReadable(dir);
    const entry = { id: set.id, dir, status: "skipped", url: url ? displayUrl(url) : null, files: existing.files, bytes: existing.bytes };
    if (existing.files > 0 && !force) return { entry: { ...entry, status: "present" } };
    if (!url) {
        return { entry: { ...entry, note: `no verified download URL for ${set.id}; pass --url ${set.id}=<url> or --mirror <url>` } };
    }
    if (dryRun) return { entry: { ...entry, note: `dry run: would download ${displayUrl(url)}` } };

    log(`fetch-icons: downloading ${set.id} from ${displayUrl(url)}`);
    try {
        const archive = await download(url);
        const installed = await install(set, archive, root);
        return {
            entry: { ...entry, status: "fetched", files: installed.files, bytes: installed.bytes },
            manifest: {
                dir: set.dir,
                url: displayUrl(url),
                sha256: createHash("sha256").update(archive).digest("hex"),
                files: installed.files,
                bytes: installed.bytes,
                fetchedAt: new Date().toISOString(),
            },
        };
    } catch (err) {
        if (!(err instanceof DownloadError) && !(err instanceof ZipError)) throw err;
        return { entry: { ...entry, status: "failed", error: err.message }, archiveProblem: err instanceof ZipError };
    }
}

function writeManifest(root, sets) {
    const file = path.join(root, MANIFEST);
    let previous = {};
    try {
        previous = JSON.parse(readFileSync(file, "utf8")).sets ?? {};
    } catch {
        // no manifest yet, or an unreadable one: start a new one
    }
    const manifest = { schemaVersion: 1, updatedAt: new Date().toISOString(), sets: { ...previous, ...sets } };
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** The architecture-canvas folder that holds an icon root named like the default one, else null. */
function canvasFolderOf(root) {
    const folder = path.dirname(root);
    return path.basename(root) === "Final SVG Icons" && path.basename(folder) === "architecture-canvas" ? folder : null;
}

async function main(values) {
    const ids = parseSetList(values.sets ?? DEFAULT_SET_IDS.join(","));
    const overrides = parseUrlOverrides(values.url ?? []);
    const mirror = values.mirror || process.env.DR_ICON_MIRROR || null;
    const plan = ids.map((id) => ({ set: setById(id), url: resolveSetUrl(setById(id), { overrides, mirror }) }));

    const dryRun = Boolean(values["dry-run"]);
    const root = path.resolve(values.root || iconRootTarget());
    const canvasFolder = canvasFolderOf(root);
    const createsCanvasFolder = !dryRun && canvasFolder !== null && !existsSync(canvasFolder);
    if (!dryRun) {
        try {
            mkdirSync(root, { recursive: true });
        } catch (err) {
            throw new CliError(EXIT.INPUT, "cannot create the icon root", [`${root}: ${err.message}`]);
        }
    }

    const results = [];
    for (const item of plan) {
        results.push(await fetchSet(item.set, { root, url: item.url, force: Boolean(values.force), dryRun }));
    }
    const entries = results.map((result) => result.entry);
    const fetched = Object.fromEntries(results.filter((result) => result.manifest).map((result) => [result.entry.id, result.manifest]));
    if (Object.keys(fetched).length > 0) writeManifest(root, fetched);

    const summary = {
        root,
        dryRun,
        iconFiles: entries.reduce((total, entry) => total + entry.files, 0),
        sets: entries,
        warnings: [
            ...entries
                .filter((entry) => entry.status === "failed" || (entry.status === "skipped" && (!dryRun || entry.url === null)))
                .map((entry) => `${entry.id}: ${entry.error ?? entry.note}`),
            ...(createsCanvasFolder
                ? [`${canvasFolder} did not exist and was created to hold the icons; the architecture-canvas extension is not installed there (pass --root to keep the icons elsewhere)`]
                : []),
        ],
        hint: values.root && root !== path.resolve(iconRootTarget()) ? `set ARCH_CANVAS_ICON_ROOT=${quoteArg(root)} so the scripts and the canvas read this library` : null,
    };

    if (!dryRun) {
        const azure = setById("azure");
        const azureDir = path.join(root, azure.dir);
        const archiveProblem = results.find((result) => result.entry.id === "azure" && result.archiveProblem);
        if (archiveProblem) {
            throw new CliError(EXIT.INPUT, "the Azure icon archive is corrupt, unsafe or holds no SVG files", [archiveProblem.entry.error], summary);
        }
        if (countReadable(azureDir).files === 0) {
            throw new CliError(EXIT.ENVIRONMENT, "the Azure icon set is missing", [`no .svg files under ${azureDir}`, ...summary.warnings], summary);
        }
    }
    return summary;
}

/** An unreadable library is an environment problem (exit 3), never an unexpected crash. */
function countReadable(dir) {
    try {
        return countSvgs(dir);
    } catch (err) {
        if (err instanceof UnreadableLibraryError) throw new CliError(EXIT.ENVIRONMENT, err.message, [`fix the permissions of ${err.dir} or pass --root with a readable library`]);
        throw err;
    }
}

await runCli({
    name: "fetch-icons",
    description: "Download the Microsoft icon sets into the icon library the canvas and the presentation builder read",
    spec,
    main,
});
