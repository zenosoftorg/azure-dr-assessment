import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { makeFixtureLedger, readFixtureSpec } from "../helpers/diagram-ledger.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";
import { storyWorkspace } from "../helpers/story-fixture.mjs";

const repo = path.resolve(import.meta.dirname, "..", "..");
const scripts = path.join(repo, "skills", "azure-dr-assessment", "scripts");
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const options = { skip: (isRoot && "root can read a folder without permissions") || (process.platform === "win32" && "chmod does not restrict reads on Windows") };

/** An icon library whose Azure folder cannot be listed. The caller must call restore() so the temporary folder can be removed. */
function unreadableLibrary() {
    const library = makeIconRoot();
    const folder = path.join(library, "Azure_Public_Service_Icons_V24");
    chmodSync(folder, 0o000);
    return { library, restore: () => chmodSync(folder, 0o755) };
}

const noCrash = (r) => {
    assert.notEqual(r.code, 5, `the script must refuse, not crash: ${r.stderr}`);
    assert.ok(r.json, `stdout must be one JSON line: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr, /EPERM|EACCES|\n\s+at /, "no raw stack trace");
};

test("preflight reports an unreadable icon library as a failed icons check", options, async () => {
    const { library, restore } = unreadableLibrary();
    try {
        const r = await runScript(path.join(scripts, "preflight.mjs"), ["--icon-root", library, "--offline"], {
            env: { COPILOT_HOME: mkdtempSync(path.join(tmpdir(), "dr-ph-")), DR_NO_NETWORK: "1", DR_BROWSER: process.execPath },
        });
        noCrash(r);
        assert.equal(r.code, 0, "preflight never blocks, as for a missing library");
        const icons = r.json.checks.find((entry) => entry.id === "icons");
        assert.equal(icons.status, "missing");
        assert.match(icons.detail, /unreadable/);
        assert.match(r.json.nextActions.join("\n"), /fetch-icons\.mjs/);
        const strict = await runScript(path.join(scripts, "preflight.mjs"), ["--icon-root", library, "--offline", "--strict"], {
            env: { COPILOT_HOME: mkdtempSync(path.join(tmpdir(), "dr-ph-")), DR_NO_NETWORK: "1", DR_BROWSER: process.execPath },
        });
        noCrash(strict);
        assert.equal(strict.code, 3, "--strict exits 3 as for a missing library");
    } finally {
        restore();
    }
});

test("fetch-icons refuses with exit 3 and a reason when the library cannot be read", options, async () => {
    const { library, restore } = unreadableLibrary();
    try {
        const r = await runScript(path.join(scripts, "fetch-icons.mjs"), ["--root", library, "--dry-run"], { env: { ARCH_CANVAS_ICON_ROOT: undefined, DR_ICON_MIRROR: undefined } });
        noCrash(r);
        assert.equal(r.code, 3);
        assert.match(r.json.error, /unreadable/);
    } finally {
        restore();
    }
});

test("build-diagram with an unreadable icon library builds as for a missing one", options, async () => {
    const { library, restore } = unreadableLibrary();
    try {
        const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-unreadable-")));
        mkdirSync(path.join(cwd, "architectures"));
        writeFileSync(path.join(cwd, "architectures", "checkout-current-state.spec.json"), `${JSON.stringify(readFixtureSpec())}\n`);
        await makeFixtureLedger().save(path.join(cwd, "evidence", "ledger.json"));
        const r = await runScript(
            path.join(scripts, "build-diagram.mjs"),
            ["--spec", "architectures/checkout-current-state.spec.json", "--ledger", "evidence/ledger.json", "--icon-root", library],
            { cwd },
        );
        noCrash(r);
        assert.ok([0, 3, 4].includes(r.code), `documented exit code, got ${r.code}`);
    } finally {
        restore();
    }
});

test("present with an unreadable icon library refuses with exit 4 and zero-icons", options, async () => {
    const { library, restore } = unreadableLibrary();
    try {
        const w = storyWorkspace();
        const r = await runScript(path.join(scripts, "present.mjs"), ["--story", path.join("presentations", "checkout-current-state.story.mjs"), "--icon-root", library], { cwd: w.cwd });
        noCrash(r);
        assert.equal(r.code, 4);
        assert.equal(r.json.reason, "zero-icons");
    } finally {
        restore();
    }
});
