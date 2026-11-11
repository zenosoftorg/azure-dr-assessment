import assert from "node:assert/strict";
import test from "node:test";
import {
    buildCandidates, buildSummary, matchesScope, needsScope, selectorFromScope, selectorIsSet,
} from "../../skills/azure-dr-assessment/scripts/lib/scope.mjs";

let sequence = 0;
const resource = (overrides = {}) => ({
    ref: `ari:Sheet!${++sequence}`, armType: "microsoft.web/sites", name: "n", resourceGroup: "rg-a", subscription: "Sub A",
    subscriptionId: null, location: "westeurope", tags: {}, ...overrides,
});

test("selectorFromScope converts the assessment scope and ignores an incomplete tag", () => {
    assert.deepEqual(selectorFromScope({ resource_groups: ["rg-a"], tag: { name: "app", value: "checkout" }, subscriptions: ["Sub A"] }), {
        resourceGroups: ["rg-a"], tag: { name: "app", value: "checkout" }, subscriptions: ["Sub A"],
    });
    assert.deepEqual(selectorFromScope({ resource_groups: [], tag: { name: "app", value: null }, subscriptions: [] }), {
        resourceGroups: [], tag: null, subscriptions: [],
    });
    assert.deepEqual(selectorFromScope(undefined), { resourceGroups: [], tag: null, subscriptions: [] });
    assert.equal(selectorIsSet(selectorFromScope(undefined)), false);
    assert.equal(selectorIsSet(selectorFromScope({ tag: { name: "a", value: "b" } })), true);
});

test("matchesScope needs every selector that is set and compares case-insensitively", () => {
    const r = resource({ resourceGroup: "RG-Checkout", subscription: "Sub A", subscriptionId: "11111111-1111-1111-1111-111111111111", tags: { App: "Checkout", env: "prod" } });
    const select = (scope) => selectorFromScope(scope);
    assert.equal(matchesScope(r, select({})), true);
    assert.equal(matchesScope(r, select({ resource_groups: ["rg-checkout"] })), true);
    assert.equal(matchesScope(r, select({ resource_groups: ["other", "RG-CHECKOUT"] })), true);
    assert.equal(matchesScope(r, select({ resource_groups: ["other"] })), false);
    assert.equal(matchesScope(r, select({ subscriptions: ["sub a"] })), true);
    assert.equal(matchesScope(r, select({ subscriptions: ["11111111-1111-1111-1111-111111111111"] })), true);
    assert.equal(matchesScope(r, select({ subscriptions: ["Sub B"] })), false);
    assert.equal(matchesScope(r, select({ tag: { name: "app", value: "checkout" } })), true);
    assert.equal(matchesScope(r, select({ tag: { name: "app", value: "billing" } })), false);
    assert.equal(matchesScope(r, select({ tag: { name: "team", value: "x" } })), false);
    assert.equal(matchesScope(r, select({ resource_groups: ["rg-checkout"], tag: { name: "app", value: "checkout" }, subscriptions: ["Sub A"] })), true);
    assert.equal(matchesScope(r, select({ resource_groups: ["rg-checkout"], tag: { name: "app", value: "billing" } })), false);
    assert.equal(matchesScope(resource({ subscriptionId: null }), select({ subscriptions: ["11111111-1111-1111-1111-111111111111"] })), false);
});

test("buildSummary counts by subscription, resource group, location and type, in a stable order", () => {
    const rows = buildSummary([
        resource({ subscription: "Sub B", resourceGroup: "rg-b", location: "northeurope" }),
        resource({ subscription: "Sub A", resourceGroup: "rg-a" }),
        resource({ subscription: "Sub A", resourceGroup: "rg-a" }),
        resource({ subscription: "Sub A", resourceGroup: "rg-a", armType: "microsoft.sql/servers" }),
    ]);
    assert.deepEqual(rows, [
        { subscription: "Sub A", resourceGroup: "rg-a", location: "westeurope", armType: "microsoft.sql/servers", count: 1 },
        { subscription: "Sub A", resourceGroup: "rg-a", location: "westeurope", armType: "microsoft.web/sites", count: 2 },
        { subscription: "Sub B", resourceGroup: "rg-b", location: "northeurope", armType: "microsoft.web/sites", count: 1 },
    ]);
});

test("buildCandidates lists each subscription and resource group pair, plus tag values shared by at least three resources", () => {
    const tagged = (tags) => resource({ tags });
    const resources = [
        tagged({ app: "checkout" }), tagged({ App: "Checkout" }), tagged({ APP: "CHECKOUT" }),
        tagged({ application: "billing" }), tagged({ application: "billing" }),
        tagged({ env: "prod" }), tagged({ env: "prod" }), tagged({ env: "prod" }),
        resource({ subscription: "Sub B", resourceGroup: "rg-b" }),
    ];
    const candidates = buildCandidates(resources);
    assert.deepEqual(candidates, [
        { key: "rg:Sub A/rg-a", subscriptions: ["Sub A"], resourceGroups: ["rg-a"], resources: 8 },
        { key: "rg:Sub B/rg-b", subscriptions: ["Sub B"], resourceGroups: ["rg-b"], resources: 1 },
        { key: "tag:app=checkout", subscriptions: ["Sub A"], resourceGroups: ["rg-a"], resources: 3 },
    ]);
    assert.equal(needsScope(candidates), true);
    assert.equal(needsScope(buildCandidates([resource()])), false);
    assert.equal(needsScope([]), false);

    const more = buildCandidates([...resources, tagged({ workload: "x" }), tagged({ workload: "x" }), tagged({ Workload: "X" }), tagged({ application: "Billing" })]);
    assert.deepEqual(more.map((c) => c.key), ["rg:Sub A/rg-a", "rg:Sub B/rg-b", "tag:app=checkout", "tag:application=billing", "tag:workload=x"]);
    assert.equal(more.find((c) => c.key === "tag:application=billing").resources, 3);
    assert.equal(more.some((c) => c.key.startsWith("tag:env")), false, "env is not a workload tag name");
});
