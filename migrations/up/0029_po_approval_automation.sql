-- 0029_po_approval_automation.sql
-- 2026-05-07
--
-- Auto-fills costing sheets and the T&A calendar at the moment a PO
-- transitions to approval. Replaces the four-column UPDATE in
-- db.purchaseOrders.approve(...) with a single RPC that:
--
--   1. Verifies the caller has Owner or Manager role.
--   2. Flips approval_status -> 'approved' (plus approved_by/at/notes).
--   3. For each article on the PO, inserts a costing_sheets row if one
--      does not already exist for that article_code. Computation mirrors
--      the existing client-side autoPopulateFromArticles in CostingSheet.jsx:
--          fabric_cost = Σ (component.total_required × component.cost_per_meter)
--                       (fall back to buyer_price × 0.55 if components have no cost)
--          trim_cost   = Σ trim_items.total_cost for this article_code
--          buyer_price = po_items.unit_price matched on item_code
--          overhead_pct = 8, agent_commission_pct = 5  (defaults from the JS)
--   4. Looks up a default T&A template (per-customer first, system-wide
--      fallback) and inserts a tna_calendars row + tna_milestones rows
--      derived from the template's milestones jsonb. Skipped silently if
--      a calendar already exists for the PO.
--
-- Best-effort across articles — per-article failures don't abort the
-- approval. The function returns a JSONB summary the client renders as
-- a toast. The approval flip itself is the first thing committed
-- conceptually, so nothing in the auto-fill step can leave the PO
-- un-approved.
--
-- Default-template resolution order:
--   (a) tna_templates row where lower(default_for_customer_name) =
--       lower(po.customer_name) — first match wins.
--   (b) tna_templates row where is_default = true AND
--       default_for_customer_name IS NULL.
--   (c) None — return T&A_NO_DEFAULT_TEMPLATE warning, calendar not
--       generated. Approval still succeeds.
--
-- Ship-date guard: T&A generation is skipped with T&A_NO_SHIP_DATE
-- warning when purchase_orders.ex_factory_date IS NULL. Note the
-- column is named ex_factory_date but the warning code keeps the
-- merchandiser-facing "ship by date" mental model.
--
-- Note on p_approved_by: typed as `text` to match the existing
-- approved_by column, which today stores a display name (full_name ||
-- email || 'Unknown'). A future refactor should move this to auth.uid()
-- for stronger identity guarantees, but that's out of scope here.

-- 1. Schema: add default-template metadata to tna_templates.
ALTER TABLE public.tna_templates
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_for_customer_name text;

-- Partial unique indexes to enforce default exclusivity.
-- One system-wide default (is_default=true AND default_for_customer_name IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS tna_templates_one_system_default_idx
  ON public.tna_templates ((1))
  WHERE is_default = true AND default_for_customer_name IS NULL;

-- One default per customer (case-insensitive on customer name).
CREATE UNIQUE INDEX IF NOT EXISTS tna_templates_one_default_per_customer_idx
  ON public.tna_templates (lower(default_for_customer_name))
  WHERE default_for_customer_name IS NOT NULL;

-- 2. The RPC.
CREATE OR REPLACE FUNCTION public.fn_approve_po_with_automation(
  p_po_id uuid,
  p_approved_by text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_po           public.purchase_orders%ROWTYPE;
  v_article      RECORD;
  v_template     public.tna_templates%ROWTYPE;
  v_tna_id       uuid;
  v_calendar_exists boolean;
  v_costing_exists  boolean;
  v_buyer_price  numeric(10,4);
  v_fab_cost     numeric(10,4);
  v_trim_cost    numeric(10,4);
  v_components_cost numeric(10,4);
  v_succeeded    int := 0;
  v_skipped      int := 0;
  v_failed       int := 0;
  v_warnings     jsonb := '[]'::jsonb;
  v_tna_status   text;
  v_milestone    jsonb;
  v_sort_idx     int;
BEGIN
  -- AuthZ: only Owner/Manager can approve. has_role() is defined live
  -- in the project (not in tracked migrations) — we trust its presence.
  IF NOT public.has_role('Owner', 'Manager') THEN
    RAISE EXCEPTION 'fn_approve_po_with_automation: caller lacks Owner/Manager role'
      USING ERRCODE = '42501';
  END IF;

  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'fn_approve_po_with_automation: p_po_id required';
  END IF;
  IF p_approved_by IS NULL OR length(trim(p_approved_by)) = 0 THEN
    RAISE EXCEPTION 'fn_approve_po_with_automation: p_approved_by required';
  END IF;

  -- 1) Approval flip.
  UPDATE public.purchase_orders
     SET approval_status = 'approved',
         approved_by     = p_approved_by,
         approved_at     = now(),
         approval_notes  = NULLIF(trim(coalesce(p_notes, '')), '')
   WHERE id = p_po_id
   RETURNING * INTO v_po;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fn_approve_po_with_automation: PO % not found', p_po_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2) Costing auto-fill — per-article best-effort.
  FOR v_article IN
    SELECT id, article_code, article_name, order_quantity, components
      FROM public.articles
     WHERE po_id = p_po_id
  LOOP
    BEGIN
      -- Skip if a costing row already exists for this article on this PO.
      SELECT EXISTS (
        SELECT 1 FROM public.costing_sheets
         WHERE po_id = p_po_id
           AND article_code IS NOT DISTINCT FROM v_article.article_code
      ) INTO v_costing_exists;

      IF v_costing_exists THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Buyer price from po_items (case-insensitive item_code match).
      SELECT COALESCE(unit_price, 0)
        INTO v_buyer_price
        FROM public.po_items
       WHERE po_id = p_po_id
         AND upper(trim(coalesce(item_code, ''))) =
             upper(trim(coalesce(v_article.article_code, '')))
       LIMIT 1;
      v_buyer_price := COALESCE(v_buyer_price, 0);

      -- Fabric cost from components jsonb. Mirrors the JS reduce:
      --   Σ ((c.total_required || 0) * (c.cost_per_meter || 0))
      SELECT COALESCE(SUM(
                COALESCE((comp->>'total_required')::numeric, 0)
              * COALESCE((comp->>'cost_per_meter')::numeric, 0)
             ), 0)
        INTO v_components_cost
        FROM jsonb_array_elements(coalesce(v_article.components, '[]'::jsonb)) AS comp;

      -- Fallback: 55% of buyer price when component costs aren't filled in.
      IF v_components_cost > 0 THEN
        v_fab_cost := v_components_cost;
      ELSE
        v_fab_cost := v_buyer_price * 0.55;
      END IF;

      -- Trim cost from trim_items aggregated for this article.
      SELECT COALESCE(SUM(COALESCE(total_cost, 0)), 0)
        INTO v_trim_cost
        FROM public.trim_items
       WHERE po_id = p_po_id
         AND article_code IS NOT DISTINCT FROM v_article.article_code;

      INSERT INTO public.costing_sheets (
        po_id, po_number, article_code, article_name,
        order_quantity, currency,
        fabric_cost, trim_cost, buyer_price,
        overhead_pct, agent_commission_pct
      ) VALUES (
        p_po_id, v_po.po_number, v_article.article_code, v_article.article_name,
        COALESCE(v_article.order_quantity, 0), COALESCE(v_po.currency, 'USD'),
        round(v_fab_cost::numeric, 4),
        round(v_trim_cost::numeric, 4),
        v_buyer_price,
        8, 5
      );

      v_succeeded := v_succeeded + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_warnings := v_warnings || jsonb_build_object(
        'article_id', v_article.id,
        'article_code', v_article.article_code,
        'reason', 'COSTING_INSERT_FAILED: ' || SQLERRM
      );
    END;
  END LOOP;

  -- 3) T&A auto-fill.
  v_tna_status := 'created';

  -- 3a) Skip if a calendar already exists for this PO.
  SELECT EXISTS (
    SELECT 1 FROM public.tna_calendars WHERE po_id = p_po_id
  ) INTO v_calendar_exists;

  IF v_calendar_exists THEN
    v_tna_status := 'skipped:exists';
  ELSIF v_po.ex_factory_date IS NULL THEN
    v_tna_status := 'skipped:no_ship_date';
    v_warnings := v_warnings || jsonb_build_object(
      'reason', 'T&A_NO_SHIP_DATE'
    );
  ELSE
    -- 3b) Resolve default template: per-customer first, then system-wide.
    SELECT * INTO v_template
      FROM public.tna_templates
     WHERE default_for_customer_name IS NOT NULL
       AND lower(default_for_customer_name) = lower(coalesce(v_po.customer_name, ''))
     ORDER BY created_at ASC
     LIMIT 1;

    IF NOT FOUND THEN
      SELECT * INTO v_template
        FROM public.tna_templates
       WHERE is_default = true
         AND default_for_customer_name IS NULL
       ORDER BY created_at ASC
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      v_tna_status := 'skipped:no_default';
      v_warnings := v_warnings || jsonb_build_object(
        'reason', 'T&A_NO_DEFAULT_TEMPLATE'
      );
    ELSE
      BEGIN
        INSERT INTO public.tna_calendars (
          po_id, po_number, customer_name, ex_factory_date, template_id
        ) VALUES (
          p_po_id, v_po.po_number, v_po.customer_name, v_po.ex_factory_date, v_template.id
        )
        RETURNING id INTO v_tna_id;

        v_sort_idx := 0;
        FOR v_milestone IN
          SELECT * FROM jsonb_array_elements(coalesce(v_template.milestones, '[]'::jsonb))
        LOOP
          INSERT INTO public.tna_milestones (
            tna_id, po_id, name, category, target_date, status, sort_order
          ) VALUES (
            v_tna_id,
            p_po_id,
            v_milestone->>'name',
            v_milestone->>'category',
            v_po.ex_factory_date - COALESCE((v_milestone->>'days_before_exfactory')::int, 0),
            'pending',
            v_sort_idx
          );
          v_sort_idx := v_sort_idx + 1;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        v_tna_status := 'failed';
        v_warnings := v_warnings || jsonb_build_object(
          'reason', 'T&A_INSERT_FAILED: ' || SQLERRM
        );
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'approval_status',  'approved',
    'po_id',            p_po_id,
    'po_number',        v_po.po_number,
    'costing_succeeded', v_succeeded,
    'costing_skipped',   v_skipped,
    'costing_failed',    v_failed,
    'tna_status',        v_tna_status,
    'warnings',          v_warnings
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_approve_po_with_automation(uuid, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_approve_po_with_automation(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.fn_approve_po_with_automation(uuid, text, text) IS
  'Approves a PO and best-effort auto-fills costing sheets + T&A calendar. Owner/Manager only. Returns jsonb summary used by the client toast.';

COMMENT ON COLUMN public.tna_templates.is_default IS
  'When true with default_for_customer_name=NULL, this is the system-wide default template used by fn_approve_po_with_automation.';

COMMENT ON COLUMN public.tna_templates.default_for_customer_name IS
  'When non-NULL, this template is the default for POs whose customer_name matches case-insensitively. Takes precedence over the system-wide default.';
