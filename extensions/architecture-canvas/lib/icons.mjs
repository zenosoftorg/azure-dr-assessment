// Icon catalog: scans the Microsoft SVG icon library, normalizes the wildly
// different filename conventions per collection, and collapses size/theme
// variants into a single searchable entry.
//
// Filename conventions handled:
//   Azure         00028-icon-service-Batch-AI.svg      -> "Batch AI"
//   Fabric        add_pipeline_20_non-item.svg          -> "Add Pipeline" (size variant)
//   Entra         Microsoft Entra ID BW icon.svg        -> "Microsoft Entra ID" (BW variant)
//   PowerPlatform CopilotStudio_scalable.svg            -> "Copilot Studio"
//   Dynamics      BusinessCentral_scalable.svg          -> "Business Central"
//   M365          Apps List Detail.svg (in themed dir)  -> "Apps List Detail" (theme variant)

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const COLLECTIONS = [
    { dir: "Azure_Public_Service_Icons_V24", id: "azure", label: "Azure", weight: 0 },
    { dir: "Microsoft Entra architecture icons - Oct 2023", id: "entra", label: "Entra", weight: 1 },
    { dir: "Power-Platform-icons-scalable", id: "power", label: "Power Platform", weight: 2 },
    { dir: "Dynamics-365-icons-scalable", id: "dynamics", label: "Dynamics 365", weight: 3 },
    { dir: "2024-microsoft-365-content-icons", id: "m365", label: "Microsoft 365", weight: 4 },
    { dir: "Fabric Icons", id: "fabric", label: "Fabric", weight: 5 },
];

const AZURE_PREFIX = /^\d+-icon-service-/i;
const FABRIC_PART = /^(.*?)_(\d+)(?:_(.*))?$/;
const SCALABLE_SUFFIX = /_scalable$/i;
const ENTRA_SUFFIX = /\s*(filled\s*)?(BW|color)\s*icon(\s*\(product family\))?$/i;

function titleCase(text) {
    return text
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalize(collectionId, fileName, relativeDir) {
    const base = fileName.replace(/\.svg$/i, "");
    let name = base;
    let variant = null;
    let size = null;

    switch (collectionId) {
        case "azure":
            name = base.replace(AZURE_PREFIX, "").replace(/-/g, " ");
            break;
        case "fabric": {
            const match = FABRIC_PART.exec(base);
            if (match) {
                name = match[1];
                size = Number(match[2]);
                variant = match[3] || null;
            }
            name = titleCase(name);
            break;
        }
        case "entra":
            variant = /color/i.test(base) ? "color" : "bw";
            name = base.replace(ENTRA_SUFFIX, "").trim();
            break;
        case "power":
        case "dynamics":
            name = titleCase(base.replace(SCALABLE_SUFFIX, ""));
            break;
        case "m365":
            // Theme lives in the directory: "Microsoft Blue/48x48 Dark Blue Icon".
            variant = relativeDir.replace(/[\\/]/g, " \u00b7 ") || null;
            name = base.replace(/_(Blue|Purple)_(Dark|Light)$/i, "");
            break;
        default:
            name = titleCase(base);
    }

    name = name.replace(/\s+/g, " ").trim();
    return { name, variant, size };
}

/** Prefer larger Fabric sizes and color Entra icons when choosing a default. */
function variantScore(collectionId, entry) {
    if (collectionId === "fabric") return entry.size || 0;
    if (collectionId === "entra") return entry.variant === "color" ? 10 : 0;
    if (collectionId === "m365") {
        const v = entry.variant || "";
        if (/Dark/i.test(v)) return 5;
        if (/Grey/i.test(v)) return 3;
        return 1;
    }
    return 0;
}

async function walk(dir, base = dir, out = []) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await walk(full, base, out);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".svg")) {
            out.push({ full, relative: path.relative(base, full) });
        }
    }
    return out;
}

function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export class IconCatalog {
    constructor(root) {
        this.root = root;
        this.icons = [];
        this.byId = new Map();
        this.ready = false;
    }

    async build() {
        if (!this.root) {
            this.ready = true;
            return this;
        }
        const grouped = new Map();

        for (const collection of COLLECTIONS) {
            const collectionRoot = path.join(this.root, collection.dir);
            try {
                const info = await stat(collectionRoot);
                if (!info.isDirectory()) continue;
            } catch {
                continue;
            }

            const files = await walk(collectionRoot);
            for (const file of files) {
                const relativeDir = path.dirname(file.relative);
                const { name, variant, size } = normalize(
                    collection.id,
                    path.basename(file.relative),
                    relativeDir === "." ? "" : relativeDir,
                );
                if (!name) continue;

                const id = `${collection.id}:${slug(name)}`;
                if (!grouped.has(id)) {
                    grouped.set(id, {
                        id,
                        name,
                        collection: collection.id,
                        collectionLabel: collection.label,
                        weight: collection.weight,
                        variants: [],
                    });
                }
                grouped.get(id).variants.push({
                    variant,
                    size,
                    path: file.full,
                    relative: file.relative,
                });
            }
        }

        for (const icon of grouped.values()) {
            icon.variants.sort(
                (a, b) => variantScore(icon.collection, b) - variantScore(icon.collection, a),
            );
            icon.defaultVariant = icon.variants[0];
            icon.search = `${icon.name} ${icon.collectionLabel}`.toLowerCase();
            this.byId.set(icon.id, icon);
        }

        this.icons = [...grouped.values()].sort(
            (a, b) => a.weight - b.weight || a.name.localeCompare(b.name),
        );
        this.ready = true;
        return this;
    }

    get size() {
        return this.icons.length;
    }

    collections() {
        const counts = new Map();
        for (const icon of this.icons) {
            counts.set(icon.collection, (counts.get(icon.collection) || 0) + 1);
        }
        return COLLECTIONS.filter((c) => counts.has(c.id)).map((c) => ({
            id: c.id,
            label: c.label,
            count: counts.get(c.id),
        }));
    }

    /** Token-AND substring search, ranked by prefix / word-boundary quality. */
    search(query, { collection = null, limit = 120 } = {}) {
        const tokens = (query || "").toLowerCase().split(/\s+/).filter(Boolean);
        const results = [];

        for (const icon of this.icons) {
            if (collection && icon.collection !== collection) continue;
            if (tokens.length && !tokens.every((t) => icon.search.includes(t))) continue;

            let score = icon.weight;
            if (tokens.length) {
                const first = tokens[0];
                const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                if (icon.search.startsWith(first)) score -= 30;
                else if (new RegExp(`\\b${escaped}`).test(icon.search)) score -= 15;
                score += Math.min(icon.name.length / 20, 5);
            }
            results.push({ icon, score });
        }

        results.sort((a, b) => a.score - b.score || a.icon.name.localeCompare(b.icon.name));
        return results.slice(0, limit).map(({ icon }) => this.toJson(icon));
    }

    toJson(icon) {
        return {
            id: icon.id,
            name: icon.name,
            collection: icon.collection,
            collectionLabel: icon.collectionLabel,
            variants: icon.variants.map((v, index) => ({
                index,
                label: v.variant || (v.size ? `${v.size}px` : "default"),
            })),
        };
    }

    get(id) {
        return this.byId.get(id) || null;
    }

    /** Resolve a loose name ("aks", "key vault") to a catalog entry. */
    resolve(query) {
        if (!query) return null;
        const direct = this.get(query);
        if (direct) return direct;

        const needle = String(query).trim().toLowerCase();
        const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
        const target = canon(needle);

        // Exact name, then singular/spacing-insensitive exact, then the
        // shortest name starting with the query. Only then fall back to
        // ranked search, which can drift ("Azure Functions" ->
        // "Azure Network Function Manager Functions").
        const exact = this.icons.find((i) => i.name.toLowerCase() === needle);
        if (exact) return exact;

        const canonical = this.icons.filter((i) => canon(i.name) === target);
        if (canonical.length) {
            return canonical.sort((a, b) => a.weight - b.weight)[0];
        }

        const prefixed = this.icons
            .filter((i) => i.name.toLowerCase().startsWith(needle))
            .sort((a, b) => a.name.length - b.name.length || a.weight - b.weight);
        if (prefixed.length) return prefixed[0];

        const hits = this.search(needle, { limit: 1 });
        return hits.length ? this.get(hits[0].id) : null;
    }

    async svg(id, variantIndex = 0) {
        const icon = this.get(id);
        if (!icon) return null;
        const variant = icon.variants[variantIndex] || icon.defaultVariant;
        if (!variant) return null;
        try {
            return await readFile(variant.path, "utf8");
        } catch {
            return null;
        }
    }
}

export async function buildCatalog(root) {
    return new IconCatalog(root).build();
}
