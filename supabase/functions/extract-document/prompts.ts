// supabase/functions/extract-document/prompts.ts
//
// System prompts and tool schemas for the extract-document edge function.
// Versioned via PROMPT_VERSION_BY_KIND so every extraction row records the
// exact prompt it was produced with. Bump the version (v1 -> v2) on any
// material edit to a system prompt or tool schema.
//
// Schemas mirror spec 2026-04-25-ai-extraction §5.4 and §5.5.

export type ExtractionKind = "tech_pack" | "master_data";

export const PROMPT_VERSION_BY_KIND: Record<ExtractionKind, string> = {
  tech_pack: "tech_pack.v1",
  master_data: "master_data.v3",  // v3 (2026-05-01): column-header-authoritative + forbidden component_type values + multi-format support
};

// Phase E2: every kind starts on Haiku and escalates to Sonnet on low
// confidence (see CONFIDENCE_FALLBACK_THRESHOLD in index.ts). MODEL_BY_KIND
// is kept as the *primary* model only; the fallback chain is in MODEL_CHAIN_BY_KIND.
export const MODEL_BY_KIND: Record<ExtractionKind, string> = {
  tech_pack: "claude-haiku-4-5-20251001",
  master_data: "claude-haiku-4-5-20251001",
};

export const MODEL_CHAIN_BY_KIND: Record<ExtractionKind, string[]> = {
  tech_pack: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"],
  master_data: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"],
};

// Tone and rules shared by every prompt. Folded into each system message so
// subtle behaviour (do-not-invent, conservative-nullability) does not drift.
const COMMON_RULES = `
You are extracting structured data for a manufacturing ERP. Rules:
- If a value is not present in the source, leave it null. Do not invent values.
- Normalise units where obvious (e.g. "150 GSM" -> 150). Leave units in the field name as documented in the schema.
- Preserve the user's exact item codes and product names. Do not rewrite or "improve" them.
- Numbers must be numbers (not strings). Strings must not contain unit suffixes when the schema asks for a number.
- Use the provided tool to return structured output. Do not respond in plain text.
`.trim();

const TECH_PACK_SYSTEM_PROMPT = `
${COMMON_RULES}

You are extracting from a single textile tech pack uploaded as XLSX.
The user message contains each worksheet rendered as a CSV block.
A tech pack typically has:
- a header sheet with brand, product type, product number, and product name
- one or more rows describing fabric components (shell, lining, fill, etc.) with GSM, construction, finish
- a SKU table where each row is one finished article (size + colour + dimensions)
- optional sheets for labels, accessories, packaging, and zipper specs

Produce one tool call to "extract_tech_pack". The "skus" array is required and must
contain at least one row. If the source genuinely has no SKU rows (e.g. the file is
not a tech pack at all), still call the tool with skus=[] and set _notes to explain.

For "_confidence.overall" use:
  0.9-1.0 = every field unambiguous
  0.6-0.9 = mostly clear, a few inferences
  0.3-0.6 = significant uncertainty
  0.0-0.3 = the source barely resembles a tech pack
`.trim();

const MASTER_DATA_SYSTEM_PROMPT = `
${COMMON_RULES}

You are extracting product master data from a customer-supplied file.
Different customers use very different layouts, column names, and
languages — your job is to map their data to MerQuant's standardized
internal schema. Only the SKU code (item_code) is universal.

Each input worksheet renders as a CSV block in the user message.
The first row is usually the column header. Treat the column headers
as AUTHORITATIVE: if a column is clearly named, use its values exactly
for the matching target field. Don't overthink or re-derive.

Standardized output sections:
- articles                (item_code, brand, product_type, size)
- fabric_consumption      (item_code, component_type, fabric_type, gsm, width_cm, consumption_per_unit, wastage_percent, color)
- accessory_consumption   (item_code, category, item_name, material, size_spec, placement, consumption_per_unit)
- carton_master           (item_code, units_per_carton, carton_length_cm, carton_width_cm, carton_height_cm)
- price_list              (item_code, price_usd, effective_from)
- suppliers               (name, contact_email, contact_phone)
- seasons                 (name, start_date, end_date)
- production_lines        (name, line_type, daily_capacity)

═══════════════════════════════════════════════════════════════════════
COLUMN MAPPING RULES (read carefully)
═══════════════════════════════════════════════════════════════════════

1. The column HEADER is your primary source of truth. If the header
   says "Part" or "Component" or "component_type", its values go to
   component_type. Don't second-guess.

2. For columns whose names don't directly match a target field, use
   the CONTENT of the values to infer the mapping:
     - Numbers like "170", "300 GSM"   → gsm
     - Numbers in cm range "112", "150" → width_cm
     - Strings like "Flat Sheet", "Fitted Sheet"  → component_type
     - Strings like "85% Modal Jersey Knit, 170 GSM" → fabric_type
     - Item codes (alphanumeric with hyphens) → item_code

3. ABSOLUTELY FORBIDDEN values for fabric_consumption.component_type:
   the following words/patterns must NEVER appear there. If you find
   a fabric description that looks like one of these, you have made
   a mistake — the value belongs in fabric_type, not component_type.
     • "Jersey Knit", "Sateen", "Percale", "Flannel", "Microfiber"
     • Material percentages: "85%", "100%"
     • Material names: "Cotton", "Modal", "Polyester", "Spandex",
       "Nylon", "Silk", "Linen", "Bamboo", "Tencel", "Lyocell"
     • GSM values: "170 GSM", "300 GSM"
     • Yarn counts: "40s", "20D", "30/1"
     • Thread counts: "300 TC", "400 TC"

4. component_type MUST be one of these (or a customer-specific variant
   of a part name — short noun phrase describing a physical garment part):
     "Flat Sheet", "Fitted Sheet", "Pillow Case", "Sham", "Fabric Bag",
     "Top Fabric", "Bottom", "Skirt", "Front", "Back", "Binding",
     "Piping", "Filling", "Platform", "Sleeper Flap", "Lamination",
     "Quilting", "Outer", "Inner", "Pillow Case (1pc)", "Pillow Case (2pc)"

5. A single SKU often has multiple fabric_consumption rows — one per
   part. They typically share the same fabric_type but have different
   component_type values. Preserve that 1:N relationship. Don't
   collapse rows that have different component_type values.

6. accessory_consumption.category should be one of: "Care Label",
   "Hang Tag", "Polybag", "PVC Bag", "Stiffener", "Insert Card",
   "Sticker", "Zipper", "Thread", "Elastic", "Tape", "Binding",
   "Packaging", "Size Label", "Law Tag", "Barcode Sticker".

═══════════════════════════════════════════════════════════════════════

Sheets you don't recognise → ignore them.
Sheets that are obviously empty (header only, no rows) → omit the
output section entirely rather than emitting an empty array.

If a sheet has data you can't confidently map (column meanings unclear),
include what you CAN map and lower _confidence.overall accordingly.
A confidence score under 0.6 will trigger a manual review step on the
client side, which is preferable to confidently emitting wrong data.

Produce one tool call to "extract_master_data".

For "_confidence.overall" use:
  0.9-1.0 = column headers were explicit; mapping was 1:1
  0.6-0.9 = some inference required from values, but mapping is sound
  0.3-0.6 = significant guesswork; ambiguous columns
  0.0-0.3 = file barely resembles master data
`.trim();

// ----- Tool schemas (Anthropic input_schema = JSONSchema subset) -----

const TECH_PACK_TOOL = {
  name: "extract_tech_pack",
  description: "Return the structured contents of a textile tech pack.",
  input_schema: {
    type: "object",
    properties: {
      header: {
        type: "object",
        properties: {
          brand:        { type: ["string", "null"] },
          product_type: { type: ["string", "null"] },
          product_no:   { type: ["string", "null"] },
          product_name: { type: ["string", "null"] },
        },
      },
      fabric_specs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            component_type: { type: ["string", "null"] },
            fabric_type:    { type: ["string", "null"] },
            gsm:            { type: ["number", "null"] },
            color:          { type: ["string", "null"] },
            construction:   { type: ["string", "null"] },
            finish:         { type: ["string", "null"] },
          },
        },
      },
      skus: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item_code:          { type: "string" },
            size:               { type: ["string", "null"] },
            color:              { type: ["string", "null"] },
            product_dimensions: { type: ["string", "null"] },
            insert_dimensions:  { type: ["string", "null"] },
            pvc_bag_dimensions: { type: ["string", "null"] },
            stiffener_size:     { type: ["string", "null"] },
            zipper_length:      { type: ["string", "null"] },
            units_per_carton:   { type: ["number", "null"] },
            carton_size_cm:     { type: ["string", "null"] },
            is_set:             { type: ["boolean", "null"] },
          },
          required: ["item_code"],
        },
      },
      labels: {
        type: "array",
        items: {
          type: "object",
          properties: {
            section:   { type: ["string", "null"] },
            type:      { type: ["string", "null"] },
            material:  { type: ["string", "null"] },
            size:      { type: ["string", "null"] },
            color:     { type: ["string", "null"] },
            placement: { type: ["string", "null"] },
          },
        },
      },
      accessories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            accessory_type: { type: ["string", "null"] },
            description:    { type: ["string", "null"] },
            material:       { type: ["string", "null"] },
            placement:      { type: ["string", "null"] },
            source_label:   { type: ["string", "null"] },
          },
        },
      },
      packaging: {
        type: "array",
        items: {
          type: "object",
          properties: {
            variant:  { type: ["string", "null"] },
            category: { type: ["string", "null"] },
            label:    { type: ["string", "null"] },
            value:    { type: ["string", "null"] },
          },
        },
      },
      zipper: {
        type: "object",
        properties: {
          length: { type: ["string", "null"] },
          type:   { type: ["string", "null"] },
          color:  { type: ["string", "null"] },
        },
      },
      _confidence: {
        type: "object",
        properties: {
          overall:     { type: "number" },
          per_section: { type: "object" },
        },
        required: ["overall"],
      },
      _notes: { type: ["string", "null"] },
    },
    required: ["skus", "_confidence"],
  },
} as const;

const MASTER_DATA_TOOL = {
  name: "extract_master_data",
  description: "Return the structured contents of a master-data XLSX export.",
  input_schema: {
    type: "object",
    properties: {
      articles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item_code:    { type: "string" },
            brand:        { type: ["string", "null"] },
            product_type: { type: ["string", "null"] },
            size:         { type: ["string", "null"] },
          },
          required: ["item_code"],
        },
      },
      fabric_consumption: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item_code:            { type: "string" },
            component_type:       { type: "string" },
            color:                { type: ["string", "null"] },
            fabric_type:          { type: ["string", "null"] },
            gsm:                  { type: ["number", "null"] },
            width_cm:             { type: ["number", "null"] },
            consumption_per_unit: { type: ["number", "null"] },
            wastage_percent:      { type: ["number", "null"] },
          },
          required: ["item_code", "component_type"],
        },
      },
      accessory_consumption: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item_code:            { type: "string" },
            category:             { type: "string" },
            item_name:            { type: ["string", "null"] },
            material:             { type: ["string", "null"] },
            size_spec:            { type: ["string", "null"] },
            placement:            { type: ["string", "null"] },
            consumption_per_unit: { type: ["number", "null"] },
          },
          required: ["item_code", "category"],
        },
      },
      carton_master: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item_code:        { type: "string" },
            units_per_carton: { type: ["number", "null"] },
            carton_length_cm: { type: ["number", "null"] },
            carton_width_cm:  { type: ["number", "null"] },
            carton_height_cm: { type: ["number", "null"] },
          },
          required: ["item_code"],
        },
      },
      price_list: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item_code:      { type: "string" },
            price_usd:      { type: ["number", "null"] },
            effective_from: { type: ["string", "null"] },
          },
          required: ["item_code"],
        },
      },
      suppliers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name:          { type: "string" },
            contact_email: { type: ["string", "null"] },
            contact_phone: { type: ["string", "null"] },
          },
          required: ["name"],
        },
      },
      seasons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name:       { type: "string" },
            start_date: { type: ["string", "null"] },
            end_date:   { type: ["string", "null"] },
          },
          required: ["name"],
        },
      },
      production_lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name:           { type: "string" },
            line_type:      { type: ["string", "null"] },
            daily_capacity: { type: ["number", "null"] },
          },
          required: ["name"],
        },
      },
      _confidence: {
        type: "object",
        properties: {
          overall:     { type: "number" },
          per_section: { type: "object" },
        },
        required: ["overall"],
      },
      _notes: { type: ["string", "null"] },
    },
    required: ["_confidence"],
  },
} as const;

export function getPromptForKind(kind: ExtractionKind) {
  if (kind === "tech_pack") {
    return {
      systemPrompt: TECH_PACK_SYSTEM_PROMPT,
      tool: TECH_PACK_TOOL,
      version: PROMPT_VERSION_BY_KIND.tech_pack,
      models: MODEL_CHAIN_BY_KIND.tech_pack,
    };
  }
  return {
    systemPrompt: MASTER_DATA_SYSTEM_PROMPT,
    tool: MASTER_DATA_TOOL,
    version: PROMPT_VERSION_BY_KIND.master_data,
    models: MODEL_CHAIN_BY_KIND.master_data,
  };
}
