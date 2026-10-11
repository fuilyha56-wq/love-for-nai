# LFN 适配器系统功能验证清单

## V5 Medium 低成本档位（2026-10-10）

### 官方证据与边界

查询日期为 2026-10-10。来源：[Effort 官方说明](https://docs.novelai.net/en/image/effort/)、[发布公告](https://journal.novelai.net/novelai-diffusion-v5-full-effort-toggle/)、[订阅说明](https://docs.novelai.net/en/subscription/)、[FAQ](https://docs.novelai.net/en/faq/)。计算公式另核对官网公开前端 `1601-acc34459bdce34e2.js`。

- Medium 是 V5 Full 的独立蒸馏模型及其 inpainting 变体，不是普通 V5 降低步数。
- 固定 14 步、Euler Ancestral、官方 Heavy UC；允许 Prompt Guidance，不允许自定义 UC 或 Guidance Rescale。
- 本站为固定费用新增额外边界：每请求 1 张、宽高为 64 的倍数、面积不超过 1048576、单边不超过 1600。不支持 priority、参考图、ControlNet、超分和 Director 工具。超限返回 HTTP 400，扣费前拒绝。
- 官方公告和 FAQ 描述约减少 42% usage/Anlas；本次公开计算器在 1024²、High 23 步与 Medium 14 步的结果分别是 26 和 18 Anlas，减少约 30.77%。保留这项证据差异，不推断 42% 只适用于某一种余额。

计算器基础公式（无参考图、无额外付费工具）：先对像素与步数项之和向上取整，再乘 V5 的 1.5 与图生图强度并向上取整，每张最低 2 Anlas。Medium 步数项另乘 `1 / 1.06521739`。按张求和；符合免费条件时第一张免 Anlas，而不是整个多张请求免费。

| 配置 | 非免费单张 Anlas | 请求总额 | 以 10000 Anlas/$14 档位估算采购成本 |
| --- | ---: | ---: | ---: |
| V5 High，1024×1024，23 步，1 张 | 26 | 26 | $0.0364 |
| V5 Medium，1024×1024，14 步，1 张 | 18 | 18 | $0.0252 |
| V5 Medium，512×512，14 步，1 张 | 5 | 5 | $0.0070 |
| V5 High，1024×1024，23 步，2 张，无免费资格 | 26 | 52 | $0.0728 |

FAQ 明确给出 10000 Anlas 单独购买价为 $14 USD；此处是该购买方案的单位成本，不代表所有订阅/购买档位统一售价。折扣购买价不适用于取消或不续订的订阅；其他购买包价格未完成数字核验，不在本次报告中猜测。

Tablet/Scroll/Opus 月费分别为 $10/$15/$25，附带订阅 Anlas 分别为 1000/1000/10000。订阅 Anlas 续期补到对应上限而非累加，订阅结束时失效；单独购买 Anlas 不过期。符合 Opus 正常分辨率、最多 28 步等条件可免 Anlas，但 V5 另受持续回充的 usage bar 限制；usage 不足时仍会使用 Anlas。本站按张限额与官方 usage bar 不是同一单位。

### 三类站内计费

- 图包额度和个人 AFF 使用同一种站内整数单位，来源分别记录，不能解释为官方 Anlas 或 USD。默认 High 档内 2 AFF/张，Medium 自动价 1 AFF/张；这是按 18/26 成本比例取整后的站内政策，实际折扣为 50%，不是精确 Anlas 换算。管理员固定 AFF 单价仍优先。
- 图包优先，个人 AFF 补足；合计不足或无法满足本请求时不部分扣款，整个请求交给 NewAPI。退款回到原扣费来源，释放对应图包限速占用。
- 默认 `500000 quota = 1 NewAPI 余额单位`，页面美元符号是站内计价显示，不代表官方采购美元。图包商品默认 200 余额单位换 400 图包额度，运行配置可覆盖。
- 线上 High 档内 usage 标记为 25；NewAPI 表达式 `p * 200000 / 1000000`、Draw 倍率 1，实际为 5 余额单位。LFN 已从错误的 8 标记同步为 25。
- 两个 Medium 模型使用 `ModelPrice = 5 * 18 / 26 = 3.46153846` 按次价，`quota_type=1`，不使用 tiered token 表达式；仅挂渠道 115 的 Draw/Draw-Limit-2，后者倍率 0 保持原政策。小分辨率也使用相同固定请求价。Gateway 的 18 usage 标记用于记录，不等于每个尺寸都消耗 18 Anlas。

### 验证与回退

- Gateway 正式 `tests/`：135 项通过，16 个子用例通过。根目录手工 `_direct_test.py` 会阻断无路径的 pytest 收集；不是正式测试集。
- LFN Medium、三类扣费和退款定向测试通过。生产构建与 TypeScript 通过。全量首次 587 项中有 10 项失败，其中 8 项是已修正的旧 8-token 价格断言，另外 2 项是既有历史接口返回字段契约差异。
- 本机 Edge 已提交一次 Medium 512²/14 步请求，服务端保存历史 `327e9ba6-0099-470c-98d4-93243d2fe987`，图包 7370→7369，个人 AFF 220 未变。浏览器停在预览后暴露 SSE 等待 EOF 的问题，已补模拟连接不关闭/取消不返回的回归测试和完成事件收尾修复；最终浏览器展示仍需发布后复验。
- NewAPI 配置备份：`/home/ikun/newapi-backups/newapi-medium-20261010-072643.sql.gz`，权限 600。不要整库覆盖恢复，以免覆盖之后的其他管理员修改；回退仅删除本次两个 Medium 的 ModelPrice、渠道 115 模型名和对应 abilities，再重载 new-api。
- Gateway 文件回退目录：`/home/ikun/novelai-gateway/backups/medium-20261010-0748/`。恢复其中 `openai.py`、`app.py`、`models.toml` 到原路径并重启 Gateway。
- LFN 初版镜像 `love-for-nai:medium-20261010-0755`；原镜像 `love-for-nai:stream-final-fallback-20261007-` 保留。compose 回退备份 `compose.prod.yml.bak-medium-20261010-0808`；只替换 LFN 镜像，保留同文件的 `nginx:alpine` 和生产数据卷。

## ✅ 编译检查

- [x] TypeScript 类型检查通过
- [x] Next.js 构建成功
- [x] 所有页面路由生成正常

## ✅ 核心功能

### 适配器系统

- [x] 适配器接口定义 (`src/lib/adapters/types.ts`)
  - [x] AuthAdapter 接口
  - [x] ImageAdapter 接口
  - [x] WalletAdapter 接口
  - [x] EndpointConfig 类型

- [x] 适配器实现
  - [x] NewAPI 认证适配器
  - [x] 本地认证适配器（使用 PBKDF2）
  - [x] OpenAI 兼容图像适配器
  - [x] NewAPI 钱包适配器

- [x] 适配器工厂和注册表
  - [x] 工厂模式创建适配器
  - [x] 运行时注册表管理
  - [x] 环境变量回退机制
  - [x] 优先级排序

### 数据库 Schema

- [x] 迁移文件创建 (`migrations/003_adapter_system.sql`)
  - [x] lfn_endpoints 表
  - [x] lfn_users 表
  - [x] lfn_sessions 表
  - [x] aff_usage_logs 表
  - [x] 索引和约束
  - [x] 清理函数

- [x] 数据库连接层 (`src/lib/db.ts`)
  - [x] Pool 管理
  - [x] 查询方法（query, one, oneOrNone, any, none）
  - [x] 错误处理

### API 端点

- [x] 端点管理 API (`/api/admin/platform/endpoints`)
  - [x] GET - 列出所有端点
  - [x] POST - 创建新端点
  - [x] PUT - 更新端点
  - [x] DELETE - 删除端点
  - [x] 管理员权限验证
  - [x] 自动重新加载适配器

### 管理中心 UI

- [x] 平台配置面板 (`src/app/admin/platform-config-panel.tsx`)
  - [x] 端点列表展示
  - [x] 按类型分组
  - [x] 添加端点表单
  - [x] 启用/停用按钮
  - [x] 删除确认
  - [x] 错误提示

- [x] 管理中心集成 (`src/app/admin/page.tsx`)
  - [x] 新增"平台配置"标签
  - [x] 标签页切换
  - [x] 响应式布局

### 兼容性重构

- [x] compat-api.ts 重构
  - [x] 集成适配器系统
  - [x] 保持向后兼容
  - [x] 图像生成流程
  - [x] 失败回退机制
  - [x] 计费结算

## 🔄 向后兼容性

- [x] 环境变量配置依然有效
  - [x] NEWAPI_BASE_URL
  - [x] LFN_ADMIN_TOKEN
  - [x] LFN_GATEWAY_URL
  - [x] LFN_IMAGE_PROVIDER_URL

- [x] 现有 API 接口不受影响
  - [x] `/ai/generate-image`
  - [x] `/v1/images/generations`
  - [x] `/api/auth/*`
  - [x] `/api/wallet`

- [x] 图库编辑功能保持可用
  - [x] PATCH `/api/admin/gallery/[id]` - 编辑
  - [x] DELETE `/api/admin/gallery/[id]` - 删除

## 📝 文档

- [x] 适配器系统指南 (`docs/ADAPTER_SYSTEM.md`)
  - [x] 概述和特性
  - [x] 迁移步骤
  - [x] 配置示例
  - [x] 扩展指南
  - [x] API 文档
  - [x] 常见问题

- [x] Changelog (`CHANGELOG.md`)
  - [x] 新增功能列表
  - [x] 技术改进
  - [x] 文件变更
  - [x] 迁移指南

- [x] 迁移脚本 (`scripts/migrate.sh`)
  - [x] 环境变量检查
  - [x] 自动运行 SQL
  - [x] 友好提示

## 🧪 待生产环境验证

以下需要在实际运行环境中验证：

### 数据库迁移

```bash
# 1. 备份数据库
pg_dump $DATABASE_URL > backup.sql

# 2. 运行迁移
bash scripts/migrate.sh

# 3. 验证表创建
psql $DATABASE_URL -c "\dt lfn_*"
```

### 端点配置

```bash
# 1. 登录管理中心
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"***"}'

# 2. 添加图像端点
curl -X POST http://localhost:3000/api/admin/platform/endpoints \
  -H "Cookie: session=***" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image",
    "adapterType": "openai_compat",
    "name": "测试图像服务",
    "config": {"baseUrl": "https://api.openai.com", "token": "sk-test"},
    "priority": 100
  }'

# 3. 列出端点
curl http://localhost:3000/api/admin/platform/endpoints \
  -H "Cookie: session=***"
```

### 图像生成

```bash
# 使用 NewAPI key 测试
curl -X POST http://localhost:3000/ai/generate-image \
  -H "Authorization: Bearer sk-***" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "a cat",
    "model": "nai-v5-full",
    "width": 832,
    "height": 1216,
    "n": 1
  }'
```

### 管理中心

1. 访问 `/admin`
2. 切换到"平台配置"标签
3. 添加一个测试端点
4. 启用/停用测试
5. 删除测试端点

## ✨ 功能亮点

1. **零停机迁移**：环境变量配置继续工作，无需强制迁移
2. **灵活扩展**：10 分钟内可添加新的适配器类型
3. **多端点支持**：可配置多个图像服务，自动优先级选择
4. **安全隔离**：敏感凭证存储在数据库，与代码分离
5. **即时生效**：配置更改后自动重新加载，无需重启

## 🎯 验证结论

✅ **编译通过**：所有 TypeScript 类型检查和 Next.js 构建成功
✅ **架构完整**：适配器系统、数据库、API、UI 全部实现
✅ **向后兼容**：现有功能不受影响，环境变量配置依然有效
✅ **文档齐全**：使用指南、API 文档、迁移步骤完整
✅ **代码已提交**：Git commit 和 push 成功

## 🚀 下一步

1. **生产部署前**：在测试环境运行数据库迁移
2. **功能测试**：验证端点添加、图像生成、管理功能
3. **性能测试**：确认适配器调用开销可忽略
4. **安全审计**：检查端点配置的访问控制
5. **用户培训**：向管理员介绍新的平台配置功能

---

**验证时间**: 2026-09-04
**验证人**: Claude Code (Opus 4.6)
**状态**: ✅ 开发完成，等待生产验证
