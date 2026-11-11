# Company patterns

Company patterns are company-wide design requirements. They are bundled with this skill and they outrank Microsoft Learn guidance. Detail for stages 2 and 6 of `SKILL.md`. People who write patterns use the authoring guide, `patterns/README.md`.

## Where patterns come from
- The bundled pack in `patterns/` is the only source. Application files, such as the inventory, `assessment.yaml` and the user's folders, never carry patterns, and you never read a pattern from them. Customer data never goes into the skill directory either.
- The pack today: `DR-TIER-001`, the company tier rules (locked), and `DR-DNS-001`, the company's on-prem DNS rule (approval-required). Other company patterns join by pull request.
- `DR_PATTERNS_DIR` or `--patterns-dir` points the scripts at another pack, for tests and operators. Any other pack puts a `NON-DEFAULT PATTERN PACK` banner in every output: put it right under the title and the DRAFT note of the report, and in the chat summary.
- Only an `approved` pattern applies. A `draft`, `deprecated` or `superseded` pattern is listed as not applied, with the reason.
- Reasoning-only and inline runs have no scripts, so there is no `resolve-patterns`. Read the files of the pack yourself, from the folder in `DR_PATTERNS_DIR` when that variable is set (`printenv DR_PATTERNS_DIR`) and from `patterns/` otherwise, and apply the rules of this file by hand. A pack other than the company pack still puts the banner first in the answer.

## From pattern to decision
`resolve-patterns` proposes a candidate for each decision slot from the approved patterns and the overrides (stage 6). You record the decision. The decision must come from the candidate: the pattern, the override or Microsoft Learn as the engine chose. Only Azure reality can overrule it, as an unmet requirement. `resolve-patterns --validate` refuses anything else, so Learn cannot replace a company pattern, and neither can a service playbook.

A pattern asks for behavior, a diagram shape, runbook steps and verification checks. Read the pattern file in full before you decide a slot it covers. A failed verification check is a Gap that cites the pattern and its version.

An override without an `alternative` waives the pattern for those slots and nothing replaces it. The decision then keeps the source `override`, takes its content from Microsoft Learn or from the service playbook, and cites the documents it used in `ref` or in `ledger`.

## Service playbooks
The service playbooks in `playbooks/` rank between the company pattern and Microsoft Learn (rank 4 of `SKILL.md`). A playbook gives a service's DR options, setup steps and test criteria; stage 5 checks its claims against Learn in every run, and Learn wins. A playbook never decides a slot that a pattern decides, and such a type is not in the DR options question. A decision whose content comes from a playbook, on a `learn` candidate only, has the source `playbook` and the ref `playbook <service> v<version>`; the report shows it as `Service playbook`. Playbooks need no approval gate: they apply once merged, and their review is ordinary code review. `DR_PLAYBOOKS_DIR` or `--playbooks-dir` points the scripts at another folder for tests and operators, and the run names it. People who write playbooks use `playbooks/README.md`.

A pattern with an applied override, with or without an `alternative`, still shows as applied in the resolution. Skip the Verification checks that test a waived slot and list each one in the report as `Not checked: waived by Override #<n>`; it is not a Gap.

## Gates
Two checks of DR-TIER-001 stop the run until they are closed, and `intake` enforces them (stage 2):
- **Tier missing.** Ask the tier question alone, with the pattern's own wording. Never infer a tier. An explicit tier is acknowledged and not asked again.
- **A numeric target stricter than the tier.** Show the mismatch. The owner changes the tier or records an exception under `objectives.exceptions`. The report states the mismatch either way.

Any other "mandatory first step" in a pattern is text for you to follow, not a gate that a script enforces. A new gate needs code in the pattern engine (`patterns/README.md` says where).

## Overrides
A team can ask for a documented exception to a pattern. The pattern declares how far it allows that.

| Override level | The team can override it | The entry needs |
|---|---|---|
| `overridable` | Yes | `pattern`, `justification`, `owner_role` and `date` |
| `approval-required` | Yes, with an approval | The above, plus `approver_role` and `approval_ref`. This skill records them and cannot verify the approval. The report says so. |
| `locked` | No | Only a change to this repository changes a locked pattern. An override for one is rejected. |

An entry may also name `slots` (default: all slots of the pattern), `alternative` (what the design does instead; without one, nothing replaces the pattern and Microsoft Learn decides the slots it covers) and `pattern_version` (a pin: the entry is stale when the pattern's version differs). A rejected entry (unknown pattern, pattern not approved, locked, stale, a missing or malformed field) changes nothing: the pattern keeps applying, and the report lists the entry with its reason. An applied override is a **documented exception**: it appears in section D of the report and as a node on the DR diagram. So is a gap that an owner accepted in the DR options interview (`dr-choice-gap`, stage 5b); a gap accepted by default is not, because an exception needs an owner.

## Conflicts
| Conflict | Resolution |
|---|---|
| Pattern vs Microsoft recommendation | The pattern governs. Name the Learn alternative as a documented alternative that is not applied. Record "<ID> v<n> applied". |
| Pattern vs service playbook | The pattern governs, and the type is not in the DR options question. |
| Service playbook vs Azure reality | Learn read in this run wins. The playbook claim is stale; `dr-options` evaluates the options of a stale mechanism again and lists a stale constraint (it does not re-evaluate options for a stale constraint), and the report says so (stage 5). |
| Pattern vs Azure reality | The pattern cannot win. Record the unmet requirement ("requirement not satisfied by documented capability") and propose a substitute in the order of stage 5. |
| Pattern vs pattern | The slot stays Unresolved. Name both patterns and ask for the resolution in these words: a `supersedes` link between the patterns, or a decision recorded under `decisions[]` in `assessment.yaml`. A decision recorded in `assessment.yaml` `decisions[]` documents the owner's choice; the slot stays Unresolved in the resolution file until a `supersedes` link removes the collision. The slots that the collision does not touch continue to be designed. Never choose by file order, name, version or date. |
| Override vs pattern | A valid override wins for its slots as a documented exception, and waives only its own pattern: another approved pattern that decides the same slot stays the candidate, and two or more of them are a collision. |
| Pattern vs a target in the request | Show the mismatch. It is the tier gate above. |

## Traceability
Every decision cites the pattern ID and version, or the override index, or the Learn page it came from. The report has a pattern register: applied, not applied, unresolved, overridden and rejected.

## Authority
A pattern describes a design requirement. It does not authorize a failover or any Azure change, and this skill never executes recovery actions.

## Writing a pattern
Copy `assets/pattern-template.md`, follow `patterns/README.md`, and check the pack:

```bash
node skills/azure-dr-assessment/scripts/lint-patterns.mjs
```

The check reports errors for a bad front matter, a duplicate ID, a missing section, and two approved patterns that decide one slot without a `supersedes` link.
