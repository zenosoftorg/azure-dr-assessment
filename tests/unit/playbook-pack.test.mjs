import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { defaultPlaybooksDir, skillRoot } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { lintPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbook-lint.mjs";
import {
    MECHANISM_FIELDS, MIGRATION_PARTS, OPTION_FIELDS, PLAYBOOK_SECTIONS, STEP_COLUMNS, TEST_FIELDS, isIsoDate, isLearnUrl, parsePlaybook, readPlaybooks,
} from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { asFirstSetRow, firstSetRow } from "../helpers/playbook-set.mjs";

const TODAY = "2026-11-09";
const read = (rel) => readFileSync(path.join(skillRoot(), rel), "utf8");

test("the bundled playbooks lint with no error", async () => {
    const loaded = await readPlaybooks(defaultPlaybooksDir());
    assert.equal(loaded.set.isDefault, true);
    assert.ok(loaded.set.playbooks.length >= 1);
    const errors = lintPlaybooks(loaded, { today: TODAY }).filter((f) => f.severity === "error");
    assert.deepEqual(errors, []);
});

test("every bundled playbook matches its row of the first set (contracts section 7)", async () => {
    const { set } = await readPlaybooks(defaultPlaybooksDir());
    for (const playbook of set.playbooks) {
        const row = firstSetRow(playbook.service);
        assert.ok(row, `${playbook.file}: ${playbook.service} is not in the first set of contracts section 7`);
        assert.deepEqual(asFirstSetRow(playbook), row, playbook.file);
    }
});

test("key-vault is the complete reference playbook", async () => {
    const { set } = await readPlaybooks(defaultPlaybooksDir());
    const kv = set.byService.get("key-vault");
    assert.ok(kv, "playbooks/key-vault.md exists");
    assert.equal(set.byType.get("microsoft.keyvault/vaults"), kv);
    assert.equal(kv.title, "Azure Key Vault");
    assert.ok(isIsoDate(kv.verifiedOn));
    assert.deepEqual(kv.options.map((o) => [o.id, o.kind, o.target, o.usesMechanism]), [
        ["secondary-vault-sync", "workaround", "dr-region", "none"],
        ["paired-failover-split", "split-region", "pair-region", "Microsoft-managed replication and failover"],
    ]);
    assert.deepEqual(kv.mechanisms.map((m) => [m.name, m.paired, m.nonpaired, m.failover]), [
        ["Microsoft-managed replication and failover", true, false, "Microsoft-managed"],
    ]);
    assert.equal(kv.options[0].rpoSeconds, 900);
    assert.equal(kv.options[1].rpoSeconds, null);
    assert.ok(kv.learnSources.every(isLearnUrl));
    assert.ok(kv.constraints.length >= 5);
    assert.deepEqual(kv.tests.map((t) => t.id), ["TC-1", "TC-2", "TC-3", "TC-4", "TC-5", "TC-6"]);
    for (const row of [...kv.steps.failover, ...kv.steps.failback]) assert.match(row.duration, /^Estimated\b/);
});

test("the template carries the whole grammar: only its placeholder values are problems", () => {
    const template = read("assets/playbook-template.md");
    const { playbook, problems } = parsePlaybook(template, "playbook-template.md");
    assert.deepEqual(playbook.sections.map((s) => s.title), PLAYBOOK_SECTIONS);
    assert.deepEqual(problems.map((p) => p.rule), [
        "field-invalid", "field-invalid", "field-invalid",
        "mechanism-field", "mechanism-field", "mechanism-field", "mechanism-field", "mechanism-field",
        "option-id",
    ]);
    for (const key of [...MECHANISM_FIELDS, ...OPTION_FIELDS, ...TEST_FIELDS]) assert.ok(template.includes(`\n- ${key}: `), key);
    for (const part of MIGRATION_PARTS) assert.ok(template.includes(`\n### ${part}\n`), part);
    assert.ok(template.includes(`| ${STEP_COLUMNS.join(" | ")} |`));
});

test("the authoring guide states the precedence, the gate, the lint, the hook and the procedure", () => {
    const guide = read("playbooks/README.md");
    for (const needle of [
        "## Where a playbook sits", "## No approval gate", "## Format", "## Lint", "## Authoring a playbook", "### Acceptance checks", "## Drift",
        "assets/playbook-template.md", "npm run lint:playbooks", "--playbooks-dir", "DR_PLAYBOOKS_DIR", "nonDefaultPlaybooks: true",
        "one service at a time", "GC-14", "Second pass", "in the description of the pull request that adds or changes the playbook",
        "tests/helpers/playbook-set.mjs", "node --test tests/unit/playbook-pack.test.mjs", "`verified_on` is the date of the second pass",
    ]) {
        assert.ok(guide.includes(needle), needle);
    }
    const ranks = guide.split("## Where a playbook sits")[1].split("\n## ")[0].match(/^\d\. .+$/gm);
    const starts = ["Azure reality", "A valid override", "A company pattern", "The service playbook", "Learn-derived guidance"];
    assert.equal(ranks.length, starts.length);
    starts.forEach((start, i) => assert.ok(ranks[i].startsWith(`${i + 1}. ${start}`), ranks[i]));
});

test("the authoring guide states the estimate rule V3-D2 and its three by-design unknowns, and the bundled playbooks follow it", async () => {
    const flat = read("playbooks/README.md").replace(/\s+/g, " ");
    assert.ok(!flat.includes("Where Learn gives no figure, write `unknown"), "the pre-V3-D2 rule is gone");
    assert.match(flat, /a number that Learn publishes, cited next to the value, or else an explicit team-set starting value labelled `Estimated, team-set starting value` and tied to the test criterion that proves it/);
    assert.match(flat, /An RPO of `0` only for a stateless tier/);
    assert.match(flat, /`key-vault` `paired-failover-split`, `event-hubs` `metadata-geo-dr` and `service-bus` `metadata-geo-dr`/);
    const { set } = await readPlaybooks(defaultPlaybooksDir());
    const unknown = set.playbooks.flatMap((p) => p.options.filter((o) => /^unknown\b/.test(o.rpo) || /^unknown\b/.test(o.rto)).map((o) => `${p.service}/${o.id}`));
    assert.deepEqual(unknown, ["event-hubs/metadata-geo-dr", "key-vault/paired-failover-split", "service-bus/metadata-geo-dr"]);
});
