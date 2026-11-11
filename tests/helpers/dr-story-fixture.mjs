import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..", "..");
export const DR_TEMPLATE = path.join(repo, "skills", "azure-dr-assessment", "assets", "templates", "story.dr-walkthrough.mjs");
export const GOLDEN_DR_DIAGRAM = path.join(repo, "tests", "fixtures", "golden", "checkout-proposed-dr.arch.json");

/** Story data for the golden proposed-dr diagram: one entry for each of the ten steps, the establishing step last. */
export function drStoryData(overrides = {}) {
    return {
        schemaVersion: 1,
        cover: { title: "checkout · disaster recovery", blurb: "How the workload fails over from westeurope to swedencentral, and back." },
        steps: [
            { step: "healthy", md: "Users reach the primary region through the on-prem DNS record. The data tier replicates to the DR region." },
            { step: "disaster", md: "The primary region is lost and nothing in westeurope can be reached.", groups: ["Primary · westeurope"] },
            { step: "detection", md: "Azure Service Health and the synthetic checks both report the outage.", nodes: ["web-prod"] },
            { step: "approval", title: "The incident commander decides", md: "The incident commander approves the failover. This skill does not approve or run it." },
            {
                step: "failover",
                md: "Promote the replica, start the DR web app and change the on-prem DNS record.",
                groups: ["DR · swedencentral"],
                nodes: ["orders-db replica", "web-dr"],
                edges: [["On-prem DNS", "web-dr"]],
            },
            { step: "verification", md: "Run the business checks against the DR region.", nodes: ["web-dr"] },
            { step: "failback", md: "Resynchronize the primary, then change the record back.", edges: [["On-prem DNS", "web-prod"]] },
            { step: "weakest-link", md: "The DNS step is the weakest link: the TTL wait counts toward the RTO.", edges: [["On-prem DNS", "web-dr"]] },
            { step: "test-plan", md: "Rehearse the failover twice a year and record the measured times." },
            {
                step: "establishing",
                md: "The DR region is built beside today's setup, in the build order of the establishment guide.",
                scenes: [
                    { title: "Data replication", md: "Today orders-db has no replica. Target: active geo-replication to swedencentral. Test: the lag stays below the Estimated RPO for 7 days.", nodes: ["orders-db replica"], edges: [["orders-db", "orders-db replica"]] },
                    { title: "Compute", md: "Today web-prod runs only in westeurope. Target: a warm web app in swedencentral. Test: it answers a health probe.", groups: ["DR · swedencentral"] },
                ],
            },
        ],
        ...overrides,
    };
}

/**
 * A fresh output root holding architectures/<id>.arch.json, presentations/<id>.story.mjs (a copy of the template)
 * and presentations/<id>.story-data.json. `data: null` leaves the data file out.
 */
export function drStoryWorkspace({ id = "checkout-proposed-dr", data = drStoryData(), diagram = GOLDEN_DR_DIAGRAM } = {}) {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), "dr-story-dr-")));
    const paths = {
        cwd,
        id,
        diagram: path.join(cwd, "architectures", `${id}.arch.json`),
        story: path.join(cwd, "presentations", `${id}.story.mjs`),
        data: path.join(cwd, "presentations", `${id}.story-data.json`),
        html: path.join(cwd, "presentations", `${id}.html`),
    };
    mkdirSync(path.dirname(paths.diagram));
    mkdirSync(path.dirname(paths.story));
    copyFileSync(diagram, paths.diagram);
    copyFileSync(DR_TEMPLATE, paths.story);
    if (data !== null) writeFileSync(paths.data, `${JSON.stringify(data, null, 2)}\n`);
    return paths;
}
