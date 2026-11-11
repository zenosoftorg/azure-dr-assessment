import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Used by tests/unit/run-all.test.mjs. It is not a *.test.mjs file, so the normal run does not pick it up.
test("makes a temporary folder and never removes it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "leak-"));
    writeFileSync(process.env.DR_LEAK_MARKER, dir);
    if (process.env.DR_LEAK_FAIL === "1") throw new Error("failing on purpose");
});
