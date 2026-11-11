import { spawn } from "node:child_process";

/** Run a script with the current Node and capture the exit code, output and parsed JSON. */
export function runScript(scriptPath, args = [], { env = {}, cwd = process.cwd() } = {}) {
    return new Promise((resolve, reject) => {
        const merged = { ...process.env, ...env };
        for (const [key, value] of Object.entries(merged)) {
            if (value === undefined) delete merged[key];
        }
        const child = spawn(process.execPath, [scriptPath, ...args], { cwd, env: merged, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", reject);
        child.on("close", (code) => {
            let json = null;
            try {
                json = JSON.parse(stdout);
            } catch {
                // help text or a crash: leave json null
            }
            resolve({ code, stdout, stderr, json });
        });
    });
}
