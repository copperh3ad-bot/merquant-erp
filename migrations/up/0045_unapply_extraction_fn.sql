-- 0045: fn_unapply_extraction
--
-- Soft-reversal for ai_extractions records that were applied in error.
-- Does NOT attempt to undo changes to live tables (articles, suppliers, etc.)
-- because that would require a full audit of every insert — too risky.
-- Instead it marks the extraction as pending_review again so the operator
-- can correct it and re-apply, and appends a timestamped note so the audit
-- trail is preserved.
--
-- Signature: fn_unapply_extraction(p_extraction_id UUID) → JSONB
-- Returns:   { "ok": true } | { "ok": false, "error": "..." }

CREATE OR REPLACE FUNCTION fn_unapply_extraction(p_extraction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec   RECORD;
  v_note  TEXT;
BEGIN
  -- Guard: extraction must exist and be in applied state
  SELECT id, review_status, applied_at, review_notes
    INTO v_rec
    FROM ai_extractions
   WHERE id = p_extraction_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'extraction not found');
  END IF;

  IF v_rec.applied_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'extraction is not applied');
  END IF;

  -- Append unapply note to review_notes
  v_note := COALESCE(v_rec.review_notes, '')
    || E'\n[unapplied ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI') || '] Marked as pending review for correction and re-apply. Live tables were NOT rolled back — manual review required.';

  -- Reset to pending_review (non-destructive — extracted_data is untouched)
  UPDATE ai_extractions
     SET applied_at    = NULL,
         review_status = 'pending_review',
         review_notes  = TRIM(v_note)
   WHERE id = p_extraction_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Grant to authenticated users; row-level security on ai_extractions still applies
GRANT EXECUTE ON FUNCTION fn_unapply_extraction(UUID) TO authenticated;
