# Liteasy 原文批注与 Intuecho 文献解析设计

**日期：** 2026-08-09
**状态：** 已确认

## 目标

统一 Liteasy 原文批注和 Intuecho 文献关联流程，使用户能够：

- 在 PDF 原文上直接创建高亮、划线或旁注，再选择是否公开到 Intuecho；
- 不再通过独立的“发到论坛”按钮或“立即同步”按钮完成公开；
- 由 Liteasy 从 PDF 和既有文献元数据中自动识别论文，并从公开论文库补全身份；
- 在自动识别失败时手动补录，并在 Liteasy 与 Intuecho 中明确保存 `manual` 来源；
- 在 Intuecho 发帖时通过标题、DOI 或任一支持的论文标识检索文献，选择后自动补全其余信息；
- 让回复在用户明确选择时形成一条关联文献的独立批注，同时保持回复与派生帖的生命周期一致。

本设计不共享 Liteasy 与 Intuecho 的数据库连接池或凭据，不把完整 PDF 上传到 Intuecho，也不把仓库测试描述为公开论文源或生产部署已经验收。

## 当前问题

Liteasy PDF 阅读器目前存在两条竞争路径：选区菜单可以“发到论坛”并打开 Web 草稿，保存后的原文批注又可以进入“同步到论坛”队列。用户必须先理解论坛交接和同步队列，而不是围绕批注本身选择可见范围。

原文批注虽然保存 `PaperIdentity`，但公开前仍可能因只有本地身份而失败。当前错误要求用户自行补全 DOI、arXiv、Semantic Scholar，或完整标题、作者和年份；应用没有提供文献级确认流程，也没有把确认结果稳定写回论文记录。

Intuecho 的关联文献编辑器直接暴露身份类型、身份值、标题、作者、年份和文献类型。相同论文需要重复填写，手填数据与公开论文库结果也没有可审计的来源差异。数据库只允许 `inferred` 和 `metadata` 两类身份来源，不能准确表达公开来源确认或人工补录。

回复功能还使用“只要带 targets 就创建派生 annotation”的隐式规则。`shareToPlaza`、目标文献和派生批注创建不是同一个明确意图，回复与派生帖也可能从不同编辑入口发生正文分叉。

## 方案选择

采用 **Intuecho 统一解析，双方独立持久化**：

- Intuecho API 提供统一文献解析边界，先查自身已有文献记录，再查询配置好的公开论文来源；
- Liteasy 桌面端和 Intuecho Web 使用同一解析契约和候选排序；
- Liteasy 把用户确认结果写入自己的文献级元数据；
- Intuecho 在确认和发帖事务中写入自己的 `literature_records` 与 `literature_identities`；
- 两个产品不共享数据库连接、迁移角色、运行凭据或业务连接池。

不采用 Intuecho 反向依赖 Liteasy 正式 API 的方案，因为这会让论坛发帖依赖另一个产品的业务服务。也不让两个客户端各自直连公开来源，因为这会重复密钥、限流、去重和来源验证逻辑，并导致跨端结果漂移。

## 总体架构

```text
PDF 元数据 / 正文身份线索 / 用户检索词
                    |
                    v
        Intuecho Literature Resolver
                    |
       +------------+-------------+
       |            |             |
  Intuecho 库    OpenAlex      Crossref / arXiv /
                              Semantic Scholar
       +------------+-------------+
                    |
                    v
     规范化 LiteratureRecord 与候选来源
              /                 \
             v                   v
  Liteasy 文献级元数据      Intuecho 文献记录
```

公开来源连接器和密钥属于 Intuecho API。未配置的 provider 不参与检索；运行时不能返回静态演示论文或 mock 业务结果。开发环境使用真实开发 API，稳定测试通过受控 transport 和固定 fixture 验证契约，不把 fixture 暴露为运行结果。

## 共享文献契约

共享契约位于 `products/intuecho/packages/contracts/`，由 Intuecho Web、Intuecho API 和 Liteasy 的论坛客户端消费。Liteasy 的领域类型保持在 Liteasy feature 内，通过适配器转换，避免 Liteasy feature 反向依赖论坛 UI。

```ts
type LiteratureIdentifierKind =
  | "doi"
  | "arxiv_id"
  | "semantic_scholar_id"
  | "openalex_id"
  | "title_authors_year_hash";

type LiteratureSource =
  | "public_registry"
  | "manual"
  | "inferred";

type LiteratureIdentifier = {
  kind: LiteratureIdentifierKind;
  source: LiteratureSource;
  value: string;
};

type LiteratureRecord = {
  authors: string[];
  documentType?: string;
  identifiers: LiteratureIdentifier[];
  intuechoLiteratureId?: string;
  provenance: {
    confirmedAt: string;
    mode: "public_registry" | "manual";
    provider?: "intuecho" | "openalex" | "crossref" | "arxiv" | "semantic_scholar";
  };
  title: string;
  year?: number;
};
```

`inferred` 只用于尚未确认的候选，不能直接成为新公开批注的最终来源。用户确认公开论文库候选后，最终记录为 `public_registry`；只有自动解析和公开检索没有合适结果、用户提交兜底表单时，最终记录才是 `manual`。

用户在搜索框中键入 DOI 或标题不等于手填元数据。只要服务端从公开记录核验并补全，结果仍是 `public_registry`。`manual` 专门表示无法由公开来源核验、由用户对字段负责的文献记录。

## 解析与确认 API

Intuecho API 增加两个认证接口：

### `POST /v1/literature:resolve`

输入可以包含：

- 一个用户查询词，可为标题、DOI、arXiv、Semantic Scholar 或 OpenAlex 标识；
- Liteasy 从 PDF 本地提取的标题、作者、年份和标识候选；
- 有限的候选数量和调用用途，不包含 PDF 字节或全文。

响应是三种明确结果之一：

- `exact`：只有一个可由稳定标识或高置信组合字段确认的结果；
- `ambiguous`：返回有限候选，必须由用户选择；
- `not_found`：没有可靠结果，允许进入手填兜底。

解析顺序为 Intuecho 已有规范化记录、精确外部标识、标题检索。标题相似只能产生候选，不能单独触发自动合并。候选按稳定标识一致、标题一致、作者重合和年份一致排序；排序分数不作为可见论文身份。

### `POST /v1/literature:confirm`

该接口接受以下二选一输入：

- 服务端签发或可重新核验的公开候选键；
- 经手填规则校验的完整 `manual` 记录。

公开候选必须由服务端缓存记录或重新查询核验，客户端不能自行把任意 JSON 标成 `public_registry`。确认成功后，服务端返回规范化 `LiteratureRecord` 和稳定 `intuechoLiteratureId`。

手填记录始终要求标题，并满足以下条件之一：

- 至少一个合法的 DOI、arXiv、Semantic Scholar 或 OpenAlex 标识；
- 至少一位作者和合法年份，由标题、作者、年份生成稳定指纹。

手填记录的标题、作者、年份和所有手填标识都保存 `manual` 来源。以后公开来源找到相同论文时可以提示用户显式校正或补全，但不得静默把原手填记录改写成已核验数据。修订保留原来源和历史值。

## 规范化、去重与冲突

- DOI 去除 URL/`doi:` 前缀、规范大小写和尾部标点；
- arXiv 去除 URL、`.pdf` 和版本后缀用于同作品匹配，同时保留展示值；
- Semantic Scholar 与 OpenAlex 使用各自可验证的 canonical ID；
- 同一稳定标识命中已有记录时复用该 `literatureId`；
- 多个稳定标识命中同一记录时可以补全缺失字段；
- 多个标识分别命中不同记录时返回身份冲突，禁止自动合并；
- 只有标题相似、缺少作者或年份时不自动合并；
- 预印本与正式出版版本只有在公开来源提供可验证版本关系时关联，不因题名相似硬合并。

Intuecho 的新不可变迁移为文献记录增加来源和修订信息，并允许 `public_registry` 与 `manual` 身份来源。旧 `inferred` / `metadata` 数据原样保留；迁移不能把旧 `metadata` 批量伪装成公开来源已核验。实现可使用仅用于历史兼容的 `legacy_metadata` 投影，直到记录再次被显式解析。

## Liteasy 文献级持久化

Liteasy 在论文记录上保存结构化 `LiteratureRecord`，不把确认结果只放进某条批注或临时队列：

- 本地 PDF 写入本地文献存储边界中的版本化文献元数据；
- metadata-only 文献更新其已有元数据记录；
- 用户云或组织云文献通过 Liteasy 自己的服务 API 更新，不能由 Intuecho 直接写 Liteasy 数据库；
- 浏览器开发环境使用明确的开发持久化适配器，不能在 Tauri 写盘失败时把浏览器缓存伪装成权威持久化；
- 本地完整备份包含该文献元数据和来源标记。

Liteasy 正式服务、开发数据库和桌面本地存储使用相同来源枚举。数据库或结构化快照必须在论文记录及每个标识上保留 `manual`，不能只写日志、UI 状态或批注正文。既有 `PaperIdentity` 通过适配器从 `LiteratureRecord.identifiers` 选择主身份，优先级保持 DOI、arXiv、Semantic Scholar、OpenAlex、标题作者年份指纹、本地身份。

确认流程必须先成功写入 Liteasy 文献级元数据，再创建 Intuecho 公开批注。Liteasy 写入失败时保留本地批注和待办状态，但不继续公开，避免两端永久分叉。Intuecho 返回的 `literatureId` 再写回 Liteasy；该回写失败时保留可重试关联，不重复创建论坛文献或批注。

## Liteasy 原文批注交互

### 创建与公开

- 删除 PDF 选区菜单中的“发到论坛”；
- 用户仍可直接创建高亮、划线或旁注；
- 新批注默认私有；
- 每条批注提供“公开到论坛”开关；
- 可保留文档级“新批注默认公开”设置，但默认关闭；
- 开启公开后立即进入身份解析和同步，不要求用户再点击“立即同步”；
- 已确认过文献身份的后续批注直接复用论文记录。

第一次公开时，Liteasy 按以下顺序工作：

1. 读取论文已有结构化元数据；
2. 在本地解析 PDF 内嵌 metadata、文件名和正文中的有限身份线索；
3. 调用 Intuecho 解析接口，不上传 PDF 或全文；
4. 唯一可靠结果自动确认，多个结果显示候选选择，无结果显示手填兜底；
5. 把确认结果写入 Liteasy 文献记录；
6. 使用确认后的 `literatureId` 和原文字句目标创建 Intuecho 批注；
7. 保存远端批注 ID、远端修订和同步时间。

### 状态模型

将“用户期望的可见范围”和“Intuecho 实际状态”分开持久化：

```ts
type PdfAnnotationPublication = {
  desiredVisibility: "private" | "public";
  lastError?: string;
  remoteAnnotationId?: string;
  remoteRevision?: number;
  state:
    | "not_published"
    | "resolving_identity"
    | "needs_identity_selection"
    | "needs_manual_identity"
    | "pending_create"
    | "published"
    | "pending_update"
    | "pending_retract"
    | "failed";
};
```

界面显示“私有、正在公开、需要确认文献、已公开、更新失败、撤回失败”等真实状态。断网、未登录、限流或服务错误时，本地批注始终保存，操作写入持久重试队列：

- 创建失败显示“尚未公开”；
- 更新失败说明论坛仍展示旧版本；
- 撤回失败必须说明“论坛仍公开”，不能提前显示成私有；
- 用户在创建完成前关闭公开时取消尚未发送的创建意图；
- 重启后恢复未完成操作，不能重复创建批注。

公开批注的正文使用用户旁注；没有旁注时使用被标记的原文字句。修改批注正文会更新同一 Intuecho 批注，不创建新帖。关闭公开会撤回其公共可见性，同时保留本地批注和远端关联，方便审计与显式重新公开。

创建、更新和撤回使用本地批注 ID、修订号与幂等键。服务端必须逐项回显可验证的本地队列键、远端批注 ID 和修订，缺失回显按失败处理。

## Intuecho 发帖交互

当前原始身份表单替换为一个文献搜索组合框：

- 输入标题、DOI 或任一支持的标识即可检索；
- 结果展示标题、作者、年份、主要标识和来源；
- 选择结果后自动补全并以紧凑文献项显示；
- 支持一条批注关联多个文献或原文字句；
- 无结果时显示“手动添加文献”，默认不暴露原始身份字段；
- 手填表单按最低身份规则校验，并明确记录为人工补录；
- 原文字句目标只额外填写页码和引文，不重复填写论文身份。

论坛从 Liteasy 接收已确认的 `literatureId` 时直接读取自己的文献记录，不接受客户端用同一 ID 覆盖标题、作者或来源。旧 handoff 继续只用于需要打开 Web 编辑器的其他流程；原文批注公开不再创建 handoff 或跳转论坛页面。

## 回复与派生批注

### 明确意图

回复默认只写入回复线程，不要求文献目标，也不创建独立批注。回复编辑器增加“同时发布为独立批注”开关。契约使用明确的 `publishAsAnnotation`，不再以 `targets.length > 0` 推断是否创建派生批注。

开启后：

- 默认继承父批注全部关联文献和具体目标；
- 用户可以移除、补充或改选目标；
- 手填文献的 `manual` 来源和稳定 `literatureId` 原样继承；
- 清空全部目标时不能发布独立批注，但仍可提交普通回复；
- 回复和派生批注在一个数据库事务中创建，任一写入失败则全部回滚。

派生批注的可见范围不能比父批注更宽：

- 公开父批注生成公开派生批注并进入广场；
- 组织批注生成同组织可见派生批注，不进入公共广场；
- 互关或私有批注生成同范围派生记录；
- 回复编辑器不能把受限父批注提升为公开内容。

`shareToPlaza` 只描述公开批注是否进入广场投影，不能再兼任“是否创建派生批注”。非公开范围固定不进入公共广场。

### 单一正文真源

回复是正文真源，派生批注保存唯一 `sourceReplyId`：

- 派生批注正文不能从普通批注编辑入口单独修改；
- 编辑回复在同一事务中更新回复和派生批注正文、作者快照与修订；
- 标签、关联目标和独立发布状态在回复的发布设置中维护；
- 用户撤回派生批注时保留回复，并在回复旁显示独立批注已撤回；
- 用户删除回复时在同一事务中撤回派生批注；
- 父批注被删除时不删除回复作者自己的派生批注，但来源入口显示“原回复对象已删除”；
- 平台因内容违规治理派生批注时，同时隐藏相同正文的回复并追加审计，避免通过线程绕过治理。

广场中的派生批注显示“回复了某条批注”的上下文入口。原回复线程只渲染回复一次，并提供派生批注链接，不把同一内容再渲染成第二条回复。派生批注自己的评分、收藏和后续回复独立统计，不复制回原线程。

## 组件与职责

- Intuecho literature resolver：编排内部库和公开 provider，规范化、去重、冲突检测和候选排序；
- Intuecho contracts：定义文献记录、解析结果、确认输入、手填校验及 `publishAsAnnotation`；
- Intuecho repository：持久化文献来源、多个身份、修订、批注目标和回复派生关系；
- Intuecho Web target editor：文献搜索、候选选择、手填兜底和目标展示；
- Intuecho reply composer：显式控制派生批注、继承目标和联动编辑；
- Liteasy paper identity feature：本地 PDF 线索提取、文献契约适配和主身份选择；
- Liteasy literature client：调用 Intuecho 解析/确认接口，不持有 provider 密钥；
- Liteasy 文献 metadata repository：在本地、开发和正式服务边界持久化确认结果及来源；
- Liteasy PDF feature：直接批注、公开开关和真实状态展示；
- Liteasy controller：编排身份确认、文献持久化、公开队列、编辑与撤回，保持 `layout -> controllers -> features`；
- `AppShell`：只组合 controller 和 reader props，不继续承载跨模块公开逻辑。

## 安全、隐私与运行边界

- Liteasy 只向 Intuecho 发送有限元数据和身份候选，不发送 PDF 字节或全文；
- provider 密钥、联系方式、限流策略和缓存位于服务端，不能进入浏览器 bundle、artifact、日志或批注；
- 查询长度、候选数量、超时、并发和缓存容量必须有上限；
- 搜索与确认需要有效用户身份，并按用户和来源限流；
- 服务端重新核验公开候选，客户端不能伪造 `public_registry`；
- 手填记录是用户提供的数据，展示和审计时不能伪装为外部来源核验；
- API 普通错误只返回稳定错误码和用户可见消息，不暴露 provider 密钥、SQL、内部路径或 endpoint；
- 正式 Intuecho 与 Liteasy API 继续使用各自数据库、迁移角色和备份策略。

## 错误处理

- 内部库命中时，即使外部 provider 暂时不可用也可返回已有记录；
- 部分 provider 失败时返回其余可验证结果，并携带非敏感的可用性状态；
- 全部来源失败与确实无结果必须区分，前者允许重试，后者允许手填；
- 身份冲突拒绝确认，不选择任意一条静默合并；
- Liteasy 文献持久化失败时不继续公开；
- Intuecho 创建成功但 Liteasy 回写失败时，使用相同幂等键恢复关联，不重复发帖；
- 回复与派生批注任一写入失败时事务回滚；
- 派生批注撤回失败时回复仍显示其实际公开状态；
- 队列损坏时隔离损坏项并显示可恢复错误，不删除本地批注。

## 测试策略

### 共享契约与 resolver

- DOI、arXiv、Semantic Scholar、OpenAlex 和标题作者年份指纹规范化；
- 精确标识、标题候选、跨来源去重和身份冲突；
- `exact`、`ambiguous`、`not_found` 与 provider failure 区分；
- 公开候选防伪和确认时重新核验；
- 手填最低条件、字段上限、`manual` 来源和显式修订；
- 旧来源迁移不伪装为 `public_registry`。

### Intuecho API 与仓库

- 新迁移从空库和既有迁移集运行；
- 文献记录与多个身份的来源持久化；
- 同一标识幂等复用、冲突拒绝和并发确认；
- 创建、更新、撤回公开批注的幂等与修订检查；
- 纯回复不创建派生批注；
- `publishAsAnnotation` 继承文献和可见范围；
- 回复与派生批注事务回滚、正文联动、用户撤回、删除联动和治理联动；
- 父批注删除后的固定来源占位；
- 派生批注互动不污染原回复线程统计。

### Liteasy 桌面

- PDF 选区菜单不再出现“发到论坛”；
- 高亮、划线和旁注默认私有并直接保存；
- 开启公开后自动解析，不需要“立即同步”；
- 唯一候选自动确认、多候选选择和无结果手填；
- 手填来源写入论文级元数据并被后续批注复用；
- 文献写入失败不继续公开；
- 创建、编辑、撤回、断网、重启恢复和幂等回写；
- 撤回失败明确显示论坛仍公开；
- Tauri 权威存储失败时不把浏览器缓存伪装为已保存。

### Intuecho Web

- 单搜索框支持标题和各类身份；
- 结果自动补全且默认不展示原始身份表单；
- 多候选选择、无结果手填和多文献目标；
- 回复默认纯回复，开启独立发布后预填父目标；
- 清空目标时仍可回复但不能派生批注；
- 派生帖上下文入口、原线程单次渲染和撤回状态。

### 集成与构建

- 自动识别后公开原文批注；
- 自动识别失败后手填、两端持久化 `manual`；
- 重启后恢复待公开、待更新和待撤回操作；
- 公开批注编辑与关闭公开；
- 公开回复派生帖、组织范围派生帖和父批注删除；
- 运行 Intuecho API、Web、Liteasy Desktop 和受影响 Liteasy 服务测试；
- 运行 Intuecho Web、Liteasy Desktop 及受影响服务的生产构建；
- 以配置好的真实公开来源完成部署环境验收，测试 fixture 不作为上线证据。

## 非目标

- 不建立新的跨产品共享数据库；
- 不让 Intuecho 直接修改 Liteasy 文献库；
- 不上传 PDF 到论坛做身份识别；
- 不在本阶段建立通用引文图或全文搜索产品；
- 不仅凭标题相似自动合并论文；
- 不自动把手填记录升级成公开来源已核验；
- 不把普通回复自动变成广场帖子；
- 不重构无关的推荐、组织、私聊或 Agent 系统。

## 验收标准

1. Liteasy PDF 选区菜单不再提供“发到论坛”，用户围绕原文批注本身选择是否公开。
2. 新批注默认私有；开启公开后自动解析并直接同步，无额外“立即同步”步骤。
3. 唯一可靠论文自动补全，多候选由用户选择，无结果允许按最低规则手填。
4. 手填记录在 Liteasy 与 Intuecho 的文献记录和标识上明确保存 `manual`，后续批注复用。
5. Intuecho 发帖只需搜索标题或任一标识，选择后自动补全，不默认暴露整套身份表单。
6. 标识冲突不会被标题相似度或客户端输入静默合并。
7. 断网、更新失败和撤回失败显示远端实际状态；重启不会重复创建帖子。
8. 普通回复不创建派生批注；只有显式开启独立发布并保留至少一个目标时才创建。
9. 回复是派生批注正文真源，编辑、删除和治理按本设计联动，用户可仅撤回独立发布而保留回复。
10. 派生批注不能扩大父批注可见范围，且不会在原线程重复渲染。
11. Liteasy 与 Intuecho 继续使用独立数据库、连接池、凭据和迁移边界。
12. 受影响测试和构建通过，真实公开来源可用性由目标环境验收，不由 fixture 代替。
