import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readAssessment, serializeAssessment } from "./lib/assessment.mjs";
import { writeFileAtomic } from "./lib/atomic.mjs";
import { CliError, EXIT, log, runCli } from "./lib/cli.mjs";
import { applyChoices, buildDrOptions, parseReply, validateChoices, withChoices } from "./lib/dr-options.mjs";
import { readInventory } from "./lib/inventory.mjs";
import { Ledger } from "./lib/ledger.mjs";
import { formatFinding, lintPack } from "./lib/pattern-lint.mjs";
import { isInsideSkillOrPlugin, patternsDir, playbooksDir } from "./lib/paths.mjs";
import { formatPlaybookFinding, lintPlaybooks } from "./lib/playbook-lint.mjs";
import { isIsoDate, readPlaybooks } from "./lib/playbooks.mjs";
import { packDisplayDir, readPack } from "./lib/patterns.mjs";
import { resolveSlots } from "./lib/resolve.mjs";
import { isSecretValue, secretPaths } from "./lib/secrets.mjs";
import { tierBands } from "./lib/tiers.mjs";

const MODES = ["classify", "record", "validate"];
/** The flags that only one mode takes. */
const MODE_FLAGS = {
    "playbooks-dir": "classify", "patterns-dir": "classify", "ask-type": "classify",
    choice: "record", reply: "record", by: "record", defaults: "record",
};
const CHOICE = /^([a-z0-9.]+\/[a-z0-9./]+)=([a-z0-9]+(?:-[a-z0-9]+)*)$/;

const spec = {
    classify: { type: "boolean", help: "Classify every in-scope type and write evidence/dr-options.json with the question" },
    assessment: { type: "string", help: "assessment.yaml of the run; the evidence is read from evidence/ next to it", required: true },
    "playbooks-dir": { type: "string", help: "classify: playbook folder (default: the bundled playbooks; DR_PLAYBOOKS_DIR is also honored)" },
    "patterns-dir": { type: "string", help: "classify: pattern pack folder (default: the bundled pack; DR_PATTERNS_DIR is also honored)" },
    "ask-type": { type: "string", multiple: true, help: "classify: ask about this ARM type although a pattern or override decides its slot, because Azure reality vetoes it" },
    today: { type: "string", help: "classify, record: the date for the 90-day playbook age and for recorded entries, as YYYY-MM-DD (default: today in UTC)" },
    record: { type: "boolean", help: "Record the owner's choices and the defaults in dr_choices of assessment.yaml" },
    choice: { type: "string", multiple: true, help: "record: an owner's choice as <armType>=<optionId>" },
    reply: { type: "string", help: "record: the owner's reply to the question, such as \"KV 1, SA 2\" or \"accept recommendations\"" },
    by: { type: "string", help: "record: the role that chose (required with --choice or --reply)" },
    defaults: { type: "boolean", help: "record: write the recommendation as chosen_by default for every asked type without a valid entry" },
    validate: { type: "boolean", help: "Check dr_choices against evidence/dr-options.json and write nothing" },
};

/** The evidence file of the run, or exit 2 with what to run first. */
function evidence(root, name, hint) {
    const file = path.join(root, "evidence", name);
    if (!existsSync(file)) throw new CliError(EXIT.INPUT, `there is no evidence/${name} yet`, [`${file} does not exist`, hint]);
    return file;
}

async function readJson(file) {
    try {
        return JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
        throw new CliError(EXIT.INPUT, `cannot read ${file}`, [err.message]);
    }
}

/** dr-options.json of the run, as --classify wrote it. */
async function readOptions(root) {
    const file = evidence(root, "dr-options.json", "classify first: node skills/azure-dr-assessment/scripts/dr-options.mjs --classify --assessment <path>");
    const doc = await readJson(file);
    if (doc?.schemaVersion !== 1 || !Array.isArray(doc.types)) throw new CliError(EXIT.INPUT, `${file} is not a dr-options.json`, ['expected { "schemaVersion": 1, "types": [...] }']);
    return { file, doc };
}

async function validate(assessmentFile) {
    const assessment = await readAssessment(assessmentFile);
    const { doc } = await readOptions(path.dirname(assessmentFile));
    const { problems, residencyWarnings } = validateChoices(assessment.dr_choices, doc);
    if (problems.length > 0) {
        throw new CliError(EXIT.INPUT, `${problems.length} dr_choices entr${problems.length === 1 ? "y is" : "ies are"} invalid`, problems.map((p) => `${p.type}: ${p.problem}`));
    }
    for (const w of residencyWarnings) log(`warning: ${w.type}: ${w.option} targets ${w.targetRegion}, which crosses the data residency constraint`);
    return { valid: true, entries: assessment.dr_choices.length, residencyWarnings };
}

async function record(values, assessmentFile, today) {
    const answers = values.choice !== undefined || values.reply !== undefined;
    if (!answers && values.defaults !== true) throw new CliError(EXIT.USAGE, "--record needs --choice, --reply or --defaults");
    if (answers && values.by === undefined) throw new CliError(EXIT.USAGE, "--by is required with --choice or --reply: the role that chose");
    if (!answers && values.by !== undefined) throw new CliError(EXIT.USAGE, "--by belongs to --choice or --reply: a default is chosen by nobody");
    const by = values.by?.trim();
    if (answers && !by) throw new CliError(EXIT.USAGE, "--by must name a role");
    if (by?.toLowerCase() === "default") throw new CliError(EXIT.USAGE, "--by cannot be default: that is the chosen_by of a default", ["use --defaults to record the recommendations, or name the role that chose"]);
    if (isSecretValue(by)) throw new CliError(EXIT.INPUT, "--by looks like a secret, so nothing was written", ["--by: give a role such as Application owner, never a credential"]);
    const choiceFlags = (values.choice ?? []).map((text) => [text, CHOICE.exec(text.trim().toLowerCase().replace(/\s*=\s*/, "="))]);
    const malformed = choiceFlags.flatMap(([text, match], i) => (match ? [] : [`--choice ${isSecretValue(text) ? i + 1 : text}: expected <armType>=<optionId>, such as microsoft.keyvault/vaults=secondary-vault-sync`]));
    if (malformed.length > 0) throw new CliError(EXIT.USAGE, "a --choice is not <armType>=<optionId>", malformed);
    if (isInsideSkillOrPlugin(path.dirname(assessmentFile))) {
        throw new CliError(EXIT.REFUSED, "the assessment is inside the skill or plugin directory", [`${assessmentFile} is inside the azure-dr-assessment skill or plugin`]);
    }

    const assessment = await readAssessment(assessmentFile);
    const { file: optionsFile, doc } = await readOptions(path.dirname(assessmentFile));
    const picks = [
        ...(values.reply !== undefined ? parseReply(values.reply, doc.types) : []),
        ...choiceFlags.map(([, match]) => ({ type: match[1], option: match[2] })),
    ];
    const result = applyChoices({ choices: assessment.dr_choices, doc, picks, by, today, defaults: values.defaults === true });
    const secrets = secretPaths(result.choices, "dr_choices");
    if (secrets.length > 0) throw new CliError(EXIT.INPUT, "a dr_choices value looks like a secret, so nothing was written", secrets);

    if (JSON.stringify(result.choices) !== JSON.stringify(assessment.dr_choices)) {
        await writeFileAtomic(assessmentFile, serializeAssessment({ ...assessment, dr_choices: result.choices }));
        log(`wrote ${assessmentFile}`);
    }
    await writeFileAtomic(optionsFile, `${JSON.stringify(withChoices(doc, result.choices), null, 2)}\n`);
    log(`updated ${optionsFile}`);
    return {
        assessment: assessmentFile,
        recorded: result.recorded,
        defaulted: result.defaulted,
        refreshed: result.refreshed,
        replaced: result.replaced,
        openDecisions: result.openDecisions,
    };
}

async function classify(values, assessmentFile, today) {
    const root = path.dirname(assessmentFile);
    const out = path.join(root, "evidence", "dr-options.json");
    if (isInsideSkillOrPlugin(path.dirname(out))) {
        throw new CliError(EXIT.REFUSED, "the output folder is inside the skill or plugin directory", [`${out} is inside the azure-dr-assessment skill or plugin`]);
    }
    const assessment = await readAssessment(assessmentFile);
    if (assessment.objectives.tier === null) {
        throw new CliError(EXIT.INPUT, "the tier is not recorded yet", ["objectives.tier is null: stage 2 asks the tier question first"]);
    }
    if (!assessment.regions.primary || !assessment.regions.dr) {
        throw new CliError(EXIT.INPUT, "the regions are not recorded yet", ["regions.primary and regions.dr must both be set before stage 5"]);
    }
    const inventory = await readInventory(evidence(root, "inventory.json", "run ingest first: node skills/azure-dr-assessment/scripts/ingest.mjs --assessment <path>"));
    const ledger = await Ledger.load(evidence(root, "ledger.json", "record the stage 5 entries first: node skills/azure-dr-assessment/scripts/ledger.mjs add-region ..."));

    const books = playbooksDir(process.env, values["playbooks-dir"] ?? null);
    const loaded = await readPlaybooks(books.dir, { isDefault: books.isDefault });
    const bookErrors = lintPlaybooks(loaded, { today }).filter((f) => f.severity === "error");
    if (bookErrors.length > 0) {
        throw new CliError(EXIT.INPUT, `the playbook folder has ${bookErrors.length} error${bookErrors.length === 1 ? "" : "s"}; run lint-playbooks`, bookErrors.map(formatPlaybookFinding));
    }
    const patterns = patternsDir(process.env, values["patterns-dir"] ?? null);
    const pack = await readPack(patterns.dir, { isDefault: patterns.isDefault });
    const blocking = lintPack(pack).filter((f) => f.severity === "error" && f.rule !== "slot-collision");
    if (blocking.length > 0) {
        throw new CliError(EXIT.INPUT, `the pattern pack has ${blocking.length} error${blocking.length === 1 ? "" : "s"}; run lint-patterns`, blocking.map(formatFinding));
    }
    const bands = tierBands(pack.pack);
    if (bands.length === 0) throw new CliError(EXIT.INPUT, "the pattern pack has no DR-TIER-001, so the tier bands are unknown");

    const doc = buildDrOptions({
        assessment,
        resources: inventory.resources,
        entries: ledger.entries,
        playbooks: loaded.set,
        slots: resolveSlots(assessment, pack.pack).slots,
        bands,
        askTypes: (values["ask-type"] ?? []).map((type) => type.trim().toLowerCase()),
        today,
        generatedAt: new Date().toISOString(),
        assessmentName: path.basename(assessmentFile),
        playbooksDir: packDisplayDir(books.dir),
        nonDefaultPlaybooks: !books.isDefault,
    });
    await mkdir(path.dirname(out), { recursive: true });
    await writeFileAtomic(out, `${JSON.stringify(doc, null, 2)}\n`);
    log(`wrote ${out}`);
    for (const warning of doc.warnings) log(`warning: ${warning}`);
    return {
        out,
        tier: doc.tier,
        paired: doc.regions.paired,
        types: doc.types.length,
        native: doc.types.filter((row) => row.path === "native" && row.verified).length,
        ask: doc.types.filter((row) => row.ask).map((row) => row.type),
        question: doc.question,
        staleClaims: doc.types.reduce((sum, row) => sum + row.staleClaims.length, 0),
        stalePlaybooks: [...new Set(doc.types.filter((row) => row.playbookStale).map((row) => row.playbook.split(" ")[0]))],
        nonDefaultPlaybooks: doc.nonDefaultPlaybooks,
        warnings: doc.warnings,
    };
}

await runCli({
    name: "dr-options",
    description: "Classify the in-scope services into DR paths and write the DR options question (stage 5); record and validate the owner's choices (stage 5b)",
    spec,
    async main(values) {
        const modes = MODES.filter((mode) => values[mode] === true);
        if (modes.length !== 1) throw new CliError(EXIT.USAGE, `choose exactly one mode: ${MODES.map((mode) => `--${mode}`).join(", ")}`);
        const [mode] = modes;
        const foreign = Object.entries(MODE_FLAGS).filter(([flag, owner]) => owner !== mode && values[flag] !== undefined).map(([flag, owner]) => `--${flag} belongs to --${owner}`);
        if (mode === "validate" && values.today !== undefined) foreign.push("--today belongs to --classify or --record");
        if (foreign.length > 0) throw new CliError(EXIT.USAGE, `a flag does not belong to --${mode}`, foreign);
        const today = values.today ?? new Date().toISOString().slice(0, 10);
        if (!isIsoDate(today)) throw new CliError(EXIT.USAGE, "--today must be a date as YYYY-MM-DD");
        const assessmentFile = path.resolve(values.assessment);
        if (mode === "record") return record(values, assessmentFile, today);
        if (mode === "validate") return validate(assessmentFile);
        return classify(values, assessmentFile, today);
    },
});
