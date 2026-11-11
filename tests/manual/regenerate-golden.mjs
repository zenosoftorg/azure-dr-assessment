// Manual helper, not part of `npm test`: rewrite tests/fixtures/golden/checkout-current-state.arch.json from the fixture
// spec and ledger. Run it only after an intended change of the vendored layout or of the builder, then review the diff.
//
//   node tests/manual/regenerate-golden.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildDiagram } from "../../skills/azure-dr-assessment/scripts/lib/diagram-spec.mjs";
import { loadCanvasModules } from "../../skills/azure-dr-assessment/scripts/lib/paths.mjs";
import { makeFixtureLedger, readFixtureSpec } from "../helpers/diagram-ledger.mjs";
import { makeIconRoot } from "../helpers/icons-fixture.mjs";

const golden = path.resolve(import.meta.dirname, "..", "fixtures", "golden", "checkout-current-state.arch.json");
const canvas = await loadCanvasModules();
const catalog = await canvas.icons.buildCatalog(makeIconRoot());
const { diagram } = buildDiagram(readFixtureSpec(), { ledger: makeFixtureLedger(), catalog, modules: canvas });
diagram.updatedAt = "2026-01-01T00:00:00.000Z";
writeFileSync(golden, `${JSON.stringify(diagram, null, 2)}\n`);
console.log(`wrote ${golden}`);
