# Changelog

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
