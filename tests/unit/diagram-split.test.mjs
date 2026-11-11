import assert from "node:assert/strict";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { EXCEPTIONS_GROUP_LABEL, SPLIT_LABEL_PREFIX } from "../../skills/azure-dr-assessment/scripts/lib/diagram-dr.mjs";
import { buildDiagram, validateDiagramSpec } from "../../skills/azure-dr-assessment/scripts/lib/diagram-spec.mjs";
import { GROUP_STYLES } from "../../skills/azure-dr-assessment/scripts/lib/diagram-style.mjs";
import { loadCanvasModules } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { makeDrLedger, makeDrResolution, readDrSpec } from "../helpers/dr-diagram-fixture.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";

const canvas = await loadCanvasModules();
const catalog = await canvas.icons.buildCatalog(makeIconRoot());
const ledger = makeDrLedger();
const resolution = makeDrResolution();
const check = (spec, ctx = {}) => validateDiagramSpec(spec, { ledger, kind: "proposed-dr", resolution, ...ctx });
const build = (spec, extra = {}) => buildDiagram(spec, { ledger, catalog, modules: canvas, resolution, ...extra });

/** The fixture spec with Key Vault split to the primary's pair: a third region group, its node and the cross-region dependency. */
function splitSpec(label = "split: Key Vault only (northeurope)") {
    const spec = readDrSpec();
    spec.groups.push({ key: "split-kv", label, parent: null, style: "split", evidence: [], annotation: "Residency: ok (R-0002)." });
    spec.nodes.push({
        key: "vault-pair", label: "kv-pair", sublabel: "Key Vault · Microsoft-managed failover", armType: "microsoft.keyvault/vaults", icon: null,
        group: "split-kv", evidence: ["R-0002", "D-0001"], decisions: ["secrets-keys"], annotation: "",
    });
    spec.edges.push({
        from: "web-dr", to: "vault-pair", label: "secrets across regions", kind: "dependency", evidence: ["R-0002"], decisions: [],
        mechanism: "cross-region private endpoint", arrow: "forward", annotation: "",
    });
    return spec;
}

test("the split group style is the one of contracts 6.5, for proposed-dr only", () => {
    assert.deepEqual(GROUP_STYLES.split, { border: "#bf8700", background: "rgba(191,135,0,0.08)", dashed: true });
    assert.equal(SPLIT_LABEL_PREFIX, "split: ");
    assert.deepEqual(check(splitSpec()), { ok: true, errors: [] });
    const { diagram } = build(splitSpec());
    const group = diagram.groups.find((g) => g.label === "split: Key Vault only (northeurope)");
    assert.deepEqual([group.border, group.background, group.dashed], ["#bf8700", "rgba(191,135,0,0.08)", true]);
    assert.ok(diagram.nodes.some((n) => n.label === "kv-pair" && n.group === group.id));
    assert.ok(diagram.edges.some((e) => e.label === "secrets across regions"));

    const current = splitSpec();
    current.kind = "current-state";
    assert.ok(validateDiagramSpec(current, { ledger, kind: "current-state" }).errors.some((e) => e.path === "groups[3].style" && e.message === "must be one of primary, inferred, neutral"));
});

test("a split group whose label does not start with split: is refused, and the build writes nothing", () => {
    for (const label of ["Key Vault only (northeurope)", "Split: Key Vault only (northeurope)", "split Key Vault"]) {
        assert.deepEqual(check(splitSpec(label)).errors, [{ path: "groups[3].label", message: "a split group is labelled split: <service> only (<region>)" }], label);
    }
    const other = readDrSpec();
    other.groups[2].label = "split: not a split group";
    assert.deepEqual(check(other), { ok: true, errors: [] });
    assert.throws(() => build(splitSpec("Key Vault in the pair")), (err) => err instanceof CliError && err.code === EXIT.INPUT
        && err.details.includes("groups[3].label: a split group is labelled split: <service> only (<region>)"));
});

test("a dr-choice-gap exception is a node of the Documented exceptions group with its annotation", () => {
    const custom = makeDrResolution({ tierException: true });
    custom.documentedExceptions.push({ kind: "dr-choice-gap", type: "microsoft.web/sites", chosen_by: "Application owner", date: "2026-11-09" });
    const { diagram } = build(readDrSpec(), { resolution: custom });
    const group = diagram.groups.find((g) => g.label === EXCEPTIONS_GROUP_LABEL);
    assert.equal(group.annotation, "Overrides, tier exceptions and accepted DR gaps recorded in assessment.yaml. This skill records them and cannot verify an approval or a choice.");
    const nodes = diagram.nodes.filter((n) => n.group === group.id);
    assert.deepEqual(nodes.map((n) => [n.label, n.sublabel]), [
        ["Exception: DR-TIER-001 objectives", "tier exception"],
        ["Exception: microsoft.web/sites accepted gap", "accepted gap"],
    ]);
    assert.equal(nodes[1].annotation, [
        "**Accepted gap:** microsoft.web/sites",
        "**Chosen by:** Application owner",
        "**Date:** 2026-11-09",
        "_This skill records the choice. It cannot verify it._",
    ].join("\n\n"));
    const tierOnly = build(readDrSpec(), { resolution: makeDrResolution({ tierException: true }) }).diagram.groups.find((g) => g.label === EXCEPTIONS_GROUP_LABEL);
    assert.equal(tierOnly.annotation, "Overrides and tier exceptions recorded in assessment.yaml. This skill records them and cannot verify an approval.");
});

test("the text of a dr-choice-gap exception is screened for secrets before anything is built", () => {
    const custom = makeDrResolution();
    custom.documentedExceptions.push({ kind: "dr-choice-gap", type: "microsoft.web/sites", chosen_by: ["Account", "Key="].join("") + "b".repeat(30), date: "2026-11-09" });
    assert.deepEqual(check(readDrSpec(), { resolution: custom }).errors.map((e) => e.path), ["resolution.documentedExceptions[0].chosen_by"]);
});
