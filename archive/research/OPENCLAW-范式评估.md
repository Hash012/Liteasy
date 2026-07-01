# LiteasyClaw 与 OpenClaw 范式关系评估

更新时间：2026-05-13

## 1. 这份文档回答什么

这份文档回答四个问题：

1. OpenClaw 范式到底是什么
2. LiteasyClaw 和 OpenClaw 的关系与异同是什么
3. 在 LiteasyClaw 中应用 OpenClaw 范式有没有意义
4. 如果要应用，应该怎么应用，应用到什么程度

结论先写在前面：

- **有意义应用**
- **但不应该把 LiteasyClaw 直接做成 OpenClaw 的外壳产品**
- **正确做法是借用 OpenClaw 的“内部 agent 架构范式”，而不是照搬它的产品交互方式**

也就是说，LiteasyClaw 应该是：

- 面向科研用户的桌面优先产品
- 以固定工作流和可视化界面为主
- 在内部用 OpenClaw 式的 `tools / skills / allowlist / direct dispatch` 思想组织 agent 运行时

而不是：

- 让用户直接面对一个通用 agent 宿主
- 把产品体验退化为命令行式 skill 调用器

## 2. OpenClaw 范式是什么

根据 OpenClaw 官方文档，OpenClaw 的核心不是“一个会聊天的模型”，而是一套**代理运行时组织方式**。

它至少有三层：

1. **Tools**
   工具是 agent 实际调用的结构化能力。官方文档把它定义为 typed functions，例如 `exec`、`browser`、`web_search`、`message`。  
   参考：<https://docs.openclaw.ai/tools>

2. **Skills**
   skill 不是工具本身，而是“教 agent 如何使用工具”的操作知识与流程封装。OpenClaw 使用 AgentSkills 兼容的 `SKILL.md` 文件夹结构。  
   参考：<https://docs.openclaw.ai/tools/skills>

3. **Plugins**
   plugin 可以注册工具，也可以附带 skill。也就是说，plugin 是能力扩展包，tool 是能力接口，skill 是能力使用说明和流程约束。  
   参考：<https://docs.openclaw.ai/tools>

OpenClaw 还有几个对 LiteasyClaw 特别重要的机制：

### 2.1 技能位置和技能可见性是分开的

OpenClaw 官方文档明确说：

- skill 的**位置/优先级**，决定哪一份 skill 生效
- skill 的**allowlist**，决定某个 agent 实际能不能用这个 skill

这意味着：

- “系统里存在某个 skill”
- 不等于
- “当前 agent 被允许使用某个 skill”

这和 LiteasyClaw 当前想要的安全边界高度一致。  
参考：<https://docs.openclaw.ai/tools/skills>

### 2.2 工具允许列表和拒绝列表是第一层安全边界

OpenClaw 官方文档支持 `tools.allow` / `tools.deny`。而且它是 fail-closed 的：  
如果 allowlist 最终没有解析出可调用工具，运行会直接停止，而不是装作能做。  
参考：<https://docs.openclaw.ai/tools>

这个思想对 LiteasyClaw 很重要，因为你们不希望 assistant 因为自然语言失控而“瞎改软件”。

### 2.3 Skill 可以是模型触发，也可以是确定性直达工具

OpenClaw 文档里提到：

- `user-invocable` skill 可以变成 slash command
- skill 还可以声明 `command-dispatch: tool`
- 这样某些 skill 可以**不经过模型自由发挥**，而是直接、确定性地派发到工具

这对 LiteasyClaw 非常关键，因为：

- 你们的中栏固定模态按钮，本质上就不是“让模型猜要做什么”
- 而是“用户已经明确指定模态，系统应该确定性地派发到对应主工作流”

参考：
- <https://docs.openclaw.ai/tools/slash-commands>
- <https://docs.openclaw.ai/skills>

## 3. LiteasyClaw 和 OpenClaw 的关系

### 3.1 相同点

LiteasyClaw 和 OpenClaw 在“内部运行逻辑”上有很多共性：

- 都不是单纯把自然语言直接丢给一个模型
- 都需要模型之外的结构化能力
- 都需要 skill 来封装流程
- 都需要对 agent 能调用什么能力做边界控制
- 都需要把“可见能力”和“实际允许调用的能力”分开

从这个意义上说，**LiteasyClaw 的 agent runtime 非常适合借用 OpenClaw 范式**。

### 3.2 不同点

但 LiteasyClaw 不是 OpenClaw 的简单垂直版，两者定位不同。

#### OpenClaw 更像“通用 agent 宿主”

OpenClaw 面向的是：

- 通用 agent 运行
- 通用自动化
- 通用工具调用
- 多 workspace / 多 agent / 多 plugin 协调

它更像一套 agent OS / runtime。

#### LiteasyClaw 是“科研产品”

LiteasyClaw 面向的是：

- 个人科研用户
- 论文阅读与学习
- 选中文献集上的受控分析
- 固定主链路
- 可视化工作台

LiteasyClaw 的核心不是“开放式 agent 控制一切”，而是：

- 有清晰主干
- 有固定 UI 入口
- 有领域约束
- 有知识追溯要求

所以二者关系应理解为：

- **OpenClaw 是内部架构范式参考**
- **LiteasyClaw 是面向最终用户的垂直产品**

## 4. LiteasyClaw 里哪些部分适合用 OpenClaw 范式

### 4.1 适合：右栏 assistant 的分支能力

这是最适合直接套用 OpenClaw 思想的部分。

原因：

- 用户表达的是意图，不是精确 API
- 需要 skill 来解释“我要做什么”
- 需要 allowlist / action boundary 防止乱改软件
- 需要把设置调整、补充产物、局部问答、联网推荐等操作结构化

这正是：

- `自然语言 -> skill -> action`

的典型场景。

### 4.2 适合：软件内能力的注册与权限边界

LiteasyClaw 应该把下面这些统一做成结构化能力：

- 设置变更
- 启动选中文献集导入
- 启动某种模态分析
- 打开指定产物标签页
- 刷新推荐缓存
- 切换输出模式

这部分不该散落在 UI 组件里，而应做成接近 OpenClaw 风格的注册中心：

- `tool registry` 或 `action registry`
- `skill registry`
- allowlist / denylist / confirmation policy

### 4.3 适合：后续插件生态

到你们后面的插件阶段，OpenClaw 的 plugin + skill 思路会很有价值。

例如未来的：

- 专注度插件
- TODO 插件
- 组织知识库插件
- 外部学术检索插件

都适合做成：

- plugin 提供工具能力
- skill 提供工作流约束
- LiteasyClaw 再决定哪些对用户暴露

### 4.4 部分适合：组织能力与多 agent 协作

OpenClaw 对多 agent / workspace / visibility 的处理思路，也适合未来 LiteasyClaw 的：

- 组织空间
- 共享知识库
- 组织管理员限定 skill 集
- 不同组织对不同能力的开关

但这不是当前 Phase 0-1 最优先的事情。

## 5. LiteasyClaw 里哪些部分不应该直接照搬 OpenClaw

### 5.1 不应该把“用户主交互”做成 skill 命令式界面

LiteasyClaw 的主干不是 slash command，也不是 `/skill xxx`。

你们已经确认过的主干是：

`工作区 -> 勾选文件 -> 形成选中文献集 -> 导入 -> 选择模态按钮 -> 启动分析`

这条链路是：

- 显式
- 可视化
- 可控
- 面向科研用户

它不应该退化成“对 assistant 说一句话让它猜”。

### 5.2 不应该让核心主干完全依赖模型自由路由

OpenClaw 允许 skill 通过模型或命令触发，但 LiteasyClaw 的主干不该主要依赖模型判断。

对于你们的中栏固定模态按钮，更合理的是：

- 用户先显式指定模态
- 系统再做确定性 dispatch

也就是更接近 OpenClaw 文档里的：

- direct tool dispatch

而不是：

- open-ended model routing

### 5.3 不应该把 LiteasyClaw 早期做成“开放技能市场产品”

OpenClaw 有 ClawHub、workspace skill 目录、安装/更新 skill 等生态要素。  
这对 LiteasyClaw 长期有参考价值，但对早期产品不是必要前提。

LiteasyClaw 在早期阶段最重要的是：

- 跑通主链路
- 做稳主干
- 保持软件边界干净
- 让分支 skill 可控

而不是一上来就让终端用户自己装各种 skill。

## 6. 在 LiteasyClaw 中应用 OpenClaw 范式，有没有意义

结论：**有，而且是高价值应用，但应该是“选择性应用”。**

### 6.1 有意义的地方

#### 意义 1：把“会说话的 assistant”变成“可控的 agent runtime”

如果不用 OpenClaw 范式，LiteasyClaw 很容易滑向：

- 右栏是个聊天框
- UI 组件里东一块西一块写分支逻辑
- 设置、产物、推荐、导入各自实现一套判断

这会很快失控。

而 OpenClaw 式组织能把它收敛成：

- skill 负责流程语义
- action/tool 负责底层执行
- UI 只负责入口与反馈

#### 意义 2：让安全边界变清楚

你们已经多次强调：

- 不能因为 assistant 的自然语言把软件搞乱

OpenClaw 范式正好提供了非常成熟的思路：

- allowlist
- denylist
- visibility != permission
- direct dispatch
- fail closed

这和 LiteasyClaw 需求是同向的。

#### 意义 3：对未来扩展友好

LiteasyClaw 后面无论扩到：

- 组织
- 插件
- 外部数据源
- 多模型协作
- 多 agent 协作

都更适合跑在 skill/tool/action 的中间层之上，而不是堆在页面组件里。

### 6.2 没有意义的地方

#### 没必要把 OpenClaw 整套产品体验搬进 LiteasyClaw

LiteasyClaw 不是拿来替代 OpenClaw 的通用 agent 面板。

如果硬搬，会带来问题：

- 用户心智被通用 agent 化
- 主干交互变弱
- 学术产品的可视化优势被稀释
- 复杂度上升过快

#### 没必要早期引入完整 skill 安装市场

这会让产品边界和安全边界一起变复杂。

## 7. 我们项目里应该怎么应用 OpenClaw 范式

我建议用“**主干确定性 dispatch + 分支 skill/action runtime**”这个版本。

### 7.1 统一的三层映射

在 LiteasyClaw 中，可以这样映射 OpenClaw 三层：

#### LiteasyClaw 的 Tool / Action 层

对应 OpenClaw 的 tools，但对 LiteasyClaw 来说，更贴近“action registry”：

- `settings.update`
- `selected_set.import`
- `analysis.start`
- `artifact.open_tab`
- `recommendation.refresh`
- `profile.toggle`

特点：

- typed
- side effect 明确
- 可审计
- 可确认
- 可 deny

#### LiteasyClaw 的 Skill 层

对应 OpenClaw 的 skills：

- `settings.adjust`
- `artifact.generate`
- `concept.explain`
- `paper.qa`
- `recommend.related`
- `profile.configure`

特点：

- 面向任务语义
- 允许组合 action
- 允许调用检索/模型/审计
- 必须受 allowlist 控制

#### LiteasyClaw 的 Plugin 层

对应 OpenClaw 的 plugins：

- 浏览器检索插件
- 组织知识源插件
- 专注度插件
- TODO 插件
- 多模态外部生成插件

### 7.2 主干不走自由文本，走确定性 dispatch

LiteasyClaw 主干应当这样做：

- 中栏固定模态按钮 = 用户明确声明目标模态
- 系统不让模型猜“要不要导图还是 PPT”
- 而是直接 dispatch 到对应主工作流

可以理解成：

- 这条主干也可以视为 skill
- 但它应由 UI 直接触发
- 不应依赖自然语言理解来决定入口

这和 OpenClaw 里的 `command-dispatch: tool` 思路最接近。

### 7.3 右栏分支走 skill/action runtime

右栏 assistant 应当这样理解：

- 不是主干入口
- 是主干后的分支控制台

默认前提：

- 当前选中文献集已经导入

然后右栏 skill 再做：

- 局部解释
- 局部问答
- 补充导图
- 生成某类补充产物
- 调整设置
- 触发推荐

### 7.4 allowlist 应按“模式 / 身份 / 风险等级”三维控制

LiteasyClaw 不应只有一个全局 skill 表。

建议至少按三维限制：

#### 1. 按交互模式

- `解释`模式允许：解释类、引用类、轻产物类
- `问答`模式允许：QA 类、检索类、局部补充类
- `命令`模式允许：设置类、推荐类、产物分支类

#### 2. 按用户身份

- 普通个人用户
- 高级用户
- 组织成员
- 组织管理员

#### 3. 按动作风险

- 低风险：问答、解释、临时产物
- 中风险：联网推荐、画像开关
- 高风险：删除、清空、同步关闭、组织配置修改

### 7.5 把“选中文献集”作为 skill runtime 的默认上下文对象

这是 LiteasyClaw 相比 OpenClaw 的一个关键垂直化改造。

OpenClaw 更偏通用 workspace 语义。  
LiteasyClaw 则应强制围绕：

- 当前工作区
- 当前选中文献集
- 当前模态
- 当前会话

来组织运行时上下文。

也就是说，LiteasyClaw 的大多数 skill 不应直接面对“整个文件系统”，而应默认面对：

- 已锁定
- 已导入
- 可检索

的选中文献集。

## 8. 对当前 LiteasyClaw 阶段的具体建议

### 8.1 当前阶段应该做

1. 继续保留并强化中栏固定模态按钮主干
2. 让右栏全部走 `skill registry / action registry`
3. 让导入状态稳定附着在单文件
4. 让大多数右栏 skill 默认依赖“已导入选中文献集”
5. 为高风险 action 增加确认和失败说明

### 8.2 当前阶段不应该做

1. 不要把核心主干改造成纯自然语言入口
2. 不要开放通用 skill 安装市场给终端用户
3. 不要让 assistant 直接获得“任意软件控制权”
4. 不要把 OpenClaw 的通用 agent UI 心智直接移植到 LiteasyClaw

## 9. 最终判断

最终判断很明确：

### 9.1 LiteasyClaw 和 OpenClaw 的关系

- **不是同一个产品**
- **不是简单套壳关系**
- **是“垂直产品”对“通用 agent runtime 范式”的借鉴关系**

### 9.2 OpenClaw 范式在 LiteasyClaw 中有没有意义

- **有意义**
- 而且对 LiteasyClaw 的长期架构是高价值参考

### 9.3 该怎么应用

最正确的应用方式是：

- 借 OpenClaw 的内部组织方式
- 不照搬 OpenClaw 的用户交互方式

也就是：

- 主干：固定模态按钮 + 确定性 dispatch
- 分支：自然语言 -> skill -> action
- 底层：allowlist / denylist / side-effect boundary / fail-closed

### 9.4 一句话结论

**LiteasyClaw 应该做成“OpenClaw-inspired agent runtime inside a research product”，而不是“把 OpenClaw 本身做成 LiteasyClaw”。**

## 10. 参考资料

以下为本分析主要依据的 OpenClaw 官方资料：

- OpenClaw Tools and plugins: <https://docs.openclaw.ai/tools>
- OpenClaw Skills system: <https://docs.openclaw.ai/tools/skills>
- OpenClaw Skills overview: <https://docs.openclaw.ai/skills>
- OpenClaw Slash commands: <https://docs.openclaw.ai/tools/slash-commands>
- OpenClaw Browser plugin guidance: <https://docs.openclaw.ai/browser>
- OpenClaw CLI skills: <https://docs.openclaw.ai/cli/skills>

其中关于以下判断，属于我基于官方资料结合 LiteasyClaw 当前产品定义作出的工程推断：

- “中栏固定模态按钮应更接近 direct dispatch，而不是自由文本入口”
- “LiteasyClaw 应借范式，不应照搬 OpenClaw 的最终用户交互方式”
- “选中文献集应成为 LiteasyClaw skill runtime 的默认上下文对象”
