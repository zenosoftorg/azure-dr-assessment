/** Style tables and limits of contracts 7.4 for both diagram kinds. Plan 4 adds its rules beside them and leaves them as they are. */

const frozen = (table) => Object.freeze(Object.fromEntries(Object.entries(table).map(([key, value]) => [key, Object.freeze(value)])));

export const GROUP_STYLES = frozen({
    primary: { border: "#0969da", background: "rgba(9,105,218,0.08)", dashed: false },
    dr: { border: "#8250df", background: "rgba(130,80,223,0.08)", dashed: false },
    global: { border: "#1a7f37", background: "rgba(26,127,55,0.08)", dashed: false },
    onprem: { border: "#57606a", background: "rgba(87,96,106,0.08)", dashed: false },
    inferred: { border: "#f59e0b", background: "rgba(245,158,11,0.08)", dashed: true },
    neutral: { border: "#8c959f", background: "rgba(140,149,159,0.08)", dashed: true },
    split: { border: "#bf8700", background: "rgba(191,135,0,0.08)", dashed: true },
});

export const EDGE_STYLES = frozen({
    observed: { color: "#0969da", dashed: false },
    inferred: { color: "#f59e0b", dashed: true },
    replication: { color: "#8250df", dashed: false },
    traffic: { color: "#1a7f37", dashed: false },
    failover: { color: "#cf222e", dashed: true },
    dependency: { color: "#57606a", dashed: false },
});

/** The group styles and edge kinds each diagram kind accepts. */
export const KINDS = frozen({
    "current-state": { groupStyles: ["primary", "inferred", "neutral"], edgeKinds: ["observed", "inferred"] },
    "proposed-dr": { groupStyles: ["primary", "dr", "global", "onprem", "neutral", "split"], edgeKinds: ["observed", "replication", "traffic", "failover", "dependency"] },
});

export const ARROWS = Object.freeze(["none", "forward", "backward", "both"]);
export const DIRECTIONS = Object.freeze(["LR", "TB"]);
export const MAX_NODE_LABEL = 60;
export const NON_DEFAULT_PACK_SUFFIX = " [NON-DEFAULT PATTERN PACK]";

/** The vendored slugify rule (extensions/architecture-canvas/lib/store.mjs); a test compares the two. */
export function slugKey(text) {
    return (String(text ?? "") || "untitled")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "untitled";
}
