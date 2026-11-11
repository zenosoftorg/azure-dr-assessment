import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseYaml } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const scriptsDir = path.join(root, "skills", "azure-dr-assessment", "scripts");
const SCRIPTS = [
    "build-diagram", "canvas-link", "check-presentation", "collect-live", "dr-options", "establishment-guide", "fetch-icons", "ingest", "intake", "ledger", "lint-patterns", "lint-playbooks",
    "preflight", "present", "region-services", "report-tables", "resolve-patterns", "resources",
];

/** The files that Git tracks, or null when this is not a Git checkout (a plugin install has no .git folder). */
function trackedFiles() {
    try {
        return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
    } catch {
        return null;
    }
}
const tracked = trackedFiles();

test("the scripts folder holds exactly the eighteen scripts of the skill, and each one answers --help", async () => {
    const found = readdirSync(scriptsDir).filter((name) => name.endsWith(".mjs")).map((name) => name.slice(0, -4)).sort();
    assert.deepEqual(found, SCRIPTS);
    for (const name of SCRIPTS) {
        const result = await runScript(path.join(scriptsDir, `${name}.mjs`), ["--help"]);
        assert.equal(result.code, 0, `${name} --help exits 0`);
        assert.match(result.stdout, new RegExp(`^${name}: `), `${name} --help starts with its description`);
    }
});

test("Git tracks no icons, workbooks, customer output or environment files", { skip: tracked === null && "not a Git checkout" }, () => {
    const forbidden = [
        [/(^|\/)Final SVG Icons\//, "the icon cache"],
        [/\.svg$/i, "an icon or image file"],
        [/\.xlsx?$/i, "a workbook"],
        [/^dr-assessment\//, "assessment output"],
        [/(^|\/)\.env(\.|$)/, "an environment file"],
    ];
    const offenders = tracked.flatMap((file) => forbidden.filter(([pattern]) => pattern.test(file)).map(([, what]) => `${file}: ${what}`));
    assert.deepEqual(offenders, []);
});

// The guard below is built from parts and digests, so that this file passes its own check and names no customer.
const part = (...parts) => parts.join("");
const SECRET_SHAPES = [
    ["an authorization header", new RegExp(part("author", "ization\\s*:"), "i")],
    ["a bearer-scheme token", new RegExp(part("bear", "er\\s+\\S{8,}"), "i")],
    ["a pass word setting", new RegExp(part("pass", "word\\s*[=:]"), "i")],
    ["a pwd setting", new RegExp(part("p", "wd\\s*="), "i")],
    ["a user id setting", new RegExp(part("user", " id\\s*="), "i")],
    ["an admin pass word property", new RegExp(part("admin", "pass", "word"), "i")],
    ["an admin login pass word property", new RegExp(part("administratorlogin", "pass", "word"), "i")],
    ["a well-known default pass word", new RegExp(part("p@", "ssw"), "i")],
    ["a storage account key", new RegExp(part("account", "key="), "i")],
    ["a shared access key", new RegExp(part("shared", "access", "key="), "i")],
    ["a shared access signature", new RegExp(part("shared", "access", "signature="), "i")],
    ["a SAS signature", new RegExp(part("si", "g=\\S{10,}"), "i")],
    ["a PEM armor line", new RegExp(part("-{5}", "BEG", "IN"), "i")],
    ["a JSON web token", new RegExp(part("ey", "J[A-Za-z0-9_-]{10,}\\."))],
    ["a personal macOS path", new RegExp(part("/", "Users", "/"))],
    ["a macOS temp path", new RegExp(part("/", "var", "/", "folders", "/"))],
];
// SHA-256 digests of the denied words (customer and person names), lower case. Add one with:
// node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1].toLowerCase()).digest("hex"))' <word>
const DENIED_WORDS = new Set([
    "bacb3bbbe8a43e9c99f0c00a7e43ae48c00718337f2d9efa2c3bae1387d51407",
    "811dae26155c1f96fa4be679ba416b5b956c4eb73dc831d69f61692507e30595",
    "e37ca8e8a909c5de94f76ff677d14cd89b6a2566f1ee5183ffafbd2db256f44f",
    "a65ae650eb58ec787b713930485c82b960a9f936735b3965456f5b86ef8c3d32",
]);

/** The words of a text, lower case: camelCase and snake_case are split, and a hyphenated word counts whole and in parts. */
function wordsOf(text) {
    const words = new Set();
    for (const word of text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
        words.add(word);
        for (const piece of word.split("-")) words.add(piece);
    }
    return words;
}

test("no tracked file holds a secret shape, a denied name or a personal path, fake or real", { skip: tracked === null && "not a Git checkout" }, () => {
    const digest = (word) => createHash("sha256").update(word).digest("hex");
    const offenders = [];
    for (const file of tracked) {
        const full = path.join(root, file);
        if (!existsSync(full)) continue;
        const text = readFileSync(full, "utf8");
        text.split("\n").forEach((line, i) => {
            for (const [what, pattern] of SECRET_SHAPES) if (pattern.test(line)) offenders.push(`${file}:${i + 1}: ${what}`);
        });
        if ([...wordsOf(text)].some((word) => DENIED_WORDS.has(digest(word)))) offenders.push(`${file}: a denied name`);
    }
    assert.deepEqual(offenders, []);
});

test("the public-tree guard catches each shape and each denied word, and leaves ordinary text alone", () => {
    const flagged = (line) => SECRET_SHAPES.filter(([, pattern]) => pattern.test(line)).map(([what]) => what);
    const samples = [
        [part("Author", "ization: x"), "an authorization header"],
        [part("Bear", "er abcdefgh12"), "a bearer-scheme token"],
        [part("Server=a;", "Pass", "word=x"), "a pass word setting"],
        [part("P", "wd=x"), "a pwd setting"],
        [part("User", " Id=a"), "a user id setting"],
        [part("{ admin", "Pass", "word }"), "an admin pass word property"],
        [part("P@", "ssw0rd"), "a well-known default pass word"],
        [part("Account", "Key=abc"), "a storage account key"],
        [part("Shared", "Access", "Key=abc"), "a shared access key"],
        [part("?", "si", "g=0123456789ab"), "a SAS signature"],
        [part("-----", "BEG", "IN CERTIFICATE"), "a PEM armor line"],
        [part("ey", "J0123456789ab.x"), "a JSON web token"],
        [part("/", "Users", "/someone/x"), "a personal macOS path"],
        [part("/", "var/folders", "/ab/x"), "a macOS temp path"],
    ];
    for (const [line, what] of samples) assert.ok(flagged(line).includes(what), what);
    for (const line of ["Microsoft Entra Authorization", "Admin Username", "a short sig=abc", "a Bearer word", "storage account keys", "/usr/local/bin"]) {
        assert.deepEqual(flagged(line), [], line);
    }
    const digest = (word) => createHash("sha256").update(word).digest("hex");
    const standIn = new Set([digest("fakeword")]);
    const hits = (text) => [...wordsOf(text)].filter((word) => standIn.has(digest(word)));
    for (const text of ["the inFakewordFile", "a FAKEWORD_TEST", "tier-fakeword-diff", "Fakeword."]) assert.deepEqual(hits(text), ["fakeword"], text);
    assert.deepEqual(hits("fakewords and unfakeword"), []);
    assert.equal(DENIED_WORDS.size, 4);
    assert.equal([...wordsOf("landing zone tier file, company tier framework")].some((word) => DENIED_WORDS.has(digest(word))), false);
});

test("CI runs the pattern lint, the playbook lint and the tests on every Node version in the matrix, from the engines floor up", () => {
    const workflow = parseYaml(read(".github/workflows/ci.yml"));
    const pkg = JSON.parse(read("package.json"));
    const job = workflow.jobs.test;
    const floor = Number(/>=(\d+)/.exec(pkg.engines.node)[1]);
    assert.equal(Math.min(...job.strategy.matrix.node), floor, "the matrix starts at the engines floor");
    assert.deepEqual(job.strategy.matrix.node, [22, 24]);
    assert.equal(job.steps.find((step) => step.uses?.startsWith("actions/setup-node@")).with["node-version"], "${{ matrix.node }}");
    const commands = job.steps.filter((step) => step.run).map((step) => step.run);
    assert.deepEqual(commands, ["npm run lint:patterns", "npm run lint:playbooks", "npm test"]);
    for (const command of commands) {
        const script = /^npm (?:run )?(\S+)$/.exec(command)[1];
        assert.ok(pkg.scripts[script], `package.json defines ${script}`);
    }
    assert.equal(job.env.DR_BROWSER_FLAGS, "--no-sandbox", "the sandbox is unavailable on the runner");
    assert.deepEqual(workflow.permissions, { contents: "read" });
});

test("the scheduled workflow runs the tests that need the network, and those files exist", () => {
    const workflow = parseYaml(read(".github/workflows/online.yml"));
    const job = workflow.jobs.online;
    assert.equal(job.env.DR_ONLINE_TESTS, "1");
    assert.ok(Object.keys(workflow.on).includes("schedule") && Object.keys(workflow.on).includes("workflow_dispatch"));
    const files = job.steps.find((step) => step.run?.startsWith("node --test")).run.split(" ").filter((part) => part.endsWith(".test.mjs"));
    assert.deepEqual(files, ["tests/e2e/foundation-online.test.mjs", "tests/e2e/learn-map-online.test.mjs", "tests/e2e/playbooks-online.test.mjs"]);
    for (const file of files) assert.ok(existsSync(path.join(root, file)), file);
});

test("CODEOWNERS puts the pattern pack and the repository controls under an owner", () => {
    const rules = read(".github/CODEOWNERS").split("\n").filter((line) => line.trim() && !line.startsWith("#")).map((line) => line.trim().split(/\s+/));
    assert.deepEqual(rules, [["/skills/azure-dr-assessment/patterns/", "@Zenocolo"], ["/.github/", "@Zenocolo"]]);
});

test(".gitattributes checks files out with LF endings, because tests match \\n in the documents", () => {
    const rules = read(".gitattributes").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    assert.ok(rules.includes("* text=auto eol=lf"), rules.join("\n"));
    if (tracked === null) return;
    const files = ["README.md", "skills/azure-dr-assessment/patterns/DR-TIER-001.md"];
    const attributes = execFileSync("git", ["check-attr", "text", "eol", "--", ...files], { cwd: root, encoding: "utf8" }).trim().split("\n").sort();
    assert.deepEqual(attributes, files.flatMap((file) => [`${file}: eol: lf`, `${file}: text: auto`]).sort());
});
