-- 31_shop_floor.sql
--
-- Shop-floor stage tracking — pieces in/out per stage per job card,
-- with optional AI summary text. Powers the ShopFloor.jsx dashboard
-- (F1 — AI Shop Floor Monitor).

-- UP
CREATE TABLE IF NOT EXISTS public.shop_floor_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_card_id uuid REFERENCES public.job_cards(id) ON DELETE CASCADE,
  stage text NOT NULL,
  pieces_in integer DEFAULT 0,
  pieces_out integer DEFAULT 0,
  operators integer DEFAULT 0,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ai_summary text,
  recorded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shop_floor_entries_job_card_idx ON public.shop_floor_entries(job_card_id);
CREATE INDEX IF NOT EXISTS shop_floor_entries_recorded_at_idx ON public.shop_floor_entries(recorded_at DESC);

ALTER TABLE public.shop_floor_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_floor_entries_select ON public.shop_floor_entries;
DROP POLICY IF EXISTS shop_floor_entries_insert ON public.shop_floor_entries;
DROP POLICY IF EXISTS shop_floor_entries_update ON public.shop_floor_entries;
DROP POLICY IF EXISTS shop_floor_entries_delete ON public.shop_floor_entries;

CREATE POLICY shop_floor_entries_select ON public.shop_floor_entries
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY shop_floor_entries_insert ON public.shop_floor_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY shop_floor_entries_update ON public.shop_floor_entries
  FOR UPDATE TO authenticated
  USING (public.has_role('Owner', 'Manager', 'Merchandiser'))
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY shop_floor_entries_delete ON public.shop_floor_entries
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- DOWN
DROP TABLE IF EXISTS public.shop_floor_entries;
