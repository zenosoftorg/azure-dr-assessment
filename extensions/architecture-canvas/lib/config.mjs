// Runtime path resolution.
//
// Everything is resolved at runtime rather than baked in, so moving this
// extension from project scope (.github/extensions/) to user scope
// ($COPILOT_HOME/extensions/) is a directory move with no code change.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_ROOT = path.resolve(HERE, "..");
export const WEB_ROOT = path.join(EXTENSION_ROOT, "web");

const ICON_DIR_NAME = "Final SVG Icons";

function copilotHome() {
    return process.env.COPILOT_HOME || path.join(homedir(), ".copilot");
}

/**
 * Walk up from `start` looking for a directory containing `targetName`.
 * Lets the extension find the icon library whether it sits in the repo or the
 * user config dir.
 */
function findUpward(start, targetName, maxDepth = 8) {
    let dir = start;
    for (let i = 0; i < maxDepth; i++) {
        const candidate = path.join(dir, targetName);
        if (existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/**
 * Resolve the SVG icon library root, in priority order:
 *   1. ARCH_CANVAS_ICON_ROOT env override
 *   2. "Final SVG Icons" next to / above the extension (project scope)
 *   3. "Final SVG Icons" next to / above the workspace (user scope, repo open)
 *   4. $COPILOT_HOME/extensions/architecture-canvas/Final SVG Icons
 */
export function resolveIconRoot(workspacePath) {
    const override = process.env.ARCH_CANVAS_ICON_ROOT;
    if (override && existsSync(override)) return override;

    const fromExtension = findUpward(EXTENSION_ROOT, ICON_DIR_NAME);
    if (fromExtension) return fromExtension;

    if (workspacePath) {
        const fromWorkspace = findUpward(workspacePath, ICON_DIR_NAME);
        if (fromWorkspace) return fromWorkspace;
    }

    const userCopy = path.join(copilotHome(), "extensions", "architecture-canvas", ICON_DIR_NAME);
    if (existsSync(userCopy)) return userCopy;

    return null;
}

/**
 * Where diagrams live. Repo-relative when a workspace is available (architecture
 * diagrams are a committed artifact), otherwise the user-global artifacts dir.
 */
export function resolveDiagramDir(workspacePath) {
    const override = process.env.ARCH_CANVAS_DIAGRAM_DIR;
    if (override) return override;
    if (workspacePath) return path.join(workspacePath, "architectures");
    return path.join(copilotHome(), "extensions", "architecture-canvas", "artifacts");
}
