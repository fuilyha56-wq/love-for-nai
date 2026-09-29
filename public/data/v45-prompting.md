# NovelAI V4.5 构思与写法（LFN 移植版）

> 基于 [nai5-prompting](https://github.com/Miint-Sunny/nai5-prompting)（GPL-3.0）的 V5 方法，
> 按 V4.5 模型特性改写。适用模型：nai-v4.5-full / nai-v4.5-curated / -limit。

## 与 V5 的关键差异

1. **基础质量词**：V4.5 Full 默认 `location, very aesthetic, masterpiece, no text`；
   Curated 默认 `location, masterpiece, no text, -0.8::feet::, rating:general`。
   质量词追加在提示词**末尾**（LFN 质量词预设自动处理）。
2. **无 V5 的「轻量档」**：V4.5 只有一档 NAI 默认质量词。
3. **权重语法**：`{tag}` 强化 1.05x、`[tag]` 弱化 0.95x，可叠加；数字权重
   `1.1::tag::` 可用但社区实践偏保守，V4.5 对嵌套加权更敏感，建议最多两层。
4. **角色提示词**：V4.5 支持 `v4_prompt.char_captions`（LFN「多角色」区块），
   每个角色独立 caption + 位置坐标；角色框内不需要重复质量词。
5. **Curated 与 Full 的差异**：Curated 预设更强调画面干净（负面里含
   `blurry, upscaled`），对人物结构（手、脚）的宽容度更低。

## 构思

先想值得展开的内容：谁处于什么处境、什么关系或变化让人记住。想法可以从
人物、情绪、世界规则、矛盾、物件或形式实验出发。

- **关系和反差**：熟悉的人或物进入不相称的环境会发生什么？
- **欲望和代价**：想得到什么、为什么不直接拿到？
- **规则和例外**：把世界里的一个常识改变后，画面会怎样？
- **感官和情绪**：从温度、声音、材质、空旷、压迫或亲近感出发。

## 写法（Danbooru 标签）

V4.5 以 Danbooru 标签为主语言。顺序建议：

1. **人数与性别**：`1girl` / `2boys` / `no humans`（无人物场景）
2. **角色特征**：发色发型、瞳色瞳形、肤色、身高体态、兽耳尾巴等
3. **服装**：材质 → 款式 → 状态（`white kimono, detached sleeves`）
4. **动作与姿势**：`sitting, wariza, looking at viewer, hand on own cheek`
5. **构图与镜头**：`portrait / cowboy shot / full body` + `from above / dutch angle`
6. **场景与氛围**：背景、时间、天气、光照（`night, indoors, candlelight, rim lighting`）
7. **风格**：`flat color, watercolor (medium), sketch` 等

### 强调与弱化

- `{masterpiece}`：约 1.05x/层，最多叠 3 层
- `[blurry]`：约 0.95x/层
- 组合 `{{tag}}` 用于关键主体；V4.5 对过度加权的响应是画面脏化，
  宁可少不要多

### 负面提示词

使用 LFN 的「负面预设 (UC)」下拉即可（与官网一致），需要追加时放预设之后：
`blurry, extra digits` 等。V4.5 对 `bad anatomy, bad hands` 响应明显。

## 多角色（V4.5 专属工作流）

1. 启用「多角色」，每个角色填独立提示词（不重复全局质量词）
2. 设定每个角色的画面位置（centerX/centerY）
3. 角色数量建议 ≤3；更多角色掉出 Opus 免费档且结构易崩
4. 角色提示词同样遵循Danbooru 语法，但不写人数（人数由角色数决定）

## 参考图与多角色一同使用

图生图/局部重绘 + 多角色可以同请求：源图提供构图与色调，角色提示词
引导角色结构。氛围迁移（vibe）+ 多角色在 V4.5 同样成立。

## 检查清单

- [ ] 人数标签与角色数一致（或明确 no humans）
- [ ] 质量词由预设注入，不在正文重复
- [ ] 强调不超过两层
- [ ] 负面用预设，不堆砌无关词
- [ ] 构图词与画面意图一致（portrait 用于特写而非全身）
