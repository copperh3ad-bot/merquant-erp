import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file (see .env.example).'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Payload sanitizers ───────────────────────────────────────────────────
// Postgres `date` columns reject empty strings — they want a valid ISO date
// (YYYY-MM-DD) or null. UI code often sends "" when a date input is blank,
// which blows up the insert with:
//    "invalid input syntax for type date: ..."
// This helper converts "", undefined, and unrecognized values to null so the
// write always succeeds, without silently corrupting valid dates.
const PO_DATE_FIELDS = [
  'pi_date', 'order_date', 'delivery_date', 'ex_factory_date',
  'etd', 'eta', 'lc_expiry',
  'approval_requested_at', 'approved_at',
  'original_ex_factory_date', 'revised_ex_factory_date',
];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;
function sanitizeDates(payload, fields = PO_DATE_FIELDS) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  for (const f of fields) {
    if (!(f in out)) continue;
    const v = out[f];
    // Null/undefined passes through as-is (caller intent)
    if (v == null) continue;
    // Empty string → null (most common bug trigger)
    if (typeof v === 'string' && v.trim() === '') { out[f] = null; continue; }
    // Valid ISO date string → keep
    if (typeof v === 'string' && ISO_DATE_RE.test(v)) continue;
    // Date object → serialize
    if (v instanceof Date && !isNaN(v.getTime())) { out[f] = v.toISOString().slice(0, 10); continue; }
    // Anything else (like "n/a", "TBD", a random string) → null
    out[f] = null;
  }
  return out;
}

// Helper wrappers mirroring the base44 SDK pattern used in the example
export const db = {
  purchaseOrders: {
    list: async (order = '-created_at') => {
      const col = order.startsWith('-') ? order.slice(1) : order;
      const asc = !order.startsWith('-');
      const { data, error } = await supabase.from('purchase_orders').select('*').order(col, { ascending: asc }).limit(500);
      if (error) throw error;
      return data;
    },
    get: async (id) => {
      const { data, error } = await supabase.from('purchase_orders').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
    create: async (payload) => {
      const { data, error } = await supabase.from('purchase_orders').insert(sanitizeDates(payload)).select().single();
      if (error) throw error;
      return data;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase.from('purchase_orders').update(sanitizeDates(payload)).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    delete: async (id) => {
      const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
      if (error) throw error;
    },
    // Approval workflow
    submitForApproval: async (id, requestedBy) => {
      const { data, error } = await supabase.from('purchase_orders')
        .update({ approval_status: 'pending', approval_requested_by: requestedBy, approval_requested_at: new Date().toISOString(), approval_notes: null })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    approve: async (id, approvedBy, notes) => {
      const { data, error } = await supabase.from('purchase_orders')
        .update({ approval_status: 'approved', approved_by: approvedBy, approved_at: new Date().toISOString(), approval_notes: notes || null })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    reject: async (id, approvedBy, notes) => {
      const { data, error } = await supabase.from('purchase_orders')
        .update({ approval_status: 'rejected', approved_by: approvedBy, approved_at: new Date().toISOString(), approval_notes: notes || null })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    requestChanges: async (id, approvedBy, notes) => {
      const { data, error } = await supabase.from('purchase_orders')
        .update({ approval_status: 'changes_requested', approved_by: approvedBy, approved_at: new Date().toISOString(), approval_notes: notes })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    listPendingApproval: async () => {
      const { data, error } = await supabase.from('purchase_orders')
        .select('*').eq('approval_status', 'pending').order('approval_requested_at', { ascending: true }).limit(100);
      if (error) throw error;
      return data;
    },
  },
  poItems: {
    listByPO: async (poId) => {
      const { data, error } = await supabase.from('po_items').select('*').eq('po_id', poId).order('created_at');
      if (error) throw error;
      return data;
    },
    create: async (payload) => {
      const { data, error } = await supabase.from('po_items').insert(sanitizeDates(payload, ['delivery_date'])).select().single();
      if (error) throw error;
      return data;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase.from('po_items').update(sanitizeDates(payload, ['delivery_date'])).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    delete: async (id) => {
      const { error } = await supabase.from('po_items').delete().eq('id', id);
      if (error) throw error;
    },
    bulkCreate: async (rows) => {
      const cleaned = Array.isArray(rows) ? rows.map(r => sanitizeDates(r, ['delivery_date'])) : rows;
      const { data, error } = await supabase.from('po_items').insert(cleaned).select();
      if (error) throw error; return data;
    },
    /** @returns {Promise<Array>} Up to 2000 items (hard cap). For truncation-aware reads use listWithMeta(). */
    list: async () => {
      const { data, error } = await supabase.from('po_items').select('*').order('created_at', { ascending: false }).limit(2000);
      if (error) throw error; return data || [];
    },
    /** @returns {Promise<{data: Array, truncated: boolean}>} Same data plus a truncated flag. */
    listWithMeta: async () => {
      const limit = 2000;
      const { data, error } = await supabase.from('po_items').select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) throw error;
      const rows = data || [];
      return { data: rows, truncated: rows.length === limit };
    },
  },
  suppliers: {
    list: async () => {
      const { data, error } = await supabase.from('suppliers').select('*').order('name');
      if (error) throw error;
      return data;
    },
    create: async (payload) => {
      const { data, error } = await supabase.from('suppliers').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase.from('suppliers').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    delete: async (id) => {
      const { error } = await supabase.from('suppliers').delete().eq('id', id);
      if (error) throw error;
    },
  },
  shipments: {
    list: async () => {
      const { data, error } = await supabase.from('shipments').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    create: async (payload) => {
      const { data, error } = await supabase.from('shipments').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase.from('shipments').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    delete: async (id) => {
      const { error } = await supabase.from('shipments').delete().eq('id', id);
      if (error) throw error;
    },
  },
  statusLogs: {
    log: async (entityType, entityId, oldStatus, newStatus, changedBy = 'system') => {
      await supabase.from('status_logs').insert({ entity_type: entityType, entity_id: entityId, old_status: oldStatus, new_status: newStatus, changed_by: changedBy });
    },
  },
};

// ── Manufacturing module helpers ───────────────────────────────────────────
export const mfg = {
  articles: {
    listByPO: async (poId) => {
      const { data, error } = await supabase.from('articles').select('*').eq('po_id', poId).order('article_name');
      if (error) throw error; return data;
    },
    // Search all articles by item code (used by CSV upload)
    getByCode: async (code) => {
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .or(`article_code.eq.${code},article_code.ilike.${code}`)
        .order('created_at', { ascending: false });
      if (error) throw error; return data || [];
    },
    // Search all articles by partial code match
    searchByCode: async (code) => {
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .ilike('article_code', `%${code}%`)
        .order('created_at', { ascending: false });
      if (error) throw error; return data || [];
    },
    create: async (payload) => {
      const { data, error } = await supabase.from('articles').insert(payload).select().single();
      if (error) throw error; return data;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase.from('articles').update(payload).eq('id', id).select().single();
      if (error) throw error; return data;
    },
    delete: async (id) => { const { error } = await supabase.from('articles').delete().eq('id', id); if (error) throw error; },
    bulkCreate: async (rows) => {
      const { data, error } = await supabase.from('articles').insert(rows).select();
      if (error) throw error; return data;
    },
    /** @returns {Promise<Array>} Up to 2000 items (hard cap). For truncation-aware reads use listWithMeta(). */
    list: async () => {
      const { data, error } = await supabase.from('articles').select('*').order('article_name').limit(2000);
      if (error) throw error; return data || [];
    },
    /** @returns {Promise<{data: Array, truncated: boolean}>} Same data plus a truncated flag. */
    listWithMeta: async () => {
      const limit = 2000;
      const { data, error } = await supabase.from('articles').select('*').order('article_name').limit(limit);
      if (error) throw error;
      const rows = data || [];
      return { data: rows, truncated: rows.length === limit };
    },
  },
  fabricTemplates: {
    getByCode: async (code) => {
      const { data } = await supabase.from('fabric_templates').select('*').eq('article_code', code).single();
      return data;
    },
    upsert: async (payload) => {
      const { data, error } = await supabase.from('fabric_templates').upsert(payload, { onConflict: 'article_code' }).select().single();
      if (error) throw error; return data;
    },
    list: async () => {
      const { data, error } = await supabase.from('fabric_templates').select('*').order('article_code');
      if (error) throw error; return data;
    },
  },
  yarn: {
    listByPO: async (poId) => {
      const { data, error } = await supabase.from('yarn_requirements').select('*').eq('po_id', poId).order('created_at');
      if (error) throw error; return data;
    },
    list: async () => {
      const { data, error } = await supabase.from('yarn_requirements').select('*').order('created_at', { ascending: false }).limit(2000);
      if (error) throw error; return data;
    },
    create: async (payload) => {
      const { data, error } = await supabase.from('yarn_requirements').insert(payload).select().single();
      if (error) throw error; return data;
    },
    bulkCreate: async (rows) => {
      const { data, error } = await supabase.from('yarn_requirements').insert(rows).select();
      if (error) throw error; return data;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase.from('yarn_requirements').update(payload).eq('id', id).select().single();
      if (error) throw error; return data;
    },
    delete: async (id) => { const { error } = await supabase.from('yarn_requirements').delete().eq('id', id); if (error) throw error; },
  },
  trims: {
    listByPO: async (poId) => {
      const { data, error } = await supabase.from('trim_items').select('*').eq('po_id', poId).order('created_at');
      if (error) throw error; return data;
    },
    create: async (payload) => {
      const { data, error } = await supabase.from('trim_items').insert(payload).select().single();
      if (error) throw error; return data;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase.from('trim_items').update(payload).eq('id', id).select().single();
      if (error) throw error; return data;
    },
    delete: async (id) => { const { error } = await supabase.from('trim_items').delete().eq('id', id); if (error) throw error; },
  },
  accessories: {
    /** @returns {Promise<Array>} Up to 5000 items (hard cap). For truncation-aware reads use listWithMeta(). */
    list: async () => {
      const { data, error } = await supabase.from('accessory_items').select('*').order('category').limit(5000);
      if (error) throw error; return data;
    },
    /** @returns {Promise<{data: Array, truncated: boolean}>} Same data plus a truncated flag. */
    listWithMeta: async () => {
      const limit = 5000;
      const { data, error } = await supabase.from('accessory_items').select('*').order('category').limit(limit);
      if (error) throw error;
      const rows = data || [];
      return { data: rows, truncated: rows.length === limit };
    },
    listByPO: async (poId) => {
      const { data, error } = await supabase.from('accessory_items').select('*').eq('po_id', poId).order('category');
      if (error) throw error; return data;
    },
    create: async (payload) => {
      const { data, error } = await supabase.from('accessory_items').insert(payload).select().single();
      if (error) throw error; return data;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase.from('accessory_items').update(payload).eq('id', id).select().single();
      if (error) throw error; return data;
    },
    delete: async (id) => { const { error } = await supabase.from('accessory_items').delete().eq('id', id); if (error) throw error; },
    bulkCreate: async (rows) => {
      const { data, error } = await supabase.from('accessory_items').insert(rows).select();
      if (error) throw error; return data;
    },
    // Flip multiple items to the same status in a single round-trip. Used by APO generator
    // and APO status changes so that source items stay in sync with their purchase order.
    bulkUpdateStatus: async (ids, status) => {
      if (!ids || ids.length === 0) return [];
      const { data, error } = await supabase
        .from('accessory_items')
        .update({ status })
        .in('id', ids)
        .select();
      if (error) throw error; return data;
    },
    listAll: async () => {
      const { data, error } = await supabase.from('accessory_items').select('*').order('created_at', { ascending: false }).limit(5000);
      if (error) throw error; return data || [];
    },
  },
  jobCards: {
    list: async () => {
      const { data, error } = await supabase.from('job_cards').select('*').order('created_at', { ascending: false });
      if (error) throw error; return data;
    },
    listByPO: async (poId) => {
      const { data, error } = await supabase.from('job_cards').select('*').eq('po_id', poId).order('due_date');
      if (error) throw error; return data;
    },
    create: async (payload) => {
      const { data, error } = await supabase.from('job_cards').insert(payload).select().single();
      if (error) throw error; return data;
    },
    update: async (id, payload) => {
      const { data, error } = await supabase.from('job_cards').update(payload).eq('id', id).select().single();
      if (error) throw error; return data;
    },
    delete: async (id) => { const { error } = await supabase.from('job_cards').delete().eq('id', id); if (error) throw error; },
  },
};

// ── Email crawl log ────────────────────────────────────────────────────────
export const emailCrawl = {
  list: async ({ limit = 100, classification } = {}) => {
    let q = supabase.from('email_crawl_log').select('*').order('received_at', { ascending: false }).limit(limit);
    if (classification) q = q.eq('classification', classification);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('email_crawl_log').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return data;
  },
  upsert: async (rows) => {
    const { data, error } = await supabase.from('email_crawl_log').upsert(rows, { onConflict: 'gmail_message_id', ignoreDuplicates: false }).select();
    if (error) throw error;
    return data;
  },
  markPoCreated: async (id, poId) => {
    const { error } = await supabase.from('email_crawl_log').update({ po_created: true, po_id: poId }).eq('id', id);
    if (error) throw error;
  },
  delete: async (id) => {
    const { error } = await supabase.from('email_crawl_log').delete().eq('id', id);
    if (error) throw error;
  },
  stats: async () => {
    const { data, error } = await supabase.from('email_crawl_log')
      .select('classification, po_created')
      .order('received_at', { ascending: false });
    if (error) throw error;
    return data;
  },
};

// ── Article Packaging ──────────────────────────────────────────────────────
export const articlePackaging = {
  list: async () => {
    const { data, error } = await supabase.from('article_packaging').select('*').order('article_code');
    if (error) throw error; return data || [];
  },
  listByPO: async (poNumber) => {
    const { data, error } = await supabase.from('article_packaging').select('*').eq('ref_po_number', poNumber).order('article_code');
    if (error) throw error; return data || [];
  },
  getByCode: async (articleCode) => {
    const { data } = await supabase.from('article_packaging').select('*').eq('article_code', articleCode).single();
    return data;
  },
  upsert: async (payload) => {
    const { data, error } = await supabase.from('article_packaging')
      .upsert(payload, { onConflict: 'article_code' }).select().single();
    if (error) throw error; return data;
  },
  create: async (payload) => {
    const { data, error } = await supabase.from('article_packaging').insert(payload).select().single();
    if (error) throw error; return data;
  },
  update: async (id, payload) => {
    const { data, error } = await supabase.from('article_packaging').update(payload).eq('id', id).select().single();
    if (error) throw error; return data;
  },
  delete: async (id) => {
    const { error } = await supabase.from('article_packaging').delete().eq('id', id);
    if (error) throw error;
  },
};

// ── SKU Review Queue ──────────────────────────────────────────────────────
export const skuQueue = {
  list: async ({ status, poId } = {}) => {
    let q = supabase.from('sku_review_queue').select('*, po_items(fabric_type, gsm, color, unit_price)').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    if (poId) q = q.eq('po_id', poId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },
  listPending: async () => {
    const { data, error } = await supabase.from('sku_review_queue').select('*').eq('status', 'pending').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },
  create: async (rows) => {
    const { data, error } = await supabase.from('sku_review_queue').insert(rows).select();
    if (error) throw error;
    return data;
  },
  update: async (id, payload) => {
    const { data, error } = await supabase.from('sku_review_queue').update(payload).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  count: async () => {
    const { count, error } = await supabase.from('sku_review_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending');
    if (error) return 0;
    return count || 0;
  },
};

// ── New manufacturing feature helpers ─────────────────────────────────────
export const tna = {
  templates: {
    list: async () => { const { data, error } = await supabase.from('tna_templates').select('*').order('name'); if (error) throw error; return data; },
    create: async (p) => { const { data, error } = await supabase.from('tna_templates').insert(p).select().single(); if (error) throw error; return data; },
    update: async (id, p) => { const { data, error } = await supabase.from('tna_templates').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
    delete: async (id) => { const { error } = await supabase.from('tna_templates').delete().eq('id', id); if (error) throw error; },
  },
  calendars: {
    listByPO: async (poId) => { const { data, error } = await supabase.from('tna_calendars').select('*').eq('po_id', poId).order('created_at'); if (error) throw error; return data; },
    create: async (p) => { const { data, error } = await supabase.from('tna_calendars').insert(p).select().single(); if (error) throw error; return data; },
  },
  milestones: {
    listByPO: async (poId) => { const { data, error } = await supabase.from('tna_milestones').select('*').eq('po_id', poId).order('target_date'); if (error) throw error; return data; },
    /** @returns {Promise<Array>} Up to 2000 items (hard cap). For truncation-aware reads use listAllWithMeta(). */
    listAll: async () => { const { data, error } = await supabase.from('tna_milestones').select('*').order('target_date').limit(2000); if (error) throw error; return data; },
    /** @returns {Promise<{data: Array, truncated: boolean}>} Same data plus a truncated flag. */
    listAllWithMeta: async () => {
      const limit = 2000;
      const { data, error } = await supabase.from('tna_milestones').select('*').order('target_date').limit(limit);
      if (error) throw error;
      const rows = data || [];
      return { data: rows, truncated: rows.length === limit };
    },
    bulkCreate: async (rows) => { const { data, error } = await supabase.from('tna_milestones').insert(rows).select(); if (error) throw error; return data; },
    update: async (id, p) => { const { data, error } = await supabase.from('tna_milestones').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
    delete: async (id) => { const { error } = await supabase.from('tna_milestones').delete().eq('id', id); if (error) throw error; },
    overdueCount: async () => { const today = new Date().toISOString().split('T')[0]; const { count, error } = await supabase.from('tna_milestones').select('*', { count: 'exact', head: true }).lt('target_date', today).not('status', 'in', '("completed","skipped")'); if (error) return 0; return count || 0; },
  },
};

export const labDips = {
  list: async (poId) => { let q = supabase.from('lab_dips').select('*').order('created_at', { ascending: false }); if (poId) q = q.eq('po_id', poId); const { data, error } = await q; if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('lab_dips').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('lab_dips').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('lab_dips').delete().eq('id', id); if (error) throw error; },
  pendingCount: async () => { const { count } = await supabase.from('lab_dips').select('*', { count: 'exact', head: true }).in('status', ['Submitted', 'Resubmit']); return count || 0; },
};

export const samples = {
  list: async (poId) => { let q = supabase.from('samples').select('*').order('dispatch_date', { ascending: false }); if (poId) q = q.eq('po_id', poId); const { data, error } = await q; if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('samples').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('samples').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('samples').delete().eq('id', id); if (error) throw error; },
};

export const qcInspections = {
  list: async (poId) => { let q = supabase.from('qc_inspections').select('*').order('inspection_date', { ascending: false }); if (poId) q = q.eq('po_id', poId); const { data, error } = await q; if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('qc_inspections').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('qc_inspections').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('qc_inspections').delete().eq('id', id); if (error) throw error; },
};

export const costing = {
  listByPO: async (poId) => { const { data, error } = await supabase.from('costing_sheets').select('*').eq('po_id', poId).order('article_name'); if (error) throw error; return data; },
  upsert: async (p) => { const { data, error } = await supabase.from('costing_sheets').upsert(p, { onConflict: 'po_id,article_code' }).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('costing_sheets').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('costing_sheets').delete().eq('id', id); if (error) throw error; },
};

export const changeLog = {
  listByPO: async (poId) => { const { data, error } = await supabase.from('po_change_log').select('*').eq('po_id', poId).order('created_at', { ascending: false }); if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('po_change_log').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('po_change_log').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
};

export const payments = {
  listByPO: async (poId) => { const { data, error } = await supabase.from('payments').select('*').eq('po_id', poId).order('expected_date'); if (error) throw error; return data; },
  listAll: async () => { const { data, error } = await supabase.from('payments').select('*').order('expected_date'); if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('payments').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('payments').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('payments').delete().eq('id', id); if (error) throw error; },
};

export const packingLists = {
  listByPO: async (poId) => { const { data, error } = await supabase.from('packing_lists').select('*').eq('po_id', poId); if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('packing_lists').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('packing_lists').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
};

export const compliance = {
  list: async (poId) => { let q = supabase.from('compliance_docs').select('*').order('created_at', { ascending: false }); if (poId) q = q.eq('po_id', poId); const { data, error } = await q; if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('compliance_docs').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('compliance_docs').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('compliance_docs').delete().eq('id', id); if (error) throw error; },
};

// ── Fabric Orders (mill procurement) ─────────────────────────────────────
export const fabricOrders = {
  list: async (poId) => {
    let q = supabase.from('fabric_orders').select('*').order('order_date', { ascending: false });
    if (poId) q = q.eq('po_id', poId);
    const { data, error } = await q; if (error) throw error; return data;
  },
  create: async (p) => { const { data, error } = await supabase.from('fabric_orders').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('fabric_orders').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('fabric_orders').delete().eq('id', id); if (error) throw error; },
  pendingCount: async () => { const { count } = await supabase.from('fabric_orders').select('*', { count: 'exact', head: true }).in('status', ['Pending','Confirmed','Weaving','Dyeing/Processing']); return count || 0; },
};

// ── Seasons ───────────────────────────────────────────────────────────────
export const seasons = {
  list: async () => { const { data, error } = await supabase.from('seasons').select('*').order('start_date', { ascending: false }); if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('seasons').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('seasons').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('seasons').delete().eq('id', id); if (error) throw error; },
};

// ── RBAC & Teams ──────────────────────────────────────────────────────────
export const rbac = {
  teams: {
    list: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('*, manager:manager_id(id, full_name, role), line_manager:line_manager_id(id, full_name, role)')
        .order('name');
      if (error) throw error; return data;
    },
    create: async (p) => { const { data, error } = await supabase.from('teams').insert(p).select().single(); if (error) throw error; return data; },
    update: async (id, p) => { const { data, error } = await supabase.from('teams').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
    delete: async (id) => { const { error } = await supabase.from('teams').delete().eq('id', id); if (error) throw error; },
  },
  users: {
    list: async () => {
      const { data, error } = await supabase.from('user_profiles').select('*, team:team_id(id, name, department)').order('full_name');
      if (error) throw error; return data;
    },
    update: async (id, p) => {
      const { data, error } = await supabase.from('user_profiles').update(p).eq('id', id).select().single();
      if (error) throw error; return data;
    },
    // List users awaiting owner approval (uses user-approval edge function for auth-checked read)
    listPending: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*, team:team_id(id, name, department)')
        .eq('approval_status', 'pending')
        .order('requested_at', { ascending: true });
      if (error) throw error; return data || [];
    },
    approve: async (userId) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ action: 'approve', user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Approval failed');
      return json;
    },
    reject: async (userId, reason) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ action: 'reject', user_id: userId, reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Rejection failed');
      return json;
    },
  },
  logDenial: async (userId, email, role, action, resource) => {
    await supabase.from('permission_denials').insert({ user_id: userId, user_email: email, user_role: role, action, resource });
  },
  gcalSync: {
    list: async (userId) => {
      const { data } = await supabase.from('gcal_sync_log').select('*').eq('user_id', userId);
      return data || [];
    },
    upsert: async (p) => {
      const { data, error } = await supabase.from('gcal_sync_log').upsert(p, { onConflict: 'tna_milestone_id,user_id' }).select().single();
      if (error) throw error; return data;
    },
  },
};

// ── Customer-Team Assignments ──────────────────────────────────────────────
export const customerTeams = {
  // All assignments with team info
  list: async () => {
    const { data, error } = await supabase
      .from('customer_team_assignments')
      .select('*, team:team_id(id, name, department, color, line_manager_id, manager_id, line_manager:line_manager_id(id, full_name, role), manager:manager_id(id, full_name, role))')
      .order('customer_name');
    if (error) throw error;
    return data;
  },
  // Assignments for a specific customer
  byCustomer: async (customerName) => {
    const { data, error } = await supabase
      .from('customer_team_assignments')
      .select('*, team:team_id(*, line_manager:line_manager_id(id, full_name, role), manager:manager_id(id, full_name, role))')
      .eq('customer_name', customerName)
      .order('is_primary', { ascending: false });
    if (error) throw error;
    return data;
  },
  // Teams for a specific team
  byTeam: async (teamId) => {
    const { data, error } = await supabase
      .from('customer_team_assignments')
      .select('*')
      .eq('team_id', teamId)
      .order('customer_name');
    if (error) throw error;
    return data;
  },
  assign: async (teamId, customerName, isPrimary = false, season = null, notes = null) => {
    const { data, error } = await supabase
      .from('customer_team_assignments')
      .upsert({ team_id: teamId, customer_name: customerName, is_primary: isPrimary, season, notes }, { onConflict: 'team_id,customer_name' })
      .select().single();
    if (error) throw error;
    return data;
  },
  remove: async (id) => {
    const { error } = await supabase.from('customer_team_assignments').delete().eq('id', id);
    if (error) throw error;
  },
  // Get unique customer names from purchase_orders
  getCustomers: async () => {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('customer_name')
      .order('customer_name');
    if (error) throw error;
    return [...new Set(data.map(p => p.customer_name))].filter(Boolean);
  },
};

// Update rbac.teams to include line_manager
const _origTeamsList = rbac?.teams?.list;
if (rbac?.teams) {
  rbac.teams.list = async () => {
    const { data, error } = await supabase
      .from('teams')
      .select('*, manager:manager_id(id, full_name, role, email), line_manager:line_manager_id(id, full_name, role, email)')
      .order('name');
    if (error) throw error;
    return data;
  };
  rbac.teams.update = async (id, p) => {
    const { data, error } = await supabase.from('teams').update(p).eq('id', id).select().single();
    if (error) throw error;
    return data;
  };
}

// ── Price List ────────────────────────────────────────────────────────────
export const priceList = {
  list: async () => { const { data, error } = await supabase.from('price_list').select('*').order('item_code'); if (error) throw error; return data; },
  upsert: async (payload) => { const { data, error } = await supabase.from('price_list').upsert(payload, { onConflict: 'item_code' }).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('price_list').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('price_list').delete().eq('id', id); if (error) throw error; },
  byCode: async (code) => { const { data } = await supabase.from('price_list').select('*').eq('item_code', code.trim().toUpperCase()).single(); return data; },
};

// ── Shipping Doc Register ─────────────────────────────────────────────────
export const shippingDocs = {
  list: async (poId) => { let q = supabase.from('shipping_doc_register').select('*').order('created_at', { ascending: false }); if (poId) q = q.eq('po_id', poId); const { data, error } = await q; if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('shipping_doc_register').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('shipping_doc_register').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('shipping_doc_register').delete().eq('id', id); if (error) throw error; },
};

// ── Job Cards (enhanced) ──────────────────────────────────────────────────
export const jobCards = {
  list: async () => { const { data, error } = await supabase.from('job_cards').select('*').order('created_at', { ascending: false }); if (error) throw error; return data; },
  listByPO: async (poId) => { const { data, error } = await supabase.from('job_cards').select('*').eq('po_id', poId).order('due_date'); if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('job_cards').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('job_cards').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('job_cards').delete().eq('id', id); if (error) throw error; },
  activeCount: async () => { const { count } = await supabase.from('job_cards').select('*', { count: 'exact', head: true }).not('status', 'in', '("Completed","Cancelled")'); return count || 0; },
};

// ── Accessory Purchase Orders ─────────────────────────────────────────────
export const accessoryPOs = {
  list: async () => { const { data, error } = await supabase.from('accessory_purchase_orders').select('*').order('created_at', { ascending: false }); if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('accessory_purchase_orders').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('accessory_purchase_orders').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('accessory_purchase_orders').delete().eq('id', id); if (error) throw error; },
};

// ── PO Batches ────────────────────────────────────────────────────────────
export const poBatches = {
  listByPO: async (poId) => {
    const { data, error } = await supabase.from('po_batches').select('*').eq('po_id', poId).order('batch_sequence');
    if (error) throw error; return data;
  },
  list: async () => {
    const { data, error } = await supabase.from('po_batches').select('*').order('created_at', { ascending: false });
    if (error) throw error; return data;
  },
  create: async (p) => { const { data, error } = await supabase.from('po_batches').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('po_batches').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('po_batches').delete().eq('id', id); if (error) throw error; },
};

// ── Batch Items ───────────────────────────────────────────────────────────
export const batchItems = {
  listByBatch: async (batchId) => {
    const { data, error } = await supabase.from('batch_items').select('*, po_item:po_item_id(*)').eq('batch_id', batchId);
    if (error) throw error; return data;
  },
  update: async (id, patch) => {
    const { data, error } = await supabase.from('batch_items').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return data;
  },
  upsert: async (rows) => {
    const { data, error } = await supabase.from('batch_items').upsert(rows, { onConflict: 'batch_id,po_item_id' }).select();
    if (error) throw error; return data;
  },
  delete: async (id) => { const { error } = await supabase.from('batch_items').delete().eq('id', id); if (error) throw error; },
};

// ── Commercial Invoices ───────────────────────────────────────────────────
export const commercialInvoices = {
  listByPO: async (poId) => {
    const { data, error } = await supabase.from('commercial_invoices').select('*').eq('po_id', poId).order('ci_date');
    if (error) throw error; return data;
  },
  list: async () => {
    const { data, error } = await supabase.from('commercial_invoices').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error; return data;
  },
  create: async (p) => { const { data, error } = await supabase.from('commercial_invoices').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('commercial_invoices').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('commercial_invoices').delete().eq('id', id); if (error) throw error; },
};

// ── Batch split snapshots ──────────────────────────────────────────────────
export const splitSnapshots = {
  listByPO: async (poId) => {
    const { data, error } = await supabase.from('batch_split_snapshots').select('*').eq('po_id', poId).order('snapshot_date', { ascending: false });
    if (error) throw error; return data;
  },
  create: async (p) => { const { data, error } = await supabase.from('batch_split_snapshots').insert(p).select().single(); if (error) throw error; return data; },
};

// ── Tech Packs ────────────────────────────────────────────────────────────
export const techPacks = {
  list: async (poId) => {
    let q = supabase.from('tech_packs').select('*').order('created_at', { ascending: false }).limit(500);
    if (poId) q = q.eq('po_id', poId);
    const { data, error } = await q;
    if (error) throw error; return data;
  },
  get: async (id) => { const { data, error } = await supabase.from('tech_packs').select('*').eq('id', id).single(); if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('tech_packs').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('tech_packs').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('tech_packs').delete().eq('id', id); if (error) throw error; },
  search: async (query) => {
    const { data, error } = await supabase.from('tech_packs').select('*')
      .or(`article_code.ilike.%${query}%,article_name.ilike.%${query}%,po_number.ilike.%${query}%,customer_name.ilike.%${query}%`)
      .order('created_at', { ascending: false });
    if (error) throw error; return data;
  },
};

// ── Print Layouts ─────────────────────────────────────────────────────────
export const printLayouts = {
  list: async (poId) => {
    let q = supabase.from('print_layouts').select('*').order('created_at', { ascending: false }).limit(500);
    if (poId) q = q.eq('po_id', poId);
    const { data, error } = await q;
    if (error) throw error; return data;
  },
  byArticle: async (articleCode) => {
    const { data, error } = await supabase.from('print_layouts').select('*').eq('article_code', articleCode).order('created_at', { ascending: false });
    if (error) throw error; return data;
  },
  create: async (p) => { const { data, error } = await supabase.from('print_layouts').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('print_layouts').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('print_layouts').delete().eq('id', id); if (error) throw error; },
  pendingCount: async () => { const { count } = await supabase.from('print_layouts').select('*', { count: 'exact', head: true }).eq('approval_status', 'Sent for Approval'); return count || 0; },
};

// ── Cross-Check Discrepancies ─────────────────────────────────────────────
export const discrepancies = {
  listByTP: async (tpId) => {
    const { data, error } = await supabase.from('crosscheck_discrepancies').select('*').eq('tech_pack_id', tpId).order('severity');
    if (error) throw error; return data;
  },
  listByPO: async (poId) => {
    const { data, error } = await supabase.from('crosscheck_discrepancies').select('*').eq('po_id', poId).eq('status','open').order('severity');
    if (error) throw error; return data;
  },
  upsertBatch: async (rows) => {
    const { data, error } = await supabase.from('crosscheck_discrepancies').insert(rows).select();
    if (error) throw error; return data;
  },
  resolve: async (id, notes, by) => {
    const { data, error } = await supabase.from('crosscheck_discrepancies').update({ status:'resolved', resolution_notes:notes, resolved_by:by, resolved_at:new Date().toISOString() }).eq('id', id).select().single();
    if (error) throw error; return data;
  },
  openCount: async () => { const { count } = await supabase.from('crosscheck_discrepancies').select('*', { count:'exact', head:true }).eq('status','open'); return count || 0; },
};

// ── CRM APIs ──────────────────────────────────────────────────────────────
export const buyerContacts = {
  list: async (customerName) => {
    let q = supabase.from('buyer_contacts').select('*').order('is_primary', { ascending: false }).order('full_name');
    if (customerName) q = q.eq('customer_name', customerName);
    const { data, error } = await q; if (error) throw error; return data;
  },
  create: async (p) => { const { data, error } = await supabase.from('buyer_contacts').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('buyer_contacts').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('buyer_contacts').delete().eq('id', id); if (error) throw error; },
  customers: async () => { const { data, error } = await supabase.from('buyer_contacts').select('customer_name').order('customer_name'); if (error) throw error; return [...new Set(data.map(d=>d.customer_name))]; },
};

export const rfqs = {
  list: async () => { const { data, error } = await supabase.from('rfqs').select('*, contact:contact_id(full_name, email)').order('received_date', { ascending: false }); if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('rfqs').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('rfqs').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('rfqs').delete().eq('id', id); if (error) throw error; },
  pendingCount: async () => { const { count } = await supabase.from('rfqs').select('*', { count:'exact', head:true }).in('status', ['New','In Review','Costing']); return count || 0; },
};

export const quotations = {
  list: async (rfqId) => {
    let q = supabase.from('quotations').select('*, items:quotation_items(*)').order('created_at', { ascending: false });
    if (rfqId) q = q.eq('rfq_id', rfqId);
    const { data, error } = await q; if (error) throw error; return data;
  },
  create: async (p) => { const { data, error } = await supabase.from('quotations').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('quotations').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('quotations').delete().eq('id', id); if (error) throw error; },
  upsertItems: async (rows) => { const { data, error } = await supabase.from('quotation_items').upsert(rows).select(); if (error) throw error; return data; },
};

export const complaints = {
  list: async () => { const { data, error } = await supabase.from('complaints').select('*').order('created_at', { ascending: false }); if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('complaints').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('complaints').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('complaints').delete().eq('id', id); if (error) throw error; },
  openCount: async () => { const { count } = await supabase.from('complaints').select('*',{count:'exact',head:true}).not('status','in','("Resolved","Closed")'); return count||0; },
};

export const commsLog = {
  listByPO: async (poId) => { const { data, error } = await supabase.from('comms_log').select('*').eq('po_id', poId).order('comm_date', { ascending: false }); if (error) throw error; return data; },
  listByEntity: async (type, id) => { const { data, error } = await supabase.from('comms_log').select('*').eq('entity_type', type).eq('entity_id', id).order('comm_date', { ascending: false }); if (error) throw error; return data; },
  create: async (p) => { const { data, error } = await supabase.from('comms_log').insert(p).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('comms_log').delete().eq('id', id); if (error) throw error; },
};

export const notificationsAPI = {
  list: async (userId) => { const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50); if (error) throw error; return data; },
  unreadCount: async (userId) => { const { count } = await supabase.from('notifications').select('*',{count:'exact',head:true}).eq('user_id', userId).eq('is_read', false); return count||0; },
  markRead: async (id) => { const { error } = await supabase.from('notifications').update({ is_read:true, read_at:new Date().toISOString() }).eq('id', id); if (error) throw error; },
  markAllRead: async (userId) => { const { error } = await supabase.from('notifications').update({ is_read:true, read_at:new Date().toISOString() }).eq('user_id', userId).eq('is_read', false); if (error) throw error; },
  create: async (p) => { const { data, error } = await supabase.from('notifications').insert(p).select().single(); if (error) throw error; return data; },
};

// ── Accessory Templates ───────────────────────────────────────────────────
export const accessoryTemplates = {
  list: async (category) => {
    let q = supabase.from('accessory_templates').select('*').order('template_name');
    if (category) q = q.eq('category', category);
    const { data, error } = await q;
    if (error) throw error; return data;
  },
  create: async (p) => { const { data, error } = await supabase.from('accessory_templates').insert(p).select().single(); if (error) throw error; return data; },
  update: async (id, p) => { const { data, error } = await supabase.from('accessory_templates').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  delete: async (id) => { const { error } = await supabase.from('accessory_templates').delete().eq('id', id); if (error) throw error; },
};

// ═══════════════════════════════════════════════════════════════════════════
// APPEND TO END OF src/api/supabaseClient.js (if `production` export is missing)
// ═══════════════════════════════════════════════════════════════════════════

export const production = {
  lines: {
    list: async (onlyActive = true) => {
      let q = supabase.from('production_lines').select('*').order('name');
      if (onlyActive) q = q.eq('is_active', true);
      const { data, error } = await q; if (error) throw error; return data;
    },
    create: async (p) => { const { data, error } = await supabase.from('production_lines').insert(p).select().single(); if (error) throw error; return data; },
    update: async (id, p) => { const { data, error } = await supabase.from('production_lines').update(p).eq('id', id).select().single(); if (error) throw error; return data; },
    delete: async (id) => { const { error } = await supabase.from('production_lines').delete().eq('id', id); if (error) throw error; },
  },
  stages: {
    list: async () => { const { data, error } = await supabase.from('production_stages').select('*').eq('is_active', true).order('stage_order'); if (error) throw error; return data; },
  },
  capacity: {
    list: async (filters = {}) => {
      let q = supabase.from('capacity_plans').select('*, line:line_id(name), stage:stage_id(name, stage_order)').order('start_date', { ascending: true });
      if (filters.po_id)   q = q.eq('po_id', filters.po_id);
      if (filters.line_id) q = q.eq('line_id', filters.line_id);
      if (filters.status)  q = q.eq('status', filters.status);
      const { data, error } = await q; if (error) throw error; return data;
    },
    create: async (p) => { const { data, error } = await supabase.from('capacity_plans').insert(sanitizeDates(p, ['start_date','end_date'])).select().single(); if (error) throw error; return data; },
    update: async (id, p) => { const { data, error } = await supabase.from('capacity_plans').update(sanitizeDates(p, ['start_date','end_date'])).eq('id', id).select().single(); if (error) throw error; return data; },
    delete: async (id) => { const { error } = await supabase.from('capacity_plans').delete().eq('id', id); if (error) throw error; },
    bulkCreate: async (rows) => { const { data, error } = await supabase.from('capacity_plans').insert(rows.map(r => sanitizeDates(r, ['start_date','end_date']))).select(); if (error) throw error; return data; },
  },
  output: {
    list: async (filters = {}) => {
      let q = supabase.from('production_output').select('*').order('output_date', { ascending: false }).limit(1000);
      if (filters.po_id)     q = q.eq('po_id', filters.po_id);
      if (filters.line_id)   q = q.eq('line_id', filters.line_id);
      if (filters.date_from) q = q.gte('output_date', filters.date_from);
      if (filters.date_to)   q = q.lte('output_date', filters.date_to);
      const { data, error } = await q; if (error) throw error; return data;
    },
    create: async (p) => { const { data, error } = await supabase.from('production_output').insert(sanitizeDates(p, ['output_date'])).select().single(); if (error) throw error; return data; },
    bulkCreate: async (rows) => { const { data, error } = await supabase.from('production_output').insert(rows.map(r => sanitizeDates(r, ['output_date']))).select(); if (error) throw error; return data; },
    delete: async (id) => { const { error } = await supabase.from('production_output').delete().eq('id', id); if (error) throw error; },
  },
  wip: {
    list: async (filters = {}) => {
      let q = supabase.from('v_wip_status').select('*').order('stage_order, po_number');
      if (filters.po_id)   q = q.eq('po_id', filters.po_id);
      if (filters.line_id) q = q.eq('line_id', filters.line_id);
      if (filters.status)  q = q.eq('status', filters.status);
      const { data, error } = await q; if (error) throw error; return data;
    },
  },
  dailyCapacity: {
    list: async (days = 30) => {
      const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase.from('v_daily_capacity').select('*').gte('output_date', from).order('output_date', { ascending: false });
      if (error) throw error; return data;
    },
  },
};

// ============================================================================
// Session 9 additions — case-insensitive normalized data-fetch helpers.
// Paste the block below at the end of src/api/supabaseClient.js, after all
// existing exports. Requires the new src/lib/codes.js and
// src/api/priceService.js files. See patch-s9-apply.ps1.
// ============================================================================

// Re-export everything from priceService so existing imports that expect
// `import { priceList } from '@/api/supabaseClient'` keep working.
export {
  fetchPriceByCode,
  fetchPricesByCodes,
  fetchActivePriceList,
  fetchMasterArticleByCode,
  fetchMasterArticlesByCodes,
  fetchSkuProfile,
  enrichPoItem,
  classifyPriceStatus,
  classifyCbmStatus,
} from './priceService';

// Namespaced helpers for call sites that prefer the old `priceList.xxx` style.
import {
  fetchPriceByCode as _fetchPriceByCode,
  fetchPricesByCodes as _fetchPricesByCodes,
  fetchActivePriceList as _fetchActivePriceList,
  fetchMasterArticleByCode as _fetchMasterArticleByCode,
  fetchMasterArticlesByCodes as _fetchMasterArticlesByCodes,
  fetchSkuProfile as _fetchSkuProfile,
  enrichPoItem as _enrichPoItem,
} from './priceService';

export const priceListV2 = { findByCode: _fetchPriceByCode,
  findByCodes: _fetchPricesByCodes,
  listActive: _fetchActivePriceList,
};

export const masterArticlesV2 = { findByCode: _fetchMasterArticleByCode,
  findByCodes: _fetchMasterArticlesByCodes,
};

export const skuCatalogV2 = {
  profile: _fetchSkuProfile,
  enrichItem: _enrichPoItem,
};

