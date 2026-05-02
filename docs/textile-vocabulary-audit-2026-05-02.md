# Textile Vocabulary Audit — 2026-05-02

## Summary
- Total classifier/normalizer touch points found: **22 distinct hardcoded vocabulary lists** spread across **17 files** (plus 1 edge-function prompt and 1 partial central module)
- Total distinct vocabulary categories: **10** (parts, fabric constructions, fibres, accessory categories, trim types, sizes, directions, units, treatments, colours) plus several auxiliary taxonomies (product family codes, polybag/stiffener mismatch keywords, label-type synonyms, packaging tab `typeOptions`)
- Files that need migration: **17** (8 core lib modules, 4 page-level files, 4 component dialogs, 1 edge-function prompt). A partial central module already exists at `src/lib/textileVocabulary.js` but **nothing else in the codebase imports from it yet.**

The good news: a `src/lib/textileVocabulary.js` is already shipped with `canonical()` / `isInCategory()` / `allCanonicals()` / `classify()` and ten registries (part, fabric_type, fibre, accessory, trim, size, direction, treatment, colour). It is functionally complete enough to absorb most of the listed call sites. The remaining work is migration, not new authorship.

## Inventory by category

### Garment parts (component_type values)

| File | Lines | Constant | Sample values | Risk |
|---|---|---|---|---|
| `src/lib/partNameCanonical.js` | 32–75 | `ALIASES` (object) | flat sheet, flatsheet, top sheet → "Flat Sheet"; fitted sheet, fittedsheet, deep pocket fitted sheet, split top fitted sheet, split head fitted sheet, fitted sheet and split top fitted sheet → "Fitted Sheet"; pillow case, pillowcase, pillow cases, pillow case 1pc, pillow case 2pc → "Pillow Case"; sham, pillow sham → "Sham"; fabric bag, self fabric bag, self-fabric bag, drawstring bag → "Fabric Bag"; top fabric, top, bottom, bottom fabric, skirt, border, platform, binding, piping, filling, fill, lamination, evalon membrane, sleeper flap, front, back. **24 keys, 18 canonical outputs.** | HIGH |
| `src/lib/extractionAnomalyDetector.js` | 58–73 | `KNOWN_COMPONENT_TYPES` (Set) | flat sheet, fitted sheet, pillow case, pillowcase, sham, fabric bag, top fabric, bottom, skirt, platform, binding, piping, filling, front, back, lamination, sleeper flap, evalon membrane, pillow case (1pc), pillow case (2pc), fitted sheet (2pc split), fitted sheet (split head), quilting, pillow compression, outer, inner, polybag, poly bag, pvc bag, stiffener, insert, insert card, label, size label, care label, law tag, hang tag, barcode sticker, size sticker, zipper, thread, elastic. **41 entries.** Mixes parts AND accessories. | HIGH |
| `src/lib/fabricClassifier.js` | 19–25 | `FABRIC_TYPES` (Set) | platform, skirt, piping, binding, bottom, "bottom + skirt", sleeper flap, evalon membrane, flat sheet, fitted sheet, fitted sheet (2pc split), fitted sheet (split head), pillow case (1pc), pillow case (2pc), fabric bag, front, back, top fabric, filling, lamination. **20 entries.** Decides fabric-vs-not on the printout. | HIGH |
| `src/lib/fabricClassifier.js` | 38–43 | `ACCESSORY_TYPES` (Set) | zipper, thread, elastic, law tag, size label, label, pvc bag, insert card, stiffener, stiffener size, size sticker, barcode sticker, barcode sticker size, packaging, care label, hang tag, poly bag. **17 entries.** | HIGH |
| `src/lib/bobTechPackParser.js` | 83–88 | `COMPONENT_TYPE_TOKENS` (Set) | flat sheet, fitted sheet, pillow case, pillowcase, sham, top fabric, lining, binding, skirt, front, bottom, piping, filling, lamination, fabric bag, quilting, pillow compression, platform, evalon membrane, sleeper flap. **20 entries.** | HIGH |
| `src/components/fabric/FabricEditDialog.jsx` | 6 | `COMPONENT_TYPES` (array) | Flat Sheet, Fitted Sheet, Pillow Case, Front, Skirt, Bottom, Piping, Binding, Filling, Lamination, Top Fabric, Window (Outside), Window (Inside), Fabric Bag, Quilting, Pillow Compression, Other. **17 entries.** Used as `<select>` dropdown. | MED |
| `src/components/fabric/ArticleFabricSetup.jsx` | 6 | `COMPONENT_TYPES` (array) | Front, Skirt, Bottom, Piping, Binding, Filling, Lamination, Top Fabric, Window (Outside), Window (Inside), Fabric Bag, Fabric Swatch, Quilting, Pillow Compression. **14 entries.** Embedded into AI prompt at line 36. | MED |
| `src/components/po/SKUReviewDialog.jsx` | 16 | `COMPONENT_TYPES` (array) | Front, Skirt, Bottom, Flat Sheet, Fitted Sheet, Pillow Case, Piping, Binding, Filling, Lamination, Top Fabric, Window (Outside), Window (Inside), Fabric Bag, Quilting, Other. **16 entries.** | MED |
| `src/components/articles/ArticleFormDialog.jsx` | 10–13 | `COMPONENT_TYPES` (array) | Top Fabric, Bottom Fabric, Skirt Fabric, Piping, Binding, Filling / Padding, Lamination / TPU, Lining, Other. **9 entries**, naming convention differs ("Fabric" suffix). | MED |
| `src/lib/articleTypes.js` | 12–63 | `PRODUCT_TYPES.*.components` | Per product: Mattress Protector → Platform, Skirt, Piping, Binding; Total Encasement → +Bottom + Skirt, Zipper; Sleeper Encasement → +Sleeper Flap, Evalon Membrane; Pillow Protector → Platform, Zipper; Bolster Protector; Bed Sheet Set → Flat Sheet Fabric, Fitted Sheet Fabric, Pillowcase Fabric, Elastic; Comforter Set → Shell Fabric, Lining Fabric, Filling. | HIGH |
| `supabase/functions/extract-document/prompts.ts` | 114–119 | inside system prompt | Flat Sheet, Fitted Sheet, Pillow Case, Sham, Fabric Bag, Top Fabric, Bottom, Skirt, Front, Back, Binding, Piping, Filling, Platform, Sleeper Flap, Lamination, Quilting, Outer, Inner, Pillow Case (1pc), Pillow Case (2pc). **21 entries.** Constrains AI extraction. | HIGH |
| `src/lib/textileVocabulary.js` | 42–76 | `PART_NAMES` (already-central registry) | Same canonical set, with aliases. Authoritative — others should redirect here. | — |

### Fabric types / constructions

| File | Lines | Constant | Sample values | Risk |
|---|---|---|---|---|
| `src/lib/extractionAnomalyDetector.js` | 29–54 | `FABRIC_DESCRIPTOR_PATTERNS` (regex array) | `\d{2,4} gsm`, `\d{1,3}%`, jersey knit, modal, cotton, spandex, polyester, poly, nylon, silk, linen, bamboo, tencel, lyocell, sateen, percale, flannel, microfiber, yarn-count, thread count, `\dTC`, egyptian, supima, pima. **23 patterns.** Used to detect fabric-vs-part swap. | HIGH |
| `supabase/functions/extract-document/prompts.ts` | 102–112 | "FORBIDDEN" list inside prompt | Jersey Knit, Sateen, Percale, Flannel, Microfiber, Cotton, Modal, Polyester, Spandex, Nylon, Silk, Linen, Bamboo, Tencel, Lyocell, plus GSM/% patterns and yarn/thread-count patterns. | HIGH |
| `src/lib/textileVocabulary.js` | 81–106 | `FABRIC_TYPES` registry (already-central) | Jersey Knit, Interlock Knit, Pique Knit, Rib Knit, Tricot Knit, French Terry, Velour, Sateen, Percale, Twill, Plain Weave, Flannel, Microfiber, Damask, Jacquard, Poplin, TPU Laminate, PU Laminate, Non-woven. **19 canonicals + aliases.** | — |
| `src/lib/textileVocabulary.js` | 110–127 | `FIBRE_TYPES` registry | Cotton, Egyptian Cotton, Pima, Supima, Modal, Lyocell, Bamboo, Polyester, Spandex, Nylon, Silk, Linen, Wool, Rayon, Acrylic, Microfiber Polyester. **16 canonicals.** | — |
| `src/components/po/POItemFormDialog.jsx` | 118 | placeholder text | "e.g. Cotton Terry" — placeholder only, no list. | LOW |
| `src/components/po/SKUReviewDialog.jsx` | 32 | placeholder | "Single Jersey" — placeholder only. | LOW |

### Accessory categories / packaging

| File | Lines | Constant | Sample values | Risk |
|---|---|---|---|---|
| `src/lib/extractionAnomalyDetector.js` | 76–81 | `KNOWN_ACCESSORY_CATEGORIES` (Set) | polybag, poly bag, pvc bag, stiffener, insert card, label, size label, care label, law tag, hang tag, barcode sticker, size sticker, zipper, thread, elastic, tape, binding, packaging, sticker. **19 entries.** | HIGH |
| `src/lib/componentClassifier.js` | 19–31 | `CANONICAL_TYPES` (array) | Label, Insert Card, Polybag, Accessory Bag, Stiffener, Carton, Sticker, Zipper, Trim, Hang Tag, Other. **11 entries.** Used by Packaging Planning tabs. | HIGH |
| `src/lib/componentClassifier.js` | 37–189 | `RULES` (array of regex tests) | "Other" rule (process specs, stitch density, sewing construction, ball point needle, overlocking, bound seam, packaging-summary heuristic); Accessory Bag (polybag, poly bag, pvc bag, opp bag, plastic bag, pe bag, hang-tag bag + hanger/adhesive heuristics); Hang Tag (hang tag, swing tag, swing ticket, brand tag, paper tag); Label (care label, brand label, size label, main label, woven label, printed label, law tag, composition label, country of origin, made in, non-woven label); Sticker (sticker, barcode, upc, qr code, ean, adhesive label, carton mark); Insert Card (insert card, art card, color paper insert, bleach card, info card, booklet, leaflet, "direct print on insert"); Stiffener (stiffener, cardboard, U-shape, card stiffener); Carton (master carton, outer carton, shipping carton, export carton, ply, B-flute, C-flute, corrugated, brown, kraft); Polybag (ldpe bag, bag material …); Trim/Zipper veto rules; Trim (binding, piping, elastic, drawcord, cord lock, ribbon, velcro, hook and loop, button, rivet). | HIGH |
| `src/lib/descriptionResolver.js` | 26–35 | `CATEGORY_ALIASES` (map) | Label → label, law tag, care label, size label, brand label, hang tag, wash label; Insert Card → insert card, insert, color paper insert, art card, bleach card; Polybag → polybag, poly bag, pvc bag, pvc, pe bag, opp bag, ldpe bag, bag material; Stiffener → stiffener, cardboard, card stiffener, stiffener size; Carton → carton, carton box, outer carton, shipping carton, carton size; Sticker → sticker, barcode sticker, size sticker, upc sticker, barcode label, qr code; Zipper → zipper, zip, zipper end piecing; Trim → trim, binding, piping, elastic, drawcord, ribbon, velcro. | HIGH |
| `src/lib/descriptionResolver.js` | 41–48 | `NON_CATEGORY_BLACKLIST` (array) | stitching density, stitches per inch, sewing construction, sewing details, needle, fabric construction. | MED |
| `src/lib/descriptionResolver.js` | 75–92 | `LABEL_TYPE_SYNONYMS` (map) | Brand Label → brand, logo, main label; Care Label → care, wash, laundry, care instruction, law tag, wash care; Size Label → size, size tag; Direction Label → direction, head end, foot end, this side up, top-bottom; Hang Tag → hang tag, hangtag, swing tag, ticket; Country of Origin → made in, origin label; Composition → fiber/fibre content, % cotton, % polyester; Wash Label → washing, wash instruction; Price Ticket → price tag, msrp, retail price; Compliance → ce mark, iso 9001; Retailer → store label, private label; Eco → oeko-tex, fsc, fair trade; GOTS; Barcode → barcode, upc, ean; Custom; Care label in 3 Languages 1X3 → 3 language, tri-lingual, 1x3. | HIGH |
| `src/lib/bobTechPackParser.js` | 324–334 | `KEYS` map (packaging sheet) | "Packaging type" → Packaging; "Bag material" → PVC Bag; "Color paper insert material" → Insert Card; "Cardboard material(Stiffener)" → Stiffener; "Size Sticker"; "Barcode sticker"; "Barcode Sticker /Size" → Barcode Sticker Size; "Cardboard" → Stiffener (Cardboard); "cardboard size" → Stiffener Size. | MED |
| `src/lib/bobTechPackParser.js` | 371–382 | `KEY_TO_TYPE` (regex tuples) | Elastic; Zipper (incl. typo "Zippw"); Thread; Sewing Construction; Overlocking Stitch; Stitching Density; Needle; Bound Seam Material; Zipper End Piecing. | MED |
| `src/pages/PackagingPlanning.jsx` | 13–95 | `TAB_CONFIG.*.typeOptions` | Labels: Brand Label, Care Label, Size Label, Direction Label, GOTS Label, Barcode Label, Hang Tag, Country of Origin Label, Composition Label, Wash Label, Price Ticket, Compliance Label, Retailer Label, Eco Label, Care label in 3 Languages 1X3, Custom Label. Insert Card: Art Card, Box Packaging, Bleach Card, Bux Board, Custom. Polybag: PVC, PP, PE, LDPE, OPP. Stiffener: Cardboard, PVC Sheet, Foam Board, MDF, Corrugated, Other. Carton: Printed, Plain, Brown, White. Sticker: UPC Sticker, Packaging Info Sticker, Retailer Sticker, Warning Sticker, QR Code Sticker, Compliance Sticker, Custom Sticker. Zipper: SBS Nylon Zipper, Coil Zipper, Metal Zipper, Invisible Zipper, Plastic Molded Zipper, Custom. Trim: Elastic, Drawcord, Cord Lock, Drawcord Stopper, Jacquard Band, Velcro, Rivet, Button, Ribbon, Piping, Custom. | MED |
| `supabase/functions/extract-document/prompts.ts` | 126–129 | inside system prompt | Care Label, Hang Tag, Polybag, PVC Bag, Stiffener, Insert Card, Sticker, Zipper, Thread, Elastic, Tape, Binding, Packaging, Size Label, Law Tag, Barcode Sticker. **16 entries.** | HIGH |
| `supabase/functions/classify-components/index.ts` | 19–30 | inside system prompt | Label, Insert Card, Polybag, Accessory Bag, Stiffener, Carton, Sticker, Zipper, Trim, Hang Tag, Other. | HIGH |
| `src/lib/articleTypes.js` | 12–63 | `PRODUCT_TYPES.*.accessories` | Law Tag, Size Label, PVC Bag, Insert Card, Stiffener, Size Sticker, Barcode Sticker, Zipper Tape, Care Label, Hangtag (note inconsistent spelling). | MED |
| `src/lib/textileVocabulary.js` | 134–158 | `ACCESSORY_CATEGORIES` registry | Care Label, Size Label, Brand Label, Hang Tag, Polybag, PVC Bag, Insert Card, Stiffener, Sticker, Zipper, Thread, Elastic, Tape, Velcro, Snap, Button, Drawcord, Law Tag, Packaging. **19 canonicals + aliases.** | — |

### Trim types

| File | Lines | Constant | Sample values | Risk |
|---|---|---|---|---|
| `src/pages/Trims.jsx` | 93–97 | `TRIM_CATEGORIES` (array) | Zipper, Elastic, Button, Dori, Eyelet, Stitching Thread, Velcro, Snap Button, Hook & Eye, Buckle, Drawstring, Ribbon, Tape, Interlining, Lace, Patch, Thread, Other. **18 entries.** | MED |
| `src/pages/Trims.jsx` | 125–137 | `inferCategory()` (function) | regex on description text → Zipper, Elastic, Button, Stitching Thread, Eyelet, Dori, Velcro, Ribbon, Snap Button, Other. | MED |
| `src/lib/textileVocabulary.js` | 162–173 | `TRIM_TYPES` registry | Zipper, Thread, Elastic, Binding, Piping, Tape, Velcro, Snap, Hook, Eyelet. **10 canonicals.** Smaller than Trims.jsx list. | — |

### Sizes

| File | Lines | Constant | Sample values | Risk |
|---|---|---|---|---|
| `src/lib/skuSizeInference.js` | 19–36 | `SIZE_CODE_LABELS` (object) | f→Full, fxl→Full XL, q→Queen, k→King, ck→Cal King, kck→King/Cal King, spk→Split King, spck→Split Cal King, shk→Split Head King, shq→Split Head Queen, shck→Split Head Cal King, ttxl→Twin/Twin XL, tx→Twin XL, txl→Twin XL, t→Twin. **15 entries.** | HIGH |
| `src/lib/skuSizeInference.js` | 41–44 | `COMMON_COLOR_CODES` (Set) | gy, wh, bl, iv, cg, mb, bk, rd, bg, white, black, blue, gray, grey, ivory, red, beige. **17 entries.** Used to disambiguate size-vs-colour in SKU codes. | MED |
| `src/lib/textileVocabulary.js` | 177–204 | `SIZES` registry | Twin, Twin XL, Twin/Twin XL, Full, Full XL, Queen, King, Cal King, King/Cal King, Split King, Split Cal King, Split Head King, Split Head Queen, Split Head Cal King, Split Queen, Standard Pillow, Queen Pillow, King Pillow, Body Pillow, Travel Pillow. **20 canonicals + aliases.** | — |

### Direction codes

| File | Lines | Constant | Sample values | Risk |
|---|---|---|---|---|
| `src/pages/PurchaseOrders.jsx` | 309–316 | `directionFor()` (inline function) | skirt → "LXW"; piping/binding → "WXL"; regex `/platform\|bottom\|sleeper\|evalon\|sheet\|front\|back\|top fabric\|pillow case/` → "WXL"; else null. | HIGH |
| `src/pages/ConsumptionLibrary.jsx` | 177–184 | `directionFor()` (inline function) | Identical body to PurchaseOrders.jsx version. **Duplicated logic.** | HIGH |
| `src/lib/textileVocabulary.js` | 208–215 | `DIRECTIONS` registry | WXL, LXW, LXL, WXW, Bias (with aliases). **5 canonicals.** | — |

### Units (GSM, etc.)

| File | Lines | Constant | Sample values | Risk |
|---|---|---|---|---|
| `src/pages/Trims.jsx` | 99 | `UNITS` (array) | Pcs, Meters, Kgs, Rolls, Dozens, Gross, Sets, Pairs. **8 entries.** | LOW |
| `src/lib/dimensionNormalizer.js` | 33 | `UNIT_RE` (regex) | cm, mm, inch, in, `"`, `'`. Recognises units in dimension strings. | LOW |
| `src/lib/extractionAnomalyDetector.js` | 30, 48 | inside FABRIC_DESCRIPTOR_PATTERNS | `\d{2,4} gsm`, yarn count `\d+s`, denier `\d+D`, thread count `\dTC`. | LOW |

(No standalone Units registry in `textileVocabulary.js` yet — easy add.)

### Treatments / finishes

| File | Lines | Constant | Sample values | Risk |
|---|---|---|---|---|
| `src/lib/textileVocabulary.js` | 219–230 | `TREATMENTS` registry | Antimicrobial (silvadur), Stain Repellent (scotchgard), Waterproof, Water Resistant (dwr), Wrinkle Free, Brushed, Mercerised, Sanforised, Cooling (cool touch, stretch cool), Flame Retardant. **10 canonicals.** | — |

No other file has a treatment list — but `bobTechPackParser.js` writes to a `treatment` field (lines 58, 70) without normalization. MED risk: same finish stored two ways across customers.

### Colours

| File | Lines | Constant | Sample values | Risk |
|---|---|---|---|---|
| `src/lib/skuSizeInference.js` | 41–44 | `COMMON_COLOR_CODES` (Set) | (already listed under Sizes) — short-form codes only. | MED |
| `src/lib/bobTechPackParser.js` | 451 | inline regex | `if (/white/i.test(f.fabric_type)) color="White"` — only White. | MED |
| `src/lib/textileVocabulary.js` | 234–254 | `COLOURS` registry | White, Black, Grey, Light Grey, Dark Grey, Dove Gray, Cloud Gray, Misty Blue, Navy, Blue, Light Blue, Ivory, Beige, Brown, Red, Pink, Purple, Green, Yellow. **19 canonicals + aliases incl. 2-letter SKU codes.** | — |

### Auxiliary taxonomies (product-family codes, mismatch keywords)

These don't fit the main 10 categories but are textile-domain classification logic and should likely live next to the central vocabulary.

| File | Lines | Constant | Sample values | Risk |
|---|---|---|---|---|
| `src/lib/componentClassifier.js` | 263–289 | `PRODUCT_TYPE_PATTERNS` (regex array) | Pillow Protector (PP[KQ], PP\d), Mattress Protector (MP\d), Sleeper Encasement (SE\d), Total Encasement (TE\d), Sheet Set (CSS, JFCSS, ^SLP, SHTSET, SHEET, SS-), Pillow Case (PC\d, PILLOWCASE), Comforter (COMF, CMFTR), Duvet Cover (DC\d, DUVET), Mattress Topper (TOPPER, TPR\d, MATTOP), Bed Skirt (BEDSKIRT, BSK\d), Throw (THROW, THRW, BLANKET). **11 product families.** | HIGH |
| `src/lib/componentClassifier.js` | 311–346 | `STIFFENER_MISMATCH_RULES` | Per product type: bad/expected keyword lists (e.g. Pillow Protector bad: '"u" 1 ply', "u-1 ply", "u 1 ply thickness", "1 ply thickness", "maintain the shape"; expected: "white square card"). | MED |
| `src/lib/componentClassifier.js` | 350–390 | `POLYBAG_MISMATCH_RULES` | Per product type: bad keywords (Pillow Protector: "nylon coil zipper", "coil zipper", "no hanger loop on top", "12s transparent", "bound seam", "white pvc binding all around"; expected: "plastic hanger", "adhesive tape", "hanger on top"). | MED |
| `src/lib/descriptionResolver.js` | 244–253 | `PRODUCT_TYPE_KEYWORDS` (map) | Pillow Protector → ["pillow protector", "pillow protect"]; Mattress Protector; Sleeper Encasement; Total Encasement; Sheet Set; Pillow Case; Comforter; Duvet Cover. **8 families with keyword aliases.** | HIGH |
| `src/lib/descriptionResolver.js` | 255–267 | `inferProductType()` (regex) | Re-implements PRODUCT_TYPE_PATTERNS inline (different file, same logic) to avoid an import. **Duplicated logic.** | HIGH |
| `src/lib/articleTypes.js` | 69–110 | `classifyArticle()` (regex) | Third re-implementation of product-family detection, keyed on article_code regex AND text fields (name, product_type). Returns one of the 9 PRODUCT_TYPES enums. | HIGH |
| `src/lib/fabricBagDimensionCheck.js` | 25–42 | inline string compare | hardcoded `"fabric bag"` checks in two functions. | MED |
| `src/pages/Trims.jsx` | 16–91 | `CALC_TYPES` | Per Piece, Per Meter, Per Set, Percentage, Per Dozen, Fixed. UI consumption-formula labels. | LOW (not vocabulary, but a fixed enum). |

## Migration risk analysis

**HIGH-risk findings (misclassification corrupts persisted data):**

1. **Triple-implemented product-family detection.** `componentClassifier.detectProductTypeFromCode()`, `descriptionResolver.inferProductType()`, and `articleTypes.classifyArticle()` all infer "is this a Pillow Protector / Mattress Protector / Sheet Set / …" from the SKU code or name, but with **diverging regex** and **different output enums** ("Pillow Protector" vs `PRODUCT_TYPES.PILLOW_PROTECTOR`). When a new product family appears (e.g. duvet covers in a customer file), only one of the three updates and the other two silently mis-categorise. The `articleTypes.classifyArticle()` version is the most permissive (also reads name text), the others are code-only.

2. **Two different "is this fabric?" registries.** `fabricClassifier.FABRIC_TYPES` (20 entries) controls what appears on the printout the user hands to the central-ERP data-entry team. `extractionAnomalyDetector.KNOWN_COMPONENT_TYPES` (41 entries, mixed parts and accessories) controls the AI auto-fix swap detection. They disagree — `KNOWN_COMPONENT_TYPES` includes "polybag" and "zipper" as KNOWN, while `fabricClassifier` correctly excludes them. A new sheet-set part name added to one will not be added to the other.

3. **Inline `directionFor()` is duplicated character-for-character** in `PurchaseOrders.jsx:309–316` and `ConsumptionLibrary.jsx:177–184`. If the user adds "Sham" to the WXL list in one, the other diverges. Direction is persisted on `articles.components[].direction` and feeds the cutting-room workflow — wrong direction = wrong fabric usage calc.

4. **AI prompt contains a hardcoded list** of allowed `component_type` values (21 names) and forbidden fabric descriptors (15+ patterns) at `prompts.ts:102–119`. When the operations team adds "Quilt Cover" or "Pillow Sham" to the system, the AI will refuse to extract it because the prompt says `component_type` MUST be one of those exact 21 strings. **No client-side code knows this prompt list exists** — it diverges silently.

5. **`KNOWN_COMPONENT_TYPES` mixes parts and accessories.** Lines 70–73 of `extractionAnomalyDetector.js` put "polybag", "zipper", "label", "thread", etc. into the SAME Set as "flat sheet" and "skirt". The detector therefore sees "zipper" as a valid `component_type` even though it's an accessory. This was deliberate (rows that come in mis-labelled aren't auto-fixed) but it's a footgun — anyone reading "KNOWN_COMPONENT_TYPES" will assume those are parts.

6. **Size inference uses a small `SIZE_CODE_LABELS` table** (15 entries) with a hardcoded `COMMON_COLOR_CODES` set of 17 entries to disambiguate. New colour codes (a brand introduces "TQ" for turquoise) will be parsed as a size and stored as the SKU's product_size — directly corrupting the Fabric Working Sheet's per-SKU size column.

**MED-risk findings (UI shows wrong dropdown / spec but underlying data is OK):** four `COMPONENT_TYPES` arrays in dialog components disagree on which parts are selectable; `TAB_CONFIG.typeOptions` in PackagingPlanning.jsx has 90+ values that aren't checked against the central registry; `TRIM_CATEGORIES` in Trims.jsx (18 entries) overlaps but doesn't equal the central `TRIM_TYPES` (10 entries); `LABEL_TYPE_SYNONYMS` controls smart-defaults on label dropdowns.

## Recommended migration order

Migrate in this order so the highest-risk drift is closed first while UI changes can land independently:

1. **`src/lib/partNameCanonical.js`** → make it import from `textileVocabulary.PART_NAMES` and become a thin variant-stripper. Currently it owns its own ALIASES table that overlaps `PART_NAMES` 100 %.
2. **`src/lib/fabricClassifier.js`** → replace `FABRIC_TYPES` and `ACCESSORY_TYPES` Sets with `isInCategory("part", x)` and `isInCategory("accessory", x)`. This is the printout gate; getting it consistent with everything else is the highest-leverage single change.
3. **`src/lib/extractionAnomalyDetector.js`** → replace `KNOWN_COMPONENT_TYPES` and `KNOWN_ACCESSORY_CATEGORIES` with `allCanonicals("part")` + `allCanonicals("accessory")`. Replace `FABRIC_DESCRIPTOR_PATTERNS` with `isInCategory("fabric_type", x) || isInCategory("fibre", x) || /\d+\s*gsm/`.
4. **`src/lib/skuSizeInference.js`** → replace `SIZE_CODE_LABELS` with `canonical("size", code)`. Add the SKU-suffix abbreviations (q, k, ck, ttxl, …) to `SIZES` aliases. `COMMON_COLOR_CODES` becomes `isInCategory("colour", x)`.
5. **`src/pages/PurchaseOrders.jsx` + `src/pages/ConsumptionLibrary.jsx`** → de-duplicate `directionFor`. Move it into a tiny helper inside `textileVocabulary.js` (e.g. `directionFor(componentType)` that consults a `DIRECTION_BY_PART` map).
6. **`src/lib/componentClassifier.js`** → keep the regex-rule classifier, but pull all CANONICAL_TYPES strings from `allCanonicals("accessory")`. Move `PRODUCT_TYPE_PATTERNS` into `textileVocabulary.PRODUCT_FAMILIES` and have `descriptionResolver.inferProductType()` + `articleTypes.classifyArticle()` import from it.
7. **`src/lib/descriptionResolver.js`** → `CATEGORY_ALIASES`, `LABEL_TYPE_SYNONYMS`, `NON_CATEGORY_BLACKLIST`, `PRODUCT_TYPE_KEYWORDS` all migrate into the central registry. Fold the `inferProductType` re-implementation into a single shared function.
8. **`src/lib/articleTypes.js`** → keep the `PRODUCT_TYPES` taxonomy (it's the only place that maps product → expected components/accessories) but have its `components` and `accessories` arrays reference `PART_NAMES` / `ACCESSORY_CATEGORIES` canonicals, not free text.
9. **`src/lib/bobTechPackParser.js` (and the duplicate at `supabase/functions/extract-document/bobTechPackParser.js`)** → replace `COMPONENT_TYPE_TOKENS`, the packaging `KEYS` map, and `KEY_TO_TYPE` regex tuples with central canonical lookups. Inline `/white/i` colour test → `canonical("colour", value)`.
10. **`src/components/fabric/FabricEditDialog.jsx`, `ArticleFabricSetup.jsx`, `articles/ArticleFormDialog.jsx`, `po/SKUReviewDialog.jsx`** → all four hardcoded `COMPONENT_TYPES` arrays → `allCanonicals("part")`. The AI prompt in `ArticleFabricSetup.jsx:36` (`Component types: ${COMPONENT_TYPES.join(", ")}`) becomes self-updating.
11. **`src/pages/PackagingPlanning.jsx`** → Each tab's `typeOptions` migrates to a sub-registry under accessory (e.g. `LABEL_TYPES`, `STICKER_TYPES`, `ZIPPER_TYPES`). Centralising these cleans up `LABEL_TYPE_SYNONYMS` too.
12. **`src/pages/Trims.jsx`** → `TRIM_CATEGORIES` and `inferCategory()` swap to the registry.
13. **`supabase/functions/extract-document/prompts.ts`** → import canonical lists at build time (or have a generator step that templates the prompt) so the FORBIDDEN list and the allowed-component list stay in sync with the registry. THIS IS THE ONE THAT CANNOT BE A RUNTIME IMPORT — the edge function can't import from `src/`. Either copy the registry into a Deno-friendly TS module shared by both, or run a build-time codegen step.
14. **`supabase/functions/classify-components/index.ts`** — same constraint as #13. The category list in its system prompt is duplicated.

After these 14 migrations the only bespoke vocabulary should be `CALC_TYPES` (calculation formulas, not textile terms) and the regex-shape `RULES` array in `componentClassifier.js` (which depends on free-text patterns, not canonical names).
