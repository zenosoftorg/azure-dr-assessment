import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDrOptions } from "../../skills/azure-dr-assessment/scripts/lib/dr-options.mjs";
import { BUILD_ORDER_SLOT, CHAPTERS_SLOT } from "../../skills/azure-dr-assessment/scripts/lib/guide.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { readPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { resolveSlots } from "../../skills/azure-dr-assessment/scripts/lib/resolve.mjs";
import { tierBands } from "../../skills/azure-dr-assessment/scripts/lib/tiers.mjs";
import {
    DR, PAIR, PRIMARY, TODAY, WIDGETS, fixtureAssessment, inventoryFor, ledgerFrom, runDrOptions, standardInputs, writeClassifyRun, writeFixturePack, writeFixturePlaybooks,
} from "./dr-options-fixture.mjs";
import { runScript } from "./run-cli.mjs";

/** A guide template with only the parts the generator touches. */
export const MINI_TEMPLATE = [
    "# DR establishment guide",
    "",
    "## Build order",
    "",
    BUILD_ORDER_SLOT,
    "",
    "## Transition plan",
    "",
    CHAPTERS_SLOT,
    "",
    "## Consolidated test plan",
    "",
    "<!-- dr-guide:test-plan -->",
    "<!-- /dr-guide:test-plan -->",
    "",
].join("\n");

const pack = await loadPack(writeFixturePack());
const { set } = await readPlaybooks(writeFixturePlaybooks(), { isDefault: false });

/** The fixture playbooks (test-service and test-native) by service, as the guide reads them. */
export const PLAYBOOKS = set.byService;

/**
 * evidence/dr-options.json of the fixture run of Plan 2 (contracts 6.2), built by the pure functions: widgets
 * (test-service, compute), network interfaces (no playbook, no option), natives (test-native, Native) and gadgets
 * (Learn-derived options, compute). `choices` are dr_choices entries.
 */
export function fixtureDoc({ choices = [], inputs = standardInputs(), assessment = {} } = {}) {
    const a = fixtureAssessment({ ...assessment, dr_choices: choices });
    return buildDrOptions({
        assessment: a, resources: inventoryFor().resources, entries: ledgerFrom(inputs).entries, playbooks: set, slots: resolveSlots(a, pack).slots,
        bands: tierBands(pack), today: TODAY, generatedAt: "2026-11-09T12:00:00.000Z", playbooksDir: "playbooks", nonDefaultPlaybooks: true,
    });
}

/** A dr_choices entry of the fixture run. */
export const choice = (type, option, chosen_by = "Application owner", recommended = false) => ({ type, option, chosen_by, date: TODAY, recommended });

/**
 * A dr-options.json row of `type` classified with a parsed `playbook`: its options and accept-gap, the first option
 * recommended, and a valid owner choice of `optionId`. Enough for the guide and the runbook, not for dr-options.
 */
export function playbookRow(playbook, type, optionId) {
    const options = [
        ...playbook.options.map((o) => ({
            id: o.id, title: o.title, kind: o.kind, targetRegion: o.kind === "split-region" || o.target === "pair-region" ? PAIR : DR, rpo: o.rpo, rto: o.rto,
            source: "playbook", status: "valid", meetsTier: true, residency: "ok", givesUp: o.givesUp, ledger: [],
        })),
        {
            id: "accept-gap", title: "Accept the gap and record it as an exception", kind: "accept-gap", targetRegion: null, rpo: null, rto: null,
            source: "rule", status: "valid", meetsTier: false, residency: "ok", givesUp: "DR for this service", ledger: [],
        },
    ];
    return {
        type, title: playbook.title, count: 2, slot: playbook.slot, playbook: `${playbook.service} v${playbook.version}`, decidedBy: null, path: options[0].kind,
        verified: true, staleClaims: [], options, recommended: options[0].id, ask: true,
        choice: { option: optionId, chosen_by: "Application owner", date: TODAY, recommended: optionId === options[0].id, status: "valid", problem: null },
    };
}

/** A minimal dr-options.json of the fixture regions holding `types`. */
export const minimalDoc = (types) => ({
    schemaVersion: 1, generatedAt: "2026-11-09T12:00:00.000Z", tier: 1, regions: { primary: PRIMARY, dr: DR, primaryPair: PAIR, paired: false }, types,
});

/**
 * The guide as the model leaves it: every fill marker replaced by `filler`, and one measurable criterion written into
 * each Validate table that the skeleton left empty.
 */
export function fillGuide(text, filler = "Platform engineer") {
    return text
        .replace(/<!-- fill: one row per test criterion[^\n]*-->\n\n(\| Criterion [^\n]*\n\|---[^\n]*)/g, `$1\n| The copy is current | the copy lag stays below the Estimated RPO for 7 days | compare the copy timestamps | the copy log | monthly | ${filler} |`)
        .replace(/<!-- fill:[\s\S]*?-->/g, filler);
}

export const GUIDE_SCRIPT = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "scripts", "establishment-guide.mjs");
export const RUNBOOK_TEMPLATE = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "assets", "templates", "runbook.md");

/**
 * A fixture run of Plan 2 that dr-options has classified and recorded: the owner chose pair-split for the widgets,
 * the rest are defaults. Returns the paths of writeClassifyRun, the guide and a copy of the runbook template.
 */
export async function guideRun({ reply = ["--choice", `${WIDGETS}=pair-split`, "--by", "Application owner"], ...fields } = {}) {
    const run = writeClassifyRun(fields);
    for (const [mode, args] of [["classify", []], ["record", [...reply, "--defaults"]]]) {
        const r = await runDrOptions(mode, run, args);
        if (r.code !== 0) throw new Error(`dr-options --${mode}: ${r.stdout}${r.stderr}`);
    }
    mkdirSync(path.join(run.root, "reports"));
    const runbook = path.join(run.root, "reports", "recovery-runbook.md");
    writeFileSync(runbook, readFileSync(RUNBOOK_TEMPLATE, "utf8"));
    return { ...run, guide: path.join(run.root, "reports", "dr-establishment-guide.md"), runbook };
}

/** Run establishment-guide against a guideRun; --write and --inject-runbook get the run's playbook folder. */
export function runGuide(run, args) {
    const books = args.includes("--write") || args.includes("--inject-runbook") ? ["--playbooks-dir", run.playbooksDir] : [];
    return runScript(GUIDE_SCRIPT, ["--root", run.root, ...args, ...books]);
}
