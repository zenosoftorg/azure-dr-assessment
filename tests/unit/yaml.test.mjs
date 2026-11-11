import assert from "node:assert/strict";
import test from "node:test";
import { parseFrontMatter, parseYaml, stringifyYaml, YamlError } from "../../skills/azure-dr-assessment/scripts/lib/yaml.mjs";

test("plain scalars are typed: null, booleans, numbers, and everything else stays a string", () => {
    const value = parseYaml("a: null\nb: ~\nc:\nd: true\ne: false\nf: 12\ng: -3\nh: 1.5\ni: 2026-11-04\nj: 007\nk: yes\nl: 30m");
    assert.deepEqual(value, { a: null, b: null, c: null, d: true, e: false, f: 12, g: -3, h: 1.5, i: "2026-11-04", j: "007", k: "yes", l: "30m" });
});

test("quoted scalars keep their text and honor escapes", () => {
    const value = parseYaml("a: \"x: y # z\"\nb: 'it''s'\nc: \"line\\nbreak \\\"q\\\"\"\nd: \"\"");
    assert.deepEqual(value, { a: "x: y # z", b: "it's", c: "line\nbreak \"q\"", d: "" });
});

test("comments are removed outside quotes only", () => {
    const value = parseYaml("# header\na: 1 # trailing\nb: \"has # inside\"\nc: C#\n  # indented comment\nd: https://x.example/p#frag");
    assert.deepEqual(value, { a: 1, b: "has # inside", c: "C#", d: "https://x.example/p#frag" });
});

test("nested mappings and block sequences", () => {
    const value = parseYaml("outer:\n  inner:\n    deep: 1\n  list:\n    - a\n    - 2\n    - null\nafter: true");
    assert.deepEqual(value, { outer: { inner: { deep: 1 }, list: ["a", 2, null] }, after: true });
});

test("a sequence may sit at the same indentation as its key", () => {
    assert.deepEqual(parseYaml("items:\n- a\n- b\nnext: 1"), { items: ["a", "b"], next: 1 });
});

test("sequences of mappings, with the first key on the dash line", () => {
    const text = [
        "overrides:",
        "  - pattern: DR-DNS-001",
        "    slots: [traffic-dns, ingress]",
        "    justification: \"Internet-facing only: no on-prem DNS\"",
        "  - pattern: DR-X-001",
        "    slots:",
        "      - a",
        "      - b",
        "    note: ok",
    ].join("\n");
    assert.deepEqual(parseYaml(text), {
        overrides: [
            { pattern: "DR-DNS-001", slots: ["traffic-dns", "ingress"], justification: "Internet-facing only: no on-prem DNS" },
            { pattern: "DR-X-001", slots: ["a", "b"], note: "ok" },
        ],
    });
});

test("flow sequences hold scalars; empty flow collections are allowed", () => {
    assert.deepEqual(parseYaml("a: []\nb: {}\nc: [1, \"x, y\", 'z', true]"), { a: [], b: {}, c: [1, "x, y", "z", true] });
});

test("an empty document is null", () => {
    assert.equal(parseYaml("\n# only a comment\n"), null);
});

test("unsupported constructs are rejected with the line number", () => {
    const cases = [
        ["a:\n\tb: 1", 2, /tabs/],
        ["a: &anchor 1", 1, /anchors/],
        ["a: *alias", 1, /anchors/],
        ["a: !!str x", 1, /tags/],
        ["a: |\n  text", 1, /multi-line/],
        ["a: >\n  text", 1, /multi-line/],
        ["a: {b: 1}", 1, /flow mappings/],
        ["a: 1\nb: [x, [y]]", 2, /nested flow/],
        ["a: 1\n---\nb: 2", 2, /multiple documents/],
        ["a: 1\na: 2", 2, /duplicate key/],
        ["a:\n  b: 1\n    c: 2", 3, /indentation/],
        ["just text", 1, /key: value/],
        ["a: \"open", 1, /unterminated/],
    ];
    for (const [text, line, pattern] of cases) {
        assert.throws(() => parseYaml(text), (e) => e instanceof YamlError && e.line === line && pattern.test(e.message), text);
    }
});

test("stringifyYaml quotes only when needed and round-trips through parseYaml", () => {
    const sample = {
        schema: 1,
        name: "checkout",
        flag: true,
        nothing: null,
        ratio: 1.5,
        list: ["a", "b: c", "d # e", "true", "007", "", "30m", "2026-11-04", "https://x.example/p"],
        empty: [],
        emptyMap: {},
        nested: { inner: { deep: "x" } },
        items: [{ pattern: "DR-DNS-001", slots: ["traffic-dns", "ingress"], note: "has: colon" }, { pattern: "DR-X-001" }],
        "key with space": "v",
        "a:b": 1,
        "https://x.example/k": ["u"],
    };
    const text = stringifyYaml(sample);
    assert.deepEqual(parseYaml(text), sample);
    assert.match(text, /^name: checkout$/m);
    assert.match(text, /^"a:b": 1$/m);
    assert.match(text, /^"https:\/\/x\.example\/k":$/m);
    assert.match(text, /^ {2}- "b: c"$/m);
    assert.match(text, /^ {2}- 2026-11-04$/m);
    assert.match(text, /^ {2}- pattern: DR-DNS-001$/m);
    assert.match(text, /^ {4}slots:$/m);
});

test("stringifyYaml rejects values it cannot represent", () => {
    assert.throws(() => stringifyYaml({ a: () => 1 }), TypeError);
    assert.throws(() => stringifyYaml({ a: [[1]] }), TypeError);
    assert.throws(() => stringifyYaml({ a: Infinity }), TypeError);
});

test("parseFrontMatter splits the header from the body and reports file line numbers", () => {
    const md = "---\nid: DR-X-001\nslots: [a, b]\n---\n# Title\n\nBody\n";
    assert.deepEqual(parseFrontMatter(md), { data: { id: "DR-X-001", slots: ["a", "b"] }, body: "# Title\n\nBody\n", bodyStartLine: 5 });
    assert.equal(parseFrontMatter("# no front matter\n"), null);
    assert.throws(() => parseFrontMatter("---\nid: x\n\tbad: y\n---\n"), (e) => e instanceof YamlError && e.line === 3);
    assert.throws(() => parseFrontMatter("---\nid: x\n"), (e) => e instanceof YamlError && /not closed/.test(e.message));
});
