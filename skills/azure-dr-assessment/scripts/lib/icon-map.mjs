import { readFileSync } from "node:fs";
import path from "node:path";
import { skillRoot } from "./paths.mjs";

/** The icon for a node whose type has no better one. */
export const GENERIC_ICON = "azure:all-resources";

const TYPES = JSON.parse(readFileSync(path.join(skillRoot(), "assets", "arm-icon-map.json"), "utf8")).types;
const ID_SHAPED = /^[a-z0-9]+:[a-z0-9-]+$/;

/** The last segment of an ARM type as words: "microsoft.network/natGateways" -> "nat Gateways". */
function spacedSegment(armType) {
    const last = armType.split("/").pop() ?? armType;
    return last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_.]+/g, " ").trim();
}

/**
 * Choose the icon for a diagram node: an explicit icon, the curated table, the closest catalog match,
 * then the generic icon. `how` tells the builder whether to annotate the node. Loose catalog search is
 * unreliable (contracts 8.6), which is why the table comes first and a closest match is always annotated.
 */
export function resolveIcon(node, catalog) {
    const known = Boolean(catalog) && catalog.size > 0;
    const explicit = typeof node?.icon === "string" ? node.icon.trim() : "";
    if (explicit) {
        if (!known) {
            if (ID_SHAPED.test(explicit)) return { iconId: explicit, how: "explicit" };
        } else {
            const hit = catalog.get(explicit) ?? catalog.resolve(explicit);
            if (hit) return { iconId: hit.id, how: "explicit" };
        }
    }
    const armType = typeof node?.armType === "string" ? node.armType.trim() : "";
    const mapped = armType ? TYPES[armType.toLowerCase()] : undefined;
    if (mapped && (!known || catalog.get(mapped))) return { iconId: mapped, how: "mapped" };
    // The table names an icon that the installed sets do not have: a closest match on the last type segment would guess.
    if (mapped) return { iconId: GENERIC_ICON, how: "generic" };
    if (armType && known) {
        const hit = catalog.resolve(spacedSegment(armType));
        if (hit) return { iconId: hit.id, how: "closest" };
    }
    return { iconId: GENERIC_ICON, how: "generic" };
}
