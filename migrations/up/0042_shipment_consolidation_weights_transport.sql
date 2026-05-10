-- 0042: shipment mode of transport, weight fields, multi-PO consolidation

-- Missing fields on shipments
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS mode_of_transport text DEFAULT 'Sea' CHECK (mode_of_transport IN ('Sea','Air','Road','Rail','Courier')),
  ADD COLUMN IF NOT EXISTS net_weight_kg     numeric,
  ADD COLUMN IF NOT EXISTS gross_weight_kg   numeric;

-- Multi-PO consolidation: one shipment can carry multiple POs
-- (same buyer + same destination port required by business rule)
CREATE TABLE IF NOT EXISTS shipment_pos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id     uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  po_id           uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  po_number       text NOT NULL,
  customer_name   text,
  total_cbm       numeric,
  total_cartons   integer,
  net_weight_kg   numeric,
  gross_weight_kg numeric,
  notes           text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_pos_shipment ON shipment_pos(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_pos_po       ON shipment_pos(po_id);
