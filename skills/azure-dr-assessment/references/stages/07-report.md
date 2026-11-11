# Stage 7: Report, establishment guide and runbook

Write the DR establishment guide, the recovery runbook and the assessment report from the evidence, the DR options, the decisions and the diagrams, then tell the owner what matters. Scripts write the skeletons and the tables that must match the evidence files. You write the rest. Work in this order: the guide skeleton, the guide text, the runbook, the report, and `report-tables` last.

## The establishment guide

1. Write the skeleton:

   ```bash
   node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root dr-assessment/checkout --write
   ```

   It writes `reports/dr-establishment-guide.md`: the build order, then one chapter per type of `evidence/dr-options.json` in build order (connectivity, identity, detection, secrets and keys, the data-replication slots and backup, compute, ingress, a type without a slot, and the traffic switch last; a type without a slot of its own sorts by the slot of its ARM namespace, so a virtual network comes first, and only a namespace the script does not know goes after ingress), each with the parts Today, Target, Prerequisites, Build, Validate, Cut-over, Decommission the paired setup, Failover and failback, and Open inputs. From the playbook and the chosen option (or the recommendation when nobody chose) it writes the target with its source and who chose it, the prerequisites, the build, cut-over and decommission steps of that option, the playbook's validate procedure above the Validate table, and one Validate row per test criterion of the option. A split-region target gets the playbook's own split steps, plus one fill comment after Build for the network path from the consumers in the DR region to the service in the pair and the residency result. When one playbook covers two types with the same target option (a virtual machine and its disks), the first chapter in build order is the full one and the later one points at it: "Built with chapter <n>", "See chapter <n>." in the step parts, and one Validate row "Covered by chapter <n>". An accept-gap target builds nothing, keeps today's paired setup and has one Validate row, "Gap recorded". A type that a pattern or an override decides gets a "Decided by" Target line, a Native target that was not asked says "Not asked", and a Learn-derived target or a type without a playbook gets fill comments where the script cannot write. Each Failover and failback part links to its subsection of runbook section 3 (`recovery-runbook.md#runbook-<anchor>`). A rerun overwrites the guide and says so. When stage 5 classified with another playbook folder (`nonDefaultPlaybooks: true`), pass the same `--playbooks-dir`, and name the folder in report section C and in the summary. Exit 2 from `--write` names what is wrong: no `evidence/dr-options.json` yet (run stage 5 first), or a playbook folder that does not hold the playbooks that `dr-options` classified with (pass the same `--playbooks-dir`, or classify again).
2. Replace every `<!-- fill: ... -->` comment with the text it asks for, and keep what the script wrote. The Target lines `- Option:`, `- Source:`, `- Chosen by:`, `- Estimated RPO:` and `- Tier <n>:` (or `- Decided by`) belong to the script: keep each one exactly as written and put a qualification on a line of your own below them. Today is the setup the inventory shows, citing `F-` ids, or Unknown: never absent. A chapter marked "No playbook, derived from Learn this run." takes its target and steps from the `option` entries of the ledger, citing their `D-` ids, and says Unknown where Learn does not support a part. Every chapter has at least one Validate row, and every Validate row has a measurable pass condition, how to measure it, the evidence, the frequency and the owner role. Keep a pointer chapter short: never copy the steps of the chapter it points at. Never delete a "Playbook claim stale" line: Learn wins, and the line says so.
3. Rebuild the consolidated test plan from the Validate tables, and check the guide:

   ```bash
   node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root dr-assessment/checkout --tables
   node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root dr-assessment/checkout --check
   ```

   Exit 2 from `--check` lists every problem, one per line: a missing, extra or misplaced chapter, a missing or misplaced part, a fill comment left, a Validate table without a row, a Validate row with an empty cell, a Target line of the script that is missing or changed (the message names the chapter and the line to restore), a test plan that differs from the Validate rows (run `--tables`), an RPO or RTO with a number that is not labelled Estimated or Demonstrated, and the words compliant, achieved or guaranteed. Exit 2 from `--check` with "the guide or the runbook holds text that looks like a secret" names the file, the line and the chapter or runbook subsection, never the text: name where the secret is kept instead. Fix the text and run `--check` again until it exits 0. Exit 2 from `--write` or `--tables` with a message that a string looks like a secret means that nothing was written: the details name the file and the line, never the text. Exit 4 means that the guide would be inside the skill or plugin directory.

## The runbook

1. Copy `skills/azure-dr-assessment/assets/templates/runbook.md` to `dr-assessment/checkout/reports/recovery-runbook.md`. It opens with a DRAFT banner: keep it. When `evidence/pattern-resolution.json` has a banner (a pack other than the company pack), add it as a blockquote line under the DRAFT line.
2. Write section 3, one subsection per service in build order, between its markers:

   ```bash
   node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root dr-assessment/checkout --inject-runbook dr-assessment/checkout/reports/recovery-runbook.md
   ```

   Each subsection has the playbook's failover rows, then its failback rows, of the chosen option. A split-region service gets the row that points the consumers in the DR region at the service in its pair. A service without playbook steps gets one row of fill comments, and a service built with an earlier chapter gets one row that points at that subsection. Each subsection opens with the anchor `runbook-<anchor>` that the guide links to. Pass the same `--playbooks-dir` as for the guide. `--inject-runbook` replaces everything between the section 3 markers: run it before you fill the owner roles there, because a rerun discards what was filled between them. Exit 2 says that the markers are missing (nothing was written: copy the template again) or that a string looks like a secret.
3. Fill the eight sections. In section 3, fill the owner roles and the rows of fill comments, and say above the subsections in which order the services recover and which steps join them. Every step keeps an owner, an Estimated duration, a verification and an abort condition. Include the traffic switch, the data and application checks, failback and the return to steady state, and open with the disaster scenario and who decides.
4. When DR-DNS-001 applies, the traffic switch is the on-prem record change: its record type and TTL from `pattern_inputs` (or "not supplied by the application team"), who changes it, and that the TTL wait counts toward the RTO. Traffic Manager and Front Door appear only as documented alternatives that are not applied.
5. Give commands or infrastructure-as-code only when the owner asked, and label them untested.

## The report

1. Copy `skills/azure-dr-assessment/assets/templates/report.md` to `dr-assessment/checkout/reports/assessment.md`.
2. Fill sections 1 to 7 and A. Each `<!-- fill: ... -->` comment says what the section needs. Replace the comment with the content, and delete the comments you do not use. Sections 1 to 7 are the response structure of DR-TIER-001, in its order and with its names. Section A is the as-is architecture: link the diagram and presentation 1. Section 3 links each component to its chapter of the guide (`dr-establishment-guide.md#chapter-<anchor>`). Section 7 references the consolidated test plan of the guide instead of repeating it. Sections 2 and 7 list every DR choice with `chosen_by: default` as an open decision of the owner, naming the type and its option.
3. Every recommendation shows: its evidence ids, the documentation it rests on, the pattern ID and version when a pattern decided it, and the decision or the open gap. A component's status is one of Gap, Unknown, Supported by configuration, Not assessed. A mechanism's class is Any-pair, Paired-only or No built-in multiregion. A substitute is Proposed and needs the owner's confirmation, or it is an unmet requirement. A slot that an override waives without an alternative follows Microsoft Learn: cite the documents it rests on and name the override.
4. Say plainly when a target cannot be met by the selected design, and offer a design change or a revised tier instead of hiding the gap. When `constraints.cost_ceiling` is set, print it beside the tier's relative cost profile in section 1. Compare the two only when the ceiling is also a ratio. When it is an amount, say that this skill gives planning ratios only and cannot check it. Never turn a ratio into a price. When `constraints.test_windows` is set, use it in the validation plan of section 7 and in the runbook's test plan.
5. In section 7, list the Verification checks that stage 6 skipped because an override waives their slot, each as `Not checked: waived by Override #<n>` with the pattern ID and version. They are not Gaps and they are not passed checks.
6. Fill sections B, C and D last, with the script, and rerun it after any later change to the evidence:

   ```bash
   node skills/azure-dr-assessment/scripts/report-tables.mjs --root dr-assessment/checkout --inject dr-assessment/checkout/reports/assessment.md
   ```

   B is what was read and what was not, with every Inferred and Unknown fact and the region analysis. C is the documentation sources, with the Unverified ones flagged. D is the pattern register, the decision per slot, the Documented exceptions, the rejected overrides and the open inputs. The script replaces only the text between its markers. If a marker pair is missing, it says so and writes nothing.

   Exit 2 with a message that the pattern resolution holds text that looks like a secret means that nothing was written and the report is left unchanged. The details name each path, never the text. Remove the text from `assessment.yaml` and rerun `resolve-patterns` (it starts a new resolution, so decide the slots again), or, when the path is below `slots`, from your own decision in `evidence/pattern-resolution.json`; then run the command again.

## Commands (only when the owner asks)

The guide and the runbook give prose procedures, never commands by default. When the owner asks for commands, first ask which form, unless the request names it: Azure CLI, Bicep, Terraform, Azure PowerShell or portal steps. Put them in a block at the end of the guide chapter or runbook subsection, headed `Commands (untested, <form>)`; in the guide it is the heading `### Commands (untested, <form>)` after Open inputs, which `--check` accepts there and nowhere else. Never run them.

## Check the presentations

Build both presentations first (stages 4 and 6). Then check each one in a headless browser, where one exists:

```bash
node skills/azure-dr-assessment/scripts/check-presentation.mjs --html dr-assessment/checkout/presentations/checkout-current-state.html
node skills/azure-dr-assessment/scripts/check-presentation.mjs --html dr-assessment/checkout/presentations/checkout-proposed-dr.html
```

| Exit | Meaning | Do this |
|---|---|---|
| 0 | Every check passed | Say so in one line. |
| 1 | Bad flags: a usage error in your command | Fix the command and run it again. Do not call the presentation verified. |
| 2 | The HTML file does not exist | The build was refused: see stages 4 and 6. |
| 3 | NOT RUN: no browser was found or it did not start | Write "browser check NOT RUN" in the chat summary. Never write that the presentation was verified. |
| 4 | A check failed | Name the failed checks in the chat summary. When your story data caused it, correct the data and rebuild once. Otherwise report the failure, and do not call the presentation verified. |
| 5 | An unexpected failure of the check itself | Report it, and do not call the presentation verified. |

## Open the diagrams in the canvas (only when the owner asks)

Run this only when the owner asks to open or edit the diagrams in the canvas. Never run it by default: it is not part of the standard run, and the summary and the checks below do not depend on it.

It is the one exception to "every output goes to `dr-assessment/checkout/`". The copies go to the `architectures/` folder of the working folder (or to `$ARCH_CANVAS_DIAGRAM_DIR`, or to `--canvas-dir`), which is outside `dr-assessment/checkout/`, and they hold customer architecture. Tell the owner so. A team that commits the working folder should add `architectures/` to its `.gitignore`, or point `ARCH_CANVAS_DIAGRAM_DIR` at a folder inside `dr-assessment/checkout/`.

To know whether the canvas is available, use the `preflight` result of stage 1: when its `canvas-library` check passed, that is enough to run the script. The check proves the library, not the app extension: if the owner does not see the diagrams in the canvas, say the diagrams still open from the files or in the presentation.

```bash
node skills/azure-dr-assessment/scripts/canvas-link.mjs --root dr-assessment/checkout
```

Give the owner the diagram ids it prints. The canvas gets copies. The files below `dr-assessment/checkout/architectures/` stay the originals, and the presentations are always built from them. When the owner edits a diagram in the canvas, a rerun keeps the edited copy and names the regenerated file in a warning.

| Exit | Meaning | Do this |
|---|---|---|
| 0 | The diagrams are linked | Give the owner the ids, and the folder they went to. |
| 1 | Bad flags: a usage error in your command | Fix the command and run it again. |
| 2 | No diagrams to link | Build the diagrams first (stages 4 and 6). |
| 3 | The canvas library was not found | Say that the diagrams open from the files or in the presentation. |
| 4 | Refused: the canvas folder is inside the skill or plugin directory | Pass `--canvas-dir` with a folder below the working folder. |
| 5 | An unexpected failure of the script itself | Report it. |

## Tell the owner

End with a short chat summary, no more than about fifteen lines:

- the tier, its objectives and the cost profile as a planning ratio, never a price;
- the two regions and whether they are a pair;
- a region mismatch, when `ingest` reported one: the declared primary region against where the in-scope resources are, and that the declared region stays in force;
- the headline gaps: unmet requirements, the weakest link of RPO and RTO, and any tier mismatch;
- the decisions the owner has to make, each named in the summary itself and not only in section D of the report: open inputs, unresolved collisions, rejected overrides, substitutes to confirm, and the documented exceptions that were applied, with a note that approvals cannot be verified by this skill;
- the DR options interview: each choice in `dr_choices` with its type, its option and who chose it, and how many were defaulted, naming every defaulted type: a default is an open decision of the owner, not an owner's decision;
- the playbook folder, when it is not the bundled one (`nonDefaultPlaybooks: true`);
- where the files are: the guide, the report, the runbook, the two presentations and the two diagrams;
- the result of the browser check of each presentation: passed, failed or NOT RUN;
- when an icon fetch failed (`fetch-icons` did not finish, or `present` exited 4 with `zero-icons`): that the presentations were not built, and the exact retry command, the `fetch-icons.mjs` command as you ran it, then the `present` command again.

The decisions, the interview choices and the retry command are never cut to stay within the fifteen lines.

## Before you finish

- No `<!-- fill:` comment is left in the guide, the report or the runbook.
- `node skills/azure-dr-assessment/scripts/establishment-guide.mjs --root dr-assessment/checkout --check` exits 0.
- `node skills/azure-dr-assessment/scripts/ledger.mjs validate --ledger dr-assessment/checkout/evidence/ledger.json` exits 0.
- Every time is labeled Estimated, and no sentence calls an objective compliant, achieved or guaranteed without a drill record.
- The banner, when the pattern pack is not the company pack, is right under the title and the DRAFT note of the report, under the DRAFT line of the runbook, and in the chat summary.

## When something is missing

| Situation | Do this |
|---|---|
| `report-tables` cannot run (no Node) | Write sections B, C and D by hand from what you read, and say that they were not generated. |
| `establishment-guide` cannot run (no Node) | Write the guide by hand in the structure of `assets/templates/dr-establishment-guide.md`, one chapter per service in build order, and say that it was not generated. |
| The playbooks come from another folder | Name the folder in a line above the generated table of section C, such as `Playbooks: <folder> (not the bundled playbooks).`, and in the summary. |
| The presentations could not be built | Say so, deliver the report, the guide and the runbook, and put the diagram as a Mermaid block in section 3. |
| No browser, or it did not start | The browser check is NOT RUN. Say so, and never call a presentation verified. |
| Microsoft Learn was unreachable | Section C says so, and the guidance is Unverified. |

## Never

- Present the runbook as an operational procedure. It is a draft until the owner has rehearsed and approved it.
- Verify, claim or imply an approval. This skill records approvals and cannot verify them.
- Leave the owner a decision that you could make from the evidence.
- Call a default DR choice an owner decision, or leave a defaulted type out of the summary.
- Give commands without being asked, or run one.

## Done when

The guide, the report and the runbook exist, `establishment-guide --check` exits 0, the tables were generated last, the summary was given, and nothing in the files contradicts the ledger or `evidence/dr-options.json`.
