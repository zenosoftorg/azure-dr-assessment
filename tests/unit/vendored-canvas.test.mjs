import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCanvasModules } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const canvas = path.join(root, "extensions", "architecture-canvas");

function walk(dir, base = dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join("/")];
    });
}

test("the vendored canvas code is byte-identical to the fingerprinted source", () => {
    const expected = new Map(
        readFileSync(path.join(root, "tests", "fixtures", "vendored-canvas.sha256"), "utf8")
            .trim()
            .split("\n")
            .map((line) => {
                const [hash, file] = line.split(/\s{2}/);
                return [file, hash];
            }),
    );
    assert.deepEqual(walk(canvas).sort(), [...expected.keys()].sort());
    for (const [file, hash] of expected) {
        const actual = createHash("sha256").update(readFileSync(path.join(canvas, file))).digest("hex");
        assert.equal(actual, hash, `${file} changed; vendored canvas code changes only through a numbered NOTICE.md entry and a new fingerprint`);
    }
});

test("no icon files are vendored", () => {
    assert.ok(!walk(canvas).some((file) => file.toLowerCase().endsWith(".svg")));
});

test("the library modules load in plain Node and lay out a diagram deterministically", async () => {
    const { store, icons, layout } = await loadCanvasModules(canvas);
    const raw = {
        nodes: [
            { id: "n1", iconId: "azure:app-services", label: "web", group: "g1" },
            { id: "n2", iconId: "azure:sql-database", label: "db", group: "g1" },
            { id: "n3", iconId: "azure:front-door-and-cdn-profiles", label: "fd" },
        ],
        groups: [{ id: "g1", label: "Primary" }],
        edges: [{ id: "e1", from: "n3", to: "n1" }, { id: "e2", from: "n1", to: "n2" }, { id: "e3", from: "n1", to: "ghost" }],
    };
    const a = layout.autoLayout(store.normalizeDiagram(raw), { direction: "LR" });
    const b = layout.autoLayout(store.normalizeDiagram(raw), { direction: "LR" });
    assert.deepEqual(a, { ...b, updatedAt: a.updatedAt });
    assert.equal(a.edges.length, 2, "normalizeDiagram drops an edge whose endpoint does not exist");
    assert.ok(a.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
    assert.equal((await icons.buildCatalog(null)).size, 0);
});

test("NOTICE.md records the vendored canvas extension", () => {
    assert.match(readFileSync(path.join(root, "NOTICE.md"), "utf8"), /## Vendored: architecture-canvas extension/);
});

test("the diagram store lists a missing folder as empty and creates nothing; the first save creates it (NOTICE P-8)", async () => {
    const { store } = await loadCanvasModules(canvas);
    const base = mkdtempSync(path.join(tmpdir(), "dr-canvas-"));
    try {
        const dir = path.join(base, "architectures");
        const diagrams = new store.DiagramStore(dir);
        assert.deepEqual(await diagrams.list(), []);
        assert.equal((await diagrams.load("none")).nodes.length, 0);
        assert.equal(existsSync(dir), false, "listing and loading must not create the folder");
        await diagrams.save("first", store.emptyDiagram("First"));
        assert.equal(existsSync(path.join(dir, "first.arch.json")), true);
        assert.equal((await diagrams.list()).length, 1);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test("extension.mjs does not create the diagram folder at start-up (NOTICE P-8)", () => {
    const source = readFileSync(path.join(canvas, "extension.mjs"), "utf8");
    assert.doesNotMatch(source, /ensureDir\(/);
});

test("NOTICE.md records P-8, the lazy diagram folder", () => {
    assert.match(readFileSync(path.join(root, "NOTICE.md"), "utf8"), /P-8/);
});
