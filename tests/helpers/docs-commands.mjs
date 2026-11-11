import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const COMMAND = /node\s+skills\/azure-dr-assessment\/scripts\/([a-z][a-z-]*)\.mjs([^\n`]*)/g;
const FLAG = /(?:^|\s)(--[a-z][a-z-]*)/g;

/** Every documented script command with its flags. A backslash at the end of a line continues the command. */
export function commandsIn(markdown) {
    const found = [];
    // A command that continues over several lines is reported at the line it starts on.
    const lines = markdown.split("\n");
    for (let i = 0; i < lines.length; i++) {
        let text = lines[i];
        const start = i;
        while (/\\\s*$/.test(text) && i + 1 < lines.length) {
            i += 1;
            text = `${text.replace(/\\\s*$/, " ")}${lines[i].trim()}`;
        }
        for (const match of text.matchAll(COMMAND)) {
            found.push({ script: match[1], flags: [...match[2].matchAll(FLAG)].map((flag) => flag[1]), line: start + 1 });
        }
    }
    return found;
}

const helpCache = new Map();

/** The flags a script prints in its --help text, or null when the script does not exist. */
export function helpFlags(scriptsDir, name) {
    const file = path.join(scriptsDir, `${name}.mjs`);
    if (!existsSync(file)) return null;
    if (!helpCache.has(file)) {
        const run = spawnSync(process.execPath, [file, "--help"], { encoding: "utf8" });
        helpCache.set(file, new Set([...run.stdout.matchAll(/--[a-z][a-z-]*/g)].map((match) => match[0])));
    }
    return helpCache.get(file);
}

/** Existing markdown files: a file is kept, a folder is searched recursively, a missing path is skipped. */
export function markdownFilesUnder(paths) {
    const files = [];
    const visit = (target) => {
        if (!existsSync(target)) return;
        if (statSync(target).isDirectory()) {
            for (const entry of readdirSync(target).sort()) visit(path.join(target, entry));
        } else if (target.endsWith(".md")) {
            files.push(target);
        }
    };
    paths.forEach(visit);
    return files;
}

/** One problem per documented command that names a missing script or a flag the script does not list. */
export function checkDocs(files, scriptsDir) {
    const problems = [];
    for (const file of files) {
        for (const command of commandsIn(readFileSync(file, "utf8"))) {
            const flags = helpFlags(scriptsDir, command.script);
            if (flags === null) {
                problems.push(`${file}:${command.line}: ${command.script}.mjs does not exist`);
                continue;
            }
            for (const flag of command.flags) {
                if (!flags.has(flag)) problems.push(`${file}:${command.line}: ${command.script}.mjs has no flag ${flag}`);
            }
        }
    }
    return problems;
}
