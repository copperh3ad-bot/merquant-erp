// Parses BOB-format tech pack .xlsx files (Brand of the Basics product specification sheets)
// Returns structured data: header, fabrications, trims, skus, carton, upc, labels,
// packaging, accessories, zipper, and a size_chart derived from the SKU table.
//
// Session 11 changes:
//   - toFabricSpecs() now stamps `kind: "fabric"` on every returned row so the
//     Session 10 fail-closed classifier in FabricWorking.jsx always includes
//     piping/binding/trim fabric rows even when their `component_type` string
//     is not in the FABRIC_TYPES whitelist.
//   - New parseAccessoriesFromSizeSheet() captures elastic / zipper / thread /
//     stitch spec from the "Product - Size & Workmanship" sheet. These were
//     previously thrown away by the BOB fast path in TechPacks.jsx.
//   - parseLabellingSheet() now additionally splits "sewn label" rows (Law tag,
//     Size label, Care label) into label_specs vs. non-label accessories so the
//     DB column split matches the AI-extraction schema.
//   - parseZipperInfo() now also scans the Size & Workmanship sheet (not only
//     the Info sheet) for zipper-related rows.

import { canonical, isInCategory, _internals } from "@/lib/textileVocabulary";

function cellStr(v) { return v == null ? "" : String(v).trim(); }

// Build a single regex that matches any colour alias in the central vocab
// (white|ivory|grey|gray|misty blue|cloud gray|...). Used to detect when a
// fabric_type string mentions a colour. Returns the canonical name, never
// the alias — so "WHITE" / "off-white" both yield "White".
const COLOUR_ALIAS_REGEX = (() => {
  const idx = _internals.REVERSE_INDEX.colour;
  if (!idx || idx.size === 0) return null;
  const aliases = Array.from(idx.keys()).sort((a, b) => b.length - a.length);
  const escaped = aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
})();

function detectColourInText(text) {
  if (!text || !COLOUR_ALIAS_REGEX) return null;
  const m = String(text).match(COLOUR_ALIAS_REGEX);
  if (!m) return null;
  return canonical("colour", m[1]) ?? null;
}

function readSheet(XLSX, wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  return json.map(r => Array.isArray(r) ? r.map(cellStr) : []);
}

const HEADER_KEYS = {
  "Brand": "brand",
  "Product Type": "product_type",
  "Product SKU": "product_sku",
  "Product Name (Sold As)": "product_name",
  "Production Description": "production_description",
  "Product No.": "product_no",
  "Sample No": "sample_no",
  "Date": "date",
};

function parseInfoSheet(rows) {
  const header = {};
  const fabrications = [];
  const trims = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const label = (r[0] || "").trim();
    const val = (r[2] || "").trim();
    const cleanLabel = label.replace(/\s+$/, "");
    if (HEADER_KEYS[cleanLabel]) header[HEADER_KEYS[cleanLabel]] = val;
    const mFab = /^Fabrication \((\d+)\)/i.exec(label);
    if (mFab && val) {
      const fab = { number: Number(mFab[1]), fabric_type: val };
      for (let j = i + 1; j < Math.min(i + 6, rows.length); j++) {
        // Normalise the label: lower-case, collapse whitespace. Catches
        // "Fabric  Construction" (double space), "FABRIC LOCATION", and
        // "fabric construction:" (trailing colon) which earlier exact
        // string equality silently dropped.
        const lj = (rows[j][0] || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[:\s]+$/, "");
        const vj = (rows[j][2] || "").trim();
        if (lj === "fabric location") fab.location = vj;
        else if (lj === "fabric construction") fab.construction = vj;
        else if (lj === "fabric weight") fab.weight = vj;
        else if (lj === "fabric treatment") fab.treatment = vj;
        else if (/^fabrication|^trims/i.test(lj)) break;
      }
      if (fab.fabric_type) fabrications.push(fab);
    } else if (label === "Fabrication" && val) {
      const tr = { fabric_type: val };
      for (let j = i + 1; j < Math.min(i + 6, rows.length); j++) {
        const lj = (rows[j][0] || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[:\s]+$/, "");
        const vj = (rows[j][2] || "").trim();
        if (lj === "fabric location") tr.location = vj;
        else if (lj === "fabric construction") tr.construction = vj;
        else if (lj === "fabric weight") tr.weight = vj;
        else if (lj === "fabric treatment") tr.treatment = vj;
        else if (/^trims|^product/i.test(lj)) break;
      }
      if (tr.fabric_type) trims.push(tr);
    }
  }
  return { header, fabrications, trims };
}

// Component-type whitelist used to detect sheet-set / multi-component layouts
// where column C ("Item Code") actually holds component names like "Flat Sheet"
// instead of real SKU codes. When we see this, we synthesize the SKU code from
// header.product_sku + a size suffix and group the component rows under it.
// Membership test for "is this string a known part name?". Delegated to
// textileVocabulary.isInCategory("part", ...) — the central source of
// truth that this file used to mirror as a hardcoded Set. The local
// version was prone to drift when new parts were added (e.g. "Outer",
// "Inner" got missed, leading to BOB rows mis-classified as SKU codes).
function isComponentTypeToken(token) {
  return isInCategory("part", token);
}

// Compact size tokens used for synthesized item codes.
const SIZE_CODE_MAP = {
  "twin": "T", "twin xl": "TX", "twinxl": "TX",
  "full": "F", "full xl": "FXL", "fullxl": "FXL",
  "queen": "Q", "split queen": "SQ",
  "king": "K", "split king": "SK",
  "cal king": "CK", "california king": "CK", "ck": "CK",
  "twin/twin xl": "T", "split cal king": "SCK",
};
function sizeToCode(size) {
  const k = (size || "").toLowerCase().trim().replace(/\s+/g, " ");
  if (SIZE_CODE_MAP[k]) return SIZE_CODE_MAP[k];
  // Fallback: take first letters of each word, max 3 chars
  return k.split(/\s+/).map(w => w[0]).filter(Boolean).join("").toUpperCase().slice(0, 3) || "X";
}

// Parse the SKU table on the Size & Workmanship sheet. Column layout varies
// by product type (e.g. FT9 encasements add a "Zipper Length" column that
// FT2/FT4 mattress protectors don't have), so we read the header row first
// and map each SKU field against whichever column actually has that label.
//
// Two layouts are supported:
//   (a) standard: column C ("Item Code") contains the real SKU code
//       (e.g. FT2 mattress protectors: GPFRIOMP33, GPFRIOMP38, ...)
//   (b) sheet-set: column C contains component names ("Flat Sheet", "Fitted
//       Sheet", "Pillow Case") repeating per size. In this case we synthesize
//       item_code = `${headerProductSku}-${sizeCode}` and roll the component
//       rows into one SKU entry with components[].
function parseSizeSheet(rows, headerProductSku = "") {
  const skus = [];
  // Find the header row. It always has "Size" at col A and "Item Code" at col C.
  let headerRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if ((r[0] || "").trim() === "Size" && (r[2] || "").trim() === "Item Code") {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) return skus;

  const header = rows[headerRow] || [];
  const fieldFor = (label) => {
    const s = (label || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (/^size$/.test(s)) return "size";
    if (/item code/.test(s)) return "item_code";
    if (/^color$/.test(s)) return "color";
    if (/product dimensions?/.test(s)) return "product_dimensions";
    if (/zipper length/.test(s)) return "zipper_length";
    if (/insert dimensions?/.test(s)) return "insert_dimensions";
    if (/(pvc bag|packaging) dimensions?/.test(s)) return "pvc_bag_dimensions";
    if (/(stiffener|cardboard) (card ?board )?size/.test(s) || /"u" cardboard size/.test(s)) return "stiffener_size";
    return null;
  };
  const colToField = new Map();
  for (let c = 0; c < header.length; c++) {
    const f = fieldFor(header[c]);
    if (f) colToField.set(c, f);
  }

  // First pass: collect raw rows (size, item_code, etc.) so we can detect layout.
  const rawRows = [];
  let blankStreak = 0;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const first = (r[0] || "").trim();
    const third = (r[2] || "").trim();
    if (!first && !third) {
      if (++blankStreak >= 2 && rawRows.length > 0) break;
      continue;
    }
    blankStreak = 0;
    if (!third) {
      if (rawRows.length > 0) break;
      continue;
    }
    const row = {};
    for (const [c, field] of colToField) row[field] = (r[c] || "").trim() || null;
    if (!row.item_code) continue;
    rawRows.push(row);
  }
  if (rawRows.length === 0) return skus;

  // Detect layout: if a majority of item_code values are component-type tokens,
  // treat this as a sheet-set layout and synthesize real SKU codes.
  const componentLikeCount = rawRows.filter(r =>
    isComponentTypeToken((r.item_code || "").trim())
  ).length;
  const isSheetSetLayout = componentLikeCount >= Math.ceil(rawRows.length * 0.6);

  if (!isSheetSetLayout) {
    // Standard layout: each row is its own SKU. Drop rows with no size.
    for (const row of rawRows) {
      if (!row.size || !row.item_code) continue;
      skus.push(row);
    }
    return skus;
  }

  // Sheet-set layout: rows are grouped by size. The size column is filled only
  // on the first row of each group; subsequent component rows have empty size
  // (we filled them with null above). Group consecutive rows by carrying the
  // last seen size, then collapse each group into one SKU.
  let currentSize = null;
  const groups = new Map(); // size -> { size, color, components: [], dims: {...} }
  for (const row of rawRows) {
    if (row.size) currentSize = row.size;
    if (!currentSize) continue;
    if (!groups.has(currentSize)) {
      groups.set(currentSize, {
        size: currentSize,
        color: row.color || null,
        components: [],
        product_dimensions: null,
        zipper_length: null,
        insert_dimensions: null,
        pvc_bag_dimensions: null,
        stiffener_size: null,
      });
    }
    const g = groups.get(currentSize);
    if (row.color && !g.color) g.color = row.color;
    g.components.push({
      component_type: row.item_code,
      product_dimensions: row.product_dimensions || null,
    });
    // Per-part dimensions: keyed by component_type (e.g. "Flat Sheet",
    // "Fitted Sheet", "Pillow Case"). Preserves all three rows for sheet
    // sets where each part has its own product dimension.
    if (!g.part_dimensions) g.part_dimensions = {};
    if (row.item_code && row.product_dimensions && !g.part_dimensions[row.item_code]) {
      g.part_dimensions[row.item_code] = row.product_dimensions;
    }
    // First non-empty value wins for the SKU-level dimensions (kept for
    // backward compat — represents the Flat Sheet dimension typically).
    for (const k of ["product_dimensions","zipper_length","insert_dimensions","pvc_bag_dimensions","stiffener_size"]) {
      if (row[k] && !g[k]) g[k] = row[k];
    }
  }

  for (const g of groups.values()) {
    const sizeCode = sizeToCode(g.size);
    const itemCode = headerProductSku ? `${headerProductSku}-${sizeCode}` : `SET-${sizeCode}`;
    skus.push({
      size: g.size,
      item_code: itemCode,
      color: g.color,
      product_dimensions: g.product_dimensions,
      part_dimensions: g.part_dimensions || null,
      zipper_length: g.zipper_length,
      insert_dimensions: g.insert_dimensions,
      pvc_bag_dimensions: g.pvc_bag_dimensions,
      stiffener_size: g.stiffener_size,
      components: g.components,
      is_set: true,
    });
  }
  return skus;
}

function parseShippingSheet(rows) {
  const carton = [];
  const upc = [];
  let inCtn = false;
  for (const r of rows) {
    if (!r) continue;
    const c2 = (r[2] || "").trim();
    const c4 = (r[4] || "").trim();
    // Header trigger is case/spacing-insensitive so variants like
    // "Units Per Carton" / "UNITS PER CARTON" / "Units / Carton" all match.
    if (/^size$/i.test(c2) && /units?\s*[/]?\s*per\s*carton/i.test(c4)) { inCtn = true; continue; }
    if (inCtn) {
      const size = c2;
      if (size) {
        const units = parseInt(c4, 10);
        const dim = (r[6] || "").trim();
        if (size && !isNaN(units)) carton.push({ size, units_per_carton: units, carton_size_cm: dim });
      } else if (carton.length >= 3) {
        inCtn = false;
      }
    }
  }
  let inUpc = false;
  for (const r of rows) {
    if (!r) continue;
    const c2 = (r[2] || "").trim();
    const c3 = (r[3] || "").trim();
    if (/^size$/i.test(c2) && /sku/i.test(c3)) { inUpc = true; continue; }
    if (inUpc && c2) {
      const our = (r[3] || "").trim();
      const bob = (r[4] || "").trim();
      const qty = (r[6] || "").trim();
      if (our) upc.push({ size: c2, our_sku: our, bob_sku: bob, qty_per_ctn: qty });
    }
  }
  return { carton, upc };
}

// Parse labelling sheet - captures every label block (Law Tag, Size Label, etc.)
// Each block has { section, type, material, size, color, placement } where
// section is the human heading above the block (e.g. "Law tag/Care label" or
// "Size label" or "Care / Size label for pillow protector").
function parseLabellingSheet(rows) {
  const labels = [];
  let current = null;
  let sectionContext = "";
  // Normalise: lower-case, collapse whitespace, drop trailing punctuation.
  // Catches "Color " (trailing space), "COLOR", "Colour" (UK spelling),
  // "Placment" (typo) without a per-typo branch.
  const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[:.\s]+$/, "");
  // Field-key aliases. Add new buyer variants here, no code change required
  // anywhere else.
  const FIELD_ALIASES = {
    label:     ["label", "type", "label type", "tag"],
    material:  ["material", "fabric", "label material"],
    size:      ["size", "label size", "dimension", "dimensions"],
    color:     ["color", "colour", "label color", "label colour"],
    placement: ["placement", "placment", "position", "location", "placed at"],
  };
  const allFieldTokens = new Set(Object.values(FIELD_ALIASES).flat());
  const keyFor = (n) => {
    for (const [canonical, list] of Object.entries(FIELD_ALIASES)) {
      if (list.includes(n)) return canonical;
    }
    return null;
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const first = (r[0] || "").trim();
    const firstN = norm(first);
    const val = (r[2] || "").trim();
    if (first && !val && !allFieldTokens.has(firstN)
        && first.length > 3 && first.length < 80
        && !first.startsWith("(") && !/PRODUCT SPECIFICATION|Labelling Information/i.test(first)) {
      sectionContext = first;
      continue;
    }
    const k = keyFor(firstN);
    if (k === "label" && val) {
      if (current) labels.push(current);
      current = { section: sectionContext, type: val };
    } else if (current && k && k !== "label") {
      current[k] = val;
    }
  }
  if (current) labels.push(current);
  return labels;
}

// Parse packaging sheet - PVC bag, insert, stiffener, barcode sticker, size sticker.
// `variant` tracks whether the row applies to "Mattress Protector", "Pillow Protector",
// etc., since the BOB sheet uses a two-level layout (variant header -> several rows of keys).
function parsePackagingSheet(rows) {
  const items = [];
  let variant = "Main";
  // Normalise label keys: lower-case, collapse whitespace, drop trailing
  // punctuation, drop spaces inside parens. So "Bag Material",
  // "BAG MATERIAL", "bag material:", "Cardboard Material (Stiffener)"
  // all collapse to a single canonical lookup.
  const norm = (s) => (s || "").trim().toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[:.\s]+$/, "")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")");
  const KEYS_NORM = {
    "packaging type":               "Packaging",
    "bag material":                 "PVC Bag",
    "color paper insert material":  "Insert Card",
    "colour paper insert material": "Insert Card",       // UK spelling
    "insert material":              "Insert Card",       // shortened
    "cardboard material(stiffener)": "Stiffener",
    "stiffener":                    "Stiffener",         // shortened
    "stiffener material":           "Stiffener",
    "cardboard":                    "Stiffener (Cardboard)",
    "cardboard size":               "Stiffener Size",
    "stiffener size":               "Stiffener Size",
    "size sticker":                 "Size Sticker",
    "barcode sticker":              "Barcode Sticker",
    "barcode sticker/size":         "Barcode Sticker Size",
    "barcode size":                 "Barcode Sticker Size",
    // Retail printed box rows — Bamboo, Box-Spring, Encasement SKUs ship
    // one-per-unit in a branded printed box. Source labels in the wild:
    "color box":                    "Printed Box",
    "color box material":           "Printed Box",
    "colour box":                   "Printed Box",
    "colour box material":          "Printed Box",
    "printed box":                  "Printed Box",
    "printed box material":         "Printed Box",
    "outer box":                    "Printed Box",
    "outer box material":           "Printed Box",
    "display box":                  "Printed Box",
    "gift box":                     "Printed Box",
    "retail box":                   "Printed Box",
    "individual box":               "Printed Box",
    "inner box":                    "Printed Box",
    "box material":                 "Printed Box",
    "box":                          "Printed Box",
    "color box size":               "Printed Box Size",
    "colour box size":              "Printed Box Size",
    "printed box size":             "Printed Box Size",
    "outer box size":               "Printed Box Size",
    "box size":                     "Printed Box Size",
  };
  for (const r of rows) {
    if (!r) continue;
    const lbl = (r[0] || "").trim();
    const lblN = norm(lbl);
    const val = (r[2] || "").trim();
    if (lbl && !val) {
      if (/mattress protector|encasement/i.test(lbl) && !/^PRODUCT|Artwork/i.test(lbl)) {
        variant = lbl.length < 40 ? lbl : variant;
        continue;
      }
      if (/pillow protector/i.test(lbl) && lbl.length < 40) {
        variant = "Pillow Protector";
        continue;
      }
    }
    if (KEYS_NORM[lblN] && val) {
      items.push({
        variant,
        category: KEYS_NORM[lblN],
        label: lbl,
        value: val,
      });
    }
  }
  return items;
}

// Session 11 - parse sewing accessories (elastic, zipper, thread, stitch spec)
// from the "Product - Size & Workmanship" sheet. These are component-level
// items that feed the Accessories page, distinct from labels (Labelling sheet)
// and packaging (Packaging sheet).
//
// Heuristic: column A is a key and column C is its value. We match column A
// against a small vocabulary of accessory names; matches become one accessory
// entry with material/description/placement derived from the row text.
function parseAccessoriesFromSizeSheet(rows) {
  const accessories = [];
  const KEY_TO_TYPE = [
    [/^elastic( band)?\s*$/i, "Elastic"],
    [/^zipper$/i, "Zipper"],
    [/^zipp?w$/i, "Zipper"],     // typo in FT9 tech pack: "Zippw"
    [/^thread$/i, "Thread"],
    [/^sewing construction$/i, "Sewing Construction"],
    [/^overlocking stitch$/i, "Overlocking Stitch"],
    [/^stitching density$/i, "Stitching Density"],
    [/^needle requirement$/i, "Needle"],
    [/^bound seam material$/i, "Bound Seam Material"],
    [/^cut piecing at zipper ends$/i, "Zipper End Piecing"],
  ];
  for (const r of rows) {
    if (!r || !r.length) continue;
    const lbl = (r[0] || "").trim();
    const val = (r[2] || "").trim();
    if (!lbl || !val) continue;
    const match = KEY_TO_TYPE.find(([re]) => re.test(lbl));
    if (!match) continue;
    const [, accessoryType] = match;
    accessories.push({
      accessory_type: accessoryType,
      description: val,
      material: null,    // BOB format folds material+placement into one value
      placement: null,
      source_label: lbl,
    });
  }
  return accessories;
}

// Session 11 - zipper info scan, now reading BOTH the Info sheet and the
// Size & Workmanship sheet (the workmanship sheet is where zipper length,
// type and stitching density actually live for encasement products like FT9).
function parseZipperInfo(infoRows, sizeRows) {
  const zip = {};
  const scan = (rows) => {
    for (const r of rows || []) {
      if (!r) continue;
      const lbl = (r[0] || "").trim();
      const val = (r[2] || "").trim();
      if (!val) continue;
      if (/^Zipper/i.test(lbl) || /^Zippw/i.test(lbl)) {
        zip[lbl.replace(/^Zippw$/i, "Zipper")] = val;
      }
      if (/^Cut Piecing at Zipper ends$/i.test(lbl)) {
        zip["Zipper End Piecing"] = val;
      }
    }
  };
  scan(infoRows);
  scan(sizeRows);
  return zip;
}

function extractGsm(text) {
  if (!text) return null;
  // Direct gsm/g/m²/g/sqm/gr/m² metric forms.
  // Range like "180-200 gsm" averages.
  const m = /(\d+)(?:\s*[-–—]\s*(\d+))?\s*(?:gsm|gr?\.?\s*\/?\s*(?:m²|m2|sqm|sq\.?\s*m))/i.exec(text);
  if (m) return m[2] ? Math.round((Number(m[1]) + Number(m[2])) / 2) : Number(m[1]);
  // Imperial: "6 oz/sq.yd" or "6 oz/yd²" → ~ozsqyd × 33.906 = gsm.
  const oz = /(\d+(?:\.\d+)?)\s*oz\s*\/?\s*(?:sq\.?\s*yd|yd²|yd2)/i.exec(text);
  if (oz) return Math.round(Number(oz[1]) * 33.906);
  return null;
}

// Convert our structured data into tech_packs.extracted_fabric_specs format.
// Session 11: stamp `kind: "fabric"` on every row so the Session 10 classifier
// in FabricWorking.jsx treats them as fabric regardless of whether their
// component_type happens to match its FABRIC_TYPES whitelist. Without this
// stamp, BOB rows with `component_type: "Trim / Binding"` or a copied-in
// location string get excluded from the Fabric Working printout.
function toFabricSpecs(fabrications, trims) {
  const specs = [];
  for (const f of fabrications) {
    specs.push({
      kind: "fabric",
      component_type: f.location || `Fabrication ${f.number}`,
      fabric_type: f.fabric_type,
      gsm: extractGsm(f.fabric_type) || extractGsm(f.weight),
      construction: f.construction || null,
      finish: f.treatment || null,
      width_cm: null,
      consumption_per_unit: null,
      wastage_percent: null,
      // Detect a colour mention inside the fabric_type string by walking
      // every colour canonical via the central vocab. Catches "white",
      // "ivory", "grey", etc. — the old hardcoded /white/i missed every
      // other colour.
      color: detectColourInText(f.fabric_type),
      notes: f.location || null,
    });
  }
  for (const t of trims) {
    specs.push({
      kind: "fabric",
      component_type: t.location || "Trim / Binding",
      fabric_type: t.fabric_type,
      gsm: extractGsm(t.fabric_type) || extractGsm(t.weight),
      construction: t.construction || null,
      finish: t.treatment || null,
      width_cm: null,
      consumption_per_unit: null,
      wastage_percent: null,
      color: null,
      notes: t.location || null,
    });
  }
  return specs;
}

// Main parse entry point
export async function parseBobTechPack(file) {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const infoSheet = readSheet(XLSX, wb, "Product & Fabric Information");
  const sizeSheet = readSheet(XLSX, wb, "Product - Size & Workmanship");
  const labelSheet = readSheet(XLSX, wb, "Product - Labelling");
  const pkgSheet = readSheet(XLSX, wb, "Product - Packaging");
  const shipName = wb.SheetNames.find(n => /^Product - Shipping information/i.test(n));
  const shipSheet = shipName ? readSheet(XLSX, wb, shipName) : [];

  if (!infoSheet.length) throw new Error("Not a BOB tech pack - missing 'Product & Fabric Information' sheet");

  const { header, fabrications, trims } = parseInfoSheet(infoSheet);
  const skus = parseSizeSheet(sizeSheet, header.product_sku || header.product_no || "");
  const { carton, upc } = parseShippingSheet(shipSheet);
  const labels = parseLabellingSheet(labelSheet);
  const packaging = parsePackagingSheet(pkgSheet);
  const accessories = parseAccessoriesFromSizeSheet(sizeSheet);
  const zipper = parseZipperInfo(infoSheet, sizeSheet);
  const fabric_specs = toFabricSpecs(fabrications, trims);

  const cartonByS = new Map(carton.map(c => [c.size.toUpperCase(), c]));
  const upcByS = new Map(upc.map(u => [u.size.toUpperCase(), u]));
  const enriched_skus = skus.map(s => {
    const c = cartonByS.get(s.size.toUpperCase());
    const u = upcByS.get(s.size.toUpperCase());
    return { ...s, ...(c ? { units_per_carton: c.units_per_carton, carton_size_cm: c.carton_size_cm } : {}),
      ...(u ? { bob_sku: u.bob_sku, qty_per_ctn_upc: u.qty_per_ctn } : {}) };
  });

  return {
    header,
    fabrications,
    trims,
    fabric_specs,
    skus: enriched_skus,
    carton,
    upc,
    labels,
    packaging,
    accessories,
    zipper,
  };
}
