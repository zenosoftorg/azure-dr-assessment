import { FIXED_BODIES } from "./pack-fixture.mjs";

const band = (pattern, rpo, rto, cost) => ({
    pattern,
    rpo: { text: rpo[0], min: rpo[1], max: rpo[2] },
    rto: { text: rto[0], min: rto[1], max: rto[2] },
    cost,
});

/** The tier bands in the shape DR-TIER-001 stores under parameters.tiers (a test double for packs built in tests). */
export const TIER_PARAMETERS = {
    source: "test fixture",
    tiers: {
        0: band("Active/Active", ["Near zero", null, null], ["Near zero", null, null], "~2.2×–2.5×"),
        1: band("Hot/Warm (Active/Passive)", ["Seconds–minutes", "1s", "59m"], ["30 minutes–2 hours", "30m", "2h"], "~2.2×–2.5×"),
        2: band("Hot/Cold — minimal secondary compute (ASR)", ["1–4 hours", "1h", "4h"], ["4–12 hours", "4h", "12h"], "~1.3×–1.6×"),
        3: band("Cold (Backup/Restore)", ["24+ hours", "24h", null], ["24–72 hours", "24h", "72h"], "~1.05×–1.3×"),
    },
};

export const TIER_QUESTION = "**Which landing zone DR tier applies to this application?**\n\nReply with **0, 1, 2, or 3**.";

/** A patternMarkdown spec for DR-TIER-001: locked, deciding objectives, with the bands and a gate question. */
export function tierSpec(fields = {}) {
    const quoted = TIER_QUESTION.split("\n").map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
    return {
        id: "DR-TIER-001",
        slots: ["objectives"],
        override: "locked",
        owner_role: "landing zone platform architecture",
        parameters: TIER_PARAMETERS,
        sections: [...FIXED_BODIES, ["Mandatory first step", `Ask the tier first.\n\n${quoted}`]],
        ...fields,
    };
}
