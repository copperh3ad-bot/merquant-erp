-- Finding 5 — Group A (tier-2): master / reference tables.
--
-- SELECT → all authenticated. INSERT/UPDATE → Owner+Manager. DELETE → Owner.
-- Mirrors permissions.js TEAM_MANAGE / FABRIC_SPEC_EDIT (admin-managed
-- master data). Field-level redaction (e.g. buyer_contacts emails) stays
-- in the UI via FIELD_GROUPS.BUYER_CONTACT.
--
-- Tables covered (12):
--   master_articles, accessory_templates, fabric_templates, tna_templates,
--   seasons, teams, customer_team_assignments, app_users, buyer_contacts,
--   suppliers, supplier_performance, compliance_docs

-- Drop existing permissive policies
DROP POLICY IF EXISTS master_articles_auth_all      ON public.master_articles;
DROP POLICY IF EXISTS authenticated_full_access     ON public.accessory_templates;
DROP POLICY IF EXISTS auth_all                      ON public.fabric_templates;
DROP POLICY IF EXISTS auth_all                      ON public.tna_templates;
DROP POLICY IF EXISTS auth_all                      ON public.seasons;
DROP POLICY IF EXISTS auth_all                      ON public.teams;
DROP POLICY IF EXISTS auth_all                      ON public.customer_team_assignments;
DROP POLICY IF EXISTS auth_all_users                ON public.app_users;
DROP POLICY IF EXISTS auth_all                      ON public.buyer_contacts;
DROP POLICY IF EXISTS auth_all_suppliers            ON public.suppliers;
DROP POLICY IF EXISTS auth_all                      ON public.supplier_performance;
DROP POLICY IF EXISTS auth_all                      ON public.compliance_docs;

-- Idempotency: drop new names too
DROP POLICY IF EXISTS master_articles_select            ON public.master_articles;
DROP POLICY IF EXISTS master_articles_insert            ON public.master_articles;
DROP POLICY IF EXISTS master_articles_update            ON public.master_articles;
DROP POLICY IF EXISTS master_articles_delete            ON public.master_articles;
DROP POLICY IF EXISTS accessory_templates_select        ON public.accessory_templates;
DROP POLICY IF EXISTS accessory_templates_insert        ON public.accessory_templates;
DROP POLICY IF EXISTS accessory_templates_update        ON public.accessory_templates;
DROP POLICY IF EXISTS accessory_templates_delete        ON public.accessory_templates;
DROP POLICY IF EXISTS fabric_templates_select           ON public.fabric_templates;
DROP POLICY IF EXISTS fabric_templates_insert           ON public.fabric_templates;
DROP POLICY IF EXISTS fabric_templates_update           ON public.fabric_templates;
DROP POLICY IF EXISTS fabric_templates_delete           ON public.fabric_templates;
DROP POLICY IF EXISTS tna_templates_select              ON public.tna_templates;
DROP POLICY IF EXISTS tna_templates_insert              ON public.tna_templates;
DROP POLICY IF EXISTS tna_templates_update              ON public.tna_templates;
DROP POLICY IF EXISTS tna_templates_delete              ON public.tna_templates;
DROP POLICY IF EXISTS seasons_select                    ON public.seasons;
DROP POLICY IF EXISTS seasons_insert                    ON public.seasons;
DROP POLICY IF EXISTS seasons_update                    ON public.seasons;
DROP POLICY IF EXISTS seasons_delete                    ON public.seasons;
DROP POLICY IF EXISTS teams_select                      ON public.teams;
DROP POLICY IF EXISTS teams_insert                      ON public.teams;
DROP POLICY IF EXISTS teams_update                      ON public.teams;
DROP POLICY IF EXISTS teams_delete                      ON public.teams;
DROP POLICY IF EXISTS customer_team_assignments_select  ON public.customer_team_assignments;
DROP POLICY IF EXISTS customer_team_assignments_insert  ON public.customer_team_assignments;
DROP POLICY IF EXISTS customer_team_assignments_update  ON public.customer_team_assignments;
DROP POLICY IF EXISTS customer_team_assignments_delete  ON public.customer_team_assignments;
DROP POLICY IF EXISTS app_users_select                  ON public.app_users;
DROP POLICY IF EXISTS app_users_insert                  ON public.app_users;
DROP POLICY IF EXISTS app_users_update                  ON public.app_users;
DROP POLICY IF EXISTS app_users_delete                  ON public.app_users;
DROP POLICY IF EXISTS buyer_contacts_select             ON public.buyer_contacts;
DROP POLICY IF EXISTS buyer_contacts_insert             ON public.buyer_contacts;
DROP POLICY IF EXISTS buyer_contacts_update             ON public.buyer_contacts;
DROP POLICY IF EXISTS buyer_contacts_delete             ON public.buyer_contacts;
DROP POLICY IF EXISTS suppliers_select                  ON public.suppliers;
DROP POLICY IF EXISTS suppliers_insert                  ON public.suppliers;
DROP POLICY IF EXISTS suppliers_update                  ON public.suppliers;
DROP POLICY IF EXISTS suppliers_delete                  ON public.suppliers;
DROP POLICY IF EXISTS supplier_performance_select       ON public.supplier_performance;
DROP POLICY IF EXISTS supplier_performance_insert       ON public.supplier_performance;
DROP POLICY IF EXISTS supplier_performance_update       ON public.supplier_performance;
DROP POLICY IF EXISTS supplier_performance_delete       ON public.supplier_performance;
DROP POLICY IF EXISTS compliance_docs_select            ON public.compliance_docs;
DROP POLICY IF EXISTS compliance_docs_insert            ON public.compliance_docs;
DROP POLICY IF EXISTS compliance_docs_update            ON public.compliance_docs;
DROP POLICY IF EXISTS compliance_docs_delete            ON public.compliance_docs;

-- master_articles
CREATE POLICY master_articles_select ON public.master_articles FOR SELECT TO authenticated USING (true);
CREATE POLICY master_articles_insert ON public.master_articles FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY master_articles_update ON public.master_articles FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY master_articles_delete ON public.master_articles FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- accessory_templates
CREATE POLICY accessory_templates_select ON public.accessory_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY accessory_templates_insert ON public.accessory_templates FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY accessory_templates_update ON public.accessory_templates FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY accessory_templates_delete ON public.accessory_templates FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- fabric_templates
CREATE POLICY fabric_templates_select ON public.fabric_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY fabric_templates_insert ON public.fabric_templates FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY fabric_templates_update ON public.fabric_templates FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY fabric_templates_delete ON public.fabric_templates FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- tna_templates
CREATE POLICY tna_templates_select ON public.tna_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY tna_templates_insert ON public.tna_templates FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY tna_templates_update ON public.tna_templates FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY tna_templates_delete ON public.tna_templates FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- seasons
CREATE POLICY seasons_select ON public.seasons FOR SELECT TO authenticated USING (true);
CREATE POLICY seasons_insert ON public.seasons FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY seasons_update ON public.seasons FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY seasons_delete ON public.seasons FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- teams
CREATE POLICY teams_select ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY teams_insert ON public.teams FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY teams_update ON public.teams FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY teams_delete ON public.teams FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- customer_team_assignments
CREATE POLICY customer_team_assignments_select ON public.customer_team_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY customer_team_assignments_insert ON public.customer_team_assignments FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY customer_team_assignments_update ON public.customer_team_assignments FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY customer_team_assignments_delete ON public.customer_team_assignments FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- app_users (vestigial table; gated for safety)
CREATE POLICY app_users_select ON public.app_users FOR SELECT TO authenticated USING (true);
CREATE POLICY app_users_insert ON public.app_users FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY app_users_update ON public.app_users FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY app_users_delete ON public.app_users FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- buyer_contacts (row-level open SELECT; column-level redaction in UI via FIELD_GROUPS.BUYER_CONTACT)
CREATE POLICY buyer_contacts_select ON public.buyer_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY buyer_contacts_insert ON public.buyer_contacts FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY buyer_contacts_update ON public.buyer_contacts FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY buyer_contacts_delete ON public.buyer_contacts FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- suppliers
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY suppliers_insert ON public.suppliers FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY suppliers_delete ON public.suppliers FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- supplier_performance
CREATE POLICY supplier_performance_select ON public.supplier_performance FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_performance_insert ON public.supplier_performance FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY supplier_performance_update ON public.supplier_performance FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY supplier_performance_delete ON public.supplier_performance FOR DELETE TO authenticated USING (public.has_role('Owner'));

-- compliance_docs
CREATE POLICY compliance_docs_select ON public.compliance_docs FOR SELECT TO authenticated USING (true);
CREATE POLICY compliance_docs_insert ON public.compliance_docs FOR INSERT TO authenticated WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY compliance_docs_update ON public.compliance_docs FOR UPDATE TO authenticated USING (public.has_role('Owner', 'Manager')) WITH CHECK (public.has_role('Owner', 'Manager'));
CREATE POLICY compliance_docs_delete ON public.compliance_docs FOR DELETE TO authenticated USING (public.has_role('Owner'));
