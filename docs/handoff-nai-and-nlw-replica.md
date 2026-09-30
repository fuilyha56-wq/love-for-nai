# Handoff: NAI 与 NovelAI Local / Aaalice 复刻

日期：2026-09-30  
仓库：`E:\love-for-nai`，分支 `main`  
线上部署：本任务未授权部署；后续也必须等用户明确批准。

## 给下一位 AI 的可直接执行提示词

```text
你接手的是 Love for NAI（E:\love-for-nai）工作台复刻任务。先读 AGENTS.md、相关记忆和本交接文档，再检查 git status 和实际源码。不要假设本交接里的文件状态仍最新：验证每个文件、函数、selector、测试断言确实存在。

核心目标是两个完全独立的布局，不要折中混合：
1. `theme=nai` / `naiLayout`：按用户发来的 NovelAI 官方网站截图和 `D:\Desktop\button and div.txt` DOM 抓取，一比一复刻 NAI 的提示词/图像设置/角色提示/图像设置/参数/生成/结果工作台。
2. `workspaceLayout=nlw`（设置页标签“NovelAI Local”，不要误认为 classic）：按本会话中用户明确指向的 `E:\Aaalice_NAI_Launcher` 源码和截图，一比一复刻 Aaalice 生成工作台。

用户当前明确要求：
- NAI 主题下生成结果不能有白边；修复时不裁切或改写上游图像像素。
- NAI 布局对照 NAI 官方截图与 button and div.txt，要求一比一复刻。
- NovelAI Local（内部 `nlw`）布局对照 Aaalice_NAI_Launcher，要求一比一复刻。
- 工作时尽可能派遣子代理做只读代码研究、Aaalice 对照和测试审查；用户要求指定 GLM-5.3-Flash，但当前 Agent 工具没有模型选择参数，不得声称已指定该模型。可说明限制并尽量分派代理。
- 截图资料来自前一会话上下文；如果新会话看不到图片附件或它们不能被读取，先告诉用户需要重新附上对应截图，再做像素级验收。`D:\Desktop\button and div.txt` 是约 35k tokens 的单行 DOM 抓取，读取工具会截断，应按关键词/字符区段只读解析。
- 需要用户确认或截图缺失时再问，不要伪称已经像素级验证。只在本地完成，不要部署服务器。
- 用户按功能要求每个独立功能单独提交；提交时只 stage 本次明确文件，绝不用 `git add -A`。用户已有文件必须保留。

布局映射已由子代理核实：
- `WorkspaceLayout` 枚举只有 `lfn | nlw | custom`，见 `src/lib/appearance-store.ts`；设置页 `src/app/settings/page.tsx` 将 `nlw` 标为“NovelAI Local”。
- `classic` 仅是非 NAI 的 `data-studio-layout` 外壳标识，不是 workspace 枚举。
- NAI 是 `preferences.theme === "nai"` / `naiLayout`；设置 UI 称“NAI 风格”。
- `sidebarPromptLayout = naiLayout || nlwLayout || customWorkspace`；NAI 和 NLW 共用 ImageStudio 组件与多个数据片段，但要求分别按各自参考做皮肤/结构，不得把两者做成同一种 UI。
- `nai-studio.css` 由 `src/app/globals.css` 全局导入，NAI 规则需限在 `html[data-theme="nai"]` / `[data-studio-layout="nai"]`，NLW 规则限在 `[data-studio-layout="classic"][data-workspace-layout="nlw"]`。

已完成且已推送的历史提交（不要重复实施，先验源码仍在）：
- `e134bfe`：主结果 flex 撑高导致白边的第一阶段尝试（当前用户希望继续完善 NAI/NLW 两套复刻）。
- `9c850b0`：VSCode 式选中文本右键 AI 菜单/内联聊天对话框。
- `1a4aa58`：右栏折叠按钮移除、双入口折叠语义。
- `f72ce32`：右栏分割方向修复。
- `4435fe1`：NAI 字号调为 13px、参数详情改原地展开、参数 dock `flex-shrink:0`。
注意：当前工作区可能有另一位编辑者并发改动，可能已从 `studio.tsx` 删除上述功能；必须以实时 `git diff` 为准，不要盲目恢复或再次删除。

调查得到的白边根因（已提交 `e134bfe`，需重新验证当前实现和生产效果）：
- 主结果树在 `src/app/image/studio.tsx`：`.workspace-results-scroll > .workspace-result-hero > button.workspace-result-image > img`。
- 旧 CSS `.workspace-result-hero` 是 `flex:1 0 auto`、`background:#fff`、纵向居中；自然比例图片使用 `contain`，容器会被剩余高度撑大，图片上下露出白色剩余区域。
- 没发现 NAI API、PNG/base64、流式或下载链路合成白底/加边。
- 最终方案应保持自然比例且不使用 `cover` 裁切来掩盖问题。结果容器深色、图片/容器比值正确。多图结果需按批次 aspect ratio；历史缩略图固定方形是另一种产品设计，不能直接套主图规则。Lightbox 使用原图和深色 backdrop，不共享白色 hero。
- 已提交的 `e134bfe` 把 hero flex 改 `0 0 auto`、背景改 `var(--surface-muted)`，多图加 aspectRatio，并调了 Aaalice 风格操作栏。但浏览器上未能验证生成结果（当时没有实际结果图）；必须在拿到有效图或可控 fixture 后验证自然尺寸、容器尺寸、像素边缘。

NAI/Aaalice 参考规格（子代理只读逆向，需看源码验证）：
- Aaalice `E:\Aaalice_NAI_Launcher\lib\presentation\screens\generation\widgets\image_preview.dart`：单图按原图 aspect ratio contain，扣除 PreviewInfoBar 高度及 4/8px gap 后计算 fit 尺寸；多图 grid padding 8px、gap 12px、最小卡宽 150px、按数量 2/3/4 列。
- `widgets/common/image_card_frame.dart`：图卡深色底 `#141414`、圆角默认 12px、ClipRRect；静态阴影轻；hover scale 1.01（paint-only，不改变 grid geometry），hover 阴影 alpha .16/blur14/y6；hoverLift 0。
- `widgets/common/image_card_surface.dart`：悬停操作栏在卡片底部 12px 居中；工具栏黑色半透明、圆角 8px、按钮命中区 40px、图标 16px、按钮间距 4px。
- 历史面板底部不显示完整 hover action bar，只在右上角固定复制/删除；历史图仍可通过右键菜单访问全动作。
- Aaalice 参数面板有独立的浮层/底部抽屉行为，需按布局类型区别，不要把它跟 NAI 官网参数 dock 混用。
- 用户给的 NAI DOM 文件确认侧栏 inline 宽度 447px；生成工作区三栏（左 icon rail、设置侧栏、结果区）；提示词块、负向内容块、图像设置、模型/模式、生成 footer；实际抓取中后端有连接错误，未抓到真实生成结果 DOM，也缺完整 computed CSS。

当前/上一轮工作的精确状态（2026-09-30 交接时）：
- 首阶段白边修复提交 `e134bfe` 已推送。修复主结果 hero 被 flex 撑高和白底的问题、多图绑定 aspectRatio、深色主题媒体底；没有真实生成图时尚未验证 natural dimensions/像素边缘。
- 用户批准了两条独立复刻目标。NAI/NLW 源码及 CSS 正在本地未提交修改中，尚未完成第二、第三阶段，也未提交这一轮改动。
- 发现并发代码差异：`src/app/image/studio.tsx` 相对 HEAD 约 1,238 行删除，删掉 provider state、NAI quality/UC preset、tag/prompt 功能、角色 negative、VSCode inline chat 等；`settings/page.tsx` 移除 ProviderSettings 和若干设置，`stories-workspace.tsx` 移除 PopupSelect 并改原生 select，`appearance-store.ts` 删除 `rightPanelKeepOpen`。这些改动来源未知。只做了类型兼容补丁 `providerId: "newapi"` 以通过 tsc，不能据此视为用户批准删功能；下一个 AI 必须先让用户确认并发重构意图，不得擅自恢复或继续覆盖。
- 本地静态检查：当前 `npx tsc --noEmit` 通过；变更文件 eslint 通过。`tests/studio-layout.test.ts` 当前 8 项中 4 项失败：三个 paper/dusk/night 测试仍假设左侧有功能导航入口，NAI 测试仍断言“生成 1 张图像”和 `--lfn-left:400px`，与并发源码当前输出（无导航、按钮“执行生成”、NAI 默认宽度状态）不一致。全量 Vitest 最近未在交接时重跑至通过，必须重跑并基于用户确认的实现修正测试；不能只为绿灯削弱断言。
- 当前 `git status` 有修改：`src/app/image/nai-studio.css`、`src/app/image/studio.tsx`、`src/app/settings/page.tsx`、`src/app/stories/stories-workspace.tsx`、`src/lib/appearance-store.ts`、`tests/studio-layout.test.ts`；未跟踪：`docs/handoff-nai-and-nlw-replica.md`（本文件）、`lottery.html`、`public/pelican-bicycle.html`。后两个 HTML 均已读取开头，内容看起来是独立抽奖页和鹈鹕插画，明显不属于本工作，保持未跟踪、不修改、不提交。`public/pelican-bicycle.html` 会话开始前就存在；`lottery.html` 来源未知。
- 404 服务状态已确认：PID 28428 是 `python -m http.server 21143 --bind 127.0.0.1`，它响应 localhost 的 404；PID 36780 是仓库里的 Next dev `start-server.js`，Next 响应地址为 `http://198.18.0.1:21143/image`。不可结束或重启这两个现有进程。该地址打开后是体验用户（不同 host origin 没有 localhost 登录 cookie），因此它适合无登录结构预览，不适合用用户账号做完整生成验收。临时 `next start --port 21144` 因缺 `LFN_SESSION_SECRET` 和 standalone 配置无法运行，已停止。不能读出、索取或写入 secret。
- NAI 真实页面测量（旧运行态）：`1280×935` viewport、左 panel 400px、scroll 内容区约 710px；用户抓取 DOM NAI 面板宽约 447px。当前工作区改动把 NAI 初始宽设置成 447px，但 localStorage `lfn-nai-left-width` 可能覆盖它；需要结合浏览器实际布局验证后再决定默认/测试断言。
- 当前临时 NAI 复刻尝试：prompt 字段被改为 NAI 专用 `.nai-prompt-field`，正/负 prompt 合并为深色容器，采样器/生成参数/结果使用原业务组件。但因并发重构删除了 quality/UC 状态和工具栏，NAI prompt footer 还未复刻到完整截图规格；必须先确认并发删改是否刻意，再继续。当前 CSS 是按一份更新后的样式文件继续编辑，提交前必须检查完整 diff。

上一位助手做错/需要规避的点：
- 过早承诺“完美一比一”，然后仅按少量 CSS 猜值；本轮必须以每个模式的截图和 DOM 证据逐项复刻，缺少的交互状态要明确询问/索取图，不得声称已完成。
- 误认为 `nai-studio.css` 只服务 NAI；它由全局导入，NLW 规则必须 selector scope 到 `[data-workspace-layout="nlw"]`。
- 曾用 `git add -A` 把 `data-b/`、`public/pelican-bicycle.html` 等运行/无关文件卷入提交，随后 amend 和强推修复；当前必须逐文件 stage。不能强推/改写历史。
- 曾把 `.nai-parameter-details` 改回文档流并调整字号；已提交 `4435fe1`，不要假设并发重构还保留这些规则。
- 曾尝试指定子代理模型 GLM-5.3-Flash，但 Agent 接口没有模型参数；以后如不能选择，要清楚说明限制。
- 用户要求先读所有素材；`button and div.txt` 大于 Read 工具完整输出限额，应分关键词/偏移解析，不得声称全读完后才根据局部摘录改动。

下一步执行要求：
1. 先暂停代码编辑。只读检查完整 `git diff`（尤其 studio.tsx 删除的 1,230 行及 settings/provider 改动）、`git status`、尚未读取的 `lottery.html`，确认并发更改是否为用户刻意重构。绝不 reset/checkout/revert。
2. 向用户简短说明发现的并发冲突/功能删除和 Next/Python 端口冲突，要求用户确认是否保留这版 studio 简化重构；未获确认前不要重写/补回被删的质量词、provider、tag chip、inline chat 等。
3. 保持两条独立路线：`theme=nai` 对照 NAI 官网；`workspaceLayout=nlw`（设置标签“NovelAI Local”）对照 Aaalice。`classic` 只是非 NAI 外壳。
4. 恢复明确可控的本地 Next 验收环境后，才继续实现。每个阶段分别 lint、tsc、Vitest/build，并以实际浏览器 rect/computed style/screenshot 验证。
5. 如果截图不能在新上下文中访问，要求用户重发缺少的参考图；不能说已一比一完成。
6. 推送/提交时只提交用户明确允许的、确属本任务的文件；当前并发差异和两个未跟踪文件不得带入。

## 获批计划原文（必须保留，未经用户同意不得把目标合并）

## 目标边界

按两个独立目标实现，不再把两种布局混在一起：

1. `theme=nai` / `naiLayout`：按你提供的 NAI 官网截图、`D:/Desktop/button and div.txt` DOM 抓取和当前 NAI 主题结构复刻 NAI 工作台。
2. `workspaceLayout=nlw` / 用户看到的「NovelAI Local」：按本会话中用户明确指向的 `E:\Aaalice_NAI_Launcher` 源码和截图，一比一复刻 Aaalice 生成工作台。

`classic` 只是非 NAI 的 DOM 外壳名，不作为第三种复刻目标。现有用户改动 `src/app/ai/generate-image-stream/route.ts` 和未跟踪的 `public/pelican-bicycle.html` 保持不动。

## 已确认的首个 bug

NAI 生成结果白边确定来自当前主图布局：

- `src/app/image/studio.tsx` 的 `.workspace-result-hero` 是 `flex: 1 0 auto`，会被剩余高度撑满。
- `src/app/image/nai-studio.css` 给 hero 设置了 `background: #fff`。
- 图片本身保持自然比例并 `contain` 居中，于是 hero 剩余高度在上下显示白色空带。
- NAI/上游/PNG/base64 流水线没有发现加白底、裁剪或合成操作。

## 实施阶段

### 阶段一：NAI 结果区白边与比例基础

修改范围仅限结果显示链路：

- 让 `.workspace-result-hero` 按批次宽高比收缩，不再 `flex: 1 0 auto` 占满剩余高度。
- 保留图片完整边缘，不用 `object-fit: cover` 伪装修复；图片与容器保持自然比例。
- 移除显眼的白色结果画布，使用 NAI/Aaalice 规格的深色媒体底和主题边框。
- 多图结果按同一批次宽高比计算卡片尺寸，避免 `min-height + height:100% + contain` 产生独立留白。
- NAI 会话历史缩略图继续作为固定方形缩略图单独处理，不把主图规则误套到历史。
- lightbox 保持原图比例和深色 backdrop，不改下载/PNG 数据。

浏览器验证正方形、竖图、横图，读取 `naturalWidth/naturalHeight`、图片/hero 的 `getBoundingClientRect()`、computed `object-fit/background/flex`，并用截图确认四边没有 CSS 白带。

### 阶段二：`theme=nai` NAI 官网高保真复刻

只在 `html[data-theme="nai"]` 和 `data-studio-layout="nai"` 范围内调整，不影响 NLW/其他布局：

- 按你给的 NAI 页面截图重整左侧工作区的层级和密度：顶部 AFF/菜单条、模型/模式条、提示词卡、正负内容、质量词/UC、角色提示、图像设置、生成参数摘要、底部钱包/生成条。
- 对照 `button and div.txt` 的 DOM 证据复刻面板宽度、深色 surface、边框、圆角、间距、滚动和下拉结构；不凭空套未在抓取或截图中出现的组件。
- 保留并修正现有参数 dock：在文档流内展开、不会飞到顶部、不把其它面板覆盖或压扁；提示词/图像设置展开后“采样器/欧拉祖先”始终可见且值保持。
- 对照 NAI 截图实现提示词卡内的工具按钮、文本/Tag 切换、质量 Tags/UC footer、角色区、图像设置与参数抽屉的状态；需要新状态时复用现有 `promptFields`、`characterControls`、`generationParameters` 和 `NaiImageSettings`，不另起一套业务数据。
- 生成结果区按 NAI 截图修复操作按钮、结果背景、尺寸和底部工具栏；下载、放大、图生图、局部重绘、Director 等现有行为保持。

### 阶段三：`workspaceLayout=nlw` NovelAI Local 一比一复刻 Aaalice

只作用于 `[data-studio-layout="classic"][data-workspace-layout="nlw"]`：

- 按 Aaalice 的生成页结构重排：左侧参数栏、中央 prompt/预览/生成区、右侧历史/助手停靠；使用 Aaalice 的左栏 250–450px、右栏可调、主区最小宽、8px resizer 和折叠 rail 规格。
- 左栏按 Aaalice 顺序和密度复刻：模型/模式、尺寸/种子、prompt 编辑器、正负/Tag 状态、角色、反推、参考图、参数与生成控制；复用现有 LFN 数据和操作，只做布局/视觉/交互适配。
- Prompt 编辑器按 Aaalice 规格调整 toolbar、文本/Tag 切换、token footer、权重/词库入口和浮层；不破坏已有 VSCode 式选中右键 AI 菜单。
- 右栏按 Aaalice `RightPanel` 语义保持两块真正独立：历史、助手各自折叠/恢复，二者之间可拖拽分割，折叠态分成两个入口，历史操作保持右上角固定操作，图片操作栏按 Aaalice 底部悬停条复刻。
- 结果区按 Aaalice：深色媒体底、真实比例、无白色 frame，单图按 aspect-ratio 计算，多图 8px 内边距/12px gap，底部 hover action bar 40px 按钮/16px 图标。

### 阶段四：高保真验证与修复循环

每阶段完成后都先在本地 dev 热加载验证，再提交一次；不部署服务器。

验证矩阵：

- NAI：桌面 1440×900、1280×800，窄屏 390×844；1024×1024、832×1216、1216×832。
- NLW：桌面宽/中等窗口和窄屏；左栏折叠、右栏历史/助手独立折叠、分割条拖拽、prompt/Tag、角色、参考图、生成结果。
- 读取真实计算样式和 rect，而不是只看 DOM 文本：结果图 natural 尺寸、hero/image 比例、面板是否重叠、滚动区域、横向溢出、按钮位置。
- 逐像素/截图对照你提供的 NAI/Aaalice参考：先修结构和比例，再修颜色、边框、圆角、间距、字体和 hover 状态。
- 若某个状态仍缺截图或抓取证据，停在该状态并明确需要哪一张截图/哪段 DOM，不猜测替换。可以继续用只读子代理做代码 review、Aaalice 对照和黑盒检查。

### 质量与提交

- 先做阶段一白边修复并单独提交。
- 再做 NAI 复刻并单独提交。
- 最后做 NLW/Aaalice 复刻并单独提交。
- 每次提交前运行变更文件 lint、`tsc --noEmit`、全量 Vitest、`next build`；浏览器验证通过后再推送。
- 提交时只加入本阶段明确改动的文件，绝不包含已有 `route.ts` 改动、`pelican-bicycle.html` 或运行时 data 文件。
```
