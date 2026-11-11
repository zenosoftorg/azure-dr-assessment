import path from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserError, BrowserStartError, launchBrowser, waitFor } from "./cdp.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The story the page was built from, reduced to what the checks need. */
const STORY_INFO = `({
    nodes: DATA.diagram.nodes.length,
    scenes: DATA.story.map(function (s) {
        const covered = new Set(s.nodes || []);
        (s.edges || []).forEach(function (id) {
            const e = DATA.diagram.edges.find(function (x) { return x.id === id; });
            if (e) { covered.add(e.from); covered.add(e.to); }
        });
        DATA.diagram.nodes.forEach(function (n) { if (n.group && (s.groups || []).indexOf(n.group) >= 0) covered.add(n.id); });
        return {
            covered: covered.size,
            all: Boolean(s.all),
            nodes: (s.nodes || []).length,
            groups: (s.groups || []).length,
            edges: (s.edges || []).length,
            md: String(s.md || ""),
        };
    }),
})`;

/**
 * The highlight rule over plain facts. A scene that focuses a strict subset of the nodes must dim the rest;
 * a scene whose focus covers every node cannot dim anything and is exempt.
 * `scenes` holds the focused scenes only: how many nodes each one covers and how many nodes the page dimmed.
 */
export function highlightDecision({ totalNodes, scenes }) {
    const subset = scenes.map((scene, i) => ({ ...scene, n: i + 1 })).filter((scene) => scene.covered < totalNodes);
    const flat = subset.filter((scene) => scene.dimNodes === 0).map((scene) => scene.n);
    if (flat.length > 0) {
        return { pass: false, detail: `focused scene ${flat.join(", ")} covers only part of the diagram but dims nothing` };
    }
    return {
        pass: true,
        detail:
            subset.length === 0
                ? `${scenes.length} focused scenes cover every node, so there is nothing to dim`
                : `${scenes.length} focused scenes highlight their targets${subset.length < scenes.length ? " (scenes that cover every node cannot dim)" : ""} and dim the rest`,
    };
}

/** What the page shows right now. */
const SNAPSHOT = `(function () {
    const count = function (selector) { return document.querySelectorAll(selector).length; };
    return {
        transform: document.querySelector("#canvas > g").getAttribute("transform"),
        hotNodes: count(".nd.hot"),
        dimNodes: count(".nd.dim"),
        hotGroups: count(".gr.hot"),
        hotEdges: count(".ed.hot"),
        flowDots: count(".ed.hot .flowdot"),
        tables: count("#body table"),
        quotes: count("#body blockquote"),
    };
})()`;

const cells = (line) =>
    line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());

/** The same table rule the page's markdown renderer uses: a header row and a delimiter row of at least two cells. */
function hasTable(markdown) {
    const lines = markdown.split("\n");
    return lines.some((line, i) => i > 0 && lines[i - 1].includes("|") && cells(line).length > 1 && cells(line).every((cell) => /^:?-+:?$/.test(cell)));
}

const hasQuote = (markdown) => /^\s*>/m.test(markdown);

function collectConsoleError(message, sink) {
    if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        sink.push(`${details.text} ${details.exception?.description ?? ""}`.trim());
    } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        sink.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
    } else if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        sink.push(message.params.entry.text);
    }
}

/**
 * Drive a built presentation in a headless browser and report one result per check.
 * Throws BrowserStartError when the browser cannot be started; later failures become a failed `browser` check.
 */
export async function checkPresentation({ html, executable, theme = null, timeoutMs = 60_000 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let session;
    try {
        session = await launchBrowser(executable, { signal: controller.signal });
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }

    const checks = [];
    const consoleErrors = [];
    let scenes = 0;
    const record = (id, pass, detail) => checks.push({ id, pass, detail });
    try {
        session.on((message) => collectConsoleError(message, consoleErrors));
        for (const domain of ["Page", "Runtime", "Log"]) await session.send(`${domain}.enable`);
        const url = pathToFileURL(path.resolve(html)).href + (theme ? `?scoutTheme=${theme}` : "");

        const evaluate = async (expression) => {
            const result = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) {
                throw new BrowserError(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            }
            return result.result.value;
        };
        const open = async () => {
            await session.send("Page.navigate", { url });
            await waitFor(() => evaluate("document.readyState === 'complete'"), { what: "the page to load", signal: controller.signal });
        };
        const click = (id) => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);

        // Pass 1: normal motion.
        await open();
        const coverShown = await evaluate(`Boolean(document.getElementById("cover")) && !document.getElementById("cover").classList.contains("gone")`);
        record("cover", coverShown, coverShown ? "the cover is shown" : "there is no visible #cover element");
        const hasStory = await evaluate(`typeof DATA !== "undefined" && Array.isArray(DATA.story)`);
        if (!coverShown || !hasStory) {
            if (!hasStory) record("story", false, "the page carries no story data");
        } else {
            await click("begin");
            await sleep(400);
            const dismissed = await evaluate(`document.getElementById("cover").classList.contains("gone") && document.getElementById("title").textContent.length > 0`);
            record("begin", dismissed, dismissed ? "Begin dismisses the cover and shows the first scene" : "Begin did not dismiss the cover");
            if (theme) {
                const applied = await evaluate(`document.documentElement.getAttribute("data-theme")`);
                record("theme", applied === theme, `data-theme is ${applied}`);
            }
            await click("next");
            await sleep(1800);

            // Pass 2: reduced motion, so the camera jumps and every scene can be visited quickly.
            await session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
            await open();
            const info = await evaluate(STORY_INFO);
            scenes = info.scenes.length;
            await click("begin");
            const snapshots = [];
            for (let i = 0; i < scenes; i++) {
                if (i > 0) await click("next");
                snapshots.push(await evaluate(SNAPSHOT));
            }
            const focused = info.scenes.map((scene, i) => ({ scene, snap: snapshots[i], n: i + 1 })).filter(({ scene }) => !scene.all && scene.nodes + scene.groups + scene.edges > 0);

            const transforms = new Set(snapshots.map((snap) => snap.transform));
            record(
                "camera",
                focused.length === 0 || transforms.size > 1,
                focused.length === 0 ? "every scene uses the wide shot" : `${transforms.size} distinct camera positions across ${scenes} scenes`,
            );

            const empty = focused.filter(({ snap }) => snap.hotNodes + snap.hotGroups + snap.hotEdges === 0).map(({ n }) => n);
            const dims = highlightDecision({
                totalNodes: info.nodes,
                scenes: focused.map(({ scene, snap }) => ({ covered: scene.covered, dimNodes: snap.dimNodes })),
            });
            record(
                "highlight",
                empty.length === 0 && dims.pass,
                empty.length > 0 ? `scene ${empty.join(", ")} highlights nothing; a label in the story probably no longer matches the diagram` : dims.detail,
            );

            const missing = [];
            info.scenes.forEach((scene, i) => {
                if (hasTable(scene.md) && snapshots[i].tables === 0) missing.push(`scene ${i + 1}: table`);
                if (hasQuote(scene.md) && snapshots[i].quotes === 0) missing.push(`scene ${i + 1}: blockquote`);
            });
            record("markdown", missing.length === 0, missing.length === 0 ? "tables and blockquotes render" : `not rendered: ${missing.join(", ")}`);

            const noFlow = focused.filter(({ scene, snap }) => scene.edges > 0 && snap.flowDots === 0).map(({ n }) => n);
            record("flow", noFlow.length === 0, noFlow.length === 0 ? "focused edges carry flow particles" : `scene ${noFlow.join(", ")} lists edges but shows no flow particles`);
        }
        record("console", consoleErrors.length === 0, consoleErrors.length === 0 ? "no console errors" : `${consoleErrors.length} console error(s)`);
    } catch (err) {
        record("browser", false, controller.signal.aborted ? `timed out after ${timeoutMs / 1000} s` : err.message);
    } finally {
        clearTimeout(timer);
        await session.close();
    }
    return { checks, consoleErrors, scenes };
}

export { BrowserStartError };
