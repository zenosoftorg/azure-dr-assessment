import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MAX_ROWS_PER_SHEET, normalizeAri } from "./lib/ari.mjs";
import { readAssessment } from "./lib/assessment.mjs";
import { writeFileAtomic } from "./lib/atomic.mjs";
import { CliError, EXIT, runCli } from "./lib/cli.mjs";
import { addInventoryFacts } from "./lib/facts.mjs";
import { checkPrimaryRegion, inventoryFromLive, validateInventory, writeInventory } from "./lib/inventory.mjs";
import { Ledger } from "./lib/ledger.mjs";
import { collectInventory } from "./lib/live.mjs";
import { isInsideSkillOrPlugin } from "./lib/paths.mjs";
import { buildCandidates, needsScope } from "./lib/scope.mjs";
import { readWorkbook, XlsxError } from "./lib/xlsx.mjs";

const ALTERNATIVES = "Supported inputs: an .xlsx workbook or a live subscription";
const NO_SCOPE = { resource_groups: [], tag: null, subscriptions: [] };

const spec = {
    assessment: { type: "string", help: "Path to assessment.yaml; the evidence folder is created beside it" },
    ari: { type: "string", help: "ARI .xlsx workbook (overrides inputs.ari_file)" },
    "summary-only": { type: "boolean", help: "Print the summary and the candidate workloads and write nothing" },
    out: { type: "string", help: "Evidence folder (default: evidence/ beside assessment.yaml)" },
    "max-rows-per-sheet": { type: "string", help: `Rows read per sheet (default ${DEFAULT_MAX_ROWS_PER_SHEET})` },
};

/**
 * A path relative to the working directory when it is below it, else absolute, with forward slashes. A path that is
 * not below the working directory as written is compared again through symlinks, because the working directory is
 * always the physical one (macOS reports /private/var for a path the caller wrote as /var).
 */
function shown(file) {
    const absolute = path.resolve(file);
    const below = (from, to) => {
        const relative = path.relative(from, to);
        return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : null;
    };
    const physical = (target) => {
        try {
            return realpathSync(target);
        } catch {
            return target;
        }
    };
    const relative = below(process.cwd(), absolute) ?? below(physical(process.cwd()), physical(absolute));
    return (relative ?? absolute).split(path.sep).join("/");
}

async function ariInventory(file, { maxRows, scope }) {
    const absolute = path.resolve(file);
    let buffer;
    try {
        buffer = await readFile(absolute);
    } catch (err) {
        throw new CliError(EXIT.INPUT, `cannot read ${file}`, [err.message, ALTERNATIVES]);
    }
    let workbook;
    try {
        workbook = readWorkbook(buffer);
    } catch (err) {
        if (err instanceof XlsxError) throw new CliError(EXIT.INPUT, `${shown(absolute)} cannot be read`, [err.message]);
        throw err;
    }
    const inventory = normalizeAri(workbook, { maxRowsPerSheet: maxRows, scope });
    Object.assign(inventory.source, { file: shown(absolute), sha256: createHash("sha256").update(buffer).digest("hex"), readAt: new Date().toISOString() });
    return inventory;
}

function parseMaxRows(text) {
    if (text === undefined) return DEFAULT_MAX_ROWS_PER_SHEET;
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1) throw new CliError(EXIT.USAGE, "--max-rows-per-sheet must be a whole number of at least 1");
    return n;
}

/** How many entries the ledger that a new ingest replaces holds: 0 when there is none, null when it cannot be read. */
async function entriesToReplace(file) {
    if (!existsSync(file)) return 0;
    try {
        return (await Ledger.load(file)).entries.length;
    } catch {
        return null;
    }
}

await runCli({
    name: "ingest",
    description: "Read an ARI workbook or collect a live inventory, then write evidence/inventory.json and evidence/ledger.json",
    spec,
    async main(values) {
        const summaryOnly = values["summary-only"] === true;
        const maxRows = parseMaxRows(values["max-rows-per-sheet"]);
        if (!values.assessment && !(summaryOnly && values.ari)) {
            throw new CliError(EXIT.USAGE, summaryOnly ? "--summary-only needs --ari <file> or --assessment <path>" : "a full ingest needs --assessment <path>");
        }
        const assessmentFile = values.assessment ? path.resolve(values.assessment) : null;
        const assessment = assessmentFile ? await readAssessment(assessmentFile) : null;
        const ariFile = values.ari ?? assessment?.inputs.ari_file ?? null;
        const subscriptionIds = assessment?.inputs.live.subscription_ids ?? [];
        if (!ariFile && subscriptionIds.length === 0) {
            throw new CliError(EXIT.INPUT, "there is no inventory source", [
                "set inputs.ari_file or inputs.live.subscription_ids in assessment.yaml, or pass --ari <file>",
                ALTERNATIVES,
            ]);
        }

        const root = assessmentFile ? path.dirname(assessmentFile) : null;
        const evidence = summaryOnly ? null : values.out ? path.resolve(values.out) : path.join(root, "evidence");
        if (evidence && isInsideSkillOrPlugin(evidence)) {
            throw new CliError(EXIT.REFUSED, "the evidence folder is inside the skill or plugin directory", [`${evidence} would hold customer data`, "use an assessment.yaml or --out outside the plugin"]);
        }

        const scope = summaryOnly ? NO_SCOPE : assessment.scope;
        const inventory = ariFile
            ? await ariInventory(ariFile, { maxRows, scope })
            : inventoryFromLive(await collectInventory({ subscriptionIds, tenantId: assessment.inputs.live.tenant_id }), { scope });
        if (ariFile && subscriptionIds.length > 0) {
            inventory.warnings.push("both an ARI file and live subscriptions are set: the ARI file is the inventory of record and the subscriptions are used only for DR-region fit checks");
        }

        if (!summaryOnly && path.resolve(assessment.outputs.directory) !== root) {
            inventory.warnings.push(`outputs.directory ${assessment.outputs.directory} does not match the folder of assessment.yaml; the evidence is written beside the assessment file`);
        }
        const candidates = buildCandidates(inventory.resources);
        const summary = {
            mode: summaryOnly ? "summary" : "full",
            source: { kind: inventory.source.kind, file: inventory.source.file, sha256: inventory.source.sha256 },
            sheets: {
                total: inventory.sheets.length,
                assessed: inventory.sheets.filter((sheet) => sheet.assessed).length,
                omitted: inventory.sheets.filter((sheet) => !sheet.assessed).length,
            },
            resources: { total: inventory.scope.total, inScope: inventory.scope.matched },
            candidates,
            needsScope: !inventory.scope.applied && needsScope(candidates),
            facts: 0,
            outputs: [],
            warnings: inventory.warnings,
            scope: { applied: inventory.scope.applied, matched: inventory.scope.matched, total: inventory.scope.total },
            regionCheck: checkPrimaryRegion(inventory.resources, assessment?.regions.primary ?? null),
            omittedSheets: inventory.sheets.filter((sheet) => !sheet.assessed).map(({ name, kind, reason }) => ({ name, kind, reason })),
        };
        if (summaryOnly) return summary;

        const validation = validateInventory(inventory);
        if (!validation.ok) throw new Error(`internal: the inventory failed validation: ${validation.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
        const ledger = Ledger.empty();
        summary.facts = addInventoryFacts(ledger, inventory);

        const ledgerFile = path.join(evidence, "ledger.json");
        const replaced = await entriesToReplace(ledgerFile);
        if (replaced !== 0) {
            summary.warnings.push(
                `replaced the ledger of an earlier run (${replaced === null ? "it could not be read" : `${replaced} entries`}): the F- ids are numbered again and its documentation and region entries are gone; write every *.spec.json again`,
            );
        }

        await mkdir(evidence, { recursive: true });
        await writeInventory(path.join(evidence, "inventory.json"), inventory);
        await ledger.save(ledgerFile);
        await writeFileAtomic(path.join(evidence, ".gitignore"), "*\n!.gitignore\n");
        summary.outputs = ["inventory.json", "ledger.json", ".gitignore"].map((name) => shown(path.join(evidence, name)));
        return summary;
    },
});
