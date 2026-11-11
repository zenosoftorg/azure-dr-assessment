import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { serializeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import {
    DR_OPTIONS_SCRIPT, GADGETS, NATIVES, NICS, WIDGETS, fixtureAssessment, runDrOptions, standardInputs, writeClassifyRun,
} from "../helpers/dr-options-fixture.mjs";
import { playbookMarkdown, writePlaybookDir } from "../helpers/playbook-fixture.mjs";
import { writePack } from "../helpers/pack-fixture.mjs";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

test("--classify writes evidence/dr-options.json and returns the summary of contracts 4.2", async () => {
    const run = writeClassifyRun();
    const r = await runDrOptions("classify", run);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    const doc = readJson(run.optionsFile);
    assert.deepEqual(Object.keys(r.json), ["ok", "script", "out", "tier", "paired", "types", "native", "ask", "question", "staleClaims", "stalePlaybooks", "nonDefaultPlaybooks", "warnings"]);
    assert.deepEqual({ ...r.json, question: undefined }, {
        ok: true, script: "dr-options", out: run.optionsFile, tier: 1, paired: false, types: 4, native: 1,
        ask: [WIDGETS, NICS, GADGETS], question: undefined, staleClaims: 0, stalePlaybooks: [], nonDefaultPlaybooks: true, warnings: [],
    });
    assert.equal(r.json.question, doc.question);
    assert.match(doc.question, /^\*\*Test Service\*\* \(3 resources\)\. No native DR into germanywestcentral\.\n1\. Second copy in the DR region\./);
    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.assessment, "assessment.yaml");
    assert.equal(doc.playbooksDir, run.playbooksDir);
    assert.ok(!Number.isNaN(Date.parse(doc.generatedAt)) && doc.generatedAt.endsWith("Z"));
    assert.deepEqual(doc.types.map((row) => row.type), [WIDGETS, NICS, NATIVES, GADGETS]);
    assert.match(r.stderr, /^wrote .+dr-options\.json$/m);
});

test("--classify reads dr_choices: a valid entry is not asked again, an invalid one is asked with its problem", async () => {
    const run = writeClassifyRun({
        assessment: {
            dr_choices: [
                { type: WIDGETS, option: "pair-split", chosen_by: "Application owner", date: "2026-11-01", recommended: false },
                { type: GADGETS, option: "gadget-gone", chosen_by: "default", date: "2026-11-01", recommended: true },
            ],
        },
    });
    const r = await runDrOptions("classify", run);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(r.json.ask, [NICS, GADGETS]);
    const rows = readJson(run.optionsFile).types;
    assert.deepEqual(rows[0].choice, { option: "pair-split", chosen_by: "Application owner", date: "2026-11-01", recommended: false, status: "valid", problem: null });
    assert.equal(rows[3].choice.status, "invalid");
    assert.match(r.json.question, /^\*\*Gadgets\*\* \(1 resource\)\./);
    assert.match(r.json.question, /\n\nNo DR option found, recorded as open gaps: Network Interface\.\n\nReply e\.g\. GA 1, or accept recommendations\.$/);
});

test("--ask-type asks about a type that a pattern decides, and names the pattern", async () => {
    const run = writeClassifyRun({ patterns: [{ id: "DR-TEST-001", slots: ["compute"] }] });
    const decided = await runDrOptions("classify", run);
    assert.equal(decided.code, 0, decided.stdout + decided.stderr);
    assert.deepEqual(decided.json.ask, [NICS]);
    const asked = await runDrOptions("classify", run, ["--ask-type", "Microsoft.Test/Widgets"]);
    assert.deepEqual(asked.json.ask, [WIDGETS, NICS]);
    assert.match(asked.json.question, /No native DR into germanywestcentral\. Decided by DR-TEST-001 v1, which Azure reality vetoes\.\n/);
    assert.deepEqual(readJson(run.optionsFile).types[0].decidedBy, { source: "pattern", ref: "DR-TEST-001 v1" });
});

test("--classify reports stale claims and old playbooks, and with Learn unreachable nothing is native", async () => {
    const offline = writeClassifyRun({ inputs: standardInputs({ learnReachable: false }) });
    const r = await runDrOptions("classify", offline, ["--today", "2027-03-01"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.native, 0);
    assert.deepEqual(r.json.ask, [WIDGETS, NICS, NATIVES, GADGETS]);
    assert.deepEqual(r.json.stalePlaybooks, ["test-service", "test-native"]);
    assert.match(r.stderr, /^warning: playbook test-service v1 was verified on 2026-11-01, more than 90 days before 2027-03-01$/m);
    assert.match(r.json.question, /\*\*Recommended \(does not meet Tier 1 \(Unverified\)\)\.\*\*/);
});

test("--classify fails with exit 2 on missing evidence, a missing tier, a broken playbook or a pack without DR-TIER-001", async () => {
    const run = writeClassifyRun();
    rmSync(path.join(run.root, "evidence", "ledger.json"));
    const noLedger = await runDrOptions("classify", run);
    assert.equal(noLedger.code, 2);
    assert.equal(noLedger.json.error, "there is no evidence/ledger.json yet");
    rmSync(path.join(run.root, "evidence", "inventory.json"));
    const noInventory = await runDrOptions("classify", run);
    assert.equal(noInventory.code, 2);
    assert.match(noInventory.json.details.join("\n"), /run ingest first/);

    const noTier = writeClassifyRun();
    writeFileSync(noTier.file, serializeAssessment(fixtureAssessment({ objectives: { tier: null } })));
    const tierless = await runDrOptions("classify", noTier);
    assert.equal(tierless.code, 2);
    assert.equal(tierless.json.error, "the tier is not recorded yet");

    const broken = writeClassifyRun();
    const badBooks = writePlaybookDir({ "test-service.md": playbookMarkdown({ service: "test-service", slot: "nowhere" }) });
    const badPlaybook = await runDrOptions("classify", { ...broken, playbooksDir: badBooks });
    assert.equal(badPlaybook.code, 2);
    assert.match(badPlaybook.json.error, /^the playbook folder has 1 error; run lint-playbooks$/);
    assert.match(badPlaybook.json.details[0], /^test-service\.md: \[slot-unknown\]/);
    const noBands = await runDrOptions("classify", { ...broken, patternsDir: writePack({}) });
    assert.equal(noBands.code, 2);
    assert.equal(noBands.json.error, "the pattern pack has no DR-TIER-001, so the tier bands are unknown");
});

test("--classify refuses an output folder inside the plugin with exit 4, and the mode and --today are usage errors", async () => {
    const run = writeClassifyRun();
    const plugin = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-options-plugin-")));
    mkdirSync(path.join(plugin, ".claude-plugin"));
    writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "azure-dr-assessment" }));
    const inside = path.join(plugin, "out");
    mkdirSync(inside);
    writeFileSync(path.join(inside, "assessment.yaml"), readFileSync(run.file, "utf8"));
    const refused = await runDrOptions("classify", { ...run, file: path.join(inside, "assessment.yaml") });
    assert.equal(refused.code, 4);
    assert.equal(refused.json.error, "the output folder is inside the skill or plugin directory");

    const none = await runScript(DR_OPTIONS_SCRIPT, ["--assessment", run.file]);
    assert.equal(none.code, 1);
    assert.match(none.json.error, /^choose exactly one mode: --classify/);
    const badDay = await runDrOptions("classify", run, ["--today", "2026-02-30"]);
    assert.equal(badDay.code, 1);
    assert.equal(badDay.json.error, "--today must be a date as YYYY-MM-DD");
    assert.equal((await runScript(DR_OPTIONS_SCRIPT, ["--classify"])).code, 1);
});

test("--help lists the classify flags", async () => {
    const help = await runScript(DR_OPTIONS_SCRIPT, ["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^dr-options: /);
    for (const flag of ["--classify", "--assessment", "--playbooks-dir", "--patterns-dir", "--ask-type", "--today"]) assert.ok(help.stdout.includes(flag), flag);
});
