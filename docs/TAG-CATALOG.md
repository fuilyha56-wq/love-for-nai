# 完整标签数据库

本地数据库：`data/tag-catalog/catalog.sqlite3`。运行时可用 `LFN_TAG_CATALOG_PATH` 指定另一份 SQLite 文件；默认读取 `LFN_DATA_DIR/tag-catalog/catalog.sqlite3`。需要 Node.js 22.13 或更新版本；生产 Docker 基础镜像为 Node.js 22.19。

## 同步与完整性

```powershell
python scripts/sync-tag-catalog.py --workers 6 --rate 4
```

默认继续同一个快照；再次更新到最新数据时增加 `--refresh`。这会重置抓取游标并重新读取全部 Danbooru 记录，不删除已存的原始数据。

已抓完全部原始数据、只需重建翻译、组合提示词及全文索引时，运行 `python scripts/sync-tag-catalog.py --index-only`，不再发出网络请求。

同步按 ID 快照边界做断点续传，不设置分类、评级、使用次数、弃用状态过滤。Danbooru 标签、公开可读的完整 wiki（包括已删除标记的词条）、别名和蕴含关系保留原始 JSON 全部字段。QuickTagCloud 按 `current.json` 的发布版本读取 manifest，逐文件核对 SHA-256 和大小；全部法典、辅助索引、翻译、教程及公开原始 JSON 都保存在数据库中。原站未提供定义的条目明确标记缺失，不编造原文。

`catalog_sync` 保存每个 ID 区间的游标、数量和完成状态。只有所有数据源抓完、全文索引建立完成，并通过 SQLite `integrity_check` 后，`catalog:status.complete` 才为 true。断点续传不删除已经抓取的源记录。

`catalog_tags` 保存可联想的标签及原始提示词；`catalog_wikis` 保存完整原文；`catalog_records` 保存别名、蕴含与法典元信息；`catalog_documents` 保存 QuickTagCloud 原始完整 JSON 和来源校验值；`catalog_terms` 仅作为组合提示词的独立标签检索索引，不改写原始提示词；`catalog_translations` 保留各源翻译；`catalog_search` 是可重建的 FTS5 索引。

## 使用

- `/api/tags?q=white_hair`：Danbooru 和 QuickTagCloud 共同参与联想，结果量上限仅限制单次返回，不删减数据库。
- `/api/tags?key=danbooru:123`：完整说明与全部原始字段。
- `/api/tags?status=1`：同步版本、完整性和数量。
- `/tags`：检索、查看完整介绍和原始记录。
- 标签助手自主选择本地库、在线 Danbooru 或在线 QuickTagCloud，也可交叉查证；用户在需求中指定来源时优先遵守。步骤名称展示实际使用的来源，在线工具不会静默改成本地结果。
- 本地工具：`search_tag_catalog`（可指定 `source: danbooru|quicktagcloud`）、`read_tag_catalog`、`tag_catalog_status`。搜索优先匹配精确独立标签，QuickTagCloud 候选仅附标题、键和匹配信息；选中词条后再读取完整组合，避免无关提示词进入模型上下文。数据库和完整详情没有删减。
- 在线 Danbooru：`search_danbooru_tags`、`verify_danbooru_tag`、`read_danbooru_wiki`。
- 在线 QuickTagCloud：`list_quicktagcloud_codexes` → `search_quicktagcloud_tags {codexId, query}` → `read_quicktagcloud_entry {codexId, entryId}`。目录版本缓存 2 分钟，只加载选中的目录、保留一个目录缓存，按发布清单校验大小和 SHA-256。单目录读取上限 26MiB；超限或网络失败明确报告，助手可选择本地完整库。
- 目标 Agent 按 `goalRunId` 隔离上下文，新目标不继承旧目标或普通对话。上游内容拦截以结构化错误返回并暂停；不自动重试、切模型或触发下一轮生成。
- 在线 QuickTagCloud 搜索会提示剩余工具预算，优先读取完整词条。预算耗尽或模型直接给结论却未读取原文时，暂停任务并说明；不把候选摘要作为已读完整介绍返回。
- 助手优先使用原生函数调用；响应的调用 ID、函数名和结果成对回传，工具步骤由服务器实际执行后记录。要求检索时使用 required 工具选择，未执行工具的文字自述不能作为检索结论。仅在上游明确报“不支持工具参数”且还没有原生工具历史时，兼容一次纯文本 action 协议；内容拒绝不触发兼容重试。
- 普通查询只发送用户显式附上的图片，不自动混入最近作品。目标 Agent 的参考图与每轮结果仍由对应操作明确发送。
- 单次模型响应等待上限 125 秒，后台任务 6 分钟；客户端等待窗口为后台上限加 30 秒，轮询次数随窗口推导，避免固定 60 次轮询在后台完成前退出。

## 备份与部署

同步完成后先关闭写入、检查 `PRAGMA integrity_check`，执行 `PRAGMA wal_checkpoint(TRUNCATE)`，再复制独立数据库文件；不要只复制仍在写入的 WAL 数据库主文件。副本附带 `manifest.json` 与 SHA-256 校验值。

同步期间使用 WAL，完成后切换到 DELETE 日志模式，使完整快照可作为单个只读文件打开，不依赖旁边的 WAL/SHM 文件。在线服务使用的快照应在另一目录完成更新后原子替换。

数据库属于运行数据，已由现有 `data/` 忽略规则排除在 Git 和 Docker 构建上下文之外。发布程序更新与安装数据库是两个步骤；将校验后的数据库安装到现有持久数据目录，确保应用用户有读取权限。以临时文件上传、校验后原子替换，保留上一份可回滚数据库。不要用空库替换已有完整库。
