import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultMapFile } from "../../skills/azure-dr-assessment/scripts/lib/learn-map.mjs";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { playbookMarkdown, writePlaybookDir } from "../helpers/playbook-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const scripts = path.join(root, "skills", "azure-dr-assessment", "scripts");
const tmp = () => realpathSync(mkdtempSync(path.join(tmpdir(), "dr-region-services-")));
const worklist = (args, cwd) => runScript(path.join(scripts, "region-services.mjs"), args, { cwd });

const ASSESSMENT = [
    "schema: 1",
    "workload:",
    "  name: checkout",
    "  app: checkout",
    "inputs:",
    "  ari_file: ari-export.xlsx",
    "regions:",
    "  primary: westeurope",
    "  dr: swedencentral",
    "objectives:",
    "  tier: 1",
    "",
].join("\n");

/** An assessment next to a generated ARI workbook, ingested. */
async function ingested() {
    const cwd = tmp();
    const dir = path.join(cwd, "dr-assessment", "checkout");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(cwd, "ari-export.xlsx"), makeAriWorkbook());
    const file = path.join(dir, "assessment.yaml");
    writeFileSync(file, ASSESSMENT);
    const r = await runScript(path.join(scripts, "ingest.mjs"), ["--assessment", file], { cwd });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    return { cwd, file, dir };
}

test("the worklist lists every distinct type with its count, its regions and the catalogue's hint", async () => {
    const { cwd, file } = await ingested();
    const r = await worklist(["--assessment", file], cwd);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.deepEqual(r.json.declared, { primary: "westeurope", dr: "swedencentral" });
    assert.equal(r.json.resources, 12);
    assert.deepEqual(r.json.regions, [
        { region: "westeurope", resources: 9 },
        { region: "northeurope", resources: 3 },
    ]);
    assert.deepEqual(
        r.json.types.map((type) => [type.armType, type.count]),
        [
            ["microsoft.compute/virtualmachines", 3],
            ["microsoft.storage/storageaccounts", 3],
            ["microsoft.sql/servers/databases", 2],
            ["microsoft.web/sites", 2],
            ["microsoft.compute/disks", 1],
            ["microsoft.keyvault/vaults", 1],
        ],
    );
    assert.deepEqual(r.json.unmapped, []);
    assert.ok(r.json.types.every((type) => type.mapped));

    const storage = r.json.types.find((type) => type.armType === "microsoft.storage/storageaccounts");
    assert.deepEqual(storage.regions, ["northeurope", "westeurope"]);
    assert.deepEqual(storage.learn.map((hint) => hint.service), [
        "Azure Blob Storage",
        "Azure Files",
        "Azure Queue Storage",
        "Azure Table Storage",
        "Azure Data Lake Storage Gen2 (hierarchical namespaces)",
    ]);
    const sql = r.json.types.find((type) => type.armType === "microsoft.sql/servers/databases");
    assert.equal(sql.learn[0].articleUrl, "https://learn.microsoft.com/en-us/azure/reliability/reliability-sql-database");
    const sites = r.json.types.find((type) => type.armType === "microsoft.web/sites");
    assert.deepEqual(sites.learn.map((hint) => hint.service), ["Azure App Service", "Azure Functions", "Azure Logic Apps"]);

    assert.equal(r.json.catalogue.verifiedOn, JSON.parse(readFileSync(defaultMapFile(), "utf8")).verifiedOn);
    assert.equal(typeof r.json.catalogue.ageDays, "number");
    assert.equal(typeof r.json.catalogue.stale, "boolean");
});

test("each type names the playbook that covers it, from the bundled folder or --playbooks-dir", async () => {
    const { cwd, file } = await ingested();
    const bundled = await worklist(["--assessment", file], cwd);
    assert.equal(bundled.code, 0, bundled.stdout + bundled.stderr);
    assert.equal(bundled.json.types.find((type) => type.armType === "microsoft.keyvault/vaults").playbook, "key-vault");
    assert.ok(bundled.json.types.every((type) => type.playbook === null || typeof type.playbook === "string"));

    const dir = writePlaybookDir({
        "test-vault.md": playbookMarkdown({ service: "test-vault", arm_types: ["microsoft.keyvault/vaults", "microsoft.web/sites"] }),
    });
    const custom = await worklist(["--assessment", file, "--playbooks-dir", dir], cwd);
    assert.equal(custom.code, 0, custom.stdout + custom.stderr);
    assert.deepEqual(custom.json.types.map((type) => [type.armType, type.playbook]), [
        ["microsoft.compute/virtualmachines", null],
        ["microsoft.storage/storageaccounts", null],
        ["microsoft.sql/servers/databases", null],
        ["microsoft.web/sites", "test-vault"],
        ["microsoft.compute/disks", null],
        ["microsoft.keyvault/vaults", "test-vault"],
    ]);
    const missing = await worklist(["--assessment", file, "--playbooks-dir", path.join(cwd, "no-playbooks")], cwd);
    assert.equal(missing.code, 2);
    assert.match(missing.json.error, /^cannot read the playbook folder /);
});

test("a type the catalogue does not know is listed as unmapped, and an old catalogue is reported as stale", async () => {
    const { cwd, file, dir } = await ingested();
    const inventoryFile = path.join(dir, "evidence", "inventory.json");
    const inventory = JSON.parse(readFileSync(inventoryFile, "utf8"));
    inventory.resources[0].armType = "microsoft.example/unknown";
    const custom = path.join(cwd, "custom-inventory.json");
    writeFileSync(custom, JSON.stringify(inventory));

    const old = JSON.parse(readFileSync(defaultMapFile(), "utf8"));
    old.verifiedOn = "2020-01-01";
    const oldMap = path.join(cwd, "old-map.json");
    writeFileSync(oldMap, JSON.stringify(old));

    const r = await worklist(["--assessment", file, "--inventory", custom, "--map", oldMap], cwd);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(r.json.unmapped, ["microsoft.example/unknown"]);
    const unknown = r.json.types.find((type) => type.armType === "microsoft.example/unknown");
    assert.deepEqual({ count: unknown.count, mapped: unknown.mapped, learn: unknown.learn }, { count: 1, mapped: false, learn: [] });
    assert.equal(r.json.catalogue.stale, true);
    assert.ok(r.json.catalogue.ageDays > 90);
});

test("regions with the same number of resources are ordered by code unit, not by the machine's locale", async () => {
    const { cwd, file, dir } = await ingested();
    const inventory = JSON.parse(readFileSync(path.join(dir, "evidence", "inventory.json"), "utf8"));
    inventory.resources = inventory.resources.slice(0, 3);
    inventory.resources[0].location = "äregion";
    inventory.resources[1].location = "zregion";
    inventory.resources[2].location = "aregion";
    const custom = path.join(cwd, "tied-inventory.json");
    writeFileSync(custom, JSON.stringify(inventory));

    const r = await worklist(["--assessment", file, "--inventory", custom], cwd);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(r.json.regions, [
        { region: "aregion", resources: 1 },
        { region: "zregion", resources: 1 },
        { region: "äregion", resources: 1 },
    ]);
});

test("a missing inventory says to run ingest first, and bad inputs fail with exit code 2", async () => {
    const cwd = tmp();
    const dir = path.join(cwd, "dr-assessment", "checkout");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "assessment.yaml");
    writeFileSync(file, ASSESSMENT);
    const noInventory = await worklist(["--assessment", file], cwd);
    assert.equal(noInventory.code, 2);
    assert.match(noInventory.json.details.join("\n"), /run ingest first/);

    const noAssessment = await worklist(["--assessment", path.join(dir, "nope.yaml")], cwd);
    assert.equal(noAssessment.code, 2);

    const badMap = path.join(cwd, "bad-map.json");
    writeFileSync(badMap, JSON.stringify({ schemaVersion: 1 }));
    const { file: ingestedFile } = await ingested();
    const invalidMap = await worklist(["--assessment", ingestedFile, "--map", badMap], cwd);
    assert.equal(invalidMap.code, 2);
    assert.match(invalidMap.json.error, /Learn service map/);
});

test("--help lists every flag and a missing --assessment is a usage error", async () => {
    const help = await worklist(["--help"], tmp());
    assert.equal(help.code, 0);
    for (const flag of ["--assessment", "--inventory", "--map", "--playbooks-dir"]) assert.ok(help.stdout.includes(flag), flag);
    assert.equal((await worklist([], tmp())).code, 1);
});
