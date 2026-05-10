-- 0043: Auto-numbering sequences for job_cards, fabric_orders, shipments

-- Job card sequence: JC-YYYYMM-NNNN
CREATE SEQUENCE IF NOT EXISTS job_card_seq START 1;

CREATE OR REPLACE FUNCTION fn_auto_job_card_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.job_card_number IS NULL OR NEW.job_card_number = '' THEN
    NEW.job_card_number := 'JC-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD(nextval('job_card_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_job_card_number ON job_cards;
CREATE TRIGGER trg_auto_job_card_number
  BEFORE INSERT ON job_cards
  FOR EACH ROW EXECUTE FUNCTION fn_auto_job_card_number();

-- Fabric order sequence: FO-YYYYMM-NNNN
CREATE SEQUENCE IF NOT EXISTS fabric_order_seq START 1;

CREATE OR REPLACE FUNCTION fn_auto_fabric_order_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fabric_order_number IS NULL OR NEW.fabric_order_number = '' THEN
    NEW.fabric_order_number := 'FO-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD(nextval('fabric_order_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_fabric_order_number ON fabric_orders;
CREATE TRIGGER trg_auto_fabric_order_number
  BEFORE INSERT ON fabric_orders
  FOR EACH ROW EXECUTE FUNCTION fn_auto_fabric_order_number();

-- Shipment sequence: SHP-YYYYMM-NNNN
CREATE SEQUENCE IF NOT EXISTS shipment_seq START 1;

CREATE OR REPLACE FUNCTION fn_auto_shipment_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shipment_number IS NULL OR NEW.shipment_number = '' THEN
    NEW.shipment_number := 'SHP-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD(nextval('shipment_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_shipment_number ON shipments;
CREATE TRIGGER trg_auto_shipment_number
  BEFORE INSERT ON shipments
  FOR EACH ROW EXECUTE FUNCTION fn_auto_shipment_number();
