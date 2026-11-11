// Write the sample ARI workbook that the manual scenarios use:
// node tests/manual/make-sample-ari.mjs <folder> [--service-bus] [--primary <region>] [--extra-type <armType>]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SAMPLE_SHEETS, makeAriWorkbook } from "../helpers/ari-fixture.mjs";

const USAGE = "usage: node tests/manual/make-sample-ari.mjs <folder> [--service-bus] [--primary <region>] [--extra-type <armType>]";
/** The regions the sample can put the checkout workload in, with the pair where its GRS account replicates. */
const PAIRS = { westeurope: "northeurope", northeurope: "westeurope", swedencentral: "swedensouth", germanywestcentral: "germanynorth" };
/** The names that the sample's other sheets already use for a type, so an extra resource of that type matches them. */
const SAMPLE_NAMES = { "microsoft.network/virtualnetworks": "vnet-checkout" };
const SHEET_MAP = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "assets", "ari-sheet-map.json");

function fail(message) {
    console.error(message ? `${message}\n${USAGE}` : USAGE);
    process.exit(1);
}

const args = process.argv.slice(2);
let folder = null;
let serviceBus = false;
let primary = "westeurope";
let extraType = null;
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--service-bus") serviceBus = true;
    else if (arg === "--primary" || arg === "--extra-type") {
        const value = args[++i];
        if (!value || value.startsWith("--")) fail(`${arg} needs a value`);
        if (arg === "--primary") primary = value.toLowerCase();
        else extraType = value.toLowerCase();
    } else if (arg.startsWith("--") || folder !== null) fail();
    else folder = arg;
}
if (!folder) fail();
if (!PAIRS[primary]) fail(`the sample knows the pair of ${Object.keys(PAIRS).join(", ")}, not of ${primary}`);

const extraSheets = [];
if (serviceBus) {
    extraSheets.push({
        name: "Service BUS",
        rows: [
            ["Service Bus namespaces in scope"],
            ["Subscription", "Resource Group", "Name", "Location", "SKU", "Geo-DR Alias", "Geo-Replication", "Resource U"],
            ["Sub A", "rg-checkout", "sb-orders", primary, "Premium", "sb-orders-alias (metadata only)", "Not configured", 1],
        ],
    });
}
if (extraType) {
    // The sheet that the ARI sheet map reads for the type; the entry named after the type wins over another that shares it.
    const entries = Object.entries(JSON.parse(readFileSync(SHEET_MAP, "utf8")).resources).filter(([, entry]) => entry.armType === extraType);
    const segment = extraType.split("/").at(-1);
    const [, entry] = entries.find(([key]) => key === segment.replace(/[^a-z0-9]/g, "")) ?? entries[0] ?? [];
    if (!entry) fail(`no sheet of the ARI sheet map holds ${extraType}`);
    if ([...SAMPLE_SHEETS, ...extraSheets.map((sheet) => sheet.name)].includes(entry.sheet)) fail(`the sample already has the sheet ${entry.sheet} of ${extraType}`);
    const name = entry.columns?.name ?? "Name";
    extraSheets.push({
        name: entry.sheet,
        rows: [
            ["Subscription", "Resource Group", name, "Location", "Resource U"],
            ["Sub A", "rg-checkout", SAMPLE_NAMES[extraType] ?? `${segment}-checkout`, primary, 1],
        ],
    });
}

mkdirSync(folder, { recursive: true });
const file = path.resolve(folder, "ari-sample.xlsx");
writeFileSync(file, makeAriWorkbook({ extraSheets, primary, pair: PAIRS[primary] }));
console.log(file);
