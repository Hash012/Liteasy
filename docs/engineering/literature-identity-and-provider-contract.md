# 文献身份与 Provider 能力契约

**状态：** 2026-08-11 主线契约；以 `docs/superpowers/specs/2026-08-10-source-confirmed-literature-identity-design.md` 的后续确认约束为最高依据。

## 范围与实现方式

本契约是 Liteasy Desktop、Liteasy API 和 Intuecho 的共享文献身份规范。当前仓库没有根级 npm workspace；为避免跨产品运行时依赖和反向依赖，本轮不提取公共 npm 包。三个实现保持独立，通过
`development/test-data/literature-identity/conformance.json` 验证一致性。

Liteasy API 与 Intuecho API 必须继续使用各自的数据库、连接池、对象存储和凭据。契约共享不表示服务或数据共享。

## 身份规范化

稳定标识采用以下规范值：

| 类型 | 规范 |
| --- | --- |
| DOI | 移除 DOI URL 或 `doi:` 前缀、尾部引用标点，转小写 |
| arXiv | 移除 URL、`arXiv:`、`.pdf` 和版本后缀 `vN`，转小写 |
| Semantic Scholar | `CorpusID: 123` 规范为 `corpus:123`；其他 ID 去空白并转小写 |
| OpenAlex | 只接受 work ID `W<digits>` 或对应 URL，规范为大写 |
| 题名作者年份 | `sha256:<64 lowercase hex>` |
| PMLR | 不是稳定标识；只允许 `{source: "pmlr", volume, year}` 提示 |

题名、作者和年份身份使用以下规范：

- 文本先执行 NFKC 和小写化，再把标点、符号和空白折叠为单个空格。
- `Family, Given` 与 `Given Family` 视为同一作者。
- 作者必须是完整集合；集合去重、排序后用于比较和新 SHA-256 指纹，因此作者顺序不改变身份。
- 年份必须是四位整数。
- 指纹输入是规范化后的 `{authors, title, year}` JSON；缺少任一项不得生成指纹。

PDF `contentHash` 只用于本地文件去重，不能成为跨用户文献身份。PDF 第一页正文只在 Desktop 本地提取有限提示，不得进入 Intuecho 或 Liteasy API 的身份请求。

## 兼容与迁移

已有八位十六进制 FNV 题名作者年份值是只读兼容别名。系统不得批量改写旧身份、`literatureId`、批注、论坛引用或 artifact 关联。

确认新记录时可以生成规范 SHA-256 候选别名，但该值不能独立创建或升级正式记录。旧记录只有在新的来源确认已经满足下文分级规则后，才可以用完整题录唯一一致性辅助复用原 `literatureId` 并附加别名。多个相同书目记录、哈希命中但书目冲突、部分作者匹配或缺少来源证据都必须返回歧义/冲突，不能静默合并。

## 正式状态与证据模型

`unresolved`、`candidate`、`ambiguous` 和 `conflict` 只存在于解析过程或本地待办中，不创建公共文献记录。正式新记录只有 `confirmed`；旧 `manual`/`legacy_metadata` 只读投影为 `legacy_unverified`。

Intuecho 的正式持久化必须分开保存标识所有权和来源观察：

- `literature_identifiers(literature_id, identifier_kind, normalized_value)` 对 `(identifier_kind, normalized_value)` 全局唯一。
- `literature_identity_claims(literature_id, provider, provider_record_id, verification_status, evidence, observed_at)` 对 `(provider, provider_record_id)` 全局唯一地绑定一个 `literatureId`。
- 同一个 DOI、arXiv ID、OpenAlex ID 或 Semantic Scholar ID 不能属于两个正式版本；不同 provider 可以为同一版本分别留下 claim。
- provider claim 的 evidence 至少记录候选键、来源等级、确认依据、观察时间和可用的 HTTPS 来源地址，不接收客户端题录充当来源证据。

预印本、正式发表版、修订版和译本保持不同 `literatureId`。`literature_relations` 仅保存带证据的 `is_preprint_of`、`version_of`、`translation_of`，不合并批注、页码、全文权限或引用指标。

## Provider 能力

Provider 按能力选择，不要求每个来源实现全部能力：

| 能力 | 含义 |
| --- | --- |
| `resolveIdentity` | 为高精度身份链路解析候选 |
| `search` | 执行面向用户查询的宽检索 |
| `fetchRelations` | 获取引用、被引等关系证据 |
| `locateFullText` | 定位获准使用的全文 |
| `generateCandidates` | 为推荐生成高召回候选 |
| `refetchForConfirmation` | 根据 provider 候选键重新抓取并验证记录 |

当前 Crossref、arXiv、OpenAlex 和 Semantic Scholar 身份适配器声明 `resolveIdentity`、`search`、`refetchForConfirmation`。未声明的关系、全文和推荐能力不能被推断存在。关系持久化和查询骨架已经实现，但当前 provider adapters 尚未声明可信 `fetchRelations`，所以不能自动写入版本关系。

所有 provider 调用必须有超时、逐 provider 失败隔离和来源记录。外部候选确认必须调用 `refetchForConfirmation`；客户端提交的候选题录不能直接持久化。

## 来源分级

| 等级 | 当前来源 | 确认规则 |
| --- | --- | --- |
| 一级原始注册来源 | Crossref DOI、arXiv；未来 PubMed | 来源内稳定 ID 精确唯一回查，完整响应与已有题录无冲突时可以自动确认 |
| 二级聚合来源 | OpenAlex、Semantic Scholar | 当前保守实现要求用户明确选择候选，服务端按候选键重新抓取且无冲突；第二个独立聚合来源以完整题录确认同一版本时复用既有记录 |
| 三级题录线索 | 题名、作者、年份、文件名、PMLR 提示、SHA-256 题录指纹 | 只用于检索、排序和兼容查询，不能独立创建 confirmed 记录 |

二级来源即使在检索阶段互相佐证，也不能把客户端返回的第二份题录直接持久化为 claim。当前没有可原子保存双源重抓 bundle 的接口，因此聚合候选统一保留显式选择步骤；这比无审计地自动确认更严格。

## 三条隔离策略

| 链路 | 目标 | 准入与结果 |
| --- | --- | --- |
| 身份确认 | 高精度、可重新抓取、可持久化 | 一级来源精确回查可自动确认；二级来源显式选择后服务端重抓；完整题录只辅助冲突检测和独立聚合证据复用 |
| 薄读外部检索 | 证据相关性、关系和全文能力 | 可使用相关性召回，但结果只是证据，不产生永久身份合并 |
| 推荐 | 高召回、排序、多样性和个性化 | 相似度只参与候选与排序，不产生永久身份合并 |

身份链路中，同题名候选可以留给用户选择；部分作者、模糊题名、同名多候选和多个完整匹配均为 `ambiguous`。完全无关的 provider 宽搜结果不能进入 PDF 身份候选。provider 超时或部分不可用不能放宽自动确认标准。

## PMLR 当前边界

截至 2026-08-10 的官方核验结果：

- `https://proceedings.mlr.press/v306/` 返回 404；官方总目录列出 v307-v309 和 v305，但未发布 v306。
- 官方公开仓库 `https://github.com/mlresearch/v306` 存在，描述为 ICML 2026 Proceedings，但当前只有模板 README 和 GitHub 工作流目录，没有论文 BibTeX、PDF 或可查询目录。
- 模板说明未来正式数据应包含论文 BibTeX 与 PDF；在这些数据实际发布且协议稳定前，网页或仓库模板不能伪装成正式 provider。

因此当前只从 PDF 提取 `PMLR 306, 2026` 有限提示并预填候选检索，不产生 PMLR identifier、候选成功、人工正式记录或自动确认。未来官方目录发布后，可在不改变持久化策略的前提下新增具备 `resolveIdentity` 和 `refetchForConfirmation` 的适配器。

## Liteasy 投影边界

Liteasy Desktop 的纯本地文件可以保存 confirmed 快照。云文献写入或更新时，Desktop 只提交 `literatureId + revision` 引用；Liteasy API 使用独立服务凭据调用 Intuecho 的受保护核验接口，拿到匹配的 confirmed 记录后再保存只读投影。已有投影可以离线读取，但客户端快照不能覆盖服务端投影。

Liteasy 继续独立拥有 `documentId`、文件、目录、用户/组织权限和私人阅读数据。Intuecho 不保存谁在 Liteasy 收藏、上传或阅读了某篇文献；用户主动发布社区内容时才出现公开关联。

## 配置与秘密边界

Intuecho 生产和本地开发入口都只从 Intuecho API 服务端环境读取 provider 配置：

- `INTUECHO_CROSSREF_ENDPOINT`
- `INTUECHO_ARXIV_ENDPOINT`
- `INTUECHO_OPENALEX_ENDPOINT` / `INTUECHO_OPENALEX_API_KEY`
- `INTUECHO_SEMANTIC_SCHOLAR_ENDPOINT` / `INTUECHO_SEMANTIC_SCHOLAR_API_KEY`

Crossref 和 arXiv 默认启用；OpenAlex 和 Semantic Scholar 只有服务端 key 非空时启用。密钥不得进入 Desktop、浏览器 bundle、API 响应、日志或测试快照，也不得与 Liteasy API 共用。
