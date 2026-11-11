import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment, readAssessment, serializeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { patternsSection } from "../../skills/azure-dr-assessment/scripts/lib/report-tables.mjs";
import { resolveSlots } from "../../skills/azure-dr-assessment/scripts/lib/resolve.mjs";
import { parseYaml } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { writePatterns } from "../helpers/pack-fixture.mjs";
import { sampleAssessment } from "../helpers/resolve-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const skill = path.join(root, "skills", "azure-dr-assessment");
const stagesDir = path.join(skill, "references", "stages");
const read = (name) => readFileSync(path.join(stagesDir, name), "utf8");

test("stage 6 never puts Microsoft Learn in place of a pattern or an override's alternative, and names the one exception", () => {
    const design = read("06-dr-design.md");
    const never = design.split(/^## Never$/m)[1].split(/^## /m)[0];
    assert.match(never, /^- Use Microsoft Learn in place of a company pattern or an override's `alternative`, or choose between colliding patterns\. The one exception is a slot that an override waives without an alternative: Microsoft Learn decides it and the source stays `override`\.$/m);
    assert.doesNotMatch(design, /Use Microsoft Learn where a company pattern or an override applies/);
});

test("stage 5 records a type that nothing documents as an Unknown fact, not as a mechanism entry", () => {
    const region = read("05-region-analysis.md");
    assert.match(region, /If nothing documents it, do not add a mechanism entry: record an Unknown fact for the type \(see "Recording"\)\. The mechanism is Unknown and the guidance Unverified, and the design must not claim coverage for it\./);
    assert.match(region, /A type that nothing documents gets an Unknown fact, not a mechanism entry: a mechanism entry needs a `--class`, and `--class none` would claim that the type has no built-in multiregion mechanism, which you have not established\./);
    assert.match(region, /The report then shows the component as Unknown, and the design must not claim coverage for it\./);
    assert.match(region, /Every type in `types` has a mechanism entry or, when nothing documents its mechanism, an Unknown fact; the pair, zones, geography and latency findings/);
    assert.doesNotMatch(region, /If nothing documents it, the mechanism is Unknown and the guidance Unverified\./);
    assert.doesNotMatch(region, /\(or an Unknown one\)/);
});

const ledgerScript = path.join(skill, "scripts", "ledger.mjs");
const shellWords = (command) => [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
const withFlag = (args, flag, value) => args.map((arg, i) => (args[i - 1] === flag ? value : arg));

test("the Unknown fact that stage 5 documents is accepted by the real ledger script and the ledger validates", async (t) => {
    const command = read("05-region-analysis.md").split("\n").find((line) => /^node skills\/azure-dr-assessment\/scripts\/ledger\.mjs add-fact .*--strength Unknown\b/.test(line));
    assert.ok(command, "stage 5 documents an add-fact command with --strength Unknown");
    const [, , ...args] = shellWords(command);
    const dir = mkdtempSync(path.join(tmpdir(), "dr-stage5-unknown-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ledger = path.join(dir, args[args.indexOf("--ledger") + 1]);

    const added = await runScript(ledgerScript, args, { cwd: dir });
    assert.equal(added.code, 0, `${added.stdout}${added.stderr}`);
    assert.equal(added.json.id, "F-0001");
    const live = await runScript(ledgerScript, withFlag(args, "--source-type", "live"), { cwd: dir });
    assert.equal(live.code, 0, `${live.stdout}${live.stderr}`);

    const facts = JSON.parse(readFileSync(ledger, "utf8")).entries;
    assert.deepEqual(facts.map((fact) => [fact.kind, fact.strength, fact.property, fact.value]), [
        ["fact", "Unknown", "mechanism", null],
        ["fact", "Unknown", "mechanism", null],
    ]);
    assert.deepEqual(facts.map((fact) => fact.source.type), ["ari-xlsx", "live"]);
    assert.ok(facts.every((fact) => fact.subject !== "" && fact.claim !== ""));
    const validated = await runScript(ledgerScript, ["validate", "--ledger", ledger]);
    assert.equal(validated.code, 0, `${validated.stdout}${validated.stderr}`);
});

test("stage 2 names the keys of the exceptions, overrides and decisions it asks the model to write, and the date format", () => {
    const intake = read("02-intake.md");
    assert.match(intake, /add the entry under `objectives\.exceptions` in `assessment\.yaml` with the keys `what`, `approver_role` and `date` \(written `YYYY-MM-DD`\), and rerun\./);
    assert.match(intake, /the pattern ID \(`pattern`\), a justification \(`justification`\), an owner role \(`owner_role`\) and a date \(`date`, written `YYYY-MM-DD`\); for an approval-required pattern also an approver role \(`approver_role`\) and an approval reference \(`approval_ref`\)\./);
    assert.match(intake, /Two keys are optional: `slots`, a list of the slots it waives \(without it, every slot the pattern decides\), and `alternative`, what replaces the pattern \(without it, Microsoft Learn decides the waived slots\)\./);
    assert.match(intake, /under `decisions`, each with the keys `question`, `answer`, `by` \(who gave it\) and `date` \(written `YYYY-MM-DD`\)\. Use exactly these names: intake rebuilds each decision from them and drops any other key\./);
    assert.doesNotMatch(intake, /\(question, answer, who, date\)/);
});

test("the keys that stage 2 names are the keys normalizeAssessment keeps, and a key such as who is dropped", () => {
    const intake = read("02-intake.md");
    const kept = normalizeAssessment({
        objectives: { exceptions: [{ what: "RTO of 10m", approver_role: "CTO", date: "2026-11-05", who: "A. Owner" }] },
        overrides: [{ pattern: "DR-DNS-001", slots: ["traffic-dns"], justification: "j", owner_role: "o", date: "2026-11-05", approver_role: "a", approval_ref: "r", alternative: "alt", who: "A. Owner" }],
        decisions: [{ question: "q", answer: "a", by: "A. Owner", date: "2026-11-05", who: "A. Owner" }],
    });
    assert.equal(kept.decisions[0].by, "A. Owner");
    assert.deepEqual(Object.keys(kept.decisions[0]), ["question", "answer", "by", "date"]);
    assert.deepEqual(Object.keys(kept.objectives.exceptions[0]), ["what", "approver_role", "date"]);
    assert.deepEqual(Object.keys(kept.overrides[0]), ["pattern", "slots", "justification", "owner_role", "date", "approver_role", "approval_ref", "alternative"]);
    for (const entry of [kept.decisions[0], kept.objectives.exceptions[0], kept.overrides[0]]) {
        for (const key of Object.keys(entry)) assert.ok(intake.includes(`\`${key}\``), `stage 2 names the key ${key}`);
    }
    assert.equal(intake.includes("`who`"), false, "who is not a key");
});

// The final review: stage 2 text that did not match what intake and the file reader do.
test("stage 2 allows the question for the missing fields of an override and names the four inputs of DR-DNS-001 as the pattern does", () => {
    const intake = read("02-intake.md");
    const never = intake.split(/^## Never$/m)[1].split(/^## /m)[0];
    assert.match(never, /^- Ask a question that is not in `missing`, a gate, the scope question or the missing fields of an override \(see "Overrides and decisions"\)\./m);
    assert.match(intake.split(/^## Overrides and decisions$/m)[1], /If a field is missing, ask for the missing fields once/);

    const pattern = readFileSync(path.join(skill, "patterns", "DR-DNS-001.md"), "utf8");
    const inputs = [...pattern.matchAll(/^ {2}- name: ([a-z_]+)$/gm)].map((match) => match[1]);
    assert.deepEqual(inputs, ["record_type", "ttl", "record_owner_role", "private_zone_integration"]);
    assert.match(never, /write them under `pattern_inputs\.DR-DNS-001` in `assessment\.yaml` with the keys `record_type`, `ttl`, `record_owner_role` and `private_zone_integration`\./);
    for (const input of inputs) assert.ok(never.includes(`\`${input}\``), `stage 2 names the input ${input}`);
});

test("stage 2 says that every intake run normalizes assessment.yaml and that an entry is a block mapping, and the code does both", async (t) => {
    const section = read("02-intake.md").split(/^## Overrides and decisions$/m)[1].split(/^## /m)[0];
    assert.match(section, /Every intake run leaves `assessment\.yaml` in its normalized form, so comments and keys that are not part of the schema are dropped\./);
    assert.match(section, /Write each entry as a block mapping, one key per line: the file reader rejects a `\{ key: value \}` flow mapping with exit 2\./);

    const normalized = serializeAssessment(normalizeAssessment(parseYaml("# the owner's note\nworkload:\n  name: x\n  nickname: y\nextra: 1\n")));
    assert.equal(/owner's note|nickname|extra/.test(normalized), false);

    const dir = mkdtempSync(path.join(tmpdir(), "dr-stage2-flow-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "assessment.yaml");
    writeFileSync(file, "workload:\n  name: x\noverrides:\n  - { pattern: DR-DNS-001, justification: j }\n");
    await assert.rejects(() => readAssessment(file), (err) => err instanceof CliError && err.code === EXIT.INPUT && /not valid YAML/.test(err.message));
    writeFileSync(file, "workload:\n  name: x\noverrides:\n  - pattern: DR-DNS-001\n    justification: j\n");
    assert.equal((await readAssessment(file)).overrides[0].pattern, "DR-DNS-001");
});

test("stage 3 asks for the number of assessed sheets and the name of every omitted sheet, and the ingest summary has those fields", async (t) => {
    assert.match(read("03-ingest.md"), /\| `sheets` and `omittedSheets` \| Say how many sheets were assessed \(`sheets\.assessed` of `sheets\.total`\) and name every omitted sheet from `omittedSheets`\./);
    const dir = mkdtempSync(path.join(tmpdir(), "dr-stage3-sheets-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(path.join(dir, "ari.xlsx"), makeAriWorkbook());
    const r = await runScript(path.join(skill, "scripts", "ingest.mjs"), ["--summary-only", "--ari", "ari.xlsx"], { cwd: dir });
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    assert.equal(r.json.sheets.assessed + r.json.sheets.omitted, r.json.sheets.total);
    assert.ok(r.json.sheets.omitted > 0);
    assert.deepEqual(r.json.omittedSheets.map((sheet) => typeof sheet.name), Array(r.json.sheets.omitted).fill("string"));
});

// The final review: stage 4 text that did not match the story template and the present script.
test("stage 4 names the keys of a group entry as the story template reads them", () => {
    const row = read("04-as-is.md").split("\n").find((line) => line.startsWith("   | `groups` |"));
    assert.ok(row, "stage 4 has the groups row of the story data table");
    assert.match(row, /One entry per diagram group: `group` \(the label of the diagram group\), `md` \(the narration\) and, optionally, `title`, `nodes` \(labels\) and `edges` \(`\[from label, to label\]` pairs\) to emphasize\./);
    const template = readFileSync(path.join(skill, "assets", "templates", "story.current-state.mjs"), "utf8");
    const read_ = [...new Set([...template.matchAll(/\bentry\??\.([a-z]+)\b/g)].map((match) => match[1]))].sort();
    assert.deepEqual(read_, ["edges", "group", "md", "nodes", "title"]);
    for (const key of read_) assert.ok(row.includes(`\`${key}\``), `the row names the key ${key}`);
});

test("stage 4 says what to do when present refuses story data that looks like a secret, and stages 4 and 6 count a withheld presentation as done once the owner was told why", () => {
    const asIs = read("04-as-is.md");
    assert.match(asIs, /Exit 2 with a message that the story data holds text that looks like a secret: the details name the path of each string, never the text\. Remove that text from `presentations\/checkout-current-state\.story-data\.json` and build again; the presentation was not built\./);
    assert.match(asIs.split(/^## Done when$/m)[1], /`build-diagram` exits 0, `present` exits 0 or you have said why the presentation was withheld, every node cites a fact/);
    const design = read("06-dr-design.md");
    assert.match(design.split(/^## Done when$/m)[1], /The resolution validates, `build-diagram` exits 0, `present` exits 0 or you have said why the presentation was withheld, every unmet requirement/);
});

test("the story data refusal that stage 4 describes is the one present.mjs makes: exit 2, the path and never the text", async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-stage4-secret-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const stories = path.join(dir, "presentations");
    const template = readFileSync(path.join(skill, "assets", "templates", "story.current-state.mjs"));
    const secret = ["Account", "Key="].join("") + "a".repeat(30);
    mkdirSync(stories);
    writeFileSync(path.join(stories, "x-current-state.story.mjs"), template);
    writeFileSync(path.join(stories, "x-current-state.story-data.json"), JSON.stringify({ schemaVersion: 1, cover: { title: "t", blurb: `see ${secret}` } }));
    const r = await runScript(path.join(skill, "scripts", "present.mjs"), ["--story", path.join(stories, "x-current-state.story.mjs")], { cwd: dir });
    assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
    assert.equal(r.json.error, "the story data holds text that looks like a secret, so the presentation was not built");
    assert.deepEqual(r.json.details.map((line) => line.split(" looks like")[0]), ["x-current-state.story-data.json: cover.blurb"]);
    assert.equal(r.stdout.includes(secret) || r.stderr.includes(secret), false);
});

// The final review: stage 6 text that left out how a Learn page gets its D- id, the azureReality field and the fields that belong to the engine.
test("stage 6 records a Learn page that it reads with add-doc before it is cited, in the learn row and in the waived-slot row", () => {
    const design = read("06-dr-design.md");
    const rowOf = (start) => design.split("\n").find((line) => line.startsWith(start));
    assert.match(rowOf("| `learn` |"), /Record a page you read now with `ledger\.mjs add-doc` before you cite it, so that it has a `D-` id for `ledger` and for section C of the report\./);
    assert.match(rowOf("| `override` without an `alternative` |"), /Name the Microsoft Learn documents you used in `ref`, and list their `D-` ids in `ledger`\. Record a page you read in this stage with `ledger\.mjs add-doc` first, so that it has a `D-` id\./);
    assert.match(read("05-region-analysis.md"), /node skills\/azure-dr-assessment\/scripts\/ledger\.mjs add-doc /);
});

test("stage 6 documents azureReality in the Fields table, and says that only the decision of a slot row is the model's, as the engine's output and the validator have it", async () => {
    const design = read("06-dr-design.md");
    assert.match(design, /^\| `azureReality` \| What the stage 5 findings say about this slot\. Write `no veto` when they say nothing against the decision\. An Unmet requirement needs this or `alternative`\. \|$/m);
    const sentence = /Only the `decision` of each slot row is yours\. Leave `candidate`, `status` and `collision` of the rows, and `patterns`, `overrides`, `documentedExceptions`, `gates`, `openInputs` and `banner`, as `resolve-patterns` wrote them: the validation checks the candidate and the status of each row, and section D of the report is built from the rest\./;
    assert.match(design, sentence);

    const pack = await loadPack(writePatterns([{ id: "DR-A-001", slots: ["compute"] }]));
    const resolution = resolveSlots(sampleAssessment(), pack);
    for (const key of ["patterns", "overrides", "documentedExceptions", "gates", "openInputs", "banner"]) assert.ok(key in resolution, `the engine writes ${key}`);
    assert.deepEqual(Object.keys(resolution.slots[0]), ["slot", "candidate", "collision", "status", "decision"]);
});

test("stage 6 lists the two refusals of build-diagram that were missing: a node with a mechanism and secret-like exception text", () => {
    const paragraph = read("06-dr-design.md").split("\n").find((line) => line.startsWith("Exit 2 lists every problem:"));
    assert.ok(paragraph, "stage 6 has the exit 2 paragraph of build-diagram");
    assert.match(paragraph, /a missing mechanism, a node that carries a `mechanism` \(put it on the link that carries it\) and text of a documented exception that looks like a secret \(the message names the path, never the text: remove that text from `assessment\.yaml`, rerun `resolve-patterns`, which starts a new resolution so that you write your decisions again, and build again\)\./);
});

// The final review: stage 7 text for the secret refusal of report-tables and the place of the pack banner.
test("stage 7 says what exit 2 of report-tables means when the resolution holds secret-like text, in the words of the refusal", async () => {
    const report = read("07-report.md");
    assert.match(report, /Exit 2 with a message that the pattern resolution holds text that looks like a secret means that nothing was written and the report is left unchanged\. The details name each path, never the text\. Remove the text from `assessment\.yaml` and rerun `resolve-patterns` \(it starts a new resolution, so decide the slots again\), or, when the path is below `slots`, from your own decision in `evidence\/pattern-resolution\.json`; then run the command again\./);
    const secret = ["Account", "Key="].join("") + "a".repeat(30);
    assert.throws(
        () => patternsSection({ resolution: { banner: secret } }),
        (err) => err instanceof CliError && err.code === EXIT.INPUT && err.message === "the pattern resolution holds text that looks like a secret, so the report tables were not built" && !JSON.stringify([err.message, err.details]).includes(secret),
    );
});

test("stage 7 puts the pack banner right under the title and the DRAFT note of the report, where the report template has its place", () => {
    const template = readFileSync(path.join(skill, "assets", "templates", "report.md"), "utf8");
    const at = (needle) => template.indexOf(needle);
    assert.ok(at("# DR assessment") === 0 && at("# DR assessment") < at("> **Draft for the owner's review.**") && at("> **Draft for the owner's review.**") < at("when evidence/pattern-resolution.json has a banner") && at("when evidence/pattern-resolution.json has a banner") < at("## 1."));
    const report = read("07-report.md");
    assert.match(report, /^- The banner, when the pattern pack is not the company pack, is right under the title and the DRAFT note of the report, under the DRAFT line of the runbook, and in the chat summary\.$/m);
    assert.doesNotMatch(report, /The banner is on the first line of the report/);
});

// The follow-up of the final fix wave: presentation 2 is built by the same script as presentation 1, so stage 6 names the same refusal as stage 4.
test("stage 6 names the refusal of present for story data that looks like a secret in the words of stage 4, with the data file of presentation 2 that present reads", async (t) => {
    const design = read("06-dr-design.md");
    const presentation = design.split(/^## Presentation 2: the DR walkthrough$/m)[1].split(/^## /m)[0];
    const exits = presentation.split("\n").find((line) => line.includes("Exit 4 with `unresolved-labels`"));
    assert.ok(exits, "stage 6 has the paragraph about the exits of present");
    const refusal = "Exit 2 with a message that the story data holds text that looks like a secret: the details name the path of each string, never the text. Remove that text from `presentations/checkout-proposed-dr.story-data.json` and build again; the presentation was not built.";
    assert.ok(exits.includes(`Exit 2 with \`steps is missing\` names the step you left out. ${refusal}`), "the refusal follows the other exit 2 of present");

    const asIs = read("04-as-is.md");
    const stage4 = asIs.match(/Exit 2 with a message that the story data holds text that looks like a secret:.*?the presentation was not built\./)?.[0];
    assert.equal(stage4?.replace("checkout-current-state", "checkout-proposed-dr"), refusal, "the words are those of stage 4, with the file name of stage 6");

    const id = presentation.match(/presentations\/([a-z-]+)\.story\.mjs`/)?.[1];
    assert.equal(id, "checkout-proposed-dr");
    assert.ok(presentation.includes(`Write \`presentations/${id}.story-data.json\` next to it.`));

    const dir = mkdtempSync(path.join(tmpdir(), "dr-stage6-secret-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const stories = path.join(dir, "presentations");
    const secret = ["Account", "Key="].join("") + "a".repeat(30);
    mkdirSync(stories);
    writeFileSync(path.join(stories, `${id}.story.mjs`), readFileSync(path.join(skill, "assets", "templates", "story.dr-walkthrough.mjs")));
    writeFileSync(path.join(stories, `${id}.story-data.json`), JSON.stringify({ schemaVersion: 1, cover: { title: "t", blurb: `see ${secret}` } }));
    const r = await runScript(path.join(skill, "scripts", "present.mjs"), ["--story", path.join(stories, `${id}.story.mjs`)], { cwd: dir });
    assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
    assert.equal(r.json.error, "the story data holds text that looks like a secret, so the presentation was not built");
    assert.deepEqual(r.json.details.map((line) => line.split(" looks like")[0]), [`${id}.story-data.json: cover.blurb`]);
    assert.equal(r.stdout.includes(secret) || r.stderr.includes(secret), false);
});
