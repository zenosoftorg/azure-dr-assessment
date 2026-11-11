import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sampleDiagram } from "../helpers/diagram-fixture.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";
import { runScript } from "../helpers/run-cli.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const builder = path.join(root, "skills", "architecture-presentation", "scripts", "build-presentation.mjs");

// A link address that holds a double quote, followed by what reads like an attribute of the link.
const HOSTILE = 'https://learn.microsoft.com/a"onmouseover="location=name';
const STORY = `
export const cover = { kicker: "Story", title: "Checkout", blurb: "A scratch story" };
export function buildStory() {
    return [{ chapter: "Overture", title: "Everything", all: true, md: ${JSON.stringify(`See [docs](${HOSTILE}).`)} }];
}
`;

let renderer = null;
/** The markdown renderer of a built presentation: the `md` function that the page runs, taken from the page itself. */
function pageMarkdown() {
    renderer ??= (async () => {
        const dir = mkdtempSync(path.join(tmpdir(), "dr-markdown-"));
        const diagram = path.join(dir, "d.arch.json");
        const story = path.join(dir, "d.story.mjs");
        const out = path.join(dir, "d.html");
        writeFileSync(diagram, JSON.stringify(await sampleDiagram()));
        writeFileSync(story, STORY);
        const built = await runScript(builder, [diagram, story, out, "--icon-root", makeIconRoot(), "--json"]);
        assert.equal(built.code, 0, built.stderr);
        const source = /^function md\(src\) \{\n[\s\S]*?\n\}$/m.exec(readFileSync(out, "utf8"));
        assert.ok(source, "the page holds the markdown renderer");
        return new Function(`${source[0]}\nreturn md;`)();
    })();
    return renderer;
}

test("a double quote in a link address stays inside the href and adds no attribute to the link", async () => {
    const md = await pageMarkdown();
    const html = md(`See [docs](${HOSTILE}).`);
    assert.equal(html.match(/<a /g).length, 1, html);
    const tag = /<a ([^>]*)>/.exec(html)[1];
    const names = [...tag.matchAll(/([a-z-]+)="[^"]*"/g)].map((match) => match[1]);
    assert.deepEqual(names, ["href", "target", "rel"], html);
    assert.equal(/href="([^"]*)"/.exec(tag)[1].replaceAll("&quot;", '"'), HOSTILE, "the link still points where the writer said");
});

test("quotes in text and in table cells are text, and an ordinary link is unchanged", async () => {
    const md = await pageMarkdown();
    assert.equal(md('He said "stop".'), "<p>He said &quot;stop&quot;.</p>");
    assert.match(md('| A | B |\n|---|---|\n| "q" | x |'), /<td>&quot;q&quot;<\/td>/);
    assert.equal(
        md("[docs](https://learn.microsoft.com/azure?a=1&b=2)"),
        '<p><a href="https://learn.microsoft.com/azure?a=1&amp;b=2" target="_blank" rel="noreferrer noopener">docs</a></p>',
    );
});
