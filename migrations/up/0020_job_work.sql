-- 34_job_work.sql
--
-- Subcontractor job work orders. Powers JobWork.jsx (F4 — AI
-- Subcontractor / Job Work Manager).

-- UP
CREATE TABLE IF NOT EXISTS public.job_work_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  subcontractor_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  work_type text NOT NULL,
  quantity_issued integer,
  quantity_received integer DEFAULT 0,
  issue_date date,
  expected_return date,
  actual_return date,
  estimated_cost numeric(12,2),
  actual_cost numeric(12,2),
  gate_pass_number text,
  status text DEFAULT 'issued',
  ai_cost_estimate jsonb,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_work_orders_po_idx ON public.job_work_orders(po_id);
CREATE INDEX IF NOT EXISTS job_work_orders_subcontractor_idx ON public.job_work_orders(subcontractor_id);
CREATE INDEX IF NOT EXISTS job_work_orders_status_idx ON public.job_work_orders(status);

ALTER TABLE public.job_work_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_work_orders_select ON public.job_work_orders;
DROP POLICY IF EXISTS job_work_orders_insert ON public.job_work_orders;
DROP POLICY IF EXISTS job_work_orders_update ON public.job_work_orders;
DROP POLICY IF EXISTS job_work_orders_delete ON public.job_work_orders;

CREATE POLICY job_work_orders_select ON public.job_work_orders
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY job_work_orders_insert ON public.job_work_orders
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY job_work_orders_update ON public.job_work_orders
  FOR UPDATE TO authenticated
  USING (public.has_role('Owner', 'Manager', 'Merchandiser'))
  WITH CHECK (public.has_role('Owner', 'Manager', 'Merchandiser'));
CREATE POLICY job_work_orders_delete ON public.job_work_orders
  FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- DOWN
DROP TABLE IF EXISTS public.job_work_orders;
