# Changelog

## [Unreleased] - 2026-10-23

### 修复

- **修复登录时 409 Conflict（上游登录会话数上限）**
  - 根因：LFN 登出只清除自身 cookie，从不撤销上游 NewAPI 的登录会话；每次密码登录都会在上游创建一个会话，累积到上游单用户活跃会话上限（默认 50）后，登录返回 409 Conflict。
  - 登出时现在会调用上游 `POST /api/user/auth/logout` 撤销对应会话（Bearer access_token 优先、`new_api_refresh` cookie 兜底）；撤销失败不阻塞登出。
  - 系统访问令牌登录（不创建上游会话）自动跳过撤销。
  - 登录时若上游返回 409，前端提示改为可操作的中文说明，而非透传 "Conflict"。

## [Unreleased] - 2026-09-08

### NovelAI 原生兼容层

- Gateway 与 LFN 共同支持官方 `/ai/*`、`/user/*` 路径。
- `/user/*` 对普通用户 Token 一律返回 403；账户信息只能由 LFN 服务端携带 Gateway Token 读取。
- `POST /ai/encode-vibe`、`/ai/upscale`、`/ai/annotate-image` 在配置 Gateway 后由服务端转发，浏览器不持有 Gateway Token。
- 支持独立的第三方 API 站点与图像 API 站点。
- 工作台生图改为官方流式：Gateway `/ai/generate-image-stream` 的 msgpack 中间帧会刷新到同一画布，最终帧替换预览图。

## [Unreleased] - 2026-09-04

### 🎉 重大更新：适配器系统

将 LFN 从强依赖 NewAPI 和 Gateway 的单一实现，重构为可扩展的通用平台。

#### 新增功能

- **适配器系统架构**
  - 插件化认证系统（NewAPI、本地数据库、可扩展）
  - 插件化图像生成（OpenAI 兼容、Gateway、可扩展）
  - 插件化钱包/计费（NewAPI + AFF、可扩展）
  - 优先级机制支持多个同类端点
  - 自动失败回退

- **管理中心增强**
  - 新增"平台配置"标签页
  - 可视化端点管理界面
  - 支持添加、编辑、启用/停用、删除端点
  - 实时生效，无需重启

- **数据库 Schema**
  - `lfn_endpoints` - 端点配置表
  - `lfn_users` - 本地用户表
  - `lfn_sessions` - 本地会话表
  - `aff_usage_logs` - 使用日志表

- **API 端点**
  - `GET /api/admin/platform/endpoints` - 列出端点
  - `POST /api/admin/platform/endpoints` - 创建端点
  - `PUT /api/admin/platform/endpoints` - 更新端点
  - `DELETE /api/admin/platform/endpoints` - 删除端点

#### 技术改进

- 重构 `compat-api.ts` 使用适配器系统
- 保持 100% 向后兼容（环境变量配置依然有效）
- 类型安全的适配器接口
- 统一的数据库连接层 (`src/lib/db.ts`)
- 使用 Node.js 内置 crypto 实现密码哈希（无需 bcrypt）

#### 文件变更

**新增文件：**
- `src/lib/adapters/types.ts` - 适配器接口定义
- `src/lib/adapters/factory.ts` - 适配器工厂
- `src/lib/adapters/registry.ts` - 适配器注册表
- `src/lib/adapters/auth/newapi.ts` - NewAPI 认证适配器
- `src/lib/adapters/auth/local.ts` - 本地认证适配器
- `src/lib/adapters/image/openai-compat.ts` - OpenAI 兼容图像适配器
- `src/lib/adapters/wallet/newapi.ts` - NewAPI 钱包适配器
- `src/lib/db.ts` - 数据库连接层
- `src/app/api/admin/platform/endpoints/route.ts` - 端点管理 API
- `src/app/admin/platform-config-panel.tsx` - 平台配置 UI
- `migrations/003_adapter_system.sql` - 数据库迁移
- `scripts/migrate.sh` - 迁移脚本
- `docs/ADAPTER_SYSTEM.md` - 使用指南

**修改文件：**
- `src/lib/compat-api.ts` - 集成适配器系统
- `src/app/admin/page.tsx` - 新增平台配置标签

**备份文件：**
- `src/lib/compat-api.ts.backup` - 原始版本备份

#### 迁移指南

1. 运行数据库迁移：
   ```bash
   bash scripts/migrate.sh
   ```

2. （可选）在管理中心添加自定义端点

3. 现有环境变量配置无需更改，自动兼容

详细文档：`docs/ADAPTER_SYSTEM.md`

#### 向后兼容

✅ 所有现有功能保持不变
✅ 环境变量配置依然有效
✅ API 接口完全兼容
✅ 图像生成、认证、计费逻辑不受影响

---

## 之前的更新

（此处保留原有 changelog 内容）
