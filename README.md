# azure-dr-assessment

A Copilot skill for Azure disaster recovery. Give it an Azure Resource Inventory (ARI) export or read-only access to a subscription, the application's DR tier, and a primary and a DR region. It rebuilds the workload's architecture, proposes the DR architecture with a failover walkthrough, and writes a report and a draft runbook. Microsoft Learn is read live. The company patterns in this repository outrank Learn guidance and never outrank Azure's technical limits.

The repository is self-contained. It also ships the `architecture-presentation` skill and the optional `architecture-canvas` extension. The only thing it downloads is Microsoft's icon set, on first use.

## Install

### The plugin (recommended)

```bash
copilot plugin marketplace add zenosoftorg/azure-dr-assessment
copilot plugin install azure-dr-assessment@azure-dr-assessment-marketplace
copilot plugin list
```

This repository is its own plugin marketplace. The plugin brings both skills and the Microsoft Learn MCP server (`microsoft-learn`). Update later with:

```bash
copilot plugin marketplace update
copilot plugin update azure-dr-assessment@azure-dr-assessment-marketplace
```

`copilot plugin install zenosoftorg/azure-dr-assessment` also works today, but the CLI calls direct installs deprecated.

If the `microsoftdocs/mcp` plugin is installed too, both declare the server `microsoft-learn`. `copilot mcp list` shows it once.

A personal skill with the same name as one of the plugin's, such as your own `architecture-presentation`, is listed instead of the plugin's. The assessment does not depend on which one is listed: its scripts run the vendored builder by path.

### From a clone

```bash
git clone https://github.com/zenosoftorg/azure-dr-assessment.git
copilot skill add <clone>/skills
```

Keep the whole clone. The scripts import the vendored code from elsewhere in the repository, so copying one skill folder out of it is not supported.

This route does not bring the `microsoft-learn` MCP server (only the plugin declares it), so without it the Microsoft Learn guidance falls back to Unverified unless the Learn CLI fallback works. Add the server in one of three ways: use the plugin route above, install the Microsoft Docs plugin (`copilot plugin install microsoftdocs/mcp`), or add it by hand:

```bash
copilot mcp add --transport http microsoft-learn https://learn.microsoft.com/api/mcp
```

### The canvas (optional)

In the Copilot app, ask the agent to install the extension from `https://github.com/zenosoftorg/azure-dr-assessment/tree/main/extensions/architecture-canvas` (scope: user). The skill works without it. With it, you can open and edit the generated diagrams. Only when you ask, the skill copies the diagrams into the folder the canvas lists, `architectures/` of your working folder (or `$ARCH_CANVAS_DIAGRAM_DIR`). That folder is outside `dr-assessment/<app>/` and holds your architecture: see Data handling.

### Icons

The diagrams and presentations use Microsoft's official architecture icons. They are not committed here: Microsoft allows them only for architectural diagrams, training materials and documentation (see [NOTICE.md](NOTICE.md)). The first run of the skill announces the download and runs it. To run it yourself, from this repository or the plugin folder:

```bash
node skills/azure-dr-assessment/scripts/fetch-icons.mjs
```

The icons go to `$COPILOT_HOME/extensions/architecture-canvas/Final SVG Icons` (`COPILOT_HOME` defaults to `~/.copilot`), where the canvas also looks. `ARCH_CANVAS_ICON_ROOT` changes the folder, `DR_ICON_MIRROR` points the download at an internal mirror, and `DR_ICON_MAX_DOWNLOAD_MB` sets the largest archive that the download accepts (default 100). Without icons, the diagrams, the report and the runbook are still produced, but the presentations are not.

## Use

Start Copilot in a working folder, and say what you have:

> Use /azure-dr-assessment on ari-export.xlsx. Tier 1, primary region westeurope, DR region swedencentral.

| Input | Notes |
|---|---|
| The inventory | An ARI `.xlsx` export, or subscription IDs for a read-only live read. |
| The DR tier | 0 to 3, from the company tier table. Asked first and alone when missing. Never inferred. |
| The primary region | Checked against the inventory. |
| The DR region | It does not have to be the paired region. Pairing is never assumed. |
| The workload | Only when the inventory holds more than one: resource groups, a tag or a subscription. |

After the region analysis the skill may ask one more question, the DR options interview: for every service with no native DR into the DR region, its options with Estimated RPO and RTO, what each gives up, and a recommendation. Reply with a short name and a number, such as `KV 2`, or accept the recommendations. The answers are saved in `assessment.yaml` (`dr_choices`), so a rerun does not ask again. In an unattended run the skill records the recommendations as defaults and lists them as open decisions.

Free text, an `assessment.yaml`, or both work, and nothing you give is asked twice. The first run writes the answers to `dr-assessment/<app>/assessment.yaml`. To rerun: "Use /azure-dr-assessment with dr-assessment/<app>/assessment.yaml", for example `dr-assessment/checkout/assessment.yaml` when you named the workload Checkout. `assessment.yaml` is the only file you edit: every other file is generated, and a rerun overwrites it.

You need Node 22 or later and network access, for Microsoft Learn and for the first icon download. A live read also needs the Azure CLI (`az`) with the `resource-graph` extension, a signed-in account with Reader access on the subscriptions, and macOS, Linux or WSL: on native Windows, give an ARI export instead.

The skill starts by checking its environment with `node skills/azure-dr-assessment/scripts/preflight.mjs`. It says what is missing (Node, the icons, the network, a browser) and what that costs, and it never stops for it: it falls back to a simpler output.

## What you get

The skill announces the output folder and does not ask. The folder is named after the workload: the name you gave, else the resource group or tag value of the scope, else the inventory file name (for the resource group `rg-checkout`, `dr-assessment/rg-checkout/`). It never writes into its own directory. The one exception is the optional canvas copy of the diagrams, made only when you ask: it goes to `architectures/` of the working folder, outside the output folder.

```text
dr-assessment/checkout/     (for a workload named Checkout)
├── assessment.yaml
├── evidence/        inventory, evidence ledger, DR options, pattern resolution
├── architectures/   current-state and proposed-DR diagrams (.arch.json)
├── presentations/   the as-is and the DR walkthrough, one HTML file each
└── reports/         assessment.md, dr-establishment-guide.md and recovery-runbook.md (DRAFTs)
```

The DR establishment guide takes each service from today's setup, usually DR into the primary's Azure pair, to a validated DR in the DR region: one chapter per service in build order, with today's setup, the target and who chose it, the prerequisites, build, validate (measurable test criteria), cut-over and decommission steps, then a consolidated test plan. The runbook gets the failover and failback steps of each service. Commands are given only when you ask, in the form you choose (Azure CLI, Bicep, Terraform, Azure PowerShell or portal steps), and are labelled untested.

The report opens with the seven sections of the tier response structure, then the as-is architecture, the evidence and unknowns, the documentation sources, and the pattern register with any documented exceptions. Every time is Estimated until a drill shows otherwise, and nothing is called compliant without test evidence.

## Data handling

The output holds your inventory. Keep `dr-assessment/` out of Git: this repository's `.gitignore` does, and the skill writes `evidence/.gitignore` too. The canvas copy of the diagrams, made only when you ask, goes to `architectures/` of the working folder (or `$ARCH_CANVAS_DIAGRAM_DIR`), which is outside `dr-assessment/<app>/` and holds your architecture. A team that commits the working folder should add `architectures/` to its `.gitignore`, or point `ARCH_CANVAS_DIAGRAM_DIR` at a folder inside `dr-assessment/<app>/`. The skill is read-only towards Azure, never reads or saves secrets, and sends Microsoft Learn only generic service, SKU and region terms.

## Company patterns and overrides

The pack in [skills/azure-dr-assessment/patterns](skills/azure-dr-assessment/patterns) holds two example company patterns: `DR-TIER-001` (the company tiers, locked) and `DR-DNS-001` (the on-prem DNS is authoritative, approval-required). They outrank Microsoft Learn. A pattern declares how far a team may deviate: `overridable`, `approval-required` or `locked`. To deviate, add an entry under `overrides` in `assessment.yaml`. The report lists it as a documented exception. Locked patterns change only through a pull request here. A company replaces or extends the bundled examples with its own patterns in its own copy or fork of this repository.

To write a pattern, see [the authoring guide](skills/azure-dr-assessment/patterns/README.md). How the skill applies patterns is in [patterns.md](skills/azure-dr-assessment/references/patterns.md).

## This repository

The bundled patterns are examples of a company pattern pack; a company replaces or extends them in its own copy or fork. The repository holds no customer data and no secrets: CI fails when a workbook, an icon or assessment output is tracked, or when a file holds a secret-shaped string or a personal path.

```bash
npm test
npm run lint:patterns
```

Node 22 or later, and no packages to install. [tests/scenarios.md](tests/scenarios.md) holds the manual acceptance scenarios, and [RELEASING.md](RELEASING.md) the steps before a release.
