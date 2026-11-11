import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment, serializeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const scripts = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "scripts");
const script = (name) => path.join(scripts, `${name}.mjs`);

/** A working folder after stage 3: the generated workbook ingested with the resource group rg-checkout in scope. */
async function ingested({ scope = { resource_groups: ["rg-checkout"] } } = {}) {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-resources-")));
    const root = path.join(cwd, "dr-assessment", "checkout");
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(cwd, "ari-export.xlsx"), makeAriWorkbook());
    writeFileSync(
        path.join(root, "assessment.yaml"),
        serializeAssessment(normalizeAssessment({ workload: { name: "checkout" }, inputs: { ari_file: "ari-export.xlsx" }, regions: { primary: "westeurope", dr: "northeurope" }, objectives: { tier: 1 }, scope })),
    );
    const r = await runScript(script("ingest"), ["--assessment", path.join("dr-assessment", "checkout", "assessment.yaml")], { cwd });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    return { cwd, assessment: path.join("dr-assessment", "checkout", "assessment.yaml") };
}
const list = (w, extra = []) => runScript(script("resources"), ["--assessment", w.assessment, ...extra], { cwd: w.cwd });
const evidenceFile = (w, name) => path.join(w.cwd, path.dirname(w.assessment), "evidence", name);
const editInventory = (w, edit) => {
    const file = evidenceFile(w, "inventory.json");
    const inventory = JSON.parse(readFileSync(file, "utf8"));
    edit(inventory);
    writeFileSync(file, JSON.stringify(inventory));
};

test("lists every in-scope resource once, with the id of the fact that names it", async () => {
    const w = await ingested();
    const r = await list(w);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.deepEqual([r.json.total, r.json.matched, r.json.offset, r.json.shown], [7, 7, 0, 7]);
    assert.deepEqual(r.json.resourceGroups, [{ name: "rg-checkout", resources: 7 }]);
    assert.deepEqual(r.json.resources.map((x) => x.name), ["web-vm-01", "web-vm-02", "stcheckoutprod", "orders-db", "web-checkout", "kv-checkout", "web-vm-01_OsDisk"]);
    assert.deepEqual(r.json.resources[0], {
        id: "F-0001", ref: "ari:Virtual Machines!2", name: "web-vm-01", armType: "microsoft.compute/virtualmachines",
        resourceGroup: "rg-checkout", location: "westeurope", sku: "Standard_D4s_v5", zones: "1",
    });
    assert.ok(r.json.resources.every((x) => /^F-\d{4}$/.test(x.id)), "every resource has an identity fact");
    assert.equal(new Set(r.json.resources.map((x) => x.id)).size, 7);
});

test("--type and --resource-group narrow the list, and total keeps the size of the scope", async () => {
    const w = await ingested({ scope: {} });
    const all = await list(w);
    assert.equal(all.json.total, 12);
    assert.ok(all.json.resourceGroups.length >= 2);
    const vms = await list(w, ["--type", "Microsoft.Compute/virtualMachines"]);
    assert.deepEqual([vms.json.total, vms.json.matched], [12, vms.json.resources.length]);
    assert.ok(vms.json.matched >= 2 && vms.json.resources.every((x) => x.armType === "microsoft.compute/virtualmachines"));
    const group = await list(w, ["--resource-group", "rg-checkout"]);
    assert.equal(group.json.matched, 7);
    assert.ok(group.json.resources.every((x) => x.resourceGroup === "rg-checkout"));
    const none = await list(w, ["--type", "microsoft.nothing/here"]);
    assert.deepEqual([none.json.matched, none.json.shown, none.json.resources], [0, 0, []]);
});

test("--resource-group compares without regard to case, as the scope selector and --type do", async () => {
    const w = await ingested({ scope: {} });
    const lower = await list(w, ["--resource-group", "rg-checkout"]);
    const upper = await list(w, ["--resource-group", "RG-CHECKOUT"]);
    assert.equal(lower.json.matched, 7);
    assert.equal(upper.json.matched, 7);
    assert.deepEqual(upper.json.resources, lower.json.resources);
    assert.equal((await list(w, ["--resource-group", "rg-nothing"])).json.matched, 0);
});

test("resourceGroups groups by the lower-cased name and shows the name as it was first seen", async () => {
    const w = await ingested({ scope: {} });
    editInventory(w, (inventory) => {
        const inGroup = inventory.resources.filter((resource) => resource.resourceGroup === "rg-checkout");
        inGroup[0].resourceGroup = "RG-Checkout";
        inGroup[1].resourceGroup = "rg-CHECKOUT";
    });
    const r = await list(w);
    assert.deepEqual(r.json.resourceGroups, [
        { name: "RG-Checkout", resources: 7 },
        { name: "rg-billing", resources: 3 },
        { name: "rg-shared", resources: 2 },
    ]);
    assert.equal((await list(w, ["--resource-group", "Rg-Checkout"])).json.matched, 7);
});

test("(none) is the group of the resources that have no resource group, and --resource-group (none) selects them", async () => {
    const w = await ingested({ scope: {} });
    editInventory(w, (inventory) => {
        inventory.resources[0].resourceGroup = null;
        inventory.resources[1].resourceGroup = null;
    });
    const all = await list(w);
    assert.deepEqual(all.json.resourceGroups.find((group) => group.name === "(none)"), { name: "(none)", resources: 2 });
    const none = await list(w, ["--resource-group", "(none)"]);
    assert.deepEqual([none.json.total, none.json.matched], [12, 2]);
    assert.ok(none.json.resources.every((x) => x.resourceGroup === null));
});

test("resource groups with the same number of resources are ordered by code unit, not by the machine's locale", async () => {
    const w = await ingested();
    editInventory(w, (inventory) => {
        inventory.resources = inventory.resources.slice(0, 3);
        inventory.resources[0].resourceGroup = "ä-group";
        inventory.resources[1].resourceGroup = "z-group";
        inventory.resources[2].resourceGroup = "a-group";
    });
    const r = await list(w);
    assert.deepEqual(r.json.resourceGroups, [
        { name: "a-group", resources: 1 },
        { name: "z-group", resources: 1 },
        { name: "ä-group", resources: 1 },
    ]);
});

test("the id of a resource is its first Observed name fact: a fact that comes later never replaces it, an Inferred one included", async () => {
    const w = await ingested();
    const ref = "ari:Virtual Machines!2";
    const before = await list(w);
    assert.equal(before.json.resources[0].ref, ref);
    assert.match(before.json.resources[0].id, /^F-\d{4}$/);

    const addName = (extra) =>
        runScript(script("ledger"), ["add-fact", "--ledger", evidenceFile(w, "ledger.json"), "--subject", ref, "--property", "name", ...extra], { cwd: w.cwd });
    const inferred = await addName(["--strength", "Inferred", "--claim", "The owner calls this machine web-vm-primary", "--value", '"web-vm-primary"', "--source-type", "owner", "--basis", "said in the intake call"]);
    assert.equal(inferred.code, 0, inferred.stdout + inferred.stderr);
    const again = await addName(["--strength", "Observed", "--claim", "web-vm-01 is present in the inventory", "--value", '"web-vm-01"', "--source-type", "ari-xlsx", "--source-ref", ref, "--source-detail", "resource name"]);
    assert.equal(again.code, 0, again.stdout + again.stderr);

    const after = await list(w);
    assert.equal(after.json.resources[0].id, before.json.resources[0].id);
    assert.deepEqual(after.json.resources, before.json.resources);
});

test("--limit and --offset page through the rows", async () => {
    const w = await ingested();
    const first = await list(w, ["--limit", "3"]);
    assert.deepEqual([first.json.matched, first.json.shown, first.json.resources.map((x) => x.name)], [7, 3, ["web-vm-01", "web-vm-02", "stcheckoutprod"]]);
    const rest = await list(w, ["--limit", "3", "--offset", "6"]);
    assert.deepEqual([rest.json.offset, rest.json.shown, rest.json.resources.map((x) => x.name)], [6, 1, ["web-vm-01_OsDisk"]]);
    const past = await list(w, ["--offset", "99"]);
    assert.deepEqual([past.json.shown, past.json.resources], [0, []]);
});

test("without evidence it exits 2 and says to run ingest, and bad numbers or flags exit 1", async () => {
    const empty = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-resources-empty-")));
    mkdirSync(path.join(empty, "dr-assessment", "checkout"), { recursive: true });
    writeFileSync(path.join(empty, "dr-assessment", "checkout", "assessment.yaml"), serializeAssessment(normalizeAssessment({ workload: { name: "checkout" } })));
    const none = await runScript(script("resources"), ["--assessment", path.join("dr-assessment", "checkout", "assessment.yaml")], { cwd: empty });
    assert.equal(none.code, 2);
    assert.match(none.json.error, /there is no evidence to list yet/);
    assert.ok(none.json.details.some((d) => d.includes("run ingest first")));

    const w = await ingested();
    for (const bad of [["--limit", "0"], ["--limit", "x"], ["--offset", "-1"], ["--offset", "1.5"]]) {
        const r = await list(w, bad);
        assert.equal(r.code, 1, bad.join(" "));
        assert.match(r.json.error, /--(limit|offset)/);
    }
    assert.equal((await runScript(script("resources"), [], { cwd: w.cwd })).code, 1);
    const help = await runScript(script("resources"), ["--help"], { cwd: w.cwd });
    assert.equal(help.code, 0);
    for (const flag of ["--assessment", "--type", "--resource-group", "--limit", "--offset"]) assert.ok(help.stdout.includes(flag), flag);
});
