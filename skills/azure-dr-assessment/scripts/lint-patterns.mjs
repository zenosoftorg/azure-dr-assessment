import { CliError, EXIT, log, runCli } from "./lib/cli.mjs";
import { formatFinding, lintPack } from "./lib/pattern-lint.mjs";
import { patternsDir } from "./lib/paths.mjs";
import { packBanner, packDisplayDir, readPack } from "./lib/patterns.mjs";

await runCli({
    name: "lint-patterns",
    description: "Lint the company pattern pack: front matter, sections, supersedes links and slot collisions.",
    spec: {
        "patterns-dir": { type: "string", help: "Pattern pack folder (default: the bundled pack; DR_PATTERNS_DIR is also honored)" },
    },
    async main(values) {
        const { dir, isDefault } = patternsDir(process.env, values["patterns-dir"] ?? null);
        let loaded;
        try {
            loaded = await readPack(dir, { isDefault });
        } catch (err) {
            // readPack fails before there is a summary to carry the pack fields (GC-10)
            if (err instanceof CliError) err.extra = { nonDefaultPack: !isDefault, banner: packBanner({ dir, isDefault }), ...err.extra };
            throw err;
        }
        const findings = lintPack(loaded);
        for (const finding of findings) log(`${finding.severity}: ${formatFinding(finding)}`);
        const summary = {
            packDir: packDisplayDir(dir),
            nonDefaultPack: !isDefault,
            banner: packBanner(loaded.pack),
            patterns: loaded.pack.patterns.length,
            findings,
        };
        const errors = findings.filter((f) => f.severity === "error");
        if (errors.length > 0) {
            throw new CliError(EXIT.INPUT, `${errors.length} pattern lint error${errors.length === 1 ? "" : "s"}`, errors.map(formatFinding), summary);
        }
        return summary;
    },
});
