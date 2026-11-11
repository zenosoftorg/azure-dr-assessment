import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkDocs } from "../helpers/docs-commands.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const skill = path.join(root, "skills", "azure-dr-assessment");
const read = (...parts) => readFileSync(path.join(skill, ...parts), "utf8");
const stage = (name) => read("references", "stages", name);
const section = (text, heading) => text.split(new RegExp(`^## ${heading}$`, "m"))[1].split(/^## /m)[0];
const shellWords = (command) => [...command.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);

test("SKILL.md has the five ranks of the v3 precedence, the playbook between the pattern and Learn", () => {
    const ranks = section(read("SKILL.md"), "Precedence, per decision slot").split("\n").filter((line) => /^\d\. /.test(line));
    assert.deepEqual(ranks.map((line) => /^\d\. \*\*(.+?)\*\*/.exec(line)[1]), ["Azure reality:", "A valid override", "The company pattern", "The service playbook", "Microsoft Learn"]);
    assert.match(ranks[0], /and the Microsoft Learn facts read in this run\. Nothing overrides it, not even a playbook claim\./);
    assert.match(ranks[2], /A slot that a pattern decides is not offered in the DR options question\.$/);
    assert.equal(ranks[3], "4. **The service playbook** in `playbooks/`: the default source for a service's DR options, setup steps and test criteria. Stage 5 checks its claims against Learn, and Learn wins.");
    assert.equal(ranks[4], "5. **Microsoft Learn** guidance and defaults, for a service without a playbook and for what a playbook does not cover.");
});

test("SKILL.md has the workflow row 5b, the one more stop, the DR path labels and the four red flags of spec 9", () => {
    const text = read("SKILL.md");
    assert.match(text, /^\| 5b \| DR options \| Ask the one DR options question when a service has no native DR into the DR region, or record the defaults when nobody can answer\. \| \[05b-dr-options\]\(references\/stages\/05b-dr-options\.md\) \|$/m);
    const rows = text.split("\n").filter((line) => /^\| \d+b? \| /.test(line)).map((line) => line.split(" | ")[0].slice(2));
    assert.deepEqual(rows, ["1", "2", "3", "4", "5", "5b", "6", "7"]);
    assert.match(text, /The default is one shot, with one more stop: stage 5b asks the DR options question once, and never when nobody can answer\./);
    assert.match(text, /DR paths: Native · Workaround · Split-region · Backup-restore · No path\. Choices: Recommended · Default \(chosen by nobody\)\./);
    const flags = text.split(/^## Red flags[^\n]*$/m)[1];
    for (const flag of [
        "- Offering a DR option that is not in `evidence/dr-options.json`, or recommending by judgement instead of the rule that `dr-options` applies.",
        "- Counting a split-region service as covered in the DR region.",
        "- Calling a default an owner decision.",
    ]) assert.ok(flags.split("\n").includes(flag), flag);
    assert.ok(text.split("\n").length <= 100);
});

test("stage 5 loads the playbook, records its claims and the fixed pair and geography results, derives options without a playbook and classifies", () => {
    const region = stage("05-region-analysis.md");
    assert.match(region, /For each type in `types` that has a `playbook`, open the playbook first\. Read Learn for every mechanism of its Mechanisms section and record each one as below, with `result\.mechanism` written exactly as the playbook names it/);
    assert.match(region, /record a `playbook-claim` entry with the playbook's `service`, the constraint heading as `claim`, the quoted Learn text and `agrees` true or false/);
    assert.match(region, /\*\*4a\. No playbook\.\*\* For a type whose `playbook` is null, derive its DR options from Learn/);
    assert.match(region, /Write `unknown` when Learn gives no figure: never estimate one yourself\./);
    assert.match(region, /Record one `pair` entry with the subject `<primary>\|<dr>` and the result fields `paired`, `primaryPair` and `drPair`/);
    assert.match(region, /Record one `geography` entry for the primary, one for the DR region and one for the primary's pair, each with the result fields `region`, `geography` and `residency`/);
    assert.match(region, /8\. \*\*Classify\.\*\* When the ledger validates, classify every type:\n\n {3}```bash\n {3}node skills\/azure-dr-assessment\/scripts\/dr-options\.mjs --classify --assessment dr-assessment\/checkout\/assessment\.yaml\n {3}```/);
    assert.match(region, /Then go to \[stage 5b\]\(05b-dr-options\.md\) in every run: when `ask` is empty it asks nothing and only runs its record step/);
    assert.match(section(region, "Verification of a playbook"), /A different class, or `agrees: false`, makes the claim \*\*stale\*\*: Learn wins/);
    assert.match(section(region, "Learn unreachable"), /Every playbook claim is then Unverified, so no type is Native and every type that no pattern decides is in the DR options question/);
    assert.match(section(region, "Never"), /^- Classify a service or recommend an option by judgement: `dr-options --classify` does both\.$/m);
});

test("the ledger commands that stage 5 documents for pair, geography, playbook-claim and option are accepted by the real ledger script", async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-stage5-v3-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ledger = path.join(dir, "ledger.json");
    const script = path.join(skill, "scripts", "ledger.mjs");
    for (let i = 1; i <= 5; i += 1) {
        const doc = await runScript(script, ["add-doc", "--ledger", ledger, "--url", `https://learn.microsoft.com/en-us/azure/reliability/page-${i}`, "--title", `Page ${i}`, "--status", "Verified", "--supports", "the example", "--query", "generic terms", "--tool", "microsoft_docs_fetch"]);
        assert.equal(doc.code, 0, doc.stdout + doc.stderr);
    }
    const commands = stage("05-region-analysis.md").split("\n").filter((line) => /^node skills\/azure-dr-assessment\/scripts\/ledger\.mjs add-region .*--check (pair|geography|playbook-claim|option) /.test(line));
    assert.equal(commands.length, 4);
    for (const command of commands) {
        const [, , ...args] = shellWords(command);
        const r = await runScript(script, args.map((arg, i) => (args[i - 1] === "--ledger" ? ledger : arg)));
        assert.equal(r.code, 0, `${command}\n${r.stdout}${r.stderr}`);
    }
    const validate = await runScript(script, ["validate", "--ledger", ledger]);
    assert.equal(validate.code, 0, validate.stdout + validate.stderr);
});

test("stage 5b asks once, word for word, records with --reply, --choice and --defaults, and never asks when nobody can answer", () => {
    const text = stage("05b-dr-options.md");
    assert.match(text, /^# Stage 5b: The DR options interview$/m);
    assert.match(text, /Ask with the host's question tool, in one message, the `question` of the summary word for word\./);
    for (const flags of ["--record --assessment dr-assessment/checkout/assessment.yaml --reply", "--record --assessment dr-assessment/checkout/assessment.yaml --choice", "--record --assessment dr-assessment/checkout/assessment.yaml --defaults", "--validate --assessment", "--classify --assessment dr-assessment/checkout/assessment.yaml --ask-type"]) {
        assert.ok(text.includes(`node skills/azure-dr-assessment/scripts/dr-options.mjs ${flags}`), flags);
    }
    assert.match(section(text, "Nobody to answer"), /When the host has no question tool, or the owner asked for an unattended run, do not ask\. Record only the defaults\. Unlike the tier question, the interview never ends the reply: go on to stage 6/);
    assert.match(section(text, "Reruns"), /A recorded type is never asked again, default or not\./);
    assert.match(section(text, "Inline and reasoning-only runs"), /Nothing persists them: a rerun asks again\./);
    const never = section(text, "Never");
    for (const rule of [
        "- Offer an option that is not in `evidence/dr-options.json`, drop one, or change its numbers.",
        "- Recommend by judgement: the recommendation is the one `dr-options` computed.",
        "- Call a default an owner decision.",
        "- Ask the DR options question more than once in a run.",
    ]) assert.ok(never.split("\n").includes(rule), rule);
    assert.match(section(text, "How the script decides"), /`accept-gap` is recommended only when no option respects residency, or none is left\./);
});

test("stage 6 puts the playbook in the order, writes decisions from the choices, and draws the split group and the backup-restore path", () => {
    const design = stage("06-dr-design.md");
    assert.match(design, /the first that applies wins: Azure reality, a valid override, the company pattern, the service playbook, Microsoft Learn\./);
    assert.match(design, /^\| `learn`, and the slot holds types of `evidence\/dr-options\.json` \| Write the decision from the DR options of those types .+ \| `playbook`, `playbook <service> v<version>`; or `learn` \|$/m);
    assert.match(design, /^### From the DR options to the decision$/m);
    assert.match(design, /share `data-replication\.storage`: the decision text names each type with its option/);
    assert.match(design, /It is never DR coverage in the DR region/);
    assert.match(design, /When an owner chose it, it is also a documented exception \(`dr-choice-gap` in `documentedExceptions`, section D and the diagram\); a default is not, because an exception needs an owner\./);
    assert.match(design, /A chosen option that does not meet the tier is a Gap that names the type and the option; the choice never hides it\./);
    assert.match(design, /^\| Split-region \| A split-region choice gets a third region group with the style `split`, labelled `split: <service> only \(<region>\)`/m);
    assert.match(design, /The builder refuses a `split` group whose label does not start with `split: `\./);
    assert.match(design, /^\| Backup-restore \| The restore path is a `failover` edge to the restored service in the DR region, with the mechanism `restore from <backup mechanism>`\. \|$/m);
    assert.match(design, /A type's slot is the `slot` of its row in `evidence\/dr-options\.json`/);
});

test("patterns.md places the service playbooks, the source playbook and the accepted-gap exception", () => {
    const text = read("references", "patterns.md");
    assert.match(text, /^## Service playbooks$/m);
    assert.match(text, /A decision whose content comes from a playbook, on a `learn` candidate only, has the source `playbook` and the ref `playbook <service> v<version>`; the report shows it as `Service playbook`\./);
    assert.match(text, /So is a gap that an owner accepted in the DR options interview \(`dr-choice-gap`, stage 5b\); a gap accepted by default is not/);
    assert.match(text, /^\| Pattern vs service playbook \| The pattern governs, and the type is not in the DR options question\. \|$/m);
});

test("every command of the v3 text names a real script and real flags", () => {
    const files = ["SKILL.md", path.join("references", "patterns.md"), ...["05-region-analysis.md", "05b-dr-options.md", "06-dr-design.md"].map((name) => path.join("references", "stages", name))];
    assert.deepEqual(checkDocs(files.map((file) => path.join(skill, file)), path.join(skill, "scripts")), []);
});
