-- migrations/up/0002_ai_extractions.sql
--
-- Phase A of the AI extraction pipeline (spec: 2026-04-25-ai-extraction).
-- Creates the ai_extractions audit table, the ai-extraction-sources storage
-- bucket (private), and matching RLS + audit trigger.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE public.ai_extractions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind               text NOT NULL CHECK (kind IN ('tech_pack', 'master_data')),
    prompt_version     text NOT NULL,
    model              text NOT NULL,

    -- source file
    file_name          text NOT NULL,
    file_mime          text NOT NULL,
    file_size_bytes    integer NOT NULL CHECK (file_size_bytes > 0),
    file_hash          text NOT NULL,
    storage_path       text NOT NULL,

    -- llm round trip
    raw_llm_response   jsonb,
    extracted_data     jsonb,
    tokens_input       integer,
    tokens_output      integer,
    cost_usd           numeric(10, 4),

    -- validation
    validation_status  text NOT NULL DEFAULT 'pending'
                       CHECK (validation_status IN ('pending', 'passed', 'warned', 'failed', 'skipped')),
    validation_issues  jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- review
    review_status      text NOT NULL DEFAULT 'pending_review'
                       CHECK (review_status IN ('pending_review', 'approved', 'partially_approved', 'rejected', 'superseded')),
    review_notes       text,

    -- apply
    applied_at         timestamptz,
    applied_by         uuid,
    applied_target_ids jsonb,

    -- rejection
    rejected_at        timestamptz,
    rejected_by        uuid,
    rejection_reason   text,

    -- failure (extraction itself errored)
    error_code         text,
    error_message      text,

    -- audit
    created_by         uuid NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    -- multi-tenant placeholder; nullable until the org_id rollout ships
    org_id             uuid
);

COMMENT ON COLUMN public.ai_extractions.org_id IS
    'Nullable placeholder until org_id rollout ships; RLS does not enforce on this column yet.';

CREATE INDEX ai_extractions_kind_idx          ON public.ai_extractions (kind);
CREATE INDEX ai_extractions_review_status_idx ON public.ai_extractions (review_status);
CREATE INDEX ai_extractions_created_at_idx    ON public.ai_extractions (created_at DESC);
CREATE INDEX ai_extractions_file_hash_idx     ON public.ai_extractions (file_hash);
CREATE INDEX ai_extractions_created_by_idx    ON public.ai_extractions (created_by);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_ai_extractions_updated
    BEFORE UPDATE ON public.ai_extractions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_audit_ai_extractions
    AFTER INSERT OR UPDATE OR DELETE ON public.ai_extractions
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ---------------------------------------------------------------------------
-- Row-level security (auth_all permissive — matches codebase convention)
-- ---------------------------------------------------------------------------

ALTER TABLE public.ai_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_all ON public.ai_extractions
    TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Storage bucket: private, write-once for source files
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
    VALUES ('ai-extraction-sources', 'ai-extraction-sources', false)
    ON CONFLICT (id) DO NOTHING;

CREATE POLICY ai_extraction_sources_select ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'ai-extraction-sources');

CREATE POLICY ai_extraction_sources_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'ai-extraction-sources');

CREATE POLICY ai_extraction_sources_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'ai-extraction-sources');
