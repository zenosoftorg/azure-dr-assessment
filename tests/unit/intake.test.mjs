import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { applyIntake, missingItems, storedPath } from "../../skills/azure-dr-assessment/scripts/lib/intake.mjs";

const usage = (err) => err instanceof CliError && err.code === EXIT.USAGE;
const cwd = path.resolve("/work/area");
const empty = () => normalizeAssessment({});

test("storedPath keeps a path below the working directory relative and anything else absolute", () => {
    assert.equal(storedPath("ari-export.xlsx", cwd), "ari-export.xlsx");
    assert.equal(storedPath("inputs/ari.xlsx", cwd), "inputs/ari.xlsx");
    assert.equal(storedPath(path.join(cwd, "inputs", "ari.xlsx"), cwd), "inputs/ari.xlsx");
    assert.equal(storedPath("../elsewhere/ari.xlsx", cwd), path.resolve("/work/elsewhere/ari.xlsx"));
    assert.equal(storedPath("/data/ari.xlsx", cwd), path.resolve("/data/ari.xlsx"));
});

test("applyIntake sets what the flags name, normalizes regions and reports only real changes", () => {
    const { assessment, changes } = applyIntake(
        empty(),
        { app: "Checkout Shop", tier: "1", primary: "West Europe", dr: "(Europe) Sweden Central", ari: "ari.xlsx", rto: "2h", rpo: "5m", environment: "production", failureScope: "wider", pauseAfterCurrentState: true },
        { cwd },
    );
    assert.equal(assessment.workload.name, "Checkout Shop");
    assert.equal(assessment.workload.app, "checkout-shop");
    assert.equal(assessment.workload.environment, "production");
    assert.equal(assessment.objectives.tier, 1);
    assert.equal(assessment.objectives.rto, "2h");
    assert.equal(assessment.objectives.rpo, "5m");
    assert.equal(assessment.regions.primary, "westeurope");
    assert.equal(assessment.regions.dr, "swedencentral");
    assert.equal(assessment.regions.failure_scope, "wider");
    assert.equal(assessment.inputs.ari_file, "ari.xlsx");
    assert.equal(assessment.options.pause_after_current_state, true);
    assert.deepEqual(changes, [
        "workload.name", "workload.environment", "objectives.tier", "objectives.rto", "objectives.rpo",
        "regions.primary", "regions.dr", "regions.failure_scope", "inputs.ari_file", "options.pause_after_current_state",
    ]);

    const again = applyIntake(assessment, { tier: "1", primary: "westeurope" }, { cwd });
    assert.deepEqual(again.changes, []);
    assert.deepEqual(again.assessment, assessment);
});

test("a flag replaces only its own field and never mutates the input", () => {
    const base = normalizeAssessment({
        workload: { name: "checkout" },
        regions: { primary: "westeurope", dr: "swedencentral" },
        objectives: { tier: 2, exceptions: [{ what: "RTO 1h", approver_role: "CTO", date: "2026-11-04" }] },
        overrides: [{ pattern: "DR-DNS-001", justification: "j", owner_role: "o", date: "2026-11-04" }],
        decisions: [{ question: "q", answer: "a", date: "2026-11-04" }],
    });
    const before = JSON.stringify(base);
    const { assessment, changes } = applyIntake(base, { tier: "3" }, { cwd });
    assert.equal(JSON.stringify(base), before);
    assert.deepEqual(changes, ["objectives.tier"]);
    assert.equal(assessment.objectives.tier, 3);
    assert.deepEqual(assessment.objectives.exceptions, base.objectives.exceptions);
    assert.deepEqual(assessment.overrides, base.overrides);
    assert.deepEqual(assessment.decisions, base.decisions);
    assert.equal(assessment.regions.dr, "swedencentral");
});

test("live and scope flags fill their fields", () => {
    const { assessment, changes } = applyIntake(
        empty(),
        { subscriptions: " 11111111-1111-1111-1111-111111111111, 22222222-2222-2222-2222-222222222222 ,", tenant: "99999999-9999-9999-9999-999999999999", scopeResourceGroups: ["rg-checkout", "rg-shared"], scopeTag: "app=checkout", scopeSubscriptions: ["Sub A"] },
        { cwd },
    );
    assert.deepEqual(assessment.inputs.live.subscription_ids, ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]);
    assert.equal(assessment.inputs.live.tenant_id, "99999999-9999-9999-9999-999999999999");
    assert.deepEqual(assessment.scope.resource_groups, ["rg-checkout", "rg-shared"]);
    assert.deepEqual(assessment.scope.tag, { name: "app", value: "checkout" });
    assert.deepEqual(assessment.scope.subscriptions, ["Sub A"]);
    assert.deepEqual(changes, ["inputs.live.subscription_ids", "inputs.live.tenant_id", "scope.resource_groups", "scope.tag", "scope.subscriptions"]);
});

test("a bad flag value is a usage error that names the flag", () => {
    const bad = [
        [{ app: "  " }, /--app/],
        [{ tier: "7" }, /--tier must be 0, 1, 2 or 3/],
        [{ tier: "one" }, /--tier/],
        [{ rto: "near zero" }, /--rto must be a numeric duration/],
        [{ rpo: "soon" }, /--rpo/],
        [{ primary: "   " }, /--primary/],
        [{ dr: "Sweden Central, Norway East" }, /--dr names more than one region/],
        [{ dr: "Sweden Central and Norway East" }, /--dr names more than one region/],
        [{ dr: "swedencentral/norwayeast" }, /--dr names more than one region/],
        [{ primary: "West Europe; North Europe" }, /--primary names more than one region/],
        [{ dr: "Sweden Central & Norway East" }, /--dr names more than one region/],
        [{ dr: "swedencentral+norwayeast" }, /--dr names more than one region/],
        [{ primary: "West Europe | North Europe" }, /--primary names more than one region/],
        [{ primary: "West Europe\nNorth Europe" }, /--primary names more than one region/],
        [{ failureScope: "galaxy" }, /--failure-scope must be one of zonal, regional, wider/],
        [{ scopeTag: "nonsense" }, /--scope-tag must be name=value/],
        [{ scopeTag: "=value" }, /--scope-tag/],
        [{ subscriptions: " , " }, /--subscriptions/],
    ];
    for (const [given, pattern] of bad) {
        assert.throws(() => applyIntake(empty(), given, { cwd }), (err) => usage(err) && pattern.test(err.message), JSON.stringify(given));
    }
});

test("a list of regions is refused and the message names the way forward", () => {
    assert.throws(
        () => applyIntake(empty(), { dr: "Sweden Central, Norway East" }, { cwd }),
        (err) => usage(err) && err.details.some((line) => /run the skill again for each other candidate region/.test(line)),
    );
    assert.throws(
        () => applyIntake(empty(), { primary: "West Europe, North Europe" }, { cwd }),
        (err) => usage(err) && err.details.some((line) => /scope selector/.test(line)),
    );
});

test("North Europe, Norway East and Central US EUAP are single regions, not lists", () => {
    const { assessment } = applyIntake(empty(), { primary: "North Europe", dr: "Norway East" }, { cwd });
    assert.equal(assessment.regions.primary, "northeurope");
    assert.equal(assessment.regions.dr, "norwayeast");
    const wide = applyIntake(empty(), { primary: "(Europe) West Europe", dr: "Central US EUAP" }, { cwd });
    assert.equal(wide.assessment.regions.dr, "centraluseuap");
});

test("a line break around a region value is only whitespace, a line break inside it still makes a list", () => {
    const { assessment } = applyIntake(empty(), { primary: "\r\nWest Europe", dr: "Sweden Central\n" }, { cwd });
    assert.equal(assessment.regions.primary, "westeurope");
    assert.equal(assessment.regions.dr, "swedencentral");
    const framed = applyIntake(empty(), { primary: "\n(Europe) West Europe\r\n", dr: " Central US EUAP \n\n" }, { cwd });
    assert.equal(framed.assessment.regions.primary, "westeurope");
    assert.equal(framed.assessment.regions.dr, "centraluseuap");

    const lists = ["West Europe\nNorth Europe", "West Europe\r\nNorth Europe", "West Europe, North Europe", "West Europe and North Europe", "westeurope/northeurope", "West Europe; North Europe", "West Europe & North Europe", "westeurope+northeurope", "West Europe | North Europe"];
    for (const list of lists) {
        for (const given of [list, `\n${list}`, `${list}\r\n`, `\r\n${list}\n`]) {
            assert.throws(() => applyIntake(empty(), { dr: given }, { cwd }), (err) => usage(err) && /--dr names more than one region/.test(err.message), JSON.stringify(given));
        }
    }
});

test("missingItems asks for the tier first, then the regions and the source together", () => {
    assert.deepEqual(missingItems(empty()).map((item) => item.field), ["objectives.tier", "regions.primary", "regions.dr", "inputs"]);
    const withTier = applyIntake(empty(), { tier: "0" }, { cwd }).assessment;
    assert.deepEqual(missingItems(withTier).map((item) => item.field), ["regions.primary", "regions.dr", "inputs"]);
    const complete = applyIntake(empty(), { tier: "1", primary: "westeurope", dr: "swedencentral", subscriptions: "11111111-1111-1111-1111-111111111111" }, { cwd }).assessment;
    assert.deepEqual(missingItems(complete), []);
    const viaAri = applyIntake(empty(), { tier: "1", primary: "westeurope", dr: "swedencentral", ari: "a.xlsx" }, { cwd }).assessment;
    assert.deepEqual(missingItems(viaAri), []);
    assert.match(missingItems(empty())[3].ask, /ARI \.xlsx file, or Azure subscription ids/);
});
