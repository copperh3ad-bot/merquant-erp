-- 33_fabric_inventory.sql
--
-- Physical fabric roll inventory + per-roll consumption ledger. Powers
-- the FabricInventory.jsx page (F3 — AI Fabric Roll Tracker).
--
-- IMPORTANT: available_meters is GENERATED ALWAYS AS (received - consumed)
-- STORED. Never include it in client-side INSERT/UPDATE payloads — Supabase
-- will reject the write. Use it only in SELECT queries.

-- UP
CREATE TABLE IF NOT EXISTS public.fabric_rolls (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fabric_order_id uuid REFERENCES public.fabric_orders(id) ON DELETE SET NULL,
  roll_number text,
  lot_number text,
  shade_number text,
  gsm numeric(6,2),
  width_inches numeric(5,2),
  received_meters numeric(8,2),
  consumed_meters numeric(8,2) DEFAULT 0,
  available_meters numeric(8,2) GENERATED ALWAYS AS (received_meters - consumed_meters) STORED,
  location text,
  status text DEFAULT 'available',
  ai_notes text,
  received_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fabric_rolls_fabric_order_idx ON public.fabric_rolls(fabric_order_id);
CREATE INDEX IF NOT EXISTS fabric_rolls_lot_shade_idx ON public.fabric_rolls(lot_number, shade_number);

ALTER TABLE public.fabric_rolls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fabric_rolls_select ON public.fabric_rolls;
DROP POLICY IF EXISTS fabric_rolls_insert ON public.fabric_rolls;
DROP POLICY IF EXISTS fabric_rolls_update ON public.fabric_rolls;
DROP POLICY IF EXISTS fabric_rolls_delete ON public.fabric_rolls;

CREATE POLICY fabric_rolls_select ON public.fabric_rolls
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY fabric_rolls_insert ON public.fabric_rolls
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY fabric_rolls_update ON public.fabric_rolls
  FOR UPDATE TO authenticated
  USING (public.has_role('Owner', 'Manager', 'Merchandiser'))
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY fabric_rolls_delete ON public.fabric_rolls
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- Per-roll consumption ledger
CREATE TABLE IF NOT EXISTS public.fabric_roll_consumption (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  roll_id uuid REFERENCES public.fabric_rolls(id) ON DELETE CASCADE,
  job_card_id uuid REFERENCES public.job_cards(id) ON DELETE SET NULL,
  po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  meters_used numeric(8,2),
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at timestamptz DEFAULT now()
);

-- NB: this table is named fabric_roll_consumption (not fabric_consumption)
-- to avoid collision with the brief's mention of fabric_consumption — that
-- name was already used in the AI extraction master_data prompt schema for
-- a different concept (per-SKU yardage extracted from tech packs). The
-- schema-context update in F8 will clarify the distinction.

CREATE INDEX IF NOT EXISTS fabric_roll_consumption_roll_idx ON public.fabric_roll_consumption(roll_id);
CREATE INDEX IF NOT EXISTS fabric_roll_consumption_job_card_idx ON public.fabric_roll_consumption(job_card_id);

ALTER TABLE public.fabric_roll_consumption ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fabric_roll_consumption_select ON public.fabric_roll_consumption;
DROP POLICY IF EXISTS fabric_roll_consumption_insert ON public.fabric_roll_consumption;
DROP POLICY IF EXISTS fabric_roll_consumption_update ON public.fabric_roll_consumption;
DROP POLICY IF EXISTS fabric_roll_consumption_delete ON public.fabric_roll_consumption;

CREATE POLICY fabric_roll_consumption_select ON public.fabric_roll_consumption
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY fabric_roll_consumption_insert ON public.fabric_roll_consumption
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY fabric_roll_consumption_update ON public.fabric_roll_consumption
  FOR UPDATE TO authenticated
  USING (public.has_role('Owner', 'Manager', 'Merchandiser'))
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY fabric_roll_consumption_delete ON public.fabric_roll_consumption
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- DOWN
DROP TABLE IF EXISTS public.fabric_roll_consumption;
DROP TABLE IF EXISTS public.fabric_rolls;
