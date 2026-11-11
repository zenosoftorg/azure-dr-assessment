import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

export class ZipError extends Error {
    constructor(message) {
        super(message);
        this.name = "ZipError";
    }
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(buffer) {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** Read the central directory of a zip archive held in memory. Entries are inflated and verified on read. */
export function readZip(buffer) {
    if (!Buffer.isBuffer(buffer)) throw new ZipError("expected a Buffer");
    let eocd = -1;
    const floor = Math.max(0, buffer.length - 22 - 0xffff);
    for (let i = buffer.length - 22; i >= floor; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new ZipError("not a zip archive: no end-of-central-directory record");
    const count = buffer.readUInt16LE(eocd + 10);
    const centralOffset = buffer.readUInt32LE(eocd + 16);
    if (count === 0xffff || centralOffset === 0xffffffff) throw new ZipError("zip64 archives are not supported");

    const entries = new Map();
    let offset = centralOffset;
    for (let n = 0; n < count; n++) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new ZipError("corrupt central directory");
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
        const entry = {
            name,
            flags: buffer.readUInt16LE(offset + 8),
            method: buffer.readUInt16LE(offset + 10),
            crc: buffer.readUInt32LE(offset + 16),
            compressedSize: buffer.readUInt32LE(offset + 20),
            size: buffer.readUInt32LE(offset + 24),
            localOffset: buffer.readUInt32LE(offset + 42),
            isDirectory: name.endsWith("/"),
        };
        if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.localOffset === 0xffffffff) {
            throw new ZipError(`${JSON.stringify(name)} uses zip64, which is not supported`);
        }
        entries.set(name, entry);
        offset += 46 + nameLength + extraLength + commentLength;
    }

    const read = (name) => {
        const entry = entries.get(name);
        if (!entry) throw new ZipError(`no entry named ${name}`);
        if (entry.flags & 1) throw new ZipError(`${name} is encrypted`);
        const at = entry.localOffset;
        if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== 0x04034b50) throw new ZipError(`corrupt local header for ${name}`);
        const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
        const raw = buffer.subarray(start, start + entry.compressedSize);
        let data;
        if (entry.method === 0) {
            data = raw;
        } else if (entry.method === 8) {
            try {
                data = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) });
            } catch (err) {
                if (err.code === "ERR_BUFFER_TOO_LARGE") throw new ZipError(`${name} has the wrong size: inflated data exceeds the declared size`);
                throw new ZipError(`cannot inflate ${name}: ${err.message}`);
            }
        } else {
            throw new ZipError(`${name} uses unsupported compression method ${entry.method}`);
        }
        if (data.length !== entry.size) throw new ZipError(`${name} has the wrong size`);
        if (crc32(data) !== entry.crc) throw new ZipError(`${name} failed its CRC check`);
        return data;
    };

    return {
        entries: [...entries.values()].map(({ name, size, isDirectory }) => ({ name, size, isDirectory })),
        has: (name) => entries.has(name),
        read,
        text: (name) => (entries.has(name) ? read(name).toString("utf8") : null),
    };
}

function safeTarget(root, name) {
    // C0 controls, DEL and C1 controls
    if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) throw new ZipError(`unsafe path in archive: ${JSON.stringify(name)}`);
    const normalized = name.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
        throw new ZipError(`unsafe path in archive: ${name}`);
    }
    const target = path.join(root, ...normalized.split("/"));
    if (!target.startsWith(root + path.sep)) throw new ZipError(`unsafe path in archive: ${name}`);
    return { target, normalized };
}

/** What extractZip accepts by default. The icon archives hold a few thousand small SVG files. */
export const ZIP_LIMITS = Object.freeze({ maxEntries: 20_000, maxEntryBytes: 32 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });

/** A limit comes from the options only as a finite number of 0 or more; anything else keeps the default. */
const limitOrDefault = (value, fallback) => (Number.isFinite(value) && value >= 0 ? value : fallback);

/** Extract files below destDir. Every name and every declared size is checked before the first write. */
export async function extractZip(buffer, destDir, { filter, ...options } = {}) {
    const maxEntries = limitOrDefault(options.maxEntries, ZIP_LIMITS.maxEntries);
    const maxEntryBytes = limitOrDefault(options.maxEntryBytes, ZIP_LIMITS.maxEntryBytes);
    const maxTotalBytes = limitOrDefault(options.maxTotalBytes, ZIP_LIMITS.maxTotalBytes);
    const zip = readZip(buffer);
    const root = path.resolve(destDir);
    const wanted = zip.entries.filter((entry) => !entry.isDirectory && (!filter || filter(entry.name)));
    const plan = wanted.map((entry) => ({ name: entry.name, ...safeTarget(root, entry.name) }));
    if (wanted.length > maxEntries) throw new ZipError(`the archive holds ${wanted.length} files to extract, more than the limit of ${maxEntries}`);
    let declared = 0;
    for (const entry of wanted) {
        if (entry.size > maxEntryBytes) throw new ZipError(`${entry.name} is ${entry.size} bytes, more than the limit of ${maxEntryBytes} bytes per file`);
        declared += entry.size;
        if (declared > maxTotalBytes) throw new ZipError(`the files to extract add up to more than the limit of ${maxTotalBytes} bytes`);
    }
    const files = [];
    let bytes = 0;
    for (const item of plan) {
        const data = zip.read(item.name);
        await mkdir(path.dirname(item.target), { recursive: true });
        await writeFile(item.target, data);
        files.push(item.normalized);
        bytes += data.length;
    }
    return { files, bytes };
}
