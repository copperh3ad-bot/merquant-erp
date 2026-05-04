-- 35_supplier_ai_score.sql
--
-- Adds ai_score JSONB column to supplier_performance for the F7 AI
-- Supplier Performance Scorer feature. Stores Claude's structured
-- evaluation: {score, risk_category, recommendations[]}.

-- UP
ALTER TABLE public.supplier_performance
  ADD COLUMN IF NOT EXISTS ai_score jsonb;

-- DOWN
ALTER TABLE public.supplier_performance
  DROP COLUMN IF EXISTS ai_score;
