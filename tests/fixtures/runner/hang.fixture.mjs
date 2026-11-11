import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import test from "node:test";

// Used by tests/unit/run-all.test.mjs. It is not a *.test.mjs file, so the normal run does not pick it up.
// A test file that never ends: its test waits for a child that never exits, and the child's pipes keep the file alive.
// DR_HANG_MARKER names the file in which it records its own process id and the child's.
test("waits for a child that never exits", async () => {
    const marker = process.env.DR_HANG_MARKER;
    if (!marker) throw new Error("DR_HANG_MARKER is not set");
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "pipe"] });
    writeFileSync(marker, `${process.pid} ${child.pid}`);
    await new Promise((resolve) => child.on("close", resolve));
});
