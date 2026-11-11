import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Pins for the texts changed by the second live acceptance fix wave.
const root = path.resolve(import.meta.dirname, "..", "..");
const skill = path.join(root, "skills", "azure-dr-assessment");
const read = (...parts) => readFileSync(path.join(skill, ...parts), "utf8");
const stage = (name) => read("references", "stages", name);
const flat = (text) => text.replace(/\s+/g, " ");
const blockquotes = (text) => {
    const blocks = [];
    let current = [];
    for (const line of text.split("\n")) {
        if (line.startsWith(">")) current.push(line);
        else if (current.length) { blocks.push(current.join("\n")); current = []; }
    }
    if (current.length) blocks.push(current.join("\n"));
    return blocks;
};

test("SKILL.md carries the DR-TIER-001 question block byte for byte, and the reply is that block alone", () => {
    const pattern = read("patterns", "DR-TIER-001.md").split("## Mandatory first step")[1].split(/^## /m)[0];
    const question = blockquotes(pattern)[0];
    assert.match(question, /^> \*\*Which landing zone DR tier applies to this application\?\*\*/);
    assert.match(question, /Reply with \*\*0, 1, 2, or 3\*\*/);
    const skillText = read("SKILL.md");
    assert.ok(blockquotes(skillText).includes(question), "SKILL.md holds the question block of the pattern, byte for byte");
    const section = flat(skillText).split("## The tier question")[1].split(" ## ")[0];
    assert.match(section, /When the tier is missing, the reply is the block below and nothing else: no table, no commentary, no other question, no design text/);
    assert.match(section, /It is the same text as `gates\[0\]\.question`/);
});

test("no architecture, diagram or design text is produced until both regions are known, and a missing DR region is never an open assumption", () => {
    const rule = /No architecture, diagram or design text is produced until the primary region and the DR region are both known\. Ask for what is missing, the regions and the scope together; a missing DR region is never an open assumption/;
    assert.match(flat(read("SKILL.md")), rule);
    const intake = flat(stage("02-intake.md"));
    assert.match(intake, rule);
    assert.match(intake, /This also holds in the turn after the tier answer: a design with "recovery region unresolved" is wrong, ask for the regions/);
});

test("a decision in assessment.yaml records the owner's choice and does not resolve a collision; the answer names both ways (SKILL.md, stage 6, pattern guide, DR-04)", () => {
    const records = /A decision recorded in `assessment\.yaml` `decisions\[\]` documents the owner's choice; the slot stays Unresolved in the resolution file until a `supersedes` link removes the collision/;
    const ways = /a `supersedes` link between the patterns, or a decision recorded under `decisions\[\]` in `assessment\.yaml`/;
    const scenarios = readFileSync(path.join(root, "tests", "scenarios.md"), "utf8");
    const dr04 = scenarios.split(/^## DR-04:/m)[1].split(/^## /m)[0];
    for (const [name, text] of [["SKILL.md", read("SKILL.md")], ["stage 6", stage("06-dr-design.md")], ["patterns.md", read("references", "patterns.md")]]) {
        assert.match(flat(text), records, `${name} says that the decision documents the choice`);
        assert.match(flat(text), ways, `${name} names both ways in the answer sentence`);
        assert.doesNotMatch(flat(text), /`assessment\.yaml` resolves it/, `${name} does not say that a decision resolves the collision`);
    }
    assert.match(flat(stage("06-dr-design.md")), /Slots that the collision does not touch continue to be designed\./);
    assert.match(flat(read("SKILL.md")), /Slots that the collision does not touch continue to be designed\./);
    assert.match(flat(read("references", "patterns.md")), /The slots that the collision does not touch continue to be designed/);
    assert.match(flat(dr04), /a `supersedes` link between the patterns, or a decision recorded under `decisions\[\]` in `assessment\.yaml`/);
    assert.match(flat(dr04), /a decision recorded in `assessment\.yaml` documents the owner's choice and does not resolve the slot: it stays Unresolved until a `supersedes` link removes the collision/);
    assert.match(flat(dr04), /slots that the collision does not touch continue to be designed/);
});

test("a mechanism class goes only to an Azure service's replication or recovery mechanism, never to a company pattern, a customer procedure or an on-premises step", () => {
    const rule = /A class is given only to an Azure service's replication or recovery mechanism; a step that is a company pattern, a customer procedure or an on-premises action carries the pattern ID and version \(or `customer procedure`\) and no class/;
    assert.match(flat(read("SKILL.md")), rule);
    assert.match(flat(read("references", "output-contract.md")), rule);
});

test("helper scripts and scratch files go to a temp folder outside dr-assessment/{app}/ and are deleted before the final answer", () => {
    const rule = /Scratch or helper files, such as a script or a scratch json, go to the operating system temp folder or to a temp folder inside the working folder outside `dr-assessment\/\{app\}\/`, and are deleted before the final answer; the output folder holds only the files that the output contract lists/;
    assert.match(flat(read("SKILL.md")), rule);
    assert.match(flat(stage("02-intake.md")), rule);
});
