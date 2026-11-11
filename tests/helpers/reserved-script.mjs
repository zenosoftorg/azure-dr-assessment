import { CliError, EXIT, runCli } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";

// A script whose result and whose failure fields use the names of the envelope fields.
await runCli({
    name: "reserved",
    description: "Test fixture: result and failure fields named like the envelope",
    spec: { mode: { type: "string", help: "result or failure", required: true } },
    async main({ mode }) {
        if (mode === "failure") {
            throw new CliError(EXIT.REFUSED, "refused", ["why"], { ok: true, script: "evil", code: 0, error: "no", details: [], reason: "demo" });
        }
        return { ok: false, script: "evil", kept: 1 };
    },
});
