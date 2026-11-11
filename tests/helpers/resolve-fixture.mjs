import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeAssessment, serializeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";

/** A normalized assessment: checkout, production, tier 1, westeurope to swedencentral. Fields replace the defaults key by key. */
export function sampleAssessment(fields = {}) {
    return normalizeAssessment({
        workload: { name: "checkout", environment: "production" },
        inputs: { ari_file: "ari-export.xlsx" },
        regions: { primary: "westeurope", dr: "swedencentral" },
        objectives: { tier: 1 },
        ...fields,
    });
}

/** Write an assessment.yaml into a fresh temporary output folder. */
export function writeAssessmentFile(fields = {}) {
    const root = mkdtempSync(path.join(tmpdir(), "dr-assess-"));
    const assessment = sampleAssessment(fields);
    const file = path.join(root, "assessment.yaml");
    writeFileSync(file, serializeAssessment(assessment));
    return { root, file, assessment };
}

/** A DR-DNS-001-like patternMarkdown spec: approval-required, deciding traffic-dns, with two required inputs and one optional. */
export function dnsSpec(fields = {}) {
    return {
        id: "DR-DNS-001",
        slots: ["traffic-dns"],
        override: "approval-required",
        inputs: [
            { name: "record_type", description: "DNS record type", required: true },
            { name: "ttl", description: "TTL in seconds", required: true },
            { name: "note", description: "Free-text note", required: false },
        ],
        ...fields,
    };
}
