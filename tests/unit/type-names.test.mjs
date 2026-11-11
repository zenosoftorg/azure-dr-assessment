import assert from "node:assert/strict";
import test from "node:test";
import { classifyType, shortNames } from "../../skills/azure-dr-assessment/scripts/lib/dr-options.mjs";
import { KNOWN_SHORTS, splitTypeWords, typeTitle } from "../../skills/azure-dr-assessment/scripts/lib/type-names.mjs";

const REGIONS = { primary: "westeurope", dr: "swedencentral", primaryPair: "northeurope", paired: false };

test("typeTitle takes the service name of the Learn catalogue when it names one service for the type", () => {
    assert.equal(typeTitle("microsoft.network/virtualnetworks"), "Azure Virtual Network");
    assert.equal(typeTitle("microsoft.network/bastionhosts"), "Azure Bastion");
    assert.equal(typeTitle("MICROSOFT.NETWORK/VirtualNetworks"), "Azure Virtual Network", "the type is compared in lower case");
});

test("typeTitle falls back to the ARI sheet name, and skips a catalogue entry that names several services", () => {
    assert.equal(typeTitle("microsoft.network/networkinterfaces"), "Network Interface");
    assert.equal(typeTitle("microsoft.network/networksecuritygroups"), "Network Security Groups");
    assert.equal(typeTitle("microsoft.network/virtualnetworkgateways"), "VNET Gateways", "Learn names VPN Gateway and ExpressRoute for it: ambiguous");
});

test("typeTitle splits the last segment of any other type into words, in sentence case", () => {
    assert.equal(typeTitle("microsoft.contoso/virtualnetworks"), "Virtual networks");
    assert.equal(typeTitle("microsoft.network/applicationsecuritygroups"), "Application security groups");
    assert.equal(typeTitle("microsoft.network/networkwatchers"), "Network watchers");
    assert.equal(typeTitle("microsoft.example/gadgets"), "Gadgets", "an unknown word stays whole");
    assert.deepEqual(splitTypeWords("privateendpointconnections"), ["private", "endpoint", "connections"]);
    assert.deepEqual(splitTypeWords("xyzzy"), ["xyzzy"]);
});

test("a classified type without a playbook carries the readable title", () => {
    const row = classifyType({ type: "microsoft.network/virtualnetworks", count: 1, regions: REGIONS, today: "2026-11-10" });
    assert.equal(row.title, "Azure Virtual Network");
});

test("shortNames uses the well-known abbreviation of a network type: VNET, not VI, and stays unique", () => {
    assert.equal(KNOWN_SHORTS["microsoft.network/virtualnetworks"], "VNET");
    const rows = [
        { type: "microsoft.keyvault/vaults", title: "Azure Key Vault" },
        { type: "microsoft.network/virtualnetworks", title: "Azure Virtual Network" },
        { type: "microsoft.network/networkinterfaces", title: "Network Interface" },
        { type: "microsoft.network/networksecuritygroups", title: "Network Security Groups" },
        { type: "microsoft.contoso/virtualnetworks", title: "Virtual networks" },
        { type: "microsoft.example/vnet", title: "VNET" },
    ];
    assert.deepEqual(shortNames(rows), ["KV", "VNET", "NIC", "NSG", "VN", "VN2"]);
    assert.deepEqual(shortNames([{ type: "microsoft.network/virtualnetworks", title: "x" }, { type: "microsoft.network/virtualnetworks", title: "x" }]), ["VNET", "VNET2"]);
});
