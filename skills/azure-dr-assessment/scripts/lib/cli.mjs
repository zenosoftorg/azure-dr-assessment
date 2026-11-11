import { parseArgs } from "node:util";

export const EXIT = Object.freeze({ OK: 0, USAGE: 1, INPUT: 2, ENVIRONMENT: 3, REFUSED: 4, UNEXPECTED: 5 });

/** An expected failure: carries the exit code, a detail list and extra envelope fields. */
export class CliError extends Error {
    constructor(code, message, details = [], extra = {}) {
        super(message);
        this.name = "CliError";
        this.code = code;
        this.details = details;
        this.extra = extra;
    }
}

export function log(message) {
    process.stderr.write(`${message}\n`);
}

export function usageText(name, description, spec) {
    const rows = Object.entries(spec).map(([flag, def]) => {
        const left = `--${flag}${def.type === "string" ? " <value>" : ""}${def.short ? `, -${def.short}` : ""}`;
        const tags = [def.required ? "required" : null, def.multiple ? "repeatable" : null].filter(Boolean).join(", ");
        return `  ${left.padEnd(34)} ${def.help}${tags ? ` (${tags})` : ""}`;
    });
    return [
        `${name}: ${description}`,
        "",
        `Usage: node ${name}.mjs [flags]`,
        "",
        ...rows,
        `  ${"--help".padEnd(34)} Show this text`,
    ].join("\n");
}

/** Parse flags against a spec. Throws CliError(USAGE) on unknown or missing flags. */
export function parseFlags(argv, spec) {
    const options = { help: { type: "boolean" } };
    for (const [flag, def] of Object.entries(spec)) {
        options[flag] = { type: def.type, multiple: Boolean(def.multiple), ...(def.short ? { short: def.short } : {}) };
    }
    let parsed;
    try {
        parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
    } catch (err) {
        throw new CliError(EXIT.USAGE, err.message);
    }
    if (parsed.values.help) return { values: {}, positionals: [], help: true };
    const missing = Object.entries(spec)
        .filter(([flag, def]) => def.required && parsed.values[flag] === undefined)
        .map(([flag]) => `--${flag}`);
    if (missing.length > 0) {
        throw new CliError(EXIT.USAGE, `missing required flag${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    }
    return { values: parsed.values, positionals: parsed.positionals, help: false };
}

/** The envelope fields win over a script's own fields of the same name, and they keep their place at the front. */
const withEnvelope = (envelope, fields) => ({ ...envelope, ...fields, ...envelope });

/**
 * Run a script's main function and print the JSON envelope. `main` returns the
 * script-specific fields; a failure throws CliError. The exit code is set on
 * process.exitCode so stdout always flushes.
 */
export async function runCli({ name, description, spec, main, argv = process.argv.slice(2) }) {
    let envelope;
    try {
        const { values, positionals, help } = parseFlags(argv, spec);
        if (help) {
            process.stdout.write(`${usageText(name, description, spec)}\n`);
            return { ok: true, script: name, help: true };
        }
        const summary = await main(values, positionals);
        envelope = withEnvelope({ ok: true, script: name }, summary);
        process.exitCode = EXIT.OK;
    } catch (err) {
        if (err instanceof CliError) {
            envelope = withEnvelope({ ok: false, script: name, code: err.code, error: err.message, details: err.details }, err.extra);
            process.exitCode = err.code;
            if (err.code === EXIT.USAGE) process.stderr.write(`${usageText(name, description, spec)}\n`);
        } else {
            envelope = { ok: false, script: name, code: EXIT.UNEXPECTED, error: err?.message ?? String(err), details: [] };
            process.exitCode = EXIT.UNEXPECTED;
            process.stderr.write(`${err?.stack ?? err}\n`);
        }
    }
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return envelope;
}
