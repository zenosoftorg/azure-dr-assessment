import assert from "node:assert/strict";
import test from "node:test";
import { CliError, EXIT } from "../../skills/azure-dr-assessment/scripts/lib/cli.mjs";
import { buildDiagram, validateDiagramSpec } from "../../skills/azure-dr-assessment/scripts/lib/diagram-spec.mjs";
import { EDGE_STYLES, GROUP_STYLES, KINDS, NON_DEFAULT_PACK_SUFFIX, slugKey } from "../../skills/azure-dr-assessment/scripts/lib/diagram-style.mjs";
import { loadCanvasModules } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { makeFixtureLedger, readFixtureSpec } from "../helpers/diagram-ledger.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";

const canvas = await loadCanvasModules();
const catalog = await canvas.icons.buildCatalog(makeIconRoot());
const ledger = makeFixtureLedger();
const check = (spec, ctx = {}) => validateDiagramSpec(spec, { ledger, kind: "current-state", ...ctx });
const build = (spec, extra = {}) => buildDiagram(spec, { ledger, catalog, modules: canvas, ...extra });

test("the fixture spec is valid", () => {
    assert.deepEqual(check(readFixtureSpec()), { ok: true, errors: [] });
});

// [what is wrong, the change that breaks the fixture spec, the error path, a part of the message]
const RULES = [
    ["a schemaVersion other than 1", (s) => { s.schemaVersion = 2; }, "schemaVersion", "must be 1"],
    ["an id that is not a slug", (s) => { s.id = "Checkout Current State"; }, "id", "lowercase slug"],
    ["an id longer than 60 characters", (s) => { s.id = "a".repeat(61); }, "id", "at most 60"],
    ["a blank title", (s) => { s.title = " "; }, "title", "non-empty"],
    ["a direction other than LR or TB", (s) => { s.direction = "RL"; }, "direction", "LR or TB"],
    ["a spec without nodes", (s) => { s.nodes = []; s.edges = []; }, "nodes", "at least one node"],
    ["nodes that are not an array", (s) => { s.nodes = {}; }, "nodes", "must be an array"],
    ["a duplicate group key", (s) => { s.groups[1].key = "primary"; }, "groups[1].key", "duplicate key"],
    ["two group keys that give the same id", (s) => { s.groups[1].key = "Primary"; }, "groups[1].key", "same id as"],
    ["a node key without a letter or digit", (s) => { s.nodes[0].key = "--"; }, "nodes[0].key", "letter or digit"],
    ["a duplicate group label", (s) => { s.groups[1].label = "Primary · westeurope"; }, "groups[1].label", "duplicate group label"],
    ["a group style that belongs to proposed-dr", (s) => { s.groups[0].style = "dr"; }, "groups[0].style", "primary, inferred, neutral"],
    ["a group parent that is not a group", (s) => { s.groups[1].parent = "nowhere"; }, "groups[1].parent", "is not a group key"],
    ["a group that is its own parent", (s) => { s.groups[1].parent = "data"; }, "groups[1].parent", "its own parent"],
    ["a parent cycle", (s) => { s.groups[0].parent = "data"; }, "groups[0].parent", "cycle"],
    ["group evidence that is not in the ledger", (s) => { s.groups[0].evidence = ["F-0099"]; }, "groups[0].evidence[0]", "F-0099 is not in the ledger"],
    ["a duplicate node key", (s) => { s.nodes[1].key = "front-door"; }, "nodes[1].key", "duplicate key"],
    ["a blank node label", (s) => { s.nodes[1].label = ""; }, "nodes[1].label", "non-empty"],
    ["a node label over 60 characters", (s) => { s.nodes[1].label = "x".repeat(61); }, "nodes[1].label", "at most 60 characters (it is 61)"],
    ["a duplicate node label", (s) => { s.nodes[1].label = "Front Door"; }, "nodes[1].label", "duplicate node label"],
    ["a node in a group that does not exist", (s) => { s.nodes[1].group = "nowhere"; }, "nodes[1].group", "is not a group key"],
    ["a node without evidence", (s) => { s.nodes[1].evidence = []; }, "nodes[1].evidence", "Observed or Inferred"],
    ["a node justified by an Unknown fact alone", (s) => { s.nodes[1].evidence = ["F-0009"]; }, "nodes[1].evidence", "Unknown fact alone"],
    ["a node citing an id that is not in the ledger", (s) => { s.nodes[1].evidence = ["F-0042"]; }, "nodes[1].evidence[0]", "F-0042 is not in the ledger"],
    ["node evidence that is not a list", (s) => { s.nodes[1].evidence = "F-0001"; }, "nodes[1].evidence", "array of ledger ids"],
    ["decisions on a current-state node", (s) => { s.nodes[1].decisions = ["traffic-dns"]; }, "nodes[1].decisions", "proposed-dr"],
    ["an armType that is not text", (s) => { s.nodes[1].armType = 5; }, "nodes[1].armType", "string or null"],
    ["an edge to a node that does not exist", (s) => { s.edges[0].to = "nowhere"; }, "edges[0].to", "is not a node key"],
    ["an edge from a node to itself", (s) => { s.edges[0].to = "front-door"; }, "edges[0].to", "itself"],
    ["an edge kind that belongs to proposed-dr", (s) => { s.edges[0].kind = "failover"; }, "edges[0].kind", "observed, inferred"],
    ["an observed edge without an Observed fact", (s) => { s.edges[0].evidence = ["F-0006"]; }, "edges[0].evidence", "Observed fact"],
    ["an inferred edge without a basis", (s) => { s.edges[2].basis = ""; }, "edges[2].basis", "needs a basis"],
    ["an inferred edge without evidence", (s) => { s.edges[2].evidence = []; }, "edges[2].evidence", "Observed or Inferred fact"],
    ["an inferred edge justified by an Unknown fact alone", (s) => { s.edges[2].evidence = ["F-0009"]; }, "edges[2].evidence", "Observed or Inferred fact"],
    ["a mechanism on a current-state edge", (s) => { s.edges[2].mechanism = "dns"; }, "edges[2].mechanism", "proposed-dr"],
    ["an arrow that is not one of the four", (s) => { s.edges[0].arrow = "sideways"; }, "edges[0].arrow", "none, forward, backward, both"],
];

for (const [title, mutate, at, part] of RULES) {
    test(`rejects ${title}`, () => {
        const spec = readFixtureSpec();
        mutate(spec);
        const { ok, errors } = check(spec);
        assert.equal(ok, false);
        assert.ok(errors.some((e) => e.path === at && e.message.includes(part)), `expected ${at}: ...${part}..., got ${JSON.stringify(errors)}`);
    });
}

test("a node may rest on an Inferred fact alone, as the table of contracts 7.4 allows (the contract notes say why this deserves a second look)", () => {
    const spec = readFixtureSpec();
    spec.nodes[1].evidence = ["F-0006"];
    assert.deepEqual(check(spec), { ok: true, errors: [] });
});

test("every problem is reported, in document order, and an edge without a basis is rejected rather than dropped", () => {
    const spec = readFixtureSpec();
    spec.edges[2].basis = "";
    spec.edges[0].to = "nowhere";
    spec.nodes[1].evidence = [];
    spec.groups[0].style = "dr";
    spec.title = "";
    assert.deepEqual(check(spec).errors.map((e) => e.path), ["title", "groups[0].style", "nodes[1].evidence", "edges[0].to", "edges[2].basis"]);
});

test("a spec that is not an object, or is not of the kind asked for, is reported once", () => {
    assert.deepEqual(check(null), { ok: false, errors: [{ path: "", message: "the spec must be a JSON object" }] });
    assert.deepEqual(check([]).errors.map((e) => e.path), [""]);
    assert.deepEqual(check(readFixtureSpec(), { kind: "other" }).errors, [{ path: "kind", message: "must be current-state or proposed-dr" }]);
    const proposed = { ...readFixtureSpec(), kind: "proposed-dr" };
    assert.deepEqual(check(proposed).errors, [{ path: "kind", message: 'must be "current-state", it is "proposed-dr"' }]);
});

test("validateDiagramSpec cannot judge evidence without a ledger", () => {
    assert.throws(() => validateDiagramSpec(readFixtureSpec(), { kind: "current-state" }), TypeError);
});

test("groups and edges may be omitted", () => {
    const minimal = {
        schemaVersion: 1, kind: "current-state", id: "mini", title: "Mini",
        nodes: [{ key: "web", label: "web-prod", armType: "microsoft.web/sites", group: null, evidence: ["F-0001"] }],
    };
    assert.deepEqual(check(minimal), { ok: true, errors: [] });
    const { diagram } = build(minimal);
    assert.deepEqual([diagram.nodes.length, diagram.groups.length, diagram.edges.length], [1, 0, 0]);
    assert.equal(diagram.nodes[0].sublabel, "");
    assert.equal(diagram.nodes[0].annotation, "**Evidence:** F-0001\n\n**Strength:** Observed");
});

test("the style tables are those of contracts 7.4", () => {
    assert.deepEqual(GROUP_STYLES, {
        primary: { border: "#0969da", background: "rgba(9,105,218,0.08)", dashed: false },
        dr: { border: "#8250df", background: "rgba(130,80,223,0.08)", dashed: false },
        global: { border: "#1a7f37", background: "rgba(26,127,55,0.08)", dashed: false },
        onprem: { border: "#57606a", background: "rgba(87,96,106,0.08)", dashed: false },
        inferred: { border: "#f59e0b", background: "rgba(245,158,11,0.08)", dashed: true },
        neutral: { border: "#8c959f", background: "rgba(140,149,159,0.08)", dashed: true },
        split: { border: "#bf8700", background: "rgba(191,135,0,0.08)", dashed: true },
    });
    assert.deepEqual(EDGE_STYLES, {
        observed: { color: "#0969da", dashed: false },
        inferred: { color: "#f59e0b", dashed: true },
        replication: { color: "#8250df", dashed: false },
        traffic: { color: "#1a7f37", dashed: false },
        failover: { color: "#cf222e", dashed: true },
        dependency: { color: "#57606a", dashed: false },
    });
    assert.deepEqual(KINDS, {
        "current-state": { groupStyles: ["primary", "inferred", "neutral"], edgeKinds: ["observed", "inferred"] },
        "proposed-dr": { groupStyles: ["primary", "dr", "global", "onprem", "neutral", "split"], edgeKinds: ["observed", "replication", "traffic", "failover", "dependency"] },
    });
    assert.equal(NON_DEFAULT_PACK_SUFFIX, " [NON-DEFAULT PATTERN PACK]");
});

test("slugKey is the vendored slugify, so the ids follow the canvas's own rule", () => {
    for (const text of ["web-prod", "Web Prod", "orders_db", "--x--", "", "Ünïcode name", "a".repeat(80), "***", "A  B", "x.y/z"]) {
        assert.equal(slugKey(text), canvas.store.slugify(text), JSON.stringify(text));
    }
});

test("buildDiagram maps the spec to the ids, icons, styles and links of contracts 7.4", () => {
    const { diagram, genericIcons, closestIcons } = build(readFixtureSpec());
    assert.equal(diagram.version, 1);
    assert.equal(diagram.title, "checkout · current state (westeurope)");
    assert.deepEqual(diagram.decisions, []);
    assert.deepEqual(diagram.view, { x: 0, y: 0, zoom: 1 });
    assert.match(diagram.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(diagram.nodes.map((n) => n.id), ["n_front-door", "n_web", "n_db", "n_assets", "n_vault", "n_queue"]);
    assert.deepEqual(diagram.nodes.map((n) => n.iconId), [
        "azure:front-door-and-cdn-profiles", "azure:app-services", "azure:sql-database", "azure:storage-accounts", "azure:key-vaults", "azure:all-resources",
    ]);
    assert.deepEqual(diagram.nodes.map((n) => n.group), [null, "g_primary", "g_data", "g_data", "g_primary", "g_primary"]);
    assert.deepEqual(diagram.nodes.map((n) => n.label), ["Front Door", "web-prod", "orders-db", "assets-prod", "kv-prod", "orders-queue"]);
    assert.ok(diagram.nodes.every((n) => n.variant === 0));
    assert.deepEqual(diagram.groups.map(({ id, label, parent, border, background, dashed }) => ({ id, label, parent, border, background, dashed })), [
        { id: "g_primary", label: "Primary · westeurope", parent: null, border: "#0969da", background: "rgba(9,105,218,0.08)", dashed: false },
        { id: "g_data", label: "Data services", parent: "g_primary", border: "#8c959f", background: "rgba(140,149,159,0.08)", dashed: true },
    ]);
    assert.deepEqual(diagram.edges.map((e) => [e.id, e.from, e.to, e.label, e.color, e.dashed, e.width, e.arrow, e.route]), [
        ["e_front-door_web_0", "n_front-door", "n_web", "HTTPS", "#0969da", false, 2, "forward", "straight"],
        ["e_front-door_web_1", "n_front-door", "n_web", "Health probe", "#0969da", false, 2, "forward", "straight"],
        ["e_web_db_0", "n_web", "n_db", "SQL", "#f59e0b", true, 2, "forward", "straight"],
        ["e_web_assets_0", "n_web", "n_assets", "Blob", "#f59e0b", true, 2, "forward", "straight"],
        ["e_web_queue_0", "n_web", "n_queue", "Orders", "#f59e0b", true, 2, "forward", "straight"],
    ]);
    assert.deepEqual(genericIcons, ["orders-queue"]);
    assert.deepEqual(closestIcons, []);
});

test("annotations are the generated markdown followed by the model's own text", () => {
    const { diagram } = build(readFixtureSpec());
    const node = (id) => diagram.nodes.find((n) => n.id === id);
    const edge = (id) => diagram.edges.find((e) => e.id === id);
    assert.equal(node("n_web").annotation, "**Evidence:** F-0001\n\n**Strength:** Observed");
    assert.equal(
        node("n_queue").annotation,
        "**Evidence:** F-0008\n\n**Strength:** Observed\n\n_Generic icon: no specific icon for microsoft.contoso/widgets._\n\nA note written by the model.",
    );
    assert.equal(edge("e_front-door_web_0").annotation, "**Evidence:** F-0004\n\n**Strength:** Observed");
    assert.equal(edge("e_web_db_0").annotation, "**Evidence:** F-0006\n\n**Strength:** Inferred\n\n**Basis:** connection string name matches");
    assert.equal(diagram.groups[0].annotation, "**Evidence:** F-0001\n\nRegion read from the App Service row.");
    assert.equal(diagram.groups[1].annotation, "");
});

test("a node's strength is Observed when any cited fact is Observed, else Inferred", () => {
    const spec = readFixtureSpec();
    spec.nodes[1].evidence = ["F-0006", "F-0001"];
    spec.nodes[5].evidence = ["F-0010", "F-0009"];
    const { diagram } = build(spec);
    assert.match(diagram.nodes[1].annotation, /^\*\*Evidence:\*\* F-0006, F-0001\n\n\*\*Strength:\*\* Observed$/);
    assert.match(diagram.nodes[5].annotation, /\*\*Strength:\*\* Inferred/);
});

test("an unmapped type with a catalog match gets a closest icon, an explicit icon wins and a node without a type is generic", () => {
    const spec = readFixtureSpec();
    spec.nodes[2].armType = "microsoft.contoso/information";
    spec.nodes[3].icon = "azure:key-vaults";
    spec.nodes[4].armType = null;
    const { diagram, genericIcons, closestIcons } = build(spec);
    assert.equal(diagram.nodes[2].iconId, "azure:information");
    assert.match(diagram.nodes[2].annotation, /_Closest icon match: azure:information\._/);
    assert.equal(diagram.nodes[3].iconId, "azure:key-vaults");
    assert.doesNotMatch(diagram.nodes[3].annotation, /icon/);
    assert.equal(diagram.nodes[4].iconId, "azure:all-resources");
    assert.match(diagram.nodes[4].annotation, /_Generic icon: the node gives neither an ARM type nor an icon\._/);
    assert.deepEqual(closestIcons, ["orders-db"]);
    assert.deepEqual(genericIcons, ["kv-prod", "orders-queue"]);
});

test("the vendored layout puts every node inside its group, and the direction decides the axis", () => {
    const { NODE_W, NODE_H } = canvas.layout;
    const at = (diagram, id) => diagram.nodes.find((n) => n.id === id);
    const lr = build(readFixtureSpec()).diagram;
    for (const node of lr.nodes.filter((n) => n.group)) {
        const group = lr.groups.find((g) => g.id === node.group);
        assert.ok(
            node.x >= group.x && node.y >= group.y && node.x + NODE_W <= group.x + group.width && node.y + NODE_H <= group.y + group.height,
            `${node.label} sits inside ${group.label}`,
        );
    }
    assert.ok(at(lr, "n_front-door").x < at(lr, "n_web").x, "LR runs left to right");
    const tb = build({ ...readFixtureSpec(), direction: "TB" }).diagram;
    assert.ok(at(tb, "n_front-door").y < at(tb, "n_web").y, "TB runs top to bottom");
});

test("two builds of one spec are identical apart from updatedAt", () => {
    const a = build(readFixtureSpec()).diagram;
    const b = build(readFixtureSpec()).diagram;
    b.updatedAt = a.updatedAt;
    assert.deepEqual(a, b);
});

test("a non-default pattern pack adds the title suffix", () => {
    assert.equal(build(readFixtureSpec(), { resolution: { nonDefaultPack: true } }).diagram.title, "checkout · current state (westeurope) [NON-DEFAULT PATTERN PACK]");
    assert.equal(build(readFixtureSpec(), { resolution: { nonDefaultPack: false } }).diagram.title, "checkout · current state (westeurope)");
});

test("buildDiagram refuses an invalid spec with the validator's problems as details", () => {
    const spec = readFixtureSpec();
    spec.nodes[1].evidence = [];
    assert.throws(
        () => build(spec),
        (err) => err instanceof CliError && err.code === EXIT.INPUT && err.message === "the diagram spec is invalid"
            && err.details.length === 1 && err.details[0].startsWith("nodes[1].evidence: needs at least one F- fact"),
    );
});
