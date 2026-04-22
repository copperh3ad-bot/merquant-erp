// src/api/priceService.js
// Thin service layer over supabase for price_list / master_articles lookups.
// Every function accepts codes in any case and normalizes them before querying,
// matching the DB trigger contract. Falls back gracefully when a SKU exists in
// price_list but not master_articles (common for newly added SKUs like the FRIO
// series, GPTE80, GPPPS, etc.).

import { supabase } from './supabaseClient.js';
import {
  normalizeItemCode,
  readPiecesPerCarton,
  toNumber,
  cartonProfileFromPriceList,
} from '@/lib/codes';

/**
 * Fetch a single price_list row by item_code (case-insensitive).
 * Returns null if not found or not active.
 */
export async function fetchPriceByCode(code) {
  const normalized = normalizeItemCode(code);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('price_list')
    .select(
      'item_code, description, price_usd, currency, qty_per_carton, cbm_per_carton, carton_length, carton_width, carton_height, is_active, effective_from, effective_to'
    )
    .eq('item_code', normalized)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.warn('[priceService] fetchPriceByCode error:', error.message);
    return null;
  }
  return data || null;
}

/**
 * Batch fetch price_list rows for a set of codes. Returns a Map keyed by
 * normalized item_code. Unknown codes are simply omitted from the map.
 */
export async function fetchPricesByCodes(codes) {
  const normalized = Array.from(
    new Set((codes || []).map(normalizeItemCode).filter(Boolean))
  );
  if (normalized.length === 0) return new Map();

  const { data, error } = await supabase
    .from('price_list')
    .select(
      'item_code, description, price_usd, currency, qty_per_carton, cbm_per_carton, carton_length, carton_width, carton_height, is_active'
    )
    .in('item_code', normalized)
    .eq('is_active', true);

  if (error) {
    console.warn('[priceService] fetchPricesByCodes error:', error.message);
    return new Map();
  }
  const map = new Map();
  (data || []).forEach((row) => {
    map.set(normalizeItemCode(row.item_code), row);
  });
  return map;
}

/**
 * Fetch the full active price list (used for dropdowns / pickers).
 */
export async function fetchActivePriceList() {
  const { data, error } = await supabase
    .from('price_list')
    .select('*')
    .eq('is_active', true)
    .order('item_code', { ascending: true });
  if (error) {
    console.warn('[priceService] fetchActivePriceList error:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Fetch a master_articles row by article_code (case-insensitive).
 * Returns null if not found. master_articles may lag behind price_list for
 * brand-new SKUs — callers should always fall back to price_list.
 */
export async function fetchMasterArticleByCode(code) {
  const normalized = normalizeItemCode(code);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('master_articles')
    .select('*')
    .eq('article_code', normalized)
    .maybeSingle();

  if (error) {
    console.warn('[priceService] fetchMasterArticleByCode error:', error.message);
    return null;
  }
  return data || null;
}

/**
 * Batch fetch master_articles by code.
 */
export async function fetchMasterArticlesByCodes(codes) {
  const normalized = Array.from(
    new Set((codes || []).map(normalizeItemCode).filter(Boolean))
  );
  if (normalized.length === 0) return new Map();

  const { data, error } = await supabase
    .from('master_articles')
    .select('*')
    .in('article_code', normalized);

  if (error) {
    console.warn('[priceService] fetchMasterArticlesByCodes error:', error.message);
    return new Map();
  }
  const map = new Map();
  (data || []).forEach((row) => {
    map.set(normalizeItemCode(row.article_code), row);
  });
  return map;
}

/**
 * Unified SKU lookup: returns a merged view of price_list (authoritative)
 * + master_articles (descriptive metadata like article_name, customer).
 * Price/CBM/carton dims always come from price_list when available.
 */
export async function fetchSkuProfile(code) {
  const normalized = normalizeItemCode(code);
  if (!normalized) return null;

  const [priceRow, masterRow] = await Promise.all([
    fetchPriceByCode(normalized),
    fetchMasterArticleByCode(normalized),
  ]);

  if (!priceRow && !masterRow) return null;

  const profile = {
    item_code: normalized,
    // Descriptive info (prefer master_articles for names; fall back to price_list.description)
    article_name: masterRow?.article_name || priceRow?.description || null,
    description: priceRow?.description || null,
    customer_name: masterRow?.customer_name || null,
    program_code: masterRow?.program_code || null,
    article_type: masterRow?.article_type || null,
    // Commercial — always from price_list
    price_usd: toNumber(priceRow?.price_usd ?? masterRow?.price_usd),
    currency: priceRow?.currency || masterRow?.currency || 'USD',
    // Physical — always from price_list when present
    ...cartonProfileFromPriceList(priceRow),
    // master_articles back-fill if price_list carton data is incomplete
    _fallback_used: !priceRow && !!masterRow,
    master_article_id: masterRow?.id || null,
    net_weight_per_pc: toNumber(masterRow?.net_weight_per_pc),
    gross_weight_per_pc: toNumber(masterRow?.gross_weight_per_pc),
  };

  // If price_list had no dims (rare) but master_articles does, back-fill
  if (profile.pieces_per_carton === null && masterRow) {
    profile.pieces_per_carton = readPiecesPerCarton(masterRow);
    profile.carton_length = toNumber(masterRow.carton_length);
    profile.carton_width = toNumber(masterRow.carton_width);
    profile.carton_height = toNumber(masterRow.carton_height);
    profile.cbm_per_carton = toNumber(masterRow.cbm_per_carton);
    profile._fallback_used = true;
  }

  return profile;
}

/**
 * Enrich a PO item shape with authoritative master data. Returns a new
 * object — does NOT mutate the input. The returned object includes an
 * `_enrichment` block showing which fields were pulled from which source.
 */
export async function enrichPoItem(poItem) {
  if (!poItem) return poItem;
  const profile = await fetchSkuProfile(poItem.item_code);
  if (!profile) {
    return {
      ...poItem,
      _enrichment: { found: false, source: null },
    };
  }

  // Only overwrite fields when the PO item has no value (null/undefined/0 for dims);
  // never clobber user-entered overrides on the PO item itself.
  const pick = (current, master) => (current === null || current === undefined ? master : current);

  return {
    ...poItem,
    item_code: profile.item_code, // canonicalized
    item_description: pick(poItem.item_description, profile.description || profile.article_name),
    expected_price: pick(poItem.expected_price, profile.price_usd),
    pieces_per_carton: pick(poItem.pieces_per_carton, profile.pieces_per_carton),
    carton_length: pick(poItem.carton_length, profile.carton_length),
    carton_width: pick(poItem.carton_width, profile.carton_width),
    carton_height: pick(poItem.carton_height, profile.carton_height),
    // Use the price_list CBM when we can; otherwise recompute from dims
    cbm: poItem.cbm ?? profile.cbm_per_carton,
    master_article_id: poItem.master_article_id ?? profile.master_article_id,
    _enrichment: {
      found: true,
      source: profile._fallback_used ? 'master_articles' : 'price_list',
      expected_price: profile.price_usd,
      expected_pieces_per_carton: profile.pieces_per_carton,
      expected_cbm: profile.cbm_per_carton,
    },
  };
}

/**
 * Classify price match status for a PO item against the authoritative price.
 * Returns one of 'match' | 'mismatch' | 'missing' | 'no-ref'.
 */
export function classifyPriceStatus(poItem, expectedPrice, { tolerance = 0.01 } = {}) {
  const actual = toNumber(poItem?.unit_price);
  const expected = toNumber(expectedPrice);
  if (expected === null) return 'no-ref';
  if (actual === null) return 'missing';
  return Math.abs(actual - expected) <= tolerance ? 'match' : 'mismatch';
}

/**
 * Classify CBM match status. Compares PO item's stored cbm (per carton)
 * against price_list.cbm_per_carton. Tolerance is ±0.0005 m³.
 */
export function classifyCbmStatus(poItem, expectedCbm, { tolerance = 0.0005 } = {}) {
  const actual = toNumber(poItem?.cbm);
  const expected = toNumber(expectedCbm);
  if (expected === null) return 'no-ref';
  if (actual === null) return 'missing';
  return Math.abs(actual - expected) <= tolerance ? 'match' : 'mismatch';
}
