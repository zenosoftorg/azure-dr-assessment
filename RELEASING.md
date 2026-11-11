# Releasing azure-dr-assessment

Nothing here blocks building or testing. These are the steps to finish before the first release, that is, before a team installs the plugin.

## Release gates

Four confirmations belong to the owner. A box is ticked only when the files agree with it: `tests/unit/release-gates.test.mjs` checks each box against the repository, in both directions.

- [ ] **R1. Ownership and licence of the vendored code.** The `architecture-canvas` extension and the `architecture-presentation` skill were copied from the owner's personal Copilot configuration, and the repository has no licence. The owner confirms who owns that code and which licence this repository carries. To close the gate:
  1. Add `LICENSE` with the chosen licence.
  2. Add `"license": "<SPDX identifier>"` to `.claude-plugin/plugin.json`.
  3. In `NOTICE.md`, replace each sentence that mentions "release gate R1" with the decision and its date.
  4. Tick this box.
- [ ] **DNS. The text and the owner of DR-DNS-001.** The pattern is drafted from the owner's statement that the company's on-prem DNS is authoritative. The record type, the TTL, the record owner and the private-zone integration are inputs from the application team, and the override level is `approval-required` for every tier. The owner confirms or changes the text, and confirms who owns the pattern: `owner_role` is copied from DR-TIER-001 (`landing zone platform architecture`), because no spec text names the owner of DR-DNS-001. To close the gate:
  1. Edit `skills/azure-dr-assessment/patterns/DR-DNS-001.md` as the owner says. Set `owner_role` in its front matter to the role that owns the pattern, or leave it when the owner confirms `landing zone platform architecture`.
  2. If the rules changed, raise `version` there, and change every place that pins the old number in the same commit:
     - `skills/azure-dr-assessment/patterns/DR-DNS-001.md` itself: "cite it as DR-DNS-001 v1" in Required behavior.
     - `tests/unit/pattern-dr-dns-001.test.mjs`: `version: 1` in the front-matter row, the title "traffic-dns resolves to DR-DNS-001 v1 ..." and `version: 1` in the candidate that the test expects.
     - `tests/unit/pack-integration.test.mjs`: the two `pattern("DR-DNS-001", 1)` expectations.
     - `tests/unit/script-report-tables.test.mjs`: the three expectations that say `DR-DNS-001 v1`, one of them the register row `| DR-DNS-001 | v1 |`.
     - `tests/scenarios.md`: "`DR-DNS-001` v1" in DR-11 and in DR-14.
     - `skills/azure-dr-assessment/references/stages/06-dr-design.md`: `"ref": "DR-DNS-001 v1"` in the example decision.

     The tests that build their own resolution (`resolve.test.mjs`, `report-tables.test.mjs`, `diagram-spec-dr.test.mjs`, `story-template-dr.test.mjs` and `script-present-dr.test.mjs` under `tests/unit/`) keep `v1` on purpose.
  3. Delete the sentence "The pattern owner confirms this text before the first release."
  4. Run `npm run lint:patterns` and `npm test`.
  5. Tick this box.
- [ ] **Icons. The legal position on icon distribution.** The default stands until the owner decides otherwise: the icons are downloaded from Microsoft on first use and are never committed. To close the gate with that default, add the line "Icon distribution decision: download on first use, <date>." to `NOTICE.md` and tick this box. Vendoring the icons is a change that needs its own plan, because it touches `.gitignore`, `fetch-icons` and `NOTICE.md`.
- [ ] **Bands. The numeric tier bands.** The company tier file gives numbers for most of the targets, for example the Tier 1 RTO of 30 minutes to 2 hours, but only the words "seconds–minutes" for the Tier 1 RPO. `DR-TIER-001.md` reads those words as 1 second to 59 minutes (`parameters.tiers`), and the check that stops a target stricter than the tier uses that reading. The owner confirms the numbers or gives others. To close the gate:
  1. If the owner reads the words differently, change `min` and `max` of the Tier 1 `rpo` in the front matter of `skills/azure-dr-assessment/patterns/DR-TIER-001.md`, and in the same commit the two places that repeat them: `tests/helpers/tier-fixture.mjs` (the test double that `tests/unit/pattern-dr-tier-001.test.mjs` compares with the pack) and the expected band in `tests/unit/tiers.test.mjs`.
  2. Delete the comment next to `min` and `max` that says "release gate Bands".
  3. Run `npm run lint:patterns` and `npm test`.
  4. Tick this box.

## Checks on a real machine

Checks 1 to 9 need the Copilot CLI and a GitHub login that can read this repository; check 10 needs only Node and the owner's current tier file; check 11 needs model sessions with the plugin installed. Run the first nine against a throwaway profile (`export COPILOT_HOME="$(mktemp -d)"`), so that nothing of yours is touched. Record the result of each check in the release pull request.

1. **Install from GitHub on a clean profile.**

   ```bash
   copilot plugin marketplace add zenosoftorg/azure-dr-assessment
   copilot plugin install azure-dr-assessment@azure-dr-assessment-marketplace
   copilot plugin list
   copilot skill list
   copilot mcp list --json
   ```

   Expect the plugin in the list, `azure-dr-assessment` and `architecture-presentation` among the plugin skills, and one `microsoft-learn` server whose `sourcePlugin` is `azure-dr-assessment`. `tests/e2e/install-clean-profile.test.mjs` runs the same steps against this working tree. This check runs them against GitHub, where the repository is private.
2. **Update.** After a new commit on `main`: `copilot plugin marketplace update`, then `copilot plugin update azure-dr-assessment@azure-dr-assessment-marketplace`. Expect the new commit's files.
3. **The Learn server declared twice.** On a profile that has the Microsoft Docs plugin (`copilot plugin install microsoftdocs/mcp`; the CLI calls direct installs deprecated but still runs them), repeat step 1. Expect one `microsoft-learn` entry with the URL `https://learn.microsoft.com/api/mcp`. Do the same in the desktop app and look at its list of tools: no tool appears twice. If a host lists the server twice, delete `.mcp.json`, say in `README.md` that the Microsoft Docs plugin is a prerequisite, and change `tests/e2e/install-clean-profile.test.mjs` to match.
4. **The canvas.** In the Copilot app, ask the agent to install the extension from `https://github.com/zenosoftorg/azure-dr-assessment/tree/main/extensions/architecture-canvas`, run `node skills/azure-dr-assessment/scripts/canvas-link.mjs --root dr-assessment/checkout` after a run, and open a listed diagram. Then update the extension and check whether `$COPILOT_HOME/extensions/architecture-canvas/Final SVG Icons` survived. If the installer removed it, `fetch-icons` fetches it again, and `README.md` should say so.
5. **The owner's personal copies are present (R2).** On a machine that still has `~/.copilot/skills/architecture-presentation` and `~/.copilot/extensions/architecture-canvas`, run `copilot skill list --json`. Expect `architecture-presentation` once, from the personal copy: it shadows the plugin's skill of that name (`tests/e2e/install-clean-profile.test.mjs` checks the same with a stand-in). Then run `node skills/azure-dr-assessment/scripts/preflight.mjs` from the plugin folder and expect the `canvas-library` check to name this repository's `extensions/architecture-canvas`. The pipeline runs the vendored builder by path, so it does not depend on which skill the host lists: run scenario DR-14 and check that both presentations build.
6. **A live read-only run.** With `az login` done and `az extension add --name resource-graph`, ask for an assessment of one subscription ID (scenario DR-06). Expect read-only commands only, a partial result with the permission gaps named, and no secrets anywhere below `dr-assessment/`.
7. **A real ARI export.** Run `DR_ARI_SAMPLE=<path to the sanitized export> node --test tests/unit/ari.test.mjs`. Expect the sample test to run and pass. Then run scenario DR-14 on the same export.
8. **Branch protection.** On GitHub, protect `main`: require a pull request with a code-owner review, and the checks `test (22)` and `test (24)`. `CODEOWNERS` only works with this setting (risk R3).
9. **CI.** Open a pull request and read the `ci` run. Expect both Node versions green. In the output of `tests/e2e/pipeline.test.mjs`, look for "NOT RUN: the browser check": if it appears, Chrome did not start on the runner, and the presentations were not checked in a browser.
10. **The tier file wording.** The digest in `tests/unit/pattern-dr-tier-001.test.mjs` proves that the three pinned sections of `DR-TIER-001.md` (Required behavior, Mandatory first step and Required response structure) did not change since they were pinned. It does not prove that they match the company tier file, which is not in this repository. The owner gives the path of the current `azure-dr.instructions.md` at release time. Run `node tests/manual/tier-file-diff.mjs <that path>`. Expect exit 0, which means that every line of the pinned sections is in the tier file, and under "tier file only" nothing but the tier file title, its front matter and the headings of its fixed sections. A line under "pattern only", or any other "tier file only" line, means that the pattern and the tier file have drifted apart: change the pattern text, the digest in the test and `parameters.tiers` in one pull request, as the header of `DR-TIER-001.md` says, and run this check again.
11. **The live scenarios.** `tests/scenarios.md` holds eighteen scenarios, and its results table says NOT RUN in every row: they judge what a model does with the skill loaded and Microsoft Learn reachable, so no script and no unit test can stand in for them. The section "Who runs the scenarios" of that file gives the same split as this check, and a test keeps the two equal.
    - **The owner runs DR-10, DR-11 and DR-12 by hand before the release**, because they judge design decisions that the owner accepts or rejects: the mechanism class of every service between two regions that are not a pair (DR-10, with the sample inventory written with `--service-bus`), the precedence of the on-prem DNS over Traffic Manager at Tier 1 and the conflict that Tier 0 shows as a Gap (DR-11, one run for each), and the five override runs A to E (DR-12). For v3 the owner also runs DR-15, the design choice of the DR options interview (Key Vault split to its pair). Use a fresh session for each run. The owner also runs what needs the owner's machine: DR-05 step 5 (a standalone chat of the desktop app), DR-06 part B (an authorized test subscription) and DR-06 part A with the real export of check 7.
    - **The acceptance run with a live model takes the rest**, in sessions with the plugin installed in a throwaway profile: DR-01 to DR-04, DR-07 to DR-09, DR-13 and DR-14, then DR-05 steps 1 to 4, DR-06 part A with the sample inventory, and DR-06 part C, and for v3 DR-16 to DR-18. It runs before the owner's half, and the owner reads its notes.
    - Write PASS, FAIL, PARTIAL or NOT RUN in the results table of `tests/scenarios.md` for every row, with the exact excerpt of a failure in the notes. A scenario that nobody ran stays NOT RUN, and the release notes say so. The release waits for DR-05, DR-06, DR-13 and DR-14 to pass, which is the done-when of Plan 5, for the owner's runs of DR-10, DR-11, DR-12 and DR-15, and, for v3, for DR-16 to DR-18 to pass in the acceptance run.

## Cutting a release

1. Close the four gates and record the result of every check above.
2. Set the same version in `package.json` and `.claude-plugin/plugin.json`, for example `3.0.0`. A test fails when the two differ.
3. Merge the change through a pull request, and tag the merge commit `v3.0.0`.
