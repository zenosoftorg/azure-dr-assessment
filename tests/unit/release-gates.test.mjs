import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const DNS_SENTENCE = "The pattern owner confirms this text before the first release.";
const BANDS_MARKER = "release gate Bands";

/** What the repository looks like right now, as far as the release gates are concerned. */
function repositoryState() {
    return {
        releasing: read("RELEASING.md"),
        hasLicense: existsSync(path.join(root, "LICENSE")),
        manifest: JSON.parse(read(".claude-plugin/plugin.json")),
        notice: read("NOTICE.md"),
        dnsPattern: read("skills/azure-dr-assessment/patterns/DR-DNS-001.md"),
        tierPattern: read("skills/azure-dr-assessment/patterns/DR-TIER-001.md"),
        gitignore: read(".gitignore"),
    };
}

/** One problem for each gate whose box disagrees with the files. A ticked box needs its artifacts, an open box must not have them. */
function gateProblems({ releasing, hasLicense, manifest, notice, dnsPattern, tierPattern, gitignore }) {
    const box = (name) => {
        const match = new RegExp(`^- \\[([ x])\\] \\*\\*${name}\\.`, "m").exec(releasing);
        return match === null ? null : match[1] === "x";
    };
    const problems = [];
    const [r1, dns, icons, bands] = [box("R1"), box("DNS"), box("Icons"), box("Bands")];
    for (const [name, value] of [["R1", r1], ["DNS", dns], ["Icons", icons], ["Bands", bands]]) {
        if (value === null) problems.push(`RELEASING.md has no gate ${name}`);
    }
    if (r1 !== null) {
        if (hasLicense !== r1) problems.push(`R1 is ${r1 ? "closed" : "open"}, but LICENSE ${hasLicense ? "exists" : "is missing"}`);
        const licensed = typeof manifest.license === "string" && manifest.license.length > 0;
        if (licensed !== r1) problems.push(`R1 is ${r1 ? "closed" : "open"}, but the plugin manifest ${licensed ? "names" : "lacks"} a licence`);
        if (notice.includes("release gate R1") === r1) problems.push(`R1 is ${r1 ? "closed" : "open"}, but NOTICE.md ${r1 ? "still calls" : "no longer calls"} it open`);
    }
    if (dns !== null && dnsPattern.includes(DNS_SENTENCE) === dns) {
        problems.push(`DNS is ${dns ? "closed" : "open"}, but DR-DNS-001 ${dns ? "still asks" : "no longer asks"} for the owner's confirmation`);
    }
    if (icons !== null && notice.includes("Icon distribution decision: ") !== icons) {
        problems.push(`Icons is ${icons ? "closed" : "open"}, but NOTICE.md ${icons ? "records no" : "already records a"} decision`);
    }
    if (bands !== null && tierPattern.includes(BANDS_MARKER) === bands) {
        problems.push(`Bands is ${bands ? "closed" : "open"}, but DR-TIER-001 ${bands ? "still marks" : "no longer marks"} the Tier 1 RPO band as a derived reading`);
    }
    if (!gitignore.includes("Final SVG Icons/")) problems.push("the icons are no longer ignored: vendoring them needs its own plan");
    return problems;
}

test("RELEASING.md lists the four gates in order, every box agrees with the repository, and every path that a gate names exists", () => {
    const { releasing } = repositoryState();
    assert.deepEqual([...releasing.matchAll(/^- \[[ x]\] \*\*(R1|DNS|Icons|Bands)\./gm)].map((match) => match[1]), ["R1", "DNS", "Icons", "Bands"]);
    assert.deepEqual(gateProblems(repositoryState()), []);
    const gates = releasing.split("\n## Checks on a real machine")[0];
    const named = [...gates.matchAll(/`((?:skills|tests)\/[^`\s<>*]+)`/g)].map((match) => match[1]);
    assert.ok(named.length >= 10, "the gates name the files that their steps change");
    for (const file of named) assert.ok(existsSync(path.join(root, file)), `RELEASING.md names ${file}, which does not exist`);
});

test("the gate check finds a LICENSE, a manifest licence or a NOTICE line that disagrees with an R1 box", () => {
    const state = repositoryState();
    const closed = { ...state, releasing: state.releasing.replace("- [ ] **R1.", "- [x] **R1.") };
    assert.equal(gateProblems(closed).length, 3, "ticking R1 alone is three problems");
    const consistent = { ...closed, hasLicense: true, manifest: { ...state.manifest, license: "MIT" }, notice: state.notice.replaceAll("release gate R1", "the owner's decision of 2026-11-04") };
    assert.deepEqual(gateProblems(consistent), []);
    assert.equal(gateProblems({ ...consistent, hasLicense: false }).length, 1);
    assert.equal(gateProblems({ ...state, hasLicense: true }).length, 1, "a LICENSE with an open gate is a problem too");
});

test("the gate check finds a DR-DNS-001 that disagrees with the DNS box, and a NOTICE decision that disagrees with the Icons box", () => {
    const state = repositoryState();
    assert.ok(state.dnsPattern.includes(DNS_SENTENCE), "the sentence is in DR-DNS-001 while the gate is open");
    const dnsTicked = { ...state, releasing: state.releasing.replace("- [ ] **DNS.", "- [x] **DNS.") };
    assert.equal(gateProblems(dnsTicked).length, 1);
    assert.deepEqual(gateProblems({ ...dnsTicked, dnsPattern: state.dnsPattern.replace(DNS_SENTENCE, "") }), []);
    const iconsTicked = { ...state, releasing: state.releasing.replace("- [ ] **Icons.", "- [x] **Icons.") };
    assert.equal(gateProblems(iconsTicked).length, 1);
    assert.deepEqual(gateProblems({ ...iconsTicked, notice: `${state.notice}\nIcon distribution decision: download on first use, 2026-11-04.\n` }), []);
});

test("the gate check finds a DR-TIER-001 that disagrees with the Bands box", () => {
    const state = repositoryState();
    assert.ok(state.tierPattern.includes(BANDS_MARKER), "the comment is in DR-TIER-001 while the gate is open");
    const bandsTicked = { ...state, releasing: state.releasing.replace("- [ ] **Bands.", "- [x] **Bands.") };
    assert.equal(gateProblems(bandsTicked).length, 1, "ticking Bands while the comment stands is a problem");
    assert.deepEqual(gateProblems({ ...bandsTicked, tierPattern: state.tierPattern.replace(/^ +# Derived reading.*release gate Bands.*\n/m, "") }), []);
    assert.equal(gateProblems({ ...state, tierPattern: state.tierPattern.replace(/^ +# Derived reading.*release gate Bands.*\n/m, "") }).length, 1, "a removed comment with an open gate is a problem too");
});

test("the gate check refuses a repository that no longer ignores the icon cache", () => {
    const state = repositoryState();
    assert.deepEqual(gateProblems({ ...state, gitignore: state.gitignore.replace("Final SVG Icons/", "") }), ["the icons are no longer ignored: vendoring them needs its own plan"]);
});

test("the package and the plugin manifest carry one version", () => {
    assert.equal(JSON.parse(read("package.json")).version, JSON.parse(read(".claude-plugin/plugin.json")).version);
});
