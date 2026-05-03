-- Tier-2 follow-up: ai_extractions table (missed in initial sweep).
--
-- Holds AI extraction runs (tech pack + master data uploads). The
-- extract-document edge function inserts as the calling user, so
-- INSERT must allow uploaders. Review state changes (approve/reject)
-- are O+M only. Owner-only delete.

DROP POLICY IF EXISTS auth_all ON public.ai_extractions;
DROP POLICY IF EXISTS ai_extractions_select ON public.ai_extractions;
DROP POLICY IF EXISTS ai_extractions_insert ON public.ai_extractions;
DROP POLICY IF EXISTS ai_extractions_update ON public.ai_extractions;
DROP POLICY IF EXISTS ai_extractions_delete ON public.ai_extractions;

CREATE POLICY ai_extractions_select ON public.ai_extractions
  FOR SELECT TO authenticated
  USING (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY ai_extractions_insert ON public.ai_extractions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY ai_extractions_update ON public.ai_extractions
  FOR UPDATE TO authenticated
  USING (public.has_role('Owner', 'Manager'))
  WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY ai_extractions_delete ON public.ai_extractions
  FOR DELETE TO authenticated
  USING (public.has_role('Owner'));
