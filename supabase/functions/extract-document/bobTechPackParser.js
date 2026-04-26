// Parses BOB-format tech pack .xlsx files (Brand of the Basics product specification sheets)
// Returns structured data: header, fabrications, trims, skus, carton, upc, labels,
// packaging, accessories, zipper, and a size_chart derived from the SKU table.
//
// DENO COPY — mirror at src/lib/bobTechPackParser.js (canonical, used by browser).
// The browser version uses window.XLSX bootstrapped from a CDN; this Deno copy
// imports SheetJS via esm.sh and accepts a Uint8Array instead of a File.

import * as XLSX from "https://esm.sh/xlsx@0.18.5";

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

function cellStr(v) { return v == null ? "" : String(v).trim(); }

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
        const lj = (rows[j][0] || "").trim();
        const vj = (rows[j][2] || "").trim();
        if (lj === "Fabric Location") fab.location = vj;
        else if (lj === "Fabric Construction") fab.construction = vj;
        else if (lj === "Fabric Weight") fab.weight = vj;
        else if (lj === "Fabric Treatment") fab.treatment = vj;
        else if (/^FABRICATION|^TRIMS/i.test(lj) || /^Fabrication \(/i.test(lj)) break;
      }
      if (fab.fabric_type) fabrications.push(fab);
    } else if (label === "Fabrication" && val) {
      const tr = { fabric_type: val };
      for (let j = i + 1; j < Math.min(i + 6, rows.length); j++) {
        const lj = (rows[j][0] || "").trim();
        const vj = (rows[j][2] || "").trim();
        if (lj === "Fabric Location") tr.location = vj;
        else if (lj === "Fabric Construction") tr.construction = vj;
        else if (lj === "Fabric Weight") tr.weight = vj;
        else if (lj === "Fabric Treatment") tr.treatment = vj;
        else if (/^TRIMS|^PRODUCT/i.test(lj)) break;
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
const COMPONENT_TYPE_TOKENS = new Set([
  "flat sheet", "fitted sheet", "pillow case", "pillowcase", "sham",
  "top fabric", "lining", "binding", "skirt", "front", "bottom",
  "piping", "filling", "lamination", "fabric bag", "quilting",
  "pillow compression", "platform", "evalon membrane", "sleeper flap",
]);

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
    COMPONENT_TYPE_TOKENS.has((r.item_code || "").toLowerCase().trim())
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
    if (c2 === "Size" && c4 === "Units per carton") { inCtn = true; continue; }
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
    if (c2 === "SIZE" && /SKU/i.test(c3)) { inUpc = true; continue; }
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
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const first = (r[0] || "").trim();
    const val = (r[2] || "").trim();
    if (first && !val && !/^(Label|Material|Size|Color|Placement|Placment)$/i.test(first)
        && first.length > 3 && first.length < 80
        && !first.startsWith("(") && !/PRODUCT SPECIFICATION|Labelling Information/i.test(first)) {
      sectionContext = first;
      continue;
    }
    if (first === "Label" && val) {
      if (current) labels.push(current);
      current = { section: sectionContext, type: val };
    } else if (current) {
      if (first === "Material") current.material = val;
      else if (first === "Size") current.size = val;
      else if (first === "Color") current.color = val;
      else if (first === "Placement" || first === "Placment") current.placement = val;
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
  const KEYS = {
    "Packaging type": "Packaging",
    "Bag material": "PVC Bag",
    "Color paper insert material": "Insert Card",
    "Cardboard material(Stiffener)": "Stiffener",
    "Size Sticker": "Size Sticker",
    "Barcode sticker": "Barcode Sticker",
    "Barcode Sticker /Size": "Barcode Sticker Size",
    "Cardboard": "Stiffener (Cardboard)",
    "cardboard size": "Stiffener Size",
  };
  for (const r of rows) {
    if (!r) continue;
    const lbl = (r[0] || "").trim();
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
    if (KEYS[lbl] && val) {
      items.push({
        variant,
        category: KEYS[lbl],
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
  const m = /(\d+)(?:\-(\d+))?\s*gsm/i.exec(text || "");
  if (!m) return null;
  return m[2] ? Math.round((Number(m[1]) + Number(m[2])) / 2) : Number(m[1]);
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
      color: /white/i.test(f.fabric_type || "") ? "White" : null,
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

// Main parse entry point. Accepts a Uint8Array of the .xlsx bytes (Deno
// has no File API). Returns the same shape as the browser version.
export function parseBobTechPack(bytes) {
  const wb = XLSX.read(bytes, { type: "array" });

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
