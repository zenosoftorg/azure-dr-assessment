# Service playbooks

A service playbook is the curated, Learn-cited know-how for one Azure service: its DR mechanisms, its constraints, the ranked options when the DR region is not the primary's pair, the migration from a paired setup, failover and failback steps, and measurable test criteria. The skill reads the playbooks in stage 5 (classification), stage 5b (the DR options question) and stage 7 (the establishment guide and the runbook).

Playbooks hold generic Azure know-how only: no customer names, resources, ids or inventory content, and no secrets. Every source is a `https://learn.microsoft.com/` page.

## Where a playbook sits

Per decision, the first source that applies wins; Azure reality vetoes whatever wins:

1. Azure reality: observed state, region limits and the Learn facts read in the run. It vetoes anything, including a playbook claim.
2. A valid override in `assessment.yaml`.
3. A company pattern of the bundled pattern pack (`patterns/`). A playbook never decides a slot that a pattern decides.
4. The service playbook: the default source for options, workarounds, setup steps and test criteria.
5. Learn-derived guidance, for a type without a playbook.

Stage 5 checks every mechanism and constraint of a playbook against Learn in each run. When Learn disagrees, the claim is stale, Learn wins in the outputs, and the guide says so.

## No approval gate

Unlike a company pattern, a playbook applies as soon as it is on `main`. Its review is ordinary code review; a new playbook ships as a v1 draft that the owner reviews. Playbooks have no `CODEOWNERS` entry.

## Format

Copy `assets/playbook-template.md` to `playbooks/<service>.md`. The file name is the `service` slug. The grammar:

| Part | Rule |
|---|---|
| Front matter | `service`, `title`, `arm_types`, `slot`, `version`, `verified_on`, `learn_sources`, all required, in block-style YAML. `slot` is a slot id of `patterns/README.md`. An ARM type belongs to one playbook only. |
| Sections | `## Mechanisms`, `## Constraints`, `## Non-paired options`, `## Migration from a paired setup`, `## Failover and failback`, `## Test criteria`, exactly these, in this order. |
| Mechanisms | One `### <name>` per mechanism with `Replicates`, `Paired` (yes or no), `Nonpaired` (yes or no), `Failover` (Microsoft-managed, customer-managed, manual or not applicable), `Estimated RPO`, `Estimated RTO` and `Source`. |
| Constraints | One `### <heading>` per constraint: prose, then one `- Source:` line. |
| Non-paired options | One `### <option id>: <title>` per option, in rank order, with `Kind`, `Target`, `Uses mechanism`, `Estimated RPO`, `Estimated RTO`, `Prerequisites`, `Cost notes`, `Gives up`, `Recommended when` and `Source`, and optionally `Decides slots` (the slot ids the option decides itself, such as `traffic-dns` for an option that brings its own traffic switch: when a company pattern decides that slot, the option is vetoed, because a playbook never decides a slot that a pattern decides). A `split-region` option targets `pair-region`; every other kind targets `dr-region`. `accept-gap` is reserved. |
| Migration from a paired setup | `### Recognise today's setup`, `### Build`, `### Validate`, `### Cut over`, `### Decommission`, `### Keep until cut-over`; the four in the middle are numbered lists. |
| Failover and failback | `### Failover` and `### Failback`, one table each with the header `# \| Step \| Role \| Estimated duration \| Verification \| Abort condition`. Roles, never names; every Estimated duration starts with `Estimated`. |
| Test criteria | `### TC-1: <title>`, `TC-2`, ... without gaps, with `Applies to` (option ids), `Pass condition`, `How to measure`, `Evidence` and `Frequency`. Every option is listed by at least one criterion. |

Step labels (Build, Cut over, Decommission, Failover and Failback): the runbook keeps a step for one option only when its text starts with exactly one option id and `: ` (`/^([a-z0-9-]+):\s+/`); any other form (`a, b:`, `a and b:`, `a (qualifier):`, `All options:`) is read as applying to every option. So a step that applies to every option has no label; a step that applies to exactly one option starts with `<option-id>: `; a step that applies to two or more options, but not all, is written once per option, each copy starting with `<option-id>: ` and worded for that option. A qualifier goes after the colon (`secondary-load-balancer: for a public front end, ...`). Refer to another step by its part and what it does (`the Build step that creates the failover group`), never by its number: the guide and the runbook keep only the steps of the chosen option and renumber them, so `Build step 6`, `Cut over 2`, `step 4` or `steps 6 to 8` would point at the wrong step. The lint refuses a numeric step reference (rule `step-number`).

An estimate starts with a duration (`30m`, `4h`, `0`) or `unknown`, then gives its basis in brackets. An option's Estimated RPO and RTO follow decision V3-D2 of the v3 contracts: a number that Learn publishes, cited next to the value, or else an explicit team-set starting value labelled `Estimated, team-set starting value` and tied to the test criterion that proves it in the first drill (`15m (Estimated, team-set starting value: the sync interval the team sets; Learn publishes no figure; TC-2 proves it)`). An RPO of `0` only for a stateless tier, such as application content that a pipeline deploys to both regions. `unknown` stays only where the team can neither set nor drill the value, with the reason; in the bundled set that is the documented exception of three options: `key-vault` `paired-failover-split`, `event-hubs` `metadata-geo-dr` and `service-bus` `metadata-geo-dr`. The first rests on a replication and failover that Microsoft controls, so the team can neither set nor drill them; the other two replicate metadata only, so the loss of events or messages is the application's own and is recorded by the owner in a test criterion, not set as a number of the option. Mechanisms keep `unknown (<why>)` where Learn gives no figure. Never invent a number. The option ids of the first set are fixed in the v3 contracts, section 7 (`docs/superpowers/plans/2026-11-09-dr-v3-contracts.md`).

## Lint

```bash
npm run lint:playbooks
node skills/azure-dr-assessment/scripts/lint-playbooks.mjs --playbooks-dir <folder> --today <YYYY-MM-DD>
```

The lint refuses bad or missing front matter, a section missing or out of order, an option with a missing field, an unknown `Kind` or a wrong `Target`, an option that no test criterion applies to, a test criterion without a pass condition, measurement, evidence or frequency, a source that is not a Learn URL or is missing from `learn_sources`, an ARM type in two playbooks, a reference to a step by its number, an unlabelled step that names some but not all options (rule `option-text`: label it, once per option, or word it for every option), and secret-like text. It warns when `verified_on` is more than 90 days old. CI runs it on every push.

`--playbooks-dir <folder>` or `DR_PLAYBOOKS_DIR` points every script at another folder, for tests and operators; the scripts then report `nonDefaultPlaybooks: true`.

## Authoring a playbook

Each playbook is written from Learn by one session and checked by a second, independent pass before it is committed.

1. **Research.** Start from the service's reliability article (`https://learn.microsoft.com/en-us/azure/reliability/reliability-<service>`, the article named in `assets/learn-service-map.json`), its multiregion and backup sections, and the Learn pages it links for the named mechanisms. Query Learn about one service at a time, with generic service, SKU and region terms only: never a customer, resource or inventory name (GC-14).
2. **Write.** Copy the template. Write each mechanism, constraint and option with the Learn page it rests on in its `Source` line, and list every cited page in `learn_sources`. Use the option ids of contracts section 7 in its order. When Learn shows that an option is not supported, drop it; when Learn documents an option the row lacks, add it. Either change amends the row of contracts section 7 and `tests/helpers/playbook-set.mjs` in the same task.
3. **Fill the six sections.** Mechanisms and Constraints state what Learn says, quoting short phrases where the wording matters. Options give the Estimated RPO and RTO with their basis. Migration, Failover and failback, and Test criteria turn the Learn procedures into steps with roles, verifications, abort conditions and measurable pass conditions.
4. **Lint.** Run `npm run lint:playbooks` until it reports no finding for the file.
5. **Second pass.** Another session or subagent, which did not write the file, re-reads every cited Learn page and checks every claim in sections 1 to 3 and every step of sections 4 and 5 against it. It records each claim with the page checked and `agree` or `disagree` in the playbook's second-pass record, a table with one row per claim (claim, page checked, verdict) in the description of the pull request that adds or changes the playbook, under the heading `Second pass` with the date of the pass. Every disagreement is fixed in the playbook (the verdict becomes `fixed`), and `verified_on` is set to the date of the second pass.

### Acceptance checks

A playbook is done when all of these hold:

- `npm run lint:playbooks` exits 0 and reports no finding for the file.
- Every `Source` and every `learn_sources` URL starts with `https://learn.microsoft.com/`.
- Every option is in the `Applies to` of at least one test criterion.
- The service, ARM types, slot and option ids (with their kinds, in rank order) equal the row of contracts section 7, or the row was amended in the same task (`node --test tests/unit/playbook-pack.test.mjs` passes).
- The second-pass record lists each claim with the page checked and its verdict, and no verdict is `disagree`.
- `verified_on` is the date of the second pass, the `Date` of the record.

## Drift

The weekly online run (`.github/workflows/online.yml`, `DR_ONLINE_TESTS=1`) checks that every `learn_sources` URL of every bundled playbook still answers 200. A unit test (`tests/unit/playbook-set.test.mjs`) checks every playbook against the curated catalogue `assets/learn-service-map.json`: a service whose ARM types the catalogue lists only with no built-in multiregion support has no mechanism with `Paired: yes` or `Nonpaired: yes`. A playbook whose `verified_on` is older than 90 days is re-verified by the procedure above.
