# 来源确认的文献身份与版本关系设计

**日期：** 2026-08-10
**状态：** 已确认设计，待实现

## 目标

陌生 PDF 在成为正式论文记录前，必须完成公开来源确认。系统保留预印本、正式发表版和其他版本的独立身份，并通过可审计关系连接它们；题名、作者和年份只用于检索候选，不直接产生可引用的正式身份。

正式 `literatureId` 才能用于引用、社区批注同步、跨用户检索和推荐。未确认文件可以保存在用户本地，但只能处于待确认状态。

## 当前实现与目标差距

当前 Liteasy/Intuecho 已有 `literatureId + literature_identities`、provider 候选、重新抓取确认和人工确认流程。当前人工流程允许只凭题名、作者、年份生成 `title_authors_year_hash` 正式记录，且所有 provider 都按同一确认能力处理。正式服务没有预印本/正式版关系表。

`development/dev-cloud` 另有早期 `works + work_identifiers` 模型，包含 `is_preprint_of` 等关系，但它不属于正式 Liteasy/Intuecho 文献持久化边界，不能作为生产身份真源。

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

## 外部别名模型

每个确认版本保存多个来源别名，而不是覆盖一个 canonical 字段：

```text
literature_identity(
  literature_id,
  provider,
  identifier_kind,
  normalized_value,
  verification_status,
  evidence_json,
  observed_at
)
```

`provider + normalized_value` 在产品服务内唯一。旧的八位题名作者年份值只能作为只读兼容别名；新指纹统一使用 `sha256:<64 lowercase hex>`。身份规范化必须在 Desktop、Liteasy API 和 Intuecho 中保持一致。

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
