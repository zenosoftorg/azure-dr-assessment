#!/usr/bin/env node
// A stand-in for the Azure CLI, used by the tests. It answers the allowlisted commands from the JSON
// fixture named by FAKE_AZ_FIXTURE and appends every argv it receives to the file named by FAKE_AZ_LOG,
// so a test can assert that nothing but allowlisted commands ever ran. Anything else exits 64.
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_AZ_LOG) appendFileSync(process.env.FAKE_AZ_LOG, `${JSON.stringify(args)}\n`);
const fixture = JSON.parse(readFileSync(process.env.FAKE_AZ_FIXTURE, "utf8"));
const key = args[0] === "version" ? "version" : args.slice(0, 2).join(" ");

const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const multi = (name) => {
    const i = args.indexOf(name);
    const out = [];
    for (let j = i + 1; i >= 0 && j < args.length && !args[j].startsWith("-"); j++) out.push(args[j]);
    return out;
};
const finish = (code) => process.exit(code);

function graphPage() {
    const query = flag("-q") ?? "";
    const requested = new Set(multi("--subscriptions").map((id) => id.toLowerCase()));
    const noAccess = new Set((fixture.graph.noAccess ?? []).map((id) => id.toLowerCase()));
    let dataset = fixture.graph.resources;
    if (/subscriptions\/resourcegroups/i.test(query)) dataset = fixture.graph.resourceGroups;
    else if (/microsoft\.resources\/subscriptions'/i.test(query)) dataset = fixture.graph.subscriptions;
    const rows = dataset.filter((row) => requested.has(row.subscriptionId.toLowerCase()) && !noAccess.has(row.subscriptionId.toLowerCase()));
    const size = Number(flag("--first") ?? 1000);
    const start = flag("--skip-token") ? Number(Buffer.from(flag("--skip-token"), "base64").toString("utf8")) : 0;
    const data = rows.slice(start, start + size);
    const page = { count: data.length, data, total_records: rows.length };
    if (start + size < rows.length) page[fixture.tokenKey ?? "skip_token"] = Buffer.from(String(start + size)).toString("base64");
    return page;
}

const answers = {
    version: () => fixture.version ?? { "azure-cli": "2.70.0" },
    "account show": () => fixture.account.show,
    "account list": () => fixture.account.list,
    "extension list": () => fixture.extensions ?? [],
    "graph query": graphPage,
    "vm list-skus": () => (fixture.skus ?? {})[flag("--size")] ?? [],
    "vm list-usage": () => fixture.usage ?? [],
};

setTimeout(() => {
    if (fixture.failures?.[key]) {
        process.stderr.write(`${fixture.failures[key].stderr ?? "fake az failure"}\n`);
        finish(fixture.failures[key].code ?? 1);
    }
    if (!Object.hasOwn(answers, key)) {
        process.stderr.write(`fake-az: unsupported command: ${args.join(" ")}\n`);
        finish(64);
    }
    process.stdout.write(`${JSON.stringify(answers[key]())}\n`);
    finish(0);
}, fixture.delayMs?.[key] ?? 0);
