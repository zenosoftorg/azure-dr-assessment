import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./lib/atomic.mjs";
import { CliError, EXIT, log, runCli } from "./lib/cli.mjs";
import {
    RUNBOOK_MARKERS, TEST_PLAN_MARKERS, checkGuide, guideSkeleton, injectBetween, injectGuideTables, parseGuide, runbookSkeleton,
} from "./lib/guide.mjs";
import { isInsideSkillOrPlugin, playbooksDir, skillRoot } from "./lib/paths.mjs";
import { packDisplayDir } from "./lib/patterns.mjs";
import { formatPlaybookFinding, lintPlaybooks } from "./lib/playbook-lint.mjs";
import { readPlaybooks } from "./lib/playbooks.mjs";
import { isSecretValue } from "./lib/secrets.mjs";

const MODES = ["write", "tables", "check", "inject-runbook"];
const GUIDE = path.join("reports", "dr-establishment-guide.md");
const TEMPLATE = path.join(skillRoot(), "assets", "templates", "dr-establishment-guide.md");

const spec = {
    root: { type: "string", help: "The output folder: the one that holds assessment.yaml and evidence/", required: true },
    write: { type: "boolean", help: "Write reports/dr-establishment-guide.md from the template, one chapter per type in build order (overwrites it)" },
    tables: { type: "boolean", help: "Rebuild the consolidated test plan of the guide from the Validate tables of its chapters" },
    check: { type: "boolean", help: "Check the guide against evidence/dr-options.json and write nothing" },
    "inject-runbook": { type: "string", help: "Runbook to update: the text between its dr-guide:runbook markers becomes one subsection per service" },
    "playbooks-dir": { type: "string", help: "write, inject-runbook: playbook folder (default: the bundled playbooks; DR_PLAYBOOKS_DIR is also honored)" },
};

async function readText(file, what, hint) {
    if (!existsSync(file)) throw new CliError(EXIT.INPUT, `there is no ${what} yet`, [`${file} does not exist`, hint]);
    try {
        return await readFile(file, "utf8");
    } catch (err) {
        throw new CliError(EXIT.INPUT, `cannot read ${file}`, [err.message]);
    }
}

/** evidence/dr-options.json of the run, as dr-options wrote it. */
async function readOptions(root) {
    const file = path.join(root, "evidence", "dr-options.json");
    const text = await readText(file, "evidence/dr-options.json", "classify first: node skills/azure-dr-assessment/scripts/dr-options.mjs --classify --assessment <path>");
    let doc;
    try {
        doc = JSON.parse(text);
    } catch (err) {
        throw new CliError(EXIT.INPUT, `${file} is not valid JSON`, [err.message]);
    }
    if (doc?.schemaVersion !== 1 || !Array.isArray(doc.types)) throw new CliError(EXIT.INPUT, `${file} is not a dr-options.json`, ['expected { "schemaVersion": 1, "types": [...] }']);
    return doc;
}

/** The playbooks by service, from the folder of the flag, DR_PLAYBOOKS_DIR or the bundled one; a folder with lint errors is refused. */
async function loadPlaybooks(flag, today) {
    const books = playbooksDir(process.env, flag ?? null);
    const loaded = await readPlaybooks(books.dir, { isDefault: books.isDefault });
    const errors = lintPlaybooks(loaded, { today }).filter((f) => f.severity === "error");
    if (errors.length > 0) {
        throw new CliError(EXIT.INPUT, `the playbook folder has ${errors.length} error${errors.length === 1 ? "" : "s"}; run lint-playbooks`, errors.map(formatPlaybookFinding));
    }
    return { playbooks: loaded.set.byService, dir: books.dir, isDefault: books.isDefault };
}

/** A line, each of its table cells and each of its ": "-separated segments, so that a pattern anchored at the start of a string is screened where a value starts. */
const pieces = (line) => [line, ...line.split(/(?<!\\)\|/).map((cell) => cell.trim()), ...line.split(": ").map((segment) => segment.trim())];

/**
 * GC-07: every string this script writes is screened before the file is written. `from` and `to` bound the lines it
 * generated; the details name the file and the line, never the text.
 */
function refuseSecrets(text, label, [from, to] = [0, Number.POSITIVE_INFINITY]) {
    const lines = text.split("\n");
    const found = lines.map((line, i) => [line, i]).filter(([line, i]) => i >= from && i <= to && pieces(line).some(isSecretValue)).map(([, i]) => i + 1);
    if (found.length > 0) {
        throw new CliError(EXIT.INPUT, "a string that this script would write looks like a secret, so nothing was written",
            found.map((n) => `${label} line ${n}: looks like a secret (key, token, password or connection string) and must not appear in a guide or runbook`));
    }
}

/** The line range between a marker pair of a text. */
function between(text, [open, close]) {
    const before = (marker) => text.slice(0, text.indexOf(marker)).split("\n").length - 1;
    return [before(open), before(close)];
}

async function write(root, guide, values) {
    const doc = await readOptions(root);
    const books = await loadPlaybooks(values["playbooks-dir"], String(doc.generatedAt ?? "").slice(0, 10) || undefined);
    const template = await readFile(TEMPLATE, "utf8");
    const { text: skeleton, chapters } = guideSkeleton({ doc, playbooks: books.playbooks, template });
    const { text } = injectGuideTables(skeleton);
    refuseSecrets(text, GUIDE);
    const warnings = [];
    if (existsSync(guide)) warnings.push(`${GUIDE} existed and was overwritten: write its text again`);
    if (!books.isDefault) warnings.push(`the playbooks come from ${packDisplayDir(books.dir)}, not the bundled folder: name it in report section C and in the summary`);
    await mkdir(path.dirname(guide), { recursive: true });
    await writeFileAtomic(guide, text);
    log(`wrote ${guide}`);
    for (const warning of warnings) log(`warning: ${warning}`);
    return { guide, chapters, nonDefaultPlaybooks: !books.isDefault, warnings };
}

async function tables(root, guide) {
    await readOptions(root);
    const current = await readText(guide, GUIDE, "write it first: node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root <dir> --write");
    const { text, criteria } = injectGuideTables(current);
    refuseSecrets(text, GUIDE, between(text, TEST_PLAN_MARKERS));
    await writeFileAtomic(guide, text);
    log(`updated ${guide}`);
    return { guide, criteria };
}

const RUNBOOK = path.join("reports", "recovery-runbook.md");
const SECRET_ADVICE = "looks like a secret (key, token, password or connection string); remove it, a guide or runbook names where a secret is kept, never the secret";

/** The lines of a text that look like a secret, each with the heading that holds it (`where` maps a line index to a label or null). */
function secretFindings(text, label, where) {
    return text.split("\n").flatMap((line, i) => {
        // model prose: a connection-string value may also start mid-sentence, so every word is screened too
        if (![...pieces(line), ...line.split(/\s+/)].some(isSecretValue)) return [];
        const at = where(i);
        return [`${label} line ${i + 1}${at ? ` (${at})` : ""}: ${SECRET_ADVICE}`];
    });
}

/** GC-07 (M-2): the model-filled text of the guide and, when it exists, of the runbook, screened per line, cell and segment. */
async function screenFilledText(root, text) {
    const chapters = parseGuide(text);
    const chapterAt = (i) => {
        const chapter = chapters.filter((c) => c.line <= i + 1).at(-1);
        return chapter ? `chapter ${chapter.n}, ${chapter.type}` : null;
    };
    const findings = secretFindings(text, GUIDE, chapterAt);
    const runbookFile = path.join(root, RUNBOOK);
    if (existsSync(runbookFile)) {
        const runbook = await readText(runbookFile, RUNBOOK, "");
        const headings = runbook.split("\n").map((line, i) => [i, /^### (\d+)\. /.exec(line)?.[1] ?? (/^#{1,2} /.test(line) ? "" : null)]).filter(([, n]) => n !== null);
        const subsectionAt = (i) => {
            const heading = headings.filter(([at]) => at <= i).at(-1);
            return heading && heading[1] !== "" ? `subsection ${heading[1]}` : null;
        };
        findings.push(...secretFindings(runbook, RUNBOOK, subsectionAt));
    }
    if (findings.length > 0) throw new CliError(EXIT.INPUT, "the guide or the runbook holds text that looks like a secret", findings);
}

async function check(root, guide) {
    const doc = await readOptions(root);
    const text = await readText(guide, GUIDE, "write it first: node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root <dir> --write");
    await screenFilledText(root, text);
    const problems = checkGuide(text, doc);
    if (problems.length > 0) throw new CliError(EXIT.INPUT, `the guide has ${problems.length} problem${problems.length === 1 ? "" : "s"}`, problems);
    const chapters = parseGuide(text);
    return { valid: true, chapters: chapters.length, criteria: chapters.reduce((sum, c) => sum + (c.parts.find((p) => p.name === "Validate")?.rows.length ?? 0), 0) };
}

async function injectRunbook(root, runbook, values) {
    const doc = await readOptions(root);
    const books = await loadPlaybooks(values["playbooks-dir"], String(doc.generatedAt ?? "").slice(0, 10) || undefined);
    const current = await readText(runbook, "runbook", "copy skills/azure-dr-assessment/assets/templates/runbook.md to reports/recovery-runbook.md first");
    const { text: block, services } = runbookSkeleton({ doc, playbooks: books.playbooks });
    const text = injectBetween(current, RUNBOOK_MARKERS, block, "runbook");
    refuseSecrets(text, path.basename(runbook), between(text, RUNBOOK_MARKERS));
    await writeFileAtomic(runbook, text);
    log(`updated ${runbook}`);
    return { runbook, services };
}

await runCli({
    name: "establishment-guide",
    description: "Write the DR establishment guide skeleton, rebuild its test plan, check it, and write runbook section 3 per service (stage 7)",
    spec,
    async main(values) {
        const modes = MODES.filter((mode) => (mode === "inject-runbook" ? values[mode] !== undefined : values[mode] === true));
        if (modes.length !== 1) throw new CliError(EXIT.USAGE, `choose exactly one mode: ${MODES.map((mode) => `--${mode}`).join(", ")}`);
        const [mode] = modes;
        if ((mode === "tables" || mode === "check") && values["playbooks-dir"] !== undefined) {
            throw new CliError(EXIT.USAGE, "a flag does not belong to this mode", ["--playbooks-dir belongs to --write or --inject-runbook"]);
        }
        const root = path.resolve(values.root);
        const guide = path.join(root, GUIDE);
        const target = mode === "inject-runbook" ? path.resolve(values["inject-runbook"]) : guide;
        if (isInsideSkillOrPlugin(path.dirname(target))) {
            throw new CliError(EXIT.REFUSED, `the ${mode === "inject-runbook" ? "runbook" : "guide"} is inside the skill or plugin directory`, [`${target} would hold customer data`, "keep it below the assessment output root"]);
        }
        if (mode === "write") return write(root, guide, values);
        if (mode === "tables") return tables(root, guide);
        if (mode === "check") return check(root, guide);
        return injectRunbook(root, target, values);
    },
});
