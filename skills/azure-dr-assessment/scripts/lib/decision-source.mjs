/** Where the decision of a slot comes from, for every place that shows it (diagram annotations, the report's slot table). */

const SOURCE_NAMES = { learn: "Microsoft Learn", "azure-reality": "Azure reality" };

/**
 * The source of a slot row of pattern-resolution.json, derived from the engine's candidate and never from the
 * model's free-text ref: `<id> v<version>` for a pattern, `Override #<n> of <id> (documented exception)` for an
 * override, `Service playbook` for a playbook decision on a learn candidate, `Microsoft Learn`, `Azure reality`,
 * `Unresolved` for a collision or an Unresolved decision, and `Unknown` for anything else: a missing or unrecognized
 * source is never read as Learn.
 */
export function sourceOf(row) {
    const decision = row.decision;
    const candidate = row.candidate ?? {};
    if (row.status === "unresolved" || decision?.status === "Unresolved") return "Unresolved";
    // Only an Azure veto can overrule the engine's candidate; any other source that the decision names is ignored.
    const source = decision?.source === "azure-reality" ? "azure-reality" : candidate.source;
    if (source === "pattern" && candidate.pattern) return `${candidate.pattern} v${candidate.version}`;
    if (source === "override" && candidate.pattern) return `Override #${candidate.overrideIndex} of ${candidate.pattern} (documented exception)`;
    if (source === "learn" && decision?.source === "playbook") return "Service playbook";
    return Object.hasOwn(SOURCE_NAMES, source) ? SOURCE_NAMES[source] : "Unknown";
}
