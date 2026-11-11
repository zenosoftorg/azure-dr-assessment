import assert from "node:assert/strict";
import test from "node:test";
import { defaultPlaybooksDir } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { readPlaybooks } from "../../skills/azure-dr-assessment/scripts/lib/playbooks.mjs";

const skip = process.env.DR_ONLINE_TESTS === "1" ? false : "set DR_ONLINE_TESTS=1 to read the Learn pages that the playbooks cite";

test("every learn_sources URL of every bundled playbook still answers 200", { skip, timeout: 600_000 }, async () => {
    const { set } = await readPlaybooks(defaultPlaybooksDir());
    const urls = [...new Set(set.playbooks.flatMap((p) => p.learnSources))].sort();
    assert.ok(urls.length > 0, "the bundled playbooks cite no page");
    const drift = [];
    for (const url of urls) {
        try {
            const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
            if (response.status !== 200) drift.push(`${url}: answered ${response.status}`);
        } catch (err) {
            drift.push(`${url}: ${err.message}`);
        }
    }
    assert.deepEqual(drift, [], `re-verify the playbooks that cite these pages (playbooks/README.md):\n${drift.join("\n")}`);
});
