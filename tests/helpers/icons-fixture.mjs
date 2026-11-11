import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Icon ids that exist in the fixture icon root, with the file names the canvas catalog turns into those ids. */
export const FIXTURE_ICONS = {
    "azure:app-services": "10035-icon-service-App-Services.svg",
    "azure:sql-database": "10130-icon-service-SQL-Database.svg",
    "azure:storage-accounts": "10086-icon-service-Storage-Accounts.svg",
    "azure:front-door-and-cdn-profiles": "10073-icon-service-Front-Door-and-CDN-Profiles.svg",
    "azure:key-vaults": "10245-icon-service-Key-Vaults.svg",
    "azure:all-resources": "10782-icon-service-All-Resources.svg",
    "azure:information": "02000-icon-service-Information.svg",
};

/** Create a temporary icon root in the layout the canvas catalog expects and return its path. */
export function makeIconRoot({ withIcons = true } = {}) {
    const root = mkdtempSync(path.join(tmpdir(), "dr-icons-"));
    const folder = path.join(root, "Azure_Public_Service_Icons_V24", "Azure_Public_Service_Icons", "Icons", "general");
    mkdirSync(folder, { recursive: true });
    if (withIcons) {
        for (const file of Object.values(FIXTURE_ICONS)) {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><title>${file}</title><rect width="18" height="18" fill="#0078d4"/></svg>\n`;
            writeFileSync(path.join(folder, file), svg);
        }
    }
    return root;
}
