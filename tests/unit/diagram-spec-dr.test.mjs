import assert from "node:assert/strict";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { EXCEPTIONS_GROUP_LABEL, docUrls } from "../../skills/azure-dr-assessment/scripts/lib/diagram-dr.mjs";
import { sourceOf } from "../../skills/azure-dr-assessment/scripts/lib/decision-source.mjs";
import { buildDiagram, validateDiagramSpec } from "../../skills/azure-dr-assessment/scripts/lib/diagram-spec.mjs";
import { NON_DEFAULT_PACK_SUFFIX } from "../../skills/azure-dr-assessment/scripts/lib/diagram-style.mjs";
import { loadCanvasModules } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { KEY_VAULT_URL, LEARN_URL, makeDrLedger, makeDrResolution, readDrSpec } from "../helpers/dr-diagram-fixture.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { SIG } from "../helpers/secret-shapes.mjs";

const canvas = await loadCanvasModules();
const catalog = await canvas.icons.buildCatalog(makeIconRoot());
const ledger = makeDrLedger();
const resolution = makeDrResolution();
const check = (spec, ctx = {}) => validateDiagramSpec(spec, { ledger, kind: "proposed-dr", resolution, ...ctx });
const build = (spec, extra = {}) => buildDiagram(spec, { ledger, catalog, modules: canvas, resolution, ...extra });
const node = (diagram, id) => diagram.nodes.find((n) => n.id === id);
const edge = (diagram, id) => diagram.edges.find((e) => e.id === id);

test("the fixture spec is valid", () => {
    assert.deepEqual(check(readDrSpec()), { ok: true, errors: [] });
});

// [what is wrong, the change that breaks the fixture spec, the error path, a part of the message]
const RULES = [
    ["a group style that belongs to current-state only", (s) => { s.groups[1].style = "inferred"; }, "groups[1].style", "primary, dr, global, onprem, neutral"],
    ["the reserved group label", (s) => { s.groups[2].label = "Documented exceptions"; }, "groups[2].label", "reserved"],
    ["a node without evidence and decisions", (s) => { s.nodes[1].evidence = []; }, "nodes[1].evidence", "needs at least one ledger id"],
    ["a node citing a decision slot that is not in the resolution", (s) => { s.nodes[0].decisions = ["teleport"]; }, "nodes[0].decisions[0]", "is not a slot of the pattern resolution"],
    ["node decisions that are not a list", (s) => { s.nodes[0].decisions = "traffic-dns"; }, "nodes[0].decisions", "array of decision slot ids"],
    ["a node label with the reserved prefix", (s) => { s.nodes[1].label = "Exception: web"; }, "nodes[1].label", "reserved"],
    ["a node citing an id that is not in the ledger", (s) => { s.nodes[1].evidence = ["F-0042"]; }, "nodes[1].evidence[0]", "F-0042 is not in the ledger"],
    ["an edge to a node that does not exist", (s) => { s.edges[0].to = "nowhere"; }, "edges[0].to", "is not a node key"],
    ["an edge kind that belongs to current-state only", (s) => { s.edges[2].kind = "inferred"; }, "edges[2].kind", "observed, replication, traffic, failover, dependency"],
    ["an edge without a label", (s) => { s.edges[2].label = ""; }, "edges[2].label", "non-empty"],
    ["an edge without a mechanism", (s) => { s.edges[3].mechanism = ""; }, "edges[3].mechanism", "non-empty"],
    ["an edge without evidence and decisions", (s) => { s.edges[2].evidence = []; }, "edges[2].evidence", "needs at least one ledger id"],
    ["an edge citing a decision slot that is not in the resolution", (s) => { s.edges[0].decisions = ["nowhere"]; }, "edges[0].decisions[0]", "is not a slot of the pattern resolution"],
    ["an observed edge without an Observed fact", (s) => { s.edges[2].kind = "observed"; }, "edges[2].evidence", "Observed fact"],
];

for (const [title, mutate, at, part] of RULES) {
    test(`rejects ${title}`, () => {
        const spec = readDrSpec();
        mutate(spec);
        const { ok, errors } = check(spec);
        assert.equal(ok, false);
        assert.ok(errors.some((e) => e.path === at && e.message.includes(part)), `expected ${at}: ...${part}..., got ${JSON.stringify(errors)}`);
    });
}

test("a proposed node may cite an Unknown fact or only a decision slot, because it describes a design and not a finding", () => {
    const spec = readDrSpec();
    spec.nodes[1].evidence = ["F-0004"];
    assert.deepEqual(check(spec), { ok: true, errors: [] });
    spec.nodes[1].evidence = [];
    spec.nodes[1].decisions = ["compute"];
    assert.deepEqual(check(spec), { ok: true, errors: [] });
});

test("every problem is reported, in document order", () => {
    const spec = readDrSpec();
    spec.groups[2].label = EXCEPTIONS_GROUP_LABEL;
    spec.nodes[1].evidence = [];
    spec.edges[0].mechanism = "";
    spec.edges[2].decisions = ["nowhere"];
    assert.deepEqual(check(spec).errors.map((e) => e.path), ["groups[2].label", "nodes[1].evidence", "edges[0].mechanism", "edges[2].decisions[0]"]);
});

test("a proposed-dr spec cannot be judged without the pattern resolution", () => {
    for (const bad of [undefined, null, {}, { slots: "none" }]) {
        assert.deepEqual(check(readDrSpec(), { resolution: bad }).errors, [
            { path: "resolution", message: "a proposed-dr spec is checked against pattern-resolution.json: pass it with --resolution" },
        ]);
    }
});

test("the current-state rules are untouched: decisions and mechanisms stay forbidden there", () => {
    const spec = { schemaVersion: 1, kind: "current-state", id: "mini", title: "Mini", nodes: [{ key: "web", label: "web-prod", group: null, evidence: ["F-0001"], decisions: ["traffic-dns"] }] };
    assert.deepEqual(validateDiagramSpec(spec, { ledger, kind: "current-state" }).errors.map((e) => e.path), ["nodes[0].decisions"]);
});

test("the generated lines of a proposed-dr annotation are evidence, mechanism, slot, source and docs, then the model's text", () => {
    const { diagram } = build(readDrSpec());
    assert.equal(node(diagram, "n_dns").annotation, "**Slot:** traffic-dns\n\n**Source:** DR-DNS-001 v1\n\n_Generic icon: the node gives neither an ARM type nor an icon._");
    assert.equal(node(diagram, "n_web").annotation, "**Evidence:** F-0001");
    assert.equal(node(diagram, "n_db").annotation, "**Evidence:** F-0002\n\n**Slot:** data-replication.relational\n\n**Source:** Microsoft Learn");
    assert.equal(node(diagram, "n_db-dr").annotation, `**Evidence:** R-0001, D-0001\n\n**Slot:** data-replication.relational\n\n**Source:** Microsoft Learn\n\n**Docs:** ${LEARN_URL}`);
    assert.equal(
        node(diagram, "n_vault-dr").annotation,
        `**Evidence:** R-0002, D-0001, F-0004\n\n**Slot:** secrets-keys\n\n**Source:** Microsoft Learn\n\n**Docs:** ${LEARN_URL}\n\nSecrets are copied by the release pipeline.`,
    );
    assert.equal(edge(diagram, "e_dns_web_0").annotation, "**Mechanism:** the on-prem record points to the primary entry point\n\n**Slot:** traffic-dns\n\n**Source:** DR-DNS-001 v1");
    assert.equal(
        edge(diagram, "e_dns_web-dr_0").annotation,
        "**Mechanism:** on-prem record change at failover; the TTL wait counts toward RTO\n\n**Slot:** traffic-dns\n\n**Source:** DR-DNS-001 v1",
    );
    assert.equal(edge(diagram, "e_web_db_0").annotation, "**Evidence:** F-0003\n\n**Mechanism:** application connection");
    assert.equal(
        edge(diagram, "e_db_db-dr_0").annotation,
        `**Evidence:** R-0001, D-0001\n\n**Mechanism:** SQL Database active geo-replication\n\n**Slot:** data-replication.relational\n\n**Source:** Microsoft Learn\n\n**Docs:** ${LEARN_URL}`,
    );
});

test("groups and edges take their colors from the proposed-dr styles", () => {
    const { diagram } = build(readDrSpec());
    assert.deepEqual(diagram.groups.slice(0, 3).map((g) => [g.id, g.border, g.dashed]), [
        ["g_onprem", "#57606a", false], ["g_primary", "#0969da", false], ["g_dr", "#8250df", false],
    ]);
    assert.deepEqual(diagram.edges.map((e) => [e.id, e.color, e.dashed]), [
        ["e_dns_web_0", "#1a7f37", false],
        ["e_dns_web-dr_0", "#cf222e", true],
        ["e_web_db_0", "#57606a", false],
        ["e_db_db-dr_0", "#8250df", false],
        ["e_web-dr_db-dr_0", "#57606a", false],
    ]);
});

test("a decision slot with several sources lists each once, and a collision or an Azure veto says so", () => {
    const spec = readDrSpec();
    spec.nodes[0].decisions = ["traffic-dns", "objectives", "traffic-dns"];
    spec.nodes[1].decisions = ["ingress"];
    spec.nodes[2].decisions = ["compute"];
    const custom = makeDrResolution();
    const slot = (name) => custom.slots.find((s) => s.slot === name);
    Object.assign(slot("ingress"), { status: "unresolved", collision: ["DR-A-001 v1", "DR-B-001 v1"], candidate: { source: "collision" } });
    slot("ingress").decision = { text: "Two patterns collide", source: "pattern", ref: null, status: "Unresolved", azureReality: "", ledger: [], alternative: null };
    slot("compute").decision = { text: "No such tier in the DR region", source: "azure-reality", ref: "R-0001", status: "Unmet requirement", azureReality: "the SKU is not offered", ledger: [], alternative: null };
    const { diagram } = build(spec, { resolution: custom });
    assert.match(node(diagram, "n_dns").annotation, /\*\*Slot:\*\* traffic-dns, objectives, traffic-dns\n\n\*\*Source:\*\* DR-DNS-001 v1; DR-TIER-001 v1\n\n/);
    assert.match(node(diagram, "n_web").annotation, /\*\*Slot:\*\* ingress\n\n\*\*Source:\*\* Unresolved$/);
    assert.match(node(diagram, "n_db").annotation, /\*\*Slot:\*\* compute\n\n\*\*Source:\*\* Azure reality$/);
});

test("the source of a decision comes from the candidate and never from the free-text ref", () => {
    const row = (candidate, decision, status = "candidate") => ({ slot: "x", candidate, decision, status });
    const pattern = { source: "pattern", pattern: "DR-DNS-001", version: 2, overrideIndex: null, alternative: null };
    const override = { source: "override", pattern: "DR-DNS-001", version: 1, overrideIndex: 3, alternative: "x" };
    assert.equal(sourceOf(row(pattern, { status: "Resolved", source: "pattern", ref: "DR-OTHER-009 v9" })), "DR-DNS-001 v2");
    assert.equal(sourceOf(row(override, { status: "Resolved", source: "override", ref: "whatever" })), "Override #3 of DR-DNS-001 (documented exception)");
    assert.equal(sourceOf(row({ source: "learn" }, { status: "Resolved", source: "learn", ref: null })), "Microsoft Learn");
    assert.equal(sourceOf(row(pattern, { status: "Unmet requirement", source: "azure-reality", ref: "R-0001" })), "Azure reality");
    assert.equal(sourceOf(row({ source: "collision" }, { status: "Unresolved", source: "pattern" }, "unresolved")), "Unresolved");
    assert.equal(sourceOf(row(pattern, null)), "DR-DNS-001 v2");
});

test("a row whose source is missing or not recognized reads as Unknown, never as Microsoft Learn", () => {
    assert.equal(sourceOf({ slot: "x" }), "Unknown");
    assert.equal(sourceOf({ slot: "x", candidate: {}, decision: { status: "Resolved", source: "invented" }, status: "candidate" }), "Unknown");
    assert.equal(sourceOf({ slot: "x", candidate: { source: "pattern" }, decision: null, status: "candidate" }), "Unknown");
    assert.equal(sourceOf({ slot: "x", candidate: { source: "override" }, decision: null, status: "candidate" }), "Unknown");
});

test("a decision whose source disagrees with the candidate shows the candidate, and only the Azure veto replaces it", () => {
    const row = (candidate, decision, status = "candidate") => ({ slot: "x", candidate, decision, status });
    const pattern = { source: "pattern", pattern: "DR-DNS-001", version: 2, overrideIndex: null, alternative: null };
    const override = { source: "override", pattern: "DR-DNS-001", version: 1, overrideIndex: 3, alternative: "x" };
    assert.equal(sourceOf(row(pattern, { status: "Resolved", source: "learn", ref: null })), "DR-DNS-001 v2");
    assert.equal(sourceOf(row(pattern, { status: "Resolved", source: "override", ref: "whatever" })), "DR-DNS-001 v2");
    assert.equal(sourceOf(row(override, { status: "Resolved", source: "learn", ref: null })), "Override #3 of DR-DNS-001 (documented exception)");
    assert.equal(sourceOf(row(override, { status: "Resolved", source: "pattern", ref: "DR-DNS-001 v1" })), "Override #3 of DR-DNS-001 (documented exception)");
    assert.equal(sourceOf(row({ source: "learn" }, { status: "Resolved", source: "pattern", ref: "DR-DNS-001 v2" })), "Microsoft Learn");
    assert.equal(sourceOf(row({ source: "mystery" }, { status: "Resolved", source: "learn", ref: null })), "Unknown");
    assert.equal(sourceOf(row({}, { status: "Resolved", source: "pattern", ref: "DR-DNS-001 v2" })), "Unknown");
    assert.equal(sourceOf(row(pattern, { status: "Unmet requirement", source: "azure-reality", ref: "R-0001" })), "Azure reality");
    assert.equal(sourceOf(row({ source: "mystery" }, { status: "Unmet requirement", source: "azure-reality", ref: "R-0001" })), "Azure reality");
});

test("a source name that only the object prototype knows reads as Unknown, not as a function or an object", () => {
    const pattern = { source: "pattern", pattern: "DR-DNS-001", version: 2, overrideIndex: null, alternative: null };
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
        assert.equal(sourceOf({ slot: "x", candidate: { source: name }, decision: null, status: "candidate" }), "Unknown", name);
        assert.equal(sourceOf({ slot: "x", candidate: { source: name }, decision: { status: "Resolved", source: name, ref: null }, status: "candidate" }), "Unknown", name);
        assert.equal(sourceOf({ slot: "x", candidate: pattern, decision: { status: "Resolved", source: name, ref: null }, status: "candidate" }), "DR-DNS-001 v2", name);
    }
});

test("docUrls follows a region entry to its document, skips a document without a URL and repeats nothing", () => {
    const entries = ["R-0001", "D-0001", "R-0002", "D-0002", "F-0001"].map((id) => ledger.get(id));
    assert.deepEqual(docUrls(entries, ledger), [LEARN_URL]);
    assert.equal(ledger.get("R-0002").substitute.ref, KEY_VAULT_URL);
});

test("an applied override shows as the source and, with every exception, as a node in the Documented exceptions group", () => {
    const both = makeDrResolution({ dnsOverride: true, tierException: true });
    const { diagram, genericIcons } = build(readDrSpec(), { resolution: both });
    assert.match(node(diagram, "n_dns").annotation, /\*\*Source:\*\* Override #0 of DR-DNS-001 \(documented exception\)/);

    const group = diagram.groups.find((g) => g.label === EXCEPTIONS_GROUP_LABEL);
    assert.deepEqual([group.id, group.parent, group.border, group.dashed], ["g_documented_exceptions", null, "#8c959f", true]);
    const exceptions = diagram.nodes.filter((n) => n.group === group.id);
    assert.deepEqual(exceptions.map((n) => [n.id, n.label, n.sublabel, n.iconId]), [
        ["n_exception_0", "Exception: DR-DNS-001 traffic-dns", "override", "azure:information"],
        ["n_exception_1", "Exception: DR-TIER-001 objectives", "tier exception", "azure:information"],
    ]);
    assert.equal(exceptions[0].annotation, [
        "**Pattern:** DR-DNS-001 (approval-required)",
        "**Slots:** traffic-dns",
        "**Justification:** Internet-facing only",
        "**Owner role:** Application owner",
        "**Date:** 2026-11-04",
        "**Approver role:** Platform architecture board",
        "**Approval reference:** ARB-2026-114",
        "**Alternative used:** Azure Front Door with health probes",
        "_This skill records the approval. It cannot verify it._",
    ].join("\n\n"));
    assert.equal(exceptions[1].annotation, [
        "**Exception:** RTO 10m stays unmet by tier 1",
        "**Approver role:** CTO",
        "**Date:** 2026-11-04",
        "_This skill records the exception. It cannot verify the approval._",
    ].join("\n\n"));
    assert.deepEqual(genericIcons, ["On-prem DNS"], "the builder's own nodes are not reported as icon fallbacks");
});

test("without an exception there is no Documented exceptions group, and two exceptions with one label stay distinct", () => {
    assert.equal(build(readDrSpec()).diagram.groups.some((g) => g.label === EXCEPTIONS_GROUP_LABEL), false);
    const twice = makeDrResolution({ dnsOverride: true });
    twice.documentedExceptions.push({ ...twice.documentedExceptions[0], index: 2 });
    const { diagram } = build(readDrSpec(), { resolution: twice });
    assert.deepEqual(diagram.nodes.filter((n) => n.group === "g_documented_exceptions").map((n) => n.label), [
        "Exception: DR-DNS-001 traffic-dns",
        "Exception: DR-DNS-001 traffic-dns (#2)",
    ]);
});

test("a repeated exception label carries the override index that the report prints, and the position when the entry has no index", () => {
    const labelsOf = (documentedExceptions) => {
        const custom = makeDrResolution({ dnsOverride: true, tierException: true });
        custom.documentedExceptions = documentedExceptions;
        return build(readDrSpec(), { resolution: custom }).diagram.nodes.filter((n) => n.group === "g_documented_exceptions").map((n) => n.label);
    };
    const [override, tier] = makeDrResolution({ dnsOverride: true, tierException: true }).documentedExceptions;
    assert.deepEqual(labelsOf([override, { ...override, index: 2 }, tier, { ...tier, what: "RPO 5m stays unmet by tier 1" }]), [
        "Exception: DR-DNS-001 traffic-dns",
        "Exception: DR-DNS-001 traffic-dns (#2)",
        "Exception: DR-TIER-001 objectives",
        "Exception: DR-TIER-001 objectives (#3)",
    ]);
    assert.deepEqual(labelsOf([{ ...override, index: 3 }, override, tier]), [
        "Exception: DR-DNS-001 traffic-dns",
        "Exception: DR-DNS-001 traffic-dns (#0)",
        "Exception: DR-TIER-001 objectives",
    ]);
});

test("a non-default pattern pack adds the title suffix to a proposed-dr diagram too", () => {
    assert.equal(
        build(readDrSpec(), { resolution: makeDrResolution({ nonDefaultPack: true }) }).diagram.title,
        `checkout · proposed DR (westeurope to swedencentral)${NON_DEFAULT_PACK_SUFFIX}`,
    );
});

test("buildDiagram refuses an invalid proposed-dr spec, and one built without a resolution, with the problems as details", () => {
    const spec = readDrSpec();
    spec.edges[3].mechanism = "";
    assert.throws(
        () => build(spec),
        (err) => err instanceof CliError && err.code === EXIT.INPUT && err.message === "the diagram spec is invalid"
            && err.details.length === 1 && err.details[0].startsWith("edges[3].mechanism: must be a non-empty string"),
    );
    assert.throws(
        () => build(readDrSpec(), { resolution: undefined }),
        (err) => err instanceof CliError && err.details[0] === "resolution: a proposed-dr spec is checked against pattern-resolution.json: pass it with --resolution",
    );
});

test("two builds of one proposed-dr spec are identical apart from updatedAt", () => {
    const a = build(readDrSpec()).diagram;
    const b = build(readDrSpec()).diagram;
    b.updatedAt = a.updatedAt;
    assert.deepEqual(a, b);
});

// GC-07: the secret-like values are built at run time from parts, so that no file or tool output holds one.
const KEY_LIKE = ["Account", "Key="].join("") + "a".repeat(30);
const SIG_TOKEN = "q".repeat(24);
const SIG_LIKE = `https://tickets.example.com/browse/ARB-2026-114?${SIG}=${SIG_TOKEN}`;
const echoes = (value) => [KEY_LIKE, "a".repeat(30), SIG_LIKE, SIG_TOKEN].some((part) => JSON.stringify(value).includes(part));
const withExceptions = () => makeDrResolution({ dnsOverride: true, tierException: true });

test("a proposed-dr node has no mechanism: any value is rejected with a pointer to the link, null and absent stay fine", () => {
    for (const value of ["SQL Database active geo-replication", ""]) {
        const spec = readDrSpec();
        spec.nodes[1].mechanism = value;
        const { ok, errors } = check(spec);
        assert.equal(ok, false);
        assert.deepEqual(errors.map((e) => e.path), ["nodes[1].mechanism"]);
        assert.match(errors[0].message, /put the mechanism on the link/);
    }
    for (const value of [null, undefined]) {
        const spec = readDrSpec();
        spec.nodes[1].mechanism = value;
        assert.deepEqual(check(spec), { ok: true, errors: [] });
    }
});

test("a secret-like mechanism on a node is refused, so no annotation and no message carries it", () => {
    const spec = readDrSpec();
    spec.nodes[1].mechanism = KEY_LIKE;
    const verdict = check(spec);
    assert.deepEqual(verdict.errors.map((e) => e.path), ["nodes[1].mechanism"]);
    assert.equal(echoes(verdict), false);
    assert.throws(
        () => build(spec),
        (err) => err instanceof CliError && err.code === EXIT.INPUT && err.details.length === 1 && !echoes([err.message, err.details]),
    );
});

// The icon note of a node with no specific icon prints its armType or icon into the annotation, so both are screened like the labels.
for (const field of ["armType", "icon"]) {
    test(`a secret-like ${field} on a proposed-dr node is refused with its path, and no annotation or message carries it`, () => {
        const spec = readDrSpec();
        spec.nodes[0][field] = KEY_LIKE;
        const verdict = check(spec);
        assert.deepEqual(verdict.errors.map((e) => e.path), [`nodes[0].${field}`]);
        assert.match(verdict.errors[0].message, /^looks like a secret \(key, token, password or connection string\) and must not appear in a diagram/);
        assert.equal(echoes(verdict), false);
        assert.throws(
            () => build(spec),
            (err) => err instanceof CliError && err.code === EXIT.INPUT && err.details.length === 1 && !echoes([err.message, err.details]),
        );
    });

    test(`a secret-like ${field} on a current-state node is refused with its path, and no annotation or message carries it`, () => {
        const spec = { schemaVersion: 1, kind: "current-state", id: "mini", title: "Mini", nodes: [{ key: "web", label: "web-prod", group: null, evidence: ["F-0001"], [field]: KEY_LIKE }] };
        const verdict = validateDiagramSpec(spec, { ledger, kind: "current-state" });
        assert.deepEqual(verdict.errors.map((e) => e.path), [`nodes[0].${field}`]);
        assert.match(verdict.errors[0].message, /^looks like a secret/);
        assert.equal(echoes(verdict), false);
        assert.throws(
            () => buildDiagram(spec, { ledger, catalog, modules: canvas }),
            (err) => err instanceof CliError && err.code === EXIT.INPUT && err.details.length === 1 && !echoes([err.message, err.details]),
        );
    });
}

test("an ordinary armType and icon pass the node secret screen and the icon note still names a generic one", () => {
    const spec = readDrSpec();
    spec.nodes[0].armType = "microsoft.example/widgets";
    spec.nodes[1].icon = "azure:app-services";
    assert.deepEqual(check(spec), { ok: true, errors: [] });
    assert.match(node(build(spec).diagram, "n_dns").annotation, /_Generic icon: no specific icon for microsoft\.example\/widgets\._$/);
});

// [what carries the text, the entry of documentedExceptions (0 is the override, 1 the tier exception), its field, the secret-like value, the error path below the entry]
const EXCEPTION_SECRETS = [
    ["an approval reference that is a link with a token", 0, "approval_ref", SIG_LIKE, "approval_ref"],
    ["a justification", 0, "justification", `Agreed in a call, then ${KEY_LIKE}`, "justification"],
    ["an alternative", 0, "alternative", KEY_LIKE, "alternative"],
    ["an owner role", 0, "owner_role", KEY_LIKE, "owner_role"],
    ["an approver role", 0, "approver_role", KEY_LIKE, "approver_role"],
    ["a pattern id", 0, "pattern", KEY_LIKE, "pattern"],
    ["a slot id", 0, "slots", [KEY_LIKE], "slots[0]"],
    ["what a tier exception accepts", 1, "what", KEY_LIKE, "what"],
    ["the approver role of a tier exception", 1, "approver_role", KEY_LIKE, "approver_role"],
];

for (const [title, index, field, value, below] of EXCEPTION_SECRETS) {
    test(`refuses ${title} that looks like a secret, with the path and without the value`, () => {
        const custom = withExceptions();
        custom.documentedExceptions[index][field] = value;
        const verdict = check(readDrSpec(), { resolution: custom });
        assert.equal(verdict.ok, false);
        assert.deepEqual(verdict.errors.map((e) => e.path), [`resolution.documentedExceptions[${index}].${below}`]);
        assert.match(verdict.errors[0].message, /^looks like a secret \(key, token, password or connection string\) and must not appear in a diagram/);
        assert.equal(echoes(verdict), false);
    });
}

test("a key of an exception that is not a plain word is never printed in the error path, even when it is the secret", () => {
    const custom = withExceptions();
    custom.documentedExceptions[0][KEY_LIKE] = KEY_LIKE;
    custom.documentedExceptions[1]["owner note"] = SIG_LIKE;
    const verdict = check(readDrSpec(), { resolution: custom });
    assert.deepEqual(verdict.errors.map((e) => e.path), ["resolution.documentedExceptions[0][?]", "resolution.documentedExceptions[1][?]"]);
    assert.equal(echoes(verdict), false);
});

test("a secret in an exception is listed with the other problems, after the spec's own", () => {
    const spec = readDrSpec();
    spec.nodes[1].evidence = [];
    const custom = withExceptions();
    custom.documentedExceptions[0].approval_ref = SIG_LIKE;
    custom.documentedExceptions[1].what = KEY_LIKE;
    assert.deepEqual(check(spec, { resolution: custom }).errors.map((e) => e.path), [
        "nodes[1].evidence",
        "resolution.documentedExceptions[0].approval_ref",
        "resolution.documentedExceptions[1].what",
    ]);
});

test("buildDiagram refuses a secret in an exception with the path as the only detail, and the value is not echoed", () => {
    const custom = withExceptions();
    custom.documentedExceptions[0].approval_ref = SIG_LIKE;
    assert.throws(
        () => build(readDrSpec(), { resolution: custom }),
        (err) => err instanceof CliError && err.code === EXIT.INPUT && err.message === "the diagram spec is invalid"
            && err.details.length === 1 && err.details[0].startsWith("resolution.documentedExceptions[0].approval_ref: looks like a secret")
            && !echoes([err.message, err.details]),
    );
});

test("ordinary exception text, a ticket link included, passes the secret screen and builds as before", () => {
    const custom = withExceptions();
    custom.documentedExceptions[0].approval_ref = "https://tickets.example.com/browse/ARB-2026-114";
    assert.deepEqual(check(readDrSpec(), { resolution: custom }), { ok: true, errors: [] });
    const { diagram } = build(readDrSpec(), { resolution: custom });
    assert.match(node(diagram, "n_exception_0").annotation, /\*\*Approval reference:\*\* https:\/\/tickets\.example\.com\/browse\/ARB-2026-114\n/);
    assert.deepEqual(diagram.nodes.filter((n) => n.group === "g_documented_exceptions").map((n) => n.id), ["n_exception_0", "n_exception_1"]);
});

test("a secret-like edge mechanism is refused too, and the message does not echo it", () => {
    const spec = readDrSpec();
    spec.edges[3].mechanism = KEY_LIKE;
    const verdict = check(spec);
    assert.deepEqual(verdict.errors.map((e) => e.path), ["edges[3].mechanism"]);
    assert.match(verdict.errors[0].message, /^looks like a secret/);
    assert.equal(echoes(verdict), false);
});
