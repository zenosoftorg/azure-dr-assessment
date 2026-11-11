import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runScript } from "../helpers/run-cli.mjs";
import { GADGETS, NATIVES, NICS, WIDGETS, WIDGET_PLAYBOOK } from "../helpers/dr-options-fixture.mjs";
import { writePlaybooks } from "../helpers/playbook-fixture.mjs";
import { GUIDE_SCRIPT, fillGuide, guideRun, runGuide } from "../helpers/guide-fixture.mjs";

const repo = path.resolve(import.meta.dirname, "..", "..");
const skill = path.join(repo, "skills", "azure-dr-assessment");
const read = (file) => readFileSync(file, "utf8");
/** The guide as the model leaves it: every fill marker replaced by text and a criterion in each empty Validate table. */
const fill = (file) => writeFileSync(file, fillGuide(read(file)));
const KEY_LIKE = ["Account", "Key="].join("") + "a".repeat(30);
/** A value that looks like a secret only at the start of a string or after a semicolon. */
const PASSWORD_LIKE = ["Pass", "word=", "b".repeat(12)].join("");

test("--help lists the four modes and the flags, and a call needs exactly one mode", async () => {
    const help = await runScript(GUIDE_SCRIPT, ["--help"]);
    assert.equal(help.code, 0);
    for (const flag of ["--root", "--write", "--tables", "--check", "--inject-runbook", "--playbooks-dir"]) assert.ok(help.stdout.includes(flag), flag);
    const run = await guideRun();
    for (const args of [[], ["--write", "--check"], ["--tables", "--inject-runbook", run.runbook]]) {
        const r = await runGuide(run, args);
        assert.equal(r.code, 1, args.join(" "));
        assert.equal(r.json.error, "choose exactly one mode: --write, --tables, --check, --inject-runbook");
    }
    const flag = await runScript(GUIDE_SCRIPT, ["--root", run.root, "--check", "--playbooks-dir", run.playbooksDir]);
    assert.deepEqual([flag.code, flag.json.details], [1, ["--playbooks-dir belongs to --write or --inject-runbook"]]);
    assert.equal((await runScript(GUIDE_SCRIPT, ["--write"])).code, 1, "--root is required");
});

test("--write writes the guide from the template with one chapter per type in build order and the prefilled test plan", async () => {
    const run = await guideRun();
    const r = await runGuide(run, ["--write"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(Object.keys(r.json), ["ok", "script", "guide", "chapters", "nonDefaultPlaybooks", "warnings"]);
    assert.equal(r.json.guide, run.guide);
    assert.deepEqual(r.json.chapters, [
        { n: 1, type: NATIVES, title: "Test Native", slot: "data-replication.relational", playbook: "test-native v1", anchor: "test-native" },
        { n: 2, type: WIDGETS, title: "Test Service", slot: "compute", playbook: "test-service v1", anchor: "test-service" },
        { n: 3, type: GADGETS, title: "Gadgets", slot: "compute", playbook: null, anchor: "microsoft-example-gadgets" },
        { n: 4, type: NICS, title: "Network Interface", slot: null, playbook: null, anchor: "microsoft-network-networkinterfaces" },
    ]);
    assert.equal(r.json.nonDefaultPlaybooks, true);
    assert.equal(r.json.warnings.length, 1);
    assert.match(r.json.warnings[0], /^the playbooks come from .+, not the bundled folder: name it in report section C and in the summary$/);
    const guide = read(run.guide);
    assert.ok(guide.startsWith("# DR establishment guide\n\n> **DRAFT: not an operational procedure until rehearsed and approved by the owner.**\n"));
    assert.deepEqual([...guide.matchAll(/^## (.+)$/gm)].map((m) => m[1]), [
        "Target picture", "Build order", "Transition plan",
        `Chapter 1: Test Native (${NATIVES})`, `Chapter 2: Test Service (${WIDGETS})`, `Chapter 3: Gadgets (${GADGETS})`, `Chapter 4: Network Interface (${NICS})`,
        "Consolidated test plan", "DR readiness checklist",
    ]);
    assert.match(guide, /^- Chosen by: Application owner on 2026-11-09 \(the recommendation was second-copy\)\.$/m);
    assert.match(guide, /<!-- dr-guide:test-plan -->\n\| Service \| Criterion \| Pass condition \| Frequency \| Owner role \|\n\|---\|---\|---\|---\|---\|\n\| Test Native \| TC-1: The replica is current \|.*\n\| Test Service \| TC-2: The pair is reachable \|.*\n\| Network Interface \| Gap recorded \|.*\n<!-- \/dr-guide:test-plan -->/);

    const again = await runGuide(run, ["--write"]);
    assert.equal(again.json.warnings[0], "reports/dr-establishment-guide.md existed and was overwritten: write its text again");
});

test("--check lists every problem of the skeleton, and passes once the text is filled and the test plan rebuilt", async () => {
    const run = await guideRun();
    assert.equal((await runGuide(run, ["--write"])).code, 0);
    const before = await runGuide(run, ["--check"]);
    assert.equal(before.code, 2);
    assert.match(before.json.error, /^the guide has \d+ problems$/);
    assert.ok(before.json.details.every((line) => /^line \d+: a fill marker is left$/.test(line) || line === "chapter 3: Validate has no criterion"), before.json.details.join("\n"));
    assert.ok(before.json.details.includes("chapter 3: Validate has no criterion"), "the gadgets chapter has no criterion yet");

    fill(run.guide);
    writeFileSync(run.guide, read(run.guide).replace("| every drill | Platform engineer |", "| every drill | Network engineer |"));
    const stale = await runGuide(run, ["--check"]);
    assert.deepEqual(stale.json.details, ["the consolidated test plan differs from the Validate rows: run establishment-guide --tables"]);
    const tables = await runGuide(run, ["--tables"]);
    assert.deepEqual(tables.json, { ok: true, script: "establishment-guide", guide: run.guide, criteria: 4 });
    assert.match(read(run.guide), /^\| Test Service \| TC-2: The pair is reachable \| a read from the DR region to the pair succeeds\. \| every drill \| Network engineer \|$/m);
    const after = await runGuide(run, ["--check"]);
    assert.deepEqual(after.json, { ok: true, script: "establishment-guide", valid: true, chapters: 4, criteria: 4 });
});

test("--inject-runbook writes one subsection per service between the runbook markers, with the cross-region row of the split", async () => {
    const run = await guideRun();
    const r = await runGuide(run, ["--inject-runbook", run.runbook]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(r.json, { ok: true, script: "establishment-guide", runbook: run.runbook, services: 4 });
    const runbook = read(run.runbook);
    const section = runbook.split("<!-- dr-guide:runbook -->")[1].split("<!-- /dr-guide:runbook -->")[0];
    assert.deepEqual([...section.matchAll(/^### (.+)$/gm)].map((m) => m[1]), ["1. Test Native", "2. Test Service", "3. Gadgets", "4. Network Interface"]);
    assert.match(section, /^\| Failover 2 \| Point the consumers in germanywestcentral at the Test Service in swedensouth \| <!-- fill: owner role --> \| Estimated: measured in the first drill \| the consumers read from swedensouth \| A consumer cannot read from swedensouth \|$/m);
    assert.ok(runbook.startsWith(read(path.join(skill, "assets", "templates", "runbook.md")).split("<!-- dr-guide:runbook -->")[0]), "the text before the markers is kept");
    const twice = await runGuide(run, ["--inject-runbook", run.runbook]);
    assert.equal(twice.code, 0);
    assert.equal(read(run.runbook), runbook, "injecting again gives the same runbook");

    writeFileSync(run.runbook, "# Recovery runbook\n");
    const missing = await runGuide(run, ["--inject-runbook", run.runbook]);
    assert.deepEqual([missing.code, missing.json.error, missing.json.details], [2, "the runbook is missing its markers, so nothing was written", ["<!-- dr-guide:runbook --> ... <!-- /dr-guide:runbook -->"]]);
    assert.equal(read(run.runbook), "# Recovery runbook\n");
});

test("a run without dr-options.json, a guide that was never written and a playbook folder that does not match are refused with exit 2", async () => {
    const run = await guideRun();
    const check = await runGuide(run, ["--check"]);
    assert.deepEqual([check.code, check.json.error], [2, "there is no reports/dr-establishment-guide.md yet"]);
    const other = writePlaybooks([{ ...WIDGET_PLAYBOOK, version: 2 }]);
    const mismatch = await runScript(GUIDE_SCRIPT, ["--root", run.root, "--write", "--playbooks-dir", other]);
    assert.deepEqual([mismatch.code, mismatch.json.error], [2, "dr-options.json was classified with other playbooks than this folder holds"]);
    const broken = writePlaybooks([{ ...WIDGET_PLAYBOOK, omit: ["slot"] }]);
    const lint = await runScript(GUIDE_SCRIPT, ["--root", run.root, "--inject-runbook", run.runbook, "--playbooks-dir", broken]);
    assert.equal(lint.code, 2);
    assert.match(lint.json.error, /^the playbook folder has \d+ errors?; run lint-playbooks$/);
    assert.equal(existsSync(run.guide), false);

    const empty = path.join(run.root, "evidence", "dr-options.json");
    writeFileSync(empty, "");
    const unreadable = await runGuide(run, ["--write"]);
    assert.equal(unreadable.code, 2);
    const none = await runScript(GUIDE_SCRIPT, ["--root", path.join(run.root, "reports"), "--tables"]);
    assert.deepEqual([none.code, none.json.error], [2, "there is no evidence/dr-options.json yet"]);
});

test("a guide or runbook inside the skill or plugin directory is refused with exit 4 before anything is read", async () => {
    const run = await guideRun();
    const inside = await runScript(GUIDE_SCRIPT, ["--root", path.join(skill, "assets"), "--write"]);
    assert.deepEqual([inside.code, inside.json.error], [4, "the guide is inside the skill or plugin directory"]);
    const runbook = await runGuide(run, ["--inject-runbook", path.join(skill, "assets", "templates", "runbook.md")]);
    assert.deepEqual([runbook.code, runbook.json.error], [4, "the runbook is inside the skill or plugin directory"]);
});

test("GC-07: a string the script would write that looks like a secret is refused with exit 2 and its line, and nothing is written", async () => {
    const run = await guideRun();
    const options = JSON.parse(read(run.optionsFile));
    options.types.find((row) => row.type === WIDGETS).options.find((o) => o.id === "pair-split").givesUp = `nothing, the key is ${KEY_LIKE}`;
    writeFileSync(run.optionsFile, JSON.stringify(options));
    const r = await runGuide(run, ["--write"]);
    assert.equal(r.code, 2);
    assert.equal(r.json.error, "a string that this script would write looks like a secret, so nothing was written");
    assert.equal(r.json.details.length, 1);
    assert.match(r.json.details[0], /^reports\/dr-establishment-guide\.md line \d+: looks like a secret \(key, token, password or connection string\) and must not appear in a guide or runbook$/);
    assert.equal(existsSync(run.guide), false);
    assert.equal(r.stdout.includes(KEY_LIKE) || r.stderr.includes(KEY_LIKE), false);

    const clean = await guideRun();
    assert.equal((await runGuide(clean, ["--write"])).code, 0);
    fill(clean.guide);
    writeFileSync(clean.guide, read(clean.guide).replaceAll("a read from the DR region to the pair succeeds.", KEY_LIKE));
    const before = read(clean.guide);
    const tables = await runGuide(clean, ["--tables"]);
    assert.equal(tables.code, 2);
    assert.equal(read(clean.guide), before, "the guide is unchanged");
    assert.equal(tables.stdout.includes(KEY_LIKE) || tables.stderr.includes(KEY_LIKE), false);
});

test("GC-07: a secret-like value inside a table cell or after a colon is refused too, with its line only", async () => {
    const run = await guideRun();
    const options = JSON.parse(read(run.optionsFile));
    options.types.find((row) => row.type === WIDGETS).options.find((o) => o.id === "pair-split").givesUp = `nothing: ${PASSWORD_LIKE}`;
    writeFileSync(run.optionsFile, JSON.stringify(options));
    const segment = await runGuide(run, ["--write"]);
    assert.equal(segment.code, 2);
    assert.equal(segment.json.error, "a string that this script would write looks like a secret, so nothing was written");
    assert.match(segment.json.details[0], /^reports\/dr-establishment-guide\.md line \d+: looks like a secret/);
    assert.equal(existsSync(run.guide), false);
    assert.equal(segment.stdout.includes(PASSWORD_LIKE) || segment.stderr.includes(PASSWORD_LIKE), false);

    const clean = await guideRun();
    assert.equal((await runGuide(clean, ["--write"])).code, 0);
    fill(clean.guide);
    writeFileSync(clean.guide, read(clean.guide).replace("| a read from the DR region to the pair succeeds. |", `| ${PASSWORD_LIKE} |`));
    const before = read(clean.guide);
    const cell = await runGuide(clean, ["--tables"]);
    assert.equal(cell.code, 2);
    assert.deepEqual(cell.json.details.map((line) => line.replace(/line \d+/, "line n")), ["reports/dr-establishment-guide.md line n: looks like a secret (key, token, password or connection string) and must not appear in a guide or runbook"]);
    assert.equal(read(clean.guide), before, "the guide is unchanged");
    assert.equal(cell.stdout.includes(PASSWORD_LIKE) || cell.stderr.includes(PASSWORD_LIKE), false);
});

test("GC-07 (M-2): --check screens the model-filled text of the guide and the runbook, and names the file, line and chapter, never the text", async () => {
    const run = await guideRun();
    assert.equal((await runGuide(run, ["--write"])).code, 0);
    fill(run.guide);
    assert.equal((await runGuide(run, ["--tables"])).code, 0);
    assert.equal((await runGuide(run, ["--inject-runbook", run.runbook])).code, 0);
    assert.equal((await runGuide(run, ["--check"])).code, 0, "a clean guide and runbook pass");

    const chapter2 = read(run.guide).indexOf("## Chapter 2:");
    const today = read(run.guide).indexOf("### Today\n\nPlatform engineer", chapter2);
    writeFileSync(run.guide, `${read(run.guide).slice(0, today)}### Today\n\nThe old setup used ${PASSWORD_LIKE}${read(run.guide).slice(today + "### Today\n\nPlatform engineer".length)}`);
    const runbook = read(run.runbook);
    writeFileSync(run.runbook, runbook.replace("### 2. Test Service\n", `### 2. Test Service\n\nThe connection: ${KEY_LIKE}\n`));
    const r = await runGuide(run, ["--check"]);
    assert.equal(r.code, 2);
    assert.equal(r.json.error, "the guide or the runbook holds text that looks like a secret");
    assert.deepEqual(r.json.details.map((line) => line.replace(/line \d+/, "line n")), [
        `reports/dr-establishment-guide.md line n (chapter 2, ${WIDGETS}): looks like a secret (key, token, password or connection string); remove it, a guide or runbook names where a secret is kept, never the secret`,
        "reports/recovery-runbook.md line n (subsection 2): looks like a secret (key, token, password or connection string); remove it, a guide or runbook names where a secret is kept, never the secret",
    ]);
    for (const value of [PASSWORD_LIKE, KEY_LIKE]) assert.equal(r.stdout.includes(value) || r.stderr.includes(value), false);
});
