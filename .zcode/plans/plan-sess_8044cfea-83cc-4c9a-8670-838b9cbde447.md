## 目标

在不改变现有 LFN 纸面 UI 默认观感的前提下，新增：

1. 公告中的社区反馈征集说明（不包含任何聊天记录原文）。
2. 公告评论区，供社区提交 UI、功能和体验要求。
3. 纯客户端外观自定义：主题色、自定义背景、更多颜色、网格、动效和液态玻璃。
4. 液态玻璃默认关闭，所有偏好和背景图片尽量由用户本地计算/保存。
5. 继续保持管理员公告和用户管理能力。

## 1. 公告与评论区

### 公告内容调整

- 不把你提供的聊天记录写入公告，也不保存聊天原文。
- 增加一条简洁的“社区反馈征集”公告，内容只说明：
  - 欢迎反馈 UI 优化、功能需求、颜色/主题、自定义背景、液态玻璃等建议。
  - 反馈请在公告下方评论区留言。
  - 液态玻璃默认关闭，视觉偏好尽量在本地计算，不上传用户背景图片。
- `ensureSeed()` 改为幂等迁移：教程公告和反馈征集公告缺失时分别补齐，不覆盖管理员已经编辑过的内容。

### 评论数据与 API

新增 `src/lib/announcement-comments.ts`：

- 使用 `LFN_DATA_DIR/announcements/comments.json` 持久化。
- 评论字段：`id`、`announcementId`、`authorId`、`authorName`、`content`、`createdAt`、`updatedAt`。
- 内容限制长度，例如最多 2,000 字符，服务端校验并裁剪异常输入。
- 公开读取评论；发布评论要求登录，避免匿名刷屏。
- 管理员可删除评论；删除操作使用现有 `requireAdmin()`。
- 不接受客户端伪造作者名、用户 ID 或时间。

新增 API：

- `GET /api/announcements/[id]/comments`：公开读取，按时间正序或最新评论优先统一排序。
- `POST /api/announcements/[id]/comments`：登录用户发布评论。
- `DELETE /api/announcements/[id]/comments/[commentId]`：管理员删除评论。

### 页面展示

- 在 `/announcements` 每条公告正文下加入评论区：
  - 显示评论数量。
  - 公开显示作者、时间和内容。
  - 登录用户显示评论输入框和发布按钮；未登录显示登录提示链接。
  - 评论采用普通文本或受限 Markdown，渲染仍在浏览器完成，禁止 `dangerouslySetInnerHTML`。
- 公告弹窗只显示公告正文，并保留“查看全部公告”；不在弹窗内塞入长评论列表，避免打断主流程。
- 管理页公告编辑器继续只编辑公告正文；新增独立评论管理区域，可查看并删除评论。

## 2. 纯客户端外观偏好

新增客户端外观状态模块，例如：

- `src/app/appearance.tsx`
- `src/lib/appearance-store.ts`

使用版本化 localStorage key，例如 `lfn-ui-preferences-v1`，只保存白名单字段：

- `theme`: `paper`、`night`、`rose`、`mint`、`ocean`
- `accentColor`: 安全的 `#RRGGBB`
- `glassEnabled`: 默认 `false`
- `glassStrength`: 0–100
- `gridEnabled`: 默认 `true`
- `density`: `comfortable` / `compact`
- `motion`: `full` / `reduced`
- `backgroundEnabled`: 默认 `false`
- 本地背景图引用信息

要求：

- 不把背景图、主题偏好、玻璃偏好上传服务器。
- 不在服务端读取 localStorage。
- 恢复数据时做版本和枚举校验，损坏时回退默认值。
- 通过客户端 Provider 或工作台根节点设置 `data-theme`、`data-glass`、`data-motion` 等属性。
- 默认值必须与当前线上视觉一致。

## 3. 本地自定义背景

新增纯客户端设置页 `src/app/settings/page.tsx`，背景图处理完全在浏览器完成：

- 使用文件选择器读取图片。
- 用 `createImageBitmap`/Canvas 压缩到合理尺寸后保存到 IndexedDB；不把原图写入服务器。
- 生成预览 Object URL，离开或替换时释放 URL。
- 支持启用/停用、替换、清除背景。
- 设置页显示明确提示：“背景图片仅保存在当前浏览器，不会上传到 LFN”。
- 背景图层使用普通淡入/轻量过渡，不做持续大面积滤镜动画。
- 现有登录页 gallery 背景轮换继续保留；若产品上允许本地背景影响登录页，则只从同一浏览器 IndexedDB 读取，不改变服务器候选图逻辑，也不显示 R18 背景。

## 4. 主题、颜色与液态玻璃

在 `globals.css` 扩展 CSS token：

- 先保留现有 `:root` 默认纸面 token。
- 增加 `[data-theme]` 的颜色覆盖。
- 增加 `--glass-alpha`、`--glass-blur`、`--glass-saturation`、`--glass-border` 等变量。
- 将重点表面逐步迁移到 token：`.panel`、Header、PopupSelect、移动抽屉、公告/管理弹窗和主要表单控件。

液态玻璃规则：

- `glassEnabled=false` 时完全使用现有实体/近实体表面，不产生全局 `backdrop-filter`。
- 只有 `data-glass="on"` 时对语义明确的面板启用玻璃。
- 先给不透明 fallback，再在 `@supports (backdrop-filter: blur(1px))` 与 `-webkit-backdrop-filter` 中增强。
- 强度范围映射到透明度、blur、饱和度和边框高光；限制最大模糊，避免低端设备卡顿。
- 图片卡片和主画布默认不加玻璃滤镜，避免图片变糊。
- 主题色自定义只接受十六进制颜色，拒绝任意 CSS 字符串。

## 5. 动效与本地计算

- 登录页标题乱序保留在 150ms 内完成。
- 登录页左下宣传文字使用 `linear()` 烘焙的弹簧关键点，背景图本身只做普通淡入；不把聊天内容放入动画或公告。
- 设置页中的主题/玻璃切换只动画 `opacity`、`transform`，使用 150–300ms 的缓动。
- 只在必要的 Drawer、Popup、Modal 和反馈提示上使用弹簧；默认中高 damping，避免持续抖动。
- `motion=reduced` 与系统 `prefers-reduced-motion` 同时生效，跳过乱序、弹簧和大范围过渡。
- 费用估算、背景图片压缩、预览、偏好解析、MD/评论渲染均在客户端执行；认证、公告持久化、评论持久化、用户与余额管理仍由服务端负责。

## 6. 管理和入口

- 在工作台“创作中心”增加“公告”和“外观设置”。
- 管理入口仍只对 NewAPI 角色 >= 10 的管理员显示。
- `/admin` 增加：
  - 用户管理：列表、搜索、分页、ID、用户名、邮箱、分组、角色、NewAPI 余额、AFF 余额。
  - 用户编辑：密码、显示名称、备注、分组、余额和 AFF 调整。
  - 公告编辑：标题、正文 Markdown、置顶、重要等级。
  - 评论管理：按公告查看评论、删除评论。
- 不把客户端主题或背景设置做成管理员可见的服务器数据，避免管理员误以为能替用户修改本地背景。

## 7. 测试与验证

新增测试覆盖：

- 社区反馈公告种子和幂等迁移，确认不包含聊天记录。
- 评论创建、读取、长度限制、作者字段不可伪造、管理员删除。
- 外观偏好默认值、版本迁移、非法颜色/枚举、损坏数据回退。

浏览器验证：

- 公告弹窗有确认按钮，公告时间线正常。
- 公告下评论公开可读，未登录不能发布，登录后可以发布。
- 管理员能删除评论和编辑公告；普通用户不能进入管理操作。
- 主题、颜色、网格、背景、玻璃开关刷新后仍保留。
- 液态玻璃默认关闭，打开后只影响指定表面，图片仍清晰。
- 自定义背景只存在当前浏览器，清除后恢复默认。
- 桌面和移动布局均可用。
- 运行 `npm run lint`、`npm test`、`npm run build`。

## 8. 构建、部署和提交

- 本地构建 Docker 镜像。
- 使用现有 `E:\novelai-gateway\.rsh.py` 对应的 SFTP/远程 compose 流程部署，保留服务器数据卷中的公告、评论和用户数据。
- 线上验证 `/api/health`、`/announcements`、评论 API、`/settings`、`/admin` 权限和登录页。
- 完成后提交并推送到 `origin/main`。
- 部署时不上传任何用户本地背景图片或本地外观偏好。