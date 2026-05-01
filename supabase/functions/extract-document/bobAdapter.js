// supabase/functions/extract-document/bobAdapter.js
//
// Maps the output of bobTechPackParser (BOB-specific shape) to the AI
// tech_pack tool schema (see prompts.ts). Only used by the BOB fast path
// when extract-document detects a BOB-format XLSX upload — the result is
// stored in ai_extractions.extracted_data exactly as if the LLM had
// produced it, so downstream code (validator, apply RPC, review UI) does
// not need to know whether the source was BOB-deterministic or LLM.

export function bobToTechPackShape(bob) {
  if (!bob || typeof bob !== "object") {
    return { skus: [], _confidence: { overall: 0 }, _notes: "BOB parser returned no data." };
  }

  const header = {
    brand:        bob.header?.brand        ?? null,
    product_type: bob.header?.product_type ?? null,
    product_no:   bob.header?.product_no   ?? bob.header?.product_sku ?? null,
    product_name: bob.header?.product_name ?? null,
  };

  const fabric_specs = (bob.fabric_specs ?? []).map((fs) => ({
    component_type: fs.component_type ?? null,
    fabric_type:    fs.fabric_type    ?? null,
    gsm:            asNumber(fs.gsm),
    color:          fs.color          ?? null,
    construction:   fs.construction   ?? null,
    finish:         fs.finish         ?? fs.treatment ?? null,
  }));

  const skus = (bob.skus ?? []).map((s) => ({
    item_code:          s.item_code ?? null,
    size:               s.size      ?? null,
    color:              s.color     ?? null,
    product_dimensions: s.product_dimensions ?? null,
    insert_dimensions:  s.insert_dimensions  ?? null,
    pvc_bag_dimensions: s.pvc_bag_dimensions ?? null,
    stiffener_size:     s.stiffener_size     ?? null,
    zipper_length:      s.zipper_length      ?? null,
    units_per_carton:   asNumber(s.units_per_carton),
    carton_size_cm:     s.carton_size_cm     ?? null,
    is_set:             typeof s.is_set === "boolean" ? s.is_set : null,
  }));

  const labels = (bob.labels ?? []).map((l) => ({
    section:   l.section   ?? null,
    type:      l.type      ?? null,
    material:  l.material  ?? null,
    size:      l.size      ?? null,
    color:     l.color     ?? null,
    placement: l.placement ?? null,
  }));

  const accessories = (bob.accessories ?? []).map((a) => ({
    accessory_type: a.accessory_type ?? null,
    description:    a.description    ?? null,
    material:       a.material       ?? null,
    placement:      a.placement      ?? null,
    source_label:   a.source_label   ?? null,
  }));

  const packaging = (bob.packaging ?? []).map((p) => ({
    variant:  p.variant  ?? null,
    category: p.category ?? null,
    label:    p.label    ?? null,
    value:    p.value    ?? null,
  }));

  const zipper = bob.zipper ? {
    length: bob.zipper.length ?? null,
    type:   bob.zipper.type   ?? null,
    color:  bob.zipper.color  ?? null,
  } : { length: null, type: null, color: null };

  // Deterministic parser → highest confidence. Per-section overrides only
  // when sections are visibly empty.
  const _confidence = {
    overall: skus.length > 0 ? 0.99 : 0.2,
    per_section: {
      header:       header.product_no ? 1.0 : 0.7,
      fabric_specs: fabric_specs.length > 0 ? 1.0 : 0.5,
      skus:         skus.length > 0 ? 1.0 : 0.0,
      labels:       labels.length > 0 ? 1.0 : 0.5,
      accessories:  accessories.length > 0 ? 1.0 : 0.5,
      packaging:    packaging.length > 0 ? 1.0 : 0.5,
    },
  };

  return {
    header, fabric_specs, skus, labels, accessories, packaging, zipper,
    _confidence,
    _notes: "Parsed deterministically from BOB-format XLSX (no LLM call).",
  };
}

function asNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
