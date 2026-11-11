import assert from "node:assert/strict";
import test from "node:test";
import { loadLearnMap } from "../../skills/azure-dr-assessment/scripts/lib/learn-map.mjs";

const skip = process.env.DR_ONLINE_TESTS === "1" ? false : "set DR_ONLINE_TESTS=1 to read the live Learn reference page";

test("the curated catalogue still matches the Learn multiregion reference page", { skip, timeout: 60_000 }, async () => {
    const map = loadLearnMap();
    const response = await fetch(map.reference);
    assert.equal(response.status, 200, `${map.reference} answered ${response.status}`);
    const html = await response.text();
    const tableEnd = html.lastIndexOf("</table>");
    assert.ok(tableEnd > 0, "the page has no table");

    const drift = [];
    for (const [armType, entries] of Object.entries(map.types)) {
        for (const entry of entries) {
            const where = `${armType} / ${entry.service}`;
            const first = html.indexOf(entry.service);
            const last = html.lastIndexOf(entry.service);
            if (entry.tab === "not-listed") {
                if (first >= 0) drift.push(`${where}: is now listed on the page`);
                continue;
            }
            if (first < 0) drift.push(`${where}: not found on the page`);
            else if (entry.tab === "built-in" && first > tableEnd) drift.push(`${where}: moved off the built-in tab`);
            else if (entry.tab === "none" && last < tableEnd) drift.push(`${where}: moved off the no-built-in tab`);
            if (entry.article && !entry.article.startsWith("/") && !html.includes(`href="${entry.article.split("?")[0]}`)) {
                drift.push(`${where}: article ${entry.article} is not linked`);
            }
        }
    }
    assert.deepEqual(drift, [], `update assets/learn-service-map.json and verifiedOn:\n${drift.join("\n")}`);
});
