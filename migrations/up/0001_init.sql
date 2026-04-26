--
-- PostgreSQL database dump
--

\restrict iFYNMkYRsroGmkjnx8HTtcPxfCeHuDboTbERJWjLZEEHnWdlU9v6HAQMPlMDe4m

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.9 (Ubuntu 17.9-1.pgdg24.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: pricing_status_t; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pricing_status_t AS ENUM (
    'active',
    'pending',
    'expired'
);


--
-- Name: compute_sample_cost(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_sample_cost() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_unit_price numeric;
  v_currency text;
  v_source text;
BEGIN
  NEW.billable_quantity := GREATEST(COALESCE(NEW.quantity, 0) - 10, 0);
  IF NEW.billable_quantity = 0 THEN
    NEW.unit_price := 0;
    NEW.total_cost := 0;
    NEW.cost_source := 'free_allowance';
    NEW.currency := COALESCE(NEW.currency, 'USD');
    RETURN NEW;
  END IF;
  IF NEW.quotation_id IS NOT NULL THEN
    SELECT q.quoted_price, q.currency INTO v_unit_price, v_currency
    FROM quotations q WHERE q.id = NEW.quotation_id;
    v_source := 'quotation';
  END IF;
  IF v_unit_price IS NULL AND NEW.rfq_id IS NOT NULL THEN
    SELECT r.target_price, r.target_price_currency INTO v_unit_price, v_currency
    FROM rfqs r WHERE r.id = NEW.rfq_id;
    v_source := 'rfq_target';
  END IF;
  IF v_unit_price IS NULL AND NEW.po_id IS NOT NULL AND NEW.style_number IS NOT NULL THEN
    SELECT pi.unit_price, po.currency INTO v_unit_price, v_currency
    FROM po_items pi JOIN purchase_orders po ON po.id = pi.po_id
    WHERE pi.po_id = NEW.po_id AND pi.item_code = NEW.style_number
    LIMIT 1;
    v_source := 'po_item_fallback';
  END IF;
  NEW.unit_price := COALESCE(v_unit_price, 0);
  NEW.currency := COALESCE(v_currency, NEW.currency, 'USD');
  NEW.cost_source := COALESCE(v_source, 'manual');
  NEW.total_cost := NEW.billable_quantity * NEW.unit_price;
  IF NEW.total_cost > 0 AND COALESCE(NEW.invoice_status, 'not_invoiced') = 'not_invoiced' THEN
    NEW.invoice_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: create_default_job_card_steps(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_default_job_card_steps() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO job_card_steps (parent_job_card_id, step_number, step_name, status) VALUES
    (NEW.id, 1, 'Yarn Booking', 'Pending'),
    (NEW.id, 2, 'Knitting/Weaving', 'Pending'),
    (NEW.id, 3, 'Dyeing/Finishing', 'Pending'),
    (NEW.id, 4, 'Fabric Inspection', 'Pending'),
    (NEW.id, 5, 'Made-up (Cutting + Stitching + Packing)', 'Pending'),
    (NEW.id, 6, 'Final QC', 'Pending'),
    (NEW.id, 7, 'Ready to Ship', 'Pending');
  RETURN NEW;
END;
$$;


--
-- Name: exec_sql(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.exec_sql(query text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  result jsonb;
BEGIN
  -- Safety: only allow SELECT statements from the RPC
  IF UPPER(TRIM(query)) NOT LIKE 'SELECT%' AND 
     UPPER(TRIM(query)) NOT LIKE 'WITH%'   AND
     UPPER(TRIM(query)) NOT LIKE 'EXPLAIN%' THEN
    RAISE EXCEPTION 'Only SELECT / WITH / EXPLAIN queries are allowed via exec_sql';
  END IF;
  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || query || ') t' INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;


--
-- Name: explode_po_bom(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.explode_po_bom(p_po_id uuid, p_force_redo boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_po record;
  v_item record;
  v_master record;
  v_tp record;
  v_comp jsonb;
  v_qty numeric;
  v_wastage numeric;
  v_final_qty numeric;
  v_created_id uuid;
  v_result jsonb := jsonb_build_object('fabrics',0,'yarns',0,'trims',0,'accessories',0,'cartons',0,'errors','[]'::jsonb);
  v_errors jsonb := '[]'::jsonb;
  c int;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id;
  IF v_po IS NULL THEN RAISE EXCEPTION 'PO not found'; END IF;

  IF v_po.bom_exploded AND NOT p_force_redo THEN
    RETURN jsonb_build_object('status','already_exploded','at',v_po.bom_exploded_at);
  END IF;

  -- Clear prior runs if forcing
  IF p_force_redo THEN
    DELETE FROM bom_explosion_log WHERE po_id = p_po_id;
    DELETE FROM yarn_requirements WHERE po_id = p_po_id;
    DELETE FROM trim_items WHERE po_id = p_po_id;
    DELETE FROM accessory_items WHERE po_id = p_po_id;
    DELETE FROM fabric_orders WHERE po_id = p_po_id;
  END IF;

  -- Iterate PO items
  FOR v_item IN SELECT * FROM po_items WHERE po_id = p_po_id LOOP
    -- Find master article by item_code
    SELECT * INTO v_master FROM master_articles
      WHERE article_code = v_item.item_code AND is_active = true LIMIT 1;

    -- Find tech pack by article_code OR po_id
    SELECT * INTO v_tp FROM tech_packs
      WHERE (article_code = v_item.item_code OR po_id = p_po_id)
      AND extraction_status = 'extracted'
      ORDER BY CASE WHEN article_code = v_item.item_code THEN 0 ELSE 1 END
      LIMIT 1;

    -- 1. FABRICS (from master; fallback tech_pack)
    IF v_master.id IS NOT NULL AND jsonb_array_length(COALESCE(v_master.fabric_components,'[]'::jsonb)) > 0 THEN
      FOR v_comp IN SELECT jsonb_array_elements(v_master.fabric_components) LOOP
        v_qty := COALESCE((v_comp->>'consumption_per_unit')::numeric, 0) * v_item.quantity;
        v_wastage := COALESCE((v_comp->>'wastage_percent')::numeric, 5);
        v_final_qty := v_qty * (1 + v_wastage / 100);
        INSERT INTO fabric_orders (po_id, po_number, mill_name, fabric_type, gsm, width_cm, color, quantity_meters, currency, status, notes)
        VALUES (p_po_id, v_po.po_number,
          COALESCE(v_comp->>'supplier','TBD'),
          v_comp->>'fabric_type',
          NULLIF(v_comp->>'gsm','')::numeric,
          NULLIF(v_comp->>'width_cm','')::numeric,
          v_comp->>'color', v_final_qty, v_po.currency, 'Pending',
          CONCAT('Auto-exploded from master ',v_master.article_code,' · item ',v_item.item_code))
        RETURNING id INTO v_created_id;
        INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, wastage_pct, details)
        VALUES (p_po_id, v_po.po_number, v_item.item_code, v_comp->>'component_type', 'fabric', 'master_article', v_master.id, v_created_id, 'fabric_orders', v_final_qty, v_wastage, v_comp);
        v_result := jsonb_set(v_result, '{fabrics}', to_jsonb((v_result->>'fabrics')::int + 1));
      END LOOP;
    ELSIF v_tp.id IS NOT NULL AND jsonb_array_length(COALESCE(v_tp.extracted_fabric_specs,'[]'::jsonb)) > 0 THEN
      FOR v_comp IN SELECT jsonb_array_elements(v_tp.extracted_fabric_specs) LOOP
        v_qty := COALESCE((v_comp->>'consumption_per_unit')::numeric, 0) * v_item.quantity;
        v_wastage := COALESCE((v_comp->>'wastage_percent')::numeric, 5);
        v_final_qty := v_qty * (1 + v_wastage / 100);
        INSERT INTO fabric_orders (po_id, po_number, mill_name, fabric_type, gsm, width_cm, color, quantity_meters, currency, status, notes)
        VALUES (p_po_id, v_po.po_number, 'TBD', v_comp->>'fabric_type',
          NULLIF(v_comp->>'gsm','')::numeric, NULLIF(v_comp->>'width_cm','')::numeric,
          v_comp->>'color', v_final_qty, v_po.currency, 'Pending',
          CONCAT('Auto-exploded from techpack ',v_tp.article_code,' · item ',v_item.item_code,' (FALLBACK — no master)'))
        RETURNING id INTO v_created_id;
        INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, wastage_pct, details)
        VALUES (p_po_id, v_po.po_number, v_item.item_code, v_comp->>'component_type', 'fabric', 'tech_pack', v_tp.id, v_created_id, 'fabric_orders', v_final_qty, v_wastage, v_comp);
        v_result := jsonb_set(v_result, '{fabrics}', to_jsonb((v_result->>'fabrics')::int + 1));
      END LOOP;
    END IF;

    -- 2. TRIMS (from tech pack)
    IF v_tp.id IS NOT NULL AND jsonb_array_length(COALESCE(v_tp.extracted_trim_specs,'[]'::jsonb)) > 0 THEN
      FOR v_comp IN SELECT jsonb_array_elements(v_tp.extracted_trim_specs) LOOP
        v_qty := COALESCE((v_comp->>'quantity_per_unit')::numeric, 1) * v_item.quantity;
        v_wastage := 5;
        v_final_qty := v_qty * (1 + v_wastage / 100);
        INSERT INTO trim_items (po_id, po_number, article_code, trim_category, item_description, color, size_spec, order_quantity, quantity_required, unit, status, notes)
        VALUES (p_po_id, v_po.po_number, v_item.item_code,
          v_comp->>'trim_type', v_comp->>'description', v_comp->>'color', v_comp->>'size_spec',
          v_item.quantity, v_final_qty, COALESCE(v_comp->>'unit','Pcs'), 'Planned',
          CONCAT('Auto-exploded from techpack ',v_tp.article_code))
        RETURNING id INTO v_created_id;
        INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, wastage_pct, details)
        VALUES (p_po_id, v_po.po_number, v_item.item_code, v_comp->>'trim_type', 'trim', 'tech_pack', v_tp.id, v_created_id, 'trim_items', v_final_qty, v_wastage, v_comp);
        v_result := jsonb_set(v_result, '{trims}', to_jsonb((v_result->>'trims')::int + 1));
      END LOOP;
    END IF;

    -- 3. ACCESSORIES (from tech pack, including labels)
    IF v_tp.id IS NOT NULL THEN
      FOR v_comp IN SELECT jsonb_array_elements(COALESCE(v_tp.extracted_accessory_specs,'[]'::jsonb)) LOOP
        v_qty := COALESCE((v_comp->>'quantity_per_unit')::numeric, 1) * v_item.quantity;
        v_wastage := 3;
        v_final_qty := v_qty * (1 + v_wastage / 100);
        INSERT INTO accessory_items (po_id, po_number, article_code, category, item_description, color, size_spec, quantity_required, unit, status, consumption_per_unit, wastage_percent, notes)
        VALUES (p_po_id, v_po.po_number, v_item.item_code,
          v_comp->>'accessory_type', v_comp->>'description', v_comp->>'color', v_comp->>'size_spec',
          v_final_qty, COALESCE(v_comp->>'unit','Pcs'), 'Planned',
          COALESCE((v_comp->>'quantity_per_unit')::numeric,1), v_wastage,
          CONCAT('Auto-exploded from techpack ',v_tp.article_code))
        RETURNING id INTO v_created_id;
        INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, wastage_pct, details)
        VALUES (p_po_id, v_po.po_number, v_item.item_code, v_comp->>'accessory_type', 'accessory', 'tech_pack', v_tp.id, v_created_id, 'accessory_items', v_final_qty, v_wastage, v_comp);
        v_result := jsonb_set(v_result, '{accessories}', to_jsonb((v_result->>'accessories')::int + 1));
      END LOOP;
      -- Labels as accessories
      FOR v_comp IN SELECT jsonb_array_elements(COALESCE(v_tp.extracted_label_specs,'[]'::jsonb)) LOOP
        v_final_qty := v_item.quantity * 1.03;
        INSERT INTO accessory_items (po_id, po_number, article_code, category, item_description, color, size_spec, quantity_required, unit, status, consumption_per_unit, wastage_percent, notes)
        VALUES (p_po_id, v_po.po_number, v_item.item_code,
          COALESCE(v_comp->>'label_type','Label'), v_comp->>'description', v_comp->>'color', v_comp->>'size_spec',
          v_final_qty, 'Pcs', 'Planned', 1, 3,
          CONCAT('Auto-exploded label from techpack ',v_tp.article_code))
        RETURNING id INTO v_created_id;
        INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, wastage_pct, details)
        VALUES (p_po_id, v_po.po_number, v_item.item_code, COALESCE(v_comp->>'label_type','Label'), 'label', 'tech_pack', v_tp.id, v_created_id, 'accessory_items', v_final_qty, 3, v_comp);
        v_result := jsonb_set(v_result, '{accessories}', to_jsonb((v_result->>'accessories')::int + 1));
      END LOOP;
    END IF;

    -- 4. CARTONS from master
    IF v_master.id IS NOT NULL AND v_master.pieces_per_carton > 0 THEN
      INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, source_id, created_record_id, created_table, quantity_computed, details)
      VALUES (p_po_id, v_po.po_number, v_item.item_code, 'Master Carton', 'carton', 'master_article', v_master.id, v_item.id, 'po_items',
        CEIL(v_item.quantity::numeric / v_master.pieces_per_carton),
        jsonb_build_object('pieces_per_carton',v_master.pieces_per_carton,'cbm_per_carton',v_master.cbm_per_carton,'dims',jsonb_build_object('L',v_master.carton_length,'W',v_master.carton_width,'H',v_master.carton_height)));
      UPDATE po_items SET
        num_cartons = CEIL(v_item.quantity::numeric / v_master.pieces_per_carton),
        pieces_per_carton = COALESCE(pieces_per_carton, v_master.pieces_per_carton),
        carton_length = COALESCE(carton_length, v_master.carton_length),
        carton_width = COALESCE(carton_width, v_master.carton_width),
        carton_height = COALESCE(carton_height, v_master.carton_height),
        cbm = COALESCE(cbm, v_master.cbm_per_carton * CEIL(v_item.quantity::numeric / v_master.pieces_per_carton))
      WHERE id = v_item.id;
      v_result := jsonb_set(v_result, '{cartons}', to_jsonb((v_result->>'cartons')::int + 1));
    END IF;

    -- Log skip if no source
    IF v_master.id IS NULL AND v_tp.id IS NULL THEN
      INSERT INTO bom_explosion_log (po_id, po_number, item_code, component_type, component_category, source, details)
      VALUES (p_po_id, v_po.po_number, v_item.item_code, 'NO_SOURCE', 'skipped', 'skipped_no_source',
        jsonb_build_object('reason','No master article or tech pack found for item_code'));
      v_errors := v_errors || jsonb_build_object('item_code', v_item.item_code, 'reason','No BOM source');
    END IF;
  END LOOP;

  -- Mark PO as exploded
  UPDATE purchase_orders SET
    bom_exploded = true,
    bom_exploded_at = now(),
    bom_explosion_notes = v_result::text
  WHERE id = p_po_id;

  v_result := jsonb_set(v_result, '{errors}', v_errors);
  RETURN v_result;
END;
$$;


--
-- Name: fn_audit_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  uid uuid;
  uemail text;
  changed text[];
  rec_id text;
  k text;
BEGIN
  BEGIN
    uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    uid := NULL;
  END;
  
  IF uid IS NOT NULL THEN
    SELECT email INTO uemail FROM user_profiles WHERE id = uid;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    rec_id := OLD.id::text;
    INSERT INTO audit_log (user_id, user_email, table_name, record_id, action, old_data)
    VALUES (uid, uemail, TG_TABLE_NAME, rec_id, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    rec_id := NEW.id::text;
    INSERT INTO audit_log (user_id, user_email, table_name, record_id, action, new_data)
    VALUES (uid, uemail, TG_TABLE_NAME, rec_id, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    rec_id := NEW.id::text;
    -- Collect changed field names
    changed := ARRAY[]::text[];
    FOR k IN SELECT key FROM jsonb_object_keys(to_jsonb(NEW)) key LOOP
      IF to_jsonb(NEW)->k IS DISTINCT FROM to_jsonb(OLD)->k 
         AND k NOT IN ('updated_at','created_at') THEN
        changed := array_append(changed, k);
      END IF;
    END LOOP;
    
    IF array_length(changed, 1) > 0 THEN
      INSERT INTO audit_log (user_id, user_email, table_name, record_id, action, old_data, new_data, changed_fields)
      VALUES (uid, uemail, TG_TABLE_NAME, rec_id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), changed);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END $$;


--
-- Name: fn_normalize_item_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_normalize_item_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'master_articles' THEN
    NEW.article_code := UPPER(TRIM(NEW.article_code));
  ELSE
    NEW.item_code := UPPER(TRIM(NEW.item_code));
  END IF;
  RETURN NEW;
END $$;


--
-- Name: generate_sample_invoice(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_sample_invoice(p_po_id uuid, p_created_by text DEFAULT 'system'::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_inv_id uuid := gen_random_uuid();
  v_inv_num text;
  v_po_number text;
  v_customer text;
  v_currency text;
  v_subtotal numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  r record;
BEGIN
  SELECT po_number, customer_name INTO v_po_number, v_customer
  FROM purchase_orders WHERE id = p_po_id;
  IF v_po_number IS NULL THEN RAISE EXCEPTION 'PO not found: %', p_po_id; END IF;
  v_inv_num := 'SI-' || v_po_number || '-' || to_char(now(), 'YYMMDD-HH24MISS');
  FOR r IN
    SELECT s.id, s.sample_type, s.style_number, s.article_name, s.billable_quantity,
           s.unit_price, s.total_cost, s.currency, s.round_number
    FROM samples s
    WHERE s.po_id = p_po_id AND s.billable_quantity > 0
      AND s.invoice_status = 'pending' AND s.invoice_id IS NULL
  LOOP
    v_currency := COALESCE(v_currency, r.currency);
    v_subtotal := v_subtotal + COALESCE(r.total_cost, 0);
    v_lines := v_lines || jsonb_build_object(
      'sample_id', r.id, 'sample_type', r.sample_type, 'style', r.style_number,
      'description', r.article_name || ' (' || r.sample_type || ' R' || r.round_number || ')',
      'quantity', r.billable_quantity, 'unit_price', r.unit_price, 'total', r.total_cost);
  END LOOP;
  IF v_subtotal = 0 THEN RETURN NULL; END IF;
  INSERT INTO sample_invoices (id, invoice_number, po_id, po_number, customer_name, currency, line_items, subtotal, total_amount, status, created_by)
  VALUES (v_inv_id, v_inv_num, p_po_id, v_po_number, v_customer, COALESCE(v_currency, 'USD'), v_lines, v_subtotal, v_subtotal, 'Draft', p_created_by);
  UPDATE samples SET invoice_id = v_inv_id, invoice_status = 'invoiced'
    WHERE po_id = p_po_id AND billable_quantity > 0 AND invoice_status = 'pending';
  RETURN v_inv_id;
END;
$$;


--
-- Name: get_buyer_tracker(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_buyer_tracker(p_token uuid) RETURNS TABLE(po_number text, customer_name text, status text, order_date date, delivery_date date, ex_factory_date date, etd date, eta date, season text, total_quantity integer, total_cbm numeric, port_of_loading text, port_of_destination text, ship_via text, country_of_origin text, milestones jsonb, shipments jsonb, progress jsonb)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    po.po_number,
    po.customer_name,
    po.status,
    po.order_date,
    po.delivery_date,
    po.ex_factory_date,
    po.etd,
    po.eta,
    po.season,
    po.total_quantity,
    po.total_cbm,
    po.port_of_loading,
    po.port_of_destination,
    po.ship_via,
    po.country_of_origin,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'milestone_name', m.name,
        'target_date',    m.target_date,
        'actual_date',    m.actual_date,
        'status',         m.status
      ) order by coalesce(m.target_date, m.created_at))
      from tna_milestones m where m.po_id = po.id
    ), '[]'::jsonb) as milestones,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'status',           s.status,
        'etd',              s.etd,
        'eta',              s.eta,
        'bl_number',        s.bl_number,
        'container_number', s.container_number,
        'vessel_name',      s.vessel_name
      ))
      from shipments s where s.po_id = po.id
    ), '[]'::jsonb) as shipments,
    jsonb_build_object(
      'tna_total',     (select count(*) from tna_milestones where po_id = po.id),
      'tna_done',      (select count(*) from tna_milestones where po_id = po.id and status = 'completed'),
      'prod_planned',  coalesce((select sum(planned_qty) from capacity_plans where po_id = po.id), 0),
      'prod_produced', coalesce((select sum(qty_produced) from production_output where po_id = po.id), 0),
      'qc_total',      (select count(*) from qc_inspections where po_id = po.id),
      'qc_passed',     (select count(*) from qc_inspections where po_id = po.id and verdict = 'Pass')
    ) as progress
  from purchase_orders po
  where po.share_token = p_token
    and po.sharing_enabled = true;
$$;


--
-- Name: get_team_for_customer(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_team_for_customer(p_customer text) RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT team_id FROM public.customer_team_assignments
  WHERE customer_name = p_customer AND is_primary = true
  LIMIT 1;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _role text;
  _name text;
BEGIN
  -- Read initial_role from raw_user_meta_data if passed during sign-up
  _role := COALESCE(NEW.raw_user_meta_data->>'initial_role', 'Merchandiser');
  _name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));

  -- Enforce safe default — never grant Owner via self-signup
  IF _role NOT IN ('Manager','Merchandiser','QC Inspector','Viewer','Supplier') THEN
    _role := 'Merchandiser';
  END IF;

  INSERT INTO public.user_profiles (id, email, full_name, role, is_active)
  VALUES (NEW.id, NEW.email, _name, _role, true)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: schedule_qc_inspections(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.schedule_qc_inspections(p_po_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_etd date;
  v_po_number text;
  v_count int := 0;
BEGIN
  SELECT etd, po_number INTO v_etd, v_po_number
  FROM purchase_orders WHERE id = p_po_id;

  IF v_etd IS NULL THEN RETURN 0; END IF;

  -- Internal QA: ETD - 10 days
  IF NOT EXISTS (SELECT 1 FROM qc_inspections WHERE po_id = p_po_id AND inspection_party = 'Internal QA') THEN
    INSERT INTO qc_inspections (po_id, po_number, inspection_type, inspection_party, scheduled_date, inspection_date, booking_status, inspection_company, verdict)
    VALUES (p_po_id, v_po_number, 'In-line', 'Internal QA', v_etd - 10, v_etd - 10, 'Scheduled', 'Internal QA Team', 'Pending');
    v_count := v_count + 1;
  END IF;

  -- 3rd Party: ETD - 7 days
  IF NOT EXISTS (SELECT 1 FROM qc_inspections WHERE po_id = p_po_id AND inspection_party = '3rd Party') THEN
    INSERT INTO qc_inspections (po_id, po_number, inspection_type, inspection_party, scheduled_date, inspection_date, booking_status, inspection_company, aql_level, verdict)
    VALUES (p_po_id, v_po_number, 'Pre-shipment', '3rd Party', v_etd - 7, v_etd - 7, 'Scheduled', 'SGS / Intertek / Bureau Veritas', '2.5', 'Pending');
    v_count := v_count + 1;
  END IF;

  RETURN v_count;
END;
$$;


--
-- Name: seed_job_card_steps(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_job_card_steps() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO job_card_steps (parent_job_card_id, step_number, step_name, status) VALUES
    (NEW.id, 1, 'Yarn Booking', 'Pending'),
    (NEW.id, 2, 'Knitting/Weaving', 'Pending'),
    (NEW.id, 3, 'Dyeing/Finishing', 'Pending'),
    (NEW.id, 4, 'Fabric Inspection', 'Pending'),
    (NEW.id, 5, 'Made-up (Cutting + Stitching + Packing)', 'Pending'),
    (NEW.id, 6, 'Final QC', 'Pending'),
    (NEW.id, 7, 'Ready to Ship', 'Pending');
  RETURN NEW;
END;
$$;


--
-- Name: supersede_old_price(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.supersede_old_price() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.is_active = true and new.effective_from is not null then
    update price_list
      set is_active = false,
          effective_to = new.effective_from - interval '1 day',
          updated_at = now()
    where item_code = new.item_code
      and id <> new.id
      and is_active = true
      and (effective_to is null or effective_to >= new.effective_from);
  end if;
  return new;
end;
$$;


--
-- Name: trg_auto_approve_whitelisted(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_auto_approve_whitelisted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM signup_whitelist WHERE LOWER(email) = LOWER(NEW.email)
  ) THEN
    NEW.approval_status := 'approved';
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END $$;


--
-- Name: trigger_auto_bom(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_auto_bom() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status IN ('PO Received','Items Entered') AND COALESCE(NEW.bom_exploded, false) = false THEN
    BEGIN
      PERFORM explode_po_bom(NEW.id, false);
    EXCEPTION WHEN OTHERS THEN
      NEW.bom_explosion_notes := 'Auto-explosion failed: ' || SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accessory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accessory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    article_name text,
    article_code text,
    category text,
    item_description text,
    color text,
    size_spec text,
    pc_ean_code text,
    carton_ean_code text,
    quantity_required integer DEFAULT 0,
    wastage_percent numeric(5,2) DEFAULT 3,
    multiplier numeric(8,4) DEFAULT 1,
    unit text DEFAULT 'Pcs'::text,
    supplier text,
    unit_cost numeric(10,4),
    total_cost numeric(14,2),
    status text DEFAULT 'Planned'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    consumption_per_unit numeric,
    CONSTRAINT accessory_items_status_check CHECK ((status = ANY (ARRAY['Planned'::text, 'Ordered'::text, 'In Transit'::text, 'Received'::text, 'Rejected'::text])))
);


--
-- Name: accessory_purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accessory_purchase_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    apo_number text NOT NULL,
    po_ref text,
    po_id uuid,
    supplier text NOT NULL,
    order_date date,
    expected_delivery date,
    status text DEFAULT 'Draft'::text,
    items jsonb DEFAULT '[]'::jsonb,
    total_cost numeric(14,2),
    currency text DEFAULT 'USD'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT accessory_purchase_orders_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Confirmed'::text, 'In Transit'::text, 'Received'::text, 'Cancelled'::text])))
);


--
-- Name: accessory_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accessory_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_name text NOT NULL,
    category text NOT NULL,
    type text NOT NULL,
    description text,
    size_spec text,
    default_wastage numeric DEFAULT 5,
    default_multiplier numeric DEFAULT 1,
    unit text DEFAULT 'Pcs'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_number text NOT NULL,
    pi_number text,
    pi_date date,
    customer_name text NOT NULL,
    supplier_id uuid,
    ship_to_name text,
    ship_to_address text,
    order_date date,
    delivery_date date,
    ex_factory_date date,
    etd date,
    eta date,
    currency text DEFAULT 'USD'::text,
    total_po_value numeric(14,2),
    total_quantity integer,
    total_cbm numeric(10,4),
    status text DEFAULT 'PO Received'::text,
    payment_terms text,
    port_of_loading text,
    port_of_destination text,
    season text,
    source text DEFAULT 'Manual'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ship_via text DEFAULT 'Container Direct'::text,
    buyer_address text,
    sales_order_number text,
    country_of_origin text DEFAULT 'Pakistan'::text,
    approval_status text DEFAULT 'not_submitted'::text NOT NULL,
    approval_requested_by text,
    approval_requested_at timestamp with time zone,
    approved_by text,
    approved_at timestamp with time zone,
    approval_notes text,
    total_cartons integer,
    buyer_name text,
    buyer_company text,
    buyer_contact text,
    consignee_name text,
    consignee_address text,
    consignee_city text,
    consignee_country text,
    dims_source text DEFAULT 'manual'::text,
    consignee_contact text,
    supersedes_po_id uuid,
    is_revision boolean DEFAULT false,
    revision_number integer DEFAULT 0,
    revision_notes text,
    revision_detected_from text,
    bom_exploded boolean DEFAULT false,
    bom_exploded_at timestamp with time zone,
    bom_explosion_notes text,
    assigned_to text,
    tags text[] DEFAULT '{}'::text[],
    payment_structure text,
    lc_type text,
    lc_number text,
    lc_bank text,
    lc_tenor_days integer,
    lc_expiry date,
    lc_latest_shipment_date date,
    lc_presentation_days integer,
    tt_terms text,
    share_token uuid,
    sharing_enabled boolean DEFAULT false,
    shared_at timestamp with time zone,
    CONSTRAINT purchase_orders_approval_status_check CHECK ((approval_status = ANY (ARRAY['not_submitted'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'changes_requested'::text]))),
    CONSTRAINT purchase_orders_currency_check CHECK ((currency = ANY (ARRAY['USD'::text, 'EUR'::text, 'GBP'::text, 'INR'::text, 'CNY'::text, 'PKR'::text, 'BDT'::text]))),
    CONSTRAINT purchase_orders_dims_source_check CHECK ((dims_source = ANY (ARRAY['master'::text, 'manual'::text]))),
    CONSTRAINT purchase_orders_source_check CHECK ((source = ANY (ARRAY['Email'::text, 'WhatsApp'::text, 'PDF'::text, 'Manual'::text, 'Portal'::text, 'Phone'::text, 'Other'::text]))),
    CONSTRAINT purchase_orders_status_check CHECK ((status = ANY (ARRAY['PO Received'::text, 'Items Entered'::text, 'Price Verification'::text, 'Price Approved'::text, 'CBM Calculated'::text, 'FWS Prepared'::text, 'Yarn Planned'::text, 'Accessories Planned'::text, 'Packaging Planned'::text, 'In Production'::text, 'QC Inspection'::text, 'Ready to Ship'::text, 'Shipped'::text, 'At Port'::text, 'Delivered'::text, 'Cancelled'::text])))
);


--
-- Name: COLUMN purchase_orders.customer_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.customer_name IS 'Buyer name (party issuing the PO)';


--
-- Name: COLUMN purchase_orders.ship_to_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.ship_to_name IS 'Consignee name (party receiving goods)';


--
-- Name: COLUMN purchase_orders.ship_to_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.ship_to_address IS 'Consignee address';


--
-- Name: COLUMN purchase_orders.buyer_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.buyer_address IS 'Buyer address';


--
-- Name: COLUMN purchase_orders.buyer_contact; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.buyer_contact IS 'Buyer contact person / email / phone';


--
-- Name: COLUMN purchase_orders.consignee_country; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.consignee_country IS 'Consignee country (for customs)';


--
-- Name: COLUMN purchase_orders.consignee_contact; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.consignee_contact IS 'Consignee contact person / email / phone';


--
-- Name: COLUMN purchase_orders.supersedes_po_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.supersedes_po_id IS 'Points to the previous PO that this one supersedes/revises';


--
-- Name: COLUMN purchase_orders.is_revision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.is_revision IS 'True when this PO is a revision of an earlier one';


--
-- Name: COLUMN purchase_orders.revision_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.revision_number IS 'Incremented from predecessor (0 = original, 1 = first revision, etc.)';


--
-- Name: COLUMN purchase_orders.revision_detected_from; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.revision_detected_from IS 'How the revision link was established';


--
-- Name: active_purchase_orders; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.active_purchase_orders AS
 SELECT id,
    po_number,
    pi_number,
    pi_date,
    customer_name,
    supplier_id,
    ship_to_name,
    ship_to_address,
    order_date,
    delivery_date,
    ex_factory_date,
    etd,
    eta,
    currency,
    total_po_value,
    total_quantity,
    total_cbm,
    status,
    payment_terms,
    port_of_loading,
    port_of_destination,
    season,
    source,
    notes,
    created_at,
    updated_at,
    ship_via,
    buyer_address,
    sales_order_number,
    country_of_origin,
    approval_status,
    approval_requested_by,
    approval_requested_at,
    approved_by,
    approved_at,
    approval_notes,
    total_cartons,
    buyer_name,
    buyer_company,
    buyer_contact,
    consignee_name,
    consignee_address,
    consignee_city,
    consignee_country,
    dims_source,
    consignee_contact,
    supersedes_po_id,
    is_revision,
    revision_number,
    revision_notes,
    revision_detected_from
   FROM public.purchase_orders po
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.purchase_orders newer
          WHERE (newer.supersedes_po_id = po.id))));


--
-- Name: app_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    full_name text,
    role text DEFAULT 'Viewer'::text,
    supplier_id uuid,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT app_users_role_check CHECK ((role = ANY (ARRAY['Admin'::text, 'Merchandiser'::text, 'Supplier'::text, 'QC Inspector'::text, 'Viewer'::text])))
);


--
-- Name: article_packaging; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_packaging (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    article_code text NOT NULL,
    article_name text,
    customer_name text,
    labels jsonb DEFAULT '[]'::jsonb,
    polybag jsonb DEFAULT '{}'::jsonb,
    stiffener jsonb DEFAULT '{}'::jsonb,
    carton jsonb DEFAULT '{}'::jsonb,
    stickers jsonb DEFAULT '[]'::jsonb,
    other_accessories jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.articles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    article_name text NOT NULL,
    article_code text,
    color text,
    size_label text,
    order_quantity integer DEFAULT 0,
    components jsonb DEFAULT '[]'::jsonb,
    total_fabric_required numeric(10,4) DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tech_pack_id uuid,
    po_item_id uuid,
    is_locked boolean DEFAULT false NOT NULL,
    unit_price numeric(12,4),
    pieces_per_carton integer,
    carton_length numeric(8,2),
    carton_width numeric(8,2),
    carton_height numeric(8,2),
    program_code text,
    net_weight_per_pc numeric(8,4),
    gross_weight_per_pc numeric(8,4),
    dims_locked_from_master boolean DEFAULT false,
    master_article_id uuid,
    size_breakdown jsonb DEFAULT '{}'::jsonb,
    size_labels text[] DEFAULT ARRAY[]::text[],
    product_length_in numeric,
    product_width_in numeric,
    product_depth_in numeric,
    finish_dimensions text,
    product_category text,
    size text,
    product_dimensions text
);


--
-- Name: COLUMN articles.product_dimensions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.articles.product_dimensions IS 'Garment/finished-product dimensions. Optional manual override.';


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    user_email text,
    table_name text NOT NULL,
    record_id text,
    action text NOT NULL,
    old_data jsonb,
    new_data jsonb,
    changed_fields text[],
    created_at timestamp with time zone DEFAULT now(),
    session_id text,
    ip_address inet,
    user_agent text,
    CONSTRAINT audit_log_action_check CHECK ((action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: batch_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batch_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    po_item_id uuid NOT NULL,
    po_id uuid,
    item_code text,
    item_description text,
    batch_quantity integer DEFAULT 0 NOT NULL,
    size_breakdown jsonb,
    unit_price numeric(10,4),
    total_price numeric(14,2),
    cbm numeric(10,4),
    cartons integer,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: batch_split_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batch_split_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    snapshot_date timestamp with time zone DEFAULT now(),
    po_status_at_split text,
    items_snapshot jsonb DEFAULT '[]'::jsonb,
    tna_snapshot jsonb DEFAULT '[]'::jsonb,
    notes text
);


--
-- Name: bom_explosion_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bom_explosion_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    item_code text,
    component_type text,
    component_category text,
    source text,
    source_id uuid,
    created_record_id uuid,
    created_table text,
    quantity_computed numeric,
    wastage_pct numeric,
    details jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bom_explosion_log_source_check CHECK ((source = ANY (ARRAY['master_article'::text, 'tech_pack'::text, 'manual'::text, 'skipped_no_source'::text])))
);


--
-- Name: buyer_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buyer_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_name text NOT NULL,
    full_name text NOT NULL,
    title text,
    department text,
    email text,
    phone text,
    whatsapp text,
    country text,
    city text,
    is_primary boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: capacity_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capacity_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    article_id uuid,
    article_code text,
    line_id uuid,
    stage_id uuid,
    planned_qty integer DEFAULT 0 NOT NULL,
    start_date date,
    end_date date,
    priority integer DEFAULT 3,
    status text DEFAULT 'planned'::text NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: commercial_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commercial_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid NOT NULL,
    batch_id uuid,
    po_number text,
    ci_number text NOT NULL,
    ci_date date DEFAULT CURRENT_DATE,
    customer_name text,
    consignee_name text,
    consignee_address text,
    notify_party text,
    shipment_id uuid,
    bl_number text,
    vessel_name text,
    port_of_loading text,
    port_of_destination text,
    etd date,
    eta date,
    currency text DEFAULT 'USD'::text,
    subtotal numeric(14,2) DEFAULT 0,
    freight_charge numeric(14,2) DEFAULT 0,
    insurance_charge numeric(14,2) DEFAULT 0,
    other_charges numeric(14,2) DEFAULT 0,
    total_amount numeric(14,2) DEFAULT 0,
    payment_terms text,
    incoterms text,
    total_quantity integer DEFAULT 0,
    total_cartons integer DEFAULT 0,
    total_net_weight numeric(10,2),
    total_gross_weight numeric(10,2),
    total_cbm numeric(10,4),
    line_items jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'Draft'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT commercial_invoices_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Issued'::text, 'Accepted'::text, 'Disputed'::text, 'Paid'::text])))
);


--
-- Name: comms_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comms_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text,
    entity_id uuid,
    po_id uuid,
    customer_name text,
    channel text,
    direction text,
    contact_name text,
    summary text NOT NULL,
    full_content text,
    logged_by text,
    comm_date timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT comms_log_channel_check CHECK ((channel = ANY (ARRAY['Email'::text, 'WhatsApp'::text, 'Phone'::text, 'Meeting'::text, 'Video Call'::text, 'Other'::text]))),
    CONSTRAINT comms_log_direction_check CHECK ((direction = ANY (ARRAY['Inbound'::text, 'Outbound'::text]))),
    CONSTRAINT comms_log_entity_type_check CHECK ((entity_type = ANY (ARRAY['po'::text, 'rfq'::text, 'complaint'::text, 'supplier'::text, 'general'::text])))
);


--
-- Name: complaints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    complaint_number text NOT NULL,
    customer_name text NOT NULL,
    contact_id uuid,
    po_id uuid,
    po_number text,
    shipment_ref text,
    received_date date DEFAULT CURRENT_DATE,
    category text,
    severity text DEFAULT 'Medium'::text,
    status text DEFAULT 'Open'::text,
    description text NOT NULL,
    quantity_affected integer,
    value_at_risk numeric(14,2),
    currency text DEFAULT 'USD'::text,
    photo_urls jsonb DEFAULT '[]'::jsonb,
    root_cause text,
    corrective_action text,
    preventive_action text,
    credit_note_amount numeric(14,2),
    replacement_quantity integer,
    resolution_date date,
    resolved_by text,
    acknowledged_at timestamp with time zone,
    target_resolution_date date,
    supplier_id uuid,
    supplier_notified boolean DEFAULT false,
    supplier_response text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT complaints_category_check CHECK ((category = ANY (ARRAY['Quality – Fabric'::text, 'Quality – Stitching'::text, 'Quality – Measurement'::text, 'Quality – Color'::text, 'Quality – Finishing'::text, 'Quality – Packing'::text, 'Delay – Production'::text, 'Delay – Shipment'::text, 'Delay – Documentation'::text, 'Short Shipment'::text, 'Wrong Style'::text, 'Wrong Color'::text, 'Wrong Size Mix'::text, 'Documentation Error'::text, 'Price Discrepancy'::text, 'Other'::text]))),
    CONSTRAINT complaints_severity_check CHECK ((severity = ANY (ARRAY['Critical'::text, 'High'::text, 'Medium'::text, 'Low'::text]))),
    CONSTRAINT complaints_status_check CHECK ((status = ANY (ARRAY['Open'::text, 'Acknowledged'::text, 'Under Investigation'::text, 'Resolved'::text, 'Closed'::text, 'Escalated'::text])))
);


--
-- Name: compliance_docs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_docs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    article_code text,
    doc_type text,
    doc_number text,
    issued_by text,
    issue_date date,
    expiry_date date,
    status text DEFAULT 'Pending'::text,
    file_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    po_number text,
    CONSTRAINT compliance_docs_doc_type_check CHECK ((doc_type = ANY (ARRAY['OEKO-TEX'::text, 'REACH'::text, 'Test Report'::text, 'Wash Care Approval'::text, 'Certificate of Origin'::text, 'Factory Audit'::text, 'ISO Cert'::text, 'Other'::text]))),
    CONSTRAINT compliance_docs_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Received'::text, 'Valid'::text, 'Expired'::text, 'Rejected'::text])))
);


--
-- Name: consumption_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumption_library (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_code text NOT NULL,
    size text,
    kind text NOT NULL,
    component_type text,
    fabric_type text,
    gsm integer,
    construction text,
    treatment text,
    color text,
    material text,
    size_spec text,
    placement text,
    width_cm numeric(8,2),
    consumption_per_unit numeric(10,4),
    wastage_percent numeric(6,2) DEFAULT 0,
    supplier text,
    tech_pack_id uuid,
    tech_pack_code text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    unit text DEFAULT 'meters'::text,
    CONSTRAINT consumption_library_kind_check CHECK ((kind = ANY (ARRAY['fabric'::text, 'accessory'::text])))
);


--
-- Name: costing_sheets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.costing_sheets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    article_code text,
    article_name text,
    order_quantity integer DEFAULT 0,
    buyer_price numeric(10,4) DEFAULT 0,
    currency text DEFAULT 'USD'::text,
    fabric_cost numeric(10,4) DEFAULT 0,
    trim_cost numeric(10,4) DEFAULT 0,
    accessory_cost numeric(10,4) DEFAULT 0,
    embellishment_cost numeric(10,4) DEFAULT 0,
    cm_cost numeric(10,4) DEFAULT 0,
    washing_cost numeric(10,4) DEFAULT 0,
    overhead_pct numeric(5,2) DEFAULT 8,
    freight_cost numeric(10,4) DEFAULT 0,
    agent_commission_pct numeric(5,2) DEFAULT 5,
    total_cogs numeric(10,4) DEFAULT 0,
    gross_margin numeric(10,4) DEFAULT 0,
    gross_margin_pct numeric(5,2) DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_locked boolean DEFAULT false NOT NULL
);


--
-- Name: crosscheck_discrepancies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crosscheck_discrepancies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tech_pack_id uuid NOT NULL,
    po_id uuid,
    article_code text,
    check_type text,
    field_name text,
    techpack_value text,
    working_value text,
    severity text DEFAULT 'warning'::text,
    status text DEFAULT 'open'::text,
    resolution_notes text,
    resolved_by text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT crosscheck_discrepancies_check_type_check CHECK ((check_type = ANY (ARRAY['fabric'::text, 'trim'::text, 'accessory'::text, 'measurement'::text, 'construction'::text, 'label'::text, 'other'::text]))),
    CONSTRAINT crosscheck_discrepancies_severity_check CHECK ((severity = ANY (ARRAY['critical'::text, 'warning'::text, 'info'::text]))),
    CONSTRAINT crosscheck_discrepancies_status_check CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'resolved'::text, 'overridden'::text])))
);


--
-- Name: customer_team_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_team_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    customer_name text NOT NULL,
    is_primary boolean DEFAULT false,
    season text,
    notes text,
    assigned_at timestamp with time zone DEFAULT now(),
    assigned_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_crawl; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_crawl (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gmail_message_id text,
    gmail_thread_id text,
    subject text,
    sender text,
    received_at timestamp with time zone,
    classification text,
    confidence numeric,
    extracted_po_number text,
    extracted_customer text,
    extracted_value numeric,
    extracted_currency text,
    extracted_delivery_date date,
    extracted_quantity integer,
    raw_snippet text,
    po_created boolean DEFAULT false,
    po_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    extracted_pos jsonb,
    po_created_keys text[],
    attachment_count integer DEFAULT 0,
    has_revision_keywords boolean DEFAULT false,
    revision_keywords_found text[],
    referenced_po_numbers text[],
    updates jsonb DEFAULT '[]'::jsonb
);


--
-- Name: COLUMN email_crawl.extracted_pos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_crawl.extracted_pos IS 'Array of extracted PO header objects. Each element can be imported as a separate PO.';


--
-- Name: COLUMN email_crawl.po_created_keys; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_crawl.po_created_keys IS 'Which extracted_pos entries have already been imported (format: emailId-index)';


--
-- Name: COLUMN email_crawl.has_revision_keywords; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_crawl.has_revision_keywords IS 'True if email body contained revision keywords';


--
-- Name: COLUMN email_crawl.referenced_po_numbers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_crawl.referenced_po_numbers IS 'PO numbers mentioned anywhere in email';


--
-- Name: COLUMN email_crawl.updates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_crawl.updates IS 'AI-extracted update proposals: samples, trims, layouts, inspections, TNA milestones';


--
-- Name: email_crawl_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_crawl_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gmail_message_id text,
    gmail_thread_id text,
    subject text,
    sender text,
    received_at timestamp with time zone,
    classification text,
    confidence numeric(4,2),
    extracted_po_number text,
    extracted_customer text,
    extracted_value numeric(14,2),
    extracted_currency text,
    extracted_delivery_date date,
    extracted_quantity integer,
    po_created boolean DEFAULT false,
    po_id uuid,
    raw_snippet text,
    processed_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    attachment_count integer DEFAULT 0,
    body_preview text,
    extracted_pos jsonb DEFAULT '[]'::jsonb,
    has_revision_keywords boolean DEFAULT false,
    updates jsonb DEFAULT '[]'::jsonb,
    error_message text,
    referenced_po_numbers text[] DEFAULT '{}'::text[],
    extraction_reasoning text,
    classification_reasoning text,
    gmail_label_ids text[],
    revision_reason text,
    revision_keywords_found text[],
    po_created_keys text[] DEFAULT '{}'::text[],
    CONSTRAINT email_crawl_log_classification_check CHECK ((classification = ANY (ARRAY['purchase_order'::text, 'invoice'::text, 'shipping'::text, 'general'::text, 'spam'::text, 'unknown'::text])))
);


--
-- Name: fabric_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fabric_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    fabric_order_number text,
    mill_name text,
    mill_contact text,
    fabric_type text,
    quality_spec text,
    gsm numeric(8,2),
    width_cm numeric(8,2),
    color text,
    quantity_meters numeric(12,2) NOT NULL,
    unit_price numeric(10,4),
    currency text DEFAULT 'USD'::text,
    total_cost numeric(14,2),
    order_date date,
    expected_delivery date,
    actual_delivery date,
    received_meters numeric(12,2),
    status text DEFAULT 'Pending'::text,
    shortfall_meters numeric(12,2),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT fabric_orders_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Confirmed'::text, 'Weaving'::text, 'Dyeing/Processing'::text, 'Dispatched'::text, 'Received'::text, 'Shortfall'::text, 'Cancelled'::text])))
);


--
-- Name: COLUMN fabric_orders.mill_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fabric_orders.mill_name IS 'Mill/supplier name. Nullable to allow fabric orders generated from yarn requirements before a mill is assigned.';


--
-- Name: fabric_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fabric_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    article_code text NOT NULL,
    article_name text,
    components jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    customer text,
    program_code text,
    article_type text,
    size text,
    price_usd numeric,
    qty_per_carton integer,
    cbm_per_carton numeric,
    pieces_per_carton integer
);


--
-- Name: gcal_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gcal_sync_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    tna_milestone_id uuid,
    gcal_event_id text,
    last_synced_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'synced'::text,
    CONSTRAINT gcal_sync_log_status_check CHECK ((status = ANY (ARRAY['synced'::text, 'failed'::text, 'pending'::text])))
);


--
-- Name: gmail_oauth; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gmail_oauth (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text NOT NULL,
    refresh_token text NOT NULL,
    access_token text,
    token_expires_at timestamp with time zone,
    scope text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_crawl_at timestamp with time zone,
    last_crawl_status text
);


--
-- Name: job_card_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_card_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_job_card_id uuid,
    step_number integer NOT NULL,
    step_name text NOT NULL,
    card_number text,
    assigned_to text,
    quantity_issued numeric,
    quantity_received numeric,
    start_date date,
    end_date date,
    status text DEFAULT 'Pending'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT job_card_steps_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'In Progress'::text, 'Completed'::text, 'On Hold'::text, 'Cancelled'::text])))
);


--
-- Name: job_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    job_card_number text,
    article_name text,
    article_code text,
    assigned_to text,
    start_date date,
    due_date date,
    quantity integer,
    process text,
    status text DEFAULT 'Pending'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    process_steps jsonb DEFAULT '[]'::jsonb,
    fabric_details text,
    yarn_details text,
    batch_id uuid,
    CONSTRAINT job_cards_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'In Progress'::text, 'QC Hold'::text, 'Completed'::text, 'Cancelled'::text])))
);


--
-- Name: lab_dips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lab_dips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    article_code text,
    article_name text,
    type text DEFAULT 'Lab Dip'::text,
    shade_name text,
    shade_number text,
    round_number integer DEFAULT 1,
    submission_date date,
    expected_response_date date,
    buyer_response_date date,
    status text DEFAULT 'Submitted'::text,
    buyer_comments text,
    internal_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    batch_id uuid,
    manager_approved_by uuid,
    manager_approved_at timestamp with time zone,
    manager_approval_notes text,
    CONSTRAINT lab_dips_status_check CHECK ((status = ANY (ARRAY['Not Submitted'::text, 'Submitted'::text, 'Approved'::text, 'Rejected'::text, 'Resubmit'::text, 'On Hold'::text]))),
    CONSTRAINT lab_dips_type_check CHECK ((type = ANY (ARRAY['Lab Dip'::text, 'Strike-off'::text, 'Embroidery'::text, 'Print'::text, 'Woven Label'::text, 'Other'::text])))
);


--
-- Name: master_article_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_article_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    article_code text NOT NULL,
    article_id uuid,
    changed_by text,
    change_type text,
    old_values jsonb,
    new_values jsonb,
    propagation_requested_at timestamp with time zone,
    propagation_date_from date,
    propagation_date_to date,
    propagation_completed_at timestamp with time zone,
    propagation_pos_updated integer DEFAULT 0,
    propagation_status text DEFAULT 'pending'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT master_article_changes_change_type_check CHECK ((change_type = ANY (ARRAY['price'::text, 'carton_dims'::text, 'fabric'::text, 'weight'::text, 'all'::text, 'create'::text]))),
    CONSTRAINT master_article_changes_propagation_status_check CHECK ((propagation_status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'skipped'::text])))
);


--
-- Name: master_articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_articles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    article_code text NOT NULL,
    article_name text,
    customer_name text,
    program_code text,
    article_type text,
    price_usd numeric,
    currency text DEFAULT 'USD'::text,
    pieces_per_carton integer,
    carton_length numeric,
    carton_width numeric,
    carton_height numeric,
    net_weight_per_pc numeric,
    gross_weight_per_pc numeric,
    fabric_components jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true,
    version integer DEFAULT 1,
    last_updated_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cbm_per_carton numeric
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    title text NOT NULL,
    message text,
    type text DEFAULT 'info'::text,
    category text,
    entity_type text,
    entity_id uuid,
    link_page text,
    link_params text,
    is_read boolean DEFAULT false,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text, 'success'::text])))
);


--
-- Name: packing_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.packing_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    shipment_id uuid,
    pl_number text,
    total_cartons integer DEFAULT 0,
    total_net_weight numeric(10,2),
    total_gross_weight numeric(10,2),
    total_cbm numeric(10,4),
    carton_details jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    batch_id uuid,
    ci_id uuid
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    payment_type text,
    lc_number text,
    lc_bank text,
    lc_expiry date,
    amount numeric(14,2),
    currency text DEFAULT 'USD'::text,
    expected_date date,
    actual_date date,
    status text DEFAULT 'Pending'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    batch_id uuid,
    ci_id uuid,
    milestone text,
    percent numeric,
    trigger_event text,
    trigger_date date,
    lc_type text,
    lc_tenor_days integer,
    lc_issuing_bank text,
    lc_advising_bank text,
    lc_latest_shipment_date date,
    lc_presentation_days integer,
    lc_partial_shipment boolean DEFAULT false,
    lc_transhipment boolean DEFAULT false,
    CONSTRAINT payments_payment_type_check CHECK ((payment_type = ANY (ARRAY['Advance'::text, 'Against Documents'::text, 'Balance'::text, 'LC Payment'::text, 'LC'::text, 'TT'::text, 'Other'::text]))),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Received'::text, 'Overdue'::text, 'Partial'::text, 'Disputed'::text])))
);


--
-- Name: permission_denials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_denials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    user_email text,
    user_role text,
    action text,
    resource text,
    denied_at timestamp with time zone DEFAULT now()
);


--
-- Name: po_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.po_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid NOT NULL,
    po_number text,
    batch_number text NOT NULL,
    batch_sequence integer DEFAULT 1 NOT NULL,
    split_reason text,
    ex_factory_date date,
    etd date,
    eta date,
    delivery_date date,
    total_quantity integer DEFAULT 0,
    total_value numeric(14,2) DEFAULT 0,
    total_cbm numeric(10,4),
    total_cartons integer,
    currency text DEFAULT 'USD'::text,
    status text DEFAULT 'Planned'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    split_at_status text,
    split_date timestamp with time zone DEFAULT now(),
    split_initiated_by text,
    is_mid_execution boolean DEFAULT false,
    parent_batch_id uuid,
    tna_status text DEFAULT 'Not Started'::text,
    lab_dip_status text,
    sample_status text,
    production_notes text,
    delay_reason text,
    revised_ex_factory_date date,
    original_ex_factory_date date,
    CONSTRAINT po_batches_split_reason_check CHECK ((split_reason = ANY (ARRAY['Customer Defined'::text, 'Delay'::text, 'Urgency'::text, 'Production Batch'::text, 'LC Amendment'::text, 'Other'::text]))),
    CONSTRAINT po_batches_status_check CHECK ((status = ANY (ARRAY['Planned'::text, 'In Production'::text, 'QC Inspection'::text, 'Ready to Ship'::text, 'Shipped'::text, 'At Port'::text, 'Delivered'::text, 'Cancelled'::text])))
);


--
-- Name: po_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.po_change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    change_type text,
    field_name text,
    old_value text,
    new_value text,
    reason text,
    requested_by text,
    authorised_by text,
    status text DEFAULT 'Pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT po_change_log_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Approved'::text, 'Rejected'::text])))
);


--
-- Name: po_item_sizes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.po_item_sizes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_item_id uuid NOT NULL,
    po_id uuid,
    size_label text NOT NULL,
    size_order integer DEFAULT 0,
    quantity integer DEFAULT 0 NOT NULL,
    color text,
    packing_ratio integer DEFAULT 1,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: po_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.po_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid NOT NULL,
    po_number text,
    item_code text,
    item_description text,
    style_sku text,
    fabric_type text,
    gsm numeric(8,2),
    width numeric(8,2),
    fabric_construction text,
    finish text,
    color text,
    size_breakdown jsonb,
    quantity integer DEFAULT 0,
    unit text DEFAULT 'Pieces'::text,
    unit_price numeric(10,4) DEFAULT 0,
    total_price numeric(14,2) DEFAULT 0,
    expected_price numeric(10,4),
    price_status text DEFAULT 'Pending'::text,
    pieces_per_carton integer,
    num_cartons integer,
    carton_length numeric(8,2),
    carton_width numeric(8,2),
    carton_height numeric(8,2),
    cbm numeric(10,4),
    delivery_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    shrinkage text,
    packing_method text DEFAULT 'Carton'::text,
    is_locked boolean DEFAULT false NOT NULL,
    file_url text,
    file_name text,
    file_type text,
    file_size_kb integer,
    file_uploaded_at timestamp with time zone,
    file_uploaded_by text,
    dims_locked_from_master boolean DEFAULT false,
    master_article_id uuid,
    size_labels text[] DEFAULT ARRAY[]::text[],
    CONSTRAINT po_items_price_status_check CHECK ((price_status = ANY (ARRAY['Pending'::text, 'Matched'::text, 'Mismatch'::text, 'Approved'::text])))
);


--
-- Name: price_list; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_list (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_code text NOT NULL,
    description text,
    price_usd numeric(10,4),
    cbm_per_carton numeric(10,6),
    qty_per_carton integer,
    currency text DEFAULT 'USD'::text,
    effective_from date,
    effective_to date,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    carton_length numeric(8,2),
    carton_width numeric(8,2),
    carton_height numeric(8,2),
    is_active boolean DEFAULT true,
    pricing_status public.pricing_status_t DEFAULT 'active'::public.pricing_status_t NOT NULL
);


--
-- Name: print_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.print_layouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    customer_name text,
    article_code text,
    article_name text,
    accessory_item_id uuid,
    layout_type text,
    layout_description text,
    version text DEFAULT 'v1'::text,
    revision_number integer DEFAULT 1,
    file_url text,
    file_name text,
    thumbnail_url text,
    approval_source text DEFAULT 'manual'::text,
    email_message_id text,
    email_thread_id text,
    email_subject text,
    email_sender text,
    email_date timestamp with time zone,
    email_approval_text text,
    approval_status text DEFAULT 'Approved'::text,
    approved_by text,
    approved_date date,
    colours jsonb DEFAULT '[]'::jsonb,
    dimensions text,
    material text,
    print_method text,
    placement_notes text,
    linked_to_accessory boolean DEFAULT false,
    crosscheck_notes text,
    notes text,
    uploaded_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT print_layouts_approval_source_check CHECK ((approval_source = ANY (ARRAY['email'::text, 'manual'::text, 'portal'::text]))),
    CONSTRAINT print_layouts_approval_status_check CHECK ((approval_status = ANY (ARRAY['Draft'::text, 'Sent for Approval'::text, 'Approved'::text, 'Rejected'::text, 'Revision Required'::text]))),
    CONSTRAINT print_layouts_layout_type_check CHECK ((layout_type = ANY (ARRAY['Brand Label'::text, 'Care Label'::text, 'Size Label'::text, 'Direction Label'::text, 'Hang Tag'::text, 'Barcode Label'::text, 'GOTS Label'::text, 'Compliance Label'::text, 'Country of Origin Label'::text, 'Composition Label'::text, 'Wash Label'::text, 'Price Ticket'::text, 'Retailer Label'::text, 'Eco Label'::text, 'Polybag Sticker'::text, 'Carton Sticker'::text, 'UPC Sticker'::text, 'QR Code Sticker'::text, 'Insert Card'::text, 'Swing Tag'::text, 'Woven Label'::text, 'Other'::text])))
);


--
-- Name: production_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    line_type text DEFAULT 'stitching'::text NOT NULL,
    daily_capacity integer DEFAULT 0 NOT NULL,
    operator_count integer DEFAULT 0,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: production_output; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_output (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    output_date date NOT NULL,
    po_id uuid,
    po_number text,
    article_code text,
    line_id uuid,
    line_name text,
    stage_id uuid,
    stage_name text,
    qty_produced integer DEFAULT 0 NOT NULL,
    qty_rejected integer DEFAULT 0,
    operators_present integer DEFAULT 0,
    hours_worked numeric(5,2) DEFAULT 0,
    efficiency_pct numeric(5,2),
    notes text,
    entered_by uuid,
    entered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: production_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    stage_order integer NOT NULL,
    default_line_type text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: qc_inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qc_inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    inspection_type text,
    inspection_date date,
    inspector_name text,
    inspection_company text,
    aql_level text DEFAULT '2.5'::text,
    sample_size integer,
    qty_offered integer,
    qty_passed integer,
    critical_defects integer DEFAULT 0,
    major_defects integer DEFAULT 0,
    minor_defects integer DEFAULT 0,
    verdict text,
    report_url text,
    re_inspection_required boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    batch_id uuid,
    inspection_party text,
    booking_status text DEFAULT 'Scheduled'::text,
    scheduled_date date,
    booking_reference text,
    linked_milestone_id uuid,
    CONSTRAINT qc_inspections_booking_status_check CHECK ((booking_status = ANY (ARRAY['Scheduled'::text, 'Booked'::text, 'Confirmed'::text, 'In Progress'::text, 'Completed'::text, 'Cancelled'::text, 'Rescheduled'::text]))),
    CONSTRAINT qc_inspections_inspection_party_check CHECK ((inspection_party = ANY (ARRAY['Internal QA'::text, '3rd Party'::text]))),
    CONSTRAINT qc_inspections_inspection_type_check CHECK ((inspection_type = ANY (ARRAY['In-line'::text, 'Final'::text, 'Pre-shipment'::text, 'Third-party'::text, 'AQL'::text, 'Factory Audit'::text]))),
    CONSTRAINT qc_inspections_verdict_check CHECK ((verdict = ANY (ARRAY['Pass'::text, 'Fail'::text, 'Conditional Pass'::text, 'Pending'::text])))
);


--
-- Name: quotation_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotation_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quotation_id uuid NOT NULL,
    article_code text,
    article_description text,
    fabric_description text,
    quantity integer DEFAULT 0,
    unit_fob numeric(10,4) DEFAULT 0,
    total_fob numeric(10,4) DEFAULT 0,
    lead_time_days integer,
    notes text
);


--
-- Name: quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quote_number text NOT NULL,
    rfq_id uuid,
    customer_name text NOT NULL,
    contact_id uuid,
    quote_date date DEFAULT CURRENT_DATE,
    valid_until date,
    status text DEFAULT 'Draft'::text,
    product_description text,
    article_code text,
    quantity integer,
    currency text DEFAULT 'USD'::text,
    fabric_cost numeric(10,4) DEFAULT 0,
    trim_cost numeric(10,4) DEFAULT 0,
    accessory_cost numeric(10,4) DEFAULT 0,
    cm_cost numeric(10,4) DEFAULT 0,
    overhead_cost numeric(10,4) DEFAULT 0,
    freight_cost numeric(10,4) DEFAULT 0,
    commission_pct numeric(5,2) DEFAULT 0,
    total_fob numeric(10,4) DEFAULT 0,
    quoted_price numeric(10,4) DEFAULT 0,
    margin_pct numeric(5,2) DEFAULT 0,
    revision_number integer DEFAULT 1,
    previous_quote_id uuid,
    revision_reason text,
    lead_time_days integer,
    ex_factory_date date,
    delivery_terms text,
    buyer_counter_price numeric(10,4),
    negotiation_notes text,
    rejection_reason text,
    converted_to_po_id uuid,
    quote_file_url text,
    quote_file_name text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT quotations_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Sent'::text, 'Under Negotiation'::text, 'Accepted'::text, 'Rejected'::text, 'Revised'::text, 'Expired'::text])))
);


--
-- Name: rfqs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfqs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rfq_number text NOT NULL,
    customer_name text NOT NULL,
    contact_id uuid,
    season text,
    received_date date DEFAULT CURRENT_DATE,
    due_date date,
    status text DEFAULT 'New'::text,
    description text,
    product_category text,
    estimated_quantity integer,
    target_price numeric(10,4),
    target_price_currency text DEFAULT 'USD'::text,
    delivery_date date,
    destination_country text,
    incoterms text,
    special_requirements text,
    rfq_file_url text,
    rfq_file_name text,
    source text DEFAULT 'Email'::text,
    won_value numeric(14,2),
    lost_reason text,
    converted_to_po_id uuid,
    assigned_to text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT rfqs_source_check CHECK ((source = ANY (ARRAY['Email'::text, 'WhatsApp'::text, 'Meeting'::text, 'Portal'::text, 'Phone'::text, 'Other'::text]))),
    CONSTRAINT rfqs_status_check CHECK ((status = ANY (ARRAY['New'::text, 'In Review'::text, 'Costing'::text, 'Sent'::text, 'Won'::text, 'Lost'::text, 'On Hold'::text, 'Cancelled'::text])))
);


--
-- Name: rm_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rm_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_category text NOT NULL,
    item_code text NOT NULL,
    item_description text,
    unit text DEFAULT 'pcs'::text NOT NULL,
    on_hand_qty numeric DEFAULT 0,
    in_transit_qty numeric DEFAULT 0,
    reorder_level numeric DEFAULT 0,
    unit_cost numeric DEFAULT 0,
    currency text DEFAULT 'USD'::text,
    warehouse_location text,
    last_stocktake_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT rm_stock_item_category_check CHECK ((item_category = ANY (ARRAY['yarn'::text, 'fabric'::text, 'trim'::text, 'accessory'::text, 'packaging'::text])))
);


--
-- Name: sample_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sample_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number text NOT NULL,
    po_id uuid,
    po_number text,
    rfq_id uuid,
    customer_name text NOT NULL,
    contact_email text,
    invoice_date date DEFAULT CURRENT_DATE,
    due_date date,
    currency text DEFAULT 'USD'::text,
    line_items jsonb DEFAULT '[]'::jsonb,
    subtotal numeric DEFAULT 0,
    freight numeric DEFAULT 0,
    other_charges numeric DEFAULT 0,
    total_amount numeric DEFAULT 0,
    status text DEFAULT 'Draft'::text,
    payment_terms text,
    notes text,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sample_invoices_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Sent'::text, 'Accepted'::text, 'Paid'::text, 'Cancelled'::text, 'Waived'::text])))
);


--
-- Name: samples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.samples (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    style_number text,
    article_name text,
    sample_type text,
    round_number integer DEFAULT 1,
    dispatch_date date,
    courier text,
    tracking_number text,
    expected_feedback_date date,
    actual_feedback_date date,
    buyer_comments text,
    status text DEFAULT 'Dispatched'::text,
    internal_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    batch_id uuid,
    quantity integer DEFAULT 1,
    rfq_id uuid,
    quotation_id uuid,
    billable_quantity integer DEFAULT 0,
    unit_price numeric DEFAULT 0,
    total_cost numeric DEFAULT 0,
    currency text DEFAULT 'USD'::text,
    cost_source text,
    affects_shipment_timeline boolean DEFAULT true,
    invoice_id uuid,
    invoice_status text DEFAULT 'not_invoiced'::text,
    sample_stage text,
    manager_approved_by uuid,
    manager_approved_at timestamp with time zone,
    manager_approval_notes text,
    CONSTRAINT samples_invoice_status_check CHECK ((invoice_status = ANY (ARRAY['not_invoiced'::text, 'pending'::text, 'invoiced'::text, 'paid'::text, 'waived'::text]))),
    CONSTRAINT samples_sample_type_check CHECK ((sample_type = ANY (ARRAY['Development Sample'::text, 'RFQ Sample'::text, 'Pre-Production & Testing Sample'::text, 'Packaging Sample'::text, 'Salesman Sample'::text, 'Shipment Sample'::text, 'Photoshoot Sample'::text, 'Other'::text]))),
    CONSTRAINT samples_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Dispatched'::text, 'Delivered'::text, 'Approved'::text, 'Rejected'::text, 'Amendment Required'::text, 'Hold'::text])))
);


--
-- Name: season_planning_base; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.season_planning_base AS
 SELECT po.id AS po_id,
    po.po_number,
    po.customer_name,
    po.order_date,
    po.delivery_date,
    po.season,
    po.currency,
    (EXTRACT(year FROM po.order_date))::integer AS order_year,
    (EXTRACT(month FROM po.order_date))::integer AS order_month,
    (EXTRACT(quarter FROM po.order_date))::integer AS order_quarter,
    concat('Q', (EXTRACT(quarter FROM po.order_date))::integer, ' ', (EXTRACT(year FROM po.order_date))::integer) AS quarter_label,
    pi.id AS item_id,
    pi.item_code,
    pi.fabric_type,
    pi.gsm,
    pi.quantity,
    pi.unit_price,
    pi.total_price,
    COALESCE(pi.total_price, ((pi.quantity)::numeric * pi.unit_price), (0)::numeric) AS line_value
   FROM (public.purchase_orders po
     LEFT JOIN public.po_items pi ON ((pi.po_id = po.id)))
  WHERE ((COALESCE(po.is_revision, false) = false) AND (po.order_date IS NOT NULL));


--
-- Name: season_by_category_quarter; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.season_by_category_quarter AS
 SELECT COALESCE(NULLIF(fabric_type, ''::text), 'Unspecified'::text) AS category,
    order_year,
    order_quarter,
    quarter_label,
    sum(line_value) AS total_value,
    sum(quantity) AS total_quantity
   FROM public.season_planning_base
  WHERE (item_id IS NOT NULL)
  GROUP BY COALESCE(NULLIF(fabric_type, ''::text), 'Unspecified'::text), order_year, order_quarter, quarter_label
  ORDER BY order_year, order_quarter;


--
-- Name: season_by_customer_quarter; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.season_by_customer_quarter AS
 SELECT customer_name,
    order_year,
    order_quarter,
    quarter_label,
    count(DISTINCT po_id) AS po_count,
    sum(line_value) AS total_value,
    sum(quantity) AS total_quantity
   FROM public.season_planning_base
  GROUP BY customer_name, order_year, order_quarter, quarter_label
  ORDER BY order_year, order_quarter, customer_name;


--
-- Name: season_by_month; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.season_by_month AS
 SELECT order_year,
    order_month,
    to_char((make_date(order_year, order_month, 1))::timestamp with time zone, 'Mon YYYY'::text) AS month_label,
    count(DISTINCT po_id) AS po_count,
    sum(line_value) AS total_value,
    sum(quantity) AS total_quantity
   FROM public.season_planning_base
  GROUP BY order_year, order_month
  ORDER BY order_year, order_month;


--
-- Name: seasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    start_date date,
    end_date date,
    target_value numeric(14,2),
    target_quantity integer,
    status text DEFAULT 'Planning'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT seasons_status_check CHECK ((status = ANY (ARRAY['Planning'::text, 'Active'::text, 'Completed'::text, 'Cancelled'::text])))
);


--
-- Name: shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    shipment_number text,
    carrier text,
    vessel_name text,
    voyage_number text,
    bl_number text,
    container_number text,
    container_type text,
    port_of_loading text,
    port_of_destination text,
    etd date,
    eta date,
    actual_departure date,
    actual_arrival date,
    total_cbm numeric(10,4),
    total_weight numeric(10,2),
    total_cartons integer,
    freight_cost numeric(14,2),
    currency text DEFAULT 'USD'::text,
    status text DEFAULT 'Planned'::text,
    incoterms text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    batch_id uuid,
    CONSTRAINT shipments_status_check CHECK ((status = ANY (ARRAY['Planned'::text, 'Booked'::text, 'Booking Confirmed'::text, 'Loaded'::text, 'In Transit'::text, 'At Port'::text, 'Customs Clearance'::text, 'Delivered'::text, 'Cancelled'::text])))
);


--
-- Name: shipping_doc_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_doc_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    customer_name text,
    document_type text,
    document_number text,
    document_date date,
    phase text DEFAULT 'Before Shipment'::text,
    file_url text,
    file_name text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: shipping_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid,
    po_id uuid,
    document_type text,
    document_number text,
    document_date date,
    status text DEFAULT 'Pending'::text,
    file_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT shipping_documents_document_type_check CHECK ((document_type = ANY (ARRAY['Bill of Lading'::text, 'Commercial Invoice'::text, 'Packing List'::text, 'Certificate of Origin'::text, 'Inspection Certificate'::text, 'Insurance Certificate'::text, 'Letter of Credit'::text, 'Proforma Invoice'::text, 'Other'::text]))),
    CONSTRAINT shipping_documents_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Received'::text, 'Approved'::text, 'Rejected'::text])))
);


--
-- Name: signup_whitelist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signup_whitelist (
    email text NOT NULL,
    role text DEFAULT 'owner'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sku_review_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sku_review_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    po_item_id uuid,
    article_id uuid,
    item_code text,
    item_description text,
    order_quantity integer DEFAULT 0,
    status text DEFAULT 'pending'::text,
    match_type text,
    matched_template_code text,
    suggested_components jsonb DEFAULT '[]'::jsonb,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sku_review_queue_match_type_check CHECK ((match_type = ANY (ARRAY['exact'::text, 'fuzzy'::text, 'ai_suggested'::text, 'new'::text]))),
    CONSTRAINT sku_review_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'skipped'::text, 'ai_suggested'::text])))
);


--
-- Name: status_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    old_status text,
    new_status text,
    changed_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: style_consumption; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.style_consumption (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    article_code text NOT NULL,
    article_name text,
    component_type text NOT NULL,
    component_key text NOT NULL,
    component_description text,
    unit text NOT NULL,
    consumption_per_unit numeric NOT NULL,
    wastage_percent numeric DEFAULT 0,
    avg_unit_cost numeric,
    currency text DEFAULT 'USD'::text,
    data_source text DEFAULT 'manual'::text,
    sample_size integer DEFAULT 1,
    last_seen_po text,
    last_updated timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT style_consumption_component_type_check CHECK ((component_type = ANY (ARRAY['fabric'::text, 'trim'::text, 'accessory'::text, 'packaging'::text])))
);


--
-- Name: supplier_performance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_performance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    total_shipments integer DEFAULT 0,
    on_time_shipments integer DEFAULT 0,
    on_time_pct numeric(5,2) DEFAULT 0,
    avg_delay_days numeric(5,1) DEFAULT 0,
    total_inspections integer DEFAULT 0,
    passed_inspections integer DEFAULT 0,
    pass_rate_pct numeric(5,2) DEFAULT 0,
    total_complaints integer DEFAULT 0,
    total_orders integer DEFAULT 0,
    total_value numeric(14,2) DEFAULT 0,
    total_quantity integer DEFAULT 0,
    overall_score numeric(5,2) DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    contact_person text,
    email text,
    phone text,
    country text,
    city text,
    address text,
    payment_terms text,
    status text DEFAULT 'Active'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    factory_name text,
    capacity_units_per_month integer,
    lead_time_days integer,
    min_order_qty integer,
    certifications text[],
    audit_date date,
    audit_score numeric(5,2),
    audit_status text DEFAULT 'Not Audited'::text,
    category text,
    code text,
    supplier_type text,
    whatsapp text,
    currency text,
    rating numeric,
    CONSTRAINT suppliers_status_check CHECK ((status = ANY (ARRAY['Active'::text, 'Inactive'::text])))
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    department text,
    description text,
    manager_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    line_manager_id uuid,
    color text DEFAULT '#6366f1'::text,
    is_active boolean DEFAULT true
);


--
-- Name: tech_packs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tech_packs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    customer_name text,
    article_code text,
    article_name text,
    season text,
    file_name text NOT NULL,
    file_url text NOT NULL,
    file_type text,
    file_size_kb integer,
    extraction_status text DEFAULT 'pending'::text,
    extraction_error text,
    extracted_at timestamp with time zone,
    extracted_data jsonb DEFAULT '{}'::jsonb,
    extracted_fabric_specs jsonb DEFAULT '[]'::jsonb,
    extracted_trim_specs jsonb DEFAULT '[]'::jsonb,
    extracted_accessory_specs jsonb DEFAULT '[]'::jsonb,
    extracted_measurements jsonb DEFAULT '{}'::jsonb,
    extracted_construction jsonb DEFAULT '{}'::jsonb,
    extracted_wash_care jsonb DEFAULT '[]'::jsonb,
    extracted_label_specs jsonb DEFAULT '[]'::jsonb,
    crosscheck_status text DEFAULT 'not_run'::text,
    crosscheck_results jsonb DEFAULT '[]'::jsonb,
    crosscheck_run_at timestamp with time zone,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    review_notes text,
    uploaded_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    version integer DEFAULT 1 NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    locked_reason text,
    locked_at timestamp with time zone,
    change_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT tech_packs_crosscheck_status_check CHECK ((crosscheck_status = ANY (ARRAY['not_run'::text, 'running'::text, 'passed'::text, 'discrepancies'::text, 'error'::text]))),
    CONSTRAINT tech_packs_extraction_status_check CHECK ((extraction_status = ANY (ARRAY['pending'::text, 'processing'::text, 'extracted'::text, 'partial'::text, 'failed'::text])))
);


--
-- Name: tna_calendars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tna_calendars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    customer_name text,
    ex_factory_date date,
    template_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    batch_id uuid
);


--
-- Name: tna_milestones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tna_milestones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tna_id uuid,
    po_id uuid,
    name text NOT NULL,
    category text,
    target_date date,
    actual_date date,
    status text DEFAULT 'pending'::text,
    responsible text,
    notes text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    batch_id uuid,
    CONSTRAINT tna_milestones_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'delayed'::text, 'at_risk'::text])))
);


--
-- Name: tna_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tna_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    product_type text DEFAULT 'Knit'::text,
    milestones jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: trim_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trim_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    article_name text,
    article_code text,
    trim_category text,
    item_description text,
    color text,
    size_spec text,
    calc_type text DEFAULT 'Per Piece'::text,
    consumption_per_unit numeric(10,4) DEFAULT 1,
    wastage_percent numeric(5,2) DEFAULT 5,
    order_quantity integer DEFAULT 0,
    fabric_meters numeric(10,4),
    quantity_required numeric,
    unit text DEFAULT 'Pcs'::text,
    supplier text,
    unit_cost numeric(10,4),
    total_cost numeric(14,2),
    status text DEFAULT 'Planned'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT trim_items_status_check CHECK ((status = ANY (ARRAY['Planned'::text, 'Ordered'::text, 'In Transit'::text, 'Received'::text, 'Rejected'::text])))
);


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    id uuid NOT NULL,
    full_name text,
    role text DEFAULT 'Viewer'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    team_id uuid,
    department text,
    gcal_token text,
    gcal_sync_enabled boolean DEFAULT false,
    email text,
    approval_status text DEFAULT 'pending'::text,
    approved_by uuid,
    approved_at timestamp with time zone,
    signup_method text,
    rejection_reason text,
    requested_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_profiles_approval_status_check CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT user_profiles_role_check CHECK ((role = ANY (ARRAY['Owner'::text, 'Manager'::text, 'Merchandiser'::text, 'Viewer'::text, 'Supplier'::text, 'QC Inspector'::text])))
);


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    login_email text,
    crawler_email text,
    crawler_query_default text DEFAULT 'subject:("purchase order" OR PO) has:attachment'::text,
    crawler_max_emails integer DEFAULT 50,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: v_daily_capacity; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_daily_capacity AS
 SELECT po.output_date,
    po.line_id,
    pl.name AS line_name,
    pl.daily_capacity,
    (sum(po.qty_produced))::integer AS total_produced,
    (sum(po.qty_rejected))::integer AS total_rejected,
        CASE
            WHEN (pl.daily_capacity > 0) THEN round(((100.0 * (sum(po.qty_produced))::numeric) / (pl.daily_capacity)::numeric), 1)
            ELSE (0)::numeric
        END AS utilization_pct,
    count(DISTINCT po.po_id) AS po_count,
    count(DISTINCT po.article_code) AS article_count
   FROM (public.production_output po
     JOIN public.production_lines pl ON ((pl.id = po.line_id)))
  GROUP BY po.output_date, po.line_id, pl.name, pl.daily_capacity;


--
-- Name: v_po_consumption; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_po_consumption AS
 SELECT a.po_id,
    a.po_number,
    a.article_code AS item_code,
    a.order_quantity,
    cl.kind,
    cl.component_type,
    cl.fabric_type,
    cl.gsm,
    cl.width_cm,
    cl.consumption_per_unit,
    cl.wastage_percent,
    round(((cl.consumption_per_unit * ((1)::numeric + (COALESCE(cl.wastage_percent, (0)::numeric) / (100)::numeric))) * (a.order_quantity)::numeric), 4) AS total_required
   FROM (public.articles a
     JOIN public.consumption_library cl ON ((cl.item_code = a.article_code)))
  WHERE (cl.consumption_per_unit IS NOT NULL);


--
-- Name: v_po_cost_variance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_po_cost_variance AS
 WITH actual_fabric AS (
         SELECT fabric_orders.po_id,
            sum((fabric_orders.quantity_meters * COALESCE(fabric_orders.unit_price, (0)::numeric))) AS actual_fabric_cost
           FROM public.fabric_orders
          WHERE (fabric_orders.po_id IS NOT NULL)
          GROUP BY fabric_orders.po_id
        ), actual_trims AS (
         SELECT trim_items.po_id,
            sum((trim_items.quantity_required * COALESCE(trim_items.unit_cost, (0)::numeric))) AS actual_trim_cost
           FROM public.trim_items
          WHERE (trim_items.po_id IS NOT NULL)
          GROUP BY trim_items.po_id
        ), actual_accessories AS (
         SELECT accessory_items.po_id,
            sum(((accessory_items.quantity_required)::numeric * COALESCE(accessory_items.unit_cost, (0)::numeric))) AS actual_accessory_cost
           FROM public.accessory_items
          WHERE (accessory_items.po_id IS NOT NULL)
          GROUP BY accessory_items.po_id
        ), quoted AS (
         SELECT costing_sheets.po_id,
            sum((COALESCE(costing_sheets.fabric_cost, (0)::numeric) * (COALESCE(costing_sheets.order_quantity, 0))::numeric)) AS quoted_fabric_cost,
            sum((COALESCE(costing_sheets.trim_cost, (0)::numeric) * (COALESCE(costing_sheets.order_quantity, 0))::numeric)) AS quoted_trim_cost,
            sum((COALESCE(costing_sheets.accessory_cost, (0)::numeric) * (COALESCE(costing_sheets.order_quantity, 0))::numeric)) AS quoted_accessory_cost,
            sum((COALESCE(costing_sheets.total_cogs, (0)::numeric) * (COALESCE(costing_sheets.order_quantity, 0))::numeric)) AS quoted_total_cogs,
            sum((COALESCE(costing_sheets.buyer_price, (0)::numeric) * (COALESCE(costing_sheets.order_quantity, 0))::numeric)) AS quoted_revenue,
            sum((COALESCE(costing_sheets.gross_margin, (0)::numeric) * (COALESCE(costing_sheets.order_quantity, 0))::numeric)) AS quoted_gross_margin
           FROM public.costing_sheets
          WHERE (costing_sheets.po_id IS NOT NULL)
          GROUP BY costing_sheets.po_id
        )
 SELECT po.id AS po_id,
    po.po_number,
    po.customer_name,
    po.status,
    po.total_po_value,
    po.total_quantity,
    COALESCE(q.quoted_revenue, po.total_po_value, (0)::numeric) AS quoted_revenue,
    COALESCE(q.quoted_fabric_cost, (0)::numeric) AS quoted_fabric_cost,
    COALESCE(af.actual_fabric_cost, (0)::numeric) AS actual_fabric_cost,
    (COALESCE(af.actual_fabric_cost, (0)::numeric) - COALESCE(q.quoted_fabric_cost, (0)::numeric)) AS fabric_variance,
    COALESCE(q.quoted_trim_cost, (0)::numeric) AS quoted_trim_cost,
    COALESCE(at.actual_trim_cost, (0)::numeric) AS actual_trim_cost,
    (COALESCE(at.actual_trim_cost, (0)::numeric) - COALESCE(q.quoted_trim_cost, (0)::numeric)) AS trim_variance,
    COALESCE(q.quoted_accessory_cost, (0)::numeric) AS quoted_accessory_cost,
    COALESCE(aa.actual_accessory_cost, (0)::numeric) AS actual_accessory_cost,
    (COALESCE(aa.actual_accessory_cost, (0)::numeric) - COALESCE(q.quoted_accessory_cost, (0)::numeric)) AS accessory_variance,
    COALESCE(q.quoted_total_cogs, (0)::numeric) AS quoted_total_cogs,
    ((COALESCE(af.actual_fabric_cost, (0)::numeric) + COALESCE(at.actual_trim_cost, (0)::numeric)) + COALESCE(aa.actual_accessory_cost, (0)::numeric)) AS actual_material_cost,
    COALESCE(q.quoted_gross_margin, (0)::numeric) AS quoted_gross_margin,
    ((COALESCE(q.quoted_revenue, po.total_po_value, (0)::numeric) - ((COALESCE(af.actual_fabric_cost, (0)::numeric) + COALESCE(at.actual_trim_cost, (0)::numeric)) + COALESCE(aa.actual_accessory_cost, (0)::numeric))) - (((COALESCE(q.quoted_total_cogs, (0)::numeric) - COALESCE(q.quoted_fabric_cost, (0)::numeric)) - COALESCE(q.quoted_trim_cost, (0)::numeric)) - COALESCE(q.quoted_accessory_cost, (0)::numeric))) AS projected_gross_margin
   FROM ((((public.purchase_orders po
     LEFT JOIN actual_fabric af ON ((af.po_id = po.id)))
     LEFT JOIN actual_trims at ON ((at.po_id = po.id)))
     LEFT JOIN actual_accessories aa ON ((aa.po_id = po.id)))
     LEFT JOIN quoted q ON ((q.po_id = po.id)));


--
-- Name: v_po_payment_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_po_payment_summary AS
SELECT
    NULL::uuid AS po_id,
    NULL::text AS po_number,
    NULL::text AS customer_name,
    NULL::numeric(14,2) AS total_po_value,
    NULL::text AS po_currency,
    NULL::text AS payment_structure,
    NULL::text AS payment_terms,
    NULL::text AS lc_type,
    NULL::text AS lc_number,
    NULL::text AS lc_bank,
    NULL::integer AS lc_tenor_days,
    NULL::date AS lc_expiry,
    NULL::date AS lc_latest_shipment_date,
    NULL::integer AS lc_presentation_days,
    NULL::text AS tt_terms,
    NULL::numeric AS amount_received,
    NULL::numeric AS amount_pending,
    NULL::numeric AS total_scheduled,
    NULL::numeric AS pct_received,
    NULL::bigint AS milestone_count,
    NULL::bigint AS milestones_completed;


--
-- Name: v_po_size_totals; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_po_size_totals AS
 SELECT po_id,
    size_label,
    color,
    (sum(quantity))::integer AS total_qty,
    count(DISTINCT po_item_id) AS item_count
   FROM public.po_item_sizes s
  GROUP BY po_id, size_label, color;


--
-- Name: v_rm_coverage; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_rm_coverage AS
 WITH trim_requirements AS (
         SELECT 'trim'::text AS item_category,
            lower(TRIM(BOTH FROM COALESCE(ti.item_description, ti.trim_category))) AS item_code,
            max(ti.item_description) AS item_description,
            max(ti.unit) AS unit,
            sum(ti.quantity_required) AS total_required,
            count(DISTINCT ti.po_id) AS linked_pos
           FROM (public.trim_items ti
             JOIN public.purchase_orders po ON ((po.id = ti.po_id)))
          WHERE ((po.status <> ALL (ARRAY['Cancelled'::text, 'Shipped'::text, 'Closed'::text])) AND ((po.delivery_date IS NULL) OR (po.delivery_date <= (CURRENT_DATE + '84 days'::interval))))
          GROUP BY (lower(TRIM(BOTH FROM COALESCE(ti.item_description, ti.trim_category))))
        ), accessory_requirements AS (
         SELECT 'accessory'::text AS item_category,
            lower(TRIM(BOTH FROM COALESCE(ai.item_description, ai.category))) AS item_code,
            max(ai.item_description) AS item_description,
            max(ai.unit) AS unit,
            sum(ai.quantity_required) AS total_required,
            count(DISTINCT ai.po_id) AS linked_pos
           FROM (public.accessory_items ai
             JOIN public.purchase_orders po ON ((po.id = ai.po_id)))
          WHERE ((po.status <> ALL (ARRAY['Cancelled'::text, 'Shipped'::text, 'Closed'::text])) AND ((po.delivery_date IS NULL) OR (po.delivery_date <= (CURRENT_DATE + '84 days'::interval))))
          GROUP BY (lower(TRIM(BOTH FROM COALESCE(ai.item_description, ai.category))))
        ), fabric_requirements AS (
         SELECT 'fabric'::text AS item_category,
            lower(TRIM(BOTH FROM ((fo.fabric_type || ' '::text) || COALESCE(fo.color, ''::text)))) AS item_code,
            max((fo.fabric_type || COALESCE((' / '::text || fo.color), ''::text))) AS item_description,
            'meters'::text AS unit,
            sum((fo.quantity_meters - COALESCE(fo.received_meters, (0)::numeric))) AS total_required,
            count(DISTINCT fo.po_id) AS linked_pos
           FROM (public.fabric_orders fo
             JOIN public.purchase_orders po ON ((po.id = fo.po_id)))
          WHERE ((po.status <> ALL (ARRAY['Cancelled'::text, 'Shipped'::text, 'Closed'::text])) AND (fo.status <> ALL (ARRAY['Delivered'::text, 'Cancelled'::text])) AND ((po.delivery_date IS NULL) OR (po.delivery_date <= (CURRENT_DATE + '84 days'::interval))))
          GROUP BY (lower(TRIM(BOTH FROM ((fo.fabric_type || ' '::text) || COALESCE(fo.color, ''::text)))))
        ), all_req AS (
         SELECT trim_requirements.item_category,
            trim_requirements.item_code,
            trim_requirements.item_description,
            trim_requirements.unit,
            trim_requirements.total_required,
            trim_requirements.linked_pos
           FROM trim_requirements
        UNION ALL
         SELECT accessory_requirements.item_category,
            accessory_requirements.item_code,
            accessory_requirements.item_description,
            accessory_requirements.unit,
            accessory_requirements.total_required,
            accessory_requirements.linked_pos
           FROM accessory_requirements
        UNION ALL
         SELECT fabric_requirements.item_category,
            fabric_requirements.item_code,
            fabric_requirements.item_description,
            fabric_requirements.unit,
            fabric_requirements.total_required,
            fabric_requirements.linked_pos
           FROM fabric_requirements
        )
 SELECT ar.item_category,
    ar.item_code,
    ar.item_description,
    ar.unit,
    ar.total_required,
    ar.linked_pos,
    COALESCE(rs.on_hand_qty, (0)::numeric) AS on_hand_qty,
    COALESCE(rs.in_transit_qty, (0)::numeric) AS in_transit_qty,
    (COALESCE(rs.on_hand_qty, (0)::numeric) + COALESCE(rs.in_transit_qty, (0)::numeric)) AS total_available,
    ((COALESCE(rs.on_hand_qty, (0)::numeric) + COALESCE(rs.in_transit_qty, (0)::numeric)) - ar.total_required) AS coverage_surplus,
        CASE
            WHEN ((COALESCE(rs.on_hand_qty, (0)::numeric) + COALESCE(rs.in_transit_qty, (0)::numeric)) >= ar.total_required) THEN 'green'::text
            WHEN ((COALESCE(rs.on_hand_qty, (0)::numeric) + COALESCE(rs.in_transit_qty, (0)::numeric)) >= (ar.total_required * 0.7)) THEN 'yellow'::text
            ELSE 'red'::text
        END AS coverage_status,
    rs.unit_cost,
    rs.reorder_level,
    rs.warehouse_location
   FROM (all_req ar
     LEFT JOIN public.rm_stock rs ON (((rs.item_category = ar.item_category) AND (lower(TRIM(BOTH FROM rs.item_code)) = ar.item_code))));


--
-- Name: v_wip_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_wip_status AS
SELECT
    NULL::uuid AS plan_id,
    NULL::uuid AS po_id,
    NULL::text AS po_number,
    NULL::text AS article_code,
    NULL::uuid AS line_id,
    NULL::text AS line_name,
    NULL::uuid AS stage_id,
    NULL::text AS stage_name,
    NULL::integer AS stage_order,
    NULL::integer AS planned_qty,
    NULL::integer AS produced_qty,
    NULL::integer AS rejected_qty,
    NULL::numeric AS completion_pct,
    NULL::date AS start_date,
    NULL::date AS end_date,
    NULL::integer AS priority,
    NULL::text AS status,
    NULL::date AS last_output_date;


--
-- Name: whatsapp_crawl; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_crawl (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id text,
    sender text,
    sender_name text,
    timestamp_utc timestamp with time zone,
    message_type text,
    content text,
    media_url text,
    media_type text,
    ocr_text text,
    classification text,
    classification_reasoning text,
    extracted_data jsonb,
    updates jsonb DEFAULT '[]'::jsonb,
    processed boolean DEFAULT false,
    processed_at timestamp with time zone,
    linked_po_id uuid,
    raw_payload jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: yarn_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.yarn_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    po_number text,
    article_code text,
    article_name text,
    fabric_type text,
    gsm numeric(8,2),
    width_cm numeric(8,2),
    total_meters numeric(10,4),
    yarn_kg numeric(10,4),
    yarn_type text,
    yarn_count text,
    supplier text,
    status text DEFAULT 'Planned'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT yarn_requirements_status_check CHECK ((status = ANY (ARRAY['Planned'::text, 'Ordered'::text, 'In Transit'::text, 'Received'::text, 'Rejected'::text])))
);


--
-- Name: accessory_items accessory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accessory_items
    ADD CONSTRAINT accessory_items_pkey PRIMARY KEY (id);


--
-- Name: accessory_purchase_orders accessory_purchase_orders_apo_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accessory_purchase_orders
    ADD CONSTRAINT accessory_purchase_orders_apo_number_key UNIQUE (apo_number);


--
-- Name: accessory_purchase_orders accessory_purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accessory_purchase_orders
    ADD CONSTRAINT accessory_purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: accessory_templates accessory_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accessory_templates
    ADD CONSTRAINT accessory_templates_pkey PRIMARY KEY (id);


--
-- Name: app_users app_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_email_key UNIQUE (email);


--
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);


--
-- Name: article_packaging article_packaging_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_packaging
    ADD CONSTRAINT article_packaging_pkey PRIMARY KEY (id);


--
-- Name: articles articles_article_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_article_code_key UNIQUE (article_code);


--
-- Name: articles articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: batch_items batch_items_batch_id_po_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_items
    ADD CONSTRAINT batch_items_batch_id_po_item_id_key UNIQUE (batch_id, po_item_id);


--
-- Name: batch_items batch_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_items
    ADD CONSTRAINT batch_items_pkey PRIMARY KEY (id);


--
-- Name: batch_split_snapshots batch_split_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_split_snapshots
    ADD CONSTRAINT batch_split_snapshots_pkey PRIMARY KEY (id);


--
-- Name: bom_explosion_log bom_explosion_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom_explosion_log
    ADD CONSTRAINT bom_explosion_log_pkey PRIMARY KEY (id);


--
-- Name: buyer_contacts buyer_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_contacts
    ADD CONSTRAINT buyer_contacts_pkey PRIMARY KEY (id);


--
-- Name: capacity_plans capacity_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_plans
    ADD CONSTRAINT capacity_plans_pkey PRIMARY KEY (id);


--
-- Name: commercial_invoices commercial_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_invoices
    ADD CONSTRAINT commercial_invoices_pkey PRIMARY KEY (id);


--
-- Name: comms_log comms_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comms_log
    ADD CONSTRAINT comms_log_pkey PRIMARY KEY (id);


--
-- Name: complaints complaints_complaint_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_complaint_number_key UNIQUE (complaint_number);


--
-- Name: complaints complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_pkey PRIMARY KEY (id);


--
-- Name: compliance_docs compliance_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_docs
    ADD CONSTRAINT compliance_docs_pkey PRIMARY KEY (id);


--
-- Name: consumption_library consumption_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumption_library
    ADD CONSTRAINT consumption_library_pkey PRIMARY KEY (id);


--
-- Name: consumption_library consumption_library_upsert_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumption_library
    ADD CONSTRAINT consumption_library_upsert_key UNIQUE (item_code, kind, component_type, color, material);


--
-- Name: costing_sheets costing_sheets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.costing_sheets
    ADD CONSTRAINT costing_sheets_pkey PRIMARY KEY (id);


--
-- Name: costing_sheets costing_sheets_po_article_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.costing_sheets
    ADD CONSTRAINT costing_sheets_po_article_unique UNIQUE (po_id, article_code);


--
-- Name: crosscheck_discrepancies crosscheck_discrepancies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crosscheck_discrepancies
    ADD CONSTRAINT crosscheck_discrepancies_pkey PRIMARY KEY (id);


--
-- Name: customer_team_assignments customer_team_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_team_assignments
    ADD CONSTRAINT customer_team_assignments_pkey PRIMARY KEY (id);


--
-- Name: customer_team_assignments customer_team_assignments_team_id_customer_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_team_assignments
    ADD CONSTRAINT customer_team_assignments_team_id_customer_name_key UNIQUE (team_id, customer_name);


--
-- Name: email_crawl email_crawl_gmail_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_crawl
    ADD CONSTRAINT email_crawl_gmail_message_id_key UNIQUE (gmail_message_id);


--
-- Name: email_crawl_log email_crawl_log_gmail_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_crawl_log
    ADD CONSTRAINT email_crawl_log_gmail_message_id_key UNIQUE (gmail_message_id);


--
-- Name: email_crawl_log email_crawl_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_crawl_log
    ADD CONSTRAINT email_crawl_log_pkey PRIMARY KEY (id);


--
-- Name: email_crawl email_crawl_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_crawl
    ADD CONSTRAINT email_crawl_pkey PRIMARY KEY (id);


--
-- Name: fabric_orders fabric_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fabric_orders
    ADD CONSTRAINT fabric_orders_pkey PRIMARY KEY (id);


--
-- Name: fabric_templates fabric_templates_article_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fabric_templates
    ADD CONSTRAINT fabric_templates_article_code_key UNIQUE (article_code);


--
-- Name: fabric_templates fabric_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fabric_templates
    ADD CONSTRAINT fabric_templates_pkey PRIMARY KEY (id);


--
-- Name: gcal_sync_log gcal_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcal_sync_log
    ADD CONSTRAINT gcal_sync_log_pkey PRIMARY KEY (id);


--
-- Name: gmail_oauth gmail_oauth_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_oauth
    ADD CONSTRAINT gmail_oauth_pkey PRIMARY KEY (id);


--
-- Name: gmail_oauth gmail_oauth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_oauth
    ADD CONSTRAINT gmail_oauth_user_id_key UNIQUE (user_id);


--
-- Name: job_card_steps job_card_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_card_steps
    ADD CONSTRAINT job_card_steps_pkey PRIMARY KEY (id);


--
-- Name: job_cards job_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cards
    ADD CONSTRAINT job_cards_pkey PRIMARY KEY (id);


--
-- Name: lab_dips lab_dips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_dips
    ADD CONSTRAINT lab_dips_pkey PRIMARY KEY (id);


--
-- Name: master_article_changes master_article_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_article_changes
    ADD CONSTRAINT master_article_changes_pkey PRIMARY KEY (id);


--
-- Name: master_articles master_articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_articles
    ADD CONSTRAINT master_articles_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: packing_lists packing_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_lists
    ADD CONSTRAINT packing_lists_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: permission_denials permission_denials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_denials
    ADD CONSTRAINT permission_denials_pkey PRIMARY KEY (id);


--
-- Name: po_batches po_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_batches
    ADD CONSTRAINT po_batches_pkey PRIMARY KEY (id);


--
-- Name: po_change_log po_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_change_log
    ADD CONSTRAINT po_change_log_pkey PRIMARY KEY (id);


--
-- Name: po_item_sizes po_item_sizes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_item_sizes
    ADD CONSTRAINT po_item_sizes_pkey PRIMARY KEY (id);


--
-- Name: po_items po_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_items
    ADD CONSTRAINT po_items_pkey PRIMARY KEY (id);


--
-- Name: price_list price_list_item_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_list
    ADD CONSTRAINT price_list_item_code_unique UNIQUE (item_code);


--
-- Name: price_list price_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_list
    ADD CONSTRAINT price_list_pkey PRIMARY KEY (id);


--
-- Name: print_layouts print_layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_layouts
    ADD CONSTRAINT print_layouts_pkey PRIMARY KEY (id);


--
-- Name: production_lines production_lines_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_lines
    ADD CONSTRAINT production_lines_name_key UNIQUE (name);


--
-- Name: production_lines production_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_lines
    ADD CONSTRAINT production_lines_pkey PRIMARY KEY (id);


--
-- Name: production_output production_output_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_output
    ADD CONSTRAINT production_output_pkey PRIMARY KEY (id);


--
-- Name: production_stages production_stages_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_stages
    ADD CONSTRAINT production_stages_name_key UNIQUE (name);


--
-- Name: production_stages production_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_stages
    ADD CONSTRAINT production_stages_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_po_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_po_number_key UNIQUE (po_number);


--
-- Name: purchase_orders purchase_orders_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_share_token_key UNIQUE (share_token);


--
-- Name: qc_inspections qc_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_inspections
    ADD CONSTRAINT qc_inspections_pkey PRIMARY KEY (id);


--
-- Name: quotation_items quotation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_items
    ADD CONSTRAINT quotation_items_pkey PRIMARY KEY (id);


--
-- Name: quotations quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_pkey PRIMARY KEY (id);


--
-- Name: quotations quotations_quote_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_quote_number_key UNIQUE (quote_number);


--
-- Name: rfqs rfqs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfqs
    ADD CONSTRAINT rfqs_pkey PRIMARY KEY (id);


--
-- Name: rfqs rfqs_rfq_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfqs
    ADD CONSTRAINT rfqs_rfq_number_key UNIQUE (rfq_number);


--
-- Name: rm_stock rm_stock_item_category_item_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rm_stock
    ADD CONSTRAINT rm_stock_item_category_item_code_key UNIQUE (item_category, item_code);


--
-- Name: rm_stock rm_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rm_stock
    ADD CONSTRAINT rm_stock_pkey PRIMARY KEY (id);


--
-- Name: sample_invoices sample_invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_invoices
    ADD CONSTRAINT sample_invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: sample_invoices sample_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_invoices
    ADD CONSTRAINT sample_invoices_pkey PRIMARY KEY (id);


--
-- Name: samples samples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_pkey PRIMARY KEY (id);


--
-- Name: seasons seasons_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_name_key UNIQUE (name);


--
-- Name: seasons seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seasons
    ADD CONSTRAINT seasons_pkey PRIMARY KEY (id);


--
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);


--
-- Name: shipping_doc_register shipping_doc_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_doc_register
    ADD CONSTRAINT shipping_doc_register_pkey PRIMARY KEY (id);


--
-- Name: shipping_documents shipping_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_documents
    ADD CONSTRAINT shipping_documents_pkey PRIMARY KEY (id);


--
-- Name: signup_whitelist signup_whitelist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signup_whitelist
    ADD CONSTRAINT signup_whitelist_pkey PRIMARY KEY (email);


--
-- Name: sku_review_queue sku_review_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_review_queue
    ADD CONSTRAINT sku_review_queue_pkey PRIMARY KEY (id);


--
-- Name: status_logs status_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_logs
    ADD CONSTRAINT status_logs_pkey PRIMARY KEY (id);


--
-- Name: style_consumption style_consumption_article_code_component_type_component_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.style_consumption
    ADD CONSTRAINT style_consumption_article_code_component_type_component_key_key UNIQUE (article_code, component_type, component_key);


--
-- Name: style_consumption style_consumption_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.style_consumption
    ADD CONSTRAINT style_consumption_pkey PRIMARY KEY (id);


--
-- Name: supplier_performance supplier_performance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_performance
    ADD CONSTRAINT supplier_performance_pkey PRIMARY KEY (id);


--
-- Name: supplier_performance supplier_performance_supplier_id_period_year_period_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_performance
    ADD CONSTRAINT supplier_performance_supplier_id_period_year_period_month_key UNIQUE (supplier_id, period_year, period_month);


--
-- Name: suppliers suppliers_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_name_unique UNIQUE (name);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: tech_packs tech_packs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tech_packs
    ADD CONSTRAINT tech_packs_pkey PRIMARY KEY (id);


--
-- Name: tna_calendars tna_calendars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tna_calendars
    ADD CONSTRAINT tna_calendars_pkey PRIMARY KEY (id);


--
-- Name: tna_milestones tna_milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tna_milestones
    ADD CONSTRAINT tna_milestones_pkey PRIMARY KEY (id);


--
-- Name: tna_templates tna_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tna_templates
    ADD CONSTRAINT tna_templates_pkey PRIMARY KEY (id);


--
-- Name: trim_items trim_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trim_items
    ADD CONSTRAINT trim_items_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);


--
-- Name: whatsapp_crawl whatsapp_crawl_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_crawl
    ADD CONSTRAINT whatsapp_crawl_message_id_key UNIQUE (message_id);


--
-- Name: whatsapp_crawl whatsapp_crawl_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_crawl
    ADD CONSTRAINT whatsapp_crawl_pkey PRIMARY KEY (id);


--
-- Name: yarn_requirements yarn_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.yarn_requirements
    ADD CONSTRAINT yarn_requirements_pkey PRIMARY KEY (id);


--
-- Name: idx_accessory_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accessory_po_id ON public.accessory_items USING btree (po_id);


--
-- Name: idx_accessory_templates_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_accessory_templates_name ON public.accessory_templates USING btree (template_name);


--
-- Name: idx_apo_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apo_po_id ON public.accessory_purchase_orders USING btree (po_id);


--
-- Name: idx_app_users_sup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_users_sup ON public.app_users USING btree (supplier_id);


--
-- Name: idx_articles_article_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_articles_article_code ON public.articles USING btree (article_code);


--
-- Name: idx_articles_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_articles_master ON public.articles USING btree (master_article_id);


--
-- Name: idx_articles_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_articles_po_id ON public.articles USING btree (po_id);


--
-- Name: idx_articles_po_id_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_articles_po_id_code ON public.articles USING btree (po_id, article_code);


--
-- Name: idx_articles_tp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_articles_tp ON public.articles USING btree (tech_pack_id);


--
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_created ON public.audit_log USING btree (created_at DESC);


--
-- Name: idx_audit_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_table ON public.audit_log USING btree (table_name, created_at DESC);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.audit_log USING btree (user_id, created_at DESC);


--
-- Name: idx_batch_items_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_items_batch ON public.batch_items USING btree (batch_id);


--
-- Name: idx_batch_items_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_items_item ON public.batch_items USING btree (po_item_id);


--
-- Name: idx_batch_items_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_items_po ON public.batch_items USING btree (po_id);


--
-- Name: idx_batch_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_po ON public.po_batches USING btree (po_id);


--
-- Name: idx_batch_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_status ON public.po_batches USING btree (status);


--
-- Name: idx_bc_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bc_customer ON public.buyer_contacts USING btree (customer_name);


--
-- Name: idx_bss_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bss_batch ON public.batch_split_snapshots USING btree (batch_id);


--
-- Name: idx_bss_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bss_po ON public.batch_split_snapshots USING btree (po_id);


--
-- Name: idx_capacity_plans_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capacity_plans_dates ON public.capacity_plans USING btree (start_date, end_date);


--
-- Name: idx_capacity_plans_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capacity_plans_line ON public.capacity_plans USING btree (line_id);


--
-- Name: idx_capacity_plans_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capacity_plans_po ON public.capacity_plans USING btree (po_id);


--
-- Name: idx_changelog_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_changelog_po ON public.po_change_log USING btree (po_id);


--
-- Name: idx_ci_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_batch ON public.commercial_invoices USING btree (batch_id);


--
-- Name: idx_ci_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_po ON public.commercial_invoices USING btree (po_id);


--
-- Name: idx_ci_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_shipment ON public.commercial_invoices USING btree (shipment_id);


--
-- Name: idx_ci_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_status ON public.commercial_invoices USING btree (status);


--
-- Name: idx_comms_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comms_po ON public.comms_log USING btree (po_id);


--
-- Name: idx_complaint_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaint_customer ON public.complaints USING btree (customer_name);


--
-- Name: idx_complaint_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaint_status ON public.complaints USING btree (status);


--
-- Name: idx_complaints_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_contact ON public.complaints USING btree (contact_id);


--
-- Name: idx_complaints_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_po ON public.complaints USING btree (po_id);


--
-- Name: idx_complaints_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_supplier ON public.complaints USING btree (supplier_id);


--
-- Name: idx_compliance_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_po ON public.compliance_docs USING btree (po_id);


--
-- Name: idx_compliance_po_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_po_number ON public.compliance_docs USING btree (po_number);


--
-- Name: idx_consumption_library_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumption_library_item ON public.consumption_library USING btree (item_code);


--
-- Name: idx_consumption_library_tp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consumption_library_tp ON public.consumption_library USING btree (tech_pack_id);


--
-- Name: idx_costing_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_costing_po ON public.costing_sheets USING btree (po_id);


--
-- Name: idx_cta_assigned_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cta_assigned_by ON public.customer_team_assignments USING btree (assigned_by);


--
-- Name: idx_cta_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cta_customer ON public.customer_team_assignments USING btree (customer_name);


--
-- Name: idx_cta_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cta_team ON public.customer_team_assignments USING btree (team_id);


--
-- Name: idx_disc_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disc_po ON public.crosscheck_discrepancies USING btree (po_id);


--
-- Name: idx_disc_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disc_status ON public.crosscheck_discrepancies USING btree (status);


--
-- Name: idx_disc_tp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disc_tp ON public.crosscheck_discrepancies USING btree (tech_pack_id);


--
-- Name: idx_docs_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_docs_shipment ON public.shipping_documents USING btree (shipment_id);


--
-- Name: idx_email_crawl_classification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_crawl_classification ON public.email_crawl_log USING btree (classification);


--
-- Name: idx_email_crawl_cls; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_crawl_cls ON public.email_crawl USING btree (classification);


--
-- Name: idx_email_crawl_msg_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_crawl_msg_id ON public.email_crawl USING btree (gmail_message_id);


--
-- Name: idx_email_crawl_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_crawl_po ON public.email_crawl_log USING btree (po_id);


--
-- Name: idx_email_crawl_po_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_crawl_po_created ON public.email_crawl_log USING btree (po_created);


--
-- Name: idx_email_crawl_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_crawl_received ON public.email_crawl_log USING btree (received_at DESC);


--
-- Name: idx_fabric_orders_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fabric_orders_po ON public.fabric_orders USING btree (po_id);


--
-- Name: idx_fabric_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fabric_orders_status ON public.fabric_orders USING btree (status);


--
-- Name: idx_ft_article_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ft_article_type ON public.fabric_templates USING btree (article_type);


--
-- Name: idx_ft_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ft_customer ON public.fabric_templates USING btree (customer);


--
-- Name: idx_ft_program_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ft_program_code ON public.fabric_templates USING btree (program_code);


--
-- Name: idx_gcal_milestone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcal_milestone ON public.gcal_sync_log USING btree (tna_milestone_id);


--
-- Name: idx_gcal_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gcal_user ON public.gcal_sync_log USING btree (user_id);


--
-- Name: idx_gmail_oauth_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gmail_oauth_email ON public.gmail_oauth USING btree (email);


--
-- Name: idx_gmail_oauth_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gmail_oauth_user ON public.gmail_oauth USING btree (user_id);


--
-- Name: idx_jcs_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jcs_parent ON public.job_card_steps USING btree (parent_job_card_id);


--
-- Name: idx_jcs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jcs_status ON public.job_card_steps USING btree (status);


--
-- Name: idx_job_cards_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_cards_batch ON public.job_cards USING btree (batch_id);


--
-- Name: idx_job_cards_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_cards_po_id ON public.job_cards USING btree (po_id);


--
-- Name: idx_lab_dips_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lab_dips_batch ON public.lab_dips USING btree (batch_id);


--
-- Name: idx_labdip_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_labdip_po ON public.lab_dips USING btree (po_id);


--
-- Name: idx_labdip_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_labdip_status ON public.lab_dips USING btree (status);


--
-- Name: idx_mac_article_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mac_article_code ON public.master_article_changes USING btree (article_code);


--
-- Name: idx_mac_article_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mac_article_id ON public.master_article_changes USING btree (article_id);


--
-- Name: idx_mac_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mac_status ON public.master_article_changes USING btree (propagation_status);


--
-- Name: idx_master_articles_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_articles_code ON public.master_articles USING btree (article_code);


--
-- Name: idx_master_articles_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_master_articles_customer ON public.master_articles USING btree (customer_name);


--
-- Name: idx_notif_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_user ON public.notifications USING btree (user_id);


--
-- Name: idx_packing_lists_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_packing_lists_po_id ON public.packing_lists USING btree (po_id);


--
-- Name: idx_payments_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_batch ON public.payments USING btree (batch_id);


--
-- Name: idx_payments_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_ci ON public.payments USING btree (ci_id);


--
-- Name: idx_payments_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_po ON public.payments USING btree (po_id);


--
-- Name: idx_perm_denials_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_perm_denials_user ON public.permission_denials USING btree (user_id);


--
-- Name: idx_pl_article; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_article ON public.print_layouts USING btree (article_code);


--
-- Name: idx_pl_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_batch ON public.packing_lists USING btree (batch_id);


--
-- Name: idx_pl_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_ci ON public.packing_lists USING btree (ci_id);


--
-- Name: idx_pl_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_email ON public.print_layouts USING btree (email_message_id);


--
-- Name: idx_pl_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_po ON public.print_layouts USING btree (po_id);


--
-- Name: idx_pl_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_shipment ON public.packing_lists USING btree (shipment_id);


--
-- Name: idx_pl_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_status ON public.print_layouts USING btree (approval_status);


--
-- Name: idx_pl_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pl_type ON public.print_layouts USING btree (layout_type);


--
-- Name: idx_po_approval_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_approval_status ON public.purchase_orders USING btree (approval_status);


--
-- Name: idx_po_batches_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_batches_parent ON public.po_batches USING btree (parent_batch_id);


--
-- Name: idx_po_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_customer ON public.purchase_orders USING btree (customer_name);


--
-- Name: idx_po_etd; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_etd ON public.purchase_orders USING btree (etd);


--
-- Name: idx_po_item_sizes_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_item_sizes_item ON public.po_item_sizes USING btree (po_item_id);


--
-- Name: idx_po_item_sizes_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_item_sizes_po ON public.po_item_sizes USING btree (po_id);


--
-- Name: idx_po_items_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_items_master ON public.po_items USING btree (master_article_id);


--
-- Name: idx_po_items_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_items_po_id ON public.po_items USING btree (po_id);


--
-- Name: idx_po_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_status ON public.purchase_orders USING btree (status);


--
-- Name: idx_po_supersedes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_supersedes ON public.purchase_orders USING btree (supersedes_po_id);


--
-- Name: idx_po_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_supplier ON public.purchase_orders USING btree (supplier_id);


--
-- Name: idx_price_list_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_list_code ON public.price_list USING btree (item_code);


--
-- Name: idx_price_list_item_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_list_item_code ON public.price_list USING btree (item_code);


--
-- Name: idx_price_list_pricing_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_list_pricing_status ON public.price_list USING btree (pricing_status) WHERE (pricing_status <> 'active'::public.pricing_status_t);


--
-- Name: idx_print_layouts_acc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_print_layouts_acc ON public.print_layouts USING btree (accessory_item_id);


--
-- Name: idx_production_output_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_output_date ON public.production_output USING btree (output_date DESC);


--
-- Name: idx_production_output_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_output_line ON public.production_output USING btree (line_id, output_date DESC);


--
-- Name: idx_production_output_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_output_po ON public.production_output USING btree (po_id, output_date DESC);


--
-- Name: idx_purchase_orders_share_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_share_token ON public.purchase_orders USING btree (share_token) WHERE (share_token IS NOT NULL);


--
-- Name: idx_qc_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qc_batch ON public.qc_inspections USING btree (batch_id);


--
-- Name: idx_qc_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qc_po ON public.qc_inspections USING btree (po_id);


--
-- Name: idx_quot_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_customer ON public.quotations USING btree (customer_name);


--
-- Name: idx_quot_items_quot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_items_quot ON public.quotation_items USING btree (quotation_id);


--
-- Name: idx_quot_rfq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quot_rfq ON public.quotations USING btree (rfq_id);


--
-- Name: idx_quotations_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_contact ON public.quotations USING btree (contact_id);


--
-- Name: idx_quotations_conv_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_conv_po ON public.quotations USING btree (converted_to_po_id);


--
-- Name: idx_quotations_prev; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_prev ON public.quotations USING btree (previous_quote_id);


--
-- Name: idx_rfq_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfq_customer ON public.rfqs USING btree (customer_name);


--
-- Name: idx_rfq_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfq_status ON public.rfqs USING btree (status);


--
-- Name: idx_rfqs_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfqs_contact ON public.rfqs USING btree (contact_id);


--
-- Name: idx_rfqs_conv_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfqs_conv_po ON public.rfqs USING btree (converted_to_po_id);


--
-- Name: idx_rm_stock_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rm_stock_category ON public.rm_stock USING btree (item_category);


--
-- Name: idx_samples_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_batch ON public.samples USING btree (batch_id);


--
-- Name: idx_samples_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_po ON public.samples USING btree (po_id);


--
-- Name: idx_samples_po_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_po_stage ON public.samples USING btree (po_id, sample_stage);


--
-- Name: idx_samples_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_samples_status ON public.samples USING btree (status);


--
-- Name: idx_shipments_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_batch ON public.shipments USING btree (batch_id);


--
-- Name: idx_shipments_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_po_id ON public.shipments USING btree (po_id);


--
-- Name: idx_shipments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_status ON public.shipments USING btree (status);


--
-- Name: idx_shipping_docs_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipping_docs_po ON public.shipping_documents USING btree (po_id);


--
-- Name: idx_shipreg_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipreg_po ON public.shipping_doc_register USING btree (po_id);


--
-- Name: idx_sku_article; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_article ON public.sku_review_queue USING btree (article_id);


--
-- Name: idx_sku_po_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_po_item ON public.sku_review_queue USING btree (po_item_id);


--
-- Name: idx_sku_queue_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_queue_po ON public.sku_review_queue USING btree (po_id);


--
-- Name: idx_sku_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sku_queue_status ON public.sku_review_queue USING btree (status);


--
-- Name: idx_style_cons_article; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_style_cons_article ON public.style_consumption USING btree (article_code);


--
-- Name: idx_style_cons_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_style_cons_type ON public.style_consumption USING btree (component_type);


--
-- Name: idx_sup_perf_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sup_perf_supplier ON public.supplier_performance USING btree (supplier_id);


--
-- Name: idx_teams_line_mgr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_line_mgr ON public.teams USING btree (line_manager_id);


--
-- Name: idx_teams_manager; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teams_manager ON public.teams USING btree (manager_id);


--
-- Name: idx_tech_packs_locked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tech_packs_locked ON public.tech_packs USING btree (is_locked) WHERE (is_locked = true);


--
-- Name: idx_tech_packs_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tech_packs_po_id ON public.tech_packs USING btree (po_id);


--
-- Name: idx_tna_cal_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tna_cal_batch ON public.tna_calendars USING btree (batch_id);


--
-- Name: idx_tna_cal_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tna_cal_po ON public.tna_calendars USING btree (po_id);


--
-- Name: idx_tna_cal_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tna_cal_template ON public.tna_calendars USING btree (template_id);


--
-- Name: idx_tna_mil_tna; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tna_mil_tna ON public.tna_milestones USING btree (tna_id);


--
-- Name: idx_tna_milestones_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tna_milestones_batch ON public.tna_milestones USING btree (batch_id);


--
-- Name: idx_tna_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tna_po ON public.tna_milestones USING btree (po_id);


--
-- Name: idx_tna_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tna_status ON public.tna_milestones USING btree (status);


--
-- Name: idx_tna_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tna_target ON public.tna_milestones USING btree (target_date);


--
-- Name: idx_tp_article; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tp_article ON public.tech_packs USING btree (article_code);


--
-- Name: idx_tp_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tp_status ON public.tech_packs USING btree (extraction_status);


--
-- Name: idx_trim_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trim_po_id ON public.trim_items USING btree (po_id);


--
-- Name: idx_user_profiles_approval; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_profiles_approval ON public.user_profiles USING btree (approval_status);


--
-- Name: idx_user_profiles_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_profiles_team ON public.user_profiles USING btree (team_id);


--
-- Name: idx_wa_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_class ON public.whatsapp_crawl USING btree (classification);


--
-- Name: idx_wa_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_sender ON public.whatsapp_crawl USING btree (sender);


--
-- Name: idx_wa_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_ts ON public.whatsapp_crawl USING btree (timestamp_utc DESC);


--
-- Name: idx_yarn_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_yarn_po_id ON public.yarn_requirements USING btree (po_id);


--
-- Name: master_articles_article_code_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX master_articles_article_code_ci ON public.master_articles USING btree (upper(TRIM(BOTH FROM article_code)));


--
-- Name: price_list_item_code_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX price_list_item_code_ci ON public.price_list USING btree (upper(TRIM(BOTH FROM item_code)));


--
-- Name: suppliers_name_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX suppliers_name_unique_idx ON public.suppliers USING btree (lower(name));


--
-- Name: uq_po_item_sizes_label; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_po_item_sizes_label ON public.po_item_sizes USING btree (po_item_id, size_label, COALESCE(color, ''::text));


--
-- Name: v_po_payment_summary _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.v_po_payment_summary AS
 SELECT po.id AS po_id,
    po.po_number,
    po.customer_name,
    po.total_po_value,
    po.currency AS po_currency,
    po.payment_structure,
    po.payment_terms,
    po.lc_type,
    po.lc_number,
    po.lc_bank,
    po.lc_tenor_days,
    po.lc_expiry,
    po.lc_latest_shipment_date,
    po.lc_presentation_days,
    po.tt_terms,
    COALESCE(sum(p.amount) FILTER (WHERE (p.status = ANY (ARRAY['Received'::text, 'Paid'::text, 'Completed'::text]))), (0)::numeric) AS amount_received,
    COALESCE(sum(p.amount) FILTER (WHERE ((p.status <> ALL (ARRAY['Received'::text, 'Paid'::text, 'Completed'::text])) OR (p.status IS NULL))), (0)::numeric) AS amount_pending,
    COALESCE(sum(p.amount), (0)::numeric) AS total_scheduled,
        CASE
            WHEN (po.total_po_value > (0)::numeric) THEN ((COALESCE(sum(p.amount) FILTER (WHERE (p.status = ANY (ARRAY['Received'::text, 'Paid'::text, 'Completed'::text]))), (0)::numeric) / po.total_po_value) * (100)::numeric)
            ELSE (0)::numeric
        END AS pct_received,
    count(p.id) AS milestone_count,
    count(p.id) FILTER (WHERE (p.status = ANY (ARRAY['Received'::text, 'Paid'::text, 'Completed'::text]))) AS milestones_completed
   FROM (public.purchase_orders po
     LEFT JOIN public.payments p ON ((p.po_id = po.id)))
  GROUP BY po.id;


--
-- Name: v_wip_status _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.v_wip_status AS
 SELECT cp.id AS plan_id,
    cp.po_id,
    cp.po_number,
    cp.article_code,
    cp.line_id,
    pl.name AS line_name,
    cp.stage_id,
    ps.name AS stage_name,
    ps.stage_order,
    cp.planned_qty,
    (COALESCE(sum(po.qty_produced), (0)::bigint))::integer AS produced_qty,
    (COALESCE(sum(po.qty_rejected), (0)::bigint))::integer AS rejected_qty,
        CASE
            WHEN (cp.planned_qty > 0) THEN round(((100.0 * (COALESCE(sum(po.qty_produced), (0)::bigint))::numeric) / (cp.planned_qty)::numeric), 1)
            ELSE (0)::numeric
        END AS completion_pct,
    cp.start_date,
    cp.end_date,
    cp.priority,
    cp.status,
    max(po.output_date) AS last_output_date
   FROM (((public.capacity_plans cp
     LEFT JOIN public.production_lines pl ON ((pl.id = cp.line_id)))
     LEFT JOIN public.production_stages ps ON ((ps.id = cp.stage_id)))
     LEFT JOIN public.production_output po ON (((po.po_id = cp.po_id) AND (po.line_id = cp.line_id) AND (po.stage_id = cp.stage_id))))
  GROUP BY cp.id, pl.name, ps.name, ps.stage_order;


--
-- Name: accessory_items trg_accessory_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accessory_updated BEFORE UPDATE ON public.accessory_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: articles trg_articles_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_articles_updated BEFORE UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: accessory_items trg_audit_accessory_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_accessory_items AFTER INSERT OR DELETE OR UPDATE ON public.accessory_items FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: articles trg_audit_articles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_articles AFTER INSERT OR DELETE OR UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: buyer_contacts trg_audit_buyer_contacts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_buyer_contacts AFTER INSERT OR DELETE OR UPDATE ON public.buyer_contacts FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: commercial_invoices trg_audit_commercial_invoices; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_commercial_invoices AFTER INSERT OR DELETE OR UPDATE ON public.commercial_invoices FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: costing_sheets trg_audit_costing_sheets; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_costing_sheets AFTER INSERT OR DELETE OR UPDATE ON public.costing_sheets FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: fabric_orders trg_audit_fabric_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_fabric_orders AFTER INSERT OR DELETE OR UPDATE ON public.fabric_orders FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: job_card_steps trg_audit_job_card_steps; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_job_card_steps AFTER INSERT OR DELETE OR UPDATE ON public.job_card_steps FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: job_cards trg_audit_job_cards; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_job_cards AFTER INSERT OR DELETE OR UPDATE ON public.job_cards FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: lab_dips trg_audit_lab_dips; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_lab_dips AFTER INSERT OR DELETE OR UPDATE ON public.lab_dips FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: master_articles trg_audit_master_articles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_master_articles AFTER INSERT OR DELETE OR UPDATE ON public.master_articles FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: payments trg_audit_payments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_payments AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: po_items trg_audit_po_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_po_items AFTER INSERT OR DELETE OR UPDATE ON public.po_items FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: purchase_orders trg_audit_purchase_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_purchase_orders AFTER INSERT OR DELETE OR UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: qc_inspections trg_audit_qc_inspections; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_qc_inspections AFTER INSERT OR DELETE OR UPDATE ON public.qc_inspections FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: rm_stock trg_audit_rm_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_rm_stock AFTER INSERT OR DELETE OR UPDATE ON public.rm_stock FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: samples trg_audit_samples; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_samples AFTER INSERT OR DELETE OR UPDATE ON public.samples FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: seasons trg_audit_seasons; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_seasons AFTER INSERT OR DELETE OR UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: shipments trg_audit_shipments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_shipments AFTER INSERT OR DELETE OR UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: signup_whitelist trg_audit_signup_whitelist; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_signup_whitelist AFTER INSERT OR DELETE OR UPDATE ON public.signup_whitelist FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: style_consumption trg_audit_style_consumption; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_style_consumption AFTER INSERT OR DELETE OR UPDATE ON public.style_consumption FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: suppliers trg_audit_suppliers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_suppliers AFTER INSERT OR DELETE OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: tech_packs trg_audit_tech_packs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_tech_packs AFTER INSERT OR DELETE OR UPDATE ON public.tech_packs FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: tna_milestones trg_audit_tna_milestones; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_tna_milestones AFTER INSERT OR DELETE OR UPDATE ON public.tna_milestones FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: trim_items trg_audit_trim_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_trim_items AFTER INSERT OR DELETE OR UPDATE ON public.trim_items FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: user_profiles trg_audit_user_profiles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_user_profiles AFTER INSERT OR DELETE OR UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: user_profiles trg_auto_approve; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auto_approve BEFORE INSERT ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.trg_auto_approve_whitelisted();


--
-- Name: purchase_orders trg_auto_bom; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auto_bom AFTER INSERT OR UPDATE OF status ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.trigger_auto_bom();


--
-- Name: po_batches trg_batch_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_batch_updated BEFORE UPDATE ON public.po_batches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: buyer_contacts trg_bc_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bc_updated BEFORE UPDATE ON public.buyer_contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: commercial_invoices trg_ci_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ci_updated BEFORE UPDATE ON public.commercial_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: complaints trg_complaint_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_complaint_updated BEFORE UPDATE ON public.complaints FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: samples trg_compute_sample_cost; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_compute_sample_cost BEFORE INSERT OR UPDATE OF quantity, rfq_id, quotation_id, po_id, style_number ON public.samples FOR EACH ROW EXECUTE FUNCTION public.compute_sample_cost();


--
-- Name: costing_sheets trg_costing_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_costing_updated BEFORE UPDATE ON public.costing_sheets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: job_cards trg_default_jc_steps; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_default_jc_steps AFTER INSERT ON public.job_cards FOR EACH ROW EXECUTE FUNCTION public.create_default_job_card_steps();


--
-- Name: fabric_orders trg_fabric_orders_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fabric_orders_updated BEFORE UPDATE ON public.fabric_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: fabric_templates trg_fabric_templates_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fabric_templates_updated BEFORE UPDATE ON public.fabric_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: job_cards trg_job_cards_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_job_cards_updated BEFORE UPDATE ON public.job_cards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: lab_dips trg_labdip_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_labdip_updated BEFORE UPDATE ON public.lab_dips FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: master_articles trg_norm_master_articles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_norm_master_articles BEFORE INSERT OR UPDATE OF article_code ON public.master_articles FOR EACH ROW EXECUTE FUNCTION public.fn_normalize_item_code();


--
-- Name: po_items trg_norm_po_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_norm_po_items BEFORE INSERT OR UPDATE OF item_code ON public.po_items FOR EACH ROW EXECUTE FUNCTION public.fn_normalize_item_code();


--
-- Name: price_list trg_norm_price_list; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_norm_price_list BEFORE INSERT OR UPDATE OF item_code ON public.price_list FOR EACH ROW EXECUTE FUNCTION public.fn_normalize_item_code();


--
-- Name: packing_lists trg_packing_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_packing_updated BEFORE UPDATE ON public.packing_lists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: print_layouts trg_pl_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pl_updated BEFORE UPDATE ON public.print_layouts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: po_items trg_po_items_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_po_items_updated BEFORE UPDATE ON public.po_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: purchase_orders trg_po_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_po_updated BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: price_list trg_price_list_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_price_list_updated BEFORE UPDATE ON public.price_list FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: quotations trg_quot_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_quot_updated BEFORE UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: rfqs trg_rfq_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rfq_updated BEFORE UPDATE ON public.rfqs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: samples trg_samples_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_samples_updated BEFORE UPDATE ON public.samples FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: job_cards trg_seed_jc_steps; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_seed_jc_steps AFTER INSERT ON public.job_cards FOR EACH ROW EXECUTE FUNCTION public.seed_job_card_steps();


--
-- Name: shipments trg_shipments_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_shipments_updated BEFORE UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: price_list trg_supersede_old_price; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_supersede_old_price AFTER INSERT OR UPDATE OF price_usd, effective_from ON public.price_list FOR EACH ROW EXECUTE FUNCTION public.supersede_old_price();


--
-- Name: suppliers trg_supplier_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_supplier_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: teams trg_teams_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_teams_updated BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: tna_calendars trg_tna_cal_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tna_cal_updated BEFORE UPDATE ON public.tna_calendars FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: tna_milestones trg_tna_ms_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tna_ms_updated BEFORE UPDATE ON public.tna_milestones FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: tech_packs trg_tp_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tp_updated BEFORE UPDATE ON public.tech_packs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: trim_items trg_trim_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trim_updated BEFORE UPDATE ON public.trim_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: yarn_requirements trg_yarn_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_yarn_updated BEFORE UPDATE ON public.yarn_requirements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: accessory_items accessory_items_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accessory_items
    ADD CONSTRAINT accessory_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: accessory_purchase_orders accessory_purchase_orders_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accessory_purchase_orders
    ADD CONSTRAINT accessory_purchase_orders_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: app_users app_users_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: articles articles_master_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_master_article_id_fkey FOREIGN KEY (master_article_id) REFERENCES public.master_articles(id) ON DELETE SET NULL;


--
-- Name: articles articles_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: articles articles_tech_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_tech_pack_id_fkey FOREIGN KEY (tech_pack_id) REFERENCES public.tech_packs(id) ON DELETE SET NULL;


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: batch_items batch_items_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_items
    ADD CONSTRAINT batch_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE CASCADE;


--
-- Name: batch_items batch_items_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_items
    ADD CONSTRAINT batch_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: batch_items batch_items_po_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_items
    ADD CONSTRAINT batch_items_po_item_id_fkey FOREIGN KEY (po_item_id) REFERENCES public.po_items(id) ON DELETE CASCADE;


--
-- Name: batch_split_snapshots batch_split_snapshots_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_split_snapshots
    ADD CONSTRAINT batch_split_snapshots_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE CASCADE;


--
-- Name: batch_split_snapshots batch_split_snapshots_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_split_snapshots
    ADD CONSTRAINT batch_split_snapshots_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: bom_explosion_log bom_explosion_log_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom_explosion_log
    ADD CONSTRAINT bom_explosion_log_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: capacity_plans capacity_plans_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_plans
    ADD CONSTRAINT capacity_plans_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL;


--
-- Name: capacity_plans capacity_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_plans
    ADD CONSTRAINT capacity_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: capacity_plans capacity_plans_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_plans
    ADD CONSTRAINT capacity_plans_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE SET NULL;


--
-- Name: capacity_plans capacity_plans_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_plans
    ADD CONSTRAINT capacity_plans_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: capacity_plans capacity_plans_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_plans
    ADD CONSTRAINT capacity_plans_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.production_stages(id) ON DELETE SET NULL;


--
-- Name: commercial_invoices commercial_invoices_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_invoices
    ADD CONSTRAINT commercial_invoices_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE SET NULL;


--
-- Name: commercial_invoices commercial_invoices_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_invoices
    ADD CONSTRAINT commercial_invoices_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: commercial_invoices commercial_invoices_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_invoices
    ADD CONSTRAINT commercial_invoices_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;


--
-- Name: comms_log comms_log_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comms_log
    ADD CONSTRAINT comms_log_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: complaints complaints_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.buyer_contacts(id) ON DELETE SET NULL;


--
-- Name: complaints complaints_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: complaints complaints_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: compliance_docs compliance_docs_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_docs
    ADD CONSTRAINT compliance_docs_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: consumption_library consumption_library_tech_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumption_library
    ADD CONSTRAINT consumption_library_tech_pack_id_fkey FOREIGN KEY (tech_pack_id) REFERENCES public.tech_packs(id) ON DELETE SET NULL;


--
-- Name: costing_sheets costing_sheets_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.costing_sheets
    ADD CONSTRAINT costing_sheets_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: crosscheck_discrepancies crosscheck_discrepancies_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crosscheck_discrepancies
    ADD CONSTRAINT crosscheck_discrepancies_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: crosscheck_discrepancies crosscheck_discrepancies_tech_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crosscheck_discrepancies
    ADD CONSTRAINT crosscheck_discrepancies_tech_pack_id_fkey FOREIGN KEY (tech_pack_id) REFERENCES public.tech_packs(id) ON DELETE CASCADE;


--
-- Name: customer_team_assignments customer_team_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_team_assignments
    ADD CONSTRAINT customer_team_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;


--
-- Name: customer_team_assignments customer_team_assignments_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_team_assignments
    ADD CONSTRAINT customer_team_assignments_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: email_crawl_log email_crawl_log_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_crawl_log
    ADD CONSTRAINT email_crawl_log_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: email_crawl email_crawl_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_crawl
    ADD CONSTRAINT email_crawl_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: fabric_orders fabric_orders_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fabric_orders
    ADD CONSTRAINT fabric_orders_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: user_profiles fk_user_team; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT fk_user_team FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;


--
-- Name: gcal_sync_log gcal_sync_log_tna_milestone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcal_sync_log
    ADD CONSTRAINT gcal_sync_log_tna_milestone_id_fkey FOREIGN KEY (tna_milestone_id) REFERENCES public.tna_milestones(id) ON DELETE CASCADE;


--
-- Name: gcal_sync_log gcal_sync_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gcal_sync_log
    ADD CONSTRAINT gcal_sync_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: job_card_steps job_card_steps_parent_job_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_card_steps
    ADD CONSTRAINT job_card_steps_parent_job_card_id_fkey FOREIGN KEY (parent_job_card_id) REFERENCES public.job_cards(id) ON DELETE CASCADE;


--
-- Name: job_cards job_cards_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cards
    ADD CONSTRAINT job_cards_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE SET NULL;


--
-- Name: job_cards job_cards_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_cards
    ADD CONSTRAINT job_cards_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: lab_dips lab_dips_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_dips
    ADD CONSTRAINT lab_dips_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE SET NULL;


--
-- Name: lab_dips lab_dips_manager_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_dips
    ADD CONSTRAINT lab_dips_manager_approved_by_fkey FOREIGN KEY (manager_approved_by) REFERENCES auth.users(id);


--
-- Name: lab_dips lab_dips_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_dips
    ADD CONSTRAINT lab_dips_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: master_article_changes master_article_changes_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_article_changes
    ADD CONSTRAINT master_article_changes_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.master_articles(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: packing_lists packing_lists_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_lists
    ADD CONSTRAINT packing_lists_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE SET NULL;


--
-- Name: packing_lists packing_lists_ci_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_lists
    ADD CONSTRAINT packing_lists_ci_id_fkey FOREIGN KEY (ci_id) REFERENCES public.commercial_invoices(id) ON DELETE SET NULL;


--
-- Name: packing_lists packing_lists_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_lists
    ADD CONSTRAINT packing_lists_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: packing_lists packing_lists_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packing_lists
    ADD CONSTRAINT packing_lists_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;


--
-- Name: payments payments_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE SET NULL;


--
-- Name: payments payments_ci_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_ci_id_fkey FOREIGN KEY (ci_id) REFERENCES public.commercial_invoices(id) ON DELETE SET NULL;


--
-- Name: payments payments_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: permission_denials permission_denials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_denials
    ADD CONSTRAINT permission_denials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: po_batches po_batches_parent_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_batches
    ADD CONSTRAINT po_batches_parent_batch_id_fkey FOREIGN KEY (parent_batch_id) REFERENCES public.po_batches(id) ON DELETE SET NULL;


--
-- Name: po_batches po_batches_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_batches
    ADD CONSTRAINT po_batches_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: po_change_log po_change_log_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_change_log
    ADD CONSTRAINT po_change_log_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: po_item_sizes po_item_sizes_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_item_sizes
    ADD CONSTRAINT po_item_sizes_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: po_item_sizes po_item_sizes_po_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_item_sizes
    ADD CONSTRAINT po_item_sizes_po_item_id_fkey FOREIGN KEY (po_item_id) REFERENCES public.po_items(id) ON DELETE CASCADE;


--
-- Name: po_items po_items_master_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_items
    ADD CONSTRAINT po_items_master_article_id_fkey FOREIGN KEY (master_article_id) REFERENCES public.master_articles(id) ON DELETE SET NULL;


--
-- Name: po_items po_items_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_items
    ADD CONSTRAINT po_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: print_layouts print_layouts_accessory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_layouts
    ADD CONSTRAINT print_layouts_accessory_item_id_fkey FOREIGN KEY (accessory_item_id) REFERENCES public.accessory_items(id) ON DELETE SET NULL;


--
-- Name: print_layouts print_layouts_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.print_layouts
    ADD CONSTRAINT print_layouts_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: production_output production_output_entered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_output
    ADD CONSTRAINT production_output_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES auth.users(id);


--
-- Name: production_output production_output_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_output
    ADD CONSTRAINT production_output_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE SET NULL;


--
-- Name: production_output production_output_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_output
    ADD CONSTRAINT production_output_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: production_output production_output_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_output
    ADD CONSTRAINT production_output_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.production_stages(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_supersedes_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supersedes_po_id_fkey FOREIGN KEY (supersedes_po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: qc_inspections qc_inspections_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_inspections
    ADD CONSTRAINT qc_inspections_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE SET NULL;


--
-- Name: qc_inspections qc_inspections_linked_milestone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_inspections
    ADD CONSTRAINT qc_inspections_linked_milestone_id_fkey FOREIGN KEY (linked_milestone_id) REFERENCES public.tna_milestones(id);


--
-- Name: qc_inspections qc_inspections_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qc_inspections
    ADD CONSTRAINT qc_inspections_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: quotation_items quotation_items_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_items
    ADD CONSTRAINT quotation_items_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(id) ON DELETE CASCADE;


--
-- Name: quotations quotations_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.buyer_contacts(id) ON DELETE SET NULL;


--
-- Name: quotations quotations_converted_to_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_converted_to_po_id_fkey FOREIGN KEY (converted_to_po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: quotations quotations_previous_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_previous_quote_id_fkey FOREIGN KEY (previous_quote_id) REFERENCES public.quotations(id) ON DELETE SET NULL;


--
-- Name: quotations quotations_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.rfqs(id) ON DELETE SET NULL;


--
-- Name: rfqs rfqs_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfqs
    ADD CONSTRAINT rfqs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.buyer_contacts(id) ON DELETE SET NULL;


--
-- Name: rfqs rfqs_converted_to_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfqs
    ADD CONSTRAINT rfqs_converted_to_po_id_fkey FOREIGN KEY (converted_to_po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: sample_invoices sample_invoices_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_invoices
    ADD CONSTRAINT sample_invoices_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id);


--
-- Name: sample_invoices sample_invoices_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_invoices
    ADD CONSTRAINT sample_invoices_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.rfqs(id);


--
-- Name: samples samples_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE SET NULL;


--
-- Name: samples samples_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.sample_invoices(id) ON DELETE SET NULL;


--
-- Name: samples samples_manager_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_manager_approved_by_fkey FOREIGN KEY (manager_approved_by) REFERENCES auth.users(id);


--
-- Name: samples samples_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: samples samples_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(id);


--
-- Name: samples samples_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.samples
    ADD CONSTRAINT samples_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.rfqs(id);


--
-- Name: shipments shipments_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE SET NULL;


--
-- Name: shipments shipments_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: shipping_doc_register shipping_doc_register_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_doc_register
    ADD CONSTRAINT shipping_doc_register_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: shipping_documents shipping_documents_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_documents
    ADD CONSTRAINT shipping_documents_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: shipping_documents shipping_documents_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_documents
    ADD CONSTRAINT shipping_documents_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;


--
-- Name: sku_review_queue sku_review_queue_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_review_queue
    ADD CONSTRAINT sku_review_queue_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL;


--
-- Name: sku_review_queue sku_review_queue_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_review_queue
    ADD CONSTRAINT sku_review_queue_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: sku_review_queue sku_review_queue_po_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sku_review_queue
    ADD CONSTRAINT sku_review_queue_po_item_id_fkey FOREIGN KEY (po_item_id) REFERENCES public.po_items(id) ON DELETE CASCADE;


--
-- Name: supplier_performance supplier_performance_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_performance
    ADD CONSTRAINT supplier_performance_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;


--
-- Name: teams teams_line_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_line_manager_id_fkey FOREIGN KEY (line_manager_id) REFERENCES public.user_profiles(id) ON DELETE SET NULL;


--
-- Name: teams teams_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.user_profiles(id) ON DELETE SET NULL;


--
-- Name: tech_packs tech_packs_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tech_packs
    ADD CONSTRAINT tech_packs_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: tna_calendars tna_calendars_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tna_calendars
    ADD CONSTRAINT tna_calendars_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE CASCADE;


--
-- Name: tna_calendars tna_calendars_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tna_calendars
    ADD CONSTRAINT tna_calendars_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: tna_calendars tna_calendars_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tna_calendars
    ADD CONSTRAINT tna_calendars_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.tna_templates(id) ON DELETE SET NULL;


--
-- Name: tna_milestones tna_milestones_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tna_milestones
    ADD CONSTRAINT tna_milestones_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.po_batches(id) ON DELETE CASCADE;


--
-- Name: tna_milestones tna_milestones_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tna_milestones
    ADD CONSTRAINT tna_milestones_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: tna_milestones tna_milestones_tna_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tna_milestones
    ADD CONSTRAINT tna_milestones_tna_id_fkey FOREIGN KEY (tna_id) REFERENCES public.tna_calendars(id) ON DELETE CASCADE;


--
-- Name: trim_items trim_items_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trim_items
    ADD CONSTRAINT trim_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id);


--
-- Name: user_profiles user_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: whatsapp_crawl whatsapp_crawl_linked_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_crawl
    ADD CONSTRAINT whatsapp_crawl_linked_po_id_fkey FOREIGN KEY (linked_po_id) REFERENCES public.purchase_orders(id);


--
-- Name: yarn_requirements yarn_requirements_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.yarn_requirements
    ADD CONSTRAINT yarn_requirements_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: accessory_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accessory_items ENABLE ROW LEVEL SECURITY;

--
-- Name: accessory_purchase_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accessory_purchase_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: accessory_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accessory_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: app_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

--
-- Name: article_packaging; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.article_packaging ENABLE ROW LEVEL SECURITY;

--
-- Name: articles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_owner_read ON public.audit_log FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = 'Owner'::text)))));


--
-- Name: audit_log audit_service; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_service ON public.audit_log TO service_role USING (true) WITH CHECK (true);


--
-- Name: accessory_items auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.accessory_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: accessory_purchase_orders auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.accessory_purchase_orders TO authenticated USING (true) WITH CHECK (true);


--
-- Name: article_packaging auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.article_packaging TO authenticated USING (true) WITH CHECK (true);


--
-- Name: articles auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.articles TO authenticated USING (true) WITH CHECK (true);


--
-- Name: batch_items auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.batch_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: batch_split_snapshots auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.batch_split_snapshots TO authenticated USING (true) WITH CHECK (true);


--
-- Name: buyer_contacts auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.buyer_contacts TO authenticated USING (true) WITH CHECK (true);


--
-- Name: commercial_invoices auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.commercial_invoices TO authenticated USING (true) WITH CHECK (true);


--
-- Name: comms_log auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.comms_log TO authenticated USING (true) WITH CHECK (true);


--
-- Name: complaints auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.complaints TO authenticated USING (true) WITH CHECK (true);


--
-- Name: compliance_docs auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.compliance_docs TO authenticated USING (true) WITH CHECK (true);


--
-- Name: costing_sheets auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.costing_sheets TO authenticated USING (true) WITH CHECK (true);


--
-- Name: crosscheck_discrepancies auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.crosscheck_discrepancies TO authenticated USING (true) WITH CHECK (true);


--
-- Name: customer_team_assignments auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.customer_team_assignments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: fabric_orders auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.fabric_orders TO authenticated USING (true) WITH CHECK (true);


--
-- Name: fabric_templates auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.fabric_templates TO authenticated USING (true) WITH CHECK (true);


--
-- Name: gcal_sync_log auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.gcal_sync_log TO authenticated USING (true) WITH CHECK (true);


--
-- Name: job_cards auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.job_cards TO authenticated USING (true) WITH CHECK (true);


--
-- Name: lab_dips auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.lab_dips TO authenticated USING (true) WITH CHECK (true);


--
-- Name: packing_lists auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.packing_lists TO authenticated USING (true) WITH CHECK (true);


--
-- Name: payments auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.payments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: permission_denials auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.permission_denials TO authenticated USING (true) WITH CHECK (true);


--
-- Name: po_batches auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.po_batches TO authenticated USING (true) WITH CHECK (true);


--
-- Name: po_change_log auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.po_change_log TO authenticated USING (true) WITH CHECK (true);


--
-- Name: price_list auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.price_list TO authenticated USING (true) WITH CHECK (true);


--
-- Name: print_layouts auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.print_layouts TO authenticated USING (true) WITH CHECK (true);


--
-- Name: qc_inspections auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.qc_inspections TO authenticated USING (true) WITH CHECK (true);


--
-- Name: quotation_items auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.quotation_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: quotations auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.quotations TO authenticated USING (true) WITH CHECK (true);


--
-- Name: rfqs auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.rfqs TO authenticated USING (true) WITH CHECK (true);


--
-- Name: samples auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.samples TO authenticated USING (true) WITH CHECK (true);


--
-- Name: seasons auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.seasons TO authenticated USING (true) WITH CHECK (true);


--
-- Name: shipping_doc_register auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.shipping_doc_register TO authenticated USING (true) WITH CHECK (true);


--
-- Name: supplier_performance auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.supplier_performance TO authenticated USING (true) WITH CHECK (true);


--
-- Name: teams auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.teams TO authenticated USING (true) WITH CHECK (true);


--
-- Name: tech_packs auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.tech_packs TO authenticated USING (true) WITH CHECK (true);


--
-- Name: tna_calendars auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.tna_calendars TO authenticated USING (true) WITH CHECK (true);


--
-- Name: tna_milestones auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.tna_milestones TO authenticated USING (true) WITH CHECK (true);


--
-- Name: tna_templates auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.tna_templates TO authenticated USING (true) WITH CHECK (true);


--
-- Name: trim_items auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.trim_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: yarn_requirements auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all ON public.yarn_requirements TO authenticated USING (true) WITH CHECK (true);


--
-- Name: shipping_documents auth_all_docs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_docs ON public.shipping_documents TO authenticated USING (true) WITH CHECK (true);


--
-- Name: email_crawl_log auth_all_email_crawl; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_email_crawl ON public.email_crawl_log TO authenticated USING (true) WITH CHECK (true);


--
-- Name: po_items auth_all_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_items ON public.po_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: status_logs auth_all_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_logs ON public.status_logs TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchase_orders auth_all_po; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_po ON public.purchase_orders TO authenticated USING (true) WITH CHECK (true);


--
-- Name: shipments auth_all_shipments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_shipments ON public.shipments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: sku_review_queue auth_all_sku_queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_sku_queue ON public.sku_review_queue TO authenticated USING (true) WITH CHECK (true);


--
-- Name: suppliers auth_all_suppliers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_suppliers ON public.suppliers TO authenticated USING (true) WITH CHECK (true);


--
-- Name: app_users auth_all_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_users ON public.app_users TO authenticated USING (true) WITH CHECK (true);


--
-- Name: accessory_templates authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.accessory_templates TO authenticated USING (true) WITH CHECK (true);


--
-- Name: batch_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.batch_items ENABLE ROW LEVEL SECURITY;

--
-- Name: batch_split_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.batch_split_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: bom_explosion_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bom_explosion_log ENABLE ROW LEVEL SECURITY;

--
-- Name: bom_explosion_log bom_log_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bom_log_all ON public.bom_explosion_log USING (true) WITH CHECK (true);


--
-- Name: buyer_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.buyer_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: capacity_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.capacity_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: capacity_plans capacity_plans_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY capacity_plans_read ON public.capacity_plans FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: capacity_plans capacity_plans_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY capacity_plans_write ON public.capacity_plans USING ((EXISTS ( SELECT 1
   FROM public.user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = ANY (ARRAY['Owner'::text, 'Manager'::text]))))));


--
-- Name: consumption_library cl_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cl_read ON public.consumption_library FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: consumption_library cl_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cl_write ON public.consumption_library USING ((EXISTS ( SELECT 1
   FROM public.user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = ANY (ARRAY['Owner'::text, 'Manager'::text, 'Merchandiser'::text]))))));


--
-- Name: commercial_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commercial_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: comms_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comms_log ENABLE ROW LEVEL SECURITY;

--
-- Name: complaints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_docs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_docs ENABLE ROW LEVEL SECURITY;

--
-- Name: consumption_library; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consumption_library ENABLE ROW LEVEL SECURITY;

--
-- Name: costing_sheets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.costing_sheets ENABLE ROW LEVEL SECURITY;

--
-- Name: crosscheck_discrepancies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crosscheck_discrepancies ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_team_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_team_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: email_crawl; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_crawl ENABLE ROW LEVEL SECURITY;

--
-- Name: email_crawl email_crawl_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_crawl_delete ON public.email_crawl FOR DELETE USING (true);


--
-- Name: email_crawl email_crawl_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_crawl_insert ON public.email_crawl FOR INSERT WITH CHECK (true);


--
-- Name: email_crawl_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_crawl_log ENABLE ROW LEVEL SECURITY;

--
-- Name: email_crawl email_crawl_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_crawl_read ON public.email_crawl FOR SELECT USING (true);


--
-- Name: email_crawl email_crawl_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_crawl_update ON public.email_crawl FOR UPDATE USING (true);


--
-- Name: fabric_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fabric_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: fabric_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fabric_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: gcal_sync_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gcal_sync_log ENABLE ROW LEVEL SECURITY;

--
-- Name: gmail_oauth; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gmail_oauth ENABLE ROW LEVEL SECURITY;

--
-- Name: gmail_oauth gmail_oauth_own_user; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gmail_oauth_own_user ON public.gmail_oauth TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: gmail_oauth gmail_oauth_service; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gmail_oauth_service ON public.gmail_oauth TO service_role USING (true) WITH CHECK (true);


--
-- Name: job_card_steps jcs_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jcs_all ON public.job_card_steps USING (true) WITH CHECK (true);


--
-- Name: job_card_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_card_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: job_cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_cards ENABLE ROW LEVEL SECURITY;

--
-- Name: lab_dips; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lab_dips ENABLE ROW LEVEL SECURITY;

--
-- Name: master_article_changes mac_auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mac_auth_all ON public.master_article_changes TO authenticated USING (true) WITH CHECK (true);


--
-- Name: master_article_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.master_article_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: master_articles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.master_articles ENABLE ROW LEVEL SECURITY;

--
-- Name: master_articles master_articles_auth_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY master_articles_auth_all ON public.master_articles TO authenticated USING (true) WITH CHECK (true);


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications own_notifs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_notifs ON public.notifications TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: packing_lists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.packing_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: permission_denials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permission_denials ENABLE ROW LEVEL SECURITY;

--
-- Name: po_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.po_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: po_change_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.po_change_log ENABLE ROW LEVEL SECURITY;

--
-- Name: po_item_sizes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.po_item_sizes ENABLE ROW LEVEL SECURITY;

--
-- Name: po_item_sizes po_item_sizes_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY po_item_sizes_read ON public.po_item_sizes FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: po_item_sizes po_item_sizes_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY po_item_sizes_write ON public.po_item_sizes USING ((EXISTS ( SELECT 1
   FROM public.user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = ANY (ARRAY['Owner'::text, 'Manager'::text, 'Merchandiser'::text]))))));


--
-- Name: po_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.po_items ENABLE ROW LEVEL SECURITY;

--
-- Name: price_list; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.price_list ENABLE ROW LEVEL SECURITY;

--
-- Name: price_list price_list_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_list_read ON public.price_list FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: price_list price_list_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_list_write ON public.price_list USING ((EXISTS ( SELECT 1
   FROM public.user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = ANY (ARRAY['Owner'::text, 'Manager'::text]))))));


--
-- Name: print_layouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.print_layouts ENABLE ROW LEVEL SECURITY;

--
-- Name: production_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.production_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: production_lines production_lines_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY production_lines_read ON public.production_lines FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: production_lines production_lines_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY production_lines_write ON public.production_lines USING ((EXISTS ( SELECT 1
   FROM public.user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = ANY (ARRAY['Owner'::text, 'Manager'::text]))))));


--
-- Name: production_output; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.production_output ENABLE ROW LEVEL SECURITY;

--
-- Name: production_output production_output_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY production_output_read ON public.production_output FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: production_output production_output_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY production_output_write ON public.production_output USING ((EXISTS ( SELECT 1
   FROM public.user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = ANY (ARRAY['Owner'::text, 'Manager'::text, 'Merchandiser'::text]))))));


--
-- Name: production_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.production_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: production_stages production_stages_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY production_stages_read ON public.production_stages FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: user_profiles profiles_anon_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_anon_select ON public.user_profiles FOR SELECT TO anon USING (true);


--
-- Name: user_profiles profiles_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_insert_own ON public.user_profiles FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = id));


--
-- Name: user_profiles profiles_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_authenticated ON public.user_profiles FOR SELECT TO authenticated USING (true);


--
-- Name: user_profiles profiles_service_role_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_service_role_all ON public.user_profiles TO service_role USING (true) WITH CHECK (true);


--
-- Name: user_profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.user_profiles FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: purchase_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: qc_inspections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qc_inspections ENABLE ROW LEVEL SECURITY;

--
-- Name: quotation_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;

--
-- Name: quotations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

--
-- Name: rfqs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;

--
-- Name: rm_stock; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rm_stock ENABLE ROW LEVEL SECURITY;

--
-- Name: rm_stock rm_stock_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rm_stock_all ON public.rm_stock TO authenticated USING (true) WITH CHECK (true);


--
-- Name: sample_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sample_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: sample_invoices sample_invoices_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sample_invoices_all ON public.sample_invoices USING (true) WITH CHECK (true);


--
-- Name: samples; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.samples ENABLE ROW LEVEL SECURITY;

--
-- Name: seasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: shipments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_doc_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_doc_register ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: sku_review_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sku_review_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: status_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.status_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: style_consumption style_cons_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY style_cons_all ON public.style_consumption TO authenticated USING (true) WITH CHECK (true);


--
-- Name: style_consumption; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.style_consumption ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_performance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_performance ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: tech_packs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tech_packs ENABLE ROW LEVEL SECURITY;

--
-- Name: tna_calendars; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tna_calendars ENABLE ROW LEVEL SECURITY;

--
-- Name: tna_milestones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tna_milestones ENABLE ROW LEVEL SECURITY;

--
-- Name: tna_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tna_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: trim_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trim_items ENABLE ROW LEVEL SECURITY;

--
-- Name: user_settings us_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY us_all ON public.user_settings USING (true) WITH CHECK (true);


--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_crawl wa_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wa_all ON public.whatsapp_crawl USING (true) WITH CHECK (true);


--
-- Name: whatsapp_crawl; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_crawl ENABLE ROW LEVEL SECURITY;

--
-- Name: yarn_requirements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.yarn_requirements ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict iFYNMkYRsroGmkjnx8HTtcPxfCeHuDboTbERJWjLZEEHnWdlU9v6HAQMPlMDe4m

