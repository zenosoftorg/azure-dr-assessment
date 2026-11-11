import { loadCanvasModules } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";

/** The checkout sample diagram, normalized and laid out by the vendored canvas code. */
export async function sampleDiagram() {
    const { store, layout } = await loadCanvasModules();
    const diagram = store.normalizeDiagram({
        version: 1,
        title: "Scratch checkout",
        nodes: [
            { id: "n_fd", iconId: "azure:front-door-and-cdn-profiles", label: "Front Door", sublabel: "global", group: null },
            { id: "n_web", iconId: "azure:app-services", label: "web-prod", sublabel: "P1v3", group: "g_primary" },
            { id: "n_db", iconId: "azure:sql-database", label: "orders-db", sublabel: "SQL", group: "g_primary" },
            { id: "n_st", iconId: "azure:storage-accounts", label: "assets-prod", sublabel: "Standard_LRS", group: "g_primary" },
        ],
        groups: [{ id: "g_primary", label: "Primary · westeurope", border: "#0969da", background: "rgba(9,105,218,0.08)", dashed: false }],
        edges: [
            { id: "e1", from: "n_fd", to: "n_web", label: "HTTPS", color: "#0969da" },
            { id: "e2", from: "n_web", to: "n_db", label: "SQL", color: "#0969da" },
            { id: "e3", from: "n_web", to: "n_st", label: "Blob", color: "#f59e0b", dashed: true },
        ],
    });
    return layout.autoLayout(diagram, { direction: "LR" });
}
