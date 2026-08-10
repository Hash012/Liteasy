# 来源确认的文献身份与版本关系设计

**日期：** 2026-08-10
**状态：** 已确认设计，待实现

## 后续确认的权威实施约束

本节记录设计确认后的实施决定；若与下文早期表述冲突，以本节为准。

1. 每个完成来源确认的具体文献版本获得平台唯一、稳定、不透明的 `literatureId`。同一版本被不同用户上传时共用 `literatureId`，但各自保有不同的 `documentId`、文件、目录、权限和私人数据。
2. 预印本与正式发表版必须使用不同的 `literatureId`，仅通过有证据的 `is_preprint_of` 关系连接；关系不自动合并批注、页码、引用指标或全文权限。
3. `unresolved`、`candidate`、`ambiguous`、`conflict` 是解析过程或本地状态，不创建新的正式公共文献记录。正式新记录只能以 `confirmed` 状态写入。旧 `manual`/`legacy_metadata` 记录仅作只读兼容或标记为 `legacy_unverified`，不得无证据升级。
4. 人工题名、作者、年份以及新的 SHA-256 题名作者年份指纹只能帮助检索候选或充当兼容别名，不能独立创建可引用的正式文献，也不能成为 `confirmed` 的唯一依据。
5. 稳定标识与来源证据必须分开保存：`literature_identifiers` 绑定 `literatureId`，并对 `(identifier_kind, normalized_value)` 施加全局唯一约束；`literature_identity_claims` 保存 `provider`、`provider_record_id`、`verification_status`、`evidence` 和 `observed_at`。因此同一个 DOI 只能属于一个 `literatureId`，而 Crossref、OpenAlex、Semantic Scholar 可以分别为它提供证据。
6. 一级原始注册来源（Crossref DOI、arXiv，以及未来 PubMed）在来源内 ID 可精确唯一回查且题录无冲突时可以确认。二级聚合来源（OpenAlex、Semantic Scholar）必须获得两个独立来源的一致证据，或由用户明确选择候选后由服务端重新抓取且不存在冲突，才能确认。
7. Intuecho 内部独立 literature 模块暂时承担平台文献身份权威，不新增第三个服务；其接口保持可抽离。Liteasy 与 Intuecho 不共享数据库、连接池或凭据，只共享 `literatureId` 和 API 契约。
8. Liteasy 保存用户/组织文献库数据以及 confirmed `LiteratureRecord` 的只读投影。Intuecho 不得获知 Liteasy 中的收藏、阅读或上传关系，除非用户主动发布社区内容。
9. Liteasy API 不信任 Desktop 上传的确认快照。云文献写入或更新时，Liteasy API 必须通过受保护的 Intuecho 服务端接口核验 `literatureId + revision` 后再保存投影；已有投影允许离线读取。纯本地 Liteasy 文件可以保存已确认快照。
10. `contentHash` 只用于文件去重和缓存，不能作为跨用户身份。
11. 新链路覆盖并验证后，删除 Desktop 八位 FNV 指纹生成/主身份写路径、`manual` 正式文献创建的 UI/contract/repository 写路径、仅以 `primary.kind != local_paper_id` 判断可同步的旧门槛，以及无调用者的重复确认/schema 分支。旧值只读识别必须保留。
12. 删除前必须证明调用已迁移、旧数据可读、迁移可在空库和已有库执行、专项回归通过，且生产构建不再引用目标代码。
13. `development/dev-cloud works` 仍被标签、索引和推荐使用，不得误删，也不得成为正式引用身份真源。
14. OpenAlex 标识必须在 Desktop、Intuecho contracts、Liteasy API 和社区同步之间使用一致契约。
15. PostgreSQL 使用新的不可变迁移，不修改旧迁移；SQLite 开发实现与 PostgreSQL 正式实现保持行为一致。

## 目标

陌生 PDF 在成为正式论文记录前，必须完成公开来源确认。系统保留预印本、正式发表版和其他版本的独立身份，并通过可审计关系连接它们；题名、作者和年份只用于检索候选，不直接产生可引用的正式身份。

正式 `literatureId` 才能用于引用、社区批注同步、跨用户检索和推荐。未确认文件可以保存在用户本地，但只能处于待确认状态。

## 当前实现与目标差距

当前 Liteasy/Intuecho 已有 `literatureId + literature_identities`、provider 候选、重新抓取确认和人工确认流程。当前人工流程允许只凭题名、作者、年份生成 `title_authors_year_hash` 正式记录，且所有 provider 都按同一确认能力处理。正式服务没有预印本/正式版关系表。

`development/dev-cloud` 另有早期 `works + work_identifiers` 模型，包含 `is_preprint_of` 等关系，但它不属于正式 Liteasy/Intuecho 文献持久化边界，不能作为生产身份真源。

## 实施约束

### 简洁性优先

实现以现有 Intuecho literature resolver、provider adapters、`literature_records` 和 `literature_identities` 为主线，不新增第三套身份服务、不提取跨产品运行时公共包，也不让 Liteasy API、Intuecho API 或 `development/dev-cloud` 共享数据库和凭据。

来源等级、确认状态和版本关系必须各有一个明确真源。Desktop 只负责提取有限线索、展示候选和持久化确认结果；Intuecho 负责 provider 编排、确认策略和正式文献关系。Liteasy API 只保存并校验 Liteasy 自身文献树中的确认投影，不重复执行外部身份裁决。

不为了兼容旧版本长期保留两条可写业务路径。兼容代码只允许读取旧数据并投影到新契约，不能继续创建旧格式身份。

### 旧代码删除标准

下列旧行为在新链路覆盖并通过迁移验证后删除，而不是继续隐藏在分支中：

- Desktop 生成并优先使用八位 FNV 题名作者年份身份的写入路径；只保留旧值识别和只读别名查询；
- 仅凭人工题名、作者、年份直接创建正式 `manual` 文献的 UI、contract 分支和 repository 写入路径；人工输入改为候选检索线索；
- 允许未确认 `PaperIdentity` 绕过 `LiteratureRecord` 进入引用、公开批注或社区同步的旧判断；
- 被新来源等级策略完整替代、且没有其他调用者的 provider 确认分支和重复 schema。

删除前必须逐项证明：调用点已迁移、旧数据仍可读取、不可变迁移可在空库和已有库执行、专项回归覆盖旧记录、生产构建不再引用目标代码。无法满足这些条件的代码不能以“看似旧”为由删除，应先收敛为有截止条件的只读兼容适配器。

`development/dev-cloud works` 当前仍被标签、索引和推荐开发链路使用，不默认视为死代码。本轮只阻止它成为正式引用身份真源；是否删除或合并必须另行完成调用和数据审计，避免把身份改造扩大成无关重构。

### 快速交付策略

在不降低确认标准和迁移安全性的前提下，采用最短纵向主链：

1. 先用共享 conformance fixture 和 contract tests 固定来源等级、正式状态、版本关系及旧数据只读规则；
2. 复用现有四个 provider adapters，在 resolver 内增加分级裁决和重新抓取证据，不重写传输层；
3. 用一份新的 Intuecho 不可变迁移增加确认状态、身份验证证据和版本关系，优先扩展现有表而非复制表；
4. 收紧 Desktop 发布门槛并删除已被替代的人工正式确认和旧指纹写入路径；
5. 先运行受影响窄测试快速反馈，再运行 Intuecho、Desktop、Liteasy API 完整测试及 Desktop 构建。

可独立的 contract、repository、resolver 和 Desktop 适配工作可以并行推进，但数据库契约与状态语义必须先固定。不得通过跳过失败隔离、迁移复验、旧数据兼容测试或完整构建来换取速度。

## 身份分层

```text
documentId       用户拥有的具体本地/云端文件副本
contentHash      PDF 字节指纹，只用于文件去重和缓存
literatureId     已确认的具体学术版本实体
source aliases   provider + provider-native id 的可验证别名
relations        版本之间的有向关系，不合并 literatureId
```

同一字节的两个文件可以拥有不同 `documentId`。同一学术版本可以有 DOI、arXiv、OpenAlex 和 Semantic Scholar 多个别名。`contentHash` 不得进入跨用户文献身份请求。

## 记录状态

```text
unresolved -> candidate -> confirmed
                         ├-> ambiguous
                         └-> conflict
```

- `unresolved`：只有本地文件或 PDF 提取线索。
- `candidate`：provider 返回了候选，但尚未确认。
- `confirmed`：满足来源等级规则，服务端完成重新抓取并写入正式记录。
- `ambiguous`：多个候选或仅有不充分题录，需要用户选择或补充信息。
- `conflict`：稳定标识和题录分别指向不同记录，必须人工处理。

只有 `confirmed` 记录可以被引用、公开批注、社区同步或作为跨用户推荐的精确论文范围。

## 分级来源确认

### 一级：原始注册来源

Crossref DOI、arXiv、PubMed 等能由自身命名空间精确回查的来源，唯一 ID 回查成功且返回题名没有明显冲突，即可确认。来源记录必须保存 provider、规范化 ID、回查时间和来源 URL（如有）。

### 二级：聚合来源

OpenAlex、Semantic Scholar 等聚合来源不能仅凭一次宽搜索自动确认。满足以下任一条件才可确认：

1. 两个独立 provider 的稳定 ID 与完整题名、作者集合、年份一致；
2. 用户明确选择唯一候选，服务端按候选键重新抓取并验证记录契约，且没有冲突来源。

provider 超时或部分不可用不能放宽门槛。候选排序分数只用于展示顺序，不产生身份合并。

### 三级：题录线索

题名、作者、年份指纹、文件名和 PDF 第一页有限提示只能产生候选。它们不能单独创建 `confirmed` 记录，也不能用于社区或跨用户身份。

人工输入可以帮助检索，但“用户填了题名作者年份”本身不等于来源确认；没有来源回查结果时，记录保持 `ambiguous` 或 `unresolved`。

## 外部标识与来源证据模型

每个确认版本保存多个稳定标识，而不是覆盖一个 canonical 字段。标识所有权与 provider 观察证据分别建模：

```text
literature_identifier(
  literature_id,
  identifier_kind,
  normalized_value
)

literature_identity_claim(
  literature_id,
  provider,
  provider_record_id,
  verification_status,
  evidence_json,
  observed_at
)
```

`literature_identifiers(identifier_kind, normalized_value)` 在平台身份权威内全局唯一；`literature_identity_claims(provider, provider_record_id)` 也必须全局唯一地绑定到一个 `literatureId`。不同 provider 可以分别为同一版本留下 claim，但同一来源记录不能横跨多个正式文献。旧的八位题名作者年份值只能作为只读兼容别名；新指纹统一使用 `sha256:<64 lowercase hex>`，且只能用于候选或兼容查询。身份规范化必须在 Desktop、Liteasy API 和 Intuecho 中保持一致。

内部 `literatureId` 是不透明 ID，不由 DOI 或题录拼接生成。主展示标识可以按 DOI、arXiv、OpenAlex、Semantic Scholar、题录指纹的优先级选择，但主展示标识变化不能改变 `literatureId`。

## 版本关系

预印本、正式发表版、修订版和译本是独立的 `literatureId`，通过关系表关联：

```text
literature_relation(
  from_literature_id,
  to_literature_id,
  relation_type,
  provider,
  verification_status,
  evidence_json,
  created_at
)
```

第一阶段支持：

- `is_preprint_of`：预印本 -> 正式发表版；
- `version_of`：具体修订版 -> 其所属作品版本链；
- `translation_of`：译本 -> 原始版本。

关系必须有 provider 明示关系或用户确认的证据。关系不会合并身份、批注页码、正文锚点、引用指标或全文授权。UI 可以展示“已有正式版”并提供跳转；批注迁移必须是显式、逐条且重新定位的操作。

## 陌生 PDF 流程

1. Desktop 从嵌入 metadata、文件名和 PDF 第一页有限内容提取题名、作者、年份和稳定 ID 线索；不上传全文或 `contentHash` 作为身份。
2. Intuecho resolver 先做精确 ID 查询，再做 provider 宽检索；各 provider 独立超时和失败隔离。
3. 结果规范化并按来源等级评估，输出 `exact`、`ambiguous`、`not_found` 或 `unavailable`。
4. `exact` 或用户选择的候选必须由服务端重新抓取确认；客户端题录不能直接持久化为 `public_registry`。
5. 确认成功后创建或复用版本级 `literatureId`，写入全部已验证别名和来源证据。
6. 只有确认写入成功后，Desktop 才允许引用、公开批注或社区同步；失败则保留本地批注和可重试待办。
7. 若确认的是预印本，未来发现正式版时新增正式版记录和关系，不改写预印本身份。

## 兼容与迁移

- 保留现有 `literatureId`、旧身份值、批注和 artifact 关联，不批量静默重写。
- 旧记录再次经过来源确认时，可以在原记录上追加规范别名；不能把旧 `manual` 或 `legacy_metadata` 无证据升级为 `public_registry`。
- 现有 `development/dev-cloud` `works` 数据不直接迁入正式服务；如需迁移，只能逐条经过来源验证并建立版本关系。
- 旧的 Desktop 本地身份在没有正式确认前只能作为本地范围键，不能绕过确认进入社区 API。

## 验证重点

- 一级来源单 ID 精确回查可确认；二级来源单独宽搜索不可自动确认。
- 两个聚合来源的完整题录一致时可确认；冲突时保持 `conflict`。
- 只有题名作者年份、没有来源回查时不能创建正式记录。
- 预印本和正式版产生不同 `literatureId`，关系可查询，批注和页码不自动混合。
- provider 超时不会改变确认门槛；客户端伪造 candidate record 或 relation evidence 会被拒绝。
- OpenAlex 等新增标识在 Desktop、Intuecho contracts、Liteasy API 和社区同步边界保持一致。
