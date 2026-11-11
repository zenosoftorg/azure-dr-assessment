import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { parseYaml } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const text = readFileSync(path.join(root, "tests", "scenarios.md"), "utf8");
const headings = [...text.matchAll(/^## (DR-\d{2}): (.+)$/gm)];
const resultsAt = text.indexOf("\n## Results");
const scenarios = headings.map((match, i) => ({
    id: match[1],
    title: match[2],
    body: text.slice(match.index, i + 1 < headings.length ? headings[i + 1].index : resultsAt),
}));
const INLINE = ["DR-01", "DR-02", "DR-03", "DR-04", "DR-07", "DR-08", "DR-09"];
const INTEGRATION = ["DR-05", "DR-06"];
const FILE = ["DR-10", "DR-11", "DR-12", "DR-13", "DR-14", "DR-15", "DR-16", "DR-17", "DR-18"];
const ALL = Array.from({ length: 18 }, (_, i) => `DR-${String(i + 1).padStart(2, "0")}`);
/** The v3 scenarios of spec section 10. Spec correction S1: their rows of the results table are added by the owner. */
const V3 = ["DR-15", "DR-16", "DR-17", "DR-18"];
const scenario = (id) => scenarios.find((s) => s.id === id).body;
const promptOf = (body) => body.split("### Prompt")[1].split("### Acceptance criteria")[0].replace(/\s+/g, " ");

test("the scenarios are DR-01 to DR-18, each once and in order", () => {
    assert.deepEqual(scenarios.map((s) => s.id), ALL);
    assert.deepEqual([...INLINE, ...INTEGRATION, ...FILE].sort(), ALL);
});

test("every scenario keeps the number and the subject of spec section 11", () => {
    const title = (id) => scenarios.find((s) => s.id === id).title;
    assert.match(title("DR-05"), /folder.*chat/i);
    assert.match(title("DR-06"), /tool availability/i);
    assert.match(title("DR-10"), /not a pair/i);
    assert.match(title("DR-11"), /DNS/);
    assert.match(title("DR-12"), /override/i);
    assert.match(title("DR-13"), /intake/i);
    assert.match(title("DR-14"), /end to end/i);
    assert.equal(title("DR-15"), "Key Vault split-region with the DR options interview");
    assert.equal(title("DR-16"), "Non-interactive defaults");
    assert.equal(title("DR-17"), "Migration from GRS to object replication");
    assert.equal(title("DR-18"), "A service without a playbook");
});

test("each scenario has a setup, a prompt or a procedure, and acceptance criteria with several items", () => {
    for (const { id, body } of scenarios) {
        const middle = INTEGRATION.includes(id) ? "### Procedure" : "### Prompt";
        for (const part of ["### Setup", middle, "### Acceptance criteria"]) assert.ok(body.includes(part), `${id} has ${part}`);
        assert.equal(body.includes(INTEGRATION.includes(id) ? "### Prompt" : "### Procedure"), false, `${id} has only one of the two`);
        const criteria = body.split("### Acceptance criteria")[1];
        assert.ok((criteria.match(/^- /gm) ?? []).length >= 4, `${id} lists its criteria`);
    }
});

test("the inline scenarios ask for no files and describe the workload; the file scenarios use the sample inventory", () => {
    for (const { id, body } of scenarios.filter((s) => !INTEGRATION.includes(s.id))) {
        const prompt = promptOf(body);
        if (INLINE.includes(id)) {
            assert.match(prompt, /Do not connect to Azure(?:, execute recovery actions,)? or write files\./, `${id} asks for no files`);
            assert.doesNotMatch(prompt, /ari-sample\.xlsx/, `${id} describes the workload itself`);
            assert.match(body.split("### Acceptance criteria")[1], /^- (?:It )?[Ww]rites nothing/m, `${id} expects that nothing is written`);
        } else {
            assert.doesNotMatch(prompt, /write files/, `${id} lets the skill write below dr-assessment/checkout/`);
            assert.match(prompt, /ari-sample\.xlsx/, `${id} uses the sample inventory`);
        }
    }
});

test("the results table has one NOT RUN row for each scenario up to DR-14, in order; the owner adds the rows of DR-15 to DR-18", () => {
    const rows = [...text.slice(resultsAt).matchAll(/^\| (DR-\d{2}) \| (\S+(?: \S+)?) \| (\S+(?: \S+)?) \|/gm)];
    const ids = rows.map((row) => row[1]);
    assert.deepEqual(ids, scenarios.map((s) => s.id).filter((id) => ids.includes(id)), "each row once, in the order of the scenarios");
    for (const id of ALL.filter((id) => !V3.includes(id))) assert.ok(ids.includes(id), `${id} has a row`);
    for (const row of rows) assert.deepEqual([row[2], row[3]], ["NOT RUN", "NOT RUN"], row[1]);
});

test("everything that the setup names exists: the sample generator and the test pattern packs", () => {
    assert.ok(existsSync(path.join(root, "tests", "manual", "make-sample-ari.mjs")));
    const packs = [...new Set([...text.matchAll(/tests\/fixtures\/patterns\/([a-z]+)/g)].map((match) => match[1]))];
    assert.deepEqual(packs.sort(), ["collisions", "overridable"]);
    for (const pack of packs) assert.ok(existsSync(path.join(root, "tests", "fixtures", "patterns", pack)), pack);
});

test("DR-12 has the five runs of the spec and Run D relies on an overridable pattern of the overridable pack", () => {
    const dr12 = scenario("DR-12");
    for (const run of ["Run A", "Run B", "Run C", "Run D", "Run E"]) {
        assert.ok(dr12.includes(`${run}, `), `${run} has a setup`);
        assert.ok(dr12.includes(`- ${run}: `), `${run} has a criterion`);
    }
    const pattern = readFileSync(path.join(root, "tests", "fixtures", "patterns", "overridable", "DR-FAILOVER-001.md"), "utf8");
    assert.match(pattern, /^id: DR-FAILOVER-001$/m);
    assert.match(pattern, /^override: overridable$/m);
    assert.match(pattern, /^slots: \[failover-approval\]$/m);
    assert.ok(dr12.includes("pattern: DR-FAILOVER-001") && dr12.includes("slots: [failover-approval]"));
    assert.ok(dr12.includes("- Run A, the repeat without `alternative`: "));
    assert.equal(dr12.split("`Not checked: waived by Override #0`").length - 1, 2, "Run A and its repeat both list the checks that are not checked");
});

test("the engine messages that DR-12 quotes are the ones the override validation produces", () => {
    const source = readFileSync(path.join(root, "skills", "azure-dr-assessment", "scripts", "lib", "overrides.mjs"), "utf8");
    assert.ok(source.includes("locked pattern: change it through this repository"));
    assert.ok(source.includes("missing required fields: "));
    const dr12 = scenario("DR-12");
    assert.ok(dr12.includes("`locked pattern: change it through this repository`"));
    assert.ok(dr12.includes("`missing required fields: approver_role, approval_ref`"));
});

test("the scenarios keep the rules of the skill: no Azure connection and no failover", () => {
    assert.match(text, /Synthetic scenarios must not connect to Azure or modify Azure resources\. The one exception is DR-06 part B, which reads an authorized test subscription and never changes it\./);
    assert.match(text, /every output must then carry the `NON-DEFAULT PATTERN PACK` banner/);
    assert.doesNotMatch(text, /\b(TBD|TODO|FIXME)\b/);
});

test("DR-05 has its five steps and DR-06 its three parts and five tool checks, each with a criterion, and C5 judges the degraded mode that SKILL.md describes", () => {
    const dr05 = scenario("DR-05");
    for (let step = 1; step <= 5; step++) {
        assert.ok(dr05.includes(`\n${step}. `), `DR-05 has step ${step}`);
        assert.ok(dr05.includes(`- Step ${step}: `), `DR-05 judges step ${step}`);
    }
    const dr06 = scenario("DR-06");
    for (const part of ["A. **ARI input.**", "B. **Azure input.**", "C. **Tool availability.**"]) assert.ok(dr06.includes(part), part);
    for (const check of ["No Node", "Microsoft Learn unreachable", "An empty icon cache", "A host that refuses scripts", "The canvas library missing while Node works"]) assert.ok(dr06.includes(check), check);
    for (const label of ["- A: ", "- B: ", "- C1: ", "- C2: ", "- C3: ", "- C4: ", "- C5: "]) assert.ok(dr06.includes(label), label);
    assert.match(dr06, /it reports the workbook unreadable and names the alternatives \(run where Node 22 is available, or give a live read\)/);
    assert.equal(dr06.includes("CSV"), false, "DR-06 does not mention CSV");

    const criterion = dr06.split("- C5: ")[1].split("\n")[0];
    assert.match(criterion, /`preflight` prints `mode: reasoning-only` and reports the `canvas-library` check as missing/);
    assert.match(criterion, /behaves as in C1/);
    assert.match(criterion, /a copy of the skill folder alone is not a supported install/);
    const skill = readFileSync(path.join(root, "skills", "azure-dr-assessment", "SKILL.md"), "utf8");
    assert.ok(skill.includes("| `preflight` prints `mode: reasoning-only` although Node works | The canvas library was not found"), "SKILL.md has the row that C5 judges");
    assert.ok(skill.includes("which is not a supported install"));
});

test("the settings and the commands that DR-06 names exist", () => {
    const dr06 = scenario("DR-06");
    const scripts = path.join(root, "skills", "azure-dr-assessment", "scripts");
    const source = ["fetch-icons.mjs", path.join("lib", "paths.mjs")].map((file) => readFileSync(path.join(scripts, file), "utf8")).join("\n");
    for (const name of ["ARCH_CANVAS_ICON_ROOT", "DR_ICON_MIRROR"]) {
        assert.ok(dr06.includes(name), `DR-06 names ${name}`);
        assert.ok(source.includes(name), `a script reads ${name}`);
    }
    assert.ok(dr06.includes("DR_ARI_SAMPLE") && readFileSync(path.join(root, "tests", "unit", "ari.test.mjs"), "utf8").includes("DR_ARI_SAMPLE"));
    assert.ok(dr06.includes("copilot mcp disable microsoft-learn") && dr06.includes("az extension add --name resource-graph") && dr06.includes("copilot --deny-tool='shell'"));
});

test("\"Who runs the scenarios\" gives every scenario to the owner or to the acceptance run, and check 11 of RELEASING.md says the same", () => {
    const section = text.split(/^## Who runs the scenarios$/m)[1].split(/^## /m)[0];
    const check = readFileSync(path.join(root, "RELEASING.md"), "utf8").split(/^11\. \*\*The live scenarios\.\*\*/m)[1].split(/^## /m)[0];
    const idsOf = (list) => list.split(/, | and /).flatMap((item) => {
        const range = /^DR-(\d\d) to DR-(\d\d)$/.exec(item);
        if (!range) return [item];
        return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => `DR-${String(Number(range[1]) + i).padStart(2, "0")}`);
    });
    const owner = "DR-10, DR-11 and DR-12";
    const acceptance = "DR-01 to DR-04, DR-07 to DR-09, DR-13 and DR-14";
    const ownerV3 = "DR-15";
    const acceptanceV3 = "DR-16 to DR-18";
    const parts = ["DR-05 step 5", "DR-06 part B", "DR-06 part A with the real export", "DR-05 steps 1 to 4", "DR-06 part A with the sample inventory", "DR-06 part C"];
    assert.deepEqual([...idsOf(owner), ...idsOf(acceptance), ...idsOf(ownerV3), ...idsOf(acceptanceV3), "DR-05", "DR-06"].sort(), ALL, "every scenario has a run, and DR-05 and DR-06 are split by parts");
    for (const [name, where] of [["tests/scenarios.md", section], ["RELEASING.md", check]]) {
        for (const item of [owner, acceptance, ownerV3, acceptanceV3, ...parts]) assert.ok(where.includes(item), `${name} names "${item}"`);
    }
    assert.match(section.split("**The owner")[1].split("**The acceptance run")[0], /For v3, also DR-15, which judges the design choice of the DR options interview\./);
    assert.match(section.split("**The acceptance run")[1], /For v3, also DR-16 to DR-18\./);
});

test("DR-13's partial assessment.yaml works as the scenario says: tier first, then regions and scope together, then nothing", async () => {
    const dr13 = scenario("DR-13");
    assert.match(dr13, /announces `dr-assessment\/checkout\/` and does not ask about it/);
    assert.match(dr13, /A rerun with "Use \/azure-dr-assessment with dr-assessment\/checkout\/assessment\.yaml" asks nothing/);
    assert.match(scenario("DR-14"), /The run is one shot: after the inputs and the scope answer there is no further question except the DR options question of stage 5b, answered `accept recommendations`\./);
    const setup = dr13.split("### Setup")[1].split("### Prompt")[0];
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-scenario-13-")));
    mkdirSync(path.join(cwd, "dr-assessment", "checkout"), { recursive: true });
    const file = path.join("dr-assessment", "checkout", "assessment.yaml");
    writeFileSync(path.join(cwd, file), /```yaml\n([\s\S]*?)```/.exec(setup)[1]);
    writeFileSync(path.join(cwd, "ari-sample.xlsx"), makeAriWorkbook());
    const intake = (...flags) => runScript(path.join(root, "skills", "azure-dr-assessment", "scripts", "intake.mjs"), ["--assessment", file, ...flags], { cwd });

    const first = await intake();
    assert.equal(first.code, 4, "the open tier gate stops the run");
    assert.deepEqual(first.json.missing.map((entry) => entry.field), ["objectives.tier", "regions.primary", "regions.dr"]);
    assert.equal(first.json.gates[0].id, "tier-missing");
    assert.ok(first.json.gates[0].question.startsWith("**Which landing zone DR tier applies to this application?**"), "the question is the one of DR-TIER-001");
    assert.equal(first.json.announce, "Output folder: dr-assessment/checkout/");

    const second = await intake("--tier", "1", "--primary", "westeurope", "--dr", "swedencentral");
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.json.needsScope, true, "the sample inventory has several candidate workloads");
    assert.ok(second.json.candidates.length > 1);

    const third = await intake("--scope-resource-group", "rg-checkout");
    assert.deepEqual([third.code, third.json.complete, third.json.needsScope, third.json.gatesOpen], [0, true, false, 0]);
    const saved = parseYaml(readFileSync(path.join(cwd, file), "utf8"));
    assert.deepEqual([saved.workload.name, saved.workload.environment, saved.inputs.ari_file], ["checkout", "production", "ari-sample.xlsx"], "the owner's three keys survive");
    assert.deepEqual([saved.objectives.tier, saved.regions.primary, saved.regions.dr, saved.scope.resource_groups], [1, "westeurope", "swedencentral", ["rg-checkout"]]);

    const rerun = await intake();
    assert.deepEqual([rerun.code, rerun.json.complete, rerun.json.missing, rerun.json.changes, rerun.json.gatesOpen], [0, true, [], [], 0], "a rerun from the file asks nothing");
});

test("DR-15 to DR-18 use the sample generator's flags, keep the subjects of spec section 10 and name the outputs of the guide", async () => {
    assert.match(text.split("## DR-01:")[0], /add `--service-bus` for DR-10, `--primary swedencentral` for DR-15 and `--extra-type microsoft\.network\/virtualnetworks` for DR-18/);
    const generator = readFileSync(path.join(root, "tests", "manual", "make-sample-ari.mjs"), "utf8");
    for (const flag of ["--primary", "--extra-type", "--service-bus"]) assert.ok(generator.includes(`"${flag}"`), `the generator reads ${flag}`);

    const dr15 = scenario("DR-15");
    assert.match(dr15, /written with `--primary swedencentral`/);
    assert.match(promptOf(dr15), /primary region swedencentral, DR region germanywestcentral\. .*answer: KV 2/);
    assert.ok(dr15.includes("`split: Key Vault only (swedensouth)`"), "the label of the example in stage 6");
    assert.ok(readFileSync(path.join(root, "skills", "azure-dr-assessment", "references", "stages", "06-dr-design.md"), "utf8").includes("`split: Key Vault only (swedensouth)`"));
    assert.ok(dr15.includes("`option: paired-failover-split`"));
    assert.ok(dr15.includes('"Point the consumers in germanywestcentral at the Azure Key Vault in swedensouth"'));
    assert.match(dr15, /asks no DR options question and keeps the Key Vault entry/);

    const dr16 = scenario("DR-16");
    assert.match(promptOf(dr16), /This is an unattended run: do not ask me anything\./);
    assert.ok(dr16.includes("`chosen_by: default`") && dr16.includes("`recommended: true`"));
    assert.match(dr16, /names every defaulted type as an open decision of the owner, never as an owner's decision/);
    assert.match(dr16, /section D lists no `dr-choice-gap` for it/);

    const dr17 = scenario("DR-17");
    assert.match(promptOf(dr17), /For the storage account we choose object replication into the DR region/);
    assert.match(dr17, /says that the replica lands in North Europe \(northeurope\) today/);
    assert.match(dr17, /Decommission reduces the GRS redundancy only after the Validate criteria have passed/);

    const dr18 = scenario("DR-18");
    assert.match(dr18, /written with `--extra-type microsoft\.network\/virtualnetworks`/);
    assert.ok(dr18.includes('"No playbook, derived from Learn this run."'));
    assert.match(dr18, /each resting on an `option` entry of the ledger that cites a `D-` id/);
    const { set } = await readPlaybooks(path.join(root, "skills", "azure-dr-assessment", "playbooks"));
    assert.equal(set.byType.has("microsoft.network/virtualnetworks"), false, "no playbook covers the extra type of DR-18");

    for (const id of V3) assert.match(scenario(id), /establishment-guide|dr-establishment-guide\.md/, `${id} judges the guide`);
});
