import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..", "..");
export const TEMPLATE = path.join(repo, "skills", "azure-dr-assessment", "assets", "templates", "story.current-state.mjs");
export const GOLDEN_DIAGRAM = path.join(repo, "tests", "fixtures", "golden", "checkout-current-state.arch.json");

/** The story data for the golden diagram of the diagram-builder tests. */
export function goldenStoryData(overrides = {}) {
    return {
        schemaVersion: 1,
        cover: { kicker: "Architecture Story · as-is", title: "checkout · current state", blurb: "What the inventory shows, what was inferred and what is unknown." },
        regionMismatch: null,
        unknowns: { title: "What we do not know", md: "- Zone redundancy of orders-queue is not in the export." },
        groups: [
            { group: "Primary · westeurope", title: "The primary region", md: "Everything the export lists runs here.", nodes: ["web-prod"], edges: [["web-prod", "orders-db"]] },
            { group: "Data services", md: "The data stores." },
        ],
        ...overrides,
    };
}

/**
 * A fresh output root holding architectures/<id>.arch.json, presentations/<id>.story.mjs (a copy of the template)
 * and presentations/<id>.story-data.json. `data: null` leaves the data file out.
 */
export function storyWorkspace({ id = "checkout-current-state", data = goldenStoryData(), diagram = GOLDEN_DIAGRAM } = {}) {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-story-")));
    const paths = {
        cwd,
        id,
        diagram: path.join(cwd, "architectures", `${id}.arch.json`),
        story: path.join(cwd, "presentations", `${id}.story.mjs`),
        data: path.join(cwd, "presentations", `${id}.story-data.json`),
        html: path.join(cwd, "presentations", `${id}.html`),
    };
    mkdirSync(path.dirname(paths.diagram));
    mkdirSync(path.dirname(paths.story));
    copyFileSync(diagram, paths.diagram);
    copyFileSync(TEMPLATE, paths.story);
    if (data !== null) writeFileSync(paths.data, `${JSON.stringify(data, null, 2)}\n`);
    return paths;
}
