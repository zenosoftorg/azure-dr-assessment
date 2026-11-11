import { CliError, EXIT, runCli } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";

await runCli({
    name: "fixture",
    description: "Fixture script for the CLI tests",
    spec: { name: { type: "string", help: "Behavior to trigger", required: true } },
    main(values) {
        if (values.name === "refuse") throw new CliError(EXIT.REFUSED, "refused on purpose", ["why"], { reason: "demo" });
        if (values.name === "boom") throw new Error("boom");
        return { echoed: values.name };
    },
});
