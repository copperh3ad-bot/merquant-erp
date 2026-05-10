-- 0041: partial shipment flag, wet processing yield check, issue slips

-- Partial shipment allowed flag per PO (case-by-case, NULL = unknown)
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS partial_shipment_allowed boolean DEFAULT NULL;

COMMENT ON COLUMN purchase_orders.partial_shipment_allowed
  IS 'NULL = not yet determined; true = buyer allows partial shipments; false = full shipment only';

-- Wet processing yield records: fabric sent vs fabric received back
CREATE TABLE IF NOT EXISTS wet_processing_yields (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id           uuid REFERENCES purchase_orders(id) ON DELETE CASCADE,
  po_number       text,
  fabric_order_id uuid REFERENCES fabric_orders(id) ON DELETE SET NULL,
  article_code    text,
  component_type  text,
  color           text,
  sent_meters     numeric NOT NULL,
  received_meters numeric,
  yield_percent   numeric GENERATED ALWAYS AS (
    CASE WHEN sent_meters > 0 AND received_meters IS NOT NULL
      THEN round((received_meters / sent_meters) * 100, 2)
      ELSE NULL END
  ) STORED,
  process_type    text DEFAULT 'Wet Processing',
  processor_name  text,
  sent_date       date,
  received_date   date,
  notes           text,
  recorded_by     text,
  created_at      timestamptz DEFAULT now()
);

-- Issue slips: formal record of materials issued from store to production
CREATE TABLE IF NOT EXISTS issue_slips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slip_number     text UNIQUE NOT NULL,
  po_id           uuid REFERENCES purchase_orders(id) ON DELETE CASCADE,
  po_number       text,
  issue_date      date NOT NULL DEFAULT CURRENT_DATE,
  issued_by       text,
  received_by     text,
  department      text,
  status          text DEFAULT 'Draft' CHECK (status IN ('Draft','Issued','Acknowledged')),
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS issue_slip_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slip_id         uuid REFERENCES issue_slips(id) ON DELETE CASCADE,
  material_type   text NOT NULL CHECK (material_type IN ('Fabric','Yarn','Accessory','Trim','Packaging','Other')),
  item_code       text,
  item_description text,
  quantity_issued numeric NOT NULL,
  unit            text DEFAULT 'Meters',
  fabric_order_id uuid REFERENCES fabric_orders(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

-- Sequence for auto-generating slip numbers
CREATE SEQUENCE IF NOT EXISTS issue_slip_seq START 1;

-- Auto-generate slip_number if not provided
CREATE OR REPLACE FUNCTION fn_set_issue_slip_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slip_number IS NULL OR NEW.slip_number = '' THEN
    NEW.slip_number := 'IS-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD(nextval('issue_slip_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_issue_slip_number ON issue_slips;
CREATE TRIGGER trg_issue_slip_number
  BEFORE INSERT ON issue_slips
  FOR EACH ROW EXECUTE FUNCTION fn_set_issue_slip_number();
