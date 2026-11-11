import { renameSync, writeFileSync } from "node:fs";
import { launchBrowser } from "../../../skills/azure-dr-assessment/scripts/lib/cdp.mjs";
import { findBrowser } from "../../../skills/azure-dr-assessment/scripts/lib/paths.mjs";

// Starts the browser the way check-presentation does. With "close" it shuts the browser down and ends; otherwise it keeps running until it is killed.
// When DR_FIXTURE_MARKER names a file, it writes it once launchBrowser has resolved, so that a test can wait for the browser instead of racing it.
const browser = await launchBrowser(findBrowser());
console.log("ready");
if (process.env.DR_FIXTURE_MARKER) {
    writeFileSync(`${process.env.DR_FIXTURE_MARKER}.part`, JSON.stringify({ at: Date.now(), pid: process.pid }));
    renameSync(`${process.env.DR_FIXTURE_MARKER}.part`, process.env.DR_FIXTURE_MARKER);
}
if (process.argv[2] === "close") {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await browser.close();
    console.log("closed");
} else {
    setInterval(() => {}, 1000);
}
