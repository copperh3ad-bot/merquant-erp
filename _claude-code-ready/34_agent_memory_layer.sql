-- Migration: 34_agent_memory_layer
-- Agent memory layer for MerQuant ERP
-- Stores buyer history, supplier patterns, order context, and agent corrections
-- Uses Claude-summarised text memories (no vector store required)
-- Retrieval: keyword match + recency + relevance_score

-- ============================================================
-- 1. agent_memories — central memory store
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_memories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Memory classification
  memory_type      TEXT NOT NULL
                   CHECK (memory_type IN (
                     'buyer',        -- buyer behaviour, preferences, history
                     'supplier',     -- supplier reliability, patterns, pricing
                     'order',        -- order/article patterns, lead times
                     'correction'    -- human corrections to agent outputs
                   )),

  -- Entity this memory is about
  entity_type      TEXT NOT NULL
                   CHECK (entity_type IN (
                     'buyer', 'supplier', 'article', 'agent', 'po'
                   )),
  entity_id        TEXT NOT NULL,   -- buyer_name, supplier id, article sku, agent name
  entity_label     TEXT,            -- human-readable label for display

  -- Memory content
  summary          TEXT NOT NULL,   -- Claude-generated summary (1-3 sentences)
  detail           JSONB,           -- structured detail extracted by Claude
  raw_context      TEXT,            -- original source text (truncated)
  source_event     TEXT NOT NULL,   -- what triggered this memory
                   -- e.g. 'po_confirmed', 'email_sent', 'draft_corrected',
                   --      'tna_delay', 'qc_failure', 'payment_received'
  source_id        UUID,            -- FK to the source record (po_id, draft_id etc)

  -- Relevance and confidence
  confidence       NUMERIC(4,3) DEFAULT 1.0,  -- 0–1, lower for inferred patterns
  importance       INTEGER DEFAULT 2          -- 1=low 2=medium 3=high
                   CHECK (importance BETWEEN 1 AND 3),
  sentiment        TEXT
                   CHECK (sentiment IN ('positive', 'neutral', 'negative', NULL)),

  -- Retrieval helpers (keyword tags for fast lookup without vectors)
  tags             TEXT[] DEFAULT '{}',  -- searchable keywords
  keywords         TSVECTOR,             -- full-text search index

  -- Lifecycle
  valid_from       TIMESTAMPTZ DEFAULT NOW(),
  valid_until      TIMESTAMPTZ,           -- NULL = permanent
  superseded_by    UUID REFERENCES agent_memories(id) ON DELETE SET NULL,
  is_active        BOOLEAN DEFAULT true,

  -- Attribution
  created_by_agent TEXT,           -- which agent created this memory
  verified_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  verified_at      TIMESTAMPTZ,

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast retrieval
CREATE INDEX idx_memories_type_entity
  ON agent_memories(memory_type, entity_type, entity_id);

CREATE INDEX idx_memories_entity_id
  ON agent_memories(entity_id);

CREATE INDEX idx_memories_source_event
  ON agent_memories(source_event);

CREATE INDEX idx_memories_active_type
  ON agent_memories(memory_type, is_active)
  WHERE is_active = true;

CREATE INDEX idx_memories_created_at
  ON agent_memories(created_at DESC);

CREATE INDEX idx_memories_tags
  ON agent_memories USING gin(tags);

CREATE INDEX idx_memories_keywords
  ON agent_memories USING gin(keywords);

CREATE INDEX idx_memories_importance
  ON agent_memories(importance DESC, created_at DESC)
  WHERE is_active = true;

-- Auto-update keywords tsvector from summary + tags
CREATE OR REPLACE FUNCTION update_memory_keywords()
RETURNS TRIGGER AS $$
BEGIN
  NEW.keywords := to_tsvector('english',
    COALESCE(NEW.summary, '') || ' ' ||
    COALESCE(NEW.entity_label, '') || ' ' ||
    COALESCE(array_to_string(NEW.tags, ' '), '')
  );
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_memory_keywords
  BEFORE INSERT OR UPDATE ON agent_memories
  FOR EACH ROW EXECUTE FUNCTION update_memory_keywords();

-- RLS
ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners_managers_all_memories"
  ON agent_memories FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('Owner', 'Manager')
    )
  );

CREATE POLICY "merchandisers_read_memories"
  ON agent_memories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'Merchandiser'
    )
  );

-- ============================================================
-- 2. memory_retrieval_log — audit trail for what agents recalled
-- ============================================================

CREATE TABLE IF NOT EXISTS memory_retrieval_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name      TEXT NOT NULL,
  query_context   TEXT,            -- what the agent was doing
  entity_type     TEXT,
  entity_id       TEXT,
  memories_found  INTEGER DEFAULT 0,
  memory_ids      UUID[],          -- which memories were injected
  retrieved_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_memory_retrieval_agent
  ON memory_retrieval_log(agent_name, retrieved_at DESC);

-- ============================================================
-- 3. RPC: retrieve_memories_for_agent
--    Called by agents before acting — returns relevant memories
--    ordered by importance + recency, filtered by entity
-- ============================================================

CREATE OR REPLACE FUNCTION retrieve_memories_for_agent(
  p_entity_type  TEXT,
  p_entity_id    TEXT,
  p_memory_types TEXT[]   DEFAULT NULL,  -- NULL = all types
  p_limit        INTEGER  DEFAULT 10,
  p_query        TEXT     DEFAULT NULL   -- optional keyword search
)
RETURNS TABLE (
  id           UUID,
  memory_type  TEXT,
  entity_label TEXT,
  summary      TEXT,
  detail       JSONB,
  source_event TEXT,
  importance   INTEGER,
  sentiment    TEXT,
  confidence   NUMERIC,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.memory_type,
    m.entity_label,
    m.summary,
    m.detail,
    m.source_event,
    m.importance,
    m.sentiment,
    m.confidence,
    m.created_at
  FROM agent_memories m
  WHERE
    m.is_active = true
    AND m.entity_type  = p_entity_type
    AND m.entity_id    = p_entity_id
    AND (p_memory_types IS NULL OR m.memory_type = ANY(p_memory_types))
    AND (m.valid_until IS NULL OR m.valid_until > NOW())
    AND (
      p_query IS NULL
      OR m.keywords @@ plainto_tsquery('english', p_query)
    )
  ORDER BY
    m.importance DESC,
    m.created_at DESC
  LIMIT p_limit;
END;
$$;

-- ============================================================
-- 4. RPC: search_memories_by_keyword
--    Broader search across all entity types (for AI assistant)
-- ============================================================

CREATE OR REPLACE FUNCTION search_memories_by_keyword(
  p_query       TEXT,
  p_memory_type TEXT    DEFAULT NULL,
  p_limit       INTEGER DEFAULT 20
)
RETURNS TABLE (
  id           UUID,
  memory_type  TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_label TEXT,
  summary      TEXT,
  importance   INTEGER,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.memory_type,
    m.entity_type,
    m.entity_id,
    m.entity_label,
    m.summary,
    m.importance,
    m.created_at
  FROM agent_memories m
  WHERE
    m.is_active = true
    AND (p_memory_type IS NULL OR m.memory_type = p_memory_type)
    AND m.keywords @@ plainto_tsquery('english', p_query)
  ORDER BY
    ts_rank(m.keywords, plainto_tsquery('english', p_query)) DESC,
    m.importance DESC
  LIMIT p_limit;
END;
$$;

COMMENT ON TABLE agent_memories IS
  'Central memory store for all MerQuant agents. '
  'Stores buyer history, supplier patterns, order context, and agent corrections. '
  'Memories are Claude-summarised text — no vector store required. '
  'Retrieval uses full-text search + recency + importance scoring.';
