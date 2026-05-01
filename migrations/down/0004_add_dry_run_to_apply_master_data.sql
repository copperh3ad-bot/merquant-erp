-- migrations/down/0004_add_dry_run_to_apply_master_data.sql
--
-- Rolls back to the 0003 signature (without p_dry_run). The 0003 down
-- migration must run after this one to drop the function entirely.

DROP FUNCTION IF EXISTS public.fn_apply_master_data_extraction(uuid, jsonb, boolean, boolean);

-- Note: this leaves the function absent. Re-apply 0003 to restore the
-- p_dry_run-less signature if needed.
