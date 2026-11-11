import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { normalizeAssessment, readAssessment, serializeAssessment, validateAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { parseYaml } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";

const example = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "assets", "assessment.example.yaml");
const tmp = () => mkdtempSync(path.join(tmpdir(), "dr-choices-"));
const KV = { type: "microsoft.keyvault/vaults", option: "secondary-vault-sync", chosen_by: "Application owner", date: "2026-11-09", recommended: true };

test("dr_choices normalizes to a list of entries after decisions, recommended false when missing", () => {
    const a = normalizeAssessment({
        workload: { name: "x" },
        dr_choices: [KV, { type: " microsoft.storage/storageaccounts ", option: "object-replication", chosen_by: "default", date: "2026-11-09" }],
    });
    assert.deepEqual(a.dr_choices, [
        KV,
        { type: "microsoft.storage/storageaccounts", option: "object-replication", chosen_by: "default", date: "2026-11-09", recommended: false },
    ]);
    const keys = Object.keys(a);
    assert.equal(keys.indexOf("dr_choices"), keys.indexOf("decisions") + 1);
    assert.deepEqual(normalizeAssessment({ workload: { name: "x" } }).dr_choices, []);
    assert.deepEqual(validateAssessment(a), { ok: true, errors: [] });
});

test("validateAssessment checks the shape of every dr_choices entry and refuses a type twice", () => {
    const a = normalizeAssessment({
        workload: { name: "x" },
        dr_choices: [
            { type: "Microsoft.KeyVault/vaults", option: "Second Vault", chosen_by: "", date: "2026-02-30", recommended: "yes" },
            KV,
            { ...KV, option: "accept-gap", recommended: false },
            "not a mapping",
        ],
    });
    const { ok, errors } = validateAssessment(a);
    assert.equal(ok, false);
    assert.deepEqual(errors, [
        { path: "dr_choices[0].type", message: "must be a lowercase ARM type such as microsoft.keyvault/vaults" },
        { path: "dr_choices[0].option", message: "must be an option id such as secondary-vault-sync, or accept-gap" },
        { path: "dr_choices[0].chosen_by", message: "must be a role, or default when nobody answered" },
        { path: "dr_choices[0].date", message: "must be a date as YYYY-MM-DD" },
        { path: "dr_choices[0].recommended", message: "must be true or false" },
        { path: "dr_choices[2].type", message: "microsoft.keyvault/vaults already has an entry (dr_choices[1]); keep one entry per type" },
        { path: "dr_choices[3].type", message: "must be a lowercase ARM type such as microsoft.keyvault/vaults" },
        { path: "dr_choices[3].option", message: "must be an option id such as secondary-vault-sync, or accept-gap" },
        { path: "dr_choices[3].chosen_by", message: "must be a role, or default when nobody answered" },
        { path: "dr_choices[3].date", message: "must be a date as YYYY-MM-DD" },
    ]);
});

test("readAssessment refuses a dr_choices that is not a list, and a serialized assessment keeps the entries in block style", async () => {
    const dir = tmp();
    const file = path.join(dir, "assessment.yaml");
    writeFileSync(file, "workload:\n  name: x\ndr_choices:\n  type: microsoft.keyvault/vaults\n");
    await assert.rejects(() => readAssessment(file), (e) => e instanceof CliError && e.code === EXIT.INPUT && e.details.includes("dr_choices: must be a list"));

    const a = normalizeAssessment({ workload: { name: "x" }, dr_choices: [KV] });
    const text = serializeAssessment(a);
    assert.match(text, /^decisions: \[\]\ndr_choices:\n {2}- type: microsoft\.keyvault\/vaults\n {4}option: secondary-vault-sync\n {4}chosen_by: Application owner\n {4}date: 2026-11-09\n {4}recommended: true\ndrills: \[\]$/m);
    writeFileSync(file, text);
    assert.deepEqual((await readAssessment(file)).dr_choices, [KV]);
    assert.deepEqual(normalizeAssessment(parseYaml(text)), a);
});

test("the example file has an empty dr_choices list with a comment after decisions", () => {
    const text = readFileSync(example, "utf8");
    assert.match(text, /^decisions: \[\] +# .+\ndr_choices: \[\] +# the DR option chosen per service, written by dr-options --record; a block sequence; each item has the keys type, option, chosen_by \(a role, or default\), date and recommended$/m);
    assert.deepEqual(normalizeAssessment(parseYaml(text)).dr_choices, []);
});
