import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeFileAtomic } from "../../skills/azure-dr-assessment/scripts/lib/atomic.mjs";

const scripts = path.resolve(import.meta.dirname, "..", "..", "skills", "azure-dr-assessment", "scripts");

/** Every .mjs file below the scripts folder, as paths relative to it. */
function sources(dir = scripts) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sources(full);
        return entry.name.endsWith(".mjs") ? [path.relative(scripts, full).split(path.sep).join("/")] : [];
    });
}

// These fill a folder that is swapped in whole (extraction, the icon manifest) or copy a diagram that can be copied again.
const NOT_ATOMIC = ["lib/atomic.mjs", "lib/zip.mjs", "fetch-icons.mjs", "canvas-link.mjs"];
const WRITERS = ["lib/ledger.mjs", "lib/inventory.mjs", "ingest.mjs", "intake.mjs", "collect-live.mjs", "build-diagram.mjs", "report-tables.mjs", "resolve-patterns.mjs"];

test("writeFileAtomic replaces a file in one step and leaves no temporary file", async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "dr-atomic-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, "ledger.json");
    await writeFile(file, "old");
    const before = await stat(file);
    await writeFileAtomic(file, "new");
    assert.equal(await readFile(file, "utf8"), "new");
    assert.deepEqual(await readdir(dir), ["ledger.json"]);
    // a rename puts a new file in place; an overwrite in place would keep the old one
    if (process.platform !== "win32") assert.notEqual((await stat(file)).ino, before.ino);
});

test("writeFileAtomic keeps the target and removes its temporary file when the write cannot finish", async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "dr-atomic-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const target = path.join(dir, "target");
    await mkdir(target);
    await writeFile(path.join(target, "keep.txt"), "keep");
    await assert.rejects(writeFileAtomic(target, "x"));
    assert.deepEqual(await readdir(dir), ["target"]);
    assert.equal(await readFile(path.join(target, "keep.txt"), "utf8"), "keep");
});

test("every script that writes a file goes through writeFileAtomic, except the listed ones", () => {
    const bare = sources()
        .filter((file) => !NOT_ATOMIC.includes(file))
        .filter((file) => /\bwriteFile(Sync)?\(/.test(readFileSync(path.join(scripts, file), "utf8")));
    assert.deepEqual(bare, []);
    for (const file of WRITERS) assert.match(readFileSync(path.join(scripts, file), "utf8"), /writeFileAtomic\(/, file);
});
