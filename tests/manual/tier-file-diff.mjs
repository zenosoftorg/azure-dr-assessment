// Compare the tier file wording that DR-TIER-001 pins by digest with the current company tier file (RELEASING.md, check 10):
//   node tests/manual/tier-file-diff.mjs <path to the current azure-dr.instructions.md>
// Exit 0: every line of the pinned sections is in the tier file. Exit 1: some are not. Exit 2: usage, or a file that cannot be read.
import { readFileSync } from "node:fs";
import { defaultPatternsDir } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { readPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";

// The sections that tests/unit/pattern-dr-tier-001.test.mjs pins by digest.
const PINNED = ["Required behavior", "Mandatory first step", "Required response structure"];

/** The lines of a markdown text without heading marks and blank lines, with one space between words: heading levels and table padding do not count. */
const lines = (text) => text.split(/\r?\n/).map((line) => line.replace(/^\s*#+\s+/, "").replace(/\s+/g, " ").trim()).filter(Boolean);

async function main(args) {
    if (args.length !== 1) {
        console.error("usage: node tests/manual/tier-file-diff.mjs <path to the current azure-dr.instructions.md>");
        return 2;
    }
    let tierText;
    try {
        tierText = readFileSync(args[0], "utf8");
    } catch (err) {
        console.error(`cannot read ${args[0]}: ${err.message}`);
        return 2;
    }
    const tier = (await readPack(defaultPatternsDir())).pack.byId.get("DR-TIER-001");
    const pinned = lines(PINNED.map((title) => tier.sections[title]).join("\n"));
    const tierLines = lines(tierText);
    const inTierFile = new Set(tierLines);
    const inPinned = new Set(pinned);
    const patternOnly = [...new Set(pinned.filter((line) => !inTierFile.has(line)))];
    const tierFileOnly = [...new Set(tierLines.filter((line) => !inPinned.has(line)))];

    console.log(`pattern only (${patternOnly.length}): lines of the pinned sections that the tier file does not have`);
    for (const line of patternOnly) console.log(`- ${line}`);
    console.log(`tier file only (${tierFileOnly.length}): the tier file title, its front matter and the headings of its fixed sections are expected; any other line is new tier file wording`);
    for (const line of tierFileOnly) console.log(`+ ${line}`);
    return patternOnly.length === 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
