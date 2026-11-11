import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const scripts = path.join(root, "skills", "azure-dr-assessment", "scripts");
const template = path.join(root, "skills", "azure-dr-assessment", "assets", "templates", "report.md");
const script = (name, args, cwd, env = {}) => runScript(path.join(scripts, `${name}.mjs`), args, { cwd, env: { DR_PATTERNS_DIR: undefined, ...env } });

const ASSESSMENT = `schema: 1
workload:
  name: checkout
  app: checkout
  environment: production
inputs:
  ari_file: ari-export.xlsx
regions:
  primary: westeurope
  dr: swedencentral
objectives:
  tier: 1
  rto: 10m
  exceptions:
    - what: RTO 10m stays unmet by tier 1
      approver_role: CTO
      date: 2026-11-04
overrides:
  - pattern: DR-DNS-001
    slots: [traffic-dns]
    justification: Internet-facing only
    owner_role: Application owner
    date: 2026-11-04
    approver_role: Platform architecture board
    approval_ref: ARB-2026-114
    alternative: Azure Front Door with health probes
  - pattern: DR-DNS-001
    owner_role: Application owner
`;

const PLAIN_ASSESSMENT = `schema: 1
workload:
  name: checkout
  app: checkout
  environment: production
inputs:
  ari_file: ari-export.xlsx
regions:
  primary: westeurope
  dr: swedencentral
objectives:
  tier: 1
`;

/** Evidence for a small workload: ingest, one documentation entry, two region findings and a pattern resolution. */
async function evidence(assessmentText = ASSESSMENT) {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-report-tables-")));
    const root = path.join(cwd, "dr-assessment", "checkout");
    mkdirSync(path.join(root, "reports"), { recursive: true });
    writeFileSync(path.join(cwd, "ari-export.xlsx"), makeAriWorkbook());
    const assessment = path.join(root, "assessment.yaml");
    writeFileSync(assessment, assessmentText);
    const ledger = path.join(root, "evidence", "ledger.json");

    const ingest = await script("ingest", ["--assessment", assessment], cwd);
    assert.equal(ingest.code, 0, ingest.stdout + ingest.stderr);
    const doc = await script("ledger", ["add-doc", "--ledger", ledger, "--url", "https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support", "--title", "Azure services that support multiple regions", "--status", "Verified", "--supports", "mechanism rows", "--query", "sql database geo-replication", "--tool", "microsoft_docs_fetch"], cwd);
    assert.equal(doc.code, 0, doc.stdout + doc.stderr);
    const region = await script("ledger", ["add-region", "--ledger", ledger, "--check", "mechanism", "--subject", "microsoft.sql/servers/databases", "--status", "Verified", "--class", "any-pair", "--doc", doc.json.id, "--quote", "Azure SQL Database | Active geo-replication | yes | yes", "--result", '{"mechanism":"active geo-replication"}'], cwd);
    assert.equal(region.code, 0, region.stdout + region.stderr);
    const gap = await script("ledger", ["add-region", "--ledger", ledger, "--check", "mechanism", "--subject", "microsoft.web/sites", "--status", "Unverified", "--class", "none", "--substitute-source", "unmet"], cwd);
    assert.equal(gap.code, 0, gap.stdout + gap.stderr);
    const resolve = await script("resolve-patterns", ["--assessment", assessment], cwd);
    assert.equal(resolve.code, 0, resolve.stdout + resolve.stderr);
    return { cwd, root };
}

test("the script builds sections B, C and D from the evidence files and injects them into a copy of the template", async () => {
    const { cwd, root: outputRoot } = await evidence();
    const report = path.join(outputRoot, "reports", "assessment.md");
    copyFileSync(template, report);

    const r = await script("report-tables", ["--root", outputRoot, "--inject", report], cwd);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.equal(r.json.injected, report);
    assert.deepEqual(r.json.warnings, []);
    assert.equal(r.json.counts.doc, 1);
    assert.equal(r.json.counts.region, 2);

    const text = readFileSync(report, "utf8");
    assert.match(text, /<!-- dr-tables:evidence -->\n### What was read/);
    assert.match(text, /- Source: ARI workbook `ari-export\.xlsx`/);
    assert.match(text, /\| R-0001 \| mechanism \| microsoft\.sql\/servers\/databases \| Verified \| Any-pair \| D-0001 \|/);
    assert.match(text, /\| R-0002 \| mechanism \| microsoft\.web\/sites \| Unverified \| No built-in multiregion \|/);
    assert.match(text, /\| D-0001 \| Azure services that support multiple regions \| https:\/\/learn\.microsoft\.com\/en-us\/azure\/reliability\/regions-multiregion-support \|/);
    assert.match(text, /\| DR-DNS-001 \| v1 \| approval-required \| Yes \|/);
    assert.match(text, /\| traffic-dns \| Not yet decided \| Candidate: override #0 of DR-DNS-001 v1 \(Azure Front Door with health probes\) \|/);
    assert.match(text, /\| #0 \| DR-DNS-001 \| traffic-dns \| Azure Front Door with health probes \| Internet-facing only \| Application owner \| 2026-11-04 \| Platform architecture board \| ARB-2026-114 \| No: this skill cannot verify an approval \|/);
    assert.match(text, /\| RTO 10m stays unmet by tier 1 \| CTO \| 2026-11-04 \|/);
    assert.match(text, /### Rejected overrides[\s\S]*\| #1 \| DR-DNS-001 \| missing required fields: /);
    // The applied override waives DR-DNS-001 for its slot, so the pattern asks for no inputs.
    assert.doesNotMatch(text, /### Open inputs/);
    assert.match(text, /<!-- fill: the pattern, RPO, RTO/);

    const again = await script("report-tables", ["--root", outputRoot, "--inject", report], cwd);
    assert.equal(again.code, 0);
    assert.equal(readFileSync(report, "utf8"), text);
});

test("a pattern that applies asks the application team for its inputs, and no exception is listed", async () => {
    const { cwd, root: outputRoot } = await evidence(PLAIN_ASSESSMENT);
    const r = await script("report-tables", ["--root", outputRoot], cwd);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const text = r.json.sections.patterns;
    assert.match(text, /### Open inputs/);
    for (const input of ["record_type", "ttl", "record_owner_role", "private_zone_integration"]) {
        assert.match(text, new RegExp(`\\| DR-DNS-001 \\| ${input} \\|`), input);
    }
    assert.match(text, /### Documented exceptions\n\nNone\./);
    assert.doesNotMatch(text, /### Rejected overrides/);
    assert.match(text, /\| traffic-dns \| Not yet decided \| Candidate: DR-DNS-001 v1 \|  \|/);
});

test("without --inject the sections are only returned, and a missing resolution is a warning", async () => {
    const { cwd, root: outputRoot } = await evidence();
    const resolutionFile = path.join(outputRoot, "evidence", "pattern-resolution.json");
    writeFileSync(resolutionFile, "");
    const bad = await script("report-tables", ["--root", outputRoot], cwd);
    assert.equal(bad.code, 2);
    assert.match(bad.json.error, /pattern-resolution\.json/);

    writeFileSync(resolutionFile, JSON.stringify(null));
    const r = await script("report-tables", ["--root", outputRoot], cwd);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.injected, null);
    assert.match(r.json.sections.patterns, /No pattern resolution was produced/);
    assert.match(r.json.sections.evidence, /### What was read/);
    assert.match(r.json.sections.sources, /D-0001/);
    assert.deepEqual(r.json.warnings, ["evidence/pattern-resolution.json holds no resolution"]);
});

test("a report without the markers, a missing ledger and bad flags fail with the right exit codes", async () => {
    const { cwd, root: outputRoot } = await evidence();
    const plain = path.join(outputRoot, "reports", "plain.md");
    writeFileSync(plain, "# A report with no markers\n");
    const noMarkers = await script("report-tables", ["--root", outputRoot, "--inject", plain], cwd);
    assert.equal(noMarkers.code, 2);
    assert.equal(noMarkers.json.details.length, 3);
    assert.equal(readFileSync(plain, "utf8"), "# A report with no markers\n");

    const empty = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-report-empty-")));
    assert.equal((await script("report-tables", ["--root", empty], cwd)).code, 2);
    assert.equal((await script("report-tables", [], cwd)).code, 1);
    const help = await script("report-tables", ["--help"], cwd);
    assert.equal(help.code, 0);
    for (const flag of ["--root", "--inject"]) assert.ok(help.stdout.includes(flag), flag);
});

// GC-07: the secret-like values are built at run time from parts, so that no file or tool output holds one.
const KEY_PART = ["Account", "Key="].join("");
const KEY_LIKE = KEY_PART + "a".repeat(30);
const SIG_TOKEN = "q".repeat(24);
const SIG_LIKE = `https://tickets.example.com/browse/ARB-2026-114?${["si", "g="].join("")}${SIG_TOKEN}`;
const NEVER_PRINTED = [KEY_LIKE, KEY_PART, "a".repeat(30), SIG_LIKE, SIG_TOKEN];
const printed = (r) => NEVER_PRINTED.filter((part) => r.stdout.includes(part) || r.stderr.includes(part)).length;

// [what carries the text, how the value reaches the resolution file; it returns the path that the refusal names]
const SECRET_SITES = [
    ["an approval reference in a documented exception", (data) => {
        const index = data.documentedExceptions.findIndex((entry) => entry.kind === "override");
        data.documentedExceptions[index].approval_ref = SIG_LIKE;
        return `resolution.documentedExceptions[${index}].approval_ref`;
    }],
    ["the text of a decision", (data) => {
        const index = data.slots.findIndex((row) => row.slot === "traffic-dns");
        data.slots[index].decision = { text: `Front Door, reached with ${KEY_LIKE}`, source: "override", ref: "ARB-2026-114", status: "Resolved" };
        return `resolution.slots[${index}].decision.text`;
    }],
    ["what a tier exception accepts", (data) => {
        const index = data.documentedExceptions.findIndex((entry) => entry.kind === "tier-exception");
        data.documentedExceptions[index].what = KEY_LIKE;
        return `resolution.documentedExceptions[${index}].what`;
    }],
];

for (const [title, plant] of SECRET_SITES) {
    test(`${title} that looks like a secret is refused with exit 2 and the path only, and the injected report stays as it was`, async () => {
        const { cwd, root: outputRoot } = await evidence();
        const report = path.join(outputRoot, "reports", "assessment.md");
        copyFileSync(template, report);
        const first = await script("report-tables", ["--root", outputRoot, "--inject", report], cwd);
        assert.equal(first.code, 0, first.stderr);
        const injected = readFileSync(report);

        const resolutionFile = path.join(outputRoot, "evidence", "pattern-resolution.json");
        const data = JSON.parse(readFileSync(resolutionFile, "utf8"));
        const at = plant(data);
        writeFileSync(resolutionFile, `${JSON.stringify(data, null, 4)}\n`);

        for (const args of [["--root", outputRoot, "--inject", report], ["--root", outputRoot]]) {
            const r = await script("report-tables", args, cwd);
            assert.equal(r.code, 2, args.join(" "));
            assert.equal(r.json.ok, false);
            assert.equal(r.json.error, "the pattern resolution holds text that looks like a secret, so the report tables were not built");
            assert.deepEqual(r.json.details, [`${at}: looks like a secret (key, token, password or connection string) and must not appear in a report`]);
            assert.equal(r.json.sections, undefined);
            assert.equal(r.stdout.trim().split("\n").length, 1);
            assert.ok(readFileSync(report).equals(injected), "the report file was changed");
            assert.equal(printed(r), 0);
        }
    });
}
