CREATE TABLE IF NOT EXISTS quicktagcloud_codexes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  selector_title TEXT,
  type TEXT,
  version TEXT,
  author TEXT,
  source TEXT,
  entry_count INTEGER NOT NULL DEFAULT 0,
  nsfw BOOLEAN NOT NULL DEFAULT FALSE,
  has_original BOOLEAN NOT NULL DEFAULT FALSE,
  asset_base_url TEXT NOT NULL,
  tree JSONB,
  contributors JSONB,
  source_url TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quicktagcloud_entries (
  codex_id TEXT NOT NULL REFERENCES quicktagcloud_codexes(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  category_path TEXT[] NOT NULL DEFAULT '{}',
  rating TEXT NOT NULL DEFAULT 'safe',
  tags TEXT NOT NULL DEFAULT '',
  negative TEXT,
  character_prompts JSONB,
  note TEXT,
  image_url TEXT,
  original_url TEXT,
  image_width INTEGER,
  image_height INTEGER,
  images JSONB,
  update_batches TEXT[] NOT NULL DEFAULT '{}',
  extra JSONB,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (codex_id, id)
);

CREATE INDEX IF NOT EXISTS quicktagcloud_entries_category_idx ON quicktagcloud_entries USING GIN (category_path);
CREATE INDEX IF NOT EXISTS quicktagcloud_entries_rating_idx ON quicktagcloud_entries (codex_id, rating);
CREATE INDEX IF NOT EXISTS quicktagcloud_entries_search_idx ON quicktagcloud_entries USING GIN (to_tsvector('simple', title || ' ' || tags));
