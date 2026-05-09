/**
 * emailPoAgent.js
 * API helpers for the Email-to-PO Agent
 * Add these methods to src/api/supabaseClient.js or import directly
 */

import { supabase } from './supabaseClient';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-po-agent`;

// ---------------------------------------------------------------------------
// Call the edge function — runs the agentic extraction loop
// ---------------------------------------------------------------------------

export async function runEmailPOAgent({ subject, body, sender, emailId }) {
  const { data: { session } } = await supabase.auth.getSession();

  const response = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
    },
    body: JSON.stringify({
      email_id: emailId ?? null,
      subject: subject ?? '',
      body,
      sender: sender ?? null,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error ?? `Agent error ${response.status}`);
  }

  return response.json(); // { draft, success }
}

// ---------------------------------------------------------------------------
// Save draft to DB
// ---------------------------------------------------------------------------

export async function saveEmailPODraft(draft) {
  const { data, error } = await supabase
    .from('email_po_drafts')
    .insert({
      email_id:                draft.email_id,
      sender_email:            draft.sender_email,
      raw_extracted:           draft.raw_extracted,
      buyer_name:              draft.buyer_name,
      po_number:               draft.po_number,
      order_date:              draft.order_date ?? null,
      delivery_date:           draft.delivery_date ?? null,
      currency:                draft.currency ?? 'USD',
      destination_country:     draft.destination_country ?? null,
      payment_terms:           draft.payment_terms ?? null,
      incoterms:               draft.incoterms ?? null,
      special_instructions:    draft.special_instructions ?? null,
      items:                   draft.items ?? [],
      overall_confidence:      draft.overall_confidence ?? 0,
      field_scores:            draft.field_scores ?? {},
      missing_critical_fields: draft.missing_critical_fields ?? [],
      ambiguities:             draft.ambiguities ?? [],
      unmatched_items:         draft.unmatched_items ?? [],
      match_suggestions:       draft.match_suggestions ?? [],
      is_po_email:             draft.is_po_email ?? false,
      status:                  'pending_review',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Load pending drafts (for review queue)
// ---------------------------------------------------------------------------

export async function getEmailPODrafts({ status = 'pending_review', limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('email_po_drafts')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Confirm a draft → create actual PO
// ---------------------------------------------------------------------------

export async function confirmEmailPODraft(draftId, editedDraft) {
  // 1. Create the purchase order
  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .insert({
      buyer_name:           editedDraft.buyer_name,
      po_number:            editedDraft.po_number,
      order_date:           editedDraft.order_date,
      delivery_date:        editedDraft.delivery_date,
      currency:             editedDraft.currency ?? 'USD',
      destination_country:  editedDraft.destination_country,
      payment_terms:        editedDraft.payment_terms,
      incoterms:            editedDraft.incoterms,
      special_instructions: editedDraft.special_instructions,
      approval_status:      'not_submitted',
      portal_source:        'email_agent',
    })
    .select()
    .single();

  if (poError) throw poError;

  // 2. Insert line items
  if (editedDraft.items?.length > 0) {
    const lineItems = editedDraft.items.map((item) => ({
      po_id:              po.id,
      description:        item.description,
      sku:                item.sku ?? null,
      quantity:           item.quantity,
      unit_price:         item.unit_price ?? null,
      size_breakdown:     item.size_breakdown ?? null,
      colour:             item.colour ?? null,
      fabric_composition: item.fabric_composition ?? null,
    }));

    const { error: itemsError } = await supabase
      .from('po_items')
      .insert(lineItems);

    if (itemsError) throw itemsError;
  }

  // 3. Mark draft as confirmed
  const { error: updateError } = await supabase
    .from('email_po_drafts')
    .update({
      status:        'confirmed',
      created_po_id: po.id,
      reviewed_at:   new Date().toISOString(),
    })
    .eq('id', draftId);

  if (updateError) throw updateError;

  return po;
}

// ---------------------------------------------------------------------------
// Reject a draft
// ---------------------------------------------------------------------------

export async function rejectEmailPODraft(draftId, notes = '') {
  const { error } = await supabase
    .from('email_po_drafts')
    .update({
      status:         'rejected',
      reviewer_notes: notes,
      reviewed_at:    new Date().toISOString(),
    })
    .eq('id', draftId);

  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Confidence helpers — used by the UI to colour-code fields
// ---------------------------------------------------------------------------

export function getConfidenceLevel(score) {
  if (score >= 0.85) return 'high';    // green
  if (score >= 0.60) return 'medium';  // yellow
  return 'low';                         // red
}

export function getConfidenceColor(score) {
  const level = getConfidenceLevel(score);
  return {
    high:   'text-green-700 bg-green-50 border-green-200',
    medium: 'text-yellow-700 bg-yellow-50 border-yellow-200',
    low:    'text-red-700 bg-red-50 border-red-200',
  }[level];
}
