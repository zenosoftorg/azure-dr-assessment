import { CliError, EXIT } from "./cli.mjs";
import { sourceOf } from "./decision-source.mjs";
import { secretPaths } from "./secrets.mjs";

export const MARKERS = ["evidence", "sources", "patterns"];

const CLASS_LABELS = { "any-pair": "Any-pair", "paired-only": "Paired-only", none: "No built-in multiregion" };

/** One markdown table cell: whitespace collapsed, pipes escaped, long text cut. */
function cell(value, max = 200) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function table(headers, rows, max = 200) {
    if (rows.length === 0) return "";
    const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
    for (const row of rows) lines.push(`| ${row.map((value) => cell(value, max)).join(" | ")} |`);
    return lines.join("\n");
}

function describeSource(source) {
    if (source.kind === "ari-xlsx") {
        return `ARI workbook \`${source.file}\` (SHA-256 ${String(source.sha256).slice(0, 12)}…, read ${source.readAt})`;
    }
    if (source.kind === "live") {
        const count = source.subscriptions?.length ?? 0;
        return `live read-only collection from ${count} subscription${count === 1 ? "" : "s"} in tenant ${source.tenantId ?? "unknown"} (read ${source.readAt})`;
    }
    return `${source.kind}${source.file ? ` \`${source.file}\`` : ""}`;
}

/** Report section B: what was read, what was not, and every fact that is not Observed. */
export function evidenceSection({ ledger, inventory, maxRows = 200 }) {
    const out = ["### What was read", ""];
    if (inventory) {
        const sheets = inventory.sheets ?? [];
        const assessed = sheets.filter((sheet) => sheet.assessed);
        const omitted = sheets.filter((sheet) => !sheet.assessed);
        out.push(`- Source: ${describeSource(inventory.source)}.`);
        out.push(`- Sheets or queries assessed: ${assessed.length} of ${sheets.length}${assessed.length ? ` (${assessed.map((sheet) => sheet.name).join(", ")})` : ""}.`);
        out.push(`- Not assessed, so Unknown and never read as absent: ${omitted.length ? omitted.map((sheet) => `${sheet.name} (${sheet.reason ?? "not assessed"})`).join(", ") : "none"}.`);
        const gaps = (inventory.omissions ?? []).filter((omission) => !String(omission.what).startsWith("sheet:"));
        if (gaps.length > 0) out.push(`- Other gaps: ${gaps.map((gap) => `${gap.what} (${gap.reason})`).join(", ")}.`);
        const scope = inventory.scope ?? {};
        out.push(`- Resources in scope: ${scope.matched ?? "?"} of ${scope.total ?? "?"}${scope.applied ? " (scope selector applied)" : " (no scope selector)"}.`);
        for (const warning of inventory.warnings ?? []) out.push(`- Warning: ${warning}`);
    } else {
        out.push("- No inventory was written, so nothing was read.");
    }

    const facts = ledger.entries.filter((entry) => entry.kind === "fact");
    const count = (strength) => facts.filter((entry) => entry.strength === strength).length;
    out.push("", "### Facts by strength", "", table(["Strength", "Count"], [["Observed", count("Observed")], ["Inferred", count("Inferred")], ["Unknown", count("Unknown")]]));

    const open = facts.filter((entry) => entry.strength !== "Observed");
    if (open.length > 0) {
        out.push("", "### Inferred and Unknown", "", table(["Id", "Strength", "Subject", "Claim", "Basis"], open.slice(0, maxRows).map((entry) => [entry.id, entry.strength, entry.subject, entry.claim, entry.basis ?? ""]), 400));
        if (open.length > maxRows) out.push("", `Showing ${maxRows} of ${open.length}. The full list is in evidence/ledger.json.`);
    }

    const regions = ledger.entries.filter((entry) => entry.kind === "region");
    if (regions.length > 0) {
        const substitute = (entry) => (entry.substitute ? `${entry.substitute.label}: ${entry.substitute.source}${entry.substitute.ref ? ` (${entry.substitute.ref})` : ""}` : "");
        out.push("", "### Region analysis", "", table(["Id", "Check", "Subject", "Status", "Class", "Documentation", "Substitute"], regions.map((entry) => [entry.id, entry.check, entry.subject, entry.status, CLASS_LABELS[entry.class] ?? "", entry.doc ?? "", substitute(entry)])));
        // Spec 9: a playbook constraint that Learn contradicts in this run is stale, and Learn wins.
        const stale = regions.filter((entry) => entry.check === "playbook-claim" && entry.status === "Verified" && entry.result?.agrees === false);
        if (stale.length > 0) {
            out.push("", "### Playbook claims that Learn contradicts", "", "Learn wins: these playbook constraints are stale. An option does not name the constraints it rests on, so its status is unchanged: check each option of the service against the claim.", "", table(["Id", "Playbook", "Claim", "Learn says", "Documentation"], stale.map((entry) => [entry.id, entry.result.playbook, entry.result.claim, entry.quote ?? "", entry.doc ?? ""]), 400));
        }
    }
    return out.join("\n");
}

/** Report section C: the documentation entries of the ledger. */
export function sourcesSection({ ledger }) {
    const docs = ledger.entries.filter((entry) => entry.kind === "doc");
    if (docs.length === 0) return "No documentation source was recorded. Guidance in this report is Unverified.";
    const lines = [table(["Id", "Title", "URL", "Retrieved", "Status", "Supports"], docs.map((doc) => [doc.id, doc.title, doc.url ?? "none", doc.retrievedAt ?? "not retrieved", doc.status, doc.supports]))];
    if (docs.some((doc) => doc.status === "Unverified")) {
        lines.push("", "Unverified sources were not retrieved in this run. What they support is Unverified.");
    }
    return lines.join("\n");
}

/** An override without an alternative waives the pattern for its slots and replaces it with nothing: rank 4, Microsoft Learn, decides them. */
const LEARN_APPLIES = "Microsoft Learn applies";

function describeCandidate(candidate) {
    if (candidate.source === "pattern") return `${candidate.pattern} v${candidate.version}`;
    if (candidate.source === "override") {
        const alternative = candidate.alternative ? ` (${candidate.alternative})` : ` (no alternative: ${LEARN_APPLIES})`;
        return `override #${candidate.overrideIndex} of ${candidate.pattern} v${candidate.version}${alternative}`;
    }
    if (candidate.source === "collision") return "collision";
    if (candidate.source === "learn") return "Microsoft Learn";
    return "Unknown";
}

const COLLISION_ASK = "Resolve it with a `supersedes` link on one of the two patterns (pull request) or a decision recorded in `assessment.yaml`.";

function slotRow(row) {
    const decision = row.decision;
    if (row.collision) {
        const quoted = decision?.text ? ` ${decision.text}` : "";
        return [row.slot, "Unresolved", `Collision: ${row.collision.join(" and ")}. ${COLLISION_ASK}${quoted}`, ""];
    }
    if (!decision) {
        return [row.slot, row.status === "unresolved" ? "Unresolved" : "Not yet decided", `Candidate: ${describeCandidate(row.candidate)}`, ""];
    }
    return [row.slot, decision.status, decision.text || decision.azureReality || "", sourceOf(row)];
}

/**
 * Report section D: the pattern register, the decision per slot and the documented exceptions.
 * GC-07: the model and the owner write text into the resolution (decisions, justifications, approval references), and this
 * section copies it into a customer-facing report and onto stdout. A string of the resolution that looks like a secret stops
 * the build before any text is built; the details name the path and never the value.
 */
export function patternsSection({ resolution }) {
    if (!resolution) return "No pattern resolution was produced, so no company pattern is recorded as applied.";
    const found = secretPaths(resolution, "resolution");
    if (found.length > 0) {
        throw new CliError(
            EXIT.INPUT,
            "the pattern resolution holds text that looks like a secret, so the report tables were not built",
            found.map((at) => `${at}: looks like a secret (key, token, password or connection string) and must not appear in a report`),
        );
    }
    const out = [];
    if (resolution.banner) out.push(`> **${resolution.banner}**`, "");
    out.push("### Patterns", "", table(["Pattern", "Version", "Override level", "Applied", "Reason"], resolution.patterns.map((pattern) => [pattern.id, `v${pattern.version}`, pattern.override, pattern.applied ? "Yes" : "No", pattern.reason])));
    out.push("", "### Decision per slot", "", table(["Slot", "Outcome", "Decision", "Source"], resolution.slots.map(slotRow), 400));

    const overrides = resolution.documentedExceptions.filter((entry) => entry.kind === "override");
    const tier = resolution.documentedExceptions.filter((entry) => entry.kind === "tier-exception");
    const gaps = resolution.documentedExceptions.filter((entry) => entry.kind === "dr-choice-gap");
    out.push("", "### Documented exceptions", "");
    if (overrides.length === 0 && tier.length === 0 && gaps.length === 0) {
        out.push("None.");
    } else {
        // The formal record of an exception is printed whole, so its cells hold up to 1000 characters.
        if (overrides.length > 0) {
            const approval = (entry) => (entry.approver_role ? "No: this skill cannot verify an approval" : "Not required");
            out.push(table(["Override", "Pattern", "Slots", "Alternative used", "Justification", "Owner role", "Date", "Approver", "Approval reference", "Approval verified"], overrides.map((entry) => [`#${entry.index}`, entry.pattern, entry.slots.join(", "), entry.alternative ?? `none: ${LEARN_APPLIES}`, entry.justification, entry.owner_role, entry.date, entry.approver_role ?? "", entry.approval_ref ?? "", approval(entry)]), 1000));
        }
        if (tier.length > 0) {
            out.push(...(overrides.length > 0 ? [""] : []), table(["Tier exception", "Approver role", "Date"], tier.map((entry) => [entry.what, entry.approver_role, entry.date]), 1000));
            // One exception covers every stricter target (decision D23); the gate detail names each of them.
            const gate = (resolution.gates ?? []).find((entry) => entry.id === "target-stricter-than-tier" && entry.status === "excepted");
            if (gate) out.push("", `Tier gate: ${gate.detail}.`);
        }
        if (gaps.length > 0) {
            out.push(...(overrides.length > 0 || tier.length > 0 ? [""] : []), table(["Accepted gap", "Chosen by", "Date"], gaps.map((entry) => [entry.type, entry.chosen_by, entry.date]), 1000));
            out.push("", "This skill records the choice. It cannot verify it.");
        }
    }

    const rejected = resolution.overrides.filter((entry) => entry.outcome === "rejected");
    if (rejected.length > 0) {
        out.push("", "### Rejected overrides", "", table(["Override", "Pattern", "Reason"], rejected.map((entry) => [`#${entry.index}`, entry.pattern || "(none named)", entry.reason]), 400), "", "A rejected override changes nothing: the pattern keeps applying.");
    }
    if (resolution.openInputs.length > 0) {
        out.push("", "### Open inputs", "", "Values the application team has not supplied. The design does not invent them.", "", table(["Pattern", "Input", "Description"], resolution.openInputs.map((input) => [input.pattern, input.name, input.description])));
    }
    return out.join("\n");
}

/** Replace what sits between each pair of dr-tables markers. Running it twice gives the same text. */
export function injectTables(markdown, sections) {
    const missing = [];
    let text = markdown;
    for (const name of MARKERS) {
        const open = `<!-- dr-tables:${name} -->`;
        const close = `<!-- /dr-tables:${name} -->`;
        const start = text.indexOf(open);
        const end = text.indexOf(close);
        if (start < 0 || end < start) {
            missing.push(`${open} ... ${close}`);
            continue;
        }
        text = `${text.slice(0, start + open.length)}\n${sections[name]}\n${text.slice(end)}`;
    }
    if (missing.length > 0) throw new CliError(EXIT.INPUT, "the report is missing table markers", missing);
    return text;
}
