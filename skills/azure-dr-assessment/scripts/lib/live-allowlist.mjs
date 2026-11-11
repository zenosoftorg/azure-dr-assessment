import { CliError, EXIT } from "./cli.mjs";

export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Characters a shell would act on. The scripts never use a shell; this is a second line of defense.
const SHELL_META = /[;&|`$<>\\"'(){}[\]*?!#\n\r]/;
// What a Resource Graph query may contain: the bundled queries use only these characters.
const QUERY_CHARACTERS = /^[A-Za-z0-9_ ,.|=~'/-]+$/;
const QUERY_TABLE = /^(Resources|ResourceContainers)\b/;
const REGION = /^[a-z0-9]{3,40}$/;

const OUTPUT = { check: (value) => value === "json", explain: "the output format must be json" };
const COMMANDS = [
    { name: "account show", words: ["account", "show"], flags: {} },
    { name: "account list", words: ["account", "list"], flags: {} },
    { name: "extension list", words: ["extension", "list"], flags: {} },
    { name: "version", words: ["version"], flags: {} },
    {
        name: "graph query",
        words: ["graph", "query"],
        flags: {
            "-q": { required: true, raw: true, check: (value) => QUERY_TABLE.test(value) && QUERY_CHARACTERS.test(value), explain: "a graph query must start with Resources or ResourceContainers and use only the read-only character set" },
            "--subscriptions": { required: true, multiple: true, check: (value) => GUID.test(value), explain: "subscription ids must be GUIDs" },
            "--first": { required: true, check: (value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 1000, explain: "--first must be between 1 and 1000" },
            "--skip-token": { check: (value) => /^[A-Za-z0-9+/=_-]{1,8192}$/.test(value), explain: "the skip token has unexpected characters" },
            "--allow-partial-scopes": { boolean: true },
        },
    },
    {
        name: "vm list-skus",
        words: ["vm", "list-skus"],
        flags: {
            "--location": { required: true, check: (value) => REGION.test(value), explain: "the location must be an Azure region name such as swedencentral" },
            "--resource-type": { required: true, check: (value) => value === "virtualMachines", explain: "the resource type must be virtualMachines" },
            "--size": { required: true, check: (value) => /^[A-Za-z0-9_.-]{1,64}$/.test(value), explain: "the size has unexpected characters" },
        },
    },
    {
        name: "vm list-usage",
        words: ["vm", "list-usage"],
        flags: { "--location": { required: true, check: (value) => REGION.test(value), explain: "the location must be an Azure region name such as swedencentral" } },
    },
];

/**
 * Throw CliError(REFUSED) unless `args` (the argv after the az executable) is one of the read-only
 * commands of contracts 8.4, optionally followed by -o json. Returns the name of the matched command.
 */
export function assertReadOnly(args) {
    const shown = Array.isArray(args) ? args.map(String).join(" ").slice(0, 200) : String(args);
    const refuse = (reason) => {
        throw new CliError(EXIT.REFUSED, `refused: az ${shown} is not on the read-only allowlist`, [reason]);
    };
    if (!Array.isArray(args) || args.length === 0 || args.some((arg) => typeof arg !== "string")) refuse("the arguments must be a non-empty list of strings");
    const command = COMMANDS.find((candidate) => candidate.words.every((word, i) => args[i] === word));
    if (!command) refuse("this az command is not allowlisted");

    const rest = args.slice(command.words.length);
    const seen = new Set();
    for (let i = 0; i < rest.length; ) {
        const flag = rest[i];
        const isOutput = flag === "-o" || flag === "--output";
        const def = isOutput ? OUTPUT : Object.hasOwn(command.flags, flag) ? command.flags[flag] : null;
        if (!def) refuse(`the argument ${flag} is not allowed for az ${command.name}`);
        const id = isOutput ? "output" : flag;
        if (seen.has(id)) refuse(`${flag} is repeated`);
        seen.add(id);
        i++;
        if (def.boolean) continue;
        const values = [];
        while (i < rest.length && (values.length === 0 || (def.multiple && !rest[i].startsWith("-")))) values.push(rest[i++]);
        if (values.length === 0) refuse(`${flag} needs a value`);
        for (const value of values) {
            if (!def.raw && SHELL_META.test(value)) refuse(`${flag} has a shell metacharacter`);
            if (!def.check(value)) refuse(def.explain);
        }
    }
    for (const [flag, def] of Object.entries(command.flags)) {
        if (def.required && !seen.has(flag)) refuse(`az ${command.name} needs ${flag}`);
    }
    return { command: command.name };
}
