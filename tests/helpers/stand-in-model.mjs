import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeAriWorkbook } from "./ari-fixture.mjs";
import { runScript } from "./run-cli.mjs";

const repo = path.resolve(import.meta.dirname, "..", "..");
const skill = path.join(repo, "skills", "azure-dr-assessment");
const templates = path.join(skill, "assets", "templates");
const LEARN = "https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support";
/** The Azure pairs of the regions the golden run uses, as stage 5 records them in the pair entry. */
const PAIRS = { westeurope: "northeurope", swedencentral: "swedensouth" };
const TODAY = "2026-11-09";

export const scriptPath = (name) => path.join(skill, "scripts", `${name}.mjs`);

/** A decision that follows its candidate, which is the only kind that `resolve-patterns --validate` accepts. */
function decide(resolution, supported) {
    const slots = resolution.slots.map((slot) => {
        const { candidate } = slot;
        const base = { status: "Resolved", azureReality: "no veto found in this run", ledger: supported[slot.slot] ?? [], alternative: null };
        if (candidate.source === "pattern") {
            return { ...slot, decision: { ...base, text: `Apply ${candidate.pattern}`, source: "pattern", ref: `${candidate.pattern} v${candidate.version}` } };
        }
        if (candidate.source === "override") {
            return { ...slot, decision: { ...base, text: `Apply the override: ${candidate.alternative}`, source: "override", ref: `Override #${candidate.overrideIndex} of ${candidate.pattern}` } };
        }
        if (slot.slot === "secrets-keys") {
            return { ...slot, decision: { ...base, text: "microsoft.keyvault/vaults: paired-failover-split, chosen by the application owner", source: "playbook", ref: "playbook key-vault v1" } };
        }
        return { ...slot, decision: { ...base, text: "Use the documented default", source: "learn", ref: null } };
    });
    return { ...resolution, slots };
}

/** Replace every fill instruction of a template with one sentence, as the model replaces them with the section. */
const fill = (text) => text.replace(/<!-- fill:[\s\S]*?-->/g, "Stand-in text for this section.");
/** The guide as the model fills it: every fill instruction replaced, and one criterion written into each Validate table that has none. */
const fillGuide = (text) => fill(text.replace(
    /<!-- fill: one row per test criterion[^\n]*-->\n\n(\| Criterion [^\n]*\n\|---[^\n]*)/g,
    "$1\n| Stand-in criterion | Stand-in pass condition | Stand-in measurement | Stand-in evidence | Every drill | Stand-in role |",
));

/**
 * The whole skill, with code standing in for the model. The model's judgments (the diagram specs, the decisions, the
 * story data, the section text, the owner's reply to the DR options question) are made in the simplest valid way, and
 * every other step calls the real script with the flags that the stage references give. The run is offline, so every
 * documentation entry is Unverified. The playbooks are a copy of the bundled key-vault playbook only, so the run does not
 * change when more playbooks are added: Key Vault takes the split-region option (reply "KV 2"), the storage account the
 * Learn-derived object replication (reply "SA 1"), and every other type the default.
 *
 * Presentation builds are allowed to refuse (an empty icon library), so their results are returned, never asserted.
 */
export async function runPipeline({ iconRoot, env = {}, tier = 1, primary = "westeurope", dr = "swedencentral" }) {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-e2e-")));
    const out = path.join("dr-assessment", "checkout");
    const root = path.join(cwd, out);
    const rel = (...parts) => path.join(out, ...parts);
    const ledger = rel("evidence", "ledger.json");
    const assessment = rel("assessment.yaml");
    const run = (name, args) => runScript(scriptPath(name), args, { cwd, env });
    const playbooks = mkdtempSync(path.join(tmpdir(), "dr-e2e-playbooks-"));
    copyFileSync(path.join(skill, "playbooks", "key-vault.md"), path.join(playbooks, "key-vault.md"));
    const ok = async (name, args) => {
        const result = await run(name, args);
        assert.equal(result.code, 0, `${name} ${args.join(" ")}: ${result.stdout}${result.stderr}`);
        return result.json;
    };
    const write = (file, content) => {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
    };

    // Stage 1: preflight says what degrades and never blocks.
    const preflight = await ok("preflight", ["--offline", "--icon-root", iconRoot]);

    // Stages 2 and 3: intake closes the gates and writes assessment.yaml, ingest reads the workbook.
    writeFileSync(path.join(cwd, "ari-export.xlsx"), makeAriWorkbook());
    const intake = await ok("intake", [
        "--assessment", assessment, "--app", "checkout", "--environment", "production", "--tier", String(tier),
        "--primary", primary, "--dr", dr, "--ari", "ari-export.xlsx", "--scope-resource-group", "rg-checkout",
    ]);
    const ingest = await ok("ingest", ["--assessment", assessment]);
    const { resources } = await ok("resources", ["--assessment", assessment]);
    const factOf = (name) => resources.find((resource) => resource.name === name).id;
    const owner = await ok("ledger", [
        "add-fact", "--ledger", ledger, "--strength", "Inferred", "--subject", "web-checkout", "--claim", "web-checkout calls orders-db",
        "--basis", "owner statement", "--source-type", "owner",
    ]);

    // Stage 4: the as-is diagram and presentation 1.
    const asIs = "checkout-current-state";
    write(path.join("architectures", `${asIs}.spec.json`), {
        schemaVersion: 1, kind: "current-state", id: asIs, title: `checkout · current state (${primary})`, direction: "LR",
        groups: [{ key: "rg", label: "rg-checkout", parent: null, style: "primary", evidence: [resources[0].id], annotation: "" }],
        nodes: resources.map((resource) => ({
            key: resource.name, label: resource.name, sublabel: resource.sku ?? "", armType: resource.armType, icon: null, group: "rg",
            evidence: [resource.id], decisions: [], annotation: "",
        })),
        edges: [{ from: "web-checkout", to: "orders-db", label: "SQL", kind: "inferred", basis: "owner statement", evidence: [owner.id], mechanism: null, arrow: "forward", annotation: "" }],
    });
    const asIsDiagram = await ok("build-diagram", ["--spec", rel("architectures", `${asIs}.spec.json`), "--ledger", ledger, "--icon-root", iconRoot]);
    mkdirSync(path.join(root, "presentations"), { recursive: true });
    copyFileSync(path.join(templates, "story.current-state.mjs"), path.join(root, "presentations", `${asIs}.story.mjs`));
    write(path.join("presentations", `${asIs}.story-data.json`), {
        schemaVersion: 1,
        cover: { title: "checkout · current state", blurb: "What the inventory shows today, what was inferred and what is not known." },
        regionMismatch: null,
        unknowns: { title: "What we do not know", md: ingest.omittedSheets.map((sheet) => `- Sheet **${sheet.name}** was not assessed: ${sheet.reason}`).join("\n") },
        groups: [{ group: "rg-checkout", md: `${ingest.resources.inScope} resources were found in rg-checkout.`, nodes: ["web-checkout", "orders-db"], edges: [["web-checkout", "orders-db"]] }],
    });
    const asIsPresentation = await run("present", ["--story", rel("presentations", `${asIs}.story.mjs`), "--icon-root", iconRoot]);

    // Stage 5: the region analysis. The run is offline, so the page was not read and every entry is Unverified.
    const regions = await ok("region-services", ["--assessment", assessment]);
    const doc = await ok("ledger", ["add-doc", "--ledger", ledger, "--url", LEARN, "--title", "Azure regions with multiregion support", "--status", "Unverified", "--supports", "pair status and mechanism classes", "--tool", "none"]);
    const primaryPair = PAIRS[primary] ?? null;
    const pair = await ok("ledger", [
        "add-region", "--ledger", ledger, "--check", "pair", "--subject", `${primary}|${dr}`, "--status", "Unverified", "--doc", doc.id,
        "--result", JSON.stringify({ paired: false, primaryPair, drPair: PAIRS[dr] ?? null }),
    ]);
    const sql = await ok("ledger", [
        "add-region", "--ledger", ledger, "--check", "mechanism", "--subject", "microsoft.sql/servers/databases", "--class", "any-pair", "--status", "Unverified",
        "--doc", doc.id, "--quote", "SQL Database active geo-replication", "--result", JSON.stringify({ mechanism: "active geo-replication" }),
    ]);
    // Step 4a: the storage account has no playbook here, so its option comes from Learn.
    await ok("ledger", [
        "add-region", "--ledger", ledger, "--check", "option", "--subject", "microsoft.storage/storageaccounts", "--status", "Unverified", "--doc", doc.id,
        "--result", JSON.stringify({
            id: "object-replication", title: "Object replication to an account in the DR region", kind: "workaround", target: "dr-region", usesMechanism: "none",
            rpo: "unknown", rto: "unknown", slot: "data-replication.storage", givesUp: "the replication of file shares and of blobs older than the policy",
        }),
    ]);
    const books = ["--playbooks-dir", playbooks];
    const options = await ok("dr-options", ["--classify", "--assessment", assessment, ...books, "--today", TODAY]);

    // Stage 5b: the owner answers the question, the rest are recorded as defaults.
    const choices = await ok("dr-options", ["--record", "--assessment", assessment, "--reply", "KV 2, SA 1", "--by", "Application owner", "--defaults", "--today", TODAY]);
    const choicesCheck = await ok("dr-options", ["--validate", "--assessment", assessment]);

    // Stage 6: one decision per slot, following the candidate, then the DR diagram and presentation 2.
    await ok("resolve-patterns", ["--assessment", assessment]);
    const resolutionFile = path.join("evidence", "pattern-resolution.json");
    const candidates = JSON.parse(readFileSync(path.join(root, resolutionFile), "utf8"));
    write(resolutionFile, decide(candidates, { "data-replication.relational": [sql.id, doc.id] }));
    const validation = await ok("resolve-patterns", ["--validate", rel(resolutionFile)]);

    const proposed = "checkout-proposed-dr";
    const primaryGroup = `Primary · ${primary}`;
    const drGroup = `DR · ${dr}`;
    const splitGroup = `split: Azure Key Vault only (${primaryPair})`;
    write(path.join("architectures", `${proposed}.spec.json`), {
        schemaVersion: 1, kind: "proposed-dr", id: proposed, title: `checkout · proposed DR (${primary} to ${dr})`, direction: "LR",
        groups: [
            { key: "onprem", label: "On-prem", parent: null, style: "onprem", evidence: [], annotation: "The company DNS is authoritative for the application's names." },
            { key: "primary", label: primaryGroup, parent: null, style: "primary", evidence: [factOf("web-checkout")], annotation: "" },
            { key: "dr", label: drGroup, parent: null, style: "dr", evidence: [], annotation: `${dr} is not the pair of ${primary}.` },
            { key: "split", label: splitGroup, parent: null, style: "split", evidence: [pair.id], annotation: `Residency: ok, no data residency constraint. The vault fails over to ${primaryPair}, the pair of ${primary}.` },
        ],
        nodes: [
            { key: "dns", label: "On-prem DNS", sublabel: "authoritative record", armType: null, icon: null, group: "onprem", evidence: [], decisions: ["traffic-dns"], annotation: "" },
            { key: "web", label: "web-checkout", sublabel: "App Service · P1v3", armType: "microsoft.web/sites", icon: null, group: "primary", evidence: [factOf("web-checkout")], decisions: [], annotation: "" },
            { key: "db", label: "orders-db", sublabel: "SQL Database · Standard", armType: "microsoft.sql/servers/databases", icon: null, group: "primary", evidence: [factOf("orders-db")], decisions: ["data-replication.relational"], annotation: "" },
            { key: "web-dr", label: "web-checkout (DR)", sublabel: "App Service · P1v3 (warm)", armType: "microsoft.web/sites", icon: null, group: "dr", evidence: [factOf("web-checkout")], decisions: ["compute"], annotation: "Same plan and size as the primary." },
            { key: "db-dr", label: "orders-db replica", sublabel: "SQL Database · Standard", armType: "microsoft.sql/servers/databases", icon: null, group: "dr", evidence: [sql.id, doc.id], decisions: ["data-replication.relational"], annotation: "" },
            { key: "kv", label: "kv-checkout", sublabel: "Key Vault · paired failover", armType: "microsoft.keyvault/vaults", icon: null, group: "split", evidence: [factOf("kv-checkout")], decisions: ["secrets-keys"], annotation: "" },
        ],
        edges: [
            { from: "dns", to: "web", label: "Record to primary", kind: "traffic", evidence: [], decisions: ["traffic-dns"], mechanism: "the on-prem record points to the primary entry point", arrow: "forward", annotation: "" },
            { from: "dns", to: "web-dr", label: "Change on-prem DNS record", kind: "failover", evidence: [], decisions: ["traffic-dns"], mechanism: "on-prem record change at failover; the TTL wait counts toward RTO", arrow: "forward", annotation: "" },
            { from: "web", to: "db", label: "SQL", kind: "dependency", evidence: [owner.id], decisions: [], mechanism: "application connection", arrow: "forward", annotation: "" },
            { from: "db", to: "db-dr", label: "Async geo-replication", kind: "replication", evidence: [sql.id, doc.id], decisions: ["data-replication.relational"], mechanism: "SQL Database active geo-replication", arrow: "forward", annotation: "" },
            { from: "web-dr", to: "db-dr", label: "SQL after failover", kind: "dependency", evidence: [owner.id], decisions: [], mechanism: "application connection after failover", arrow: "forward", annotation: "" },
            { from: "web-dr", to: "kv", label: "Secrets across regions", kind: "dependency", evidence: [factOf("kv-checkout")], decisions: ["secrets-keys"], mechanism: `cross-region read from ${dr} to the vault in ${primaryPair}`, arrow: "forward", annotation: "" },
        ],
    });
    const drDiagram = await ok("build-diagram", [
        "--spec", rel("architectures", `${proposed}.spec.json`), "--ledger", ledger, "--resolution", rel(resolutionFile), "--icon-root", iconRoot,
    ]);
    mkdirSync(path.join(root, "presentations"), { recursive: true });
    copyFileSync(path.join(templates, "story.dr-walkthrough.mjs"), path.join(root, "presentations", `${proposed}.story.mjs`));
    write(path.join("presentations", `${proposed}.story-data.json`), {
        schemaVersion: 1,
        cover: { title: "checkout · disaster recovery", blurb: `How the workload fails over from ${primary} to ${dr}, and back.` },
        steps: [
            { step: "healthy", md: "Users reach the primary region through the on-prem DNS record. The data tier replicates to the DR region." },
            { step: "disaster", md: `The primary region is lost and nothing in ${primary} can be reached.`, groups: [primaryGroup] },
            { step: "detection", md: "Azure Service Health and the synthetic checks both report the outage.", nodes: ["web-checkout"] },
            { step: "approval", title: "The incident commander decides", md: "The incident commander approves the failover. This skill does not approve or run it." },
            { step: "failover", md: "Promote the replica, start the DR web app and change the on-prem DNS record.", groups: [drGroup], nodes: ["orders-db replica", "web-checkout (DR)"], edges: [["On-prem DNS", "web-checkout (DR)"]] },
            { step: "verification", md: "Run the business checks against the DR region.", nodes: ["web-checkout (DR)"] },
            { step: "failback", md: "Resynchronize the primary, then change the record back.", edges: [["On-prem DNS", "web-checkout"]] },
            { step: "weakest-link", md: "The DNS step is the weakest link: the TTL wait counts toward the RTO.", edges: [["On-prem DNS", "web-checkout (DR)"]] },
            { step: "test-plan", md: "Rehearse the failover twice a year and record the measured times." },
            {
                step: "establishing",
                md: "The DR region is built beside today's setup, in the build order of the establishment guide.",
                scenes: [
                    { title: "Secrets and keys", md: `Today kv-checkout fails over to ${primaryPair}. Target: it stays there, read across regions. Test: a probe in ${dr} reads a test secret.`, groups: [splitGroup] },
                    { title: "Data replication", md: "Target: active geo-replication of orders-db. Test: the lag stays below the Estimated RPO.", nodes: ["orders-db replica"] },
                ],
            },
        ],
    });
    const drPresentation = await run("present", ["--story", rel("presentations", `${proposed}.story.mjs`), "--icon-root", iconRoot]);

    // Stage 7: the guide skeleton, its text, its test plan and its check; the runbook; the report; the generated tables last.
    const guideFile = path.join(root, "reports", "dr-establishment-guide.md");
    const guide = await ok("establishment-guide", ["--root", rel(), "--write", ...books]);
    writeFileSync(guideFile, fillGuide(readFileSync(guideFile, "utf8")));
    const guideTables = await ok("establishment-guide", ["--root", rel(), "--tables"]);
    const guideCheck = await ok("establishment-guide", ["--root", rel(), "--check"]);
    const runbookFile = path.join(root, "reports", "recovery-runbook.md");
    write(path.join("reports", "recovery-runbook.md"), readFileSync(path.join(templates, "runbook.md"), "utf8"));
    const runbookSteps = await ok("establishment-guide", ["--root", rel(), "--inject-runbook", rel("reports", "recovery-runbook.md"), ...books]);
    writeFileSync(runbookFile, fill(readFileSync(runbookFile, "utf8")));
    write(path.join("reports", "assessment.md"), fill(readFileSync(path.join(templates, "report.md"), "utf8")));
    const tables = await ok("report-tables", ["--root", rel(), "--inject", rel("reports", "assessment.md")]);
    const ledgerCheck = await ok("ledger", ["validate", "--ledger", ledger]);

    return {
        cwd, root, rel, preflight, intake, ingest, resources, regions, validation, tables, ledgerCheck, options, choices, choicesCheck,
        guide: { ...guide, file: guideFile, tables: guideTables, check: guideCheck }, runbookSteps, playbooks,
        diagrams: { asIs: asIsDiagram, dr: drDiagram },
        presentations: {
            asIs: { id: asIs, result: asIsPresentation, html: path.join(root, "presentations", `${asIs}.html`) },
            dr: { id: proposed, result: drPresentation, html: path.join(root, "presentations", `${proposed}.html`) },
        },
        report: path.join(root, "reports", "assessment.md"),
        runbook: path.join(root, "reports", "recovery-runbook.md"),
    };
}
