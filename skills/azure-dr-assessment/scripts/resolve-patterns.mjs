import { existsSync, statSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readAssessment } from "./lib/assessment.mjs";
import { writeFileAtomic } from "./lib/atomic.mjs";
import { CliError, EXIT, log, runCli } from "./lib/cli.mjs";
import { formatFinding, lintPack } from "./lib/pattern-lint.mjs";
import { isInsideSkillOrPlugin, patternsDir } from "./lib/paths.mjs";
import { packBanner, readPack } from "./lib/patterns.mjs";
import { evaluateGates, resolveSlots, validateResolution } from "./lib/resolve.mjs";

/** True when both paths name one file, however they are spelled: the same resolved path, or the same device and inode (a symlinked folder, a hard link). */
function sameFile(a, b) {
    if (a === b) return true;
    try {
        const first = statSync(a, { bigint: true });
        const second = statSync(b, { bigint: true });
        return first.ino !== 0n && first.ino === second.ino && first.dev === second.dev;
    } catch {
        return false;
    }
}

async function readJson(file) {
    let text;
    try {
        text = await readFile(file, "utf8");
    } catch (err) {
        throw new CliError(EXIT.INPUT, `cannot read ${file}`, [err.message]);
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new CliError(EXIT.INPUT, `${file} is not valid JSON`, [err.message]);
    }
}

/** Check a completed pattern-resolution.json. A ledger.json next to it, when there is one, supplies the ledger ids. */
async function validateFile(values) {
    if (values.assessment !== undefined || values["patterns-dir"] !== undefined || values.out !== undefined || values["gates-only"] === true) {
        throw new CliError(EXIT.USAGE, "--validate cannot be combined with --assessment, --patterns-dir, --out or --gates-only");
    }
    const file = path.resolve(values.validate);
    const resolution = await readJson(file);
    const ledgerFile = path.join(path.dirname(file), "ledger.json");
    let ledgerIds;
    if (existsSync(ledgerFile)) {
        const ledger = await readJson(ledgerFile);
        ledgerIds = new Set((Array.isArray(ledger?.entries) ? ledger.entries : []).map((e) => e?.id).filter((id) => typeof id === "string"));
    }
    const result = validateResolution(resolution, { ledgerIds });
    if (!result.ok) {
        throw new CliError(EXIT.INPUT, `${file} is not a valid pattern resolution`, result.errors.map((e) => `${e.path}: ${e.message}`));
    }
    return { valid: true, file, slots: resolution.slots.length, ledgerChecked: ledgerIds !== undefined };
}

/** GC-10: a failure carries the pack fields a success has (nonDefaultPack, banner), unless it already has them. */
function withPackFields(err, dir, isDefault) {
    const fields = { nonDefaultPack: !isDefault, banner: packBanner({ dir, isDefault }) };
    for (const [key, value] of Object.entries(fields)) {
        if (!(key in err.extra)) err.extra[key] = value;
    }
    return err;
}

/** Generate mode and --gates-only: one assessment against the pack in `dir`. */
async function generate(values, dir, isDefault) {
    if (!values.assessment) throw new CliError(EXIT.USAGE, "missing required flag: --assessment (or --validate)");
    const assessmentFile = path.resolve(values.assessment);
    const assessment = await readAssessment(assessmentFile);
    const loaded = await readPack(dir, { isDefault });
    // A slot collision is a legitimate input that resolution reports; every other lint error makes the pack unusable.
    const blocking = lintPack(loaded).filter((f) => f.severity === "error" && f.rule !== "slot-collision");
    if (blocking.length > 0) {
        throw new CliError(EXIT.INPUT, `the pattern pack has ${blocking.length} error${blocking.length === 1 ? "" : "s"}; run lint-patterns`, blocking.map(formatFinding));
    }
    if (values["gates-only"]) {
        const gates = evaluateGates(assessment, loaded.pack);
        return { out: null, nonDefaultPack: !isDefault, banner: packBanner(loaded.pack), gates, gatesOpen: gates.filter((g) => g.status === "open").length };
    }
    const resolution = resolveSlots(assessment, loaded.pack);
    resolution.assessment = path.basename(assessmentFile);
    const out = path.resolve(values.out || path.join(path.dirname(assessmentFile), "evidence", "pattern-resolution.json"));
    if (sameFile(out, assessmentFile)) {
        throw new CliError(EXIT.USAGE, "--out would overwrite an input", [`${out} is the assessment file; choose another output path`]);
    }
    if (isInsideSkillOrPlugin(path.dirname(out))) {
        throw new CliError(EXIT.REFUSED, "the output folder is inside the skill or plugin directory", [`${out} is inside the azure-dr-assessment skill or plugin`]);
    }
    await mkdir(path.dirname(out), { recursive: true });
    await writeFileAtomic(out, `${JSON.stringify(resolution, null, 2)}\n`);
    log(`wrote ${out}`);
    return {
        out,
        nonDefaultPack: resolution.nonDefaultPack,
        banner: resolution.banner,
        gates: resolution.gates,
        gatesOpen: resolution.gates.filter((g) => g.status === "open").length,
        slots: {
            total: resolution.slots.length,
            candidate: resolution.slots.filter((s) => s.status === "candidate").length,
            unresolved: resolution.slots.filter((s) => s.status === "unresolved").length,
        },
        collisions: resolution.slots.filter((s) => s.collision).map((s) => ({ slot: s.slot, patterns: s.collision })),
        openInputs: resolution.openInputs,
        rejectedOverrides: resolution.overrides.filter((o) => o.outcome === "rejected").map(({ index, pattern, reason }) => ({ index, pattern, reason })),
    };
}

await runCli({
    name: "resolve-patterns",
    description: "Propose a candidate per decision slot from the pattern pack, the overrides and the intake gates; write evidence/pattern-resolution.json.",
    spec: {
        assessment: { type: "string", help: "Path to assessment.yaml" },
        "patterns-dir": { type: "string", help: "Pattern pack folder (default: the bundled pack; DR_PATTERNS_DIR is also honored)" },
        out: { type: "string", help: "Where to write pattern-resolution.json (default: evidence/pattern-resolution.json next to the assessment)" },
        validate: { type: "string", help: "Validate a completed pattern-resolution.json instead of generating one" },
        "gates-only": { type: "boolean", help: "Evaluate the two intake gates and write nothing" },
    },
    async main(values) {
        if (values.validate !== undefined) return validateFile(values);
        const { dir, isDefault } = patternsDir(process.env, values["patterns-dir"] ?? null);
        try {
            return await generate(values, dir, isDefault);
        } catch (err) {
            throw err instanceof CliError ? withPackFields(err, dir, isDefault) : err;
        }
    },
});
