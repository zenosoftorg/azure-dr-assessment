import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Pins for the texts changed by the live acceptance fix wave (items 4 to 12).
const skill = path.join(path.resolve(import.meta.dirname, "..", ".."), "skills", "azure-dr-assessment");
const read = (...parts) => readFileSync(path.join(skill, ...parts), "utf8");
const stage = (name) => read("references", "stages", name);
const flat = (text) => text.replace(/\s+/g, " ");

test("a missing tier makes the whole reply the DR-TIER-001 question, also when nobody can answer", () => {
    const intake = flat(stage("02-intake.md"));
    assert.match(intake, /The whole reply is the DR-TIER-001 question, `gates\[0\]\.question` word for word: alone, with no commentary, no table, no other question and no instruction to set a key and rerun/);
    assert.match(intake, /The open question is the end of the reply, also when nobody can answer in this run/);
    assert.match(intake, /In non-interactive use \(a prompt given with `-p`, nobody to ask\)/);
    assert.match(intake, /do not replace it by an instruction to set `objectives\.tier` and rerun/);
    const skillText = flat(read("SKILL.md"));
    assert.match(skillText, /the whole reply is the DR-TIER-001 question word for word, from `gates\[0\]\.question` when intake ran, otherwise from the first blockquote of "Mandatory first step" in `patterns\/DR-TIER-001\.md`: alone, with no commentary, no table and no other question, also when nobody can answer in this run/);
});

test("when the output folder is inside the skill or plugin, stage 2 gives the reason and asks for a folder instead of choosing one", () => {
    const intake = flat(stage("02-intake.md"));
    assert.match(intake, /Do not choose an output folder yourself, and do not pass `--out` with a folder of your own: give the reason \(the working folder is inside the skill or plugin directory\) and ask the owner for a writable folder\. When nobody can answer in this run, end with that question\. After the answer, rerun with `--out`/);
});

test("a collision stays Unresolved until a supersedes link removes it, and the other slots continue (stage 6, SKILL.md, the pattern guide; the wording is pinned in acceptance-fixes-2)", () => {
    const design = flat(stage("06-dr-design.md"));
    assert.match(design, /Slots that the collision does not touch continue to be designed\./);
    assert.doesNotMatch(design, /until a `supersedes` change removes the collision/);
    assert.match(flat(read("SKILL.md")), /Slots that the collision does not touch continue to be designed/);
    assert.match(flat(read("references", "patterns.md")), /The slots that the collision does not touch continue to be designed/);
    assert.doesNotMatch(read("references", "patterns.md"), /Only `supersedes` resolves it/);
});

test("the DR-04 scenario names both ways to give a resolution and says that the other slots continue", () => {
    const scenarios = readFileSync(path.join(skill, "..", "..", "tests", "scenarios.md"), "utf8");
    const dr04 = scenarios.split(/^## DR-04:/m)[1].split(/^## /m)[0];
    assert.match(dr04, /a `supersedes` link between the patterns, or a decision recorded under `decisions\[\]` in `assessment\.yaml`/);
    assert.match(dr04, /slots that the collision does not touch continue to be designed/);
});

test("an inline answer labels every mechanism with its class and status, and every RPO or RTO figure as Estimated unless a drill record exists", () => {
    const row = flat(read("SKILL.md")).split("| The user asks for no files, or no writable location exists |")[1].split("| Microsoft Learn unreachable |")[0];
    assert.match(row, /every replication or recovery mechanism you name, current or proposed, carries its class \(Any-pair, Paired-only, No built-in multiregion\) and its documentation status \(Verified or Unverified\), and every RPO or RTO figure is labelled Estimated, or Demonstrated only when a drill record exists/);
    const contract = flat(read("references", "output-contract.md")).split("## Concise and inline answers")[1].split("## ")[0];
    assert.match(contract, /every replication or recovery mechanism it names, current or proposed, carries its class \(Any-pair, Paired-only, No built-in multiregion\) and its documentation status \(Verified or Unverified\), and every RPO or RTO figure is labelled Estimated, or Demonstrated only when a drill record exists/);
});

test("a failed Verification check is named by its number in the pattern, and the example number is true", () => {
    assert.match(flat(stage("06-dr-design.md")), /Name the failed check by its number: the position of its bullet in that pattern's Verification section, counted from 1 \(the Tier 1 check of DR-TIER-001 v1 is `DR-TIER-001 v1 check 6`\), and quote the check's wording from the pattern/);
    assert.match(flat(read("SKILL.md")), /A failed Verification check of a pattern is named by its number in the pattern's Verification list, for example `DR-TIER-001 v1 check 6`, with the pattern's wording, also when you review a proposal inline/);
    const verification = read("patterns", "DR-TIER-001.md").split(/^## Verification$/m)[1].split(/^## /m)[0];
    const checks = verification.split("\n").filter((line) => line.startsWith("- "));
    assert.match(checks[5], /^- Tier 1: the secondary is fully running/, "check 6 of DR-TIER-001 is the Tier 1 check");
    const scenarios = readFileSync(path.join(skill, "..", "..", "tests", "scenarios.md"), "utf8");
    assert.match(scenarios.split(/^## DR-09:/m)[1].split(/^## /m)[0], /the check that fails by its number in the pattern's Verification list \(`DR-TIER-001 v1 check 6`\)/);
});

test("the edge label of a DR-DNS-001 decision shows the record type and the TTL as supplied, or that they are not supplied", () => {
    const design = flat(stage("06-dr-design.md"));
    assert.match(design, /The label of that edge, and of any edge of a decision from DR-DNS-001, shows the pattern's inputs as supplied, for example `change on-prem DNS record: CNAME, TTL 300 s`, or `change on-prem DNS record: record type, TTL: not supplied by the application team` when they are not/);
    assert.match(design, /The annotation may repeat them, but it never replaces the label/);
    const scenarios = readFileSync(path.join(skill, "..", "..", "tests", "scenarios.md"), "utf8");
    assert.match(scenarios.split(/^## DR-11:/m)[1].split(/^## /m)[0], /The label itself shows them, for example `change on-prem DNS record: record type, TTL: not supplied by the application team`, not only the annotation/);
});

test("the chat summary names the owner's decisions itself and gives the exact retry command when an icon fetch failed", () => {
    const summary = flat(stage("07-report.md")).split("## Tell the owner")[1].split("## Before you finish")[0];
    assert.match(summary, /the decisions the owner has to make, each named in the summary itself and not only in section D of the report: open inputs, unresolved collisions, rejected overrides, substitutes to confirm/);
    assert.match(summary, /when an icon fetch failed \(`fetch-icons` did not finish, or `present` exited 4 with `zero-icons`\): that the presentations were not built, and the exact retry command, the `fetch-icons\.mjs` command as you ran it, then the `present` command again/);
    assert.match(summary, /The decisions, the interview choices and the retry command are never cut to stay within the fifteen lines\./);
});

test("the output folder name is derived after the scope is known, and the examples show the derived name", () => {
    const intake = flat(stage("02-intake.md"));
    assert.match(intake, /derive it only once the scope is known: the resource group or the tag value of the scope selector, else the inventory file name without its extension \(a scope of `rg-checkout` gives the folder `dr-assessment\/rg-checkout\/`\)/);
    assert.match(intake, /When the scope is still pending .* do not run intake with a name yet: run `node skills\/azure-dr-assessment\/scripts\/ingest\.mjs --ari <file> --summary-only`, which writes nothing, ask the scope question first/);
    const root = path.join(skill, "..", "..");
    const readme = flat(readFileSync(path.join(root, "README.md"), "utf8"));
    assert.match(readme, /The folder is named after the workload: the name you gave, else the resource group or tag value of the scope, else the inventory file name \(for the resource group `rg-checkout`, `dr-assessment\/rg-checkout\/`\)/);
    assert.match(readme, /for example `dr-assessment\/checkout\/assessment\.yaml` when you named the workload Checkout/);
    const scenarios = readFileSync(path.join(root, "tests", "scenarios.md"), "utf8");
    const section = (id) => scenarios.split(new RegExp(`^## ${id}:`, "m"))[1].split(/^## /m)[0];
    assert.match(scenarios.split("## DR-01:")[0], /with the answer to the scope question below it is `dr-assessment\/rg-checkout\/`; it is `dr-assessment\/checkout\/` only where the owner or `assessment\.yaml` supplies the app name, as in DR-13/);
    assert.match(section("DR-05"), /announces `dr-assessment\/rg-checkout\/` \(the name derived from the answered scope, not `ari-sample`\)/);
    assert.doesNotMatch(section("DR-05"), /announces `dr-assessment\/checkout\/`/);
    assert.match(section("DR-12"), /dr-assessment\/rg-checkout\/assessment\.yaml/);
    assert.doesNotMatch(section("DR-12"), /dr-assessment\/checkout\//);
    assert.match(section("DR-14"), /below `dr-assessment\/rg-checkout\/`/);
    assert.match(section("DR-13"), /announces `dr-assessment\/checkout\/`/, "DR-13 supplies the app name in assessment.yaml");
    assert.match(section("DR-05"), /gives the reason and asks the owner for another folder; it does not choose one itself/);
});

test("the canvas-missing row tells the model to say that a copy of the skill folder alone is not a supported install", () => {
    const row = read("SKILL.md").split("\n").find((line) => line.startsWith("| `preflight` prints `mode: reasoning-only` although Node works |"));
    assert.ok(row);
    assert.match(row, /Say what `preflight` reports as missing, and say in your answer that a copy of the skill folder alone is not a supported install\. \|$/);
    assert.match(row, /only the skill folder was copied out of its repository, which is not a supported install/);
});
