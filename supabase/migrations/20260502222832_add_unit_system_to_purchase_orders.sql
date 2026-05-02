-- Per-PO unit-system preference (display only).
--
-- Replaces the global per-user toggle (mq_unit_system in localStorage)
-- with a per-PO column so each customer / order can have its own
-- display convention. US-based buyers tend to read inches + oz/sq.yd;
-- EU + APAC tend to read cm + GSM. Setting it on the PO row means
-- everyone working that PO sees the same units regardless of who they
-- are or where they're logged in from.
--
-- NULL = no preference saved → display layer falls back to "metric"
-- (the codebase's storage convention — width_cm / gsm). This way
-- existing POs continue to render exactly as before.

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS unit_system text
    CHECK (unit_system IS NULL OR unit_system IN ('metric', 'imperial'));

COMMENT ON COLUMN public.purchase_orders.unit_system IS
  'Display unit preference for this PO. NULL = metric (default). "imperial" = inches + oz/sq.yd.';
