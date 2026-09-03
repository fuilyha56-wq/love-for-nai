# LFN 适配器系统使用指南

## 概述

LFN 适配器系统让您可以灵活接入不同的第三方服务，而不再强依赖 NewAPI 和 NovelAI Gateway。管理员可以通过管理中心配置自定义端点，支持多个同类服务并按优先级生效。

## 核心特性

- **插件化认证**：支持 NewAPI、本地数据库、OAuth2 等认证系统
- **插件化图像生成**：支持 OpenAI 兼容接口、NovelAI Gateway、Stability AI、Replicate 等
- **插件化钱包/计费**：支持 NewAPI quota、Stripe、自定义计费系统
- **向后兼容**：环境变量配置依然有效，无缝迁移
- **优先级机制**：多个同类端点按优先级自动选择

## 数据库迁移

首次使用前需要运行数据库迁移：

```bash
# 方法 1: 使用迁移脚本
bash scripts/migrate.sh

# 方法 2: 手动运行 SQL
psql $DATABASE_URL -f migrations/003_adapter_system.sql
```

迁移会创建以下表：
- `lfn_endpoints` - 端点配置
- `lfn_users` - 本地用户（用于 local auth adapter）
- `lfn_sessions` - 本地会话
- `aff_usage_logs` - 使用日志

## 管理端点

### 通过管理中心配置（推荐）

1. 登录管理中心：`/admin`
2. 切换到 **平台配置** 标签
3. 点击 **添加端点**
4. 填写配置：
   - **端点类型**：认证系统 / 图像生成 / 钱包计费
   - **适配器类型**：选择对应的适配器
   - **端点名称**：自定义名称
   - **Base URL**：服务的基础 URL
   - **Token / API Key**：认证凭证
   - **优先级**：数字越大越优先（默认 50）

### 示例配置

#### 图像生成端点（OpenAI 兼容）

```
端点类型: 图像生成
适配器类型: OpenAI 兼容接口
端点名称: 主图像服务
Base URL: https://api.openai.com
Token: sk-your-api-key-here
优先级: 100
```

#### 图像生成端点（NovelAI Gateway）

```
端点类型: 图像生成
适配器类型: NovelAI Gateway
端点名称: NovelAI Gateway
Base URL: http://novelai-gateway:41555
Token: gateway-token-here
优先级: 90
```

#### 认证端点（NewAPI）

```
端点类型: 认证系统
适配器类型: NewAPI
端点名称: NewAPI 账号系统
Base URL: https://your-newapi.com
Token: admin-token-here
优先级: 100
```

#### 钱包端点（NewAPI + AFF）

```
端点类型: 钱包计费
适配器类型: NewAPI + AFF
端点名称: NewAPI 余额 + AFF
Base URL: https://your-newapi.com
Token: admin-token-here
优先级: 100
```

## 向后兼容

现有的环境变量配置依然有效：

```env
# 认证和钱包
NEWAPI_BASE_URL=https://your-newapi.com
LFN_ADMIN_TOKEN=your-admin-token
NEWAPI_DB_URL=postgresql://...

# 图像生成（Gateway）
LFN_GATEWAY_URL=http://novelai-gateway:41555
LFN_GATEWAY_TOKEN=your-gateway-token

# 图像生成（通用 OpenAI 兼容）
LFN_IMAGE_PROVIDER_URL=https://api.openai.com
LFN_IMAGE_PROVIDER_TOKEN=sk-your-key
```

如果数据库中没有配置端点，LFN 会自动从环境变量加载配置。

## 适配器工作原理

### 优先级机制

当有多个同类端点时，按以下规则选择：

1. 数据库中 `enabled=true` 的端点
2. 按 `priority` 降序排列
3. 取第一个（优先级最高）

### 图像请求流程

1. 用户请求 `/ai/generate-image` 或 `/v1/images/generations`
2. LFN 验证用户认证（通过 auth adapter）
3. 检查图包/AFF 余额（通过 wallet adapter）
4. 调用图像生成服务（通过 image adapter）
5. 结算费用（通过 wallet adapter）

### 失败回退

- 如果适配器调用失败，自动回退到环境变量配置
- 如果环境变量也未配置，返回 502 错误

## 扩展适配器

### 目录结构

```
src/lib/adapters/
├── types.ts              # 适配器接口定义
├── factory.ts            # 适配器工厂
├── registry.ts           # 适配器注册表
├── auth/
│   ├── newapi.ts         # NewAPI 认证适配器
│   └── local.ts          # 本地数据库认证适配器
├── image/
│   └── openai-compat.ts  # OpenAI 兼容图像适配器
└── wallet/
    └── newapi.ts         # NewAPI 钱包适配器
```

### 创建自定义适配器

#### 1. 实现适配器接口

```typescript
// src/lib/adapters/image/custom.ts
import type { ImageAdapter, EndpointConfig } from "../types";

export function createCustomImageAdapter(config: EndpointConfig): ImageAdapter {
  const baseUrl = config.config.baseUrl?.replace(/\/+$/, "") || "";
  const token = config.config.token || "";

  return {
    type: "custom",
    name: config.name,

    async generate(request, userToken) {
      // 实现图像生成逻辑
      const response = await fetch(`${baseUrl}/your-endpoint`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${userToken || token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: request.prompt,
          width: request.width,
          height: request.height,
          // ... 其他参数
        }),
      });

      const result = await response.json();
      return {
        images: result.images,
        usage: result.usage,
      };
    },

    async listModels() {
      // 返回支持的模型列表
      return [
        { id: "model-1", name: "Model 1", capabilities: ["generate"] },
      ];
    },
  };
}
```

#### 2. 注册到工厂

```typescript
// src/lib/adapters/factory.ts
import { createCustomImageAdapter } from "./image/custom";

export const adapterFactory: AdapterFactory = {
  createImageAdapter(config: EndpointConfig): ImageAdapter {
    switch (config.adapterType) {
      case "openai_compat":
      case "gateway":
        return createOpenAICompatImageAdapter(config);
      case "custom":
        return createCustomImageAdapter(config);  // 新增
      default:
        throw new Error(`Unsupported image adapter type: ${config.adapterType}`);
    }
  },
  // ...
};
```

#### 3. 更新 UI 选项

```typescript
// src/app/admin/platform-config-panel.tsx
const ADAPTER_TYPES: Record<string, Array<{ value: string; label: string }>> = {
  image: [
    { value: "openai_compat", label: "OpenAI 兼容接口" },
    { value: "gateway", label: "NovelAI Gateway" },
    { value: "custom", label: "自定义图像服务" },  // 新增
  ],
  // ...
};
```

## API 端点

### 管理端点配置

```bash
# 列出所有端点
GET /api/admin/platform/endpoints

# 创建端点
POST /api/admin/platform/endpoints
{
  "type": "image",
  "adapterType": "openai_compat",
  "name": "主图像服务",
  "config": {
    "baseUrl": "https://api.openai.com",
    "token": "sk-xxx"
  },
  "priority": 100
}

# 更新端点
PUT /api/admin/platform/endpoints
{
  "id": "image_1234567890_abc",
  "enabled": true,
  "priority": 90
}

# 删除端点
DELETE /api/admin/platform/endpoints?id=image_1234567890_abc
```

## 常见问题

### Q: 如何从纯环境变量迁移到适配器系统？

A: 渐进式迁移：
1. 运行数据库迁移
2. 保持现有环境变量不变（作为回退）
3. 在管理中心添加新的端点配置
4. 测试验证后，逐步停用旧配置

### Q: 适配器系统会影响性能吗？

A: 不会。适配器在启动时加载并缓存，运行时开销可忽略。

### Q: 可以动态切换端点吗？

A: 可以。在管理中心停用/启用端点或修改优先级后，系统会自动重新加载。

### Q: 如何回退到旧版本？

A: 只需保持环境变量配置，不添加数据库端点即可。适配器系统向后兼容。

### Q: 图库编辑功能在哪里？

A: 管理中心 -> 图库管理，支持编辑标题、作者、分级、标签，以及删除作品。

## 安全建议

1. **敏感凭证**：端点配置中的 token 存储在数据库 `config` JSONB 字段中，建议：
   - 数据库启用加密
   - 限制管理员权限
   - 定期轮换 token

2. **访问控制**：端点管理 API 仅限管理员（`role >= 10`）访问

3. **审计日志**：考虑在 `lfn_endpoints` 表上添加触发器记录配置变更

## 路线图

未来计划支持的适配器：

- **认证**：OAuth2、LDAP、SAML
- **图像**：Stability AI、Replicate、Midjourney
- **钱包**：Stripe、PayPal、加密货币
- **通知**：Webhook、Email、消息队列

## 贡献

欢迎提交 PR 添加新的适配器！请参考现有适配器实现，确保：

1. 实现完整的适配器接口
2. 添加类型安全
3. 处理错误和超时
4. 编写单元测试
5. 更新文档

---

**License**: AGPL-3.0-only
