PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS catalog_tags (
  rowid INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category INTEGER NOT NULL DEFAULT 0,
  post_count INTEGER NOT NULL DEFAULT 0,
  deprecated INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  aliases TEXT NOT NULL DEFAULT '',
  insertion TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalog_tags_name ON catalog_tags(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS catalog_tags_source ON catalog_tags(source, source_id);
CREATE TABLE IF NOT EXISTS catalog_wikis (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
  other_names TEXT NOT NULL, is_deleted INTEGER NOT NULL, raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalog_wikis_title ON catalog_wikis(title, is_deleted);
CREATE TABLE IF NOT EXISTS catalog_records (
  key TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL,
  source_id TEXT NOT NULL, raw_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_documents (
  key TEXT PRIMARY KEY, source TEXT NOT NULL, source_url TEXT NOT NULL,
  sha256 TEXT NOT NULL, raw_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_sync (
  key TEXT PRIMARY KEY, state_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_terms (
  term TEXT NOT NULL, tag_rowid INTEGER NOT NULL,
  PRIMARY KEY(term, tag_rowid)
);
CREATE TABLE IF NOT EXISTS catalog_translations (
  term TEXT NOT NULL, document_key TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY(term, document_key, kind)
);
CREATE VIRTUAL TABLE IF NOT EXISTS catalog_search USING fts5(
  name, display_name, aliases, description,
  content='catalog_tags', content_rowid='rowid', tokenize='trigram'
);
