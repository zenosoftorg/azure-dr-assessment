import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment, serializeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const repo = path.resolve(import.meta.dirname, "..", "..");
const generator = path.join(repo, "tests", "manual", "make-sample-ari.mjs");
const scripts = path.join(repo, "skills", "azure-dr-assessment", "scripts");

/** Run the generator in a fresh folder and ingest the workbook with rg-checkout in scope. */
async function sample(extra = []) {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-sample-ari-")));
    const made = await runScript(generator, [cwd, ...extra], { cwd });
    assert.equal(made.code, 0, made.stderr);
    const root = path.join(cwd, "dr-assessment", "checkout");
    mkdirSync(root, { recursive: true });
    writeFileSync(
        path.join(root, "assessment.yaml"),
        serializeAssessment(normalizeAssessment({
            workload: { name: "checkout" }, inputs: { ari_file: "ari-sample.xlsx" }, regions: { primary: "westeurope", dr: "swedencentral" }, objectives: { tier: 1 },
            scope: { resource_groups: ["rg-checkout"] },
        })),
    );
    const assessment = path.join("dr-assessment", "checkout", "assessment.yaml");
    const ingest = await runScript(path.join(scripts, "ingest.mjs"), ["--assessment", assessment], { cwd });
    assert.equal(ingest.code, 0, ingest.stdout + ingest.stderr);
    const list = await runScript(path.join(scripts, "resources.mjs"), ["--assessment", assessment], { cwd });
    const inventory = JSON.parse(readFileSync(path.join(root, "evidence", "inventory.json"), "utf8"));
    return { cwd, made, ingest: ingest.json, resources: list.json.resources.map((r) => r.name), inventory: inventory.resources };
}

test("the sample workbook is written into the folder and ingests as the checkout workload", async () => {
    const r = await sample();
    assert.equal(path.basename(r.made.stdout.trim()), "ari-sample.xlsx");
    assert.ok(existsSync(r.made.stdout.trim()));
    assert.deepEqual([r.ingest.resources.total, r.ingest.resources.inScope], [12, 7]);
    assert.deepEqual(r.resources, ["web-vm-01", "web-vm-02", "stcheckoutprod", "orders-db", "web-checkout", "kv-checkout", "web-vm-01_OsDisk"]);
});

test("--service-bus adds a Service Bus namespace whose geo-recovery is metadata only", async () => {
    const r = await sample(["--service-bus"]);
    assert.equal(r.ingest.resources.inScope, 8);
    assert.ok(r.resources.includes("sb-orders"));
});

test("a missing folder or an unknown flag exits 1 with the usage line", async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-sample-usage-")));
    for (const args of [[], ["--nope", cwd], [cwd, "--primary"], [cwd, "--extra-type", "--service-bus"]]) {
        const r = await runScript(generator, args, { cwd });
        assert.equal(r.code, 1, args.join(" "));
        assert.match(r.stderr, /usage: node tests\/manual\/make-sample-ari\.mjs <folder> \[--service-bus\] \[--primary <region>\] \[--extra-type <armType>\]/);
    }
});

test("--primary moves the checkout workload to another region, with its GRS replica in that region's pair (DR-15)", async () => {
    const r = await sample(["--primary", "swedencentral"]);
    assert.equal(r.ingest.resources.inScope, 7);
    assert.deepEqual([...new Set(r.inventory.map((resource) => resource.location))], ["swedencentral"]);
    const storage = r.inventory.find((resource) => resource.name === "stcheckoutprod");
    assert.deepEqual([storage.fields.SKU, storage.fields["Primary Location"], storage.fields["Secondary Location"]], ["Standard_GRS", "swedencentral", "swedensouth"]);
    const plain = await sample();
    assert.equal(plain.inventory.find((resource) => resource.name === "stcheckoutprod").fields["Secondary Location"], "northeurope", "the default keeps West Europe and North Europe");
});

test("--extra-type adds one resource of a type that the ARI sheet map knows, in the checkout resource group (DR-18)", async () => {
    const r = await sample(["--extra-type", "microsoft.network/virtualnetworks"]);
    assert.equal(r.ingest.resources.inScope, 8);
    const extra = r.inventory.find((resource) => resource.armType === "microsoft.network/virtualnetworks");
    assert.deepEqual([extra.name, extra.location, extra.resourceGroup], ["vnet-checkout", "westeurope", "rg-checkout"], "the network the sample VMs name");
    const other = await sample(["--extra-type", "microsoft.network/networksecuritygroups"]);
    assert.ok(other.resources.includes("networksecuritygroups-checkout"), "a type the sample does not name keeps <segment>-checkout");
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-sample-extra-")));
    for (const [args, message] of [
        [["--extra-type", "microsoft.nope/things"], /no sheet of the ARI sheet map holds microsoft\.nope\/things/],
        [["--extra-type", "microsoft.keyvault/vaults"], /the sample already has the sheet Key Vaults of microsoft\.keyvault\/vaults/],
        [["--primary", "mars"], /the sample knows the pair of westeurope, northeurope, swedencentral, germanywestcentral, not of mars/],
    ]) {
        const made = await runScript(generator, [cwd, ...args], { cwd });
        assert.equal(made.code, 1, args.join(" "));
        assert.match(made.stderr, message);
    }
    assert.equal(existsSync(path.join(cwd, "ari-sample.xlsx")), false, "nothing is written after a refusal");
});
