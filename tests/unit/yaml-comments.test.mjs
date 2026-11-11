import assert from "node:assert/strict";
import test from "node:test";
import { parseYaml } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";

test("a quote in the middle of a plain scalar is a literal character and does not hide a comment", () => {
    assert.deepEqual(parseYaml("note: he said 'hello # a comment"), { note: "he said 'hello" });
    assert.deepEqual(parseYaml('note: a "b # a comment'), { note: 'a "b' });
    assert.deepEqual(parseYaml("owner: the team's role # a comment"), { owner: "the team's role" });
    assert.deepEqual(parseYaml("items:\n  - rock 'n roll # a comment\n  - plain"), { items: ["rock 'n roll", "plain"] });
});

test("a quote where a scalar starts still protects a # inside it", () => {
    const text = [
        'key: "a # b" # a comment',
        "single: 'c # d' # a comment",
        "list:",
        "  - 'e # f' # a comment",
        '  - "g # h"',
        "flow: [ 'i # j', \"k # l\" ] # a comment",
        '"m # n": 1',
    ].join("\n");
    assert.deepEqual(parseYaml(text), { key: "a # b", single: "c # d", list: ["e # f", "g # h"], flow: ["i # j", "k # l"], "m # n": 1 });
});

test("a mapping entry after a dash keeps its quoted value", () => {
    assert.deepEqual(parseYaml("items:\n  - name: 'a # b' # a comment\n    other: c"), { items: [{ name: "a # b", other: "c" }] });
});

// Each value is written as "k: <value>" and must lose only the trailing comment, wherever its quotes close.
for (const [value, expected] of [
    ["join with ',' # c", "join with ','"],
    ['He said "stop," and left # c', 'He said "stop," and left'],
    ["the key is 'a:' # c", "the key is 'a:'"],
    ["he said 'hello # c", "he said 'hello"],
    ["rock 'n roll # c", "rock 'n roll"],
]) {
    test(`quotes inside a plain scalar never hide its comment: k: ${value}`, () => {
        assert.deepEqual(parseYaml(`k: ${value}`), { k: expected });
    });
}

test("a flow sequence keeps a quoted comma and a # inside a quoted item", () => {
    assert.deepEqual(parseYaml('k: [ "a, b", c ] # c'), { k: ["a, b", "c"] });
    assert.deepEqual(parseYaml("k: [ \"a, b\", 'c # d' ] # e"), { k: ["a, b", "c # d"] });
});

test("a quote after a leading dash and a space opens a quoted scalar", () => {
    assert.deepEqual(parseYaml("- 'a # b' # c"), ["a # b"]);
});

test("a quote right after a leading dash, with no space, is a literal character", () => {
    assert.deepEqual(parseYaml("-'a: 1 # c"), { "-'a": 1 });
});

test("a colon that is not followed by a space does not start a scalar", () => {
    assert.deepEqual(parseYaml("url: http://example.com/x#frag # c"), { url: "http://example.com/x#frag" });
    assert.deepEqual(parseYaml("k: a:'b # c"), { k: "a:'b" });
});
