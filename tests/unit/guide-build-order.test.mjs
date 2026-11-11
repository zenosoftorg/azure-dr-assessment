import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_ORDER, fallbackSlot, guideSkeleton, orderTypes } from "../../skills/azure-dr-assessment/scripts/lib/guide.mjs";
import { MINI_TEMPLATE, PLAYBOOKS, minimalDoc, playbookRow } from "../helpers/guide-fixture.mjs";

const bare = (type, slot = null) => ({ type, slot, title: type.split("/").at(-1), count: 1, playbook: null });

test("fallbackSlot gives a type without a slot the slot of its ARM namespace, and null for an unknown namespace", () => {
    assert.equal(fallbackSlot("microsoft.network/virtualnetworks"), "connectivity");
    assert.equal(fallbackSlot("microsoft.network/networksecuritygroups"), "connectivity");
    assert.equal(fallbackSlot("microsoft.network/trafficmanagerprofiles"), "traffic-dns");
    assert.equal(fallbackSlot("microsoft.network/dnszones"), "traffic-dns");
    assert.equal(fallbackSlot("microsoft.insights/actiongroups"), "detection");
    assert.equal(fallbackSlot("microsoft.operationalinsights/querypacks"), "detection");
    assert.equal(fallbackSlot("microsoft.managedidentity/userassignedidentities"), "identity");
    assert.equal(fallbackSlot("microsoft.recoveryservices/vaults"), "backup");
    assert.equal(fallbackSlot("microsoft.contoso/things"), null);
    assert.equal(fallbackSlot("microsoft.network/networkinterfaces"), null, "a NIC is built with its VM");
    for (const type of ["microsoft.network/virtualnetworks", "microsoft.insights/actiongroups", "microsoft.managedidentity/userassignedidentities"]) {
        assert.ok(BUILD_ORDER.includes(fallbackSlot(type)), type);
    }
});

test("M-5: a network type without a playbook sorts first in the build order, a slot of its own wins, an unknown namespace stays after ingress", () => {
    const rows = [
        bare("microsoft.keyvault/vaults", "secrets-keys"), bare("microsoft.contoso/things"), bare("microsoft.web/sites", "compute"),
        bare("microsoft.network/virtualnetworks"), bare("microsoft.insights/actiongroups"), bare("microsoft.network/frontdoors", "ingress"),
        bare("microsoft.network/trafficmanagerprofiles"), bare("microsoft.network/routetables", "compute"),
    ];
    assert.deepEqual(orderTypes(rows).map((row) => row.type), [
        "microsoft.network/virtualnetworks", "microsoft.insights/actiongroups", "microsoft.keyvault/vaults", "microsoft.web/sites",
        "microsoft.network/routetables", "microsoft.network/frontdoors", "microsoft.contoso/things", "microsoft.network/trafficmanagerprofiles",
    ]);
});

test("the build order line names the fallback slot and says where it comes from", () => {
    const playbook = PLAYBOOKS.get("test-service");
    const vnet = {
        ...bare("microsoft.network/virtualnetworks"), title: "Azure Virtual Network", decidedBy: null, path: "none", verified: true, staleClaims: [], ask: false,
        options: [{ id: "accept-gap", title: "Accept the gap and record it as an exception", kind: "accept-gap", targetRegion: null, rpo: null, rto: null, source: "rule", status: "valid", meetsTier: false, residency: "ok", givesUp: "DR for this service", ledger: [] }],
        recommended: "accept-gap", choice: null,
    };
    const doc = minimalDoc([playbookRow(playbook, "microsoft.test/widgets", "second-copy"), vnet]);
    const { text, chapters } = guideSkeleton({ doc, playbooks: PLAYBOOKS, template: MINI_TEMPLATE });
    assert.deepEqual(chapters.map((c) => c.type), ["microsoft.network/virtualnetworks", "microsoft.test/widgets"]);
    assert.match(text, /^1\. \[Azure Virtual Network\]\(#chapter-microsoft-network-virtualnetworks\) \(`microsoft\.network\/virtualnetworks`\): slot `connectivity` \(from the ARM namespace\); Accept the gap: /m);
});
