import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment, readAssessment, serializeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { resolveSlots } from "../../skills/azure-dr-assessment/scripts/lib/resolve.mjs";
import { writePatterns } from "../helpers/pack-fixture.mjs";
import { sampleAssessment } from "../helpers/resolve-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const skill = path.join(root, "skills", "azure-dr-assessment");
const read = (...parts) => readFileSync(path.join(skill, ...parts), "utf8");

const RANK_2 = "2. **A valid override** from `assessment.yaml`, recorded as a documented exception.";
const RANK_2_WAIVER = "It supplies its `alternative`; without one it waives the pattern, Microsoft Learn decides the slot and the source stays `override`.";
const NO_NODE_ROW =
    "| No Node.js 22 or later, or the host does not let you run scripts | Reasoning-only: no script runs. Write the report, the DR establishment guide and the runbook with Mermaid diagrams and the evidence as a table, and say that the evidence ledger, the diagram files and the presentations were not produced. Read an `.xlsx` only with a workbook reader that the session already has. If there is none, report the input as unreadable and name the alternatives: run where Node 22 is available, or give a live read. |";
const CANVAS_ROW =
    "| `preflight` prints `mode: reasoning-only` although Node works | The canvas library was not found, for example because only the skill folder was copied out of its repository, which is not a supported install. The run degrades as in the row above: reasoning-only, no script runs. Say what `preflight` reports as missing, and say in your answer that a copy of the skill folder alone is not a supported install. |";
// The exception that SKILL.md and stage 6 both state; they differ only in "Learn" against "Microsoft Learn".
const WAIVED_SLOT = /The one exception is a slot that an override waives without an alternative: (?:Microsoft )?Learn decides it and the source stays `override`\./;

test("rank 2 of the precedence keeps its sentence and says that an override without an alternative waives the pattern", () => {
    const precedence = read("SKILL.md").split(/^## Precedence, per decision slot$/m)[1].split(/^## /m)[0];
    const rank2 = precedence.split("\n").find((line) => line.startsWith("2. "));
    assert.equal(rank2, `${RANK_2} ${RANK_2_WAIVER}`);
});

test("the red flag forbids Microsoft Learn only in place of a pattern or an alternative, and SKILL.md and stage 6 name the same waived-slot exception", () => {
    const text = read("SKILL.md");
    const flags = text.split(/^## Red flags[^\n]*$/m)[1].split(/^## /m)[0];
    assert.match(flags, /^- Using Microsoft Learn in place of a company pattern or of an override's `alternative`\. The one exception is a slot that an override waives without an alternative: Learn decides it and the source stays `override`\.$/m);
    assert.doesNotMatch(text, /Using Microsoft Learn where a company pattern or an override applies/);
    assert.match(text, WAIVED_SLOT, "SKILL.md");
    assert.match(read("references", "stages", "06-dr-design.md"), WAIVED_SLOT, "stage 6");
});

test("the Degraded modes table keeps its first row and has the row for a preflight that prints reasoning-only although Node works directly after it", () => {
    const table = read("SKILL.md").split(/^## Degraded modes$/m)[1].split(/^## /m)[0];
    const rows = table.split("\n").filter((line) => line.startsWith("|"));
    assert.deepEqual(rows.slice(0, 4), ["| Situation | Behavior |", "|---|---|", NO_NODE_ROW, CANVAS_ROW]);
});

test("the claim of that row is true: preflight prints that mode when Node works and only the canvas library is missing", async (t) => {
    const claim = /^\| `preflight` prints `mode: ([a-z-]+)` although Node works \|/m.exec(read("SKILL.md"));
    assert.ok(claim, "SKILL.md has the row");

    // A copy of the scripts with no extensions/architecture-canvas beside it and a COPILOT_HOME without one: a skill folder copied out of its repository.
    const tree = mkdtempSync(path.join(tmpdir(), "dr-skill-text-fixes-"));
    t.after(() => rmSync(tree, { recursive: true, force: true }));
    const copied = path.join(tree, "skills", "azure-dr-assessment", "scripts");
    cpSync(path.join(skill, "scripts"), copied, { recursive: true });
    const env = { COPILOT_HOME: path.join(tree, "home"), DR_NO_NETWORK: "1" };
    const statuses = (run) => Object.fromEntries(run.json.checks.map((entry) => [entry.id, entry.status]));

    const missing = await runScript(path.join(copied, "preflight.mjs"), [], { env });
    assert.equal(missing.code, 0, missing.stderr);
    assert.equal(missing.json.node.ok, true);
    assert.equal(statuses(missing).node, "ok");
    assert.equal(statuses(missing)["canvas-library"], "missing");
    assert.equal(missing.json.mode, claim[1]);
    assert.ok(missing.json.degradations.some((line) => line.startsWith("canvas-library: ")), "preflight reports what is missing");

    const present = await runScript(path.join(skill, "scripts", "preflight.mjs"), [], { env });
    assert.equal(present.code, 0, present.stderr);
    assert.equal(statuses(present)["canvas-library"], "ok");
    assert.equal(present.json.mode, "full");
});

// The final review: the Preflight row, and the two reference files that still described the pack banner and the override rule too loosely.
test("the Preflight row says that a live read needs --live, that an inline or reasoning-only run skips the icon fetch, and that the Learn CLI of stage 5 can still verify guidance", () => {
    const row = read("SKILL.md").split("\n").find((line) => line.startsWith("| 1 | Preflight |"));
    assert.ok(row, "SKILL.md has the Preflight row");
    assert.match(row, /A live read needs `--live` \(`node skills\/azure-dr-assessment\/scripts\/preflight\.mjs --live`\), which also checks `az`, its `resource-graph` extension and the sign-in\./);
    assert.match(row, /the guidance is then Unverified unless the Learn CLI fallback of stage 5 works\./);
    assert.match(row, /An inline or reasoning-only run skips the icon fetch: no script runs, so no diagram file or presentation is built\./);
    assert.match(read("references", "stages", "05-region-analysis.md"), /the Learn CLI is the second choice/);
});

test("patterns.md and the output contract put the pack banner where the report template has its place, and the output contract lists the five places", () => {
    const template = readFileSync(path.join(skill, "assets", "templates", "report.md"), "utf8");
    const at = (needle) => template.indexOf(needle);
    assert.ok(at("# DR assessment") === 0 && at("# DR assessment") < at("> **Draft for the owner's review.**") && at("> **Draft for the owner's review.**") < at("when evidence/pattern-resolution.json has a banner") && at("when evidence/pattern-resolution.json has a banner") < at("## 1."));

    const patterns = read("references", "patterns.md");
    assert.match(patterns, /Any other pack puts a `NON-DEFAULT PATTERN PACK` banner in every output: put it right under the title and the DRAFT note of the report, and in the chat summary\./);
    assert.doesNotMatch(patterns, /put it first in the report/);

    const contract = read("references", "output-contract.md");
    assert.match(contract, /The report carries the banner right under its title and the DRAFT note when the pattern pack is not the company pack, and says that it is a draft for the owner's review\./);
    assert.doesNotMatch(contract, /The report opens with the banner/);
    assert.match(contract, /When the pattern pack is not the company pack, the `NON-DEFAULT PATTERN PACK` banner goes in five places: the title of each diagram, the cover blurb of each presentation, the report, the runbook and the chat summary\./);
});

test("the output contract says that the output root is the folder of assessment.yaml and that outputs.directory only records it, as ingest does", () => {
    assert.match(read("references", "output-contract.md"), /The output root is the folder that holds `assessment\.yaml`; `outputs\.directory` in the file only records it, and a mismatch is a warning, never a different root\./);
    assert.doesNotMatch(read("references", "output-contract.md"), /\(`outputs\.directory` in `assessment\.yaml`\)/);
});

test("patterns.md says that an override waives only its own pattern, and the engine leaves another approved pattern in force or reports the collision", async () => {
    assert.match(read("references", "patterns.md"), /\| Override vs pattern \| A valid override wins for its slots as a documented exception, and waives only its own pattern: another approved pattern that decides the same slot stays the candidate, and two or more of them are a collision\. \|/);
    const complete = { justification: "No on-prem DNS dependency", owner_role: "Application owner", date: "2026-11-05" };
    const compute = async (ids) => {
        const pack = await loadPack(writePatterns(ids.map((id) => ({ id, slots: ["compute"] }))));
        return resolveSlots(sampleAssessment({ overrides: [{ pattern: "DR-A-001", ...complete }] }), pack).slots.find((row) => row.slot === "compute");
    };
    const one = await compute(["DR-A-001", "DR-B-001"]);
    assert.deepEqual([one.candidate.source, one.candidate.pattern, one.status, one.collision], ["pattern", "DR-B-001", "candidate", null]);
    const two = await compute(["DR-A-001", "DR-B-001", "DR-C-001"]);
    assert.deepEqual([two.candidate.source, two.status, two.collision], ["collision", "unresolved", ["DR-B-001 v1", "DR-C-001 v1"]]);
    const alone = await compute(["DR-A-001"]);
    assert.deepEqual([alone.candidate.source, alone.candidate.overrideIndex], ["override", 0]);
});

// The final review: DR-11 and DR-12 of tests/scenarios.md that could not be followed as written.
const scenarioSection = (id) => {
    const text = readFileSync(path.join(root, "tests", "scenarios.md"), "utf8");
    const start = text.indexOf(`\n## ${id}:`);
    return text.slice(start, text.indexOf("\n## ", start + 1));
};

test("the DR-12 setup replaces the line overrides: [] and the entry of the previous run, and every block of it is accepted by the file reader that way", async (t) => {
    const dr12 = scenarioSection("DR-12");
    const setup = dr12.split("### Prompt")[0];
    assert.match(setup, /the file then holds the line `overrides: \[\]`\. Then, for each run below, replace that line, or the entry of the previous run, with the block given for the run, and rerun with/);
    assert.match(setup, /A second `overrides:` key makes the file invalid and the run stops with exit 2/);
    assert.match(setup, /Run E, [^\n]*put the line `overrides: \[\]` back in `assessment\.yaml` in place of the entry of the previous run/);
    assert.match(setup, /When the skill asks for the fields it lacks, answer that you do not have them, so that the design can be observed\./);

    const first = serializeAssessment(normalizeAssessment({ workload: { name: "checkout" }, inputs: { ari_file: "ari-sample.xlsx" }, regions: { primary: "westeurope", dr: "swedencentral" }, objectives: { tier: 1 } }));
    assert.equal(first.split("\n").filter((line) => line === "overrides: []").length, 1, "the file of the first run holds the line once");
    const dir = mkdtempSync(path.join(tmpdir(), "dr-scenario-setup-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "assessment.yaml");

    writeFileSync(file, `${first}overrides:\n  - pattern: DR-DNS-001\n`);
    await assert.rejects(
        () => readAssessment(file),
        (err) => err instanceof CliError && err.code === EXIT.INPUT && /not valid YAML/.test(err.message) && err.details.some((line) => /duplicate key "overrides"/.test(line)),
    );

    const blocks = [...setup.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1]);
    assert.equal(blocks.length, 3, "Run A, Run C and Run D give a block");
    for (const block of blocks) {
        writeFileSync(file, first.replace("overrides: []", block.trimEnd()));
        const assessment = await readAssessment(file);
        assert.equal(assessment.overrides.length, 1);
        assert.ok(assessment.overrides[0].pattern.startsWith("DR-"));
    }
});

test("the DR-12 Run A criterion names the checks of DR-DNS-001 by what they test, and check 5 is the Tier 0 check, while every run is Tier 1", () => {
    const dr12 = scenarioSection("DR-12");
    const run = dr12.split("\n").find((line) => line.startsWith("- Run A: "));
    assert.match(run, /lists every Verification check of `DR-DNS-001` that tests the on-prem DNS design \(check 5 applies only at Tier 0\) as `Not checked: waived by Override #0`/);
    assert.doesNotMatch(dr12, /checks 2 to 6 of version 1/);
    const verification = read("patterns", "DR-DNS-001.md").split(/^## Verification$/m)[1].split(/^## /m)[0];
    const checks = verification.split("\n").filter((line) => line.startsWith("- "));
    assert.equal(checks.length, 6);
    assert.match(checks[4], /^- Tier 0: /);
    assert.match(dr12.split("### Prompt")[1].split("### Acceptance criteria")[0], /Tier 1\./);
});

test("the DR-11 criterion quotes the label of the failover edge as DR-DNS-001 and stage 6 write it", () => {
    const criterion = scenarioSection("DR-11").split("\n").find((line) => line.startsWith("- The DR diagram shows the on-prem DNS"));
    assert.match(criterion, /The label of the failover edge starts with "change on-prem DNS record" and continues with the record type and the TTL, or with "not supplied by the application team" for an input that is missing\./);
    assert.doesNotMatch(criterion, /Change on-prem DNS record/);
    const elements = read("patterns", "DR-DNS-001.md").split(/^## Diagram elements$/m)[1].split(/^## /m)[0];
    assert.match(elements, /Label the failover edge "change on-prem DNS record" with the record type and the TTL\./);
    assert.match(elements, /"record type: not supplied by the application team" or "TTL: not supplied by the application team"/);
    assert.match(read("references", "stages", "06-dr-design.md"), /a failover edge labeled "change on-prem DNS record" to the DR region/);
});
