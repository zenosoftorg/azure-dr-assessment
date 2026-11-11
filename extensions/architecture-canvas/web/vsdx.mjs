// Visio .vsdx export.
//
// A .vsdx is an OPC package: a ZIP of XML parts. Everything here is written by
// hand against the schema Visio itself produces (verified by round-tripping a
// reference drawing through Visio), so the extension keeps its zero-dependency
// footprint — no ZIP library, no SVG rasteriser.
//
// Two coordinate quirks drive most of the code below:
//   * Visio works in inches, the canvas in CSS pixels.
//   * Visio's Y axis points up from the bottom-left; SVG's points down.

const PX_PER_IN = 96;
const PAD_PX = 60;
const NODE_W = 104;
const NODE_H = 84;
const ICON = 40;
const ICON_RASTER = 160;          // 4x, so icons stay sharp when scaled up

const VNS = "http://schemas.microsoft.com/office/visio/2012/main";
const RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ------------------------------------------------------------------ zip

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * Minimal ZIP writer, stored (uncompressed) entries only. Office reads stored
 * entries happily and it keeps this dependency-free; the payload is XML plus a
 * handful of small PNGs, so the size difference does not matter.
 */
function zip(entries) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;

    const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
    const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

    for (const { name, data } of entries) {
        const bytes = typeof data === "string" ? enc.encode(data) : data;
        const nameBytes = enc.encode(name);
        const sum = crc32(bytes);

        const local = [
            ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
            ...u16(0), ...u16(0),                       // no timestamp: reproducible output
            ...u32(sum), ...u32(bytes.length), ...u32(bytes.length),
            ...u16(nameBytes.length), ...u16(0),
        ];
        chunks.push(new Uint8Array(local), nameBytes, bytes);

        central.push([
            ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
            ...u16(0), ...u16(0),
            ...u32(sum), ...u32(bytes.length), ...u32(bytes.length),
            ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
            ...u32(0), ...u32(offset),
            ...[...nameBytes],
        ]);
        offset += local.length + nameBytes.length + bytes.length;
    }

    const dir = central.flat();
    const end = [
        ...u32(0x06054b50), ...u16(0), ...u16(0),
        ...u16(entries.length), ...u16(entries.length),
        ...u32(dir.length), ...u32(offset), ...u16(0),
    ];
    chunks.push(new Uint8Array(dir), new Uint8Array(end));
    return new Blob(chunks, { type: "application/vnd.ms-visio.drawing" });
}

// ------------------------------------------------------------------ helpers

const xml = (s) =>
    String(s ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const num = (n) => (Math.round(n * 1e6) / 1e6).toString();

/** Blend an rgba()/hex colour down onto white; Visio fills are opaque here. */
function solidColor(input, fallback = "#FFFFFF") {
    if (!input) return fallback;
    const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(input);
    if (rgba) {
        const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
        const mix = (c) => Math.round(Number(c) * a + 255 * (1 - a));
        return `#${[mix(rgba[1]), mix(rgba[2]), mix(rgba[3])].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    }
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
    if (!hex) return fallback;
    const h = hex[1];
    return `#${h.length === 3 ? [...h].map((c) => c + c).join("") : h}`.toUpperCase();
}

const cell = (n, v, f) => `<Cell N='${n}' V='${xml(v)}'${f ? ` F='${xml(f)}'` : ""}/>`;

/**
 * Shape Data row carrying an element's markdown annotation verbatim, plus a
 * ScreenTip so the text is actually readable inside Visio.
 *
 * Visio cannot render markdown or HTML anywhere, so rather than degrade the
 * text this keeps the source exactly as written — newlines, tables and all.
 * The two surfaces are complementary: the Shape Data row (Ctrl+Shift+D) is the
 * exact source and survives a round-trip, but its panel is a single-line grid
 * and no Visio property type wraps. The ScreenTip does render line breaks, so
 * hovering a shape behaves like the hover card on the canvas.
 *
 * The Shape Data value is written as element content rather than a V attribute
 * because it is multi-line; that is the form Visio itself emits.
 */
const annotationCells = (markdown) =>
    markdown
        ? `<Cell N='Comment'>${xml(markdown)}</Cell>`
        : "";

const annotationSection = (markdown) =>
    markdown
        ? `<Section N='Property'><Row N='Annotation'>` +
          `<Cell N='Label' V='Annotation'/>` +
          `<Cell N='Type' V='0'/>` +
          `<Cell N='Prompt' V='Markdown annotation from the architecture canvas'/>` +
          `<Cell N='Value' U='STR'>${xml(markdown)}</Cell>` +
          `</Row></Section>`
        : "";

/**
 * Trim a centre-to-centre run back to each node's bounding box, so the drawn
 * line meets the edge of the shape instead of disappearing underneath it.
 * Mirrors the canvas renderer's edgeAnchor.
 */
function clipEnds(from, to) {
    const a = { x: from.x + NODE_W / 2, y: from.y + NODE_H / 2 };
    const b = { x: to.x + NODE_W / 2, y: to.y + NODE_H / 2 };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (!dx && !dy) return [a, b];
    const hw = NODE_W / 2 + 4;
    const hh = NODE_H / 2 + 4;
    const scale = Math.min(
        dx === 0 ? Infinity : hw / Math.abs(dx),
        dy === 0 ? Infinity : hh / Math.abs(dy),
    );
    return [
        { x: a.x + dx * scale, y: a.y + dy * scale },
        { x: b.x - dx * scale, y: b.y - dy * scale },
    ];
}

/** Rectangular geometry expressed the way Visio writes it. */const rectGeometry = (noFill = 0) =>
    `<Section N='Geometry' IX='0'>${cell("NoFill", noFill)}${cell("NoLine", 0)}${cell("NoShow", 0)}${cell("NoSnap", 0)}${cell("NoQuickDrag", 0)}` +
    `<Row T='RelMoveTo' IX='1'>${cell("X", 0)}${cell("Y", 0)}</Row>` +
    `<Row T='RelLineTo' IX='2'>${cell("X", 1)}${cell("Y", 0)}</Row>` +
    `<Row T='RelLineTo' IX='3'>${cell("X", 1)}${cell("Y", 1)}</Row>` +
    `<Row T='RelLineTo' IX='4'>${cell("X", 0)}${cell("Y", 1)}</Row>` +
    `<Row T='RelLineTo' IX='5'>${cell("X", 0)}${cell("Y", 0)}</Row>` +
    `</Section>`;

// ------------------------------------------------------------------ icons

/**
 * Icons are SVG, but Visio's ForeignData wants a bitmap. Rasterise through a
 * canvas at 4x so they stay crisp if the shape is enlarged.
 */
async function rasterizeIcon(href) {
    const source = await (await fetch(href)).text();
    const blobUrl = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
    try {
        const img = new Image();
        img.decoding = "sync";
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error("icon failed to load"));
            img.src = blobUrl;
        });
        const canvas = document.createElement("canvas");
        canvas.width = ICON_RASTER;
        canvas.height = ICON_RASTER;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, ICON_RASTER, ICON_RASTER);
        const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        return new Uint8Array(await png.arrayBuffer());
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}

// ------------------------------------------------------------------ parts

const CONTENT_TYPES = (mediaExts) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    (mediaExts.has("png") ? `<Default Extension="png" ContentType="image/png"/>` : "") +
    `<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>` +
    `<Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/>` +
    `<Override PartName="/visio/masters/master1.xml" ContentType="application/vnd.ms-visio.master+xml"/>` +
    `<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>` +
    `<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>` +
    `<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `</Types>`;

const ROOT_RELS =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `</Relationships>`;

const DOC_RELS =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/masters" Target="masters/masters.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/>` +
    `</Relationships>`;

const coreProps = (title) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"` +
    ` xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${xml(title)}</dc:title>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created>` +
    `</cp:coreProperties>`;

const DOCUMENT_XML =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<VisioDocument xmlns="${VNS}" xmlns:r="${RNS}" xml:space="preserve">` +
    `<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0">` +
    `<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings>` +
    `<SnapExtensions>34</SnapExtensions><DynamicGridEnabled>1</DynamicGridEnabled>` +
    `<ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes>` +
    `<ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds>` +
    `</DocumentSettings>` +
    `<StyleSheets>` +
    `<StyleSheet ID='0' NameU='No Style' Name='No Style'>` +
    `<Cell N='LineWeight' V='0.01'/><Cell N='LineColor' V='#000000'/><Cell N='LinePattern' V='1'/>` +
    `<Cell N='FillForegnd' V='#ffffff'/><Cell N='FillPattern' V='1'/>` +
    `<Cell N='CharSize' V='0.1666666666666667'/><Cell N='CharColor' V='#000000'/>` +
    `</StyleSheet>` +
    `</StyleSheets>` +
    `<DocumentSheet NameU='TheDoc' LineStyle='0' FillStyle='0' TextStyle='0'/>` +
    `</VisioDocument>`;

const WINDOWS_XML =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Windows xmlns="${VNS}" xmlns:r="${RNS}" ClientWidth="1600" ClientHeight="900"/>`;

const MASTERS_RELS =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/master" Target="master1.xml"/>` +
    `</Relationships>`;

// Visio's own dynamic connector master. Reproducing it (rather than drawing a
// plain line) is what makes exported connectors real connectors: they re-route
// automatically and stay glued when shapes are dragged.
const MASTERS_XML =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Masters xmlns="${VNS}" xmlns:r="${RNS}" xml:space="preserve">` +
    `<Master ID='2' NameU='Dynamic connector' IsCustomNameU='1' Name='Dynamic connector' IsCustomName='1'` +
    ` Prompt='This connector automatically routes between the shapes it connects.'` +
    ` IconSize='1' AlignName='2' MatchByName='1' IconUpdate='0'` +
    ` UniqueID='{002AACFF-0000-0000-8E40-00608CF305B2}' BaseID='{F7290A45-E3AD-11D2-AE4F-006008C9F5A9}'` +
    ` PatternFlags='0' Hidden='0' MasterType='0'>` +
    `<PageSheet LineStyle='0' FillStyle='0' TextStyle='0'>` +
    `<Cell N='PageWidth' V='3.937007874015748'/><Cell N='PageHeight' V='3.937007874015748'/>` +
    `<Cell N='PageScale' V='0.03937007874015748' U='MM'/><Cell N='DrawingScale' V='0.03937007874015748' U='MM'/>` +
    `<Cell N='DrawingSizeType' V='4'/><Cell N='DrawingScaleType' V='0'/><Cell N='DrawingResizeType' V='0'/>` +
    `<Section N='Layer'><Row IX='0'>` +
    `<Cell N='Name' V='Connector'/><Cell N='Color' V='255'/><Cell N='Status' V='0'/><Cell N='Visible' V='1'/>` +
    `<Cell N='Print' V='1'/><Cell N='Active' V='0'/><Cell N='Lock' V='0'/><Cell N='Snap' V='1'/>` +
    `<Cell N='Glue' V='1'/><Cell N='NameUniv' V='Connector'/><Cell N='ColorTrans' V='0'/>` +
    `</Row></Section></PageSheet><Rel r:id='rId1'/></Master></Masters>`;

const MASTER1_XML =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<MasterContents xmlns="${VNS}" xmlns:r="${RNS}" xml:space="preserve"><Shapes>` +
    `<Shape ID='5' OriginalID='0' Type='Shape' LineStyle='0' FillStyle='0' TextStyle='0'>` +
    `<Cell N='PinX' V='1.771653543307087' F='GUARD((BeginX+EndX)/2)'/>` +
    `<Cell N='PinY' V='1.771653543307087' F='GUARD((BeginY+EndY)/2)'/>` +
    `<Cell N='Width' V='1.181102362204724' F='GUARD(EndX-BeginX)'/>` +
    `<Cell N='Height' V='-1.181102362204724' F='GUARD(EndY-BeginY)'/>` +
    `<Cell N='LocPinX' V='0.5905511811023622' F='GUARD(Width*0.5)'/>` +
    `<Cell N='LocPinY' V='-0.5905511811023622' F='GUARD(Height*0.5)'/>` +
    `<Cell N='Angle' V='0' F='GUARD(0DA)'/>` +
    `<Cell N='FlipX' V='0' F='GUARD(FALSE)'/><Cell N='FlipY' V='0' F='GUARD(FALSE)'/>` +
    `<Cell N='ResizeMode' V='0'/>` +
    `<Cell N='BeginX' V='1.181102362204724'/><Cell N='BeginY' V='2.362204724409449'/>` +
    `<Cell N='EndX' V='2.362204724409449'/><Cell N='EndY' V='1.181102362204724'/>` +
    `<Cell N='TxtPinX' V='0' F='SETATREF(Controls.TextPosition)'/>` +
    `<Cell N='TxtPinY' V='-1.181102362204724' F='SETATREF(Controls.TextPosition.Y)'/>` +
    `<Cell N='TxtWidth' V='0.5555555555555556' F='MAX(TEXTWIDTH(TheText),5*Char.Size)'/>` +
    `<Cell N='TxtHeight' V='0.2444444444444444' F='TEXTHEIGHT(TheText,TxtWidth)'/>` +
    `<Cell N='TxtLocPinX' V='0.2777777777777778' F='TxtWidth*0.5'/>` +
    `<Cell N='TxtLocPinY' V='0.1222222222222222' F='TxtHeight*0.5'/>` +
    `<Cell N='TxtAngle' V='0'/><Cell N='LockHeight' V='1'/><Cell N='LockCalcWH' V='1'/>` +
    `<Cell N='NoAlignBox' V='1'/><Cell N='DynFeedback' V='2'/><Cell N='GlueType' V='2'/>` +
    `<Cell N='ObjType' V='2'/><Cell N='NoLiveDynamics' V='1'/><Cell N='ShapeSplittable' V='1'/>` +
    `<Cell N='LayerMember' V='0'/>` +
    `<Section N='Control'><Row N='TextPosition'>` +
    `<Cell N='X' V='0'/><Cell N='Y' V='-1.181102362204724'/>` +
    `<Cell N='XDyn' V='0' F='Controls.TextPosition'/>` +
    `<Cell N='YDyn' V='-1.181102362204724' F='Controls.TextPosition.Y'/>` +
    `<Cell N='XCon' V='5' F='IF(OR(STRSAME(SHAPETEXT(TheText),&quot;&quot;),HideText),5,0)'/>` +
    `<Cell N='YCon' V='0'/><Cell N='CanGlue' V='0'/><Cell N='Prompt' V='Reposition Text'/>` +
    `</Row></Section>` +
    `<Section N='Geometry' IX='0'>` +
    `<Cell N='NoFill' V='1'/><Cell N='NoLine' V='0'/><Cell N='NoShow' V='0'/>` +
    `<Cell N='NoSnap' V='0'/><Cell N='NoQuickDrag' V='0'/>` +
    `<Row T='MoveTo' IX='1'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>` +
    `<Row T='LineTo' IX='2'><Cell N='X' V='0'/><Cell N='Y' V='-1.181102362204724'/></Row>` +
    `<Row T='LineTo' IX='3'><Cell N='X' V='1.181102362204724'/><Cell N='Y' V='-1.181102362204724'/></Row>` +
    `</Section></Shape></Shapes></MasterContents>`;

// ------------------------------------------------------------------ export

/**
 * Build a .vsdx from a diagram document.
 *
 * @param {object} diagram  nodes / edges / groups, in canvas pixel coordinates
 * @param {(iconId: string) => string} iconHref  resolves a node's icon URL
 */
export async function buildVsdx(diagram, iconHref) {
    const nodes = diagram.nodes ?? [];
    const edges = diagram.edges ?? [];
    const groups = diagram.groups ?? [];

    const boxes = [
        ...nodes.map((n) => ({ x: n.x, y: n.y, w: NODE_W, h: NODE_H })),
        ...groups.map((g) => ({ x: g.x, y: g.y, w: g.width, h: g.height })),
    ];
    if (!boxes.length) throw new Error("nothing to export");

    const minX = Math.min(...boxes.map((b) => b.x)) - PAD_PX;
    const minY = Math.min(...boxes.map((b) => b.y)) - PAD_PX;
    const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + PAD_PX;
    const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + PAD_PX;
    const pageW = (maxX - minX) / PX_PER_IN;
    const pageH = (maxY - minY) / PX_PER_IN;

    const toX = (px) => (px - minX) / PX_PER_IN;
    const toY = (py) => pageH - (py - minY) / PX_PER_IN;   // flip: Visio Y is up
    const toIn = (px) => px / PX_PER_IN;

    const media = [];
    const pageRels = [
        `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/master" Target="../masters/master1.xml"/>`,
    ];
    const shapes = [];
    const connects = [];
    let id = 0;
    const shapeIdOf = new Map();

    // Groups first so they sit behind everything, mirroring the canvas z-order.
    for (const g of groups) {
        id += 1;
        const w = toIn(g.width);
        const h = toIn(g.height);
        shapes.push(
            `<Shape ID='${id}' Type='Shape' LineStyle='0' FillStyle='0' TextStyle='0'>` +
            cell("PinX", num(toX(g.x + g.width / 2))) + cell("PinY", num(toY(g.y + g.height / 2))) +
            cell("Width", num(w)) + cell("Height", num(h)) +
            cell("LocPinX", num(w / 2), "Width*0.5") + cell("LocPinY", num(h / 2), "Height*0.5") +
            cell("Angle", 0) + cell("FlipX", 0) + cell("FlipY", 0) + cell("ObjType", 1) +
            cell("FillForegnd", solidColor(g.background, "#F6F8FA")) + cell("FillPattern", 1) +
            cell("LineColor", solidColor(g.border, "#8C959F")) + cell("LineWeight", 0.01) +
            cell("LinePattern", 2) + cell("Rounding", 0.05) +
            cell("VerticalAlign", 0) + cell("TxtPinY", num(h), "Height*1") +
            cell("TxtHeight", 0.25) + cell("TxtLocPinY", 0.125, "TxtHeight*0.5") +
            cell("TxtWidth", num(w), "Width*1") +
            cell("TxtPinX", num(w / 2), "Width*0.5") +
            cell("TxtLocPinX", num(w / 2), "TxtWidth*0.5") +
            annotationCells(g.annotation) +
            `<Section N='Character'><Row IX='0'>` +
            cell("Size", 0.1111) + cell("Color", solidColor(g.border, "#57606A")) + cell("Style", 1) +
            `</Row></Section>` +
            annotationSection(g.annotation) +
            rectGeometry() +
            `<Text>${xml(g.label ?? "")}</Text>` +
            `</Shape>`,
        );
    }

    // Node boxes. Recorded by id so connectors can glue to them.
    for (const n of nodes) {
        id += 1;
        shapeIdOf.set(n.id, id);
        const w = toIn(NODE_W);
        const h = toIn(NODE_H);
        shapes.push(
            `<Shape ID='${id}' Type='Shape' LineStyle='0' FillStyle='0' TextStyle='0'>` +
            cell("PinX", num(toX(n.x + NODE_W / 2))) + cell("PinY", num(toY(n.y + NODE_H / 2))) +
            cell("Width", num(w)) + cell("Height", num(h)) +
            cell("LocPinX", num(w / 2), "Width*0.5") + cell("LocPinY", num(h / 2), "Height*0.5") +
            cell("Angle", 0) + cell("FlipX", 0) + cell("FlipY", 0) + cell("ObjType", 1) +
            cell("FillForegnd", "#FFFFFF") + cell("FillPattern", 1) +
            cell("LineColor", "#D0D7DE") + cell("LineWeight", 0.01) + cell("LinePattern", 1) +
            cell("Rounding", 0.08) +
            // The label is a single run in a single paragraph. Mixing a second
            // run and paragraph in here to style the sublabel proved unreliable:
            // Visio squeezed the second line to about one character wide. The
            // sublabel is emitted below as its own shape instead.
            // Anchor the label block at its bottom, just above the sublabel, so
            // a label that wraps to two lines grows upward into the icon's
            // whitespace rather than down over the sublabel.
            cell("VerticalAlign", 2) +
            cell("TxtWidth", num(w), "Width*1") +
            cell("TxtPinX", num(w / 2), "Width*0.5") +
            cell("TxtLocPinX", num(w / 2), "TxtWidth*0.5") +
            cell("TxtHeight", num(h * 0.38), "Height*0.38") +
            cell("TxtPinY", num(h * 0.46), "Height*0.46") +
            cell("TxtLocPinY", num(h * 0.19), "TxtHeight*0.5") +
            annotationCells(n.annotation) +
            `<Section N='Character'><Row IX='0'>` +
            cell("Size", 0.0972) + cell("Color", "#1F2328") + cell("Style", 1) +
            `</Row></Section>` +
            `<Section N='Paragraph'><Row IX='0'>${cell("HorzAlign", 1)}</Row></Section>` +
            annotationSection(n.annotation) +
            rectGeometry() +
            `<Text>${xml(n.label ?? "")}</Text>` +
            `</Shape>`,
        );

        if (!n.sublabel) continue;
        id += 1;
        // Its own shape, sized for two wrapped lines and anchored to the top so
        // longer sublabels grow downward predictably. Sits a few pixels below
        // the label block's baseline so the two lines are not crowded.
        const sw = toIn(NODE_W - 4);
        const sh = toIn(26);
        shapes.push(
            `<Shape ID='${id}' Type='Shape' LineStyle='0' FillStyle='0' TextStyle='0'>` +
            cell("PinX", num(toX(n.x + NODE_W / 2))) + cell("PinY", num(toY(n.y + 75))) +
            cell("Width", num(sw)) + cell("Height", num(sh)) +
            cell("LocPinX", num(sw / 2), "Width*0.5") + cell("LocPinY", num(sh / 2), "Height*0.5") +
            cell("Angle", 0) + cell("FlipX", 0) + cell("FlipY", 0) + cell("ObjType", 1) +
            cell("FillPattern", 0) + cell("LinePattern", 0) +
            // Click-through: the sublabel overlays the node box, and selecting it
            // would show an empty Shape Data panel instead of the node's
            // annotation.
            cell("LockSelect", 1) +
            cell("VerticalAlign", 0) +
            cell("TxtWidth", num(sw), "Width*1") +
            cell("TxtPinX", num(sw / 2), "Width*0.5") +
            cell("TxtLocPinX", num(sw / 2), "TxtWidth*0.5") +
            cell("TxtHeight", num(sh), "Height*1") +
            cell("TxtPinY", num(sh / 2), "Height*0.5") +
            cell("TxtLocPinY", num(sh / 2), "TxtHeight*0.5") +
            `<Section N='Character'><Row IX='0'>` +
            cell("Size", 0.0833) + cell("Color", "#59636E") + cell("Style", 0) +
            `</Row></Section>` +
            `<Section N='Paragraph'><Row IX='0'>${cell("HorzAlign", 1)}</Row></Section>` +
            rectGeometry(1) +
            `<Text>${xml(n.sublabel)}</Text>` +
            `</Shape>`,
        );
    }

    // Icons, as separate picture shapes layered over their node box.
    for (const n of nodes) {
        if (!n.iconId) continue;
        let png;
        try {
            png = await rasterizeIcon(iconHref(n));
        } catch {
            continue;                       // a missing icon must not fail the export
        }
        const index = media.length + 1;
        media.push({ name: `visio/media/image${index}.png`, data: png });
        const relId = `rId${pageRels.length + 1}`;
        pageRels.push(
            `<Relationship Id="${relId}" Type="${RNS}/image" Target="../media/image${index}.png"/>`,
        );

        id += 1;
        // Slightly smaller and higher than on the canvas: the canvas truncates
        // long labels to one line, but the export keeps them in full, so the
        // text needs the extra vertical room.
        const size = toIn(ICON - 6);
        shapes.push(
            `<Shape ID='${id}' Type='Foreign' LineStyle='0' FillStyle='0' TextStyle='0'>` +
            cell("PinX", num(toX(n.x + NODE_W / 2))) +
            cell("PinY", num(toY(n.y + 6 + (ICON - 6) / 2))) +
            cell("Width", num(size)) + cell("Height", num(size)) +
            cell("LocPinX", num(size / 2), "Width*0.5") + cell("LocPinY", num(size / 2), "Height*0.5") +
            cell("Angle", 0) + cell("FlipX", 0) + cell("FlipY", 0) +
            cell("ImgOffsetX", 0, "ImgWidth*0") + cell("ImgOffsetY", 0, "ImgHeight*0") +
            cell("ImgWidth", num(size), "Width*1") + cell("ImgHeight", num(size), "Height*1") +
            cell("LinePattern", 0) + cell("FillPattern", 0) +
            // Click-through, as for the sublabel: the icon covers the top of the
            // node box and is the most likely thing to be clicked, but it is the
            // box that carries the annotation.
            cell("LockSelect", 1) +
            rectGeometry(1) +
            `<ForeignData ForeignType='Bitmap' CompressionType='PNG'><Rel r:id='${relId}'/></ForeignData>` +
            `</Shape>`,
        );
    }

    // Connectors last, so they draw on top and can reference node shape ids.
    for (const e of edges) {
        const from = nodes.find((n) => n.id === e.from);
        const to = nodes.find((n) => n.id === e.to);
        if (!from || !to) continue;
        const fromId = shapeIdOf.get(e.from);
        const toId = shapeIdOf.get(e.to);

        id += 1;
        // Clip the centre-to-centre run at each box edge so the line touches the
        // shape rather than running under it.
        const [b, t] = clipEnds(from, to);
        const bx = toX(b.x);
        const by = toY(b.y);
        const ex = toX(t.x);
        const ey = toY(t.y);
        const color = solidColor(e.color, "#0969DA");
        const arrow = e.arrow ?? "forward";
        const route = e.route === "orthogonal" || e.route === "curved" ? e.route : "straight";

        // Routing, verified against Visio's own output:
        //
        //   straight    override the master's elbow with a direct run
        //   orthogonal  ShapeRouteStyle=1 and *no* geometry override, so Visio
        //               routes right angles itself and keeps doing so when a
        //               shape is dragged
        //   curved      as orthogonal, plus ConLineRouteExt=2; Visio then
        //               generates its own NURBSTo row
        //
        // Overriding geometry for the latter two would freeze the line and
        // defeat the point of exporting a real dynamic connector.
        const routeCells =
            route === "straight"
                ? ""
                : cell("ShapeRouteStyle", 1) +
                  (route === "curved" ? cell("ConLineRouteExt", 2) : "");

        const straightGeometry =
            `<Section N='Geometry' IX='0'>` +
            cell("NoFill", 1) + cell("NoLine", 0) + cell("NoShow", 0) +
            cell("NoSnap", 0) + cell("NoQuickDrag", 0) +
            `<Row T='MoveTo' IX='1'>${cell("X", 0, "Width*0")}${cell("Y", 0, "Height*0")}</Row>` +
            `<Row T='LineTo' IX='2'>${cell("X", num(ex - bx), "Width*1")}${cell("Y", num(ey - by), "Height*1")}</Row>` +
            `<Row T='LineTo' IX='3' Del='1'/>` +
            `</Section>`;

        shapes.push(
            `<Shape ID='${id}' NameU='Dynamic connector' Type='Shape' Master='2'>` +
            // Real glue in Visio *is* the formula: _WALKGLUE re-derives the end
            // points from the shapes named by the triggers. WalkPreference must
            // be present or the call yields nothing and both ends collapse to
            // the page origin.
            cell("WalkPreference", 0) +
            cell("BegTrigger", 2, `_XFTRIGGER(Sheet.${fromId}!EventXFMod)`) +
            cell("EndTrigger", 2, `_XFTRIGGER(Sheet.${toId}!EventXFMod)`) +
            cell("BeginX", num(bx), "_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)") +
            cell("BeginY", num(by), "_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)") +
            cell("EndX", num(ex), "_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)") +
            cell("EndY", num(ey), "_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)") +
            cell("PinX", num((bx + ex) / 2), "GUARD((BeginX+EndX)/2)") +
            cell("PinY", num((by + ey) / 2), "GUARD((BeginY+EndY)/2)") +
            cell("Width", num(ex - bx), "GUARD(EndX-BeginX)") +
            cell("Height", num(ey - by), "GUARD(EndY-BeginY)") +
            cell("LocPinX", num((ex - bx) / 2), "GUARD(Width*0.5)") +
            cell("LocPinY", num((ey - by) / 2), "GUARD(Height*0.5)") +
            cell("ObjType", 2) + cell("ConFixedCode", 6) + cell("LayerMember", 0) +
            routeCells +
            cell("LineColor", color) + cell("LineWeight", 0.02) +
            cell("LinePattern", e.dashed ? 2 : 1) +
            cell("BeginArrow", arrow === "backward" || arrow === "both" ? 4 : 0) +
            cell("EndArrow", arrow === "forward" || arrow === "both" ? 4 : 0) +
            cell("BeginArrowSize", 2) + cell("EndArrowSize", 2) +
            `<Section N='Character'><Row IX='0'>` +
            cell("Size", 0.1094) + cell("Color", "#1F2328") +
            `</Row></Section>` +
            // The master parks its caption via SETATREF(Controls.TextPosition),
            // whose offset is expressed at the master's own scale (-1.18in).
            // Inherited, that dumps every caption a inch below its line, so pin
            // the text to the midpoint of the run and lift it just clear.
            `<Section N='Control'><Row N='TextPosition'>` +
            cell("X", num((ex - bx) / 2), "Width*0.5") +
            cell("Y", num((ey - by) / 2), "Height*0.5") +
            cell("XDyn", num((ex - bx) / 2), "Controls.TextPosition") +
            cell("YDyn", num((ey - by) / 2), "Controls.TextPosition.Y") +
            cell("XCon", 0) + cell("YCon", 0) + cell("CanGlue", 0) +
            `</Row></Section>` +
            cell("TxtPinX", num((ex - bx) / 2), "Width*0.5") +
            cell("TxtPinY", num((ey - by) / 2 + 0.09), "Height*0.5+0.09") +
            cell("TxtLocPinX", 0, "TxtWidth*0.5") +
            cell("TxtLocPinY", 0, "TxtHeight*0.5") +
            cell("TxtAngle", 0) +
            annotationCells(e.annotation) +
            annotationSection(e.annotation) +
            (route === "straight" ? straightGeometry : "") +
            (e.label ? `<Text>${xml(e.label)}</Text>` : "") +
            `</Shape>`,
        );

        // FromPart 9 = begin point, 12 = end point; ToPart 3 = glue to the shape.
        connects.push(
            `<Connect FromSheet='${id}' FromCell='BeginX' FromPart='9' ToSheet='${fromId}' ToCell='PinX' ToPart='3'/>`,
            `<Connect FromSheet='${id}' FromCell='EndX' FromPart='12' ToSheet='${toId}' ToCell='PinX' ToPart='3'/>`,
        );
    }

    const pagesXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Pages xmlns="${VNS}" xmlns:r="${RNS}" xml:space="preserve">` +
        `<Page ID='0' NameU='Page-1' Name='Page-1' ViewScale='-1'` +
        ` ViewCenterX='${num(pageW / 2)}' ViewCenterY='${num(pageH / 2)}'>` +
        `<PageSheet LineStyle='0' FillStyle='0' TextStyle='0'>` +
        cell("PageWidth", num(pageW)) + cell("PageHeight", num(pageH)) +
        cell("PageScale", 1, undefined) + cell("DrawingScale", 1) +
        cell("DrawingSizeType", 3) + cell("DrawingScaleType", 0) +
        `</PageSheet><Rel r:id='rId1'/></Page></Pages>`;

    const pageXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<PageContents xmlns="${VNS}" xmlns:r="${RNS}" xml:space="preserve">` +
        `<Shapes>${shapes.join("")}</Shapes>` +
        (connects.length ? `<Connects>${connects.join("")}</Connects>` : "") +
        `</PageContents>`;

    return zip([
        { name: "[Content_Types].xml", data: CONTENT_TYPES(new Set(media.length ? ["png"] : [])) },
        { name: "_rels/.rels", data: ROOT_RELS },
        { name: "docProps/core.xml", data: coreProps(diagram.title || "Architecture") },
        { name: "visio/document.xml", data: DOCUMENT_XML },
        { name: "visio/_rels/document.xml.rels", data: DOC_RELS },
        { name: "visio/windows.xml", data: WINDOWS_XML },
        { name: "visio/masters/masters.xml", data: MASTERS_XML },
        { name: "visio/masters/master1.xml", data: MASTER1_XML },
        { name: "visio/masters/_rels/masters.xml.rels", data: MASTERS_RELS },
        { name: "visio/pages/pages.xml", data: pagesXml },
        { name: "visio/pages/_rels/pages.xml.rels", data:
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>` +
            `</Relationships>` },
        { name: "visio/pages/page1.xml", data: pageXml },
        { name: "visio/pages/_rels/page1.xml.rels", data:
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            pageRels.join("") +
            `</Relationships>` },
        ...media,
    ]);
}
