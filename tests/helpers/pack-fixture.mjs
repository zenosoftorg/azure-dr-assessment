import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringifyYaml } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";

/** The five fixed sections with one line of content each. */
export const FIXED_BODIES = [
    ["Required behavior", "- The workload must satisfy the rule."],
    ["Rationale", "The company requires it."],
    ["Diagram elements", "- Show the component."],
    ["Runbook steps", "1. Perform the step."],
    ["Verification", "- Check the result."],
];

/**
 * Markdown for one pattern file. The defaults make a valid, approved, overridable pattern.
 * `omit` removes front matter keys, `extra` adds keys, `sections` replaces the body
 * sections (an object, or a list of [title, text] pairs).
 */
export function patternMarkdown(spec = {}) {
    const front = {
        id: spec.id ?? "DR-TEST-001",
        version: spec.version ?? 1,
        status: spec.status ?? "approved",
        slots: spec.slots ?? ["compute"],
        override: spec.override ?? "overridable",
        ...(spec.applies_to === undefined ? {} : { applies_to: spec.applies_to }),
        supersedes: spec.supersedes ?? [],
        owner_role: spec.owner_role ?? "Platform architecture",
        ...(spec.inputs === undefined ? {} : { inputs: spec.inputs }),
        ...(spec.parameters === undefined ? {} : { parameters: spec.parameters }),
        ...(spec.extra ?? {}),
    };
    for (const key of spec.omit ?? []) delete front[key];
    const pairs = spec.sections === undefined
        ? FIXED_BODIES
        : Array.isArray(spec.sections) ? spec.sections : Object.entries(spec.sections);
    const body = pairs.map(([title, text]) => `## ${title}\n\n${text}\n`).join("\n");
    return `---\n${stringifyYaml(front)}---\n\n# ${spec.id ?? "DR-TEST-001"}\n\n${body}`;
}

/** Write files into a fresh temporary folder and return its path. */
export function writePack(files) {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-pack-"));
    for (const [name, text] of Object.entries(files)) {
        const target = path.join(dir, name);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, text);
    }
    return dir;
}

/** A pack with one file per spec, named <id>.md unless the spec sets `file`. */
export function writePatterns(specs) {
    return writePack(Object.fromEntries(specs.map((spec) => [spec.file ?? `${spec.id}.md`, patternMarkdown(spec)])));
}
