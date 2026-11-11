import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { CliError } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { defaultPlaybooksDir, playbooksDir, skillRoot } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import {
    FAILOVER_MODES, LEARN_PREFIX, MECHANISM_FIELDS, MIGRATION_PARTS, OPTION_FIELDS, OPTION_KINDS, OPTION_TARGETS, PLAYBOOK_SECTIONS,
    RESERVED_OPTION_ID, STEP_COLUMNS, STEP_PARTS, TEST_FIELDS,
    estimateSeconds, isEstimate, isIsoDate, isLearnUrl, parsePlaybook, readPlaybooks,
} from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { FIXTURE_SOURCE, playbookMarkdown, writePlaybookDir, writePlaybooks } from "../helpers/playbook-fixture.mjs";

const rules = (problems) => problems.map((p) => p.rule);
const PLAYBOOK_MECHANISM = ["### Test geo-replication", "- Replicates: data", "- Paired: yes", "- Nonpaired: no", "- Failover: customer-managed",
    "- Estimated RPO: 5m", "- Estimated RTO: 1h", `- Source: ${FIXTURE_SOURCE}`].join("\n");

test("the constants are those of the v3 contracts 5.1", () => {
    assert.deepEqual(PLAYBOOK_SECTIONS, ["Mechanisms", "Constraints", "Non-paired options", "Migration from a paired setup", "Failover and failback", "Test criteria"]);
    assert.deepEqual(MECHANISM_FIELDS, ["Replicates", "Paired", "Nonpaired", "Failover", "Estimated RPO", "Estimated RTO", "Source"]);
    assert.deepEqual(OPTION_FIELDS, ["Kind", "Target", "Uses mechanism", "Estimated RPO", "Estimated RTO", "Prerequisites", "Cost notes", "Gives up", "Recommended when", "Source"]);
    assert.deepEqual(OPTION_KINDS, ["native", "workaround", "split-region", "backup-restore"]);
    assert.deepEqual(OPTION_TARGETS, ["dr-region", "pair-region"]);
    assert.deepEqual(FAILOVER_MODES, ["Microsoft-managed", "customer-managed", "manual", "not applicable"]);
    assert.deepEqual(MIGRATION_PARTS, ["Recognise today's setup", "Build", "Validate", "Cut over", "Decommission", "Keep until cut-over"]);
    assert.deepEqual(STEP_PARTS, ["Failover", "Failback"]);
    assert.deepEqual(STEP_COLUMNS, ["#", "Step", "Role", "Estimated duration", "Verification", "Abort condition"]);
    assert.deepEqual(TEST_FIELDS, ["Applies to", "Pass condition", "How to measure", "Evidence", "Frequency"]);
    assert.equal(RESERVED_OPTION_ID, "accept-gap");
    assert.equal(LEARN_PREFIX, "https://learn.microsoft.com/");
});

test("estimateSeconds reads the leading duration and isEstimate also accepts unknown", () => {
    assert.equal(estimateSeconds("15m (the sync interval the team sets)"), 900);
    assert.equal(estimateSeconds("4h"), 14400);
    assert.equal(estimateSeconds("1.5h based on the drill"), 5400);
    assert.equal(estimateSeconds("30 s"), 30);
    assert.equal(estimateSeconds("2d"), 172800);
    assert.equal(estimateSeconds("0"), 0);
    assert.equal(estimateSeconds("0 (synchronous)"), 0);
    assert.equal(estimateSeconds("unknown (Learn gives no figure)"), null);
    assert.equal(estimateSeconds("several hours"), null);
    assert.equal(estimateSeconds("4hours"), null);
    assert.equal(estimateSeconds(""), null);
    assert.equal(estimateSeconds(null), null);
    assert.equal(isEstimate("unknown (Learn gives no figure)"), true);
    assert.equal(isEstimate("Unknown"), true);
    assert.equal(isEstimate("15m"), true);
    assert.equal(isEstimate("unknowable"), false);
    assert.equal(isEstimate("about 15m"), false);
});

test("isIsoDate and isLearnUrl", () => {
    assert.equal(isIsoDate("2026-11-09"), true);
    assert.equal(isIsoDate("2026-02-30"), false);
    assert.equal(isIsoDate("2026-2-3"), false);
    assert.equal(isIsoDate(20261109), false);
    assert.equal(isLearnUrl("https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault"), true);
    assert.equal(isLearnUrl("http://learn.microsoft.com/en-us/azure"), false);
    assert.equal(isLearnUrl("https://example.com/https://learn.microsoft.com/"), false);
    assert.equal(isLearnUrl(`${LEARN_PREFIX}a b`), false);
});

test("parsePlaybook returns the parsed shape of the contracts 5.4 and no problem for a complete playbook", () => {
    const { playbook, problems } = parsePlaybook(playbookMarkdown(), "test-service.md");
    assert.deepEqual(problems, []);
    const { sections, ...rest } = playbook;
    assert.deepEqual(sections.map((s) => [s.title, s.line]), [
        ["Mechanisms", 15], ["Constraints", 26], ["Non-paired options", 32], ["Migration from a paired setup", 58], ["Failover and failback", 78], ["Test criteria", 90],
    ]);
    assert.match(sections[0].text, /^### Test geo-replication\n- Replicates: data/);
    assert.deepEqual(rest, {
        file: "test-service.md",
        service: "test-service",
        title: "Test Service",
        armTypes: ["microsoft.test/widgets"],
        slot: "compute",
        version: 1,
        verifiedOn: "2026-11-01",
        learnSources: [FIXTURE_SOURCE],
        mechanisms: [{
            name: "Test geo-replication", replicates: "data", paired: true, nonpaired: false, failover: "customer-managed",
            rpo: "5m (fixture value)", rto: "1h (fixture value)", source: FIXTURE_SOURCE,
        }],
        constraints: [{ heading: "Restores stay in the geography", text: "A restore works only within the same geography.", source: FIXTURE_SOURCE }],
        options: [
            {
                id: "second-copy", title: "Second copy in the DR region", rank: 1, kind: "workaround", target: "dr-region", usesMechanism: "none",
                rpo: "15m (the copy interval the team sets)", rto: "30m (the switch-over time the team designs)", rpoSeconds: 900, rtoSeconds: 1800,
                prerequisites: "a second instance in the DR region.", costNotes: "a second instance; no price.", givesUp: "platform-managed failover.",
                recommendedWhen: "the DR region is not the pair.", source: FIXTURE_SOURCE, decidesSlots: [],
            },
            {
                id: "pair-split", title: "Recover into the pair", rank: 2, kind: "split-region", target: "pair-region", usesMechanism: "Test geo-replication",
                rpo: "unknown (no figure on Learn)", rto: "4h (fixture value)", rpoSeconds: null, rtoSeconds: 14400,
                prerequisites: "a network path from the DR region to the pair.", costNotes: "cross-region traffic; no price.", givesUp: "a copy in the DR region.",
                recommendedWhen: "residency allows the pair.", source: FIXTURE_SOURCE, decidesSlots: [],
            },
        ],
        migration: {
            recognise: "The inventory shows a replica in the pair.",
            build: ["Create the second instance in the DR region."],
            validate: ["Run TC-1."],
            cutOver: ["Point the DR configuration at the second instance."],
            decommission: ["Remove the replica in the pair."],
            keep: "The replica in the pair.",
        },
        steps: {
            failover: [{ n: "1", step: "Switch to the second instance", role: "Platform engineer", duration: "Estimated 10m", verification: "The application reads from it", abort: "The second instance is not reachable" }],
            failback: [{ n: "1", step: "Switch back to the primary instance", role: "Platform engineer", duration: "Estimated 10m", verification: "The application reads from it", abort: "The primary instance is not reachable" }],
        },
        tests: [
            {
                id: "TC-1", title: "The second copy is current", appliesTo: ["second-copy"], passCondition: "the copy lag stays below the Estimated RPO for 7 days.",
                howToMeasure: "compare the copy job's timestamps.", evidence: "the job log.", frequency: "monthly",
            },
            {
                id: "TC-2", title: "The pair is reachable", appliesTo: ["pair-split"], passCondition: "a read from the DR region to the pair succeeds.",
                howToMeasure: "a probe in the DR region.", evidence: "the probe log.", frequency: "every drill",
            },
        ],
    });
});

test("a file without a front matter mapping gives a null playbook", () => {
    assert.deepEqual(parsePlaybook("# notes\n", "notes.md"), { playbook: null, problems: [{ rule: "front-matter-missing", message: "the file has no front matter (a leading --- block)" }] });
    assert.deepEqual(rules(parsePlaybook("---\ntag: { name: app }\n---\n", "a.md").problems), ["front-matter-invalid"]);
    assert.deepEqual(parsePlaybook("---\n- a\n- b\n---\n", "a.md"), { playbook: null, problems: [{ rule: "front-matter-invalid", message: "front matter must be a mapping of fields" }] });
    assert.deepEqual(rules(parsePlaybook("---\nservice: a\n", "a.md").problems), ["front-matter-invalid"]);
});

test("wrong-typed front matter normalizes instead of throwing", () => {
    const { playbook, problems } = parsePlaybook(playbookMarkdown({ service: 7, arm_types: "microsoft.test/widgets", version: "two", learn_sources: FIXTURE_SOURCE }), "x.md");
    assert.equal(playbook.service, "");
    assert.deepEqual(playbook.armTypes, []);
    assert.equal(playbook.version, 0);
    assert.deepEqual(playbook.learnSources, []);
    assert.deepEqual(rules(problems), ["field-invalid", "field-invalid", "field-invalid", "field-invalid"]);
});

test("a missing section leaves its part of the shape empty and is a problem", () => {
    const { playbook, problems } = parsePlaybook(playbookMarkdown({ sections: { Mechanisms: null, "Failover and failback": null } }), "test-service.md");
    assert.deepEqual(playbook.mechanisms, []);
    assert.deepEqual(playbook.steps, { failover: [], failback: [] });
    assert.deepEqual(problems, [
        { rule: "section-missing", message: 'missing section "## Mechanisms"' },
        { rule: "section-missing", message: 'missing section "## Failover and failback"' },
    ]);
});

test("headings inside code fences do not open sections or entries", () => {
    const fenced = [PLAYBOOK_MECHANISM, "", "```text", "## Not a section", "### Not a mechanism", "```"].join("\n");
    const { playbook, problems } = parsePlaybook(playbookMarkdown({ sections: { Mechanisms: fenced } }), "test-service.md");
    assert.deepEqual(problems, []);
    assert.deepEqual(playbook.mechanisms.map((m) => m.name), ["Test geo-replication"]);
});

test("Paired and Nonpaired are null when they are not yes or no", () => {
    const text = PLAYBOOK_MECHANISM.replace("- Paired: yes", "- Paired: maybe").replace("- Nonpaired: no\n", "");
    const { playbook, problems } = parsePlaybook(playbookMarkdown({ sections: { Mechanisms: text } }), "test-service.md");
    assert.equal(playbook.mechanisms[0].paired, null);
    assert.equal(playbook.mechanisms[0].nonpaired, null);
    assert.deepEqual(problems.map((p) => p.message), [
        'mechanism "Test geo-replication" has no "Nonpaired" field',
        'mechanism "Test geo-replication": Paired must be yes or no',
    ]);
});

test("readPlaybooks reads every playbook but README.md, sorted by name, and indexes them by service and ARM type", async () => {
    const dir = writePlaybooks([
        { service: "zeta", arm_types: ["microsoft.test/zetas", "microsoft.test/shared"] },
        { service: "alpha", arm_types: ["microsoft.test/alphas"] },
        { service: "beta", arm_types: ["microsoft.test/shared"] },
    ]);
    const { set, findings } = await readPlaybooks(dir);
    assert.deepEqual(findings, []);
    assert.equal(set.dir, dir);
    assert.equal(set.isDefault, false);
    assert.deepEqual(set.playbooks.map((p) => p.file), ["alpha.md", "beta.md", "zeta.md"]);
    assert.deepEqual([...set.byService.keys()], ["alpha", "beta", "zeta"]);
    assert.equal(set.byType.get("microsoft.test/shared").service, "beta");
    assert.equal(set.byType.get("microsoft.test/zetas").service, "zeta");
    assert.equal((await readPlaybooks(dir, { isDefault: true })).set.isDefault, true);
});

test("readPlaybooks leaves out unreadable files and files without front matter, and carries every problem as a finding", async () => {
    const dir = writePlaybookDir({
        "README.md": "# The authoring guide is not a playbook\n",
        "notes.md": "# notes\n",
        "broken.md": playbookMarkdown({ service: "broken", sections: { Constraints: null } }),
        "fine.md": playbookMarkdown({ service: "fine" }),
    });
    mkdirSync(path.join(dir, "folder.md"));
    const { set, findings } = await readPlaybooks(dir);
    assert.deepEqual(set.playbooks.map((p) => p.file), ["broken.md", "fine.md"]);
    assert.deepEqual(findings.map((f) => [f.severity, f.rule, f.file, f.service]), [
        ["error", "section-missing", "broken.md", "broken"],
        ["error", "unreadable-file", "folder.md", null],
        ["error", "front-matter-missing", "notes.md", null],
    ]);
});

test("readPlaybooks fails with exit 2 when the folder cannot be read", async () => {
    const missing = path.join(writePlaybookDir({}), "missing");
    await assert.rejects(readPlaybooks(missing), (err) => err instanceof CliError && err.code === 2 && err.message === `cannot read the playbook folder ${missing}`);
});

test("playbooksDir: the flag, then DR_PLAYBOOKS_DIR, then the bundled folder", () => {
    assert.equal(defaultPlaybooksDir(), path.join(skillRoot(), "playbooks"));
    assert.deepEqual(playbooksDir({}, null), { dir: defaultPlaybooksDir(), isDefault: true });
    assert.deepEqual(playbooksDir({ DR_PLAYBOOKS_DIR: "/x/env" }, null), { dir: path.resolve("/x/env"), isDefault: false });
    assert.deepEqual(playbooksDir({ DR_PLAYBOOKS_DIR: "/x/env" }, "/x/flag"), { dir: path.resolve("/x/flag"), isDefault: false });
    assert.deepEqual(playbooksDir({}, defaultPlaybooksDir()), { dir: defaultPlaybooksDir(), isDefault: true });
});
