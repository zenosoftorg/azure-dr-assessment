// Loopback HTTP server backing the canvas iframe.
//
// Routes:
//   GET  /                       editor shell
//   GET  /app.js, /styles.css    static assets
//   GET  /api/bootstrap          catalog metadata + diagram list + current diagram
//   GET  /api/icons?q=&c=        icon search
//   GET  /api/icon/:id.svg       raw SVG (variant via ?v=)
//   GET  /api/diagram/:id        load
//   PUT  /api/diagram/:id        save
//   POST /api/suggest            suggestions + clarifying questions for a node
//   POST /api/ask                forward a question to the agent
//   GET  /events                 SSE stream for agent-pushed updates

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WEB_ROOT } from "./config.mjs";
import { slugify } from "./store.mjs";
import { suggestFor } from "./suggest.mjs";

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
};

function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(payload);
}

async function readBody(req, limit = 8 * 1024 * 1024) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > limit) throw new Error("payload too large");
        chunks.push(chunk);
    }
    if (!chunks.length) return null;
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function createCanvasServer({ catalog, store, diagramId, onAsk, log }) {
    const clients = new Set();
    const state = { diagramId };

    function broadcast(event, data) {
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const res of clients) {
            try {
                res.write(frame);
            } catch {
                clients.delete(res);
            }
        }
    }

    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        const route = url.pathname;

        try {
            // ---- Static assets -------------------------------------------------
            if (req.method === "GET" && (route === "/" || route === "/index.html")) {
                const html = await readFile(path.join(WEB_ROOT, "index.html"), "utf8");
                res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
                return res.end(html);
            }
            // Browsers request this unprompted; answering keeps the console
            // clean so a real 404 is not lost in the noise.
            if (req.method === "GET" && route === "/favicon.ico") {
                res.writeHead(204, { "Cache-Control": "public, max-age=86400" });
                return res.end();
            }
            if (req.method === "GET" && /^\/(app\.js|styles\.css|layout\.mjs|vsdx\.mjs|edge-route\.mjs)$/.test(route)) {
                const file = path.join(WEB_ROOT, route.slice(1));
                const body = await readFile(file, "utf8");
                res.writeHead(200, {
                    "Content-Type": MIME[path.extname(file)] || "text/plain",
                    "Cache-Control": "no-store",
                });
                return res.end(body);
            }

            // ---- SSE -----------------------------------------------------------
            if (req.method === "GET" && route === "/events") {
                res.writeHead(200, {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                });
                res.write(`event: hello\ndata: ${JSON.stringify({ diagramId: state.diagramId })}\n\n`);
                clients.add(res);
                req.on("close", () => clients.delete(res));
                return undefined;
            }

            // ---- Bootstrap -----------------------------------------------------
            if (req.method === "GET" && route === "/api/bootstrap") {
                const diagram = await store.load(state.diagramId, state.diagramId);
                return sendJson(res, 200, {
                    diagramId: state.diagramId,
                    diagram,
                    diagrams: await store.list(),
                    collections: catalog.collections(),
                    iconCount: catalog.size,
                    iconRoot: Boolean(catalog.root),
                });
            }

            // ---- Icons ---------------------------------------------------------
            if (req.method === "GET" && route === "/api/icons") {
                const q = url.searchParams.get("q") || "";
                const collection = url.searchParams.get("c") || null;
                const limit = Math.min(Number(url.searchParams.get("limit")) || 120, 400);
                return sendJson(res, 200, { items: catalog.search(q, { collection, limit }) });
            }

            if (req.method === "GET" && route.startsWith("/api/icon/")) {
                const id = decodeURIComponent(route.slice("/api/icon/".length).replace(/\.svg$/, ""));
                const variant = Number(url.searchParams.get("v")) || 0;
                const svg = await catalog.svg(id, variant);
                if (!svg) {
                    res.writeHead(404, { "Content-Type": "text/plain" });
                    return res.end("icon not found");
                }
                res.writeHead(200, {
                    "Content-Type": MIME[".svg"],
                    "Cache-Control": "public, max-age=86400",
                });
                return res.end(svg);
            }

            // ---- Diagrams ------------------------------------------------------
            if (route.startsWith("/api/diagram/")) {
                const id = decodeURIComponent(route.slice("/api/diagram/".length));
                if (req.method === "GET") {
                    return sendJson(res, 200, { diagram: await store.load(id, id) });
                }
                if (req.method === "PUT") {
                    const body = await readBody(req);
                    const { file, diagram } = await store.save(id, body?.diagram || body);
                    state.diagramId = id;
                    broadcast("saved", { diagramId: id, file });
                    return sendJson(res, 200, { ok: true, file, diagram });
                }
            }

            if (req.method === "GET" && route === "/api/diagrams") {
                return sendJson(res, 200, { items: await store.list() });
            }

            // ---- Import ---------------------------------------------------
            if (req.method === "POST" && route === "/api/import") {
                const body = await readBody(req);
                const incoming = body?.diagram || body;
                const looksLikeDiagram =
                    incoming &&
                    typeof incoming === "object" &&
                    (Array.isArray(incoming.nodes) ||
                        Array.isArray(incoming.groups) ||
                        Array.isArray(incoming.edges));
                if (!looksLikeDiagram) {
                    return sendJson(res, 400, {
                        error: "That file is not an architecture diagram (expected nodes/edges/groups).",
                    });
                }

                // Never overwrite an existing diagram on import: derive a free id.
                const title =
                    typeof incoming.title === "string" && incoming.title.trim()
                        ? incoming.title
                        : "imported architecture";
                const taken = new Set((await store.list()).map((d) => d.id));
                const base = slugify(title);
                let id = base;
                let n = 2;
                while (taken.has(id)) id = `${base}-${n++}`;

                const { diagram, file } = await store.save(id, incoming);

                // Icon ids are portable only if the target has the same library.
                const unknownIcons = [
                    ...new Set(diagram.nodes.map((node) => node.iconId).filter(Boolean)),
                ].filter((iconId) => !catalog.get(iconId));

                state.diagramId = id;
                broadcast("saved", { diagramId: id, file });
                return sendJson(res, 200, { diagramId: id, diagram, file, unknownIcons });
            }

            // ---- Suggestions ---------------------------------------------------
            if (req.method === "POST" && route === "/api/suggest") {
                const body = await readBody(req);
                const icon = catalog.get(body?.iconId) || catalog.resolve(body?.name);
                if (!icon) return sendJson(res, 200, { topic: null, suggestions: [], questions: [] });
                return sendJson(
                    res,
                    200,
                    suggestFor(catalog, icon, Array.isArray(body?.existing) ? body.existing : []),
                );
            }

            // ---- Ask the agent -------------------------------------------------
            if (req.method === "POST" && route === "/api/ask") {
                const body = await readBody(req);
                if (typeof onAsk === "function") {
                    await onAsk(body || {});
                    return sendJson(res, 200, { ok: true });
                }
                return sendJson(res, 501, { ok: false, error: "ask not wired" });
            }

            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("not found");
        } catch (error) {
            log?.(`http error on ${route}: ${error.message}`);
            if (!res.headersSent) sendJson(res, 500, { error: String(error.message || error) });
            else res.end();
        }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    return {
        server,
        url: `http://127.0.0.1:${port}/`,
        broadcast,
        setDiagramId(id) {
            state.diagramId = id;
        },
        get diagramId() {
            return state.diagramId;
        },
        async close() {
            for (const client of clients) {
                try {
                    client.end();
                } catch {
                    /* already gone */
                }
            }
            clients.clear();
            await new Promise((resolve) => server.close(() => resolve()));
        },
    };
}
