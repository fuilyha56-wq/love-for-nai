import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('tag_catalog_sync', ROOT / 'scripts/sync-tag-catalog.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CatalogSyncTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='lfn-catalog-test-')
        self.sync = module.CatalogSync(self.temporary.name)

    def tearDown(self):
        self.sync.db.close()
        self.temporary.cleanup()

    def test_keyset_cursor_uses_maximum_id_and_retains_zero_count_and_extra_fields(self):
        responses = [
            [{'id': 3, 'name': 'zero_count', 'post_count': 0, 'is_deprecated': True, 'unknown': {'keep': [1, 2]}}, {'id': 1, 'name': 'first'}],
            [{'id': 9, 'name': 'last'}, {'id': 6, 'name': 'middle'}], [],
        ]
        urls = []

        def fetch(url):
            urls.append(url)
            return b'', responses.pop(0)

        self.sync.fetch = fetch
        self.sync.crawl('tags', 1, 10)
        self.assertIn('page=a3', urls[1])
        self.assertIn('page=a9', urls[2])
        self.assertIn('search%5Bhide_empty%5D=false', urls[0])
        self.assertEqual(self.sync.db.execute('SELECT COUNT(*) FROM catalog_tags').fetchone()[0], 4)
        payload = json.loads(self.sync.db.execute("SELECT raw_json FROM catalog_tags WHERE name='zero_count'").fetchone()[0])
        self.assertEqual(payload['unknown'], {'keep': [1, 2]})
        self.assertTrue(payload['is_deprecated'])
        self.sync.crawl('tags', 1, 10)
        self.assertEqual(len(urls), 3)

    def test_unexpected_pagination_never_marks_an_incomplete_range_complete(self):
        self.sync.fetch = lambda _: (b'', [{'id': 20, 'name': 'outside'}])
        with self.assertRaises(ValueError):
            self.sync.crawl('tags', 1, 10)
        self.assertEqual(self.sync.db.execute('SELECT COUNT(*) FROM catalog_tags').fetchone()[0], 0)

    def test_full_wiki_body_and_deleted_flags_survive(self):
        body = 'Source text. ' * 2000
        record = {'id': 1, 'title': 'tag', 'body': body, 'other_names': ['别名'], 'is_deleted': True, 'extra': 'preserved'}
        self.sync.danbooru_page('wiki_pages', [record])
        row = self.sync.db.execute('SELECT body,is_deleted,raw_json FROM catalog_wikis').fetchone()
        self.assertEqual(row[:2], (body, 1))
        self.assertEqual(json.loads(row[2]), record)

    def test_every_quicktagcloud_codex_is_imported_without_rating_exclusions(self):
        files = {
            'codexes.json': [{'id': 'all', 'title': 'All', 'entryCount': 2, 'nsfw': True}],
            'all.json': {'entries': [
                {'id': 'a', 'title': 'A', 'tags': 'moon, white_hair', 'rating': 'safe', 'note': 'Complete note', 'unrecognized': {'x': 1}},
                {'id': 'b', 'title': 'B', 'tags': 'night', 'rating': 'unrestricted', 'note': 'Another complete note'},
            ]},
            'tutorials.json': {'body': 'Full original tutorial. ' * 100},
        }
        blobs = {name: module.encoded(value).encode() for name, value in files.items()}
        manifest = {'files': {name: {'sha256': hashlib.sha256(raw).hexdigest(), 'size': len(raw)} for name, raw in blobs.items()}}

        def fetch(url):
            if url.endswith('/current.json'):
                value = {'release': 'fixture'}
            elif url.endswith('/manifest.json'):
                value = manifest
            else:
                name = url.split('/fixture/')[1]
                return blobs[name], files[name]
            return module.encoded(value).encode(), value

        self.sync.fetch = fetch
        self.sync.quicktagcloud()
        self.assertEqual(self.sync.db.execute('SELECT COUNT(*) FROM catalog_tags').fetchone()[0], 2)
        self.assertEqual(json.loads(self.sync.db.execute("SELECT raw_json FROM catalog_tags WHERE key='quicktagcloud:all:a'").fetchone()[0])['unrecognized'], {'x': 1})
        tutorial = self.sync.db.execute("SELECT raw_json FROM catalog_documents WHERE key='quicktagcloud:fixture:tutorials.json'").fetchone()[0]
        self.assertEqual(json.loads(tutorial), files['tutorials.json'])
        self.sync.enrich()
        self.assertEqual(self.sync.db.execute("SELECT COUNT(*) FROM catalog_terms WHERE term='white_hair'").fetchone()[0], 1)

    def test_final_snapshot_opens_as_one_readonly_file_with_complete_search_and_description(self):
        body = 'Entire moonlight explanation. ' * 1000
        self.sync.danbooru_page('tags', [{'id': 1, 'name': 'white_hair', 'post_count': 0}])
        self.sync.danbooru_page('wiki_pages', [{'id': 1, 'title': 'white_hair', 'body': body}])
        report = self.sync.finalize()
        self.assertTrue(report['complete'])
        self.assertEqual(self.sync.db.execute('PRAGMA journal_mode').fetchone()[0], 'delete')
        file = Path(self.temporary.name) / 'catalog.sqlite3'
        self.sync.db.close()
        readonly = sqlite3.connect(file.as_uri() + '?mode=ro&immutable=1', uri=True)
        try:
            self.assertEqual(readonly.execute('SELECT description FROM catalog_tags').fetchone()[0], body)
            self.assertEqual(readonly.execute("SELECT COUNT(*) FROM catalog_search WHERE catalog_search MATCH 'moonlight'").fetchone()[0], 1)
            self.assertEqual(readonly.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
        finally:
            readonly.close()


if __name__ == '__main__':
    unittest.main()
