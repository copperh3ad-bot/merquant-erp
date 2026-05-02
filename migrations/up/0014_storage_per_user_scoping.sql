-- 0014_storage_per_user_scoping.sql
-- 2026-05-02
--
-- Hardening for hardening-audit-2026-05-01 Finding 15
-- (ai-extraction-sources bucket has no per-user scoping).
--
-- Before this migration: any authenticated user could read every other
-- user's uploaded source files (tech packs, master-data XLSX, label
-- photos) via the bucket's catch-all SELECT/INSERT/DELETE policies.
--
-- After: each user can only see + delete files they uploaded
-- themselves, identified by storage.objects.owner = auth.uid().
-- INSERT is unchanged — any authenticated user can upload, and Supabase
-- automatically stamps owner with the caller's auth.uid(). Owner-role
-- users get a bypass for support / debugging.
--
-- The Supabase storage `owner` column is populated automatically on
-- INSERT for any object uploaded with an Authorization JWT, so existing
-- objects from authenticated uploads already have the correct owner.
-- Service-role uploads (rare) will have NULL owner and will become
-- inaccessible — acceptable, those are admin operations and we have the
-- service-role key for re-access.
--
-- Re-applying is safe (DROP + recreate).

-- Drop the old over-permissive policies. Idempotent.
DROP POLICY IF EXISTS ai_extraction_sources_select ON storage.objects;
DROP POLICY IF EXISTS ai_extraction_sources_insert ON storage.objects;
DROP POLICY IF EXISTS ai_extraction_sources_delete ON storage.objects;

-- ── SELECT: own files OR Owner role ─────────────────────────────────
CREATE POLICY ai_extraction_sources_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'ai-extraction-sources'
      AND (
        owner = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_profiles
          WHERE id = auth.uid() AND role = 'Owner'
        )
      )
    );

-- ── INSERT: any authenticated user (owner stamped automatically) ────
CREATE POLICY ai_extraction_sources_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'ai-extraction-sources');

-- ── DELETE: own files OR Owner role ─────────────────────────────────
CREATE POLICY ai_extraction_sources_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'ai-extraction-sources'
      AND (
        owner = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_profiles
          WHERE id = auth.uid() AND role = 'Owner'
        )
      )
    );
