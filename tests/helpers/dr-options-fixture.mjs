import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeAssessment, serializeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { Ledger } from "../../skills/azure-dr-assessment/scripts/lib/ledger.mjs";
import { parsePlaybook } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { FIXTURE_SOURCE, PLAYBOOK_BODIES, playbookMarkdown, writePlaybookDir } from "./playbook-fixture.mjs";
import { tierSpec } from "./tier-fixture.mjs";
import { patternMarkdown, writePack } from "./pack-fixture.mjs";
import { runScript } from "./run-cli.mjs";

/** The regions of the fixture run: a DR region that is not the primary's pair (the v3 case). */
export const PRIMARY = "swedencentral";
export const DR = "germanywestcentral";
export const PAIR = "swedensouth";
export const TODAY = "2026-11-09";

/** The types of the fixture run, one per path. */
export const WIDGETS = "microsoft.test/widgets";
export const NATIVES = "microsoft.test/natives";
export const GADGETS = "microsoft.example/gadgets";
export const NICS = "microsoft.network/networkinterfaces";

/** The fixture playbook of Plan 1 (test-service: options second-copy and pair-split) and a second one with a native option. */
export const WIDGET_PLAYBOOK = { service: "test-service", title: "Test Service", arm_types: [WIDGETS], slot: "compute" };
export const NATIVE_PLAYBOOK = {
    service: "test-native",
    title: "Test Native",
    arm_types: [NATIVES],
    slot: "data-replication.relational",
    sections: {
        Mechanisms: [
            "### Test native replication",
            "- Replicates: data",
            "- Paired: yes",
            "- Nonpaired: yes",
            "- Failover: customer-managed",
            "- Estimated RPO: 5s (fixture value)",
            "- Estimated RTO: 1h (fixture value)",
            `- Source: ${FIXTURE_SOURCE}`,
        ].join("\n"),
        "Non-paired options": [
            "### geo-replica: Replica in the DR region",
            "- Kind: native",
            "- Target: dr-region",
            "- Uses mechanism: Test native replication",
            "- Estimated RPO: 5s (fixture value)",
            "- Estimated RTO: 1h (fixture value)",
            "- Prerequisites: the service in the DR region.",
            "- Cost notes: a replica; no price.",
            "- Gives up: nothing the fixture names.",
            "- Recommended when: always.",
            `- Source: ${FIXTURE_SOURCE}`,
        ].join("\n"),
        "Test criteria": [
            "### TC-1: The replica is current",
            "- Applies to: geo-replica",
            "- Pass condition: the replication lag stays below the Estimated RPO for 7 days.",
            "- How to measure: the replication lag metric.",
            "- Evidence: the metric export.",
            "- Frequency: monthly",
        ].join("\n"),
    },
};

/** A parsed playbook for a playbookMarkdown spec, as readPlaybooks would return it. */
export function fixturePlaybook(spec = WIDGET_PLAYBOOK) {
    const { playbook, problems } = parsePlaybook(playbookMarkdown(spec), `${spec.service}.md`);
    if (problems.length > 0) throw new Error(`fixture playbook ${spec.service}: ${problems.map((p) => p.message).join("; ")}`);
    return playbook;
}

/** The constraint headings of the fixture playbook of Plan 1. */
export const WIDGET_CONSTRAINTS = PLAYBOOK_BODIES.find(([title]) => title === "Constraints")[1].split("\n").filter((line) => line.startsWith("### ")).map((line) => line.slice(4));

export const docInput = (fields = {}) => ({
    kind: "doc", url: FIXTURE_SOURCE, title: "Reliability in the test service", retrievedAt: "2026-11-09T10:00:00.000Z", status: "Verified",
    supports: "mechanisms and constraints", query: "test service multiregion", tool: "microsoft_docs_fetch", ...fields,
});
const verified = (status, quote) => (status === "Verified" ? { doc: "D-0001", quote } : { doc: null, quote: null });

export const pairInput = ({ paired = false, primaryPair = PAIR, drPair = "germanynorth", status = "Verified", subject = `${PRIMARY}|${DR}` } = {}) => ({
    kind: "region", check: "pair", subject, status, ...verified(status, "Sweden Central | Sweden South"), result: { paired, primaryPair, drPair },
});
export const geographyInput = (region, geography, residency = "ok", status = "Verified") => ({
    kind: "region", check: "geography", subject: region, status, ...verified(status, `${region} | ${geography}`), result: { region, geography, residency },
});
export const mechanismInput = (type, name, cls, status = "Verified") => ({
    kind: "region", check: "mechanism", subject: type, status, class: cls, ...verified(status, `${name} | row`), result: { mechanism: name },
});
export const claimInput = (type, playbook, claim, agrees = true, status = "Verified") => ({
    kind: "region", check: "playbook-claim", subject: type, status, ...verified(status, `Learn on ${claim}`), result: { playbook, claim, agrees },
});
export const optionInput = (type, result, status = "Verified") => ({
    kind: "region", check: "option", subject: type, status, ...verified(status, null),
    result: { title: "An option", usesMechanism: "none", rpo: "unknown", rto: "unknown", slot: "compute", givesUp: "the fixture names nothing", ...result },
});

/** The ledger entries of the fixture run, in this order: D-0001, then R-0001 onwards (see standardInputs). */
export function standardInputs({ learnReachable = true, residency = "ok" } = {}) {
    const status = learnReachable ? "Verified" : "Unverified";
    return [
        docInput(learnReachable ? {} : { status: "Unverified", url: null, retrievedAt: null, tool: "none" }),
        pairInput({ status }),
        geographyInput(PRIMARY, "Sweden", "ok", status),
        geographyInput(DR, "Germany", residency, status),
        geographyInput(PAIR, "Sweden", "ok", status),
        mechanismInput(WIDGETS, "Test geo-replication", "paired-only", status),
        ...WIDGET_CONSTRAINTS.map((claim) => claimInput(WIDGETS, "test-service", claim, true, status)),
        mechanismInput(NATIVES, "Test native replication", "any-pair", status),
        optionInput(GADGETS, { id: "gadget-rebuild", title: "Rebuild from backup in the DR region", kind: "backup-restore", target: "dr-region", rpo: "24h", rto: "8h", givesUp: "recent changes" }, status),
        optionInput(GADGETS, { id: "gadget-copy", title: "Copy to a second gadget", kind: "workaround", target: "dr-region", rpo: "30m", rto: "1h", givesUp: "managed failover" }, "Unverified"),
    ];
}

/** A Ledger built from entry inputs, validated entry by entry as ledger.mjs add-* does. */
export function ledgerFrom(inputs = standardInputs()) {
    const ledger = Ledger.empty();
    for (const input of inputs) ledger.add(input);
    return ledger;
}

/** The resources of the fixture inventory: 3 widgets, 2 network interfaces, 2 natives and 1 gadget. */
export const STANDARD_COUNTS = [[WIDGETS, 3], [NICS, 2], [NATIVES, 2], [GADGETS, 1]];

/** A valid inventory (v2 contracts 7.2) with `count` resources per type. */
export function inventoryFor(counts = STANDARD_COUNTS) {
    const resources = counts.flatMap(([type, count]) => Array.from({ length: count }, (_, i) => {
        const name = `${type.split("/").at(-1)}-${i + 1}`;
        return {
            ref: `ari:${type}!${i + 2}`, name, armType: type, resourceGroup: "rg-checkout", subscription: "sub", subscriptionId: null,
            location: PRIMARY, sku: null, zones: null, tags: {}, fields: {}, droppedFields: [],
        };
    }));
    return {
        schemaVersion: 1,
        source: { kind: "ari-xlsx", file: "ari-export.xlsx", sha256: null, readAt: null, tenantId: null, subscriptions: [] },
        scope: { applied: false, selector: { resourceGroups: [], tag: null, subscriptions: [] }, matched: resources.length, total: resources.length },
        sheets: [],
        summary: [],
        resources,
        omissions: [],
        warnings: [],
    };
}

/** The assessment of the fixture run: checkout, tier 1, swedencentral to germanywestcentral. Fields replace the defaults key by key. */
export function fixtureAssessment(fields = {}) {
    return normalizeAssessment({
        workload: { name: "checkout", environment: "production" },
        inputs: { ari_file: "ari-export.xlsx" },
        regions: { primary: PRIMARY, dr: DR },
        objectives: { tier: 1 },
        ...fields,
    });
}

/** A pattern pack with DR-TIER-001 and, optionally, more pattern specs (patternMarkdown). */
export function writeFixturePack(specs = []) {
    return writePack(Object.fromEntries([tierSpec(), ...specs].map((spec) => [`${spec.id}.md`, patternMarkdown(spec)])));
}

/** A playbook folder with the two fixture playbooks (or the given specs). */
export function writeFixturePlaybooks(specs = [WIDGET_PLAYBOOK, NATIVE_PLAYBOOK]) {
    return writePlaybookDir(Object.fromEntries(specs.map((spec) => [`${spec.service}.md`, playbookMarkdown(spec)])));
}

/**
 * The files of a classify run in a fresh temporary folder: <root>/assessment.yaml, <root>/evidence/inventory.json and
 * <root>/evidence/ledger.json, plus a playbook folder and a pattern pack outside the root. Returns their paths.
 */
export function writeClassifyRun({ assessment = {}, inputs = standardInputs(), counts = STANDARD_COUNTS, playbooks, patterns = [] } = {}) {
    const root = mkdtempSync(path.join(tmpdir(), "dr-options-run-"));
    mkdirSync(path.join(root, "evidence"));
    const file = path.join(root, "assessment.yaml");
    writeFileSync(file, serializeAssessment(fixtureAssessment(assessment)));
    writeFileSync(path.join(root, "evidence", "inventory.json"), `${JSON.stringify(inventoryFor(counts), null, 2)}\n`);
    writeFileSync(path.join(root, "evidence", "ledger.json"), `${JSON.stringify({ schemaVersion: 1, entries: ledgerFrom(inputs).entries }, null, 2)}\n`);
    return {
        root,
        file,
        playbooksDir: writeFixturePlaybooks(playbooks),
        patternsDir: writeFixturePack(patterns),
        optionsFile: path.join(root, "evidence", "dr-options.json"),
    };
}

export const DR_OPTIONS_SCRIPT = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "scripts", "dr-options.mjs");

/**
 * Run dr-options in a mode (classify, record or validate) against a writeClassifyRun result. Classify gets the run's
 * playbook folder and pattern pack; classify and record get --today TODAY.
 */
export function runDrOptions(mode, run, args = []) {
    const folders = mode === "classify" ? ["--playbooks-dir", run.playbooksDir, "--patterns-dir", run.patternsDir] : [];
    const today = mode === "validate" ? [] : ["--today", TODAY];
    return runScript(DR_OPTIONS_SCRIPT, [`--${mode}`, "--assessment", run.file, ...folders, ...today, ...args]);
}
