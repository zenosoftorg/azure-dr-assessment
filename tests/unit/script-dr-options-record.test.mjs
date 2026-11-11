import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { DR_OPTIONS_SCRIPT, GADGETS, NICS, TODAY, WIDGETS, runDrOptions, standardInputs, writeClassifyRun } from "../helpers/dr-options-fixture.mjs";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
/** A fixture run that has been classified, so that record and validate have their dr-options.json. */
async function classified(fields) {
    const run = writeClassifyRun(fields);
    const r = await runDrOptions("classify", run);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    return run;
}

test("--record --reply writes the owner's answers to dr_choices and the choice of each row", async () => {
    const run = await classified();
    const r = await runDrOptions("record", run, ["--reply", "TS 2, ga 1", "--by", "Application owner"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(r.json, {
        ok: true, script: "dr-options", assessment: run.file,
        recorded: [{ type: WIDGETS, option: "pair-split", chosen_by: "Application owner" }, { type: GADGETS, option: "gadget-copy", chosen_by: "Application owner" }],
        defaulted: [], refreshed: [], replaced: [], openDecisions: [],
    });
    assert.deepEqual((await readAssessment(run.file)).dr_choices, [
        { type: WIDGETS, option: "pair-split", chosen_by: "Application owner", date: TODAY, recommended: false },
        { type: GADGETS, option: "gadget-copy", chosen_by: "Application owner", date: TODAY, recommended: true },
    ]);
    assert.match(readFileSync(run.file, "utf8"), /^dr_choices:\n {2}- type: microsoft\.test\/widgets\n {4}option: pair-split\n/m);
    assert.deepEqual(readJson(run.optionsFile).types.map((row) => row.choice?.option ?? null), ["pair-split", null, null, "gadget-copy"]);

    const rerun = await runDrOptions("classify", run);
    assert.deepEqual(rerun.json.ask, [NICS]);
});

test("--record --reply accept recommendations leaves the gap-only type to --defaults, which records it as a default", async () => {
    const run = await classified();
    const r = await runDrOptions("record", run, ["--reply", "accept recommendations.", "--by", "Application owner", "--defaults"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual([r.json.recorded.map((c) => c.type), r.json.defaulted, r.json.openDecisions], [[WIDGETS, GADGETS], [NICS], [NICS]]);
    assert.deepEqual((await readAssessment(run.file)).dr_choices.map((c) => [c.type, c.option, c.chosen_by]), [
        [WIDGETS, "second-copy", "Application owner"],
        [GADGETS, "gadget-copy", "Application owner"],
        [NICS, "accept-gap", "default"],
    ]);
    const refused = await runDrOptions("record", run, ["--reply", "NE 1", "--by", "Application owner"]);
    assert.equal(refused.code, 2);
    assert.deepEqual(refused.json.details, ["NE is not a service of the question (TS, GA)"]);
});

test("--record --choice and --defaults in one call: answers first, then the recommendations as open decisions", async () => {
    const run = await classified();
    const r = await runDrOptions("record", run, ["--choice", "Microsoft.Network/networkInterfaces = accept-gap", "--by", "Application owner", "--defaults"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual([r.json.recorded, r.json.defaulted, r.json.openDecisions], [
        [{ type: NICS, option: "accept-gap", chosen_by: "Application owner" }],
        [WIDGETS, GADGETS],
        [WIDGETS, GADGETS],
    ]);
    const choices = (await readAssessment(run.file)).dr_choices;
    assert.deepEqual(choices.map((c) => [c.type, c.option, c.chosen_by, c.recommended]), [
        [NICS, "accept-gap", "Application owner", true],
        [WIDGETS, "second-copy", "default", true],
        [GADGETS, "gadget-copy", "default", true],
    ]);
    const valid = await runDrOptions("validate", run);
    assert.deepEqual(valid.json, { ok: true, script: "dr-options", valid: true, entries: 3, residencyWarnings: [] });
});

test("a rerun refreshes a default whose recommendation changed and replaces an invalid entry", async () => {
    const run = await classified();
    assert.equal((await runDrOptions("record", run, ["--defaults"])).code, 0);
    const moved = writeClassifyRun({ inputs: standardInputs({ residency: "crosses" }) });
    writeFileSync(moved.file, readFileSync(run.file, "utf8").replace("data_residency: null", "data_residency: Data stays in Sweden").replace("option: gadget-copy", "option: gadget-gone"));
    assert.equal((await runDrOptions("classify", moved)).code, 0);
    const invalid = await runDrOptions("validate", moved);
    assert.equal(invalid.code, 2);
    assert.equal(invalid.json.error, "1 dr_choices entry is invalid");
    assert.deepEqual(invalid.json.details, ["microsoft.example/gadgets: gadget-gone is not an option of microsoft.example/gadgets (options: gadget-copy, gadget-rebuild, accept-gap)"]);

    const r = await runDrOptions("record", moved, ["--defaults"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(r.json.refreshed, [{ type: WIDGETS, from: "second-copy", to: "pair-split" }]);
    assert.deepEqual(r.json.replaced, [{ type: GADGETS, option: "accept-gap", problem: "gadget-gone is not an option of microsoft.example/gadgets (options: gadget-copy, gadget-rebuild, accept-gap)" }]);
    assert.deepEqual(r.json.openDecisions, [WIDGETS, NICS, GADGETS]);
    const warned = await runDrOptions("validate", moved);
    assert.equal(warned.code, 0, warned.stdout + warned.stderr);
    assert.deepEqual(warned.json.residencyWarnings, []);

    writeFileSync(moved.file, readFileSync(moved.file, "utf8").replace("option: pair-split", "option: second-copy"));
    const crossing = await runDrOptions("validate", moved);
    assert.deepEqual(crossing.json.residencyWarnings, [{ type: WIDGETS, option: "second-copy", targetRegion: "germanywestcentral" }]);
    assert.match(crossing.stderr, /^warning: microsoft\.test\/widgets: second-copy targets germanywestcentral, which crosses the data residency constraint$/m);
});

test("--record refuses bad answers with exit 2 and writes nothing", async () => {
    const run = await classified();
    const before = readFileSync(run.file, "utf8");
    const reply = await runDrOptions("record", run, ["--reply", "TS 9, XX 1", "--by", "Application owner"]);
    assert.equal(reply.code, 2);
    assert.deepEqual(reply.json.details, ["TS 9: choose a number from 1 to 3", "XX is not a service of the question (TS, GA)"]);
    const choice = await runDrOptions("record", run, ["--choice", "microsoft.test/widgets=third-copy", "--by", "Application owner"]);
    assert.equal(choice.code, 2);
    assert.deepEqual(choice.json.details, ["third-copy is not an option of microsoft.test/widgets (options: second-copy, pair-split, accept-gap)"]);
    const twice = await runDrOptions("record", run, ["--reply", "TS 1", "--choice", "microsoft.test/widgets=pair-split", "--by", "Application owner"]);
    assert.equal(twice.code, 2);
    assert.deepEqual(twice.json.details, ["microsoft.test/widgets is answered twice"]);

    const secret = ["Account", "Key=", "abc123"].join("");
    const leaked = await runDrOptions("record", run, ["--reply", "TS 1", "--by", secret]);
    assert.equal(leaked.code, 2);
    assert.equal(leaked.json.error, "--by looks like a secret, so nothing was written");
    assert.ok(!leaked.stdout.includes(secret) && !leaked.stderr.includes(secret));
    assert.equal(readFileSync(run.file, "utf8"), before);
    assert.deepEqual(readJson(run.optionsFile).types.map((row) => row.choice), [null, null, null, null]);
});

test("--record and --validate need dr-options.json, refuse the plugin folder, and check their flags", async () => {
    const run = writeClassifyRun();
    const missing = await runDrOptions("validate", run);
    assert.equal(missing.code, 2);
    assert.equal(missing.json.error, "there is no evidence/dr-options.json yet");
    assert.equal((await runDrOptions("record", run, ["--defaults"])).code, 2);

    const plugin = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-options-plugin-")));
    mkdirSync(path.join(plugin, ".claude-plugin"));
    writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "azure-dr-assessment" }));
    writeFileSync(path.join(plugin, "assessment.yaml"), readFileSync(run.file, "utf8"));
    const refused = await runDrOptions("record", { ...run, file: path.join(plugin, "assessment.yaml") }, ["--defaults"]);
    assert.equal(refused.code, 4);

    const usage = async (args, error) => {
        const r = await runScript(DR_OPTIONS_SCRIPT, ["--assessment", run.file, ...args]);
        assert.equal(r.code, 1, args.join(" "));
        assert.equal(r.json.error, error);
        return r;
    };
    await usage(["--record"], "--record needs --choice, --reply or --defaults");
    await usage(["--record", "--reply", "TS 1"], "--by is required with --choice or --reply: the role that chose");
    await usage(["--record", "--defaults", "--by", "Application owner"], "--by belongs to --choice or --reply: a default is chosen by nobody");
    await usage(["--record", "--choice", "widgets", "--by", "Owner"], "a --choice is not <armType>=<optionId>");
    await usage(["--classify", "--record"], "choose exactly one mode: --classify, --record, --validate");
    const foreign = await usage(["--validate", "--today", TODAY, "--choice", "a/b=c"], "a flag does not belong to --validate");
    assert.deepEqual(foreign.json.details, ["--choice belongs to --record", "--today belongs to --classify or --record"]);
    const help = await runScript(DR_OPTIONS_SCRIPT, ["--help"]);
    for (const flag of ["--record", "--choice", "--reply", "--by", "--defaults", "--validate"]) assert.ok(help.stdout.includes(flag), flag);
});

test("--record refuses --by default, and a malformed --choice never echoes a secret-like text", async () => {
    const run = await classified();
    const before = readFileSync(run.file, "utf8");
    for (const by of ["default", " Default "]) {
        const r = await runDrOptions("record", run, ["--reply", "TS 1", "--by", by]);
        assert.equal(r.code, 1, by);
        assert.equal(r.json.error, "--by cannot be default: that is the chosen_by of a default");
        assert.deepEqual(r.json.details, ["use --defaults to record the recommendations, or name the role that chose"]);
    }
    const secret = ["Account", "Key=", "abc123"].join("");
    const leaked = await runDrOptions("record", run, ["--choice", "microsoft.test/widgets=pair-split", "--choice", secret, "--by", "Application owner"]);
    assert.equal(leaked.code, 1);
    assert.deepEqual(leaked.json.details, ["--choice 2: expected <armType>=<optionId>, such as microsoft.keyvault/vaults=secondary-vault-sync"]);
    assert.ok(!leaked.stdout.includes(secret) && !leaked.stderr.includes(secret));
    assert.equal(readFileSync(run.file, "utf8"), before);
});

test("--record --defaults with nothing to change leaves assessment.yaml byte for byte as it is, comments included", async () => {
    const run = await classified();
    assert.equal((await runDrOptions("record", run, ["--defaults"])).code, 0);
    const commented = `# kept by the owner\n${readFileSync(run.file, "utf8")}`;
    writeFileSync(run.file, commented);
    const again = await runDrOptions("record", run, ["--defaults"]);
    assert.equal(again.code, 0, again.stdout + again.stderr);
    assert.equal(readFileSync(run.file, "utf8"), commented);
    assert.ok(!again.stderr.includes(`wrote ${run.file}`));
    assert.deepEqual(readJson(run.optionsFile).types.map((row) => row.choice?.chosen_by ?? null), ["default", "default", null, "default"]);
});

test("--record refuses a hand-edited dr_choices value that looks like a secret, without echoing it or writing", async () => {
    const run = await classified();
    assert.equal((await runDrOptions("record", run, ["--defaults"])).code, 0);
    const secret = ["Account", "Key=", "abc123"].join("");
    writeFileSync(run.file, readFileSync(run.file, "utf8").replace("chosen_by: default", `chosen_by: ${secret}`));
    const before = readFileSync(run.file, "utf8");
    const optionsBefore = readFileSync(run.optionsFile, "utf8");
    const r = await runDrOptions("record", run, ["--defaults"]);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.ok(Array.isArray(r.json.details) && r.json.details.length > 0);
    assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret));
    assert.equal(readFileSync(run.file, "utf8"), before);
    assert.equal(readFileSync(run.optionsFile, "utf8"), optionsBefore);
});

test("--record --choice for a type that a pattern decides and the interview never asked exits 2 and writes nothing", async () => {
    const run = await classified({ patterns: [{ id: "DR-TEST-001", slots: ["compute"] }] });
    const before = readFileSync(run.file, "utf8");
    const optionsBefore = readFileSync(run.optionsFile, "utf8");
    assert.deepEqual(readJson(run.optionsFile).types.filter((row) => row.decidedBy !== null).map((row) => [row.type, row.ask]), [[WIDGETS, false], [GADGETS, false]]);
    const r = await runDrOptions("record", run, ["--choice", "microsoft.test/widgets=pair-split", "--by", "Application owner"]);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.deepEqual(r.json.details, ["microsoft.test/widgets is decided by DR-TEST-001 v1; the interview does not override it"]);
    assert.equal(readFileSync(run.file, "utf8"), before);
    assert.equal(readFileSync(run.optionsFile, "utf8"), optionsBefore);
});
