import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringifyYaml } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";

export const FIXTURE_SOURCE = "https://learn.microsoft.com/en-us/azure/reliability/reliability-test-service";

/** The six sections of a complete, valid playbook, in order. */
export const PLAYBOOK_BODIES = [
    ["Mechanisms", [
        "### Test geo-replication",
        "- Replicates: data",
        "- Paired: yes",
        "- Nonpaired: no",
        "- Failover: customer-managed",
        "- Estimated RPO: 5m (fixture value)",
        "- Estimated RTO: 1h (fixture value)",
        `- Source: ${FIXTURE_SOURCE}`,
    ].join("\n")],
    ["Constraints", [
        "### Restores stay in the geography",
        "A restore works only within the same geography.",
        `- Source: ${FIXTURE_SOURCE}`,
    ].join("\n")],
    ["Non-paired options", [
        "### second-copy: Second copy in the DR region",
        "- Kind: workaround",
        "- Target: dr-region",
        "- Uses mechanism: none",
        "- Estimated RPO: 15m (the copy interval the team sets)",
        "- Estimated RTO: 30m (the switch-over time the team designs)",
        "- Prerequisites: a second instance in the DR region.",
        "- Cost notes: a second instance; no price.",
        "- Gives up: platform-managed failover.",
        "- Recommended when: the DR region is not the pair.",
        `- Source: ${FIXTURE_SOURCE}`,
        "",
        "### pair-split: Recover into the pair",
        "- Kind: split-region",
        "- Target: pair-region",
        "- Uses mechanism: Test geo-replication",
        "- Estimated RPO: unknown (no figure on Learn)",
        "- Estimated RTO: 4h (fixture value)",
        "- Prerequisites: a network path from the DR region to the pair.",
        "- Cost notes: cross-region traffic; no price.",
        "- Gives up: a copy in the DR region.",
        "- Recommended when: residency allows the pair.",
        `- Source: ${FIXTURE_SOURCE}`,
    ].join("\n")],
    ["Migration from a paired setup", [
        "### Recognise today's setup",
        "The inventory shows a replica in the pair.",
        "",
        "### Build",
        "1. Create the second instance in the DR region.",
        "",
        "### Validate",
        "1. Run TC-1.",
        "",
        "### Cut over",
        "1. Point the DR configuration at the second instance.",
        "",
        "### Decommission",
        "1. Remove the replica in the pair.",
        "",
        "### Keep until cut-over",
        "The replica in the pair.",
    ].join("\n")],
    ["Failover and failback", [
        "### Failover",
        "| # | Step | Role | Estimated duration | Verification | Abort condition |",
        "|---|---|---|---|---|---|",
        "| 1 | Switch to the second instance | Platform engineer | Estimated 10m | The application reads from it | The second instance is not reachable |",
        "",
        "### Failback",
        "| # | Step | Role | Estimated duration | Verification | Abort condition |",
        "|---|---|---|---|---|---|",
        "| 1 | Switch back to the primary instance | Platform engineer | Estimated 10m | The application reads from it | The primary instance is not reachable |",
    ].join("\n")],
    ["Test criteria", [
        "### TC-1: The second copy is current",
        "- Applies to: second-copy",
        "- Pass condition: the copy lag stays below the Estimated RPO for 7 days.",
        "- How to measure: compare the copy job's timestamps.",
        "- Evidence: the job log.",
        "- Frequency: monthly",
        "",
        "### TC-2: The pair is reachable",
        "- Applies to: pair-split",
        "- Pass condition: a read from the DR region to the pair succeeds.",
        "- How to measure: a probe in the DR region.",
        "- Evidence: the probe log.",
        "- Frequency: every drill",
    ].join("\n")],
];

/**
 * Markdown for one playbook file. The defaults make a complete, valid playbook for the service test-service.
 * Front matter: `service`, `title`, `arm_types`, `slot`, `version`, `verified_on` and `learn_sources` replace the
 * defaults, `omit` removes keys, `extra` adds keys. Body: `sections` as an object replaces the text of the named
 * sections (null drops one) and keeps the order; as a list of [title, text] pairs it replaces the whole body.
 */
export function playbookMarkdown(spec = {}) {
    const front = {
        service: spec.service ?? "test-service",
        title: spec.title ?? "Test Service",
        arm_types: spec.arm_types ?? ["microsoft.test/widgets"],
        slot: spec.slot ?? "compute",
        version: spec.version ?? 1,
        verified_on: spec.verified_on ?? "2026-11-01",
        learn_sources: spec.learn_sources ?? [FIXTURE_SOURCE],
        ...(spec.extra ?? {}),
    };
    for (const key of spec.omit ?? []) delete front[key];
    let pairs = PLAYBOOK_BODIES;
    if (Array.isArray(spec.sections)) {
        pairs = spec.sections;
    } else if (spec.sections) {
        pairs = PLAYBOOK_BODIES
            .map(([title, text]) => [title, Object.hasOwn(spec.sections, title) ? spec.sections[title] : text])
            .filter(([, text]) => text !== null);
    }
    const body = pairs.map(([title, text]) => `## ${title}\n\n${text}\n`).join("\n");
    return `---\n${stringifyYaml(front)}---\n\n# ${front.title ?? "Test Service"}\n\n${body}`;
}

/** Write files into a fresh temporary folder and return its path. */
export function writePlaybookDir(files) {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-playbooks-"));
    for (const [name, text] of Object.entries(files)) {
        const target = path.join(dir, name);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, text);
    }
    return dir;
}

/** A folder with one playbook per spec, named <service>.md unless the spec sets `file`. */
export function writePlaybooks(specs) {
    return writePlaybookDir(Object.fromEntries(specs.map((spec) => [spec.file ?? `${spec.service ?? "test-service"}.md`, playbookMarkdown(spec)])));
}
