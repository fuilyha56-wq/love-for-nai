# 当前用户指南

该目录是站内内置用户文档的唯一 Markdown 源。历史发布报告、价格快照与部署记录保留在上级目录供审计，不作为当前使用教程。

- 内容基线：2026-10-24，按本仓库当前路由、参数校验、计费与前端功能核对。
- `manifest.json` 维护稳定 ID、slug、标题、分类、摘要和排序。
- 修改后运行 `node scripts/sync-user-docs.mjs`，将内容打包到 `src/lib/documentation-content.ts`。
- 验证同步：`node scripts/sync-user-docs.mjs --check`。
- 公开插图在 `public/docs/`；截图使用隔离的示例数据，禁止含真实凭据和用户隐私。
- API 调试集合：`public/docs/lfn-api.postman_collection.json`，只保留占位变量。

内置更新会备份原存储。管理员通过 CMS 编辑的文章不会自动覆盖，应人工合并；自定义文章不受内置升级影响。

外部项目引用以原作者为准：

- Aaalice NAI Launcher：https://github.com/Aaalice233/Aaalice_NAI_Launcher
- Launcher 第三方站点模式：本机同项目 `lib/presentation/widgets/auth/third_party_api_login_card.dart` 与 `lib/core/network/nai_api_endpoint.dart`；文档给出配置流程，未声称所有历史版本均兼容。
- Postman：https://learning.postman.com/docs/use/send-requests/authorization/authorization-types/
- Bruno：https://www.usebruno.com/

关键能力依据：`src/app/api/aff/check-in/route.ts` 只接受会话；`src/app/user/subscription/route.ts` 与 `src/app/user/data/route.ts` 接受图像 Key 并返回本站摘要；`src/lib/image-request.ts` 与 `nai-image-limits.ts` 负责参数校验；`src/lib/daily-image-pricing.ts` 与 `aff.ts` 负责每日分档与签到。
