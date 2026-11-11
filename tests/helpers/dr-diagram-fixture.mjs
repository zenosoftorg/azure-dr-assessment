import { readFileSync } from "node:fs";
import path from "node:path";
import { Ledger } from "../../skills/azure-dr-assessment/scripts/lib/ledger.mjs";
import { SLOT_IDS } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";

export const DR_SPEC_FILE = path.resolve(import.meta.dirname, "..", "fixtures", "diagram", "checkout-proposed-dr.spec.json");

/** A fresh copy of the fixture proposed-dr spec, so a test can change it freely. */
export const readDrSpec = () => JSON.parse(readFileSync(DR_SPEC_FILE, "utf8"));

export const LEARN_URL = "https://learn.microsoft.com/en-us/azure/reliability/regions-multiregion-support";
export const KEY_VAULT_URL = "https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault#custom-multiregion-solutions-for-resiliency";

const observed = (ref, subject, property, value) => ({
    kind: "fact", strength: "Observed", subject, claim: `${subject} ${property} is ${value}`, property, value,
    source: { type: "ari-xlsx", ref, detail: `column ${property}` },
});

/** The ledger the fixture spec cites: F-0001 to F-0004, D-0001, D-0002, R-0001 and R-0002, always in this order. */
export function makeDrLedger() {
    const ledger = Ledger.empty();
    ledger.add(observed("ari:App Services!2", "web-prod", "Location", "westeurope"));
    ledger.add(observed("ari:SQL DBs!2", "orders-db", "SKU", "S3"));
    ledger.add({ kind: "fact", strength: "Inferred", subject: "web-prod", claim: "web-prod calls orders-db", basis: "connection string name matches", source: { type: "owner" } });
    ledger.add({ kind: "fact", strength: "Unknown", subject: "kv-prod", claim: "the soft delete state of kv-prod is not in the export", property: "Soft Delete", value: null, source: { type: "ari-xlsx" } });
    ledger.add({ kind: "doc", url: LEARN_URL, title: "Azure services with multiregion support", retrievedAt: "2026-11-04T10:00:00.000Z", status: "Verified", supports: "multiregion support rows", query: "multiregion support", tool: "microsoft_docs_fetch" });
    ledger.add({ kind: "doc", url: null, title: "Model knowledge", retrievedAt: null, status: "Unverified", supports: "Key Vault failover", query: null, tool: "none" });
    ledger.add({
        kind: "region", check: "mechanism", subject: "microsoft.sql/servers/databases", status: "Verified", class: "any-pair", doc: "D-0001",
        quote: "Azure SQL Database | Active geo-replication | yes | yes", result: { mechanism: "active geo-replication" }, substitute: null,
    });
    ledger.add({
        kind: "region", check: "mechanism", subject: "microsoft.keyvault/vaults", status: "Verified", class: "paired-only", doc: "D-0001",
        quote: "Azure Key Vault | Microsoft-managed failover | yes | no", result: { mechanism: "managed failover to the paired region" },
        substitute: { source: "customer-built", ref: KEY_VAULT_URL, label: "Proposed" },
    });
    return ledger;
}

const candidate = (source, pattern = null, overrideIndex = null, alternative = null) => ({ source, pattern, version: pattern ? 1 : null, overrideIndex, alternative });
const TEXT = {
    objectives: "Tier 1, Hot/Warm (Active/Passive)",
    "traffic-dns": "Change the on-prem DNS record at failover",
    "data-replication.relational": "SQL Database active geo-replication to the DR region",
};

/** A decision that follows its candidate, the only kind validateResolution accepts. */
function follow(slot, cand) {
    const base = { status: "Resolved", azureReality: "no veto", ledger: [], alternative: null };
    if (cand.source === "pattern") return { ...base, text: TEXT[slot] ?? `Apply ${cand.pattern}`, source: "pattern", ref: `${cand.pattern} v${cand.version}` };
    if (cand.source === "override") return { ...base, text: `Apply the override: ${cand.alternative}`, source: "override", ref: `Override #${cand.overrideIndex} of ${cand.pattern}` };
    return { ...base, text: TEXT[slot] ?? "Use the documented default", source: "learn", ref: null };
}

/**
 * A completed pattern resolution for the fixture workload: DR-TIER-001 decides the objectives, DR-DNS-001 decides
 * traffic-dns (an override of it does when dnsOverride is set), Microsoft Learn decides the rest.
 */
export function makeDrResolution({ dnsOverride = false, tierException = false, nonDefaultPack = false } = {}) {
    const slots = SLOT_IDS.map((slot) => {
        let cand = candidate("learn");
        if (slot === "objectives") cand = candidate("pattern", "DR-TIER-001");
        if (slot === "traffic-dns") cand = dnsOverride ? candidate("override", "DR-DNS-001", 0, "Azure Front Door with health probes") : candidate("pattern", "DR-DNS-001");
        return { slot, candidate: cand, collision: null, status: "candidate", decision: follow(slot, cand) };
    });
    const overrideEntry = {
        pattern: "DR-DNS-001", slots: ["traffic-dns"], justification: "Internet-facing only", owner_role: "Application owner", date: "2026-11-04",
        approver_role: "Platform architecture board", approval_ref: "ARB-2026-114", alternative: "Azure Front Door with health probes",
    };
    return {
        schemaVersion: 1,
        generatedAt: "2026-11-04T10:00:00.000Z",
        assessment: "assessment.yaml",
        packDir: "skills/azure-dr-assessment/patterns",
        nonDefaultPack,
        banner: nonDefaultPack ? "NON-DEFAULT PATTERN PACK: tests/fixtures/patterns/collisions (test or operator override, not the company pack)" : null,
        gates: [],
        patterns: [],
        overrides: dnsOverride ? [{ index: 0, pattern: "DR-DNS-001", level: "approval-required", slots: ["traffic-dns"], outcome: "applied", reason: "complete", approvalVerified: false, entry: overrideEntry }] : [],
        openInputs: [],
        slots,
        documentedExceptions: [
            ...(dnsOverride ? [{ kind: "override", index: 0, ...overrideEntry, approvalVerified: false }] : []),
            ...(tierException ? [{ kind: "tier-exception", what: "RTO 10m stays unmet by tier 1", approver_role: "CTO", date: "2026-11-04" }] : []),
        ],
    };
}
