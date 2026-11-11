import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { GENERIC_ICON, resolveIcon } from "../../skills/azure-dr-assessment/scripts/lib/icon-map.mjs";

const table = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "assets", "arm-icon-map.json"), "utf8")).types;

/** The three things resolveIcon asks of a catalog: size, get(id) and resolve(loose name). */
function catalog(ids, loose = {}) {
    const known = new Map(ids.map((id) => [id, { id }]));
    return { size: known.size, get: (id) => known.get(id), resolve: (term) => (loose[term] ? known.get(loose[term]) : undefined) };
}

test("a Purview account is drawn with the Purview icon, and nothing maps to Azure Information Protection", () => {
    assert.equal(table["microsoft.purview/accounts"], "fabric:purview");
    assert.equal(Object.values(table).includes("azure:azure-information-protection"), false);
});

test("with the Fabric set installed the table's Purview icon is used", () => {
    const installed = catalog(["fabric:purview", "azure:lab-accounts", GENERIC_ICON], { accounts: "azure:lab-accounts" });
    assert.deepEqual(resolveIcon({ armType: "microsoft.purview/accounts" }, installed), { iconId: "fabric:purview", how: "mapped" });
});

test("without the Fabric set a mapped type gets the generic icon, not a closest match on its last type segment", () => {
    const azureOnly = catalog(["azure:lab-accounts", GENERIC_ICON], { accounts: "azure:lab-accounts" });
    assert.deepEqual(resolveIcon({ armType: "microsoft.purview/accounts" }, azureOnly), { iconId: GENERIC_ICON, how: "generic" });
});

test("a type that is not in the table still gets its closest match, and without a catalog the table is trusted", () => {
    assert.deepEqual(resolveIcon({ armType: "microsoft.example/widgets" }, catalog(["azure:widgets"], { widgets: "azure:widgets" })), { iconId: "azure:widgets", how: "closest" });
    assert.deepEqual(resolveIcon({ armType: "microsoft.purview/accounts" }, null), { iconId: "fabric:purview", how: "mapped" });
});

test("a function app keeps its own icon when the spec sets it, because it shares the ARM type of a web app", () => {
    const sites = catalog(["azure:app-services", "azure:function-apps"]);
    assert.deepEqual(resolveIcon({ armType: "microsoft.web/sites" }, sites), { iconId: "azure:app-services", how: "mapped" });
    assert.deepEqual(resolveIcon({ armType: "microsoft.web/sites", icon: "azure:function-apps" }, sites), { iconId: "azure:function-apps", how: "explicit" });
});
