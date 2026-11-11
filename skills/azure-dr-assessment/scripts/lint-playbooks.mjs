import { CliError, EXIT, log, runCli } from "./lib/cli.mjs";
import { playbooksDir } from "./lib/paths.mjs";
import { formatPlaybookFinding, lintPlaybooks } from "./lib/playbook-lint.mjs";
import { isIsoDate, readPlaybooks } from "./lib/playbooks.mjs";
import { packDisplayDir } from "./lib/patterns.mjs";

await runCli({
    name: "lint-playbooks",
    description: "Lint the service playbooks: front matter, sections, options, steps, test criteria and Learn sources.",
    spec: {
        "playbooks-dir": { type: "string", help: "Playbook folder (default: the bundled playbooks; DR_PLAYBOOKS_DIR is also honored)" },
        today: { type: "string", help: "The date the 90-day age of verified_on is measured from, as YYYY-MM-DD (default: today in UTC)" },
    },
    async main(values) {
        const today = values.today ?? new Date().toISOString().slice(0, 10);
        if (!isIsoDate(today)) throw new CliError(EXIT.USAGE, "--today must be a date as YYYY-MM-DD");
        const { dir, isDefault } = playbooksDir(process.env, values["playbooks-dir"] ?? null);
        const fields = { playbooksDir: packDisplayDir(dir), nonDefaultPlaybooks: !isDefault };
        let loaded;
        try {
            loaded = await readPlaybooks(dir, { isDefault });
        } catch (err) {
            // readPlaybooks fails before there is a summary: the folder fields still go into the envelope
            if (err instanceof CliError) err.extra = { ...fields, ...err.extra };
            throw err;
        }
        const findings = lintPlaybooks(loaded, { today });
        for (const finding of findings) log(`${finding.severity}: ${formatPlaybookFinding(finding)}`);
        const summary = { ...fields, playbooks: loaded.set.playbooks.length, findings };
        const errors = findings.filter((f) => f.severity === "error");
        if (errors.length > 0) {
            throw new CliError(EXIT.INPUT, `${errors.length} playbook lint error${errors.length === 1 ? "" : "s"}`, errors.map(formatPlaybookFinding), summary);
        }
        return summary;
    },
});
