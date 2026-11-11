import { existsSync } from "node:fs";
import path from "node:path";
import { BrowserStartError } from "./lib/cdp.mjs";
import { CliError, EXIT, runCli } from "./lib/cli.mjs";
import { findBrowser } from "./lib/paths.mjs";
import { checkPresentation } from "./lib/presentation-check.mjs";

const spec = {
    html: { type: "string", help: "The built presentation to check", required: true },
    theme: { type: "string", help: "dark or light: open the page with ?scoutTheme=<theme> and check that it was applied" },
    timeout: { type: "string", help: "Seconds allowed for the whole check (default 60)" },
};

async function main(values) {
    const html = path.resolve(values.html);
    if (!existsSync(html)) throw new CliError(EXIT.INPUT, "cannot read the presentation", [`${html} does not exist`]);
    if (values.theme !== undefined && !["dark", "light"].includes(values.theme)) {
        throw new CliError(EXIT.USAGE, "--theme must be dark or light");
    }
    const seconds = values.timeout === undefined ? 60 : Number(values.timeout);
    if (!(seconds > 0)) throw new CliError(EXIT.USAGE, "--timeout must be a positive number of seconds");

    const requested = process.env.DR_BROWSER;
    const executable = requested && !existsSync(requested) ? null : findBrowser();
    const notRun = (detail) =>
        new CliError(EXIT.ENVIRONMENT, "the browser check did not run (NOT RUN)", [detail], {
            status: "not-run",
            browser: executable,
            theme: values.theme ?? null,
            scenes: 0,
            checks: [],
            consoleErrors: [],
        });
    if (requested && !existsSync(requested)) throw notRun(`DR_BROWSER points to a file that does not exist: ${requested}`);
    if (!executable) throw notRun("no Chrome, Edge or Chromium found; set DR_BROWSER to a browser executable");

    let result;
    try {
        result = await checkPresentation({ html, executable, theme: values.theme ?? null, timeoutMs: seconds * 1000 });
    } catch (err) {
        if (err instanceof BrowserStartError) throw notRun(err.message);
        throw err;
    }
    const failed = result.checks.filter((entry) => !entry.pass);
    const summary = {
        status: failed.length === 0 ? "passed" : "failed",
        browser: executable,
        theme: values.theme ?? null,
        scenes: result.scenes,
        checks: result.checks,
        consoleErrors: result.consoleErrors,
    };
    if (failed.length > 0) {
        const noun = failed.length === 1 ? "check" : "checks";
        throw new CliError(EXIT.REFUSED, `${failed.length} browser ${noun} failed`, failed.map((entry) => `${entry.id}: ${entry.detail}`), summary);
    }
    return summary;
}

await runCli({
    name: "check-presentation",
    description: "Open a built presentation in a headless browser and check what the vendored skill says must not break",
    spec,
    main,
});
