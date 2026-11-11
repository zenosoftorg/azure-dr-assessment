import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { SLOT_IDS } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const skill = path.join(root, "skills", "azure-dr-assessment");
const stagesDir = path.join(skill, "references", "stages");
const files = existsSync(stagesDir) ? readdirSync(stagesDir).filter((name) => name.endsWith(".md")).sort() : [];
const read = (name) => readFileSync(path.join(stagesDir, name), "utf8");

test("there is one reference for each of the stages 2 to 7 and 5b, and no other", () => {
    assert.deepEqual(files, ["02-intake.md", "03-ingest.md", "04-as-is.md", "05-region-analysis.md", "05b-dr-options.md", "06-dr-design.md", "07-report.md"]);
});

test("every stage reference opens with its stage number and carries no placeholder text", () => {
    assert.ok(files.length > 0);
    for (const name of files) {
        const text = read(name);
        const number = name.slice(0, name.indexOf("-")).replace(/^0/, "");
        assert.match(text, new RegExp(`^# Stage ${number}: \\S`), name);
        assert.doesNotMatch(text, /\b(TBD|TODO|FIXME|lorem ipsum)\b/i, name);
        assert.ok(text.endsWith("\n"), `${name} ends with a newline`);
        assert.match(text, /^## Never$/m, `${name} lists what never to do`);
    }
});

test("stage 2 keeps the ask-order rules, stage 3 the read-only rules and stage 5 the query hygiene", () => {
    const intake = read("02-intake.md");
    assert.match(intake, /The whole reply is the DR-TIER-001 question/);
    assert.match(intake, /`gates\[0\]\.question` word for word/);
    assert.match(intake, /Do not ask about it/);
    assert.match(intake, /One exception covers every target that is stricter than the tier, so name all of them in what is accepted/);
    const ingest = read("03-ingest.md");
    assert.match(ingest, /never the raw workbook and never `inventory\.json` in full/);
    assert.match(ingest, /allowlisted read operations/);
    const region = read("05-region-analysis.md");
    assert.match(region, /One service per query/);
    assert.match(region, /never a customer name, resource name, ID or any inventory content/);
    assert.match(region, /Pairing is never assumed/);
});

test("stage 4 asks for a basis for every link and never for the whole inventory", () => {
    const asIs = read("04-as-is.md");
    assert.match(asIs, /Never infer a dependency or a data flow from names or co-location/);
    assert.match(asIs, /labeled \*\*Inferred\*\*/);
    assert.match(asIs, /never `inventory\.json` in full/);
    assert.match(asIs, /An edge without a basis is rejected, not drawn/);
    assert.match(asIs, /`unresolved-labels`/);
});

test("stage 6 says that the candidate binds the model, never approves a failover and names every slot", () => {
    const design = read("06-dr-design.md");
    assert.match(design, /^## The candidate binds you$/m);
    assert.match(design, /Never choose between the patterns/);
    assert.match(design, /Authorize, approve or run a failover/);
    assert.match(design, /not supplied by the application team/);
    for (const slot of SLOT_IDS) {
        const family = /^data-replication\.(.+)$/.exec(slot);
        const named = design.includes(`\`${slot}\``) || (family !== null && design.includes(`\`.${family[1]}\``));
        assert.ok(named, `stage 6 names the slot ${slot}`);
    }
});

test("stage 6 lists the ten steps of the story template, so the two cannot drift", () => {
    const template = readFileSync(path.join(skill, "assets", "templates", "story.dr-walkthrough.mjs"), "utf8");
    const steps = [...template.matchAll(/^ {4}\["([a-z-]+)", "/gm)].map((match) => match[1]);
    assert.equal(steps.length, 10);
    const design = read("06-dr-design.md");
    for (const step of steps) assert.ok(design.includes(`| \`${step}\` |`), `stage 6 tells the step ${step}`);
});

test("stages 4 and 6 rebuild a failed story once, then withhold the presentation and say so; zero icons never blocks the rest", () => {
    for (const name of ["04-as-is.md", "06-dr-design.md"]) {
        const text = read(name);
        assert.match(text, /(?:fix|correct) the data file and rebuild once/, name);
        assert.match(text, /do not deliver the presentation, and say so in the report/, name);
    }
    assert.match(read("04-as-is.md"), /the diagram, the report and the runbook do not depend on it/);
});

test("stage 7 checks the presentations in a browser and never calls one verified when the check did not run", () => {
    const report = read("07-report.md");
    assert.match(report, /^## Check the presentations$/m);
    assert.match(report, /check-presentation\.mjs --html dr-assessment\/checkout\/presentations\/checkout-current-state\.html/);
    assert.match(report, /check-presentation\.mjs --html dr-assessment\/checkout\/presentations\/checkout-proposed-dr\.html/);
    assert.match(report, /Write "browser check NOT RUN" in the chat summary\. Never write that the presentation was verified\./);
    assert.match(report, /the result of the browser check of each presentation: passed, failed or NOT RUN/);
});

test("stage 7 links the diagrams into the canvas as copies only, and only when the owner asks", () => {
    const report = read("07-report.md");
    assert.match(report, /^## Open the diagrams in the canvas \(only when the owner asks\)$/m);
    assert.match(report, /canvas-link\.mjs --root dr-assessment\/checkout/);
    assert.match(report, /The canvas gets copies\./);
    assert.match(report, /Never run it by default/);
});

test("stage 7 names a region mismatch in the chat summary, and writes the tables by hand from what was read when Node is missing", () => {
    const report = read("07-report.md");
    assert.match(report, /^- a region mismatch, when `ingest` reported one: the declared primary region against where the in-scope resources are, and that the declared region stays in force;$/m);
    assert.match(report, /^\| `report-tables` cannot run \(no Node\) \| Write sections B, C and D by hand from what you read, and say that they were not generated\. \|$/m);
});

test("stage 7 puts the generated tables last, keeps the runbook a draft and never claims an approval", () => {
    const report = read("07-report.md");
    assert.match(report, /Fill sections B, C and D last, with the script/);
    assert.match(report, /DRAFT banner: keep it/);
    assert.match(report, /cannot verify them|cannot verify an approval|cannot verify approvals/);
    assert.match(report, /No `<!-- fill:` comment is left/);
});

test("stage 2 says how the name is chosen, that one DR region is assessed per run, and how the optional inputs are recorded", () => {
    const intake = read("02-intake.md");
    assert.match(intake, /^## The name, the regions and the optional inputs$/m);
    assert.match(intake, /else the inventory file name without its extension \(a scope of `rg-checkout` gives the folder `dr-assessment\/rg-checkout\/`\)[^]*Announce the name you chose and do not ask for it/);
    assert.match(intake, /\*\*One DR region per run\.\*\*/);
    assert.match(intake, /tell them to run the skill again for each other region/);
    assert.match(intake, /\*\*Tier 0 has no numeric band\.\*\*/);
    assert.match(intake, /`constraints\.data_residency`, `constraints\.cost_ceiling` or `constraints\.test_windows` in `assessment\.yaml`/);
});

test("stage 4 replays the owner's corrections on every run, because stage 3 starts a new ledger", () => {
    const asIs = read("04-as-is.md");
    assert.match(asIs, /Stage 3 starts a new ledger on every run, so an owner's correction is lost on a rerun unless you add it again/);
    assert.match(asIs, /--source-type owner --source-detail "decisions\[0\]"/);
    assert.match(asIs, /record it under `decisions` first, then add the fact/);
});

test("stage 3 says that a rerun renumbers the ledger and that every spec is written again", () => {
    const ingest = read("03-ingest.md");
    assert.match(ingest, /numbers the `F-` ids afresh, so a `\*\.spec\.json` from an earlier run may cite ids that now mean something else/);
    assert.match(ingest, /write every spec again in stages 4 and 6, and never reuse an earlier run's/);
    assert.match(read("04-as-is.md"), /Never copy or edit a spec from an earlier run: its `F-` ids were numbered again by the last ingest/);
});

test("stage 4 sets the function-app icon by kind and stage 5 says the fit queries run in the active subscription", () => {
    assert.match(read("04-as-is.md"), /When the resource's `kind` fact \(`ledger\.mjs list --subject <ref>`\) contains `functionapp`, set the node's `icon` to `azure:function-apps`/);
    const region = read("05-region-analysis.md");
    assert.match(region, /The fit queries run in the Azure CLI's active subscription/);
    assert.match(region, /ask the user to run `az account set --subscription <id>` and then run the command again\. You never run it yourself/);
});

test("stage 6 runs the Verification of every applicable approved pattern and keeps a collision unresolved while quoting the owner's answer", () => {
    const design = read("06-dr-design.md");
    assert.match(design, /Verification section of every other approved pattern that applies to this workload/);
    assert.match(design, /the Gap names both IDs and versions, and you never rewrite another pattern's decision/);
    assert.match(design, /quote it in `text` with who and the date: the report shows it/);
    assert.match(design, /A decision recorded in `assessment\.yaml` `decisions\[\]` documents the owner's choice; the slot stays Unresolved in the resolution file until a `supersedes` link removes the collision/);
    assert.match(design, /that number is the owner's definition of "near zero": test it against the stage 5 findings/);
    assert.match(design, /When no number was given, say that "near zero" cannot be tested and list it as an open input/);
});

test("stages 6 and 7 say what an override without an alternative does, and list the checks of a waived slot as Not checked", () => {
    const design = read("06-dr-design.md");
    assert.match(design, /\| `override` without an `alternative` \| The pattern is waived for its slots and nothing replaces it\. Decide from Microsoft Learn as for a `learn` candidate, but keep the source `override`/);
    assert.match(design, /Name the Microsoft Learn documents you used in `ref`, and list their `D-` ids in `ledger`/);
    assert.match(design, /whether or not it has an `alternative`, yet the pattern still has `applied: true` in the resolution/);
    assert.match(design, /skip every check that tests a waived slot/);
    assert.match(design, /`Not checked: waived by Override #<n>` with the pattern ID and version/);
    const report = read("07-report.md");
    assert.match(report, /A slot that an override waives without an alternative follows Microsoft Learn: cite the documents it rests on and name the override\./);
    assert.match(report, /`Not checked: waived by Override #<n>` with the pattern ID and version\. They are not Gaps and they are not passed checks\./);
});

test("stage 7 prints the cost ceiling beside the ratio, never as a price, uses the test windows and carries the pack banner into the runbook", () => {
    const report = read("07-report.md");
    assert.match(report, /When `constraints\.cost_ceiling` is set, print it beside the tier's relative cost profile in section 1/);
    assert.match(report, /Never turn a ratio into a price/);
    assert.match(report, /When `constraints\.test_windows` is set, use it in the validation plan of section 7 and in the runbook's test plan/);
    assert.match(report, /add it as a blockquote line under the DRAFT line/);
    assert.match(report, /under the DRAFT line of the runbook/);
});
