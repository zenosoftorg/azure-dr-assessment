# Stage 3: Ingest

Read the inventory into evidence files. A script does it. You read the summary and the ledger, never the raw workbook and never `inventory.json` in full.

## Run it

```bash
node skills/azure-dr-assessment/scripts/ingest.mjs --assessment dr-assessment/checkout/assessment.yaml
```

The source comes from the assessment: an ARI `.xlsx` (`inputs.ari_file`) or, for a live read, subscription ids (`inputs.live`). When both are given, the ARI file is the inventory of record and the live read serves only DR-region fit checks. The script applies the scope selector, writes `evidence/inventory.json` and a new `evidence/ledger.json` (ids restart at `F-0001`), and an `evidence/.gitignore` that keeps customer data out of Git. Rerunning ingest discards the region-analysis and documentation entries, so run stage 5 after the last ingest. It also numbers the `F-` ids afresh, so a `*.spec.json` from an earlier run may cite ids that now mean something else: write every spec again in stages 4 and 6, and never reuse an earlier run's.

A live read prints the tenant and subscriptions on stderr before its first query. Repeat that to the user. The collector runs only allowlisted read operations and never anything that changes Azure. Do not run `az` yourself to collect inventory.

## Read the result

| Field | What to do with it |
|---|---|
| `sheets` and `omittedSheets` | Say how many sheets were assessed (`sheets.assessed` of `sheets.total`) and name every omitted sheet from `omittedSheets`. A sheet that is omitted or only partly read is Unknown, never "absent". `Overview` and report sheets (Advisor, Policy and similar) are not inventory. |
| `resources` | Total and in scope. If nothing is in scope, the selector or the source is wrong: tell the user. |
| `regionCheck` | Compares the declared primary region with where the in-scope resources are. On a mismatch the declared region stays in force. Put the mismatch in the chat summary and in presentation #1 (stage 4). |
| `warnings` | Report each one. Typical: a sheet cut at the row limit, both an ARI file and subscriptions given, a live permission gap. |
| `facts` | The number of ledger facts written. Every fact is Observed, Inferred or Unknown and cites its sheet and row (`ari:<sheet>!<row>`) or its Resource Graph id. |

## Find facts to cite

```bash
node skills/azure-dr-assessment/scripts/ledger.mjs list --ledger dr-assessment/checkout/evidence/ledger.json --kind fact --strength Unknown --limit 20
```

`--subject` matches an entry's subject exactly, for example `--subject "ari:SQL DBs!3"`. Use the ids (`F-0001`) in the diagram spec and in the report. Secret-like properties were dropped at ingest, and only their names remain.

## When it fails

| Exit | Meaning | Do this |
|---|---|---|
| 2 | The inventory is unreadable or not supported | Say so and name the alternatives: an `.xlsx` ARI export, or a live read. Do not guess at the content. |
| 3 | A live source without `az`, its `resource-graph` extension or a login | Tell the user what is missing, or continue with an ARI file. |
| 4 | The evidence folder would be inside the skill or plugin | Choose another output folder (stage 2). |

A live permission gap is a partial result, not a failure: report the gap, and the affected facts are Unknown.

## Never

- Read the raw workbook, or `inventory.json` in full, into the conversation.
- Run `az` yourself to collect inventory.
- Treat a sheet that was not assessed as proof that nothing exists there.
