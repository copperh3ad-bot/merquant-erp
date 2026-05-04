-- 32_capacity.sql
--
-- Extends the existing capacity_plans table with AI-allocation fields.
-- The original schema is per-PO / per-article / per-line scheduling.
-- The new fields enable an aggregate per-day per-line planning mode
-- that the AI allocator generates from raw inputs (operators, machines,
-- shift hours, pending POs).
--
-- Both modes coexist on the same table: rows with po_id are the
-- per-PO schedule; rows with plan_date + line_name + ai_allocation
-- are AI-generated aggregate plans.
--
-- The table itself was created earlier (pre-v2). RLS was already
-- hardened in tier-2 (commit 0e0e099).

-- UP
ALTER TABLE public.capacity_plans
  ADD COLUMN IF NOT EXISTS plan_date date,
  ADD COLUMN IF NOT EXISTS line_name text,
  ADD COLUMN IF NOT EXISTS total_operators integer,
  ADD COLUMN IF NOT EXISTS available_machines integer,
  ADD COLUMN IF NOT EXISTS shift_hours numeric(4,2) DEFAULT 8,
  ADD COLUMN IF NOT EXISTS target_pieces integer,
  ADD COLUMN IF NOT EXISTS ai_allocation jsonb;

CREATE INDEX IF NOT EXISTS capacity_plans_plan_date_idx ON public.capacity_plans(plan_date);

-- DOWN
ALTER TABLE public.capacity_plans
  DROP COLUMN IF EXISTS plan_date,
  DROP COLUMN IF EXISTS line_name,
  DROP COLUMN IF EXISTS total_operators,
  DROP COLUMN IF EXISTS available_machines,
  DROP COLUMN IF EXISTS shift_hours,
  DROP COLUMN IF EXISTS target_pieces,
  DROP COLUMN IF EXISTS ai_allocation;
