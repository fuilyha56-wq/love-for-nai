# 如何搜索和阅读文档

文档中心提供使用教程、账号说明、API 参考和平台管理文档。内容按 2026-10-24 的实现维护；价格、可用模型和注册入口仍以站点实时配置为准。

![LfN 文档全文搜索和分类菜单，示例数量仅用于说明操作](/docs/docs-search.png)

## 找到需要的内容

1. 在“搜索全部文档内容”输入标题、参数名、端点或错误关键词，例如 `/ai/generate-image`、`mask`、`签到`。
2. 搜索覆盖标题、摘要、分类和全部正文，当前实现按输入的完整关键词进行不区分大小写的包含匹配。
3. 使用“文档分类”缩小范围。下拉项显示分类名称和篇数；结果区域显示当前找到的文档数量。
4. 在目录选择标题查看正文。搜索没有结果时调整关键词或分类，也可一键清空筛选。

搜索框右侧叉号只清空关键词，分类条件仍保留。筛选标签可单独移除，“重置筛选”恢复全部文档。分类菜单支持鼠标、触控与键盘操作。

## 桌面与手机

桌面同时显示目录与文章。手机先显示目录，点标题进入阅读界面，正文顶部“返回目录”保留搜索条件。代码和表格可以在自身区域横向滚动，无需缩小整页。

## 分享文档链接

使用 `/docs?slug=launcher-integration` 可直接指定文章；`/docs?q=关键词` 可预填搜索。两者同时使用时，搜索条件可能排除指定文章，因此分享具体教程优先只带 `slug`。

示例中的 `https://lfn.example` 是占位地址，请全部替换成实际 LfN 站点根地址。`LFN_API_KEY` 表示你的 NewAPI 图像密钥，示例不包含真实凭据。原生 `/ai` 返回 ZIP 或 MessagePack，不能直接当作 OpenAI JSON 处理。

## 阅读路线

- 网页创作：[快速开始](/docs?slug=quickstart) → [工作台](/docs?slug=workspace-guide) → [图片广场](/docs?slug=gallery-discovery)。
- 外部客户端：[密钥与工具](/docs?slug=api-keys-and-clients) → [NAI Launcher](/docs?slug=launcher-integration)。
- 自编程序：[API 总览](/docs?slug=api-overview) → [OpenAI 兼容](/docs?slug=openai-compatible-api)或[原生生成](/docs?slug=native-api-reference)。
- 签到和自动化：[账号与签到](/docs?slug=account-and-check-in)。
- 站点运营：[平台配置](/docs?slug=platform-configuration) → [活动与文档维护](/docs?slug=creator-activities)。
