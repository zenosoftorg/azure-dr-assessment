import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeAssessment, serializeAssessment } from "../../skills/azure-dr-assessment/scripts/lib/assessment.mjs";
import { Ledger } from "../../skills/azure-dr-assessment/scripts/lib/ledger.mjs";
import { makeAriWorkbook } from "../helpers/ari-fixture.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { TEMPLATE } from "../helpers/story-fixture.mjs";

const scripts = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "scripts");
const script = (name) => path.join(scripts, `${name}.mjs`);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

/**
 * Stages 3 and 4 and presentation #1 as the skill runs them, with a test standing in for the model: ingest a generated
 * ARI workbook, record the owner's statement in the ledger, write the diagram spec and the story data from the evidence,
 * then build the diagram and the presentation.
 */
async function asIs({ primary }) {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-chain-")));
    const root = path.join(cwd, "dr-assessment", "checkout");
    const rel = (...parts) => path.join("dr-assessment", "checkout", ...parts);
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(cwd, "ari-export.xlsx"), makeAriWorkbook());
    writeFileSync(
        path.join(root, "assessment.yaml"),
        serializeAssessment(normalizeAssessment({
            workload: { name: "checkout" }, inputs: { ari_file: "ari-export.xlsx" }, regions: { primary, dr: "northeurope" }, objectives: { tier: 1 },
            scope: { resource_groups: ["rg-checkout"] },
        })),
    );
    const iconRoot = makeIconRoot();
    const step = async (name, args) => {
        const r = await runScript(script(name), args, { cwd });
        assert.equal(r.code, 0, `${name}: ${r.stdout}${r.stderr}`);
        return r.json;
    };

    const ingest = await step("ingest", ["--assessment", rel("assessment.yaml")]);
    const owner = await step("ledger", [
        "add-fact", "--ledger", rel("evidence", "ledger.json"), "--strength", "Inferred", "--subject", "web-checkout",
        "--claim", "web-checkout calls orders-db", "--basis", "owner statement", "--source-type", "owner",
    ]);

    const inventory = read(path.join(root, "evidence", "inventory.json"));
    const ledger = await Ledger.load(path.join(root, "evidence", "ledger.json"));
    const identity = (resource) => ledger.entries.find((e) => e.subject === resource.ref && e.property === "name").id;
    const id = "checkout-current-state";
    mkdirSync(path.join(root, "architectures"));
    writeFileSync(
        path.join(root, "architectures", `${id}.spec.json`),
        JSON.stringify({
            schemaVersion: 1, kind: "current-state", id, title: `checkout · current state (${primary})`, direction: "LR",
            groups: [{ key: "rg", label: "rg-checkout", parent: null, style: "primary", evidence: [identity(inventory.resources[0])], annotation: "" }],
            nodes: inventory.resources.map((r) => ({
                key: r.name, label: r.name, sublabel: r.sku ?? "", armType: r.armType, icon: null, group: "rg", evidence: [identity(r)], decisions: [], annotation: "",
            })),
            edges: [{ from: "web-checkout", to: "orders-db", label: "SQL", kind: "inferred", basis: "owner statement", evidence: [owner.id], mechanism: null, arrow: "forward", annotation: "" }],
        }),
    );
    const diagram = await step("build-diagram", ["--spec", rel("architectures", `${id}.spec.json`), "--ledger", rel("evidence", "ledger.json"), "--icon-root", iconRoot]);

    const mismatch = ingest.regionCheck.status === "mismatch";
    const observed = ingest.regionCheck.observed.map((o) => `${o.region} (${o.resources})`).join(", ");
    mkdirSync(path.join(root, "presentations"));
    copyFileSync(TEMPLATE, path.join(root, "presentations", `${id}.story.mjs`));
    writeFileSync(
        path.join(root, "presentations", `${id}.story-data.json`),
        JSON.stringify({
            schemaVersion: 1,
            cover: { title: "checkout · current state", blurb: "What the inventory shows today, what was inferred and what is not known." },
            regionMismatch: mismatch ? { title: "The declared region is not where the resources are", md: `Declared **${primary}**; the in-scope resources are in ${observed}.` } : null,
            unknowns: { title: "What we do not know", md: ingest.omittedSheets.map((s) => `- Sheet **${s.name}** was not assessed: ${s.reason}`).join("\n") },
            groups: [{ group: "rg-checkout", md: `${ingest.resources.inScope} resources were found in rg-checkout.`, nodes: ["web-checkout", "orders-db"], edges: [["web-checkout", "orders-db"]] }],
        }),
    );
    const story = rel("presentations", `${id}.story.mjs`);
    const result = await runScript(script("present"), ["--story", story, "--icon-root", iconRoot], { cwd });
    return { cwd, root, rel, story, ingest, diagram, result, html: path.join(root, "presentations", `${id}.html`) };
}

test("a generated ARI workbook becomes presentation #1 through ingest, build-diagram and present", async () => {
    const run = await asIs({ primary: "westeurope" });
    assert.equal(run.ingest.regionCheck.status, "match");
    assert.deepEqual([run.diagram.nodes, run.diagram.edges, run.diagram.groups], [7, 1, 1]);
    assert.deepEqual(run.diagram.genericIcons, ["web-vm-01", "web-vm-02", "web-vm-01_OsDisk"]);

    const r = run.result;
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual([r.json.icons, r.json.scenes, r.json.missingIcons], [5, 4, []]);
    const html = readFileSync(run.html, "utf8");
    assert.ok(html.split("data:image/svg+xml;base64,").length - 1 >= r.json.icons, "the icons are inlined");
    for (const text of ["What we inferred, and why", "web-checkout → orders-db", "owner statement", "Sheet **Overview** was not assessed", "7 resources were found in rg-checkout."]) {
        assert.ok(html.includes(text), `the HTML tells "${text}"`);
    }
    assert.equal(html.includes("The declared region is not where the resources are"), false);
});

test("a declared primary region that the inventory does not show opens the story, and a library without icons refuses the build", async () => {
    const run = await asIs({ primary: "swedencentral" });
    assert.deepEqual(run.ingest.regionCheck, { declared: "swedencentral", observed: [{ region: "westeurope", resources: 7 }], status: "mismatch" });
    assert.equal(run.result.code, 0, run.result.stderr);
    assert.equal(run.result.json.scenes, 5);
    const html = readFileSync(run.html, "utf8");
    assert.ok(html.indexOf("The declared region is not where the resources are") < html.indexOf("What we inferred, and why"), "the mismatch comes first");
    assert.ok(html.includes("Declared **swedencentral**; the in-scope resources are in westeurope (7)."));

    const empty = await runScript(script("present"), ["--story", run.story, "--icon-root", makeIconRoot({ withIcons: false }), "--out", path.join(run.root, "presentations", "refused.html")], { cwd: run.cwd });
    assert.equal(empty.code, 4);
    assert.equal(empty.json.reason, "zero-icons");
    assert.equal(existsSync(path.join(run.root, "presentations", "refused.html")), false);
});
