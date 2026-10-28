# LFN 提示词格式化：按 Aaalice 原版对齐

日期：2026-10-25（Asia/Shanghai）。本次记录替代此前移除空格转换的处理结论。

## 原版行为与源码依据

已直接检查本地 `E:\Aaalice_NAI_Launcher`，参考版本为 `f92ead23`。空格转下划线是原版明确提供的自动格式化功能。

对应源码：

- `lib/core/utils/text_space_converter.dart`：空格转换和保护字符规则。
- `lib/core/utils/nai_prompt_formatter.dart`：逐行处理、中文逗号和空白规范化、标签拼接。
- `lib/core/utils/prompt_edit_document.dart`：禁用片段保护，包括转义和未闭合片段。
- `lib/core/utils/character_prompt_block_parser.dart`：`negative(...)` 块边界。
- `lib/presentation/widgets/prompt/unified/unified_prompt_input.dart`：失焦处理顺序和 Tag 模式跳过。
- `lib/core/autocomplete/autocomplete_settings.dart` 与 `prompt_token_parser.dart`：补全默认保留规范标签名中的下划线。
- `test/core/utils/nai_prompt_formatter_test.dart`：本次移植的原版格式化测试用例。

## 实际转换规则

`TextSpaceConverter` 对每个普通空格检查前后最近的非空格字符，而不是仅检查紧邻位置。原版用预计算实现线性复杂度；本次移植也保持线性扫描。

1. 空格在 `<...>` 内时保留，包括嵌套及尚未闭合的尖括号。
2. 前后最近的非空格字符属于 `,，{}[]()|<>` 时保留空格。
3. 其余空格改为 `_`。转换器本身逐个转换；整个格式化器会先把连续行内空白整理成一个空格。
4. 格式化器逐行处理，保留 LF、CRLF、CR、空行、行首缩进及行尾空白，不把换行变成下划线。
5. 中文逗号 `，` 转为英文逗号，去除空标签，普通标签用 `, ` 连接，并保留原有行尾逗号。原版没有额外把 `、` 或 `：` 改写成英文标点。
6. 禁用片段 `/*disabled:...*/` 原文保持不变，包括转义的结束符和未写完的片段；保留禁用片段前后的既有分隔边界。
7. `negative(...)` 的内容通过同一个格式化流程处理，关键字和块边界保留。
8. 原版没有给普通引号单独提供空格豁免，因此 NAI 自动格式化下的 `"Hello world"` 会成为 `"Hello_world"`。LFN 的自然语言图像模型继续跳过 NAI 格式化。

| 输入 | 开启自动格式化后失焦 |
| --- | --- |
| `white hair, blue eyes` | `white_hair, blue_eyes` |
| `{ blue eyes }` | `{ blue_eyes }` |
| `red hair | blue eyes` | `red_hair | blue_eyes` |
| `<my character>` | `<my character>` |
| `1.20::soft light::` | `1.20::soft_light::` |
| `negative(red hair, blue eyes)` | `negative(red_hair, blue_eyes)` |
| `/*disabled:blue eyes*/` | 原文保留 |

## 触发时机与开关

原版在文本输入框失焦时处理，顺序为用户正则替换、可选 SD 语法转换、可选自动格式化；Tag 模式不会因为添加标签输入框失焦而格式化整段提示词。

LFN 保留已有“自动格式化”开关，默认开启。关闭后手写或粘贴的空格不受格式化器改写。普通标签补全默认直接插入规范标签名，例如 `blue_eyes`，与原版默认 `replaceUnderscores=false` 一致。词库引用和显式组合内容按候选原文插入，之后是否格式化由文本框的失焦开关决定。

## LFN 实现

- 新增 `src/lib/nai-prompt-formatter.ts`，等价移植转换器、逐行格式化、禁用片段保护和负面块处理，保留 MIT 来源说明。
- `formatReplicaPrompt()` 统一调用新实现，桌面、移动端和现有 LFN / NAI / NLW 编辑布局复用同一规则。
- 移除上一轮“补全一律改为空格”的处理，恢复规范标签名插入。
- 更新两端设置说明，说明转换时机及保护位置；正负提示词统一应用。
- 自然语言模型保持既有语义保护，只应用用户配置的正则规则。

## 验证与部署

完整回归：139 个测试文件、1061 项测试通过。新增 11 项转换器测试包含原版六个格式化例子及保护字符、引号、禁用片段、未闭合 negative 块等边界。ESLint、TypeScript 检查及 Linux 生产镜像构建通过。

浏览器验证覆盖桌面与移动端的 LFN、NAI、NLW 六种组合，检查失焦转换、受保护空格、关闭及重新开启自动格式化、正负提示词、保存重载、在线与离线补全及共现推荐。真实付费生成未用于验证。

已部署镜像：`love-for-nai:aaalice-prompt-20261025-r1`，Build ID：`VPOEoefzZuNrXmkbWrJGE`。116.3 MiB 镜像归档上传后 SHA-256 一致，服务器成功导入并重建现有服务；上一镜像 `love-for-nai:codex-20261025-prompt-settings` 和 Compose 备份保留用于回滚。

上线后独立验证通过：内外网健康正常，免费图准入 readiness 为 `ready`，`/api/health`、`/image`、`/api/tags?status=1` 均返回 HTTP 200，新容器重启次数为 0。检查了服务器实际生产资源，确认包含新转换器和设置文案，且镜像未包含本地私有文件。

通过仅监听本机的 SSH 转发加载服务器实际页面，六种桌面/移动布局的浏览器复核 **6/6 全部通过**。浏览器测试使用独立临时会话，API 写入由测试模拟，未修改真实用户的提示词或触发付费生图。

本地证据：`.tmp/prompt-spaces/aaalice-deployment-receipt.json`、`aaalice-deploy.log`、`aaalice-release-manifest.json`；线上浏览器证据：`.tmp/prompt-spaces-production/results.json` 和同目录截图。
