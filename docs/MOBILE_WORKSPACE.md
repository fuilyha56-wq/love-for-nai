# 手机工作面板验收（2026-10-24）

本次修改位于 `src/mobile/`，仅用于宽度不超过 839px 的手机界面。桌面布局、桌面控件和桌面偏好不参与此次调整。

## 统一界面与交互

- 提示词、参数、助手共用同一个全屏容器、页头、导航和底部完成栏。切换只改变当前可见页；访问过的页面保留挂载、草稿、折叠状态和滚动位置，切换不再重播淡入动画或重建整个工作台。
- 三页共用提示词面板的 LFN 纸色输入底、8px 圆角、窄屏间距及主题变量。参数中的来源、模型、接口、操作、采样和提交方式，以及助手模型，使用同一种填充式 `PopupSelect`，展开后仍是 LFN 菜单。
- 参数页参考 Aaalice ParameterPanel / ThemedDropdown / SizeSelector：管理来源移到标题行；模型风格与档位分组；宽、高及交换操作独立排列；采样、数量、种子与高级选项直接在页面内调整。
- 助手输入框按剩余高度伸缩，首屏提交按钮保持在底栏上方；键盘缩短视口时内容可以滚动，完成栏仍可操作。
- 提示词快捷调用助手可以重复使用；从提示词进入参数后返回提示词，从画布直接进入则返回画布；关闭更多工具回到原参数页。
- 修复手机助手模型请求被中止后仍被当成进行中、导致新请求未执行的问题。用当前请求的 AbortSignal 区分过期请求，旧请求不能清除新请求的加载状态。

## 本次验证

| 检查 | 结果与证据 |
| --- | --- |
| 工作面板、状态保留、菜单、返回、短视口 | `scripts/check-mobile-workspace.cjs`：320 / 390 / 620 / 808 / 839px，另含夜间主题，共 6 组通过；`.tmp/mobile-workspace/results.json` |
| 登录态助手模型与主题 | 同一脚本在独立测试数据服务上补测 620px 纸色、390px 夜间薄荷色，2 组通过；`results-signed.json` |
| 参数实际编辑 | 320 / 390 / 620 / 808 / 839px 全部通过，覆盖模型、High/Medium、分辨率、采样、数量、种子、GPT 控件及短视口菜单；`.tmp/launcher-ui/parameter-style/results.json` |
| 参数、提示词进入生成请求 | 1 项通过；请求被本地测试拦截，没有真实生成或计费；`.tmp/mobile-ui/report-parameter-state-and-local-only-generation-request.json` |
| 桌面与手机隔离 | 桌面四种原有工作台、跨设备宽度切换、手机首次加载及偏好存储共 3 项通过；`.tmp/launcher-ui/device-isolation/results-workspace-final.json` |
| 静态检查 | 项目 TypeScript 与本次修改文件 ESLint 通过 |

本机开发模式、620×884、120 个提示词标签、连续 6 次切换的点击至绘制观测：修改前平均 368ms，修改后平均 72ms。修改后 6 次均复用同一个弹层。可运行 `scripts/check-mobile-workspace-switch.cjs` 复测，结果写入 `.tmp/mobile-workspace/switch-performance.json`；这不是实际手机的帧率保证。

截图保留于 `.tmp/mobile-workspace/`，包括 `paper-620-parameters.png`、`paper-620-signed-assistant.png` 与 `night-390-signed-assistant.png`。隔离的登录态测试服务和临时项目副本已关闭、清理；3000 端口的正常预览继续使用原环境和数据。
