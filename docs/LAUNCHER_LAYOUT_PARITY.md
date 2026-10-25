# 手机布局与桌面恢复验收

以用户最新要求为准：**恢复此次改动影响的桌面布局与设置，Aaalice 布局参考和交互优化仅用于手机端**。此前整站统一布局的方案已撤回，后续工作不得再次据此修改桌面。

## 两端边界

| 项目 | 桌面：宽度 ≥ 840px | 手机：宽度 ≤ 839px |
| --- | --- | --- |
| 界面代码 | `src/app/`，路由原实现为 `desktop-page.tsx` | `src/mobile/` |
| 工作台 | 原 LFN、NovelAI Local、NAI 主题及自定义工作台 | 参考 Aaalice 的画布、面板层级及导航；保留 LFN 外观 |
| 外观设置 | 原 LFN / NovelAI Local / 自定义布局选项 | 手机独立的工作台、主题及密度设置 |
| 样式 | `desktop-globals.css` 与桌面组件样式，限制在桌面媒体条件内 | 手机全局及组件样式，限制在手机媒体条件内 |
| 外观存储 | `lfn-ui-preferences-v1` | `lfn-mobile-ui-preferences-v1` |
| 布局存储 | `lfn-custom-layout-v1` | `lfn-mobile-custom-layout-v1` |
| 背景数据库 | `lfn-ui-background-v1` | `lfn-mobile-ui-background-v1` |

`ViewportRoot` 提供统一设备状态，`ViewportPage` 只挂载当前端的界面。改变窗口宽度时，页面、外观 Provider 和导航同时切换，避免隐藏表单继续执行副作用或拿错外观上下文。

面板宽度、停靠栏、提示词编辑器高度、指南偏好也使用手机独立键。第一次打开手机界面可读取已有桌面主题作为初始值，此后手机修改不会写回桌面配置。账号、作品及创作数据继续使用原服务。

桌面恢复参考本地副本 `.tmp-build/nai-api-coverage-20261024/original/src/app`，并保留恢复前手机界面备份 `.tmp/mobile-desktop-split-20261024/before/`。135 个桌面文件已比对；目前 131 个与原副本一致（忽略换行及媒体包装），另外 4 个文件同期收到独立的登录策略、平台配置与管理导航更新，予以保留并在验收结果中单列：`admin/admin.css`、`admin/page.tsx`、`admin/platform-config-panel.tsx`、`sign-in/page.tsx`。

## 保留在手机端的修复

- 提示词、生成参数和助手统一为全屏二级页面，可互相切换与返回；参数不再保留侧边抽屉。
- 创作顶部按参考排列参数、助手、历史，加入消息入口；模式使用 LFN 菜单列出当前模型支持的全部操作。
- 提示词状态与工具分行，按钮自适应宽度；角色标题与快捷按钮在窄屏换行，主要触控区域至少 44px。
- “更多”按创作工具、账号记录、模型用量、帮助设置分组；对应页面使用手机独立布局。
- 广场分级、模型、日期时间、颜色等使用 LFN 控件。新管理配置页也拆为手机组件，离开未保存表单时使用 LFN 确认框。
- 图片详情、图片菜单、集合搜索分页、账号分类、用量筛选、文档目录、消息、故事及编辑器保留已完成的手机适配和键盘视口处理。
- 登录与注册手机表单独立，支持站点登录策略；所有测试使用拦截接口，没有发送邮件或修改真实账号、作品。
- 桌面开发指示器配置已恢复；遮挡手机导航的问题仅在手机媒体条件内处理。

## 验证与证据

| 检查 | 证据 |
| --- | --- |
| 原桌面布局、设置选项、1254→808→1254 切换 | `scripts/check-device-ui-isolation.cjs`；同时覆盖 LFN、NovelAI Local、NAI、自定义四个桌面工作台 |
| 手机主题及布局不覆盖桌面存储 | 同上，比较修改前后桌面存储的完整字符串；直接从手机首次打开也保留桌面存储原值 |
| 手机管理控件及离开表单确认 | 同上，覆盖 320/390/808px，确认取消保留编辑且没有原生弹窗 |
| 用户标注的全屏、模式、按钮、消息与更多 | `scripts/check-studio-responsive.cjs`，320/390/600/808/839px |
| 工作台主题、生成交互、编辑器与基础路由 | `scripts/check-mobile-ui.cjs`；37 项通过，包含 2 项补测；合并证据 `.tmp/mobile-ui/report-final-device-split.json`，保留原轮与补测记录，无浏览器错误 |
| 有内容的手机页面与展开状态 | `scripts/check-launcher-ui.cjs`，22 个路由的 320/808px；58 项通过，包含登录与图片详情边界补测；合并证据 `report-phone-final-combined.json`，无浏览器错误 |
| 模型、价格、提示词库、来源表单、布局保存、风控与别名 | `scripts/check-launcher-remaining.cjs`，7 项通过，覆盖 320/390/600/808px |
| 布局及账号导航单元检查 | 19 项通过，覆盖手机独立钱包分区与桌面原分区；结果 `.tmp/launcher-ui/device-unit-results.json` |
| 应用 TypeScript 与改动文件 ESLint | 已通过 |
| 最终生产构建 | `npm run build` 通过，TypeScript 与 121 个静态页面生成完成；预览已恢复为原有环境与数据 |

截图与结果位于 `.tmp/launcher-ui/`，设备隔离报告位于其 `device-isolation/results.json`。桌面设置截图为 `desktop-layout-options-1254.png`，手机参数全屏截图为 `phone-parameters-808.png`。生产构建日志见 `build-device-isolation.log` 与最终复核日志 `build-device-isolation-final.log`。

构建仍有注册邮件模块的动态文件追踪范围提示，属于同期后台代码，本次没有修改该模块。

## 参考与许可

参考本地 `E:/Aaalice_NAI_Launcher` 及 [Aaalice NAI Launcher](https://github.com/Aaalice233/Aaalice_NAI_Launcher) 的手机导航、生成页面、集合及设置结构，保留 LFN 配色、品牌、账号和业务能力。Flutter 系统窗口、设备文件授权等浏览器无法直接移植的内容使用网页对应能力。许可保留于 `public/nai/LICENSE-Aaalice.txt`。
