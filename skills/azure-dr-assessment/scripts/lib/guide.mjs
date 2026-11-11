import { isDefaultChoice } from "./assessment.mjs";
import { CliError, EXIT } from "./cli.mjs";
import { slugKey } from "./diagram-style.mjs";
import { PATH_LABELS } from "./dr-options.mjs";
import { RESERVED_OPTION_ID } from "./playbooks.mjs";

/**
 * The DR establishment guide and runbook section 3 (v3 contracts 6.6). Every function here is pure: the classified
 * document (evidence/dr-options.json), the playbooks and the template are passed in, nothing is read from disk.
 */

/** The slots in the order the DR region is built: the network first, the traffic switch last (contracts 6.6). */
export const BUILD_ORDER = [
    "connectivity", "identity", "detection", "secrets-keys",
    "data-replication.relational", "data-replication.nosql", "data-replication.storage", "data-replication.messaging",
    "data-replication.vm-disks", "data-replication.cache", "backup", "compute", "ingress", "traffic-dns",
];
/** The parts of every chapter, in order. */
export const GUIDE_PARTS = ["Today", "Target", "Prerequisites", "Build", "Validate", "Cut-over", "Decommission the paired setup", "Failover and failback", "Open inputs"];
export const VALIDATE_HEADER = ["Criterion", "Pass condition", "How to measure", "Evidence", "Frequency", "Owner role"];
export const RUNBOOK_HEADER = ["Order", "Step", "Owner role", "Estimated duration", "Verification", "Abort condition"];
export const NO_PLAYBOOK_LINE = "No playbook, derived from Learn this run.";
/** The one-line generator slots of the guide template that --write replaces. */
export const BUILD_ORDER_SLOT = "<!-- dr-guide:build-order -->";
export const CHAPTERS_SLOT = "<!-- dr-guide:chapters -->";
export const OWNER_ROLE_FILL = "<!-- fill: owner role -->";
const STEP_PREFIX = /^([a-z0-9]+(?:-[a-z0-9]+)*):\s+/;
const UNPLACED = BUILD_ORDER.indexOf("ingress") + 0.5;

const sentence = (text) => String(text ?? "").replace(/\s+/g, " ").trim().replace(/\.+$/, "");
const cell = (value) => String(value ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
const tableRow = (cells) => `| ${cells.map(cell).join(" | ")} |`;
const tableHead = (header) => [tableRow(header), `|${header.map(() => "---").join("|")}|`];
const resources = (count) => `${count} ${count === 1 ? "resource" : "resources"}`;
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** A fill marker for the model; its text never closes the comment early. */
export function fillMarker(text) {
    return `<!-- fill: ${String(text).replace(/-->/g, "->").replace(/\s+/g, " ").trim()} -->`;
}

/**
 * M-5: the slot of a type that has none of its own, from its ARM namespace, so that it sorts in the build order (the
 * network first). Exact types first, then the namespace; null for a namespace the map does not know.
 */
const FALLBACK_TYPES = {
    "microsoft.network/trafficmanagerprofiles": "traffic-dns",
    "microsoft.network/dnszones": "traffic-dns",
    // a network interface is built with its virtual machine, so it has no build slot of its own
    "microsoft.network/networkinterfaces": null,
};
const FALLBACK_NAMESPACES = {
    "microsoft.network": "connectivity",
    "microsoft.managedidentity": "identity",
    "microsoft.insights": "detection",
    "microsoft.operationalinsights": "detection",
    "microsoft.alertsmanagement": "detection",
    "microsoft.keyvault": "secrets-keys",
    "microsoft.recoveryservices": "backup",
    "microsoft.dataprotection": "backup",
    "microsoft.sql": "data-replication.relational",
    "microsoft.dbforpostgresql": "data-replication.relational",
    "microsoft.dbformysql": "data-replication.relational",
    "microsoft.documentdb": "data-replication.nosql",
    "microsoft.storage": "data-replication.storage",
    "microsoft.servicebus": "data-replication.messaging",
    "microsoft.eventhub": "data-replication.messaging",
    "microsoft.compute": "data-replication.vm-disks",
    "microsoft.cache": "data-replication.cache",
    "microsoft.web": "compute",
    "microsoft.app": "compute",
    "microsoft.containerservice": "compute",
    "microsoft.containerregistry": "compute",
    "microsoft.cdn": "ingress",
    "microsoft.apimanagement": "ingress",
};
export function fallbackSlot(type) {
    const key = String(type).toLowerCase();
    if (key in FALLBACK_TYPES) return FALLBACK_TYPES[key];
    return FALLBACK_NAMESPACES[key.split("/")[0]] ?? null;
}

/** The slot a row sorts by: its own, else the fallback of its ARM namespace. */
const sortSlot = (row) => row.slot ?? fallbackSlot(row.type);

/** The rows of dr-options.json in build order: by the slot's place in BUILD_ORDER, then in their order in the file. */
export function orderTypes(rows) {
    const rank = (slot) => (BUILD_ORDER.includes(slot) ? BUILD_ORDER.indexOf(slot) : UNPLACED);
    return rows.map((row, i) => ({ row, i })).sort((a, b) => rank(sortSlot(a.row)) - rank(sortSlot(b.row)) || a.i - b.i).map(({ row }) => row);
}

/** The service of a row's playbook ("key-vault v1" gives key-vault), or null. */
const serviceOf = (row) => (typeof row.playbook === "string" ? row.playbook.split(" ")[0] : null);

/**
 * The playbook that classified a row, from the playbooks by service. A row whose playbook the folder does not hold, or
 * holds in another version, was classified against other playbooks: classify again before the guide is written.
 */
function playbookOf(row, playbooks) {
    const service = serviceOf(row);
    if (service === null) return null;
    const playbook = playbooks.get(service);
    if (!playbook || `${playbook.service} v${playbook.version}` !== row.playbook) {
        throw new CliError(EXIT.INPUT, "dr-options.json was classified with other playbooks than this folder holds", [
            `${row.type}: dr-options.json names playbook ${row.playbook}, the folder holds ${playbook ? `${playbook.service} v${playbook.version}` : "no playbook of that service"}`,
            "run dr-options --classify again with the same --playbooks-dir",
        ]);
    }
    return playbook;
}

/** Every chapter in build order with its number and anchor: the playbook service, else slugKey of the ARM type. */
export function chapterPlan(doc) {
    const used = new Map();
    const rows = orderTypes(doc.types);
    const titles = new Map();
    for (const row of rows) titles.set(row.title, (titles.get(row.title) ?? 0) + 1);
    return rows.map((row, i) => {
        const base = serviceOf(row) ?? slugKey(row.type);
        const seen = (used.get(base) ?? 0) + 1;
        used.set(base, seen);
        // A playbook that covers two ARM types gives two rows one title: the last segment of the type tells them apart.
        const title = titles.get(row.title) > 1 ? `${row.title} (${row.type.split("/").at(-1)})` : row.title;
        return { n: i + 1, type: row.type, title, slot: row.slot, playbook: row.playbook, anchor: seen === 1 ? base : `${base}-${seen}`, row };
    });
}

/**
 * The target of a row: the chosen option when its dr_choices entry is valid, else the pattern or override that
 * decides the slot, else the recommendation.
 */
function targetOf(row) {
    const chosen = row.choice?.status === "valid" ? row.options.find((o) => o.id === row.choice.option) : null;
    if (chosen) return { option: chosen, choice: row.choice, decided: null };
    if (row.decidedBy) return { option: null, choice: null, decided: row.decidedBy };
    return { option: row.options.find((o) => o.id === row.recommended) ?? null, choice: null, decided: null };
}

const kindLabel = (option) => (option.id === RESERVED_OPTION_ID ? "Accept the gap" : PATH_LABELS[option.kind] ?? option.kind);

function sourceText(option, row) {
    if (option.source === "playbook") return `playbook ${row.playbook}`;
    if (option.source === "learn") return `Microsoft Learn this run (${option.ledger.join(", ") || "no ledger entry"})`;
    return "rule: every type can accept the gap";
}

function chosenText(row, target) {
    const { choice } = target;
    if (choice && isDefaultChoice(choice.chosen_by)) return `Default: nobody chose, so the recommendation of ${choice.date} applies. It is an open decision for the owner.`;
    if (choice) {
        const rec = choice.recommended ? "the recommendation" : `the recommendation was ${row.recommended}`;
        return `${choice.chosen_by} on ${choice.date} (${rec}).`;
    }
    if (row.path === "native" && row.verified && !row.ask) return "Not asked: the native path rests on a Verified mechanism, so the recommendation applies.";
    const invalid = row.choice?.status === "invalid" ? ` The recorded choice ${row.choice.option} is invalid: ${sentence(row.choice.problem)}.` : "";
    return `Default: no valid choice is recorded, so the recommendation applies.${invalid}`;
}

function residencyText(residency) {
    if (residency === "crosses") return "crosses the data residency constraint: a residency Gap in the report and on the diagram";
    return residency;
}

/** The Target part (contracts 6.6 prefill): option, source, who chose it, estimates, tier fit, trade-off, residency and stale claims. */
function targetLines(row, target, doc) {
    if (target.decided) {
        return [
            `- Decided by ${target.decided.ref} (${target.decided.source}): it governs this slot, see report section D.`,
            "",
            fillMarker(`the target that ${target.decided.ref} gives this type, and why`),
        ];
    }
    const option = target.option;
    const lines = [
        `- Option: ${sentence(option.title)} (\`${option.id}\`): ${kindLabel(option)}, target ${option.targetRegion ?? "none"}.`,
        `- Source: ${sourceText(option, row)}.`,
        `- Chosen by: ${chosenText(row, target)}`,
    ];
    if (option.id !== RESERVED_OPTION_ID) lines.push(`- Estimated RPO: ${sentence(option.rpo) || "unknown"}. Estimated RTO: ${sentence(option.rto) || "unknown"}.`);
    lines.push(option.meetsTier
        ? `- Tier ${doc.tier}: met by the Estimated RPO and RTO.`
        : `- Tier ${doc.tier}: not met${option.status === "unverified" ? " (Unverified)" : ""}: a Gap that names ${row.type} and ${option.id}.`);
    lines.push(`- Gives up: ${sentence(option.givesUp)}.`, `- Residency: ${residencyText(option.residency)}.`);
    const date = String(doc.generatedAt ?? "").slice(0, 10);
    for (const claim of row.staleClaims ?? []) {
        lines.push(`- Playbook claim stale: ${sentence(claim.claim)}. Learn read on ${date} says ${sentence(claim.learnSays)}; the playbook says ${sentence(claim.playbookSays)} (${claim.ledger.join(", ")}). Learn wins.`);
    }
    lines.push("", fillMarker("why this option fits the workload, in one or two sentences"));
    return lines;
}

/** The playbook option of the target, when the target came from a playbook and is not accept-gap. */
function playbookOption(playbook, target) {
    if (!playbook || !target.option || target.option.source !== "playbook") return null;
    return playbook.options.find((o) => o.id === target.option.id) ?? null;
}

const numbered = (steps) => steps.map((step, i) => `${i + 1}. ${step}`);

/** The test criteria of the playbook that apply to the option, as rows of the Validate table. */
function validateRows(playbook, option) {
    if (!playbook || !option) return [];
    return playbook.tests
        .filter((t) => t.appliesTo.includes(option.id))
        .map((t) => [`${t.id}: ${t.title}`, t.passCondition, t.howToMeasure, t.evidence, t.frequency, OWNER_ROLE_FILL]);
}

/**
 * The steps of a list that belong to the option, as the runbook reads them: a step of no option stays, a step labelled
 * with this option's id stays without its label, a step labelled with another option's id is dropped. `text` and `rebuild`
 * read and replace the text of an item (a string by default).
 */
function stepsOfOption(steps, ids, optionId, text = (step) => step, rebuild = (step, label) => label) {
    return steps.flatMap((step) => {
        const prefix = STEP_PREFIX.exec(text(step));
        if (prefix && ids.has(prefix[1])) {
            if (prefix[1] !== optionId) return [];
            return [rebuild(step, capital(text(step).slice(prefix[0].length)))];
        }
        return [step];
    });
}

/** The Validate row of a chapter whose target accepts the gap: the gap is recorded, nothing else is tested. */
const GAP_ROW = [
    "Gap recorded", "The type is listed in report section D as a documented exception (owner's choice) or as an open decision (default)",
    "Read report sections 2 and D", "The report", "Each assessment run", OWNER_ROLE_FILL,
];

/**
 * The chapter that each later chapter points at, by chapter number: a chapter whose playbook and target option are
 * those of an earlier chapter is built with it, so its steps and criteria are not repeated (contracts 6.6). An accept-gap
 * target is never a pointer.
 */
function leadsOf(chapters) {
    const first = new Map();
    const leads = new Map();
    for (const chapter of chapters) {
        const id = targetOf(chapter.row).option?.id;
        // an accept-gap chapter builds nothing, so each keeps its own Gap recorded row
        if (typeof chapter.playbook !== "string" || !id || id === RESERVED_OPTION_ID) continue;
        const key = `${chapter.playbook}\n${id}`;
        if (first.has(key)) leads.set(chapter.n, first.get(key));
        else first.set(key, chapter);
    }
    return leads;
}

/** The parts Prerequisites to Decommission of a chapter that is built with chapter `lead`. */
function pointerParts(lead) {
    const n = lead.n;
    const see = [`See chapter ${n}.`];
    const row = [
        `Covered by chapter ${n}`, `Every criterion of chapter ${n} passes for the resources of this type too`,
        `The measurements of chapter ${n}, run on this type's resources`, `The evidence of chapter ${n}`, `As chapter ${n}`, OWNER_ROLE_FILL,
    ];
    return { prerequisites: see, build: see, validate: [...tableHead(VALIDATE_HEADER), tableRow(row)], cutOver: see, decommission: see };
}

/** The parts Prerequisites to Decommission of a chapter whose target accepts the gap: nothing is built or removed. */
const GAP_PARTS = {
    prerequisites: ["None."],
    build: ["None: the gap is accepted, nothing is built in the DR region."],
    validate: [...tableHead(VALIDATE_HEADER), tableRow(GAP_ROW)],
    cutOver: ["None: nothing moves."],
    decommission: ["Keep today's paired setup: it stays the only recovery path of this type."],
};

/**
 * The parts Prerequisites to Decommission from the playbook option of the target, or fill markers without one. A list
 * that is empty after filtering by option gets a fill marker; a split-region target also asks for its cross-region path.
 */
function stepParts(doc, playbook, target, option) {
    const split = target.option?.kind === "split-region";
    const pair = target.option?.targetRegion ?? "the pair region";
    const splitFill = (what) => fillMarker(`${what}: the split-region option keeps the paired setup of this service, so write the cross-region steps (the network path from ${doc.regions.dr} to ${pair} and the residency check)`);
    const rows = validateRows(playbook, option);
    const criteria = [
        ...(rows.length === 0 ? [fillMarker("one row per test criterion that proves the target: a measurable pass condition, how to measure it, the evidence to keep, the frequency and the owner role"), ""] : []),
        ...tableHead(VALIDATE_HEADER),
        ...rows.map(tableRow),
    ];
    if (!option) {
        return {
            prerequisites: [fillMarker("quota, SKU, network and roles that the target needs in the DR region")],
            build: [fillMarker("the build steps in the DR region, in order")],
            validate: criteria,
            cutOver: [fillMarker("the cut-over steps and their order relative to the other chapters")],
            decommission: [fillMarker("what to remove of the paired setup, only after the Validate criteria have passed, and what must stay until then")],
        };
    }
    const ids = new Set(playbook.options.map((o) => o.id));
    const migration = (list) => numbered(stepsOfOption(list, ids, option.id));
    const [build, procedure, cutOver, decommission] = [playbook.migration.build, playbook.migration.validate, playbook.migration.cutOver, playbook.migration.decommission].map(migration);
    const across = fillMarker(`the network path from the consumers in ${doc.regions.dr} to the service in ${pair}, and the residency result of reading across regions`);
    return {
        prerequisites: [`${capital(sentence(option.prerequisites))}.`],
        build: build.length === 0
            ? [split ? splitFill("the build steps") : fillMarker("the build steps in the DR region, in order")]
            : [...build, ...(split ? ["", across] : [])],
        validate: [...(procedure.length > 0 ? [...procedure, ""] : []), ...criteria],
        cutOver: cutOver.length > 0 ? cutOver : [split ? splitFill("the cut-over steps") : fillMarker("the cut-over steps and their order relative to the other chapters")],
        decommission: [
            "Only after every criterion of Validate has passed.", "",
            ...(decommission.length > 0 ? decommission : [split ? splitFill("what stays of the paired setup") : fillMarker("what to remove of the paired setup, if anything")]),
            "", `Keep until cut-over: ${sentence(playbook.migration.keep)}.`,
        ],
    };
}

/** One chapter of the guide (contracts 6.6); `lead` is the chapter it is built with, if any. */
function chapterText(chapter, doc, playbooks, lead) {
    const { row } = chapter;
    const playbook = playbookOf(row, playbooks);
    const target = targetOf(row);
    const option = playbookOption(playbook, target);
    const part = (name, body) => [`### ${name}`, "", ...body, ""];
    const recognise = playbook ? ` How to recognise it: ${sentence(playbook.migration.recognise)}.` : "";

    const lines = [`<a id="chapter-${chapter.anchor}"></a>`, "", `## Chapter ${chapter.n}: ${chapter.title} (${row.type})`, ""];
    if (!playbook) lines.push(NO_PLAYBOOK_LINE, "");
    lines.push(...part("Today", [fillMarker(`today's DR setup of the ${resources(row.count)} from the inventory, citing F- ids (for example a replica in the primary's pair); write Unknown when the inventory does not show it, never leave it out.${recognise}`)]));
    if (playbook || target.decided) {
        const about = targetLines(row, target, doc);
        if (lead) about.splice(-1, 0, `Built with chapter ${lead.n} (${lead.title}): the same playbook and option cover this type.`, "");
        lines.push(...part("Target", about));
    } else {
        const o = target.option;
        const ask = o.id === RESERVED_OPTION_ID
            ? "Say that the type stays an Unmet requirement and what that leaves uncovered"
            : `Give the Estimated RPO (${sentence(o.rpo)}) and RTO (${sentence(o.rto)}), the tier fit, what it gives up and why it fits; write Unknown for what Learn does not support`;
        lines.push(...part("Target", [fillMarker(`the target: ${sentence(o.title)} (${o.id}, ${kindLabel(o)}) from ${sourceText(o, row)}; chosen by: ${chosenText(row, target)} ${ask}`)]));
    }
    const gap = target.option?.id === RESERVED_OPTION_ID;
    const parts = lead ? pointerParts(lead) : gap ? GAP_PARTS : stepParts(doc, playbook, target, option);
    lines.push(...part("Prerequisites", parts.prerequisites));
    lines.push(...part("Build", parts.build));
    lines.push(...part("Validate", parts.validate));
    lines.push(...part("Cut-over", parts.cutOver));
    lines.push(...part("Decommission the paired setup", parts.decommission));
    lines.push(...part("Failover and failback", [
        `See [subsection ${chapter.n} of section 3 of the recovery runbook](recovery-runbook.md#runbook-${chapter.anchor}).`, "",
        fillMarker("a summary of the failover and failback of this service"),
    ]));
    lines.push(...part("Open inputs", [fillMarker("what the application team must supply for this chapter, or None")]));
    return lines.join("\n");
}

/** One line of the generated build order. */
function buildOrderLine(chapter) {
    const target = targetOf(chapter.row);
    const what = target.decided ? `decided by ${target.decided.ref}` : `${kindLabel(target.option)}: ${sentence(target.option.title)}`;
    const fallback = chapter.slot ? null : fallbackSlot(chapter.type);
    const slot = fallback ? `slot \`${fallback}\` (from the ARM namespace)` : `slot \`${chapter.slot ?? "none"}\``;
    return `${chapter.n}. [${chapter.title}](#chapter-${chapter.anchor}) (\`${chapter.type}\`): ${slot}; ${what}.`;
}

/**
 * The guide skeleton (contracts 6.6) from the template: the build order and one chapter per type of dr-options.json
 * in build order. `playbooks` maps a service to its parsed playbook. Returns the text and the chapter plan.
 */
export function guideSkeleton({ doc, playbooks, template }) {
    for (const slot of [BUILD_ORDER_SLOT, CHAPTERS_SLOT]) {
        if (template.split(slot).length !== 2) throw new CliError(EXIT.INPUT, "the guide template is missing a generator slot", [`${slot} must appear once on a line of its own`]);
    }
    const chapters = chapterPlan(doc);
    const leads = leadsOf(chapters);
    const order = chapters.length > 0 ? chapters.map(buildOrderLine).join("\n") : "No in-scope type: nothing to establish.";
    const body = chapters.map((chapter) => chapterText(chapter, doc, playbooks, leads.get(chapter.n))).join("\n").replace(/\n+$/, "");
    const text = template.replace(BUILD_ORDER_SLOT, () => order).replace(CHAPTERS_SLOT, () => body);
    return { text, chapters: chapters.map(({ n, type, title, slot, playbook, anchor }) => ({ n, type, title, slot, playbook, anchor })) };
}

/** The playbook's rows of one part (failover or failback) that belong to the option: rows of no option and of this one. */
function stepRows(playbook, optionId, part) {
    const ids = new Set(playbook.options.map((o) => o.id));
    return stepsOfOption(playbook.steps[part], ids, optionId, (s) => s.step, (s, step) => ({ ...s, step }));
}

/**
 * Runbook section 3 (contracts 6.6): one subsection per chapter, in build order, each with the anchor
 * `runbook-<chapter anchor>` on the line before its heading, the playbook's failover rows, the cross-region row of a
 * split-region target, then the failback rows. A playbook's durations start with the word Estimated (the lint refuses
 * others). A target without playbook steps gets one row of fill markers; a chapter built with an earlier one gets one
 * row that points at that subsection.
 */
export function runbookSkeleton({ doc, playbooks }) {
    const chapters = chapterPlan(doc);
    const leads = leadsOf(chapters);
    const blocks = chapters.map((chapter) => {
        const { row } = chapter;
        const playbook = playbookOf(row, playbooks);
        const target = targetOf(row);
        const option = playbookOption(playbook, target);
        const lead = leads.get(chapter.n);
        const lines = [`<a id="runbook-${chapter.anchor}"></a>`, `### ${chapter.n}. ${chapter.title}`, ""];
        const what = target.decided ? `decided by ${target.decided.ref}` : `${sentence(target.option.title)} (\`${target.option.id}\`)`;
        lines.push(`Target: ${what}. See [chapter ${chapter.n} of the DR establishment guide](dr-establishment-guide.md#chapter-${chapter.anchor}).`, "");
        lines.push(...tableHead(RUNBOOK_HEADER));
        const rows = [];
        if (lead) {
            const m = lead.n;
            rows.push([`With ${m}`, `Recovered by the steps of subsection ${m}; no steps of its own`, OWNER_ROLE_FILL, `Estimated: included in subsection ${m}`, `the criteria of chapter ${m} pass for this type`, `As subsection ${m}`]);
        } else {
            if (option) stepRows(playbook, option.id, "failover").forEach((s, i) => rows.push([`Failover ${i + 1}`, s.step, s.role, s.duration, s.verification, s.abort]));
            if (target.option?.kind === "split-region") {
                const pair = target.option.targetRegion ?? "the primary's pair";
                rows.push([`Failover ${rows.length + 1}`, `Point the consumers in ${doc.regions.dr} at the ${chapter.title} in ${pair}`, OWNER_ROLE_FILL, "Estimated: measured in the first drill", `the consumers read from ${pair}`, `A consumer cannot read from ${pair}`]);
            }
            if (option) stepRows(playbook, option.id, "failback").forEach((s, i) => rows.push([`Failback ${i + 1}`, s.step, s.role, s.duration, s.verification, s.abort]));
            if (!option) rows.push(["order", "step", "owner role", "Estimated duration", "verification", "abort condition"].map((what) => fillMarker(what)));
        }
        lines.push(...rows.map(tableRow));
        return lines.join("\n");
    });
    return { text: blocks.join("\n\n"), services: chapters.length };
}

export const TEST_PLAN_HEADER = ["Service", "Criterion", "Pass condition", "Frequency", "Owner role"];
export const TEST_PLAN_MARKERS = ["<!-- dr-guide:test-plan -->", "<!-- /dr-guide:test-plan -->"];
export const RUNBOOK_MARKERS = ["<!-- dr-guide:runbook -->", "<!-- /dr-guide:runbook -->"];
/** The block of commands that the owner asked for may close a chapter (spec 8.6). */
const COMMANDS_PART = /^Commands \(untested, .+\)$/;
const CHAPTER = /^## Chapter (\d+): (.+) \(([^()\s]+)\)$/;
const BANNED = ["compliant", "achieved", "guaranteed"];

/** The cells of one markdown table row, with escaped pipes restored. */
function cells(line) {
    const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/**
 * The chapters of a guide: number, title, ARM type, the parts in order and the rows of the Validate table. Headings
 * inside code fences do not count.
 */
export function parseGuide(text) {
    const chapters = [];
    let chapter = null;
    let current = null;
    let fence = null;
    String(text).split("\n").forEach((line, i) => {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
        if (fence !== null) {
            if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
            return;
        }
        if (marker) {
            fence = marker;
            return;
        }
        if (line.startsWith("## ")) {
            const m = CHAPTER.exec(line);
            chapter = m ? { n: Number(m[1]), title: m[2], type: m[3], line: i + 1, parts: [] } : null;
            if (chapter) chapters.push(chapter);
            current = null;
            return;
        }
        if (!chapter) return;
        if (line.startsWith("### ")) {
            current = { name: line.slice(4).trim(), line: i + 1, header: null, rows: [], lines: [] };
            chapter.parts.push(current);
            return;
        }
        current?.lines.push(line);
        if (current?.name === "Validate" && line.trim().startsWith("|")) {
            if (current.header === null) current.header = cells(line);
            else if (!/^\|?\s*:?-{3,}/.test(line.trim()) || current.rows.length > 0) current.rows.push({ cells: cells(line), line: i + 1 });
        }
    });
    return chapters;
}

/** The consolidated test plan (contracts 6.6): one row per Validate row, in chapter order. */
export function testPlanTable(chapters) {
    const rows = chapters.flatMap((chapter) => {
        const validate = chapter.parts.find((p) => p.name === "Validate");
        return (validate?.rows ?? []).map((row) => [chapter.title, row.cells[0], row.cells[1], row.cells[4], row.cells[5]]);
    });
    return [...tableHead(TEST_PLAN_HEADER), ...rows.map(tableRow)].join("\n");
}

/** Replace the text between a marker pair; a missing pair throws CliError(INPUT) and nothing is written. */
export function injectBetween(text, [open, close], block, what) {
    const start = text.indexOf(open);
    const end = text.indexOf(close);
    if (start < 0 || end < start) throw new CliError(EXIT.INPUT, `the ${what} is missing its markers, so nothing was written`, [`${open} ... ${close}`]);
    return `${text.slice(0, start + open.length)}\n${block}\n${text.slice(end)}`;
}

/** The guide with its consolidated test plan rebuilt from the Validate tables of its chapters. */
export function injectGuideTables(text) {
    const chapters = parseGuide(text);
    const criteria = chapters.reduce((sum, c) => sum + (c.parts.find((p) => p.name === "Validate")?.rows.length ?? 0), 0);
    return { text: injectBetween(text, TEST_PLAN_MARKERS, testPlanTable(chapters), "guide"), criteria };
}

/** The labels of the Target lines that establishment-guide writes and owns: the model keeps them as written. */
const OWNED_TARGET_LINE = /^- (Option|Source|Chosen by|Estimated RPO|Tier \d+|Decided by)\b/;

/**
 * The Target lines that --write wrote for a row and that the model must keep: option, source, who chose it, the
 * estimates and the tier result, or the "Decided by" line. A type without a playbook has none (its Target is model text).
 */
export function ownedTargetLines(row, doc) {
    const target = targetOf(row);
    if (typeof row.playbook !== "string" && !target.decided) return [];
    return targetLines(row, target, doc).filter((line) => OWNED_TARGET_LINE.test(line));
}

/** The problems of a chapter whose Target lost or changed a line that the script owns. */
function targetProblems(chapter, row, doc) {
    const target = chapter.parts.find((p) => p.name === "Target");
    if (!target || !row) return [];
    const kept = new Set(target.lines.map((line) => line.trim()));
    return ownedTargetLines(row, doc).filter((line) => !kept.has(line)).map((line) => (
        `Chapter ${chapter.n} (${chapter.type}): the Target line "${OWNED_TARGET_LINE.exec(line)[1]}" is written by establishment-guide and is missing or changed; restore it: ${line}`
    ));
}

/** The problems of the parts of one chapter: every part once, in order; only a commands block may follow them. */
function partProblems(chapter) {
    const names = chapter.parts.map((p) => p.name);
    const at = `Chapter ${chapter.n} (${chapter.type})`;
    const problems = [];
    const known = names.filter((name) => GUIDE_PARTS.includes(name));
    for (const name of GUIDE_PARTS.filter((n) => !names.includes(n))) problems.push(`${at}: the part "${name}" is missing`);
    const order = GUIDE_PARTS.filter((n) => known.includes(n));
    if (known.join("\n") !== order.join("\n")) problems.push(`${at}: the parts are out of order; the order is ${GUIDE_PARTS.join(", ")}`);
    const lastKnown = names.reduce((last, name, i) => (GUIDE_PARTS.includes(name) ? i : last), -1);
    names.forEach((name, i) => {
        if (GUIDE_PARTS.includes(name)) return;
        if (COMMANDS_PART.test(name) && i > lastKnown) return;
        problems.push(`${at}: the part "${name}" is not a part of a chapter (a block "Commands (untested, <form>)" may only close it)`);
    });
    const validate = chapter.parts.find((p) => p.name === "Validate");
    if (validate) {
        if (validate.header === null || validate.header.join("|") !== VALIDATE_HEADER.join("|")) {
            problems.push(`${at}: the Validate part needs the table | ${VALIDATE_HEADER.join(" | ")} |`);
        }
        if (validate.rows.length === 0) problems.push(`chapter ${chapter.n}: Validate has no criterion`);
        validate.rows.forEach((row, k) => {
            if (row.cells.length !== VALIDATE_HEADER.length || row.cells.some((c) => c === "")) {
                problems.push(`${at}: Validate row ${k + 1} (line ${row.line}) needs ${VALIDATE_HEADER.length} non-empty cells: ${VALIDATE_HEADER.join(", ")}`);
            }
        });
    }
    return problems;
}

/**
 * The refusals of `establishment-guide --check` (contracts 6.6), as one line each: missing, extra or misplaced
 * chapters against dr-options.json, missing or misplaced parts, a fill marker left, a Validate table without a row,
 * an incomplete Validate row, a Target line of the script missing or changed, a test plan that differs from the Validate
 * rows, an RPO or RTO with a number but no label, and the banned words.
 */
export function checkGuide(text, doc) {
    const problems = [];
    const chapters = parseGuide(text);
    const expected = orderTypes(doc.types).map((row) => row.type);
    const found = chapters.map((c) => c.type);
    for (const type of expected.filter((t) => !found.includes(t))) problems.push(`the chapter of ${type} is missing`);
    for (const type of [...new Set(found.filter((t) => !expected.includes(t)))]) problems.push(`the chapter of ${type} is not a type of evidence/dr-options.json`);
    for (const type of [...new Set(found.filter((t, i) => found.indexOf(t) !== i))]) problems.push(`the chapter of ${type} appears more than once`);
    const kept = found.filter((t) => expected.includes(t));
    if (kept.join("\n") !== expected.filter((t) => kept.includes(t)).join("\n")) problems.push(`the chapters are out of build order; the order is ${expected.join(", ")}`);
    chapters.forEach((c, i) => {
        if (c.n !== i + 1) problems.push(`Chapter ${c.n} (${c.type}) is chapter ${i + 1}: number the chapters 1, 2, 3 in order`);
    });
    const rows = new Map(doc.types.map((row) => [row.type, row]));
    for (const chapter of chapters) problems.push(...partProblems(chapter), ...targetProblems(chapter, rows.get(chapter.type), doc));

    const start = text.indexOf(TEST_PLAN_MARKERS[0]);
    const end = text.indexOf(TEST_PLAN_MARKERS[1]);
    if (start < 0 || end < start) {
        problems.push(`the consolidated test plan markers are missing: ${TEST_PLAN_MARKERS.join(" ... ")}`);
    } else if (text.slice(start + TEST_PLAN_MARKERS[0].length, end).trim() !== testPlanTable(chapters)) {
        problems.push("the consolidated test plan differs from the Validate rows: run establishment-guide --tables");
    }

    String(text).split("\n").forEach((line, i) => {
        const at = `line ${i + 1}`;
        if (line.includes("<!-- fill:")) problems.push(`${at}: a fill marker is left`);
        if (/\b(RPO|RTO)\b/.test(line) && /\d/.test(line) && !/\b(Estimated|Demonstrated)\b/i.test(line)) {
            problems.push(`${at}: an RPO or RTO with a number is not labelled Estimated or Demonstrated`);
        }
        for (const word of BANNED) {
            if (new RegExp(`\\b${word}\\b`, "i").test(line)) problems.push(`${at}: the word "${word}" is not used: nothing is ${word} without a drill record`);
        }
    });
    return problems;
}
