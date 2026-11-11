import assert from "node:assert/strict";
import test from "node:test";
import { sourceOf } from "../../skills/azure-dr-assessment/scripts/lib/decision-source.mjs";
import { loadPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { evidenceSection, patternsSection } from "../../skills/azure-dr-assessment/scripts/lib/report-tables.mjs";
import { resolveSlots, validateResolution } from "../../skills/azure-dr-assessment/scripts/lib/resolve.mjs";
import { writePatterns } from "../helpers/pack-fixture.mjs";
import { dnsSpec, sampleAssessment } from "../helpers/resolve-fixture.mjs";
import { tierSpec } from "../helpers/tier-fixture.mjs";

const choice = (type, option, chosen_by, date = "2026-11-09") => ({ type, option, chosen_by, date, recommended: false });
const CHOICES = [
    choice("microsoft.keyvault/vaults", "accept-gap", "Application owner"),
    choice("microsoft.storage/storageaccounts", "accept-gap", "default"),
    choice("microsoft.web/sites", "secondary-app", "Application owner"),
    choice("microsoft.cache/redis", "accept-gap", "Data owner", "2026-11-10"),
];
const resolveWith = async (fields = {}) => resolveSlots(sampleAssessment(fields), await loadPack(writePatterns([tierSpec(), dnsSpec()])));
const decided = (resolution) => {
    const copy = structuredClone(resolution);
    for (const slot of copy.slots) {
        const c = slot.candidate;
        slot.decision = c.source === "pattern"
            ? { text: `Apply ${c.pattern} v${c.version}`, source: "pattern", ref: `${c.pattern} v${c.version}`, status: "Resolved" }
            : { text: "Use the documented default", source: "learn", ref: null, status: "Resolved" };
    }
    return copy;
};

test("every accept-gap entry that an owner chose is a dr-choice-gap exception; a default and another option are not", async () => {
    const r = await resolveWith({ dr_choices: CHOICES, objectives: { tier: 1, rto: "10m", exceptions: [{ what: "RTO 10m", approver_role: "CTO", date: "2026-11-04" }] } });
    assert.deepEqual(r.documentedExceptions, [
        { kind: "tier-exception", what: "RTO 10m", approver_role: "CTO", date: "2026-11-04" },
        { kind: "dr-choice-gap", type: "microsoft.keyvault/vaults", chosen_by: "Application owner", date: "2026-11-09" },
        { kind: "dr-choice-gap", type: "microsoft.cache/redis", chosen_by: "Data owner", date: "2026-11-10" },
    ]);
    assert.deepEqual((await resolveWith()).documentedExceptions, []);
});

test("validateResolution accepts the source playbook only on a learn candidate, with the ref playbook <service> v<version>", async () => {
    const r = decided(await resolveWith());
    const learn = r.slots.findIndex((s) => s.candidate.source === "learn");
    const pattern = r.slots.findIndex((s) => s.candidate.source === "pattern");
    r.slots[learn].decision = { text: "A second vault synced by a pipeline", source: "playbook", ref: "playbook key-vault v1", status: "Resolved", ledger: [] };
    assert.deepEqual(validateResolution(r), { ok: true, errors: [] });

    for (const ref of [null, "", "key-vault v1", "playbook Key-Vault v1", "playbook key-vault v0", "playbook key-vault"]) {
        r.slots[learn].decision.ref = ref;
        assert.deepEqual(validateResolution(r).errors, [{
            path: `slots[${learn}].decision.ref`, message: "a decision from playbook needs the ref playbook <service> v<version>, such as playbook key-vault v1",
        }], String(ref));
    }
    r.slots[learn].decision.ref = "playbook key-vault v12";
    r.slots[learn].decision.status = "Unmet requirement";
    r.slots[learn].decision.azureReality = "the playbook has no option that reaches the DR region";
    assert.equal(validateResolution(r).ok, true);

    r.slots[pattern].decision = { text: "Take the playbook instead", source: "playbook", ref: "playbook key-vault v1", status: "Resolved" };
    assert.deepEqual(validateResolution(r).errors, [{
        path: `slots[${pattern}].decision.source`,
        message: `${r.slots[pattern].slot}: a decision from playbook needs a learn candidate, and the engine's candidate comes from pattern; keep the source pattern`,
    }]);
    r.slots[pattern].decision.source = "magic";
    assert.deepEqual(validateResolution(r).errors.map((e) => e.message), ["must be one of override, pattern, playbook, learn, azure-reality"]);
});

test("sourceOf names a playbook decision on a learn candidate Service playbook, and nowhere else", () => {
    const learn = { source: "learn", pattern: null, version: null, overrideIndex: null, alternative: null };
    assert.equal(sourceOf({ candidate: learn, status: "candidate", decision: { source: "playbook", ref: "playbook key-vault v1", status: "Resolved" } }), "Service playbook");
    assert.equal(sourceOf({ candidate: learn, status: "candidate", decision: { source: "learn", status: "Resolved" } }), "Microsoft Learn");
    const pattern = { source: "pattern", pattern: "DR-DNS-001", version: 1 };
    assert.equal(sourceOf({ candidate: pattern, status: "candidate", decision: { source: "playbook", ref: "playbook key-vault v1", status: "Resolved" } }), "DR-DNS-001 v1");
    assert.equal(sourceOf({ candidate: learn, status: "candidate", decision: { source: "playbook", status: "Unresolved" } }), "Unresolved");
});

test("section D prints the accepted gaps inside Documented exceptions, and None only when there is no exception of any kind", async () => {
    const r = decided(await resolveWith({ dr_choices: CHOICES }));
    const text = patternsSection({ resolution: r });
    assert.match(text, /### Documented exceptions\n\n\| Accepted gap \| Chosen by \| Date \|\n\| --- \| --- \| --- \|\n\| microsoft\.keyvault\/vaults \| Application owner \| 2026-11-09 \|\n\| microsoft\.cache\/redis \| Data owner \| 2026-11-10 \|\n\nThis skill records the choice\. It cannot verify it\.(\n|$)/);
    assert.doesNotMatch(text, /None\./);

    const both = decided(await resolveWith({ dr_choices: CHOICES, objectives: { tier: 1, exceptions: [{ what: "RTO 10m", approver_role: "CTO", date: "2026-11-04" }] } }));
    assert.match(patternsSection({ resolution: both }), /\| RTO 10m \| CTO \| 2026-11-04 \|\n\n\| Accepted gap \| Chosen by \| Date \|/);

    const defaults = decided(await resolveWith({ dr_choices: [choice("microsoft.storage/storageaccounts", "accept-gap", "default")] }));
    assert.match(patternsSection({ resolution: defaults }), /### Documented exceptions\n\nNone\./);
});

test("section B lists the option and playbook-claim entries and the playbook claims that Learn contradicts", () => {
    const region = (id, check, fields) => ({ id, kind: "region", check, subject: "microsoft.keyvault/vaults", status: "Verified", class: null, doc: "D-0001", quote: null, substitute: null, ...fields });
    const ledger = {
        entries: [
            { id: "D-0001", kind: "doc", url: "https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault", title: "Reliability in Key Vault", retrievedAt: "2026-11-09T10:00:00.000Z", status: "Verified", supports: "constraints" },
            region("R-0001", "playbook-claim", { quote: "Backups restore only within the same geography.", result: { playbook: "key-vault", claim: "Backups restore only in the same subscription and geography", agrees: true } }),
            region("R-0002", "playbook-claim", { quote: "Failover is customer-initiated.", result: { playbook: "key-vault", claim: "Microsoft-managed failover is triggered by Microsoft on a best-effort basis", agrees: false } }),
            region("R-0003", "playbook-claim", { status: "Unverified", doc: null, result: { playbook: "key-vault", claim: "Soft delete and purge protection are recommended", agrees: false } }),
            region("R-0004", "option", { subject: "microsoft.example/gadgets", result: { id: "gadget-copy", title: "Copy", kind: "workaround", target: "dr-region", usesMechanism: "none", rpo: "30m", rto: "1h", slot: "compute", givesUp: "managed failover" } }),
        ],
    };
    const text = evidenceSection({ ledger, inventory: null });
    assert.match(text, /\| R-0004 \| option \| microsoft\.example\/gadgets \| Verified \|  \| D-0001 \|  \|/);
    assert.match(text, /\| R-0001 \| playbook-claim \| microsoft\.keyvault\/vaults \| Verified \|  \| D-0001 \|  \|/);
    assert.match(text, /### Playbook claims that Learn contradicts\n\nLearn wins: these playbook constraints are stale\. An option does not name the constraints it rests on, so its status is unchanged: check each option of the service against the claim\.\n\n\| Id \| Playbook \| Claim \| Learn says \| Documentation \|\n\| --- \| --- \| --- \| --- \| --- \|\n\| R-0002 \| key-vault \| Microsoft-managed failover is triggered by Microsoft on a best-effort basis \| Failover is customer-initiated\. \| D-0001 \|$/);
    ledger.entries.splice(2, 1);
    assert.doesNotMatch(evidenceSection({ ledger, inventory: null }), /Playbook claims that Learn contradicts/);
});
