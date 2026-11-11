import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { lintPack } from "../../skills/azure-dr-assessment/scripts/lib/pattern-lint.mjs";
import {
    APPLIES_TO_KEYS, FIXED_SECTIONS, OPTIONAL_SECTIONS, OVERRIDE_LEVELS, SLOT_IDS, STATUSES, applies, readPack,
} from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { parseYaml } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";
import { writePack } from "../helpers/pack-fixture.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const template = readFileSync(path.join(root, "skills", "azure-dr-assessment", "assets", "pattern-template.md"), "utf8");
const readme = readFileSync(path.join(root, "skills", "azure-dr-assessment", "patterns", "README.md"), "utf8");

test("the template parses and lints clean as a draft pattern", async () => {
    const loaded = await readPack(writePack({ "DR-EXAMPLE-001.md": template }));
    assert.deepEqual(lintPack(loaded), []);
    const [pattern] = loaded.pack.patterns;
    assert.equal(pattern.id, "DR-EXAMPLE-001");
    assert.equal(pattern.status, "draft");
    assert.deepEqual(Object.keys(pattern.sections), [...FIXED_SECTIONS, ...OPTIONAL_SECTIONS]);
    assert.ok(pattern.gate.question.length > 0);
});

test("the template carries every front matter field of contracts 7.6, and a draft never applies", async () => {
    const loaded = await readPack(writePack({ "DR-EXAMPLE-001.md": template }));
    const [pattern] = loaded.pack.patterns;
    assert.deepEqual(
        Object.keys(loaded.sources.get("DR-EXAMPLE-001.md").data),
        ["id", "version", "status", "slots", "override", "applies_to", "supersedes", "owner_role", "inputs", "parameters"],
    );
    const a = normalizeAssessment({ workload: { name: "checkout" }, objectives: { tier: 1 } });
    assert.equal(applies(pattern, a).applies, false);
});

test("the guide's slot table lists exactly the slot vocabulary, in order", () => {
    const section = readme.split(/^## /m).find((s) => s.startsWith("Slots\n"));
    assert.ok(section, "the README has no ## Slots section");
    const ids = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]);
    assert.deepEqual(ids, SLOT_IDS);
});

test("the guide documents the levels, statuses, applies_to keys, sections, commands and the pack status", () => {
    const terms = [
        ...OVERRIDE_LEVELS, ...STATUSES, ...APPLIES_TO_KEYS, ...FIXED_SECTIONS, ...OPTIONAL_SECTIONS,
        "supersedes", "pattern_inputs", "parameters.tiers", "lint-patterns", "npm run lint:patterns", "DR_PATTERNS_DIR", "--patterns-dir",
        "DR-TIER-001", "DR-DNS-001", "awaits the owner's confirmation", "RELEASING.md", "not supplied by the application team",
        "evaluateGates", "needs a code change", "never switches a company pattern off", "`date` is not a real `YYYY-MM-DD` date",
        "A blank `slots:` key counts as omitted", "One entry covers every target that is stricter than the tier",
    ];
    for (const term of terms) assert.ok(readme.includes(term), `the README does not mention ${term}`);
});

test("every YAML example in the guide parses with the YAML subset", () => {
    const blocks = [...readme.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
    assert.ok(blocks.length >= 2, "expected the override example and the tier parameters example");
    for (const block of blocks) assert.doesNotThrow(() => parseYaml(block));
});

test("the override example in the guide is a complete approval-required entry", () => {
    const blocks = [...readme.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map((m) => parseYaml(m[1]));
    const example = blocks.find((b) => b?.overrides);
    const [entry] = normalizeAssessment({ workload: { name: "checkout" }, overrides: example.overrides }).overrides;
    for (const field of ["pattern", "justification", "owner_role", "date", "approver_role", "approval_ref"]) {
        assert.ok(entry[field], `the example entry has no ${field}`);
    }
});

/** Every .md and .yaml file below a folder. */
function docFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return docFiles(full);
        return /\.(md|ya?ml)$/.test(entry.name) ? [full] : [];
    });
}

test("no shipped example leaves the slots key blank, which would waive every slot of the pattern", () => {
    const files = [path.join(root, "README.md"), path.join(root, "tests", "scenarios.md"), ...docFiles(path.join(root, "skills", "azure-dr-assessment"))];
    for (const file of files.filter((candidate) => existsSync(candidate))) {
        assert.doesNotMatch(readFileSync(file, "utf8"), /^\s*(?:-\s+)?slots:\s*(?:#.*)?$/m, `${path.relative(root, file)} has a blank slots: key`);
    }
});
