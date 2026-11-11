import { readFileSync } from "node:fs";
import path from "node:path";
import { Ledger } from "../../skills/azure-dr-assessment/scripts/lib/ledger.mjs";

export const FIXTURE_SPEC_FILE = path.resolve(import.meta.dirname, "..", "fixtures", "diagram", "checkout-current-state.spec.json");

/** A fresh copy of the fixture spec, so a test can change it freely. */
export const readFixtureSpec = () => JSON.parse(readFileSync(FIXTURE_SPEC_FILE, "utf8"));

const observed = (ref, subject, property, value) => ({
    kind: "fact", strength: "Observed", subject, claim: `${subject} ${property} is ${value}`, property, value,
    source: { type: "ari-xlsx", ref, detail: `column ${property}` },
});
const inferred = (subject, claim, basis) => ({ kind: "fact", strength: "Inferred", subject, claim, basis, source: { type: "owner" } });

/** The ledger the fixture spec cites: F-0001 to F-0010, always in this order (F-0009 is the Unknown fact). */
export function makeFixtureLedger() {
    const ledger = Ledger.empty();
    ledger.add(observed("ari:App Services!2", "web-prod", "Location", "westeurope"));
    ledger.add(observed("ari:SQL DBs!2", "orders-db", "Read Replica Count", 1));
    ledger.add(observed("ari:Storage Accounts!2", "assets-prod", "SKU", "Standard_LRS"));
    ledger.add(observed("ari:Front Doors!2", "Front Door", "Origin", "web-prod.azurewebsites.net"));
    ledger.add(observed("ari:Key Vaults!2", "kv-prod", "Soft Delete", true));
    ledger.add(inferred("web-prod", "web-prod calls orders-db", "connection string name matches"));
    ledger.add(inferred("web-prod", "web-prod writes to assets-prod", "owner statement"));
    ledger.add(observed("ari:Widgets!2", "orders-queue", "SKU", "Standard"));
    ledger.add({
        kind: "fact", strength: "Unknown", subject: "orders-queue", claim: "orders-queue Zone Redundant is not in the export", property: "Zone Redundant", value: null,
        source: { type: "ari-xlsx" },
    });
    ledger.add(inferred("web-prod", "web-prod publishes to orders-queue", "owner statement"));
    return ledger;
}
