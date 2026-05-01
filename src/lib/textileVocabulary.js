// src/lib/textileVocabulary.js
//
// Centralised textile-domain vocabulary. The single source of truth for
// canonical names + aliases across:
//   - garment parts (component_type)
//   - fabric types (composition + construction)
//   - fabric constructions
//   - accessory categories
//   - trim types
//   - sizes (sheet-set, mattress, pillow)
//   - direction codes (cut grain)
//   - measurement units (GSM, oz/yd², thread count, denier, yarn count)
//   - treatments / finishes
//   - colours
//
// Every classifier / normalizer / extraction validator in the codebase
// should resolve textile terms through THIS module. Don't add hardcoded
// term lists in other files. When a customer's source data uses a new
// spelling, add the alias here and the whole system picks it up.
//
// Usage patterns:
//
//   import { canonical, isInCategory, allCanonicals } from "@/lib/textileVocabulary";
//
//   canonical("part", "Top Sheet")            → "Flat Sheet"
//   canonical("fabric_type", "85% modal jersey") → "Modal Jersey Knit"
//   canonical("size", "K/CK")                 → "King/Cal King"
//   isInCategory("part", "Flat Sheet")        → true
//   isInCategory("fabric_type", "Modal")      → true   (matches via alias)
//   allCanonicals("accessory")                → ["Care Label", "Hang Tag", ...]
//
// The lookup is case- and whitespace-insensitive.

// ── Garment parts ───────────────────────────────────────────────────────────
//
// `component_type` values for fabric_consumption rows. These name a
// PHYSICAL PIECE of the finished article — never a fabric description
// or construction. Variant qualifiers like "(Split Head)" and "(2pc)"
// are stripped at lookup time and stored as a separate `variant` field
// (see partNameCanonical.js).

const PART_NAMES = {
  // Sheet-set parts
  "Flat Sheet":      ["flat sheet", "flatsheet", "top sheet", "top-sheet"],
  "Fitted Sheet":    ["fitted sheet", "fittedsheet", "deep pocket fitted sheet",
                      "split top fitted sheet", "split head fitted sheet",
                      "fitted sheet and split top fitted sheet"],
  "Pillow Case":     ["pillow case", "pillowcase", "pillow cases", "pillow case 1pc",
                      "pillow case 2pc"],
  "Sham":            ["sham", "pillow sham", "shams"],
  "Fabric Bag":      ["fabric bag", "self fabric bag", "self-fabric bag",
                      "drawstring bag"],

  // Mattress / pillow / encasement parts
  "Top Fabric":      ["top fabric", "top", "top panel"],
  "Bottom":          ["bottom", "bottom fabric", "bottom panel"],
  "Skirt":           ["skirt", "border", "side panel"],
  "Platform":        ["platform"],
  "Binding":         ["binding"],
  "Piping":          ["piping"],
  "Filling":         ["filling", "fill", "stuffing"],
  "Lamination":      ["lamination", "laminate"],
  "Evalon Membrane": ["evalon membrane", "evalon"],
  "Sleeper Flap":    ["sleeper flap", "flap"],
  "Front":           ["front", "front panel"],
  "Back":            ["back", "back panel"],

  // Pillow protector / encasement
  "Outer":           ["outer", "outer fabric", "outer shell"],
  "Inner":           ["inner", "inner fabric", "inner liner"],
  "Quilting":        ["quilting", "quilt"],
  "Pillow Compression": ["pillow compression"],

  // Window treatments / specialty
  "Window":          ["window", "window outside", "window inside"],
};

// ── Fabric types (canonical = construction word, e.g. "Jersey Knit",
// "Sateen Weave"). Composition % is stored separately from construction.

const FABRIC_TYPES = {
  // Knits
  "Jersey Knit":      ["jersey knit", "jersey", "single jersey", "knit jersey"],
  "Interlock Knit":   ["interlock", "interlock knit", "double knit"],
  "Pique Knit":       ["pique", "pique knit"],
  "Rib Knit":         ["rib knit", "rib", "ribbed"],
  "Tricot Knit":      ["tricot", "tricot knit"],
  "French Terry":     ["french terry", "terry"],
  "Velour":           ["velour", "velour knit"],

  // Wovens
  "Sateen":           ["sateen", "sateen weave"],
  "Percale":          ["percale", "percale weave"],
  "Twill":            ["twill", "twill weave"],
  "Plain Weave":      ["plain weave", "broadcloth"],
  "Flannel":          ["flannel", "flannelette"],
  "Microfiber":       ["microfiber", "micro-fiber", "microfibre"],
  "Damask":           ["damask"],
  "Jacquard":         ["jacquard"],
  "Poplin":           ["poplin"],

  // Specialty / non-woven
  "TPU Laminate":     ["tpu", "tpu laminate", "tpu film", "thermoplastic polyurethane"],
  "PU Laminate":      ["pu", "pu laminate", "polyurethane laminate"],
  "Non-woven":        ["non-woven", "non woven", "nonwoven", "spunbond"],
};

// ── Fabric compositions (fibre content) ─────────────────────────────────────

const FIBRE_TYPES = {
  "Cotton":           ["cotton", "cot"],
  "Egyptian Cotton":  ["egyptian cotton", "egypt cotton"],
  "Pima Cotton":      ["pima", "pima cotton"],
  "Supima Cotton":    ["supima", "supima cotton"],
  "Modal":            ["modal"],
  "Lyocell":          ["lyocell", "tencel"],
  "Bamboo":           ["bamboo", "bamboo viscose", "bamboo rayon"],
  "Polyester":        ["polyester", "poly", "pet"],
  "Spandex":          ["spandex", "elastane", "lycra"],
  "Nylon":            ["nylon", "polyamide", "pa"],
  "Silk":             ["silk"],
  "Linen":            ["linen", "flax"],
  "Wool":             ["wool"],
  "Rayon":            ["rayon", "viscose"],
  "Acrylic":          ["acrylic"],
  "Microfiber Polyester": ["microfiber polyester", "polyester microfiber"],
};

// ── Accessory categories ────────────────────────────────────────────────────
//
// `category` values for accessory_consumption rows. The accessory's role
// in the finished article — care label, hang tag, polybag, etc.

const ACCESSORY_CATEGORIES = {
  "Care Label":        ["care label", "wash label", "washing label"],
  "Size Label":        ["size label", "size tag"],
  "Brand Label":       ["brand label", "main label", "neck label", "product label"],
  "Hang Tag":          ["hang tag", "hangtag", "hanging tag", "swing tag", "price tag"],
  "Polybag":           ["polybag", "poly bag", "plastic bag", "pp bag", "ldpe bag",
                        "moisture pp bag"],
  "PVC Bag":           ["pvc bag", "vinyl bag", "vinyl pvc bag"],
  "Insert Card":       ["insert card", "sewing insert label", "informational insert",
                        "marketing card"],
  "Stiffener":         ["stiffener", "stiffener size", "cardboard insert",
                        "cardboard stiffener", "u cardboard", "card board"],
  "Sticker":           ["sticker", "size sticker", "barcode sticker",
                        "barcode sticker size", "decorative sticker", "barcode"],
  "Label":             ["label"], // generic — promote to specific subtype if known

  "Zipper":            ["zipper", "zip", "zip closure", "ykk zipper"],
  "Thread":            ["thread", "sewing thread", "matched thread"],
  "Elastic":           ["elastic", "elastic band", "elastic tape"],
  "Tape":              ["tape", "binding tape", "ribbon tape"],
  "Velcro":            ["velcro", "hook and loop"],
  "Snap":              ["snap", "snap button", "press stud"],
  "Button":            ["button"],
  "Drawcord":          ["drawcord", "drawstring", "cord"],
  "Law Tag":           ["law tag", "ca law tag"],
  "Packaging":         ["packaging", "master carton", "carton box"],
};

// ── Trim types (subset of accessory_consumption used as trim_specs) ─────────

const TRIM_TYPES = {
  "Zipper":            ["zipper", "zip"],
  "Thread":            ["thread", "sewing thread"],
  "Elastic":           ["elastic"],
  "Binding":           ["binding"],
  "Piping":            ["piping"],
  "Tape":              ["tape", "ribbon"],
  "Velcro":            ["velcro"],
  "Snap":              ["snap"],
  "Hook":              ["hook"],
  "Eyelet":            ["eyelet", "grommet"],
};

// ── Sizes (mattress / sheet-set / pillow) ───────────────────────────────────

const SIZES = {
  // Standard mattress / sheet sizes
  "Twin":               ["twin", "t"],
  "Twin XL":            ["twin xl", "txl", "tx", "twinxl"],
  "Twin/Twin XL":       ["twin/twin xl", "ttxl", "twin twin xl"],
  "Full":               ["full", "f", "double"],
  "Full XL":            ["full xl", "fxl", "fullxl"],
  "Queen":              ["queen", "q"],
  "King":               ["king", "k"],
  "Cal King":           ["cal king", "california king", "ck", "calking"],
  "King/Cal King":      ["king/cal king", "kck", "k/ck", "king cal king"],
  "Split King":         ["split king", "spk", "sk"],
  "Split Cal King":     ["split cal king", "spck", "sck"],
  "Split Head King":    ["split head king", "shk"],
  "Split Head Queen":   ["split head queen", "shq"],
  "Split Head Cal King":["split head cal king", "shck", "split head ck"],
  "Split Queen":        ["split queen", "sq"],

  // Pillow sizes
  "Standard Pillow":     ["standard", "standard pillow", "std pillow"],
  "Queen Pillow":        ["queen pillow", "q pillow"],
  "King Pillow":         ["king pillow", "k pillow"],
  "Body Pillow":         ["body pillow", "body"],
  "Travel Pillow":       ["travel pillow", "travel"],

  // Encasement-only depths (numeric — these are NOT mapped via alias,
  // they're inferred per-SKU from numeric tail; see skuSizeInference.js)
};

// ── Direction codes (fabric grain / cut direction) ──────────────────────────

const DIRECTIONS = {
  "WXL":  ["wxl", "w x l", "w*l", "width x length", "warpwise"],
  "LXW":  ["lxw", "l x w", "l*w", "length x width"],
  "LXL":  ["lxl", "l x l", "lengthwise both", "lengthwise"],
  "WXW":  ["wxw", "w x w", "widthwise both"],
  "Bias": ["bias", "diagonal", "45deg"],
  // Empty direction → cuts can come from any orientation (e.g. fabric bag)
};

// ── Treatments / finishes ───────────────────────────────────────────────────

const TREATMENTS = {
  "Antimicrobial":   ["antimicrobial", "anti-microbial", "silvadur"],
  "Stain Repellent": ["stain repellent", "stain release", "scotchgard"],
  "Waterproof":      ["waterproof", "water proof", "water-proof", "hydrophobic"],
  "Water Resistant": ["water resistant", "water-resistant", "dwr"],
  "Wrinkle Free":    ["wrinkle free", "wrinkle-free", "no-iron"],
  "Brushed":         ["brushed", "brushed finish"],
  "Mercerised":      ["mercerised", "mercerized"],
  "Sanforised":      ["sanforised", "sanforized", "pre-shrunk"],
  "Cooling":         ["cooling", "cool touch", "stretch cool"],
  "Flame Retardant": ["flame retardant", "fr", "fire retardant"],
};

// ── Colours (the most common ones; this list is meant to be extended) ───────

const COLOURS = {
  "White":         ["white", "wh", "wt", "off-white", "natural"],
  "Black":         ["black", "blk", "bk"],
  "Grey":          ["grey", "gray", "gy", "gr"],
  "Light Grey":    ["light grey", "light gray", "lt grey", "lt gray", "silver"],
  "Dark Grey":     ["dark grey", "dark gray", "charcoal"],
  "Dove Gray":     ["dove gray", "dove grey", "dove"],
  "Cloud Gray":    ["cloud gray", "cloud grey", "cg"],
  "Misty Blue":    ["misty blue", "mb", "mist blue"],
  "Navy":          ["navy", "navy blue", "nb"],
  "Blue":          ["blue", "bl"],
  "Light Blue":    ["light blue", "lt blue", "lb", "sky blue"],
  "Ivory":         ["ivory", "iv", "cream"],
  "Beige":         ["beige", "bg", "tan"],
  "Brown":         ["brown", "br", "br-n"],
  "Red":           ["red", "rd"],
  "Pink":          ["pink", "pk"],
  "Purple":        ["purple", "pr", "violet"],
  "Green":         ["green", "gn"],
  "Yellow":        ["yellow", "yl"],
};

// ── Label sub-types (under the Label / Hang Tag accessory categories) ──────
// PackagingPlanning's Labels tab lets users pick a label TYPE per item.
// Customers spell these inconsistently — same canonical pattern as the
// other categories.

const LABEL_TYPES = {
  "Brand Label":        ["brand label", "main label", "neck label", "brand", "logo", "logo label", "product label"],
  "Care Label":         ["care label", "wash label", "washing label", "laundry label", "care instruction", "wash care"],
  "Size Label":         ["size label", "size tag"],
  "Direction Label":    ["direction label", "direction", "head end", "foot end", "this side up", "top-bottom"],
  "GOTS Label":         ["gots", "gots label", "organic label"],
  "Barcode Label":      ["barcode label", "barcode", "upc label", "ean label"],
  "Hang Tag":           ["hang tag", "hangtag", "hanging tag", "swing tag", "swing ticket", "ticket"],
  "Country of Origin":  ["country of origin", "made in", "origin label", "coo"],
  "Composition Label":  ["composition", "composition label", "fiber content", "fibre content", "content label"],
  "Wash Label":         ["wash label", "wash instruction", "washing label"],
  "Price Ticket":       ["price ticket", "price tag", "msrp", "retail price"],
  "Compliance Label":   ["compliance label", "compliance", "ce mark", "iso 9001"],
  "Retailer Label":     ["retailer label", "store label", "private label"],
  "Eco Label":          ["eco label", "eco", "oeko-tex", "fsc", "fair trade", "oekotex"],
  "Care Label 3-Lang":  ["care label in 3 languages 1x3", "3 language care label", "tri-lingual care", "1x3"],
  "Custom Label":       ["custom label", "custom"],
};

// ── Polybag sub-types (material) ────────────────────────────────────────────
const POLYBAG_TYPES = {
  "PVC":   ["pvc", "vinyl", "pvc bag"],
  "PP":    ["pp", "polypropylene", "moisture pp"],
  "PE":    ["pe", "polyethylene", "pe bag"],
  "LDPE":  ["ldpe", "low density polyethylene"],
  "OPP":   ["opp", "oriented polypropylene", "biaxially-oriented polypropylene"],
};

// ── Sticker sub-types ───────────────────────────────────────────────────────
const STICKER_TYPES = {
  "UPC Sticker":         ["upc sticker", "upc"],
  "Barcode Sticker":     ["barcode sticker", "barcode"],
  "Size Sticker":        ["size sticker"],
  "Packaging Info":      ["packaging info sticker", "packaging info"],
  "Retailer Sticker":    ["retailer sticker"],
  "Warning Sticker":     ["warning sticker", "warning label", "caution sticker"],
  "QR Code Sticker":     ["qr code sticker", "qr code", "qr"],
  "Compliance Sticker":  ["compliance sticker"],
  "Custom Sticker":      ["custom sticker", "custom"],
};

// ── Zipper sub-types ────────────────────────────────────────────────────────
const ZIPPER_TYPES = {
  "SBS Nylon Zipper":     ["sbs nylon zipper", "sbs nylon", "nylon zipper"],
  "Coil Zipper":          ["coil zipper", "coil"],
  "Metal Zipper":         ["metal zipper", "metal"],
  "Invisible Zipper":     ["invisible zipper", "invisible"],
  "Plastic Molded Zipper":["plastic molded zipper", "plastic molded", "molded plastic"],
  "Custom Zipper":        ["custom zipper", "custom"],
};

// ── Stiffener sub-types ─────────────────────────────────────────────────────
const STIFFENER_TYPES = {
  "Cardboard":     ["cardboard", "card board", "card stiffener", "u cardboard", "u-shape", "u shape"],
  "PVC Sheet":     ["pvc sheet", "pvc"],
  "Foam Board":    ["foam board", "foam"],
  "MDF":           ["mdf"],
  "Corrugated":    ["corrugated"],
  "Bux Board":     ["bux board"],
  "Other":         ["other", "custom"],
};

// ── Insert Card sub-types ───────────────────────────────────────────────────
const INSERT_CARD_TYPES = {
  "Art Card":      ["art card", "color paper insert", "color paper", "marketing card"],
  "Bleach Card":   ["bleach card"],
  "Bux Board":     ["bux board"],
  "Box Packaging": ["box packaging", "box"],
  "Custom":        ["custom"],
};

// ── Carton sub-types ────────────────────────────────────────────────────────
const CARTON_TYPES = {
  "Printed":  ["printed", "printed carton"],
  "Plain":    ["plain", "plain carton"],
  "Brown":    ["brown", "brown carton", "kraft", "kraft carton"],
  "White":    ["white", "white carton"],
};

// ── Trim sub-types (extends TRIM_TYPES with finer detail) ──────────────────
const TRIM_DETAIL_TYPES = {
  "Elastic":         ["elastic", "elastic band", "elastic tape"],
  "Drawcord":        ["drawcord", "drawstring", "cord"],
  "Cord Lock":       ["cord lock", "cord stopper"],
  "Drawcord Stopper":["drawcord stopper", "stopper"],
  "Jacquard Band":   ["jacquard band", "jacquard"],
  "Velcro":          ["velcro", "hook and loop"],
  "Rivet":           ["rivet"],
  "Button":          ["button"],
  "Ribbon":          ["ribbon"],
  "Piping":          ["piping"],
  "Custom":          ["custom"],
};

// ── Combined registry ──────────────────────────────────────────────────────

const REGISTRY = {
  part:                 PART_NAMES,
  fabric_type:          FABRIC_TYPES,
  fibre:                FIBRE_TYPES,
  accessory:            ACCESSORY_CATEGORIES,
  trim:                 TRIM_TYPES,
  size:                 SIZES,
  direction:            DIRECTIONS,
  treatment:            TREATMENTS,
  colour:               COLOURS,
};

// Build reverse-lookup maps once at module load: lower(alias) → canonical
const REVERSE_INDEX = (() => {
  const out = {};
  for (const [category, table] of Object.entries(REGISTRY)) {
    out[category] = new Map();
    for (const [canon, aliases] of Object.entries(table)) {
      out[category].set(canon.toLowerCase(), canon);
      for (const a of aliases) out[category].set(a.toLowerCase(), canon);
    }
  }
  return out;
})();

// ── Public API ─────────────────────────────────────────────────────────────

const norm = (s) => (s == null ? "" : String(s).toLowerCase().trim().replace(/\s+/g, " "));

/**
 * Look up the canonical name in `category` for a given input.
 * Returns null if unknown.
 *
 * @param {keyof REGISTRY} category
 * @param {string} input
 * @returns {string|null}
 */
export function canonical(category, input) {
  const idx = REVERSE_INDEX[category];
  if (!idx) return null;
  const k = norm(input);
  if (!k) return null;
  return idx.get(k) ?? null;
}

/**
 * True if `input` resolves to ANY canonical name in `category`.
 *
 * @param {keyof REGISTRY} category
 * @param {string} input
 * @returns {boolean}
 */
export function isInCategory(category, input) {
  return canonical(category, input) !== null;
}

/**
 * The list of canonical names registered in `category`.
 *
 * @param {keyof REGISTRY} category
 * @returns {string[]}
 */
export function allCanonicals(category) {
  return Object.keys(REGISTRY[category] ?? {});
}

/**
 * Best-effort canonicalisation across ALL categories. Used when the
 * caller has a string but doesn't know which textile dimension it's in.
 * Returns the first category that produces a hit.
 *
 * @param {string} input
 * @returns {{ category: string, canonical: string } | null}
 */
export function classify(input) {
  for (const category of Object.keys(REGISTRY)) {
    const c = canonical(category, input);
    if (c) return { category, canonical: c };
  }
  return null;
}

// Categories enum (for autocomplete)
export const CATEGORIES = Object.freeze(Object.keys(REGISTRY));

// ── DIRECTION_BY_PART ──────────────────────────────────────────────────────
//
// Default cutting-grain direction for fabric components. Keyed by canonical
// part name. Used by PO import + Consumption Library when no direction was
// provided in the source data. Returns null when the part has no
// conventional direction (e.g. fabric bag — cut from any orientation).

const DIRECTION_BY_PART = {
  // WXL — width × length, cut crosswise (most sheet/protector parts)
  "Flat Sheet":    "WXL",
  "Fitted Sheet":  "WXL",
  "Pillow Case":   "WXL",
  "Sham":          "WXL",
  "Top Fabric":    "WXL",
  "Bottom":        "WXL",
  "Front":         "WXL",
  "Back":          "WXL",
  "Platform":      "WXL",
  "Sleeper Flap":  "WXL",
  "Evalon Membrane": "WXL",

  // LXW — length × width, cut along grain
  "Skirt":         "LXW",

  // WXL — bias cuts treated as width-direction strips for now
  "Piping":        "WXL",
  "Binding":       "WXL",

  // No conventional direction — cut from offcuts in any orientation
  "Filling":       null,
  "Lamination":    null,
  "Fabric Bag":    null,
  "Quilting":      null,
  "Pillow Compression": null,
  "Outer":         null,
  "Inner":         null,
};

/**
 * Default cutting direction for a fabric component, by canonical part name.
 * Accepts ANY alias (will canonicalise) — pass the raw component_type.
 *
 * @param {string} partInput  e.g. "Top Sheet", "Fitted Sheet (Split Head)"
 * @returns {string|null}     "WXL" / "LXW" / null
 */
export function directionForPart(partInput) {
  const cn = canonical("part", partInput);
  if (cn && cn in DIRECTION_BY_PART) return DIRECTION_BY_PART[cn];
  return null;
}

// ── PRODUCT_FAMILIES ───────────────────────────────────────────────────────
//
// Regex patterns for detecting product family from an SKU code. Used by
// componentClassifier.js, descriptionResolver.js, and articleTypes.js —
// previously triple-implemented with diverging regex.
//
// Order matters: more specific patterns first. The classifier returns the
// first match.

// IMPORTANT: SKU codes are concatenated (e.g. "GPMP38", not "GP MP 38"),
// so \b word boundaries don't fire between letters. Use plain substring
// matches (case-insensitive). Order matters: more specific first.

const PRODUCT_FAMILY_PATTERNS = [
  // Pillow Protectors — codes ending in PPK/PPQ or containing PP\d
  { family: "Pillow Protector",   pattern: /PP[KQ]\d*$|PP\d/i },
  // Mattress Protectors — MP\d
  { family: "Mattress Protector", pattern: /MP\d/i },
  // Encasements
  { family: "Sleeper Encasement", pattern: /SE\d/i },
  { family: "Total Encasement",   pattern: /TE\d/i },
  // Sheet sets — multiple naming conventions
  { family: "Sheet Set",          pattern: /CSS|JFCSS|^SLP|SHTSET|SHEET|(?:^|[^A-Z])SS[-_]/i },
  // Pillow cases (standalone)
  { family: "Pillow Case",        pattern: /PC\d|PILLOWCASE|PILLCASE|PCASE/i },
  // Bedding accents
  { family: "Comforter",          pattern: /COMF|CMFTR|COMFORTER/i },
  { family: "Duvet Cover",        pattern: /DC\d|DUVET|DUV\d/i },
  { family: "Mattress Topper",    pattern: /TOPPER|TPR\d|MATTOP|MTOP/i },
  { family: "Bed Skirt",          pattern: /BEDSKIRT|BSK\d|SKRT\d|BSKT/i },
  { family: "Throw",              pattern: /THROW|THRW|BLANKET|BLNKT/i },
];

/**
 * Detect product family from an SKU code or product name.
 * Returns the first matching family, or null.
 *
 * @param {string} input  e.g. "GPMP38", "PCSJMO-Q-WH"
 * @returns {string|null} e.g. "Mattress Protector"
 */
export function productFamilyOf(input) {
  if (!input) return null;
  const s = String(input);
  for (const { family, pattern } of PRODUCT_FAMILY_PATTERNS) {
    if (pattern.test(s)) return family;
  }
  return null;
}

/** All registered product family names. */
export const PRODUCT_FAMILIES = Object.freeze(
  PRODUCT_FAMILY_PATTERNS.map((p) => p.family),
);

// Test / inspection helpers — exported under a single namespace so they
// don't pollute the main API surface.
export const _internals = {
  REGISTRY,
  REVERSE_INDEX,
  norm,
  DIRECTION_BY_PART,
  PRODUCT_FAMILY_PATTERNS,
};
