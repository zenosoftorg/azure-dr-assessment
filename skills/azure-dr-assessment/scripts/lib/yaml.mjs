// A YAML subset, not a general YAML implementation (contracts section 4.7).
// Supported: block mappings and sequences, single-line flow sequences of scalars,
// plain / single-quoted / double-quoted scalars, # comments. Everything else is
// rejected with the line number so a mistake never turns into silent data loss.

export class YamlError extends Error {
    constructor(message, line) {
        super(`line ${line}: ${message}`);
        this.name = "YamlError";
        this.line = line;
    }
}

/** Remove a trailing comment: a # at the start of a token, outside quotes. */
function stripComment(text) {
    let quote = null;
    let flow = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (quote === '"' && c === "\\") {
                i++;
            } else if (c === quote) {
                if (quote === "'" && text[i + 1] === "'") i++;
                else quote = null;
            }
        } else if (c === '"' || c === "'") {
            if (startsScalar(text, i, flow)) quote = c;
        } else if (c === "[" && !flow && startsScalar(text, i, false)) {
            flow = true;
        } else if (c === "]") {
            flow = false;
        } else if (c === "#" && (i === 0 || text[i - 1] === " ")) {
            return text.slice(0, i).trimEnd();
        }
    }
    return text.trimEnd();
}

/** A quote opens a quoted scalar only where a scalar starts: at the line start, after a key's colon and a space, after a leading "-" and a space, or after "[" or "," inside a flow sequence. */
function startsScalar(text, i, flow) {
    let j = i - 1;
    while (j >= 0 && text[j] === " ") j--;
    if (j < 0) return true;
    if (text[j] === ":") return i - j > 1;
    if (flow && (text[j] === "[" || text[j] === ",")) return true;
    return text[j] === "-" && i - j > 1 && text.slice(0, j).trim() === "";
}

const ESCAPES = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", 0: "\0" };

/** Read a quoted scalar starting at `start`. Returns the value and the index after the closing quote. */
function readQuoted(text, start, no) {
    const quote = text[start];
    let value = "";
    for (let i = start + 1; i < text.length; i++) {
        const c = text[i];
        if (quote === "'") {
            if (c === "'") {
                if (text[i + 1] === "'") {
                    value += "'";
                    i++;
                    continue;
                }
                return { value, end: i + 1 };
            }
            value += c;
        } else {
            if (c === "\\") {
                const next = text[++i];
                if (!(next in ESCAPES)) throw new YamlError(`unsupported escape \\${next}`, no);
                value += ESCAPES[next];
                continue;
            }
            if (c === '"') return { value, end: i + 1 };
            value += c;
        }
    }
    throw new YamlError("unterminated quoted string", no);
}

function plainScalar(text) {
    if (text === "" || text === "null" || text === "~") return null;
    if (text === "true") return true;
    if (text === "false") return false;
    if (/^-?(0|[1-9]\d*)$/.test(text)) {
        const n = Number(text);
        return Number.isSafeInteger(n) ? n : text;
    }
    if (/^-?(0|[1-9]\d*)\.\d+$/.test(text)) return Number(text);
    return text;
}

function parseFlowSequence(text, no) {
    if (!text.endsWith("]")) throw new YamlError("flow sequences must close on the same line", no);
    const inner = text.slice(1, -1).trim();
    if (inner === "") return [];
    const items = [];
    let i = 0;
    while (i < inner.length) {
        while (inner[i] === " ") i++;
        let item;
        if (inner[i] === '"' || inner[i] === "'") {
            const quoted = readQuoted(inner, i, no);
            item = quoted.value;
            i = quoted.end;
            while (inner[i] === " ") i++;
        } else {
            let j = i;
            while (j < inner.length && inner[j] !== ",") j++;
            const raw = inner.slice(i, j).trim();
            if (raw.startsWith("[") || raw.startsWith("{")) throw new YamlError("nested flow collections are not supported", no);
            item = plainScalar(raw);
            i = j;
        }
        items.push(item);
        if (i < inner.length) {
            if (inner[i] !== ",") throw new YamlError("expected ',' in the flow sequence", no);
            i++;
            if (inner.slice(i).trim() === "") break;
        }
    }
    return items;
}

function parseInline(text, no) {
    const first = text[0];
    if (first === "|" || first === ">") throw new YamlError("multi-line scalars are not supported", no);
    if (first === "&" || first === "*") throw new YamlError("anchors and aliases are not supported", no);
    if (first === "!") throw new YamlError("tags are not supported", no);
    if (first === "{") {
        if (text.replace(/\s/g, "") === "{}") return {};
        throw new YamlError("flow mappings with content are not supported", no);
    }
    if (first === "[") return parseFlowSequence(text, no);
    if (first === '"' || first === "'") {
        const quoted = readQuoted(text, 0, no);
        if (text.slice(quoted.end).trim() !== "") throw new YamlError("unexpected text after the quoted string", no);
        return quoted.value;
    }
    return plainScalar(text);
}

const isSeqItem = (text) => text === "-" || text.startsWith("- ");

/** Split "key: rest". Keys are plain or quoted; a plain key cannot contain ':'. */
function splitEntry(text, no) {
    if (text[0] === '"' || text[0] === "'") {
        const quoted = readQuoted(text, 0, no);
        const after = text.slice(quoted.end).trimStart();
        if (!after.startsWith(":")) throw new YamlError("expected ':' after the key", no);
        const rest = after.slice(1);
        if (rest !== "" && !rest.startsWith(" ")) throw new YamlError("expected a space after ':'", no);
        return { key: quoted.value, rest: rest.trim() };
    }
    const match = /^([^:\s][^:]*?)\s*:(?:\s+(.*)|$)/.exec(text);
    if (!match) throw new YamlError("expected 'key: value'", no);
    return { key: match[1], rest: (match[2] ?? "").trim() };
}

function looksLikeMappingEntry(text) {
    if (text[0] === '"' || text[0] === "'") {
        try {
            const quoted = readQuoted(text, 0, 0);
            return text.slice(quoted.end).trimStart().startsWith(":");
        } catch {
            return false;
        }
    }
    if (text[0] === "[" || text[0] === "{") return false;
    return /^[^:\s][^:]*?\s*:(?:\s|$)/.test(text);
}

function parseBlock(ctx, indent) {
    return isSeqItem(ctx.lines[ctx.pos].text) ? parseSequence(ctx, indent) : parseMapping(ctx, indent);
}

function parseSequence(ctx, indent) {
    const out = [];
    while (ctx.pos < ctx.lines.length) {
        const line = ctx.lines[ctx.pos];
        if (line.indent < indent) break;
        if (line.indent > indent) throw new YamlError("bad indentation of a sequence item", line.no);
        if (!isSeqItem(line.text)) break;
        const rest = line.text === "-" ? "" : line.text.slice(2).trimStart();
        if (rest === "") {
            ctx.pos++;
            const next = ctx.lines[ctx.pos];
            out.push(next && next.indent > indent ? parseBlock(ctx, next.indent) : null);
        } else if (looksLikeMappingEntry(rest)) {
            // "- key: value": the mapping continues on the lines indented to the key's column.
            const column = indent + (line.text.length - rest.length);
            ctx.lines[ctx.pos] = { no: line.no, indent: column, text: rest };
            out.push(parseMapping(ctx, column));
        } else {
            ctx.pos++;
            out.push(parseInline(rest, line.no));
        }
    }
    return out;
}

function parseMapping(ctx, indent) {
    const out = {};
    while (ctx.pos < ctx.lines.length) {
        const line = ctx.lines[ctx.pos];
        if (line.indent < indent) break;
        if (line.indent > indent) throw new YamlError("bad indentation of a mapping entry", line.no);
        if (isSeqItem(line.text)) break;
        const entry = splitEntry(line.text, line.no);
        if (Object.hasOwn(out, entry.key)) throw new YamlError(`duplicate key "${entry.key}"`, line.no);
        ctx.pos++;
        if (entry.rest === "") {
            const next = ctx.lines[ctx.pos];
            if (next && next.indent > indent) out[entry.key] = parseBlock(ctx, next.indent);
            else if (next && next.indent === indent && isSeqItem(next.text)) out[entry.key] = parseSequence(ctx, indent);
            else out[entry.key] = null;
        } else {
            out[entry.key] = parseInline(entry.rest, line.no);
        }
    }
    return out;
}

export function parseYaml(text, opts = {}) {
    const offset = opts.lineOffset ?? 0;
    const lines = [];
    String(text).split(/\r?\n/).forEach((raw, index) => {
        const no = index + 1 + offset;
        if (/^ *\t/.test(raw)) throw new YamlError("tabs are not allowed for indentation", no);
        const stripped = stripComment(raw);
        if (stripped.trim() === "") return;
        const content = stripped.trim();
        if (content === "---" || content === "...") throw new YamlError("multiple documents are not supported", no);
        lines.push({ no, indent: stripped.length - stripped.trimStart().length, text: content });
    });
    if (lines.length === 0) return null;
    const ctx = { lines, pos: 0 };
    const value = parseBlock(ctx, lines[0].indent);
    if (ctx.pos < lines.length) throw new YamlError("unexpected content (check the indentation)", lines[ctx.pos].no);
    return value;
}

// ------------------------------------------------------------------ writer

function needsQuotes(text) {
    if (text === "" || text !== text.trim()) return true;
    if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return true;
    if (/: |:$| #|[\n\r\t\0]/.test(text)) return true;
    if (text === "null" || text === "~" || text === "true" || text === "false") return true;
    return /^-?\d+(\.\d+)?$/.test(text);
}

function quote(text) {
    const escaped = text
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t")
        .replace(/\0/g, "\\0");
    return `"${escaped}"`;
}

function scalarText(value) {
    if (value === null || value === undefined) return "null";
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError("cannot write a non-finite number as YAML");
        return String(value);
    }
    if (typeof value === "string") return needsQuotes(value) ? quote(value) : value;
    throw new TypeError(`cannot write a ${typeof value} as YAML`);
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function renderMapping(object, indent, out) {
    const pad = " ".repeat(indent);
    for (const [key, value] of Object.entries(object)) {
        if (value === undefined) continue;
        const k = needsQuotes(key) || key.includes(":") ? quote(key) : key; // the parser does not accept ':' in a plain key
        if (isPlainObject(value)) {
            if (Object.keys(value).length === 0) {
                out.push(`${pad}${k}: {}`);
            } else {
                out.push(`${pad}${k}:`);
                renderMapping(value, indent + 2, out);
            }
        } else if (Array.isArray(value)) {
            if (value.length === 0) {
                out.push(`${pad}${k}: []`);
            } else {
                out.push(`${pad}${k}:`);
                renderSequence(value, indent + 2, out);
            }
        } else {
            out.push(`${pad}${k}: ${scalarText(value)}`);
        }
    }
}

function renderSequence(items, indent, out) {
    const pad = " ".repeat(indent);
    for (const item of items) {
        if (isPlainObject(item)) {
            const entries = Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
            if (Object.keys(entries).length === 0) {
                out.push(`${pad}- {}`);
                continue;
            }
            const sub = [];
            renderMapping(entries, indent + 2, sub);
            out.push(`${pad}- ${sub[0].trimStart()}`, ...sub.slice(1));
        } else if (Array.isArray(item)) {
            throw new TypeError("nested sequences are not supported");
        } else {
            out.push(`${pad}- ${scalarText(item)}`);
        }
    }
}

export function stringifyYaml(value) {
    const out = [];
    if (isPlainObject(value)) renderMapping(value, 0, out);
    else if (Array.isArray(value)) renderSequence(value, 0, out);
    else out.push(scalarText(value));
    return `${out.join("\n")}\n`;
}

/** Split a markdown file into its YAML front matter and body. Null when there is no leading --- block. */
export function parseFrontMatter(markdown) {
    const lines = String(markdown).replace(/^\uFEFF/, "").split(/\r?\n/);
    if (lines[0].trim() !== "---") return null;
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    if (end < 0) throw new YamlError("front matter is not closed with ---", 1);
    const data = parseYaml(lines.slice(1, end).join("\n"), { lineOffset: 1 });
    return { data, body: lines.slice(end + 1).join("\n"), bodyStartLine: end + 2 };
}
