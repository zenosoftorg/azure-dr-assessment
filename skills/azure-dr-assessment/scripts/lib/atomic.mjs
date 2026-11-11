import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Write a file so that a crash or a second reader never sees half of it: the text goes to a hidden
 * sibling file first and is renamed over the target. A failed write removes the sibling and leaves the
 * target as it was.
 */
export async function writeFileAtomic(file, data, encoding = "utf8") {
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
    try {
        await writeFile(temporary, data, encoding);
        await rename(temporary, file);
    } catch (err) {
        await rm(temporary, { force: true });
        throw err;
    }
}
