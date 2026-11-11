import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { GOLDEN_DIAGRAM, goldenStoryData, storyWorkspace, TEMPLATE } from "../helpers/story-fixture.mjs";

const golden = () => JSON.parse(readFileSync(GOLDEN_DIAGRAM, "utf8"));
const load = (workspace) => import(pathToFileURL(workspace.story).href);
const HEAD = "| Component | Detail | Strength | Evidence |\n|---|---|---|---|";

/** Stand-in for the builder's helpers: ids that show which label was asked for, and a record of every call. */
function recorder() {
    const calls = [];
    return {
        calls,
        node: (label) => (calls.push(["node", label]), `node:${label}`),
        group: (label) => (calls.push(["group", label]), `group:${label}`),
        edge: (from, to) => (calls.push(["edge", from, to]), `edge:${from}>${to}`),
    };
}

test("a story module needs a name of the form <id>.story.mjs to find its data", async () => {
    await assert.rejects(import(pathToFileURL(TEMPLATE).href), /name this file <id>\.story\.mjs so that its data file <id>\.story-data\.json can be found \(it is story\.current-state\.mjs\)/);
});

test("a full data file gives the inferred links, the unknowns, an overview, one scene per group and one for the rest", async () => {
    const story = await load(storyWorkspace());
    assert.deepEqual(story.cover, {
        kicker: "Architecture Story · as-is", title: "checkout · current state", blurb: "What the inventory shows, what was inferred and what is unknown.",
    });
    const h = recorder();
    const scenes = story.buildStory(golden(), h);
    assert.deepEqual(scenes.map((s) => [s.chapter, s.title]), [
        ["Inferred links", "What we inferred, and why"],
        ["Unknowns", "What we do not know"],
        ["Observed architecture", "The architecture as the inventory shows it"],
        ["Primary · westeurope", "The primary region"],
        ["Data services", "Data services"],
        ["Outside the groups", "Components outside the groups"],
    ]);

    const [inferred, unknowns, overview, primary, data, loose] = scenes;
    assert.deepEqual(inferred.edges, ["e_web_db_0", "e_web_assets_0", "e_web_queue_0"]);
    assert.equal(
        inferred.md,
        [
            "Dashed amber links are **inferred**, not observed in the inventory. Each one states what it was inferred from.",
            "",
            "| Link | Label | Basis | Evidence |",
            "|---|---|---|---|",
            "| web-prod → orders-db | SQL | connection string name matches | F-0006 |",
            "| web-prod → assets-prod | Blob | owner statement | F-0007 |",
            "| web-prod → orders-queue | Orders | owner statement | F-0010 |",
        ].join("\n"),
    );
    assert.deepEqual([unknowns.all, unknowns.md], [true, "- Zone redundancy of orders-queue is not in the export."]);
    assert.deepEqual([overview.all, overview.hold], [true, true]);
    assert.equal(overview.md, "**Components:** 6. **Groups:** 2. **Links:** 2 observed (solid), 3 inferred (dashed amber).");

    assert.deepEqual(primary.groups, ["g_primary", "g_data"]);
    assert.deepEqual(primary.nodes, ["node:web-prod"]);
    assert.deepEqual(primary.edges, ["edge:web-prod>orders-db"]);
    assert.equal(
        primary.md,
        [
            "Everything the export lists runs here.", "", HEAD,
            "| web-prod | App Service · P1v3 | Observed | F-0001 |",
            "| kv-prod | Key Vault | Observed | F-0005 |",
            "| orders-queue | Standard | Observed | F-0008 |",
        ].join("\n"),
    );
    assert.deepEqual([data.groups, data.nodes, data.edges], [["g_data"], [], []]);
    assert.equal(
        data.md,
        ["The data stores.", "", HEAD, "| orders-db | SQL Database · S3 | Observed | F-0002 |", "| assets-prod | Storage · Standard_LRS | Observed | F-0003 |"].join("\n"),
    );
    assert.deepEqual(loose.nodes, ["n_front-door"]);
    assert.equal(loose.md, [HEAD, "| Front Door | Premium | Observed | F-0004 |"].join("\n"));
    assert.deepEqual(h.calls, [["group", "Primary · westeurope"], ["group", "Data services"], ["node", "web-prod"], ["edge", "web-prod", "orders-db"]]);
});

test("a region mismatch opens the story", async () => {
    const mismatch = { title: "The declared region is not in the inventory", md: "Declared **swedencentral**; the in-scope resources are in westeurope." };
    const scenes = (await load(storyWorkspace({ data: goldenStoryData({ regionMismatch: mismatch }) }))).buildStory(golden(), recorder());
    assert.deepEqual(scenes[0], { chapter: "Region check", title: mismatch.title, all: true, hold: true, md: mismatch.md });
    assert.equal(scenes[1].chapter, "Inferred links");
    assert.equal(scenes.length, 7);
});

test("only the cover is required: groups still get a scene and a story without inferred links skips that scene", async () => {
    const story = await load(storyWorkspace({ data: { schemaVersion: 1, cover: { title: "T", blurb: "B" } } }));
    assert.equal(story.cover.kicker, "Architecture Story · as-is");
    const diagram = golden();
    diagram.edges = diagram.edges.filter((edge) => !edge.annotation.includes("Inferred"));
    const h = recorder();
    const scenes = story.buildStory(diagram, h);
    assert.deepEqual(scenes.map((s) => s.chapter), ["Observed architecture", "Primary · westeurope", "Data services", "Outside the groups"]);
    assert.equal(scenes[0].md, "**Components:** 6. **Groups:** 2. **Links:** 2 observed (solid), 0 inferred (dashed amber).");
    assert.equal(scenes[1].title, "Primary · westeurope");
    assert.deepEqual([scenes[1].nodes, scenes[1].edges], [[], []]);
    assert.deepEqual(h.calls, []);
});

test("a diagram without groups gets one scene for all of its components", async () => {
    const story = await load(storyWorkspace({ data: goldenStoryData({ groups: [] }) }));
    const note = (strength) => `**Evidence:** F-0001\n\n**Strength:** ${strength}`;
    const diagram = {
        nodes: [
            { id: "n_a", label: "A", sublabel: "", group: null, annotation: note("Observed") },
            { id: "n_b", label: "B", sublabel: "tier|x", group: null, annotation: "" },
        ],
        edges: [],
        groups: [],
    };
    const scenes = story.buildStory(diagram, recorder());
    assert.deepEqual(scenes.map((s) => [s.chapter, s.title]), [["Unknowns", "What we do not know"], ["Observed architecture", "The architecture as the inventory shows it"], ["Observed architecture", "The components"]]);
    assert.equal(scenes[2].md, [HEAD, "| A | — | Observed | F-0001 |", "| B | tier\\|x | — | — |"].join("\n"));
});

test("labels from the data file go through the builder's helpers, so a typo is listed by the build", async () => {
    const data = goldenStoryData({
        groups: [{ group: "Nope", nodes: ["ghost"] }, { group: "Primary · westeurope", edges: [["web-prod", "ghost"]] }],
    });
    const h = recorder();
    (await load(storyWorkspace({ data }))).buildStory(golden(), h);
    assert.deepEqual(h.calls, [["group", "Nope"], ["group", "Primary · westeurope"], ["edge", "web-prod", "ghost"]]);
});

const BROKEN = [
    ["a missing data file", null, /cannot read it/],
    ["a data file that is not JSON", "{ nope", /cannot read it/],
    ["another schemaVersion", { ...goldenStoryData(), schemaVersion: 2 }, /schemaVersion must be 1/],
    ["a cover without a blurb", { ...goldenStoryData(), cover: { title: "T" } }, /cover needs a title and a blurb/],
    ["a kicker that is not text", { ...goldenStoryData(), cover: { title: "T", blurb: "B", kicker: 5 } }, /cover\.kicker must be a string/],
    ["a region mismatch without text", { ...goldenStoryData(), regionMismatch: { title: "T" } }, /regionMismatch must be null or \{ "title", "md" \}/],
    ["unknowns with a blank title", { ...goldenStoryData(), unknowns: { title: " ", md: "x" } }, /unknowns must be null or \{ "title", "md" \}/],
    ["groups that are not a list", { ...goldenStoryData(), groups: {} }, /groups must be an array/],
    ["a group entry without a label", { ...goldenStoryData(), groups: [{ md: "x" }] }, /groups\[0\]\.group must be a group label/],
    ["a group named twice", { ...goldenStoryData(), groups: [{ group: "A" }, { group: "A" }] }, /groups\[1\]\.group "A" appears twice/],
    ["node labels that are not a list", { ...goldenStoryData(), groups: [{ group: "A", nodes: "web-prod" }] }, /groups\[0\]\.nodes must be a list of node labels/],
    ["an edge pair of the wrong length", { ...goldenStoryData(), groups: [{ group: "A", edges: [["web-prod"]] }] }, /groups\[0\]\.edges must be a list of \[from label, to label\] pairs/],
];

for (const [title, data, message] of BROKEN) {
    test(`importing fails clearly for ${title}`, async () => {
        const workspace = storyWorkspace({ data: typeof data === "string" ? null : data });
        if (typeof data === "string") writeFileSync(workspace.data, data);
        await assert.rejects(load(workspace), (err) => err.message.startsWith("story data checkout-current-state.story-data.json: ") && message.test(err.message));
    });
}
