/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local acceptance data. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve('.tmp/launcher-test/data');
if (root !== path.resolve(process.cwd(), '.tmp', 'launcher-test', 'data')) throw Error('Unexpected fixture path');
const file = path.join(root, 'tag-catalog/catalog.sqlite3');
if (!fs.existsSync(file)) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(fs.readFileSync('resources/tag-catalog/schema.sql', 'utf8'));
    for (let i = 0; i < 12; i++) {
      const name = i ? `mountain_landscape_${i}` : 'mountain_landscape';
      const description = 'A mountain landscape with peaks and valleys. 山脉与河谷构成的风景。\n\n' + '描述画面中的地形、远近关系与光线。此条目为隔离布局验收数据。\n'.repeat(8);
      db.prepare('INSERT INTO catalog_tags(key,source,source_id,name,display_name,category,post_count,deprecated,description,aliases,insertion,source_url,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(`danbooru:layout-${i}`, 'danbooru', `layout-${i}`, name, i ? `山间风景 ${i}` : '山间风景', 0, 100 - i, 0, description, 'mountain landscape', name, 'https://example.invalid/source', JSON.stringify({ name, description, category: 0, post_count: 100 - i }));
    }
    db.prepare('INSERT INTO catalog_sync VALUES(?,?)').run('catalog:status', JSON.stringify({ complete: true, searchIndex: 'complete' }));
    db.exec("INSERT INTO catalog_search(catalog_search) VALUES('rebuild')");
  } finally { db.close(); }
}
const rewards = path.join(root, 'rewards/creator-rewards.json');
if (!fs.existsSync(rewards)) {
  fs.mkdirSync(path.dirname(rewards), { recursive: true });
  fs.writeFileSync(rewards, JSON.stringify({ campaigns: [{ id: 'layout-campaign', name: '山间旅行创作活动', enabled: true, summary: '描绘旅途中遇见的山与天空。', description: '## 创作主题\n\n用自己的作品记录旅途。', rules: '保留原创提示词并标明内容分级。', submissionReward: 2, weeklyRewards: [10, 5, 3], budget: 100, allowedRatings: ['general', 'r13'] }], grants: [] }));
}
console.log('Isolated launcher fixtures ready');
