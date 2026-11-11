const REQUIRED_FIELDS = {
    overridable: ["justification", "owner_role", "date"],
    "approval-required": ["justification", "owner_role", "date", "approver_role", "approval_ref"],
};

/** A real calendar date written as YYYY-MM-DD ("2026-02-30" and "2026-2-3" are not). */
function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The reason an entry is rejected, or null when it is valid. `listed` is the entry's slot list without duplicates, or null when the entry has no slots field. */
function rejection(entry, pattern, listed) {
    if (!entry.pattern) return "missing required fields: pattern";
    if (!pattern) return `unknown pattern ${entry.pattern}`;
    if (pattern.status !== "approved") return `pattern ${pattern.id} is ${pattern.status || "missing"}, not approved`;
    if (pattern.override === "locked") return "locked pattern: change it through this repository";
    const problems = [];
    if (entry.pattern_version !== undefined) {
        if (!Number.isInteger(entry.pattern_version)) {
            problems.push("pattern_version must be an integer");
        } else if (entry.pattern_version !== pattern.version) {
            problems.push(`stale override: it pins version ${entry.pattern_version} and ${pattern.id} is at version ${pattern.version}`);
        }
    }
    if (listed !== null && listed.length === 0) {
        problems.push("slots is empty: list the slots this entry waives, or omit slots to waive every slot the pattern decides");
    }
    const undecided = (listed ?? []).filter((slot) => !pattern.slots.includes(slot));
    if (undecided.length > 0) problems.push(`slots not decided by ${pattern.id}: ${undecided.join(", ")}`);
    const missing = (REQUIRED_FIELDS[pattern.override] ?? REQUIRED_FIELDS.overridable).filter((field) => !entry[field]);
    if (missing.length > 0) problems.push(`missing required fields: ${missing.join(", ")}`);
    if (entry.date && !validDate(entry.date)) problems.push("date must be a date as YYYY-MM-DD");
    return problems.length > 0 ? problems.join("; ") : null;
}

/**
 * Check every overrides[] entry of an assessment against the pack (contracts 7.6).
 * A rejected entry never changes anything: the pattern keeps applying.
 */
export function validateOverrides(a, pack) {
    const applied = [];
    const rejected = [];
    a.overrides.forEach((entry, index) => {
        const pattern = pack.byId.get(entry.pattern);
        const listed = Array.isArray(entry.slots) ? [...new Set(entry.slots)] : null;
        const reason = rejection(entry, pattern, listed);
        (reason === null ? applied : rejected).push({
            index,
            pattern: entry.pattern,
            level: pattern ? pattern.override : "unknown",
            slots: listed ?? [...(pattern?.slots ?? [])],
            outcome: reason === null ? "applied" : "rejected",
            reason: reason ?? "complete",
            approvalVerified: false,
            entry,
        });
    });
    return { applied, rejected };
}
