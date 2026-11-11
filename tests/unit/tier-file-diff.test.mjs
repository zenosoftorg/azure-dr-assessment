import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultPatternsDir } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { readPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const script = path.resolve(import.meta.dirname, "..", "manual", "tier-file-diff.mjs");
const tier = (await readPack(defaultPatternsDir())).pack.byId.get("DR-TIER-001");

/** A tier file as the pattern's source: the pinned sections with their headings one level up, under a title and the two tier file headings. */
function tierFile(t, edit = (text) => text) {
    const up = (text) => text.replace(/^(#{3,4}) /gm, (_, hashes) => `${hashes.slice(1)} `);
    const body = [
        "# Azure DR Architecture — Landing Zone Workload Tiers",
        up(tier.sections["Required behavior"]),
        "## Mandatory first step",
        tier.sections["Mandatory first step"],
        "## Required response structure",
        tier.sections["Required response structure"],
    ].join("\n\n");
    const dir = mkdtempSync(path.join(tmpdir(), "dr-tier-file-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "azure-dr.instructions.md");
    writeFileSync(file, edit(body));
    return file;
}

test("a tier file with the same wording passes, whatever its heading levels, and lists its title and fixed headings as tier file only", async (t) => {
    const r = await runScript(script, [tierFile(t)]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^pattern only \(0\): /m);
    assert.match(r.stdout, /^tier file only \(3\): /m);
    for (const line of ["+ Azure DR Architecture — Landing Zone Workload Tiers", "+ Mandatory first step", "+ Required response structure"]) assert.ok(r.stdout.includes(line), line);
});

test("a changed tier file line fails, and both versions of the line are printed", async (t) => {
    const original = "For 'near zero,' request explicit measurable business thresholds before claiming any target is achievable. Near zero is not automatically zero data loss or zero interruption.";
    assert.ok(tier.sections["Required behavior"].split("\n").includes(original), "the line is in the pattern");
    const changed = "Near zero means zero data loss and zero interruption.";
    const r = await runScript(script, [tierFile(t, (text) => text.replace(original, changed))]);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^pattern only \(1\): /m);
    assert.ok(r.stdout.includes(`- ${original}`));
    assert.ok(r.stdout.includes(`+ ${changed}`));
});

test("a missing argument, an extra argument and an unreadable file exit 2 with a message", async (t) => {
    const cases = [
        [[], /^usage: node tests\/manual\/tier-file-diff\.mjs/],
        [[tierFile(t), "extra"], /^usage: node tests\/manual\/tier-file-diff\.mjs/],
        [[path.join(tmpdir(), "dr-tier-file-no-such-file.md")], /^cannot read /],
    ];
    for (const [args, message] of cases) {
        const r = await runScript(script, args);
        assert.equal(r.code, 2, `${JSON.stringify(args)}: ${r.stdout}${r.stderr}`);
        assert.match(r.stderr, message);
    }
});
