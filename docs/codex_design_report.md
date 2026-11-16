建议把这个 skill 设计成“**结构化读图与情境推理系统**”：先提取可核验的价格事实，再解释多空双方的交易理由，最后给出条件化判断。仅让视觉模型识别 wedge、H2 等形态，距离 Brooks 风格还很远；关键能力是判断：**这个形态出现在什么位置，对谁有利，下一步什么证据会改变判断。**

**研究限制：**本次联网工具与浏览器均无法启动，未能实际读取指定页面或抽样核验历史帖。以下是依据已有知识编写的设计报告，不能当作已完成网站实证研究。链接用于指出待核验的一手来源；文中的数字阈值均为**建议的工程定义，不是 Brooks 原文规则**，也不代表经验证的交易概率。

## 1. Brooks 读图方法论：从 bar 到条件化预期

需要对照的一手入口：

- [Analysis：历史分析帖](https://www.brookstradingcourse.com/analysis/)
- [Price Action Trading Terms Glossary：术语表](https://www.brookstradingcourse.com/price-action-trading-terms-glossary/)
- [Brooks Price Action Abbreviations：缩写表](https://www.brookstradingcourse.com/brooks-price-action-abbreviations/)

以下使用英文术语标识概念，不作为逐字引文。

### 1.1 Bar：先描述事实，再评价强弱

每根 bar 至少记录：

- bull bar / bear bar / doji；
- 实体占比、上下影线、收盘位置；
- inside bar / outside bar；
- 相对大小、与前几根 bar 的重叠程度；
- 相对 EMA20、前高前低、区间边界的位置。

然后区分角色：

- **signal bar**：提供潜在交易触发依据；
- **entry bar**：触发入场的 bar；
- **follow-through bar**：后续走势是否支持前面的突破或反转。

同一根强阳线，在 trading range 顶部可能引来卖盘，在突破后可能代表有效 follow-through。**bar 的外形不能独立决定交易含义。**

### 1.2 Context：决定 bar 应当怎样解释

建议按四层检查：

| 层次 | 核心问题 |
|---|---|
| 市场状态 | bull trend、bear trend，还是 trading range？ |
| 趋势阶段 | breakout、tight channel、broad channel，还是可能进入区间？ |
| 所处位置 | 支撑阻力、前期极值、EMA20、区间边缘、measured move 附近？ |
| 路径与时间 | 这是第几次尝试？此前是否有强突破、失败突破、climax 或多次反转？ |

多周期必须分别推理：

- **周线**：大结构、长期区间、主要趋势与反转候选；
- **日线**：周线结构内部的腿、回调、突破与跟进；
- **5 分钟**：开盘结构、日内趋势、区间、具体 signal/entry，以及交易时段。

周线偏多，不等于当前 5 分钟应当买入。skill 应能同时保留这两个判断。

### 1.3 Bulls / bears：构建两个可交易的解释

每个关键位置都要求回答：

| Bulls | Bears |
|---|---|
| 为什么可能买？ | 为什么可能卖？ |
| 希望出现什么 follow-through？ | 希望出现什么 follow-through？ |
| 哪个位置使其判断失效？ | 哪个位置使其判断失效？ |
| 失败后是否可能被迫退出？ | 失败后是否可能被迫退出？ |

再加入一类参与者：**trapped traders**。例如，向上突破后迅速跌回区间，突破买家可能退出；但是否构成有效反向机会，仍取决于背景与后续确认。

这比“检测到看涨形态，所以看涨”更接近目标能力。

### 1.4 概率：必须附带事件、期限和条件

不能输出一个无定义的“上涨概率 60%”。需要明确：

> 截至当前收盘，未来 \(h\) 根 bar 内，先到目标 T、后到失效位 S 的概率。

必须区分：

1. 作者在帖子中的概率判断；
2. skill 的定性判断；
3. 历史样本校准得到的统计概率。

未经校准时，用“偏向延续”“反转尚需确认”等表达。模型对识图结果的置信度，也不是交易成功概率。

### 1.5 Always In：持续持仓方向的解释框架

**Always In Long / Always In Short** 不宜简化为“价格在 EMA 上方/下方”。

可把它理解为：若必须持有一个方向，当前证据更支持哪一边。系统应允许：

- 多头方向；
- 空头方向；
- 方向不清、证据不足。

“方向不清”是工程输出状态，不应冒充 Brooks 的正式第三种 Always In 术语。

还要分开：

- 当前更可能的持仓方向；
- 当前是否存在值得执行的入场。

市场可以仍偏多，但已经远离合理止损位置。

### 1.6 Traders will watch：把判断转成下一步观察

最终输出应落到具体、可证伪的观察条件：

> 多头希望下一根收在突破位之上，并出现后续跟进；空头希望价格回到区间内。若突破后连续重叠，应降低趋势延续判断。

每个分析必须包含：

- 哪个价格或结构值得观察；
- 希望看到什么行为；
- 出现什么证据应改变判断；
- 该判断何时到期。

上述六步应是可回溯的循环，而不是一次单向分类。

## 2. 可程序化特征：具体算法与边界

### 2.1 统一数据与计算口径

输入至少包含：

```text
timestamp, open, high, low, close
instrument, tick_size, timezone, session
timeframe, adjustment/roll_method
as_of, closed_bar_only
```

5 分钟期货必须明确 RTH/ETH、交易日边界和换月方法。周线必须标记是否已收完。

定义：

```text
R  = max(H-L, tick_size)
B  = abs(C-O)
BR = B/R
CLV = (C-L)/R
UW = (H-max(O,C))/R
LW = (min(O,C)-L)/R
S  = max(ATR14[t-1], tick_size)
ε  = tick_size
```

`S` 使用此前数据；ATR 是尺度归一化工具，不是 Brooks 体系的必要组成部分。

### 2.2 基础 bar 类型

以下阈值是起始参数，应在开发集上冻结后再评测。

| 特征 | 建议算法 |
|---|---|
| Bull / bear bar | `C>O` / `C<O` |
| Doji 候选 | `BR≤0.25`，保留方向信息 |
| 强 bull bar | `C>O, BR≥0.6, CLV≥0.8` |
| 强 bear bar | `C<O, BR≥0.6, CLV≤0.2` |
| Inside bar | `H[t]≤H[t-1] 且 L[t]≥L[t-1]` |
| Outside bar | `H[t]≥H[t-1] 且 L[t]≤L[t-1]`，至少一边严格超出 |
| 大 bar | `R≥1.5S` |
| Bull reversal bar 候选 | 探低后收高，例如 `LW≥0.35, CLV≥0.65`；另检查其是否位于下跌或支撑背景 |
| Bear reversal bar 候选 | 上述镜像 |

这些标签可同时成立。不要把“大阳线”直接命名为“有效买入信号”。

相邻区间重叠定义为：

\[
overlap_t=
\frac{\max(0,\min(H_t,H_{t-1})-\max(L_t,L_{t-1}))}
{\max(\min(R_t,R_{t-1}),tick)}
\]

同时保留实体重叠；影线重叠与实体重叠提供的信息不同。

### 2.3 EMA20 与 EMA gap bar

```text
EMA20[t] = (2/21) × C[t] + (19/21) × EMA20[t-1]
```

须固定初始化方式，提供足够预热数据，并与图表平台对齐。

**EMA gap bar 的关键是整根 bar 与均线分离：**

- 均线上方 gap bar：`L[t] > EMA20[t] + ε`；
- 均线下方 gap bar：`H[t] < EMA20[t] - ε`。

分别记录：

```text
gap_side
gap_size / S
consecutive_gap_bars
bars_since_last_ema_touch
```

不能把“收盘高于 EMA”当作 gap bar，也不能把它与相邻 K 线之间的价格缺口混为一谈。

### 2.4 Swing：同时支持实时与事后视角

**确认型 pivot：**

```text
pivot_high(t,k):
    H[t] 为 [t-k, t+k] 的最高值
```

低点镜像；相等高低点须固定取舍规则。这个 pivot 直到 `t+k` 才知道，因此：

```text
event_time = t
known_at   = t+k
```

**实时 directional-change swing：**

- 上行段持续更新候选最高点；
- 从该高点回撤达到 `δ` 才确认 swing high；
- 下行镜像；
- 可取 `δ=max(3 ticks, 0.75×S)` 为初始值，并固定尺度更新方式。

每个 swing 输出起止、幅度、持续时间、确认时间和 provisional 状态。禁止把事后确认点提前提供给 agent。

### 2.5 H1 / H2 / L1 / L2：必须是状态机

H1/H2 不等于第一个、第二个 higher low。

建议定义：

1. 上行趋势或上行腿进入回调，创建 `pullback_id`。
2. 回调中，首次出现 `H[t]>H[t-1]`，标记一次 **High 1** 触发事件。
3. 该次尝试后再次恢复回调，随后第二次出现向上触发，标记 **High 2**。
4. L1/L2 对称：下行背景的反弹中，统计向下恢复尝试。
5. 连续创新高不能每根都递增计数；必须先重新进入回调状态。
6. 趋势恢复、结构失效或新腿建立后，按明确规则重置。

输出分开保存：

```text
signal_bar
trigger_bar
attempt_number
pullback_id
context_valid
reset_reason
```

这里最需要人工标注验证的是“同一回调何时结束”。仅靠局部高低点比较会严重过计数。

### 2.6 Wedge：三次推进只是候选条件

使用同一尺度的 swings：

- 上行 wedge 候选具有三次向上推进及其间回撤；
- 下行镜像；
- 允许近似双顶/底和小幅未创新高；
- 分别计算推进幅度、回撤深度、斜率、重叠和通道几何关系；
- 将三次推进、通道收敛、动能减弱分别打分。

例如：

```text
pushes >= 3
intervening_pullback >= 0.3S
extreme_tolerance = 0.15S
```

不能规定每个 wedge 都必须具备完美收敛三角形，也不能把三根连续同向 bar 当作三次推进。

输出应是“wedge 候选及其质量”；反转仍需背景、signal bar 和 follow-through。

### 2.7 MTR：结构序列，不是单个形状

**Major Trend Reversal** 建议表示成阶段：

```text
原趋势
→ 对原趋势的实质性破坏
→ 对原趋势极值区域的测试
→ 反向信号
→ 反向突破与后续跟进
```

工程上分别检测：

- 原趋势强度；
- 已知 swing 所构成趋势线的突破；
- 对原极值的重测，可能形成 higher low、lower low、double bottom 等不同结构；
- 反向 signal；
- 反向突破及 follow-through。

状态输出：

```text
candidate → signal_triggered → follow_through → failed
```

一根大阴线、一次 EMA 跌破或任意双顶，都不足以独立确认 MTR。

### 2.8 Trading range：使用多证据评分

对窗口 `N`，计算：

\[
ER=\frac{|C_t-C_{t-N}|}{\sum_{i=t-N+1}^{t}|C_i-C_{i-1}|}
\]

再结合：

- 相邻 bar 的平均重叠；
- EMA20 穿越次数；
- 上下边界的重复测试；
- 突破后返回区间的次数；
- 方向交替与双向长影线；
- 归一化 EMA 斜率。

可从以下候选规则起步：

```text
N = 20
ER < 0.3
mean_overlap > 0.5
EMA 穿越次数 >= 4
```

不能单凭这三项定论：broad channel 也可能高度重叠。建议分别评估多个窗口，并允许：

> 小级别 trading range，位于大级别 bull channel 内。

区间边界须在当前时刻冻结，避免未来扩展后的边界改变早期标签。

### 2.9 Breakout、follow-through、失败突破

设当前已知阻力为 `U`：

```text
突破尝试：H[t] > U + ε
收盘突破：C[t] > U + ε
跟进证据：后续 1–3 根仍收在 U 上方，并继续向上推进
失败候选：规定期限内收回 U 下方
```

区分：

- 刺穿；
- 收盘突破；
- 有跟进的突破；
- 失败突破。

失败判断需要等待，因此必须记录 `known_at`。向下镜像。

### 2.10 Always In 的工程实现

建议使用有记忆和切换门槛的状态机：

```text
evidence_long =
    强多头突破
  + 多头 follow-through
  + swing 结构向上
  + 对空头尝试的失败
  - 当前区间证据
```

空头镜像。只有反向证据达到门槛、并破坏既有结构，才切换状态，避免每根 bar 翻转。

这是 **Always In 的工程代理**，需要专家标注评估，不能宣称已经客观复刻 Brooks 的判断。

所有特征都应统一输出：

```text
value, supporting_bars, known_at,
parameters, quality, ambiguity
```

## 3. 截图读图与 OHLC：推荐混合架构

| 任务 | 仅截图 | OHLC |
|---|---|---|
| 大趋势与明显区间 | 可行 | 可行 |
| 精确高低点、1 tick 触发 | 易受分辨率影响 | 可靠 |
| EMA gap 是否真实存在 | 线宽会造成误判 | 可精确计算 |
| H1/H2 逐次计数 | 容易漏 bar | 适合状态机 |
| 图上注释、作者强调区域 | 可读取 | 通常缺失 |
| 防止未来信息泄漏 | 必须裁图并去注释 | 可严格截断 |
| 复现与回测 | 较差 | 较好 |

截图特有的风险：

- 坐标轴被裁切，无法确定价差；
- 上涨颜色不统一；
- 图表缩放改变形态的视觉陡峭程度；
- EMA 线与影线遮挡；
- 最新 bar 尚未收完；
- 作者箭头和文字直接泄漏答案；
- 可见历史太短，遗漏关键 context。

OHLC 也有局限：

- 同一根 bar 的 OHLC 无法恢复内部价格路径；
- 同一 bar 同时触及止损和目标时，无法知道先后；
- 不同 session、复权或期货拼接方法会改变结构；
- 数值精确不意味着解释唯一。

推荐流程：

```text
截图 → 图表元数据、可见结构、注释识别
OHLC → 精确特征、时序状态、候选结构
两者对齐 → 多空论证 → 条件化观察清单
```

无 OHLC 时，输出“可见”“疑似”“无法确认”，不要从像素编造精确价格。评测时应单独比较 screenshot-only、OHLC-only 和两者结合。

## 4. Skill 目录、SKILL.md 与输出模板

下面是设计建议，尚未创建文件。

### 4.1 目录结构

```text
brooks-chart-reading/
├── SKILL.md
├── references/
│   ├── terminology.md
│   ├── methodology.md
│   ├── feature-spec.md
│   ├── counting-rules.md
│   ├── timeframe-context.md
│   └── sources-and-rights.md
├── scripts/
│   ├── validate_ohlc.py
│   ├── extract_features.py
│   ├── detect_swings.py
│   ├── count_entries.py
│   ├── detect_structures.py
│   └── render_chart.py
├── schemas/
│   ├── chart-input.schema.json
│   ├── feature-event.schema.json
│   └── analysis-output.schema.json
├── templates/
│   └── analysis.zh.md
└── evals/
    ├── manifest.jsonl
    ├── rubric.md
    ├── split-policy.md
    └── run_eval.py
```

生产 skill 与评测答案应隔离，避免 agent 通过读取目录获得测试标签。历史文章不应默认打包进 skill。

### 4.2 SKILL.md 大纲

**目的**

对指定截至时间的图表进行 Brooks 术语框架下的结构分析，并提供可证伪的后续观察。

**触发条件**

用户要求价格行为读图、Brooks 风格分析、多周期结构解释或交易信号复盘。

**输入检查**

确认品种、周期、session、时区、截至时间、最新 bar 是否收完，以及截图和 OHLC 是否匹配。

**执行顺序**

1. 验证数据和可见范围。
2. 提取 bar、EMA、swing 等事实。
3. 判断多尺度 context。
4. 检测结构候选并检验反证。
5. 分别解释 bulls、bears、trapped traders。
6. 判断 Always In 方向及其稳定性。
7. 给出主情景、备选情景与失效条件。
8. 输出 traders will watch。
9. 列出数据与判断的不确定性。

**硬约束**

- 不使用截至时间之后的信息；
- 不把形态名称直接变成交易结论；
- 不输出未经校准的精确概率；
- 不把工程阈值归于 Brooks；
- 不把候选形态写成确认形态；
- 不从截图猜测精确 tick；
- 不强制每张图都找到交易。

### 4.3 中文输出模板

```text
品种／周期／session／截至时间：
数据来源与质量：
最新 bar 是否收完：

1. 可核验事实
   关键 bar、EMA 关系、swing、重要价位。
   每条附 bar/time 引用。

2. Context
   大结构：
   当前局部结构：
   两者是否冲突：

3. Bulls
   支持理由：
   希望看到：
   失效条件：

4. Bears
   支持理由：
   希望看到：
   失效条件：

5. Always In
   方向：
   支持与反证：
   是否存在清晰入场：是／否／证据不足

6. 情景
   主情景：触发 → 观察目标 → 失效 → 期限
   备选情景：触发 → 观察目标 → 失效 → 期限

7. Traders will watch
   下一步最关键的 2–3 个可观察事件。

8. 不确定性
   数据缺失、计数歧义、替代解释。
```

结构化结果还应包含 `as_of`、`known_at`、`source_bar_ids`、`feature_spec_version`。这使结论可以审计和复现。

## 5. 用历史帖子建立评测集

### 5.1 分开评估三种能力

| 评测任务 | 输入 | 参考答案 |
|---|---|---|
| 结构识别 | 截至时点的图/OHLC | 独立标注的 bar、swing、结构候选 |
| Brooks 框架解释 | 同一输入 | 人工抽取并改写的多空理由、条件和观察点 |
| 前瞻判断 | 同一输入 | 截止之后真实发生的价格路径 |

**与作者观点一致，不等于预测正确；预测正确，也不等于推理符合该方法。** 两者应分别评分。

### 5.2 样本设计

建议先做一个约 120 例的标注试验，再确定大规模样本量。分层覆盖：

- 周线、日线、5 分钟；
- 趋势、区间、趋势向区间过渡；
- 成功与失败突破；
- H1/H2/L1/L2、wedge、MTR 候选及失败案例；
- 形态模糊、没有清晰交易的负例。

记录实际署名。网站上的文章不能未经核验就全部标为 Al Brooks 本人撰写。

每例 manifest 至少保存：

```text
source_url, author, published_at
instrument, timeframe, session
analysis_as_of, input_end_time
data_vendor, data_hash
annotation_version, rights_status
```

### 5.3 最关键的是防泄漏

- 输入只到文章分析的真实截至时点；
- 移除图中答案性箭头、文字和未来 bars；
- 区分盘前展望、盘中评论、盘后复盘；
- 若文章解读的是尚未收完的周线，不能用最终周线 OHLC；
- 同一日期的周线、日线与 5 分钟相关样本按组划分；
- 同一篇文章的不同裁图不能跨训练和测试；
- 时间切分并设置足够隔离区间，防止重叠窗口泄漏。

公开历史帖子还可能被模型预训练见过。因此，历史样本适合测试“框架复现”，但不足以证明泛化；需要加入**未发表的新图表与独立标注**。

### 5.4 标签应允许多种合理解释

建议至少两位熟悉体系的标注者独立标注，再处理分歧：

```text
共同确认的事实
可接受的结构解释集合
明显不成立的解释
支持与反证
合理的观察条件
标注分歧
```

不要把作者的一句话转成唯一分类标签。尤其是 wedge 起点、回调计数重置和 Always In 转换，可能存在合理分歧。

### 5.5 评分标准

建议用一个初始的 100 分 rubric：

| 维度 | 分值 |
|---|---:|
| bar、价位、EMA 与时序事实正确 | 25 |
| context 和多周期关系 | 20 |
| bulls/bears 论证及反证 | 20 |
| Always In 与条件化情景 | 15 |
| traders will watch 的具体程度 | 10 |
| 不确定性与证据可追溯性 | 10 |

另设严重错误项：未来数据泄漏、虚构价格、假引用、把未确认结构写成已确认、伪造概率。

程序特征测 precision/recall 和确认延迟；概率预测仅在事件定义明确时测 Brier score、校准与覆盖率。自然语言相似度不应成为主要评分指标。

必须加入消融对照：

```text
普通读图模型
仅术语说明
仅 OHLC 特征
完整 skill
```

这样才能知道收益来自术语提示、精确数据，还是完整推理流程。

### 5.6 版权处理

建议采取保守的数据设计：

- 公开发布的评测包以 URL、元数据、自写结构化标签和独立行情数据为主；
- 不默认复制整篇文章、整套图表或术语表；
- 技术术语可保留，定义用自己的话重述，并保留出处；
- 需要引用原文时，只使用完成论证所需的短片段；
- 自行根据获许可的 OHLC 绘图，并分别检查行情数据的使用与再分发限制；
- 全文缓存、批量图表使用、训练或商业分发前，核验网站条款并取得必要许可；
- 不绕过付费墙或访问限制。

这些是数据治理建议，并非对具体使用是否构成合理使用的法律结论。每份素材应单独记录许可状态，不能把“网上公开可读”视为“可自由用于训练和再分发”。

**实施优先级：**先完成术语核验、OHLC 特征与时序状态机，再做少量专家标注和盲测；证明它能可靠地区分事实、解释与反证之后，再扩展截图识别和历史帖规模。skill 是否成功，应看它能否解释“为什么在这里有意义、什么会推翻判断”，而不只是正确叫出形态名称。