CREATE TABLE IF NOT EXISTS quicktagcloud_artist_entries (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category_path TEXT[] NOT NULL,
  rating TEXT NOT NULL,
  tags TEXT NOT NULL,
  note TEXT,
  image_path TEXT,
  original_path TEXT,
  image_width INTEGER,
  image_height INTEGER,
  update_batches TEXT[] NOT NULL DEFAULT '{}',
  is_new BOOLEAN NOT NULL DEFAULT FALSE,
  asset_revision TEXT,
  source_url TEXT NOT NULL,
  source_version TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quicktagcloud_artist_entries_category_idx
  ON quicktagcloud_artist_entries USING GIN (category_path);
CREATE INDEX IF NOT EXISTS quicktagcloud_artist_entries_rating_idx
  ON quicktagcloud_artist_entries (rating);
CREATE INDEX IF NOT EXISTS quicktagcloud_artist_entries_title_idx
  ON quicktagcloud_artist_entries USING GIN (to_tsvector('simple', title || ' ' || tags));