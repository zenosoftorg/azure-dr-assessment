import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCanvasModules } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { sampleDiagram } from "../helpers/diagram-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const fetchIcons = path.join(root, "skills", "azure-dr-assessment", "scripts", "fetch-icons.mjs");
const builder = path.join(root, "skills", "architecture-presentation", "scripts", "build-presentation.mjs");
const skip = process.env.DR_ONLINE_TESTS === "1" ? false : "set DR_ONLINE_TESTS=1 to download the real icon set from Microsoft";
const env = { ARCH_CANVAS_ICON_ROOT: undefined, DR_ICON_MIRROR: undefined };

test("foundation acceptance: the real Azure icons download, index and inline into a presentation", { skip, timeout: 180_000 }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dr-online-"));
    const iconRoot = path.join(dir, "icons");

    const fetched = await runScript(fetchIcons, ["--root", iconRoot], { env });
    assert.equal(fetched.code, 0, fetched.stderr);
    assert.equal(fetched.json.sets[0].status, "fetched");
    assert.ok(fetched.json.iconFiles > 600, `iconFiles ${fetched.json.iconFiles}`);

    const canvas = await loadCanvasModules();
    const catalog = await canvas.icons.buildCatalog(iconRoot);
    assert.ok(catalog.size > 600, `catalog size ${catalog.size}`);
    for (const id of ["azure:front-door-and-cdn-profiles", "azure:app-services", "azure:sql-database", "azure:storage-accounts", "azure:all-resources"]) {
        assert.ok(catalog.get(id), id);
    }

    const diagram = path.join(dir, "d.arch.json");
    const story = path.join(dir, "d.story.mjs");
    writeFileSync(diagram, JSON.stringify(await sampleDiagram()));
    writeFileSync(story, 'export function buildStory() { return [{ chapter: "A", title: "t", all: true, md: "ok" }]; }\n');

    const built = await runScript(builder, [diagram, story, path.join(dir, "d.html"), "--icon-root", iconRoot, "--json"], { env });
    assert.equal(built.code, 0, built.stderr);
    assert.equal(built.json.icons, 4);
    assert.deepEqual(built.json.missingIcons, []);

    const refused = await runScript(builder, [diagram, story, path.join(dir, "refused.html"), "--icon-root", path.join(dir, "no-icons"), "--json"], { env });
    assert.equal(refused.code, 4);
    assert.equal(refused.json.reason, "zero-icons");
});
