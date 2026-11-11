import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CliError, EXIT } from "./cli.mjs";

/**
 * The Microsoft icon collections. `dir` is the folder name the canvas catalog
 * (extensions/architecture-canvas/lib/icons.mjs) looks for; `url` is the official
 * download, or null when no direct link is verified (contracts 8.5).
 */
export const ICON_SETS = Object.freeze([
    { id: "azure", dir: "Azure_Public_Service_Icons_V24", url: "https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip", isDefault: true },
    {
        id: "entra",
        dir: "Microsoft Entra architecture icons - Oct 2023",
        url: "https://download.microsoft.com/download/3/1/a/31a56038-856a-4489-88e4-ee5a1c4352be/Microsoft%20Entra%20architecture%20icons%20-%20Oct%202023.zip",
        isDefault: false,
    },
    {
        id: "power",
        dir: "Power-Platform-icons-scalable",
        url: "https://download.microsoft.com/download/498606aa-6d27-4f13-aa5c-1401078c153b/Power-Platform-icons-scalable.zip",
        isDefault: false,
    },
    {
        id: "dynamics",
        dir: "Dynamics-365-icons-scalable",
        url: "https://download.microsoft.com/download/498606aa-6d27-4f13-aa5c-1401078c153b/Dynamics-365-icons-scalable.zip",
        isDefault: false,
    },
    { id: "fabric", dir: "Fabric Icons", url: "https://github.com/microsoft/fabric-samples/raw/main/docs-samples/Icons.zip", isDefault: false },
    { id: "m365", dir: "2024-microsoft-365-content-icons", url: null, isDefault: false },
]);

export const DEFAULT_SET_IDS = Object.freeze(ICON_SETS.filter((set) => set.isDefault).map((set) => set.id));

const VALID_IDS = ICON_SETS.map((set) => set.id).join(", ");

export function setById(id) {
    return ICON_SETS.find((set) => set.id === id) ?? null;
}

/** "azure,fabric" or "all" becomes an ordered list of unique set ids. */
export function parseSetList(text) {
    const wanted = String(text)
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
    if (wanted.length === 0) throw new CliError(EXIT.USAGE, "--sets needs at least one set id", [`valid ids: ${VALID_IDS}, all`]);
    if (wanted.includes("all")) return ICON_SETS.map((set) => set.id);
    const unknown = wanted.filter((id) => !setById(id));
    if (unknown.length > 0) throw new CliError(EXIT.USAGE, `unknown icon set: ${unknown.join(", ")}`, [`valid ids: ${VALID_IDS}, all`]);
    return [...new Set(wanted)];
}

function httpUrl(value, label) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new CliError(EXIT.USAGE, `${label} is not a valid URL`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new CliError(EXIT.USAGE, `${label} must be an http or https URL`);
    }
    if (url.username || url.password) {
        throw new CliError(EXIT.USAGE, `${label} must not contain a user name or password`, [
            "use an unauthenticated mirror or a query-string token (for example a SAS token)",
        ]);
    }
    return url;
}

/** Each entry is "<set>=<url>". Error messages name the flag and the set, never the value. */
export function parseUrlOverrides(entries) {
    const overrides = {};
    for (const entry of entries) {
        const at = entry.indexOf("=");
        const id = at > 0 ? entry.slice(0, at).trim().toLowerCase() : "";
        if (!setById(id)) {
            throw new CliError(EXIT.USAGE, "--url expects <set>=<url> with a known set id", [`valid ids: ${VALID_IDS}`]);
        }
        overrides[id] = httpUrl(entry.slice(at + 1).trim(), `--url ${id}`).toString();
    }
    return overrides;
}

/** The URL to download a set from: override, then mirror, then the official download (null when none is known). */
export function resolveSetUrl(set, { overrides = {}, mirror = null } = {}) {
    if (overrides[set.id]) return httpUrl(overrides[set.id], `--url ${set.id}`).toString();
    if (mirror) {
        const url = httpUrl(mirror, "the mirror URL (--mirror or DR_ICON_MIRROR)");
        url.pathname = `${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(set.dir)}.zip`;
        return url.toString();
    }
    return set.url;
}

/** A URL that is safe to print: credentials, query string and fragment removed. */
export function displayUrl(url) {
    try {
        const parsed = new URL(url);
        const hadQuery = parsed.search !== "";
        for (const part of ["username", "password"]) parsed[part] = "";
        parsed.search = "";
        parsed.hash = "";
        return hadQuery ? `${parsed.toString()}?…` : parsed.toString();
    } catch {
        return "(invalid URL)";
    }
}

/** A folder of the icon library exists but cannot be listed or read. */
export class UnreadableLibraryError extends Error {
    constructor(dir, code) {
        super(`the icon library is unreadable: ${dir} (${code})`);
        this.name = "UnreadableLibraryError";
        this.dir = dir;
        this.reason = code;
    }
}

/** Count the .svg files below a folder (recursive). A missing folder counts as zero; an unreadable one throws UnreadableLibraryError. */
export function countSvgs(dir) {
    let files = 0;
    let bytes = 0;
    const walk = (current) => {
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch (err) {
            if (err?.code === "EACCES" || err?.code === "EPERM") throw new UnreadableLibraryError(current, err.code);
            throw err;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && /\.svg$/i.test(entry.name)) {
                files += 1;
                bytes += statSync(full).size;
            }
        }
    };
    if (existsSync(dir)) walk(dir);
    return { files, bytes };
}
