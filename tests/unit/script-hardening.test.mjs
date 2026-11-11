import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment, serializeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { skillRoot } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const scripts = path.join(skillRoot(), "scripts");
const ingest = path.join(scripts, "ingest.mjs");

/** A working folder with ari-export.xlsx and dr-assessment/checkout/assessment.yaml, as intake leaves them. */
function workspace(t) {
    const cwd = mkdtempSync(path.join(tmpdir(), "dr-hardening-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const root = path.join(cwd, "dr-assessment", "checkout");
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(cwd, "ari-export.xlsx"), makeAriWorkbook());
    const assessment = normalizeAssessment({
        workload: { name: "checkout" }, inputs: { ari_file: "ari-export.xlsx" },
        regions: { primary: "westeurope", dr: "swedencentral" }, objectives: { tier: 1 },
    });
    writeFileSync(path.join(root, "assessment.yaml"), serializeAssessment(assessment));
    return { cwd, root, evidence: path.join(root, "evidence"), file: path.join("dr-assessment", "checkout", "assessment.yaml") };
}

test("report-tables refuses to rewrite a report inside the skill directory, before it reads anything", async (t) => {
    const w = workspace(t);
    const inside = path.join(skillRoot(), "references", "customer-report.md");
    t.after(() => rmSync(inside, { force: true }));
    const r = await runScript(path.join(scripts, "report-tables.mjs"), ["--root", w.root, "--inject", inside], { cwd: w.cwd });
    assert.equal(r.code, 4);
    assert.match(r.json.error, /^the report is inside the skill or plugin directory$/);
    assert.equal(existsSync(inside), false);
});

test("report-tables exits 2 with the reason when the report to inject into is missing or is a folder, and creates nothing", async (t) => {
    const w = workspace(t);
    const ingested = await runScript(ingest, ["--assessment", w.file], { cwd: w.cwd });
    assert.equal(ingested.code, 0, ingested.stderr);
    for (const [report, reason] of [["missing-report.md", "ENOENT"], ["dr-assessment", "EISDIR"]]) {
        const r = await runScript(path.join(scripts, "report-tables.mjs"), ["--root", w.root, "--inject", report], { cwd: w.cwd });
        assert.equal(r.code, 2, r.stderr);
        assert.equal(r.json.error, "the report cannot be read");
        assert.deepEqual([path.basename(r.json.details[0]), r.json.details[1]], [report, reason]);
        assert.equal(r.stderr, "", "no stack trace");
    }
    assert.equal(existsSync(path.join(w.cwd, "missing-report.md")), false);
});

test("canvas-link refuses a canvas folder inside the skill directory and copies nothing", async (t) => {
    const w = workspace(t);
    mkdirSync(path.join(w.root, "architectures"));
    writeFileSync(path.join(w.root, "architectures", "checkout-current-state.arch.json"), "{}");
    const inside = path.join(skillRoot(), "references", "canvas-copy");
    t.after(() => rmSync(inside, { recursive: true, force: true }));
    const r = await runScript(path.join(scripts, "canvas-link.mjs"), ["--root", w.root, "--canvas-dir", inside], { cwd: w.cwd });
    assert.equal(r.code, 4, r.stderr);
    assert.match(r.json.error, /^the canvas folder is inside the skill or plugin directory$/);
    assert.equal(existsSync(inside), false);
});

test("resolve-patterns refuses an --out that is the assessment file, however it is spelled or linked, and leaves the file as it was", async (t) => {
    const w = workspace(t);
    const file = path.join(w.cwd, w.file);
    const before = readFileSync(file, "utf8");
    const respelled = `${w.cwd}/dr-assessment/./checkout/../checkout/assessment.yaml`;
    const hardLink = path.join(w.root, "same-file.yaml");
    linkSync(file, hardLink);
    for (const out of [w.file, respelled, hardLink]) {
        const r = await runScript(path.join(scripts, "resolve-patterns.mjs"), ["--assessment", w.file, "--out", out], { cwd: w.cwd });
        assert.equal(r.code, 1, r.stderr);
        assert.equal(r.json.error, "--out would overwrite an input");
        assert.match(r.json.details[0], /is the assessment file; choose another output path$/);
        assert.equal(readFileSync(file, "utf8"), before);
    }
});

test("a second ingest says that it replaced the ledger of the first, and the first says nothing about it", async (t) => {
    const w = workspace(t);
    const first = await runScript(ingest, ["--assessment", w.file], { cwd: w.cwd });
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.json.warnings.some((line) => /replaced the ledger/.test(line)), false);

    const second = await runScript(ingest, ["--assessment", w.file], { cwd: w.cwd });
    assert.equal(second.code, 0, second.stderr);
    const warning = second.json.warnings.find((line) => /replaced the ledger/.test(line));
    assert.ok(warning, second.json.warnings.join("\n"));
    assert.match(warning, new RegExp(`^replaced the ledger of an earlier run \\(${first.json.facts} entries\\)`));
    assert.match(warning, /the F- ids are numbered again and its documentation and region entries are gone; write every \*\.spec\.json again$/);
});

test("an earlier ledger that cannot be read is replaced too, and the warning says so", async (t) => {
    const w = workspace(t);
    mkdirSync(w.evidence, { recursive: true });
    writeFileSync(path.join(w.evidence, "ledger.json"), "{ not json");
    const r = await runScript(ingest, ["--assessment", w.file], { cwd: w.cwd });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.json.warnings.some((line) => /^replaced the ledger of an earlier run \(it could not be read\)/.test(line)), r.json.warnings.join("\n"));
});
