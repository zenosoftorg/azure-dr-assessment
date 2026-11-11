import assert from "node:assert/strict";
import test from "node:test";
import { formatFinding, lintPack } from "../../skills/azure-dr-assessment/scripts/lib/pattern-lint.mjs";
import { readPack } from "../../skills/azure-dr-assessment/scripts/lib/patterns.mjs";
import { FIXED_BODIES, patternMarkdown, writePack, writePatterns } from "../helpers/pack-fixture.mjs";

async function lintDir(dir) {
    return lintPack(await readPack(dir));
}
const labels = (findings) => findings.map((f) => `${f.severity}:${f.rule}`).sort();
const sections = (...extra) => [...FIXED_BODIES, ...extra];
const without = (title) => FIXED_BODIES.filter(([t]) => t !== title);
const input = (fields = {}) => ({ name: "ttl", description: "TTL in seconds", required: true, ...fields });

const cases = [
    ["a valid pattern has no findings", {}, []],
    ["a valid pattern with every optional field", {
        applies_to: { workloads: ["checkout"], environments: ["production"], tiers: [0, 1], scenarios: ["regional"] },
        inputs: [input()],
        parameters: { limit: 5 },
        sections: sections(["Mandatory first step", "Ask first.\n\n> Which tier?"], ["Required response structure", "1. One"], ["Boundaries", "Nothing else."]),
    }, []],
    ["a missing id", { omit: ["id"], file: "DR-LINT-001.md" }, ["error:front-matter-missing-field"]],
    ["an id that is not DR-<AREA>-<NNN>", { id: "dr-lint-001", file: "DR-LINT-001.md" }, ["error:id-invalid"]],
    ["an id that differs from the file name", { id: "DR-LINT-002", file: "DR-LINT-001.md" }, ["error:id-filename-mismatch"]],
    ["version 0", { version: 0 }, ["error:version-invalid"]],
    ["a text version", { version: "x" }, ["error:version-invalid"]],
    ["a decimal version", { version: 1.5 }, ["error:version-invalid"]],
    ["a missing version", { omit: ["version"] }, ["error:front-matter-missing-field"]],
    ["an unknown status", { status: "final" }, ["error:status-invalid"]],
    ["an empty slot list", { slots: [] }, ["error:slots-invalid"]],
    ["slots written as a string", { slots: "compute" }, ["error:slots-invalid"]],
    ["a slot outside the vocabulary", { slots: ["compute", "teleport"] }, ["error:slot-unknown"]],
    ["missing slots", { omit: ["slots"] }, ["error:front-matter-missing-field"]],
    ["an unknown override level", { override: "open" }, ["error:override-invalid"]],
    ["an empty owner role", { owner_role: "" }, ["error:owner-role-invalid"]],
    ["a missing owner role", { omit: ["owner_role"] }, ["error:front-matter-missing-field"]],
    ["tiers outside 0 to 3", { applies_to: { tiers: [4] } }, ["error:applies-to-invalid"]],
    ["an empty applies_to list", { applies_to: { tiers: [] } }, ["error:applies-to-invalid"]],
    ["an unknown scenario", { applies_to: { scenarios: ["galactic"] } }, ["error:applies-to-invalid"]],
    ["an unknown applies_to key", { applies_to: { regions: ["westeurope"] } }, ["error:applies-to-invalid"]],
    ["applies_to that is not a mapping", { applies_to: "nope" }, ["error:applies-to-invalid"]],
    ["an empty workload name", { applies_to: { workloads: [""] } }, ["error:applies-to-invalid"]],
    ["supersedes written as a string", { supersedes: "DR-OTHER-001" }, ["error:supersedes-invalid"]],
    ["supersedes holding a non-id", { supersedes: ["not an id"] }, ["error:supersedes-invalid"]],
    ["a missing supersedes list", { omit: ["supersedes"] }, ["error:front-matter-missing-field"]],
    ["inputs that are not a list", { inputs: "ttl" }, ["error:inputs-invalid"]],
    ["an input item that is not a mapping", { inputs: [3] }, ["error:inputs-invalid"]],
    ["an input without a description", { inputs: [{ name: "ttl", required: true }] }, ["error:inputs-invalid"]],
    ["an input name that is not snake case", { inputs: [input({ name: "TTL" })] }, ["error:inputs-invalid"]],
    ["an input whose required flag is not a boolean", { inputs: [input({ required: "yes" })] }, ["error:inputs-invalid"]],
    ["two inputs with the same name", { inputs: [input(), input({ description: "again", required: false })] }, ["error:inputs-invalid"]],
    ["an input with an unknown key", { inputs: [input({ example: 1 })] }, ["error:inputs-invalid"]],
    ["parameters that are not a mapping", { parameters: "x" }, ["error:parameters-invalid"]],
    ["an unknown front matter key", { extra: { aplies_to: { tiers: [1] } } }, ["error:front-matter-unknown-key"]],
    ["a missing fixed section", { sections: without("Verification") }, ["error:section-missing"]],
    ["no sections at all", { sections: [] }, Array(5).fill("error:section-missing")],
    ["misordered fixed sections", { sections: [FIXED_BODIES[1], FIXED_BODIES[0], ...FIXED_BODIES.slice(2)] }, ["error:section-order"]],
    ["a duplicated section", { sections: sections(FIXED_BODIES[1]) }, ["error:section-duplicate"]],
    ["an unknown section", { sections: sections(["Notes", "free text"]) }, ["warning:section-unknown"]],
    ["an empty section", { sections: [["Required behavior", ""], ...FIXED_BODIES.slice(1)] }, ["error:section-empty"]],
    ["optional sections out of order", { sections: sections(["Boundaries", "x"], ["Mandatory first step", "> Which tier?"]) }, ["error:section-order"]],
    ["an optional section before the fixed ones", { sections: [["Boundaries", "x"], ...FIXED_BODIES] }, ["error:section-order"]],
    ["a first step without a quoted question", { sections: sections(["Mandatory first step", "Ask something."]) }, ["error:gate-missing-question"]],
];

for (const [name, fields, expected] of cases) {
    test(`lint: ${name}`, async () => {
        const dir = writePatterns([{ id: "DR-LINT-001", ...fields }]);
        assert.deepEqual(labels(await lintDir(dir)), [...expected].sort());
    });
}

test("findings carry the file, the id and a message", async () => {
    const dir = writePatterns([{ id: "DR-LINT-001", slots: ["teleport"] }]);
    const [finding] = await lintDir(dir);
    assert.deepEqual(finding, {
        severity: "error",
        rule: "slot-unknown",
        file: "DR-LINT-001.md",
        id: "DR-LINT-001",
        message: 'slot "teleport" is not in the slot vocabulary (see patterns/README.md)',
    });
    assert.equal(formatFinding(finding), 'DR-LINT-001.md: [slot-unknown] slot "teleport" is not in the slot vocabulary (see patterns/README.md)');
});

test("files that cannot be loaded are reported first, then the rest is linted", async () => {
    const dir = writePack({
        "DR-A-001.md": patternMarkdown({ id: "DR-A-001", status: "final" }),
        "DR-B-001.md": "# no front matter\n",
    });
    assert.deepEqual((await lintDir(dir)).map((f) => `${f.file}:${f.rule}`), ["DR-B-001.md:front-matter-missing", "DR-A-001.md:status-invalid"]);
});

test("a duplicate id is reported on the later file", async () => {
    const dir = writePack({
        "DR-DUP-001.md": patternMarkdown({ id: "DR-DUP-001" }),
        "DR-DUP-002.md": patternMarkdown({ id: "DR-DUP-001", slots: ["identity"] }),
    });
    const findings = await lintDir(dir);
    assert.deepEqual(labels(findings), ["error:id-duplicate", "error:id-filename-mismatch"]);
    assert.ok(findings.every((f) => f.file === "DR-DUP-002.md"));
    assert.match(findings.find((f) => f.rule === "id-duplicate").message, /already used by DR-DUP-001\.md/);
});

test("supersedes must name a pattern in the pack", async () => {
    const dir = writePatterns([{ id: "DR-A-001", supersedes: ["DR-GHOST-001"] }]);
    const findings = await lintDir(dir);
    assert.deepEqual(labels(findings), ["error:supersedes-unknown"]);
    assert.match(findings[0].message, /DR-GHOST-001/);
});

test("supersedes cycles are errors, one finding per pattern in the cycle", async () => {
    const two = await lintDir(writePatterns([
        { id: "DR-A-001", supersedes: ["DR-B-001"] },
        { id: "DR-B-001", supersedes: ["DR-A-001"] },
    ]));
    assert.deepEqual(two.map((f) => `${f.id}:${f.rule}`), ["DR-A-001:supersedes-cycle", "DR-B-001:supersedes-cycle"]);
    assert.match(two[0].message, /DR-A-001, DR-B-001/);

    const three = await lintDir(writePatterns([
        { id: "DR-A-001", supersedes: ["DR-B-001"] },
        { id: "DR-B-001", supersedes: ["DR-C-001"] },
        { id: "DR-C-001", supersedes: ["DR-A-001"] },
    ]));
    assert.deepEqual(labels(three), Array(3).fill("error:supersedes-cycle"));

    const self = await lintDir(writePatterns([{ id: "DR-A-001", supersedes: ["DR-A-001"] }]));
    assert.deepEqual(labels(self), ["error:supersedes-cycle"]);
    assert.match(self[0].message, /supersedes itself/);
});

const pair = (first, second) => [{ id: "DR-A-001", ...first }, { id: "DR-B-001", ...second }];
const collisions = [
    ["two approved patterns that share a slot", pair({}, {}), ["error:slot-collision"]],
    ["a direct supersedes link", pair({ supersedes: ["DR-B-001"] }, {}), []],
    ["a direct supersedes link in the other direction", pair({}, { supersedes: ["DR-A-001"] }), []],
    ["a transitive supersedes link", [
        { id: "DR-A-001", slots: ["compute"] },
        { id: "DR-B-001", slots: ["identity"], supersedes: ["DR-A-001"] },
        { id: "DR-C-001", slots: ["compute"], supersedes: ["DR-B-001"] },
    ], []],
    ["a draft pattern", pair({}, { status: "draft" }), []],
    ["a superseded pattern", pair({}, { status: "superseded" }), []],
    ["different slots", pair({}, { slots: ["identity"] }), []],
    ["one shared slot among several", pair({ slots: ["compute", "backup"] }, { slots: ["backup", "identity"] }), ["error:slot-collision"]],
    ["disjoint tiers", pair({ applies_to: { tiers: [0] } }, { applies_to: { tiers: [1] } }), []],
    ["overlapping tiers", pair({ applies_to: { tiers: [1, 2] } }, { applies_to: { tiers: [2, 3] } }), ["error:slot-collision"]],
    ["one disjoint key among overlapping ones", pair(
        { applies_to: { tiers: [0], environments: ["production"] } },
        { applies_to: { tiers: [0], environments: ["dev"] } },
    ), []],
    ["keys that only one pattern restricts", pair({ applies_to: { environments: ["dev"] } }, { applies_to: { tiers: [1] } }), ["error:slot-collision"]],
    ["workload names that differ only by case", pair({ applies_to: { workloads: ["Checkout"] } }, { applies_to: { workloads: ["checkout"] } }), ["error:slot-collision"]],
];

for (const [name, specs, expected] of collisions) {
    test(`collision rule: ${name}`, async () => {
        assert.deepEqual(labels(await lintDir(writePatterns(specs))), [...expected].sort());
    });
}

test("a collision finding names both patterns and the shared slots", async () => {
    const [finding] = await lintDir(writePatterns(pair({ slots: ["compute", "backup"] }, { slots: ["backup", "compute"] })));
    assert.equal(finding.rule, "slot-collision");
    assert.equal(finding.id, "DR-A-001");
    assert.match(finding.message, /DR-A-001 and DR-B-001 both decide compute, backup/);
});
