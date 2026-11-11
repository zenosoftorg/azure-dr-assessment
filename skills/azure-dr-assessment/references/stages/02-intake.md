# Stage 2: Intake

Turn the user's words and any `assessment.yaml` into a complete, normalized `dr-assessment/{app}/assessment.yaml`, asking as little as possible. A script does the merging and the checks. You do the listening and the asking.

## Run it

Pass everything you understood from the request as flags. Leave out what you do not have. Never guess a value.

```bash
node skills/azure-dr-assessment/scripts/intake.mjs --app "Checkout" --tier 1 --primary "West Europe" --dr "Sweden Central" --ari ari-export.xlsx
```

More flags: `--subscriptions <ids>` and `--tenant <id>` for a live read, `--rto` and `--rpo` (numbers only, such as `30m`, `2h` or `0`), `--failure-scope`, `--environment`, `--scope-resource-group`, `--scope-tag name=value`, `--scope-subscription`, `--pause-after-current-state` and `--out <folder>`. A rerun names the file: `--assessment dr-assessment/checkout/assessment.yaml`. `--app` is needed only the first time.

The user's wording is fine for regions ("West Europe"): the script stores ARM names (`westeurope`). "Near zero" is not a number: do not pass it as an RTO or RPO. Note it as an open input instead, except for Tier 0 (below).

## The name, the regions and the optional inputs

- **The name.** `--app` names the workload and the output folder. Use the name the user gave. Without one, derive it only once the scope is known: the resource group or the tag value of the scope selector, else the inventory file name without its extension (a scope of `rg-checkout` gives the folder `dr-assessment/rg-checkout/`). When the scope is still pending (an inventory with several candidate workloads, and no resource group, tag or subscription in the request or the file), do not run intake with a name yet: run `node skills/azure-dr-assessment/scripts/ingest.mjs --ari <file> --summary-only`, which writes nothing, ask the scope question first (the tier, when missing, is asked before it), and run intake once with the name derived from the answer and the matching `--scope-...` flag. Announce the name you chose and do not ask for it.
- **One DR region per run.** When the user names several candidate regions, assess the first one and tell them to run the skill again for each other region. Intake refuses a list of regions.
- **Tier 0 has no numeric band.** Pass any number the owner gives for Tier 0 as their own definition of "near zero" (`--rto`, `--rpo`). Stage 6 tests whether the design can meet it.
- **Optional inputs have no flag:** data residency, a cost ceiling and test windows. When the user gives one, set `constraints.data_residency`, `constraints.cost_ceiling` or `constraints.test_windows` in `assessment.yaml` with the file tools, then rerun intake, which keeps them. Stage 5 reads the residency, stage 7 sets the cost ceiling beside the tier's cost profile, and the test plan uses the test windows.

## Read the result

| You see | Do this |
|---|---|
| `announce` | Tell the user the output folder in one line. Do not ask about it. |
| Exit 4 and `gates[0].id` is `tier-missing` | The whole reply is the DR-TIER-001 question, `gates[0].question` word for word: alone, with no commentary, no table, no other question and no instruction to set a key and rerun. The open question is the end of the reply, also when nobody can answer in this run. Never pick a tier from the workload's name, importance or size. After the answer, rerun with `--tier`, restate what the tier selects (pattern, targets, relative cost) and carry on. A tier that is already explicit in the request or the file is acknowledged, not asked again. |
| Exit 4 and `target-stricter-than-tier` is open | Show `gates[1].detail`. Offer two ways out: change the tier, or record an exception. For an exception, ask the owner for what is accepted, the approver role and the date, add the entry under `objectives.exceptions` in `assessment.yaml` with the keys `what`, `approver_role` and `date` (written `YYYY-MM-DD`), and rerun. One exception covers every target that is stricter than the tier, so name all of them in what is accepted. The report will still say that the tier does not meet the target. |
| Exit 4 and the error says the output folder is inside the skill or plugin | This is the only time you ask about the output location. Do not choose an output folder yourself, and do not pass `--out` with a folder of your own: give the reason (the working folder is inside the skill or plugin directory) and ask the owner for a writable folder. When nobody can answer in this run, end with that question. After the answer, rerun with `--out`. |
| `missing` is not empty | Ask for everything in `missing` together, in one message, naming what you already have. The tier is never part of this message: it was asked first. No architecture, diagram or design text is produced until the primary region and the DR region are both known. Ask for what is missing, the regions and the scope together; a missing DR region is never an open assumption. This also holds in the turn after the tier answer: a design with "recovery region unresolved" is wrong, ask for the regions. |
| `needsScope` is true | Ask one short extra question: which of the `candidates` is the workload? Offer them by `key`. Accept resource groups, a tag or subscriptions, and rerun with `--scope-resource-group`, `--scope-tag` or `--scope-subscription`. |
| `needsScope` is false and there is one candidate | Carry on and say which scope you assumed. Label it Inferred. |
| `complete` is true and `gatesOpen` is 0 | Intake is done. Go to stage 3. |

Exit 2 means a file or value is invalid, and `details` lists every problem with its path: fix what the user can fix and rerun. Exit 1 means you passed a value you should have asked about.

## Never

- Ask for something intake already holds.
- Ask a question that is not in `missing`, a gate, the scope question or the missing fields of an override (see "Overrides and decisions"). The discovery questions of DR-TIER-001 (business functions, owner, dependencies, constraints) become assumptions and open inputs in the report. The inputs of DR-DNS-001 (record type, TTL, record owner, private-zone integration) are listed as open inputs by stage 6; if the user volunteers them, write them under `pattern_inputs.DR-DNS-001` in `assessment.yaml` with the keys `record_type`, `ttl`, `record_owner_role` and `private_zone_integration`.
- Put a pattern in `assessment.yaml`. Patterns come only from the bundled pack. The file carries overrides, never patterns.
- Leave helper files in the output folder. Scratch or helper files, such as a script or a scratch json, go to the operating system temp folder or to a temp folder inside the working folder outside `dr-assessment/{app}/`, and are deleted before the final answer; the output folder holds only the files that the output contract lists.

## Overrides and decisions

An override is a documented exception to a company pattern. Write it under `overrides` in `assessment.yaml` only when every field it needs is present: the pattern ID (`pattern`), a justification (`justification`), an owner role (`owner_role`) and a date (`date`, written `YYYY-MM-DD`); for an approval-required pattern also an approver role (`approver_role`) and an approval reference (`approval_ref`). Two keys are optional: `slots`, a list of the slots it waives (without it, every slot the pattern decides), and `alternative`, what replaces the pattern (without it, Microsoft Learn decides the waived slots). If a field is missing, ask for the missing fields once and write nothing until they arrive. Stage 6 judges every entry: a rejected entry is reported with its reason and the pattern keeps applying. You cannot verify an approval, and the report says so. A team cannot override a locked pattern.

Record other answers the owner gives under `decisions`, each with the keys `question`, `answer`, `by` (who gave it) and `date` (written `YYYY-MM-DD`). Use exactly these names: intake rebuilds each decision from them and drops any other key.

Every intake run leaves `assessment.yaml` in its normalized form, so comments and keys that are not part of the schema are dropped. Write each entry as a block mapping, one key per line: the file reader rejects a `{ key: value }` flow mapping with exit 2.

## When you cannot ask

In non-interactive use (a prompt given with `-p`, nobody to ask), stop after intake and end with the open question. When the tier is missing that question is the DR-TIER-001 question, word for word and alone, exactly as in the table above; do not replace it by an instruction to set `objectives.tier` and rerun. For any other open question the owner answers by editing `assessment.yaml` and rerunning: "Use /azure-dr-assessment with dr-assessment/checkout/assessment.yaml." A rerun asks nothing it already has.

## Pause option

If the owner wants to check the as-is picture before the DR design, set `--pause-after-current-state`. The run then stops after stage 4, and the owner's corrections go into `decisions` in `assessment.yaml`.
