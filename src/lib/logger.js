// src/lib/logger.js
//
// Two exports:
//   logError(error, context)   — captures frontend / API crashes to error_log
//   logMLFeedback(opts)        — captures human corrections for ML training
//
// Both are fire-and-forget: a failure inside either function is swallowed so
// the logger can never block or crash the calling code path.

// ── Error logging ───────────────────────────────────────────────────────────

export async function logError(error, context = {}) {
  // Always surface to console so DevTools still shows it.
  // eslint-disable-next-line no-console
  console.error("[MerQuant]", error, context);

  try {
    const { supabase } = await import("../api/supabaseClient.js");
    await supabase.from("error_log").insert({
      message:   error?.message ?? String(error ?? "unknown"),
      stack:     error?.stack?.slice(0, 4000) ?? null,
      context:   context && Object.keys(context).length ? JSON.stringify(context) : null,
      url:       typeof window !== "undefined" ? window.location.pathname : null,
      severity:  context.severity ?? "error",
      category:  context.category ?? null,
      component: context.componentStack
        ? context.componentStack.split("\n").find(l => l.trim().startsWith("at "))?.trim() ?? null
        : null,
      user_email: context.userEmail ?? null,
    });
  } catch {
    // Swallow — logger errors must not propagate.
  }
}

// ── ML feedback logging ─────────────────────────────────────────────────────
//
// Call this whenever a human corrects something the AI or an automation
// suggested. Every row is a labelled training example.
//
// feedbackType:  'cell_edit' | 'status_override' | 'agent_outcome' | 'automation_outcome'
// sourceModule:  'po_extraction' | 'tna_risk' | 'payment_auto' | 'compliance_auto' |
//                'fabric_shortfall' | 'qc_verdict' | 'job_card_auto' | 'sample_auto'

export async function logMLFeedback({
  feedbackType,
  sourceModule,
  fieldName,
  originalValue,
  correctedValue,
  context,
  extractionId,
  entityType,
  entityId,
  userEmail,
  userRole,
  wasCorrect,
} = {}) {
  try {
    const { supabase } = await import("../api/supabaseClient.js");
    await supabase.from("ml_feedback").insert({
      feedback_type:   feedbackType,
      source_module:   sourceModule,
      field_name:      fieldName ?? null,
      original_value:  originalValue !== undefined && originalValue !== null
        ? String(originalValue) : null,
      corrected_value: correctedValue !== undefined && correctedValue !== null
        ? String(correctedValue) : null,
      context:         context ?? null,
      extraction_id:   extractionId ?? null,
      entity_type:     entityType ?? null,
      entity_id:       entityId ?? null,
      user_email:      userEmail ?? null,
      user_role:       userRole ?? null,
      was_correct:     wasCorrect ?? null,
    });
  } catch {
    // Swallow — logger errors must not propagate.
  }
}
