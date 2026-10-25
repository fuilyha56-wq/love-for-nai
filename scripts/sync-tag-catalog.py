#!/usr/bin/env python3
"""Lossless, resumable public Danbooru/QuickTagCloud catalog synchronization."""
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import re
from pathlib import Path
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DBOORU = 'https://danbooru.donmai.us'
QUICK = 'https://assets.quicktagcloud.com/data'
USER_AGENT = 'Love-for-NAI/0.1 (public tag catalog synchronization; metadata only)'


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


class CatalogSync:
    def __init__(self, directory, rate=4.0):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.directory / 'catalog.sqlite3', check_same_thread=False, timeout=120)
        self.db.executescript((ROOT / 'resources/tag-catalog/schema.sql').read_text(encoding='utf-8'))
        self.db.execute('PRAGMA synchronous=NORMAL')
        self.db.execute('PRAGMA cache_size=-32768')
        self.lock = threading.RLock()
        self.rate_lock = threading.Lock()
        self.next_request = 0
        self.interval = 1 / max(0.1, rate)
        self.last_progress = 0

    def state(self, key):
        with self.lock:
            row = self.db.execute('SELECT state_json FROM catalog_sync WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def save_state(self, key, state):
        self.db.execute('INSERT INTO catalog_sync VALUES(?,?) ON CONFLICT(key) DO UPDATE SET state_json=excluded.state_json', (key, encoded(state)))

    def fetch(self, url):
        for attempt in range(12):
            with self.rate_lock:
                delay = max(0, self.next_request - time.monotonic())
                self.next_request = max(self.next_request, time.monotonic()) + self.interval
            if delay:
                time.sleep(delay)
            try:
                request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
                with urllib.request.urlopen(request, timeout=90) as response:
                    raw = response.read()
                return raw, json.loads(raw)
            except (urllib.error.URLError, OSError, json.JSONDecodeError) as error:
                if isinstance(error, urllib.error.HTTPError) and error.code in (401, 403, 404):
                    raise
                if attempt == 11:
                    raise
                delay = min(30, 2 ** min(attempt, 5))
                if isinstance(error, urllib.error.HTTPError):
                    delay = max(delay, min(120, int(error.headers.get('Retry-After', '0') or 0)))
                print(encoded({'retry': attempt + 1, 'url': url, 'error': type(error).__name__}), flush=True)
                time.sleep(delay)

    def document(self, key, source, url, raw):
        self.db.execute('INSERT INTO catalog_documents VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET source_url=excluded.source_url,sha256=excluded.sha256,raw_json=excluded.raw_json',
                        (key, source, url, hashlib.sha256(raw).hexdigest(), raw.decode('utf-8-sig')))

    def upsert_tag(self, key, source, source_id, name, display_name, category, count, deprecated, description, aliases, insertion, url, raw):
        self.db.execute('''INSERT INTO catalog_tags(key,source,source_id,name,display_name,category,post_count,deprecated,description,aliases,insertion,source_url,raw_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
          name=excluded.name,display_name=excluded.display_name,category=excluded.category,post_count=excluded.post_count,
          deprecated=excluded.deprecated,description=excluded.description,aliases=excluded.aliases,insertion=excluded.insertion,source_url=excluded.source_url,raw_json=excluded.raw_json''',
          (key, source, str(source_id), name, display_name, category, count, int(deprecated), description, aliases, insertion, url, encoded(raw)))

    def danbooru_page(self, endpoint, records):
        for record in records:
            identity = record['id']
            if endpoint == 'tags':
                name = record['name']
                self.upsert_tag(f'danbooru:{identity}', 'danbooru', identity, name, name.replace('_', ' '),
                                record.get('category', 0), record.get('post_count', 0), record.get('is_deprecated', False),
                                '', '', name, f'{DBOORU}/wiki_pages/{urllib.parse.quote(name, safe="")}', record)
            elif endpoint == 'wiki_pages':
                self.db.execute('INSERT INTO catalog_wikis VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,other_names=excluded.other_names,is_deleted=excluded.is_deleted,raw_json=excluded.raw_json',
                                (identity, record['title'], record.get('body', ''), encoded(record.get('other_names', [])), int(record.get('is_deleted', False)), encoded(record)))
            else:
                self.db.execute('INSERT INTO catalog_records VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET raw_json=excluded.raw_json',
                                (f'danbooru:{endpoint}:{identity}', 'danbooru', endpoint, str(identity), encoded(record)))

    def crawl(self, endpoint, lower, upper, extra=None):
        extra = extra or {}
        key = f'danbooru:{endpoint}:{encoded(extra)}:{lower}:{upper}'
        state = self.state(key) or {'cursor': lower - 1, 'count': 0, 'complete': False, 'lower': lower, 'upper': upper, 'startedAt': timestamp()}
        if state['complete']:
            return
        while True:
            params = {'limit': 1000, 'page': f'a{state["cursor"]}', 'search[id]': f'{lower}..{upper}', **extra}
            if endpoint == 'tags':
                params['search[hide_empty]'] = 'false'
            url = f'{DBOORU}/{endpoint}.json?{urllib.parse.urlencode(params)}'
            _, records = self.fetch(url)
            if not isinstance(records, list):
                raise ValueError(f'{endpoint} did not return a record list')
            ids = [record['id'] for record in records]
            if ids and (min(ids) <= state['cursor'] or min(ids) < lower or max(ids) > upper or len(set(ids)) != len(ids)):
                raise ValueError(f'Unexpected keyset pagination in {endpoint}; no cursor was advanced')
            with self.lock:
                self.danbooru_page(endpoint, records)
                state = {**state, 'cursor': max(ids) if ids else state['cursor'], 'count': state['count'] + len(records), 'complete': not records, 'updatedAt': timestamp()}
                self.save_state(key, state)
                self.db.commit()
                if time.monotonic() - self.last_progress > 15 or state['complete']:
                    print(encoded({'source': endpoint, 'range': [lower, upper], 'cursor': state['cursor'], 'records': state['count'], 'complete': state['complete']}), flush=True)
                    self.last_progress = time.monotonic()
            if not records:
                return

    def danbooru(self, workers=6):
        snapshot = self.state('danbooru:snapshot')
        if not snapshot:
            snapshot = {'startedAt': timestamp(), 'maxIds': {}, 'complete': False, 'filters': 'No category, rating, popularity or deprecation exclusions; deleted wiki pages included separately.'}
            for endpoint in ('tags', 'wiki_pages', 'tag_aliases', 'tag_implications'):
                _, records = self.fetch(f'{DBOORU}/{endpoint}.json?limit=1&page=b999999999')
                if endpoint == 'wiki_pages':
                    _, deleted = self.fetch(f'{DBOORU}/{endpoint}.json?limit=1&page=b999999999&search%5Bis_deleted%5D=true')
                    records += deleted
                snapshot['maxIds'][endpoint] = max((item['id'] for item in records), default=0)
            with self.lock:
                self.save_state('danbooru:snapshot', snapshot)
                self.db.commit()
        tasks = []
        for endpoint, maximum in snapshot['maxIds'].items():
            shards = 8 if endpoint == 'tags' else 2
            step = max(1, (maximum + shards - 1) // shards)
            for lower in range(1, maximum + 1, step):
                upper = min(maximum, lower + step - 1)
                extras = [{'search[is_deleted]': 'false'}, {'search[is_deleted]': 'true'}] if endpoint == 'wiki_pages' else [{}]
                tasks.extend((endpoint, lower, upper, extra) for extra in extras)
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(self.crawl, *task) for task in tasks]
            for future in concurrent.futures.as_completed(futures):
                future.result()
        with self.lock:
            self.save_state('danbooru:snapshot', {**snapshot, 'complete': True, 'completedAt': timestamp()})
            self.db.commit()

    def quicktagcloud(self):
        raw, pointer = self.fetch(f'{QUICK}/current.json')
        release = pointer['release']
        release_base = f'{QUICK}/releases/{release}'
        manifest_raw, manifest = self.fetch(f'{release_base}/manifest.json')
        with self.lock:
            self.document('quicktagcloud:current', 'quicktagcloud', f'{QUICK}/current.json', raw)
            self.document(f'quicktagcloud:{release}:manifest', 'quicktagcloud', f'{release_base}/manifest.json', manifest_raw)
            self.save_state('quicktagcloud:snapshot', {'release': release, 'complete': False, 'startedAt': timestamp(), 'manifestFiles': len(manifest['files'])})
            self.db.commit()
        documents = {}
        for name, metadata in manifest['files'].items():
            url = f'{release_base}/{name}'
            key = f'quicktagcloud:{release}:{name}'
            with self.lock:
                cached = self.db.execute('SELECT raw_json,sha256 FROM catalog_documents WHERE key=?', (key,)).fetchone()
            if cached and cached[1] == metadata['sha256']:
                document = json.loads(cached[0])
            else:
                raw, document = self.fetch(url)
                if hashlib.sha256(raw).hexdigest() != metadata['sha256'] or len(raw) != metadata['size']:
                    raise ValueError(f'QuickTagCloud manifest verification failed: {name}')
                with self.lock:
                    self.document(key, 'quicktagcloud', url, raw)
                    self.db.commit()
            documents[name] = document
            print(encoded({'source': 'quicktagcloud', 'file': name, 'manifestVerified': True}), flush=True)
        codexes = documents['codexes.json']
        imported = 0
        for codex in codexes:
            identity = codex['id']
            document = documents.get(f'{identity}.json')
            if document is None:
                raise ValueError(f'Catalog references an unavailable codex: {identity}')
            entries = document.get('entries', [])
            with self.lock:
                self.db.execute('INSERT INTO catalog_records VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET raw_json=excluded.raw_json',
                                (f'quicktagcloud:codex:{identity}', 'quicktagcloud', 'codex', identity, encoded({'catalog': codex, 'document': {k: v for k, v in document.items() if k != 'entries'}})))
                seen = set()
                for position, entry in enumerate(entries):
                    source_id = str(entry.get('id', entry.get('assetId', position)))
                    if source_id in seen:
                        raise ValueError(f'Duplicate source entry ID in {identity}: {source_id}; raw document retained')
                    seen.add(source_id)
                    prompt = str(entry.get('tags', '') or '')
                    title = str(entry.get('title', source_id))
                    note = entry.get('note', '')
                    if not isinstance(note, str):
                        note = encoded(note)
                    description = '\n'.join(part for part in [codex.get('title', ''), ' / '.join(map(str, entry.get('path', []))), note] if part)
                    self.upsert_tag(f'quicktagcloud:{identity}:{source_id}', 'quicktagcloud', f'{identity}:{source_id}', prompt or title, title,
                                    6, 0, False, description, '', prompt,
                                    f'https://novelai.quicktagcloud.com/?codex={urllib.parse.quote(identity)}&entry={urllib.parse.quote(source_id)}', entry)
                imported += len(entries)
                self.save_state(f'quicktagcloud:codex:{identity}', {'imported': len(entries), 'declared': codex.get('entryCount'), 'release': release, 'complete': True})
                self.db.commit()
        # All community posts, indexes, translations and tutorials also remain in
        # catalog_documents verbatim, even when not a codex suggestion entry.
        with self.lock:
            self.save_state('quicktagcloud:snapshot', {'release': release, 'complete': True, 'completedAt': timestamp(), 'manifestFiles': len(documents), 'codexes': len(codexes), 'entries': imported})
            self.db.commit()
        print(encoded({'source': 'quicktagcloud', 'complete': True, 'codexes': len(codexes), 'entries': imported}), flush=True)

    def finalize(self):
        print('Linking complete wiki descriptions and building the full-text index...', flush=True)
        with self.lock:
            self.save_state('catalog:status', {'complete': False, 'searchIndex': 'pending', 'startedAt': timestamp()})
            self.db.commit()
            self.enrich()
            self.db.execute('''UPDATE catalog_tags SET
              description=COALESCE((SELECT body FROM catalog_wikis WHERE title=catalog_tags.name ORDER BY is_deleted,id DESC LIMIT 1),''),
              aliases=COALESCE((SELECT other_names FROM catalog_wikis WHERE title=catalog_tags.name ORDER BY is_deleted,id DESC LIMIT 1),'')
              WHERE source='danbooru' ''')
            self.db.execute("INSERT INTO catalog_search(catalog_search) VALUES('rebuild')")
            self.db.execute('ANALYZE')
            counts = {source: count for source, count in self.db.execute('SELECT source,COUNT(*) FROM catalog_tags GROUP BY source')}
            counts['wikiPages'] = self.db.execute('SELECT COUNT(*) FROM catalog_wikis').fetchone()[0]
            counts['rawDocuments'] = self.db.execute('SELECT COUNT(*) FROM catalog_documents').fetchone()[0]
            counts['sourceRecords'] = self.db.execute('SELECT COUNT(*) FROM catalog_records').fetchone()[0]
            counts['translations'] = self.db.execute('SELECT COUNT(*) FROM catalog_translations').fetchone()[0]
            counts['indexedPromptTerms'] = self.db.execute('SELECT COUNT(*) FROM catalog_terms').fetchone()[0]
            counts['withoutSourceDescription'] = self.db.execute("SELECT COUNT(*) FROM catalog_tags WHERE source='danbooru' AND description=''").fetchone()[0]
            report = {'complete': True, 'completedAt': timestamp(), 'counts': counts, 'noRatingFilters': True, 'noPopularityFilters': True, 'missingDescriptions': 'Source did not provide a wiki body; no descriptions were invented.', 'rawSourceRecordsRetained': True, 'searchIndex': 'complete'}
            self.db.commit()
            check = self.db.execute('PRAGMA integrity_check').fetchone()[0]
            if check != 'ok':
                raise ValueError(f'SQLite integrity check failed: {check}')
            self.save_state('catalog:status', report)
            self.db.commit()
            if self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0] != 0:
                raise RuntimeError('Catalog checkpoint is busy; close existing readers before exporting this snapshot')
            self.db.execute('PRAGMA journal_mode=DELETE')
        (self.directory / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(encoded(report), flush=True)
        return report

    def enrich(self):
        # A source prompt is never rewritten. Atomic tags are a separate lookup
        # index pointing back to the complete, unchanged source entry.
        self.db.executescript((ROOT / 'resources/tag-catalog/schema.sql').read_text(encoding='utf-8'))
        codex_files = {row[0].split(':')[-1] + '.json' for row in self.db.execute("SELECT key FROM catalog_records WHERE source='quicktagcloud' AND kind='codex'")}
        documents = self.db.execute("SELECT key,source_url,raw_json FROM catalog_documents WHERE source='quicktagcloud'").fetchall()
        supplemental = 0
        for key, url, raw in documents:
            document = json.loads(raw)
            if not isinstance(document, dict):
                continue
            filename = key.split(':', 2)[-1]
            if filename.startswith('tag_zh/'):
                for kind in ('m', 'd', 'a'):
                    translations = document.get(kind, {})
                    if isinstance(translations, dict):
                        self.db.executemany('INSERT OR REPLACE INTO catalog_translations VALUES(?,?,?,?)',
                          ((str(term).strip().lower().replace(' ', '_'), key, kind, value if isinstance(value, str) else encoded(value)) for term, value in translations.items()))
            entries = document.get('entries')
            if filename not in codex_files and isinstance(entries, list):
                for index, entry in enumerate(entries):
                    if not isinstance(entry, dict):
                        continue
                    source_id = f'{filename}:{index}:{entry.get("id", index)}'
                    prompt = str(entry.get('tags', entry.get('prompt', '')) or '')
                    title = str(entry.get('title', entry.get('name', source_id)))
                    note = entry.get('note', entry.get('description', ''))
                    self.upsert_tag(f'quicktagcloud:document:{source_id}', 'quicktagcloud', source_id,
                                    prompt or title, title, 6, 0, False, note if isinstance(note, str) else encoded(note), '', prompt, url, entry)
                    supplemental += 1
        rows = self.db.execute("SELECT rowid,insertion FROM catalog_tags WHERE source='quicktagcloud'").fetchall()
        for rowid, prompt in rows:
            terms = set()
            for fragment in re.split(r'(?<!\\),|\n', prompt):
                term = re.sub(r'^\s*[+-]?\d+(?:\.\d+)?::\s*', '', fragment.strip())
                term = re.sub(r'::\s*$', '', term).strip().strip('{}[]').strip()
                if term:
                    terms.add(re.sub(r'\s+', '_', term.lower()))
            self.db.executemany('INSERT OR IGNORE INTO catalog_terms VALUES(?,?)', ((term, rowid) for term in terms))
        print(encoded({'source': 'quicktagcloud', 'supplementalEntries': supplemental, 'translations': self.db.execute('SELECT COUNT(*) FROM catalog_translations').fetchone()[0], 'indexedPromptTerms': self.db.execute('SELECT COUNT(*) FROM catalog_terms').fetchone()[0]}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', default=str(Path(os.environ.get('LFN_DATA_DIR', ROOT / 'data')) / 'tag-catalog'))
    parser.add_argument('--sources', choices=['all', 'danbooru', 'quicktagcloud'], default='all')
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--rate', type=float, default=4)
    parser.add_argument('--refresh', action='store_true', help='Start a new Danbooru snapshot, keeping all stored source records')
    parser.add_argument('--index-only', action='store_true', help='Rebuild all derived indexes from retained original data without network requests')
    arguments = parser.parse_args()
    sync = CatalogSync(arguments.directory, arguments.rate)
    try:
        if arguments.index_only:
            if not all((sync.state(key) or {}).get('complete') for key in ['danbooru:snapshot', 'quicktagcloud:snapshot']):
                raise RuntimeError('Both original source snapshots must be complete before rebuilding indexes')
            sync.finalize()
            return
        if arguments.refresh:
            sync.db.execute("DELETE FROM catalog_sync WHERE key LIKE 'danbooru:%' OR key='catalog:status'")
            sync.save_state('catalog:status', {'complete': False, 'searchIndex': 'pending', 'startedAt': timestamp()})
            sync.db.commit()
        if arguments.sources == 'all':
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(sync.danbooru, arguments.workers), pool.submit(sync.quicktagcloud)]
                for future in concurrent.futures.as_completed(futures):
                    future.result()
        elif arguments.sources == 'danbooru':
            sync.danbooru(arguments.workers)
        else:
            sync.quicktagcloud()
        required = ['danbooru:snapshot', 'quicktagcloud:snapshot']
        if all((sync.state(key) or {}).get('complete') for key in required):
            sync.finalize()
        else:
            print(encoded({'complete': False, 'reason': 'One or more requested source snapshots are not complete; source data has been retained.'}), flush=True)
    finally:
        sync.db.close()


if __name__ == '__main__':
    main()
