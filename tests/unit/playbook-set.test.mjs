import assert from "node:assert/strict";
import test from "node:test";
import { loadLearnMap } from "../../skills/azure-dr-assessment/scripts/lib/learn-map.mjs";
import { playbooksDir } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { lintPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbook-lint.mjs";
import { readPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";
import { FIRST_SET, asFirstSetRow } from "../helpers/playbook-set.mjs";

// The bundled folder; DR_PLAYBOOKS_DIR points the test at another folder (the test hook of contracts 5.6).
const { dir } = playbooksDir(process.env);
const TODAY = "2026-11-09";

test("the playbook folder holds exactly the 22 playbooks of the first set, each as contracts section 7 fixes it", async () => {
    const loaded = await readPlaybooks(dir);
    assert.deepEqual(lintPlaybooks(loaded, { today: TODAY }).filter((f) => f.severity === "error"), []);
    const byService = (a, b) => (a.service < b.service ? -1 : a.service > b.service ? 1 : 0);
    assert.deepEqual(loaded.set.playbooks.map(asFirstSetRow).sort(byService), [...FIRST_SET].sort(byService));
});

test("every ARM type of the first set has exactly one playbook", async () => {
    const { set } = await readPlaybooks(dir);
    const types = FIRST_SET.flatMap((row) => row.armTypes).sort();
    assert.deepEqual([...set.byType.keys()].sort(), types);
    for (const row of FIRST_SET) for (const type of row.armTypes) assert.equal(set.byType.get(type)?.service, row.service, type);
});

test("a playbook whose ARM types the catalogue lists only without built-in multiregion support claims no paired or nonpaired mechanism", async () => {
    const { set } = await readPlaybooks(dir);
    const map = loadLearnMap();
    const problems = [];
    for (const playbook of set.playbooks) {
        const catalogued = playbook.armTypes.filter((type) => (map.types[type] ?? []).length > 0);
        const none = catalogued.length > 0 && catalogued.every((type) => map.types[type].every((entry) => entry.tab === "none"));
        if (!none) continue;
        for (const m of playbook.mechanisms) {
            if (m.paired === true || m.nonpaired === true) {
                problems.push(`${playbook.file}: mechanism "${m.name}" claims Paired: ${m.paired ? "yes" : "no"}, Nonpaired: ${m.nonpaired ? "yes" : "no"}, but the catalogue lists ${catalogued.join(", ")} without built-in multiregion support`);
            }
        }
    }
    assert.deepEqual(problems, []);
});
