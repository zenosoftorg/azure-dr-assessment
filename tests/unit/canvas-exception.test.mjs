import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const skillDir = path.join(root, "skills", "azure-dr-assessment");
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");
const skill = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
const stage7 = readFileSync(path.join(skillDir, "references", "stages", "07-report.md"), "utf8");
const contract = readFileSync(path.join(skillDir, "references", "output-contract.md"), "utf8");
const readme = read("README.md");
const scenarios = read("tests", "scenarios.md");

const section = (text, heading) => {
    const start = text.indexOf(`${heading}\n`);
    assert.ok(start >= 0, `${heading} exists`);
    const rest = text.slice(start + heading.length);
    const next = rest.search(/^## /m);
    return next < 0 ? rest : rest.slice(0, next);
};

const CANVAS_HEADING = "## Open the diagrams in the canvas (only when the owner asks)";

function assertNamesTheException(text, label) {
    assert.match(text, /architectures\//, `${label}: names architectures/`);
    assert.match(text, /ARCH_CANVAS_DIAGRAM_DIR/, `${label}: names ARCH_CANVAS_DIAGRAM_DIR`);
    assert.match(text, /outside/i, `${label}: says outside`);
    assert.match(text, /gitignore/i, `${label}: says gitignore`);
}

test("SKILL.md names the canvas copies as the one exception to 'every output goes to dr-assessment/{app}/', and says they are opt-in", () => {
    const locations = section(skill, "## Locations");
    assert.match(locations, /Every output goes to `dr-assessment\/\{app\}\/`/);
    assertNamesTheException(locations, "SKILL.md Locations");
    assert.match(locations, /only when the owner asks/i);
    assert.match(locations, /\(stage 7\)/, "points to stage 7");
});

test("stage 7 makes the canvas opt-in, names the exception and the gitignore advice, and says how to know the canvas is available", () => {
    const canvas = section(stage7, CANVAS_HEADING);
    assertNamesTheException(canvas, "stage 7");
    assert.match(canvas, /Never run it by default/);
    assert.match(canvas, /not part of the standard run/);
    assert.match(canvas, /outside `dr-assessment\/checkout\/`/);
    assert.match(canvas, /point `ARCH_CANVAS_DIAGRAM_DIR` at a folder inside `dr-assessment\/checkout\/`/);
    assert.match(canvas, /`canvas-library` check/);
    assert.match(canvas, /that is enough to run the script/);
    assert.match(canvas, /proves the library, not the app extension/);
    assert.match(canvas, /if the owner does not see the diagrams in the canvas, say the diagrams still open from the files or in the presentation/i);
    assert.match(canvas, /the diagrams still open from the files or in the presentation/);
});

test("stage 7 runs canvas-link only inside the opt-in section, and neither the summary nor 'Done when' needs it", () => {
    const canvas = section(stage7, CANVAS_HEADING);
    assert.match(canvas, /canvas-link\.mjs --root dr-assessment\/checkout/);
    assert.equal(stage7.replace(canvas, "").includes("canvas-link"), false, "canvas-link appears nowhere else in stage 7");
    for (const heading of ["## Tell the owner", "## Before you finish", "## Done when"]) {
        assert.doesNotMatch(section(stage7, heading), /canvas/i, `${heading} does not depend on the canvas`);
    }
});

test("stage 7 documents the exit codes of canvas-link as the script has them", () => {
    const canvas = section(stage7, CANVAS_HEADING);
    const rows = Object.fromEntries([...canvas.matchAll(/^\| (\d) \| (.+) \|$/gm)].map((match) => [match[1], match[2]]));
    assert.deepEqual(Object.keys(rows).sort(), ["0", "1", "2", "3", "4", "5"]);
    assert.match(rows[1], /usage|bad flag/i);
    assert.match(rows[2], /no diagrams/i);
    assert.match(rows[3], /canvas library/i);
    assert.match(rows[4], /inside the skill or plugin directory/i);
    assert.match(rows[5], /unexpected failure.*report it/i);
});

test("SKILL.md does not describe stage 7 as always linking the canvas", () => {
    const stage = skill.split("\n").find((line) => line.startsWith("| 7 |"));
    assert.ok(stage, "the stage 7 row exists");
    assert.doesNotMatch(stage, /canvas/i);
    assert.doesNotMatch(skill, /canvas-link/);
});

test("the output contract and the README name the exception too", () => {
    const opening = contract.split("\n## Files")[0];
    assertNamesTheException(opening, "output-contract opening");
    assert.match(opening, /only when the owner asks/i);
    const diagramRow = contract.split("\n").find((line) => line.startsWith("| `architectures/{app}-current-state.arch.json`"));
    assert.match(diagramRow, /canvas/i);
    assert.match(diagramRow, /only when the owner asks/i);

    const dataHandling = section(readme, "## Data handling");
    assertNamesTheException(dataHandling, "README Data handling");
    assert.match(dataHandling, /add `architectures\/` to its `\.gitignore`/, "README Data handling carries the gitignore advice");
    const whatYouGet = section(readme, "## What you get");
    assert.match(whatYouGet, /one exception/);
    assert.match(whatYouGet, /only when you ask/);
    assert.match(whatYouGet, /`architectures\/` of the working folder, outside the output folder/);
    const canvasPart = readme.split("### The canvas (optional)")[1].split("### Icons")[0];
    assert.match(canvasPart, /`architectures\/` of your working folder/);
    assert.match(canvasPart, /outside `dr-assessment\/<app>\/`/);
    assert.match(canvasPart, /see Data handling/);
    assert.match(canvasPart, /only when you ask/i);
});

test("the scenarios say that by default nothing is written outside the output folder, and that canvas-link on request is the named exception", () => {
    const dr05 = scenarios.split("## DR-05:")[1].split("## DR-06:")[0];
    assert.match(dr05, /canvas-link is not run/);
    assert.doesNotMatch(dr05, /holds nothing else than the workbook\./);
    const dr14 = scenarios.split("## DR-14:")[1].split(/\n## /)[0];
    assert.match(dr14, /canvas-link is not run/);
    assert.match(dr14, /`architectures\/` of the working folder/);
});

test("the stage 7 table for check-presentation names every exit code 0 to 5", () => {
    const check = section(stage7, "## Check the presentations");
    const rows = Object.fromEntries([...check.matchAll(/^\| (\d) \| (.+) \|$/gm)].map((match) => [match[1], match[2]]));
    assert.deepEqual(Object.keys(rows).sort(), ["0", "1", "2", "3", "4", "5"]);
    assert.match(rows[1], /usage error in your command.*do not call the presentation verified/i);
    assert.match(rows[5], /unexpected failure.*do not call the presentation verified/i);
});
