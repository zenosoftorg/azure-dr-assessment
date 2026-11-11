import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { EXCEPTIONS_GROUP_LABEL } from "../../skills/azure-dr-assessment/scripts/lib/diagram-dr.mjs";
import { DR_TEMPLATE, GOLDEN_DR_DIAGRAM, drStoryData, drStoryWorkspace } from "../helpers/dr-story-fixture.mjs";

const golden = () => JSON.parse(readFileSync(GOLDEN_DR_DIAGRAM, "utf8"));
const load = (workspace) => import(pathToFileURL(workspace.story).href);
const LINKS = "| Link | Label | Mechanism | Slot | Source |\n|---|---|---|---|---|";
const PARTS = "| Component | Detail | Slot | Source |\n|---|---|---|---|";

/** Stand-in for the builder's helpers: resolve labels in the diagram the way the builder does and record every miss. */
function resolver(diagram) {
    const misses = [];
    const find = (list, label) => list.find((item) => item.label === label)?.id ?? null;
    const resolve = (kind, list, label) => find(list, label) ?? (misses.push(`${kind} "${label}"`), null);
    return {
        misses,
        node: (label) => resolve("node", diagram.nodes, label),
        group: (label) => resolve("group", diagram.groups, label),
        edge: (from, to) => {
            const a = find(diagram.nodes, from);
            const b = find(diagram.nodes, to);
            const edge = a && b ? diagram.edges.find((e) => e.from === a && e.to === b) : null;
            if (!edge) misses.push(`edge "${from}" → "${to}"`);
            return edge?.id ?? null;
        },
    };
}

test("a story module needs a name of the form <id>.story.mjs to find its data", async () => {
    await assert.rejects(import(pathToFileURL(DR_TEMPLATE).href), /name this file <id>\.story\.mjs so that its data file <id>\.story-data\.json can be found \(it is story\.dr-walkthrough\.mjs\)/);
});

test("a full data file gives the ten steps in order, the establishing scenes after the healthy state and the exceptions after the weakest link", async () => {
    const story = await load(drStoryWorkspace());
    assert.deepEqual(story.cover, {
        kicker: "Architecture Story · disaster recovery", title: "checkout · disaster recovery", blurb: "How the workload fails over from westeurope to swedencentral, and back.",
    });
    const h = resolver(golden());
    const scenes = story.buildStory(golden(), h);
    assert.deepEqual(scenes.map((s) => [s.chapter, s.title]), [
        ["Healthy state", "How the workload runs and what is protected"],
        ["Establishing DR", "Data replication"],
        ["Establishing DR", "Compute"],
        ["Disaster", "What fails"],
        ["Detection", "How we notice"],
        ["Decision", "The incident commander decides"],
        ["Failover", "Failing over, step by step"],
        ["Verification", "Checking that the workload is back"],
        ["Failback", "Returning to the primary region"],
        ["RPO and RTO", "The weakest link"],
        ["Exceptions", "Documented exceptions"],
        ["Test plan", "How we prove it"],
    ]);
    assert.deepEqual(h.misses, []);
    assert.deepEqual(scenes.map((s) => [Boolean(s.all), Boolean(s.hold)]), [
        [true, true], [false, false], [false, false], [false, false], [false, false], [true, false], [false, false], [false, false], [false, false], [false, false], [false, false], [true, false],
    ]);
});

test("the healthy scene lists every link with its mechanism, slot and source, as written by build-diagram", async () => {
    const [healthy] = (await load(drStoryWorkspace())).buildStory(golden(), resolver(golden()));
    assert.equal(
        healthy.md,
        [
            "Users reach the primary region through the on-prem DNS record. The data tier replicates to the DR region.",
            "",
            "**Every link and the mechanism behind it**",
            "",
            LINKS,
            "| On-prem DNS → web-prod | Record to primary | the on-prem record points to the primary entry point | traffic-dns | DR-DNS-001 v1 |",
            "| On-prem DNS → web-dr | Change on-prem DNS record | on-prem record change at failover; the TTL wait counts toward RTO | traffic-dns | DR-DNS-001 v1 |",
            "| web-prod → orders-db | SQL | application connection | — | — |",
            "| orders-db → orders-db replica | Async geo-replication | SQL Database active geo-replication | data-replication.relational | Microsoft Learn |",
            "| web-dr → orders-db replica | SQL after failover | application connection after failover | — | — |",
        ].join("\n"),
    );
    assert.deepEqual([healthy.groups, healthy.nodes, healthy.edges], [[], [], []]);
});

test("a step highlights what the data names and shows a table of exactly that", async () => {
    const scenes = (await load(drStoryWorkspace())).buildStory(golden(), resolver(golden()));
    const failover = scenes[6];
    assert.deepEqual([failover.groups, failover.nodes, failover.edges], [["g_dr"], ["n_db-dr", "n_web-dr"], ["e_dns_web-dr_0"]]);
    assert.equal(
        failover.md,
        [
            "Promote the replica, start the DR web app and change the on-prem DNS record.",
            "",
            "**Links in this step**",
            "",
            LINKS,
            "| On-prem DNS → web-dr | Change on-prem DNS record | on-prem record change at failover; the TTL wait counts toward RTO | traffic-dns | DR-DNS-001 v1 |",
            "",
            "**Components in this step**",
            "",
            PARTS,
            "| orders-db replica | SQL Database · S3 | data-replication.relational | Microsoft Learn |",
            "| web-dr | App Service · P1v3 (warm) | compute | Microsoft Learn |",
        ].join("\n"),
    );
    const disaster = scenes[3];
    assert.deepEqual([disaster.groups, disaster.nodes, disaster.edges], [["g_primary"], [], []]);
    assert.equal(disaster.md, "The primary region is lost and nothing in westeurope can be reached.", "a group alone adds no table");
    assert.equal(scenes[5].md, "The incident commander approves the failover. This skill does not approve or run it.");
    assert.deepEqual(scenes[8].edges, ["e_dns_web_0"]);
});

test("the exceptions scene is generated from the Documented exceptions group, and absent without it", async () => {
    const story = await load(drStoryWorkspace());
    const scenes = story.buildStory(golden(), resolver(golden()));
    const exceptions = scenes[10];
    assert.deepEqual([exceptions.groups, exceptions.nodes], [["g_documented_exceptions"], ["n_exception_0"]]);
    assert.equal(
        exceptions.md,
        [
            "The design departs from the company defaults in these places. Each exception is recorded with its owner and its date.",
            "",
            "**Exception: DR-TIER-001 objectives**",
            "",
            "**Exception:** RTO 10m stays unmet by tier 1",
            "",
            "**Approver role:** CTO",
            "",
            "**Date:** 2026-11-04",
            "",
            "_This skill records the exception. It cannot verify the approval._",
        ].join("\n"),
    );

    const plain = golden();
    plain.groups = plain.groups.filter((g) => g.label !== EXCEPTIONS_GROUP_LABEL);
    plain.nodes = plain.nodes.filter((n) => n.group !== "g_documented_exceptions");
    const without = story.buildStory(plain, resolver(plain));
    assert.deepEqual(without.map((s) => s.chapter), ["Healthy state", "Establishing DR", "Establishing DR", "Disaster", "Detection", "Decision", "Failover", "Verification", "Failback", "RPO and RTO", "Test plan"]);
});

test("the template looks for the group that build-diagram adds", () => {
    assert.ok(readFileSync(DR_TEMPLATE, "utf8").includes(`const EXCEPTIONS_GROUP = ${JSON.stringify(EXCEPTIONS_GROUP_LABEL)};`));
});

test("the order of the steps is fixed, whatever the order in the data", async () => {
    const data = drStoryData();
    data.steps.reverse();
    const scenes = (await load(drStoryWorkspace({ data }))).buildStory(golden(), resolver(golden()));
    assert.deepEqual(scenes.map((s) => s.chapter), ["Healthy state", "Establishing DR", "Establishing DR", "Disaster", "Detection", "Decision", "Failover", "Verification", "Failback", "RPO and RTO", "Exceptions", "Test plan"]);
});

test("the cover may set its own kicker", async () => {
    const data = drStoryData({ cover: { kicker: "Customer review", title: "T", blurb: "B" } });
    assert.equal((await load(drStoryWorkspace({ data }))).cover.kicker, "Customer review");
});

test("labels from the data file go through the builder's helpers, so a typo is listed by the build", async () => {
    const data = drStoryData();
    data.steps[1].groups = ["Nope"];
    data.steps[4].nodes = ["web-dr", "ghost"];
    data.steps[6].edges = [["On-prem DNS", "ghost"]];
    const h = resolver(golden());
    (await load(drStoryWorkspace({ data }))).buildStory(golden(), h);
    assert.deepEqual(h.misses, ['group "Nope"', 'node "ghost"', 'edge "On-prem DNS" → "ghost"']);
});

const withStep = (index, change) => {
    const data = drStoryData();
    Object.assign(data.steps[index], change);
    return data;
};
const BROKEN = [
    ["a missing data file", null, /cannot read it/],
    ["a data file that is not JSON", "{ nope", /cannot read it/],
    ["another schemaVersion", { ...drStoryData(), schemaVersion: 2 }, /schemaVersion must be 1/],
    ["a cover without a blurb", { ...drStoryData(), cover: { title: "T" } }, /cover needs a title and a blurb/],
    ["a kicker that is not text", { ...drStoryData(), cover: { title: "T", blurb: "B", kicker: 5 } }, /cover\.kicker must be a string/],
    ["steps that are not a list", { ...drStoryData(), steps: {} }, /steps must be an array with one entry for each of the ten steps/],
    ["a step that is not one of the ten", withStep(0, { step: "party" }), /steps\[0\]\.step must be one of healthy, establishing, disaster, detection, approval, failover, verification, failback, weakest-link, test-plan/],
    ["a step told twice", withStep(1, { step: "healthy" }), /steps\[1\]\.step "healthy" appears twice/],
    ["a missing step", { ...drStoryData(), steps: drStoryData().steps.slice(0, 7) }, /steps is missing: establishing, weakest-link, test-plan/],
    ["a step without narration", withStep(0, { md: " " }), /steps\[0\]\.md must be the narration of the step/],
    ["a title that is not text", withStep(0, { title: 5 }), /steps\[0\]\.title must be a string/],
    ["group labels that are not a list", withStep(1, { groups: "Primary" }), /steps\[1\]\.groups must be a list of labels/],
    ["an edge pair of the wrong length", withStep(4, { edges: [["On-prem DNS"]] }), /steps\[4\]\.edges must be a list of \[from label, to label\] pairs/],
    ["an establishing step without scenes", withStep(9, { scenes: undefined }), /steps\[9\]\.scenes must be a non-empty list: one scene per build-order group/],
    ["an establishing step with no scene", withStep(9, { scenes: [] }), /steps\[9\]\.scenes must be a non-empty list: one scene per build-order group/],
    ["a scene that is not an object", withStep(9, { scenes: ["Compute"] }), /steps\[9\]\.scenes\[0\] must be an object with a title and md/],
    ["a scene without a title", withStep(9, { scenes: [{ md: "Narration" }] }), /steps\[9\]\.scenes\[0\]\.title must be the title of the scene/],
    ["a scene without narration", withStep(9, { scenes: [{ title: "Compute", md: "" }] }), /steps\[9\]\.scenes\[0\]\.md must be the narration of the scene/],
    ["scene node labels that are not a list", withStep(9, { scenes: [{ title: "Compute", md: "x", nodes: "web-dr" }] }), /steps\[9\]\.scenes\[0\]\.nodes must be a list of labels/],
    ["an introduction that is not text", withStep(9, { md: 5 }), /steps\[9\]\.md must be a string: the optional introduction of the chapter/],
];

for (const [title, data, message] of BROKEN) {
    test(`importing fails clearly for ${title}`, async () => {
        const workspace = drStoryWorkspace({ data: typeof data === "string" ? null : data });
        if (typeof data === "string") writeFileSync(workspace.data, data);
        await assert.rejects(load(workspace), (err) => err.message.startsWith("story data checkout-proposed-dr.story-data.json: ") && message.test(err.message));
    });
}

test("the establishing step tells one scene per entry of scenes, with the introduction before the first and the tables of what each highlights", async () => {
    const scenes = (await load(drStoryWorkspace())).buildStory(golden(), resolver(golden()));
    const [data, compute] = scenes.filter((s) => s.chapter === "Establishing DR");
    assert.deepEqual([data.groups, data.nodes, data.edges], [[], ["n_db-dr"], ["e_db_db-dr_0"]]);
    assert.equal(
        data.md,
        [
            "The DR region is built beside today's setup, in the build order of the establishment guide.",
            "",
            "Today orders-db has no replica. Target: active geo-replication to swedencentral. Test: the lag stays below the Estimated RPO for 7 days.",
            "",
            "**Links in this step**",
            "",
            LINKS,
            "| orders-db → orders-db replica | Async geo-replication | SQL Database active geo-replication | data-replication.relational | Microsoft Learn |",
            "",
            "**Components in this step**",
            "",
            PARTS,
            "| orders-db replica | SQL Database · S3 | data-replication.relational | Microsoft Learn |",
        ].join("\n"),
    );
    assert.deepEqual([compute.groups, compute.nodes, compute.edges, compute.md], [["g_dr"], [], [], "Today web-prod runs only in westeurope. Target: a warm web app in swedencentral. Test: it answers a health probe."]);

    const plain = drStoryData();
    delete plain.steps[9].md;
    plain.steps[9].scenes = [{ title: "Everything", md: "Build the DR region." }];
    const one = (await load(drStoryWorkspace({ data: plain }))).buildStory(golden(), resolver(golden())).filter((s) => s.chapter === "Establishing DR");
    assert.deepEqual(one, [{ chapter: "Establishing DR", title: "Everything", all: true, groups: [], nodes: [], edges: [], md: "Build the DR region." }]);
});
