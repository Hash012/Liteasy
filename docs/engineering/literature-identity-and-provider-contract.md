# 文献身份与 Provider 能力契约

## 范围与实现方式

本契约是 Liteasy Desktop、Liteasy API 和 Intuecho 的共享文献身份规范。当前仓库没有根级 npm workspace；为避免跨产品运行时依赖和反向依赖，本轮不提取公共 npm 包。三个实现保持独立，通过
`development/test-data/literature-identity/conformance.json` 验证一致性。

Liteasy API 与 Intuecho API 必须继续使用各自的数据库、连接池、对象存储和凭据。契约共享不表示服务或数据共享。

## 身份规范化

稳定标识采用以下规范值：

| 类型 | 规范 |
| --- | --- |
| DOI | 移除 DOI URL 或 `doi:` 前缀、尾部引用标点，转小写 |
| arXiv | 移除 URL、`arXiv:` 和 `.pdf`，保留版本后缀 `vN`，转小写；只有带版本号的值可以确认具体版本 |
| Semantic Scholar | `CorpusID: 123` 规范为 `corpus:123`；其他 ID 去空白并转小写 |
| OpenAlex | 只接受 work ID `W<digits>` 或对应 URL，规范为大写 |
| 题名作者年份 | `sha256:<64 lowercase hex>` |
| PMLR | 已发布官方卷中的论文使用 `v<volume>/<slug>`；只有卷级 BibTeX 审计证据完整时可以确认 |

题名、作者和年份身份使用以下规范：

- 文本先执行 NFKC 和小写化，再把标点、符号和空白折叠为单个空格。
- `Family, Given` 与 `Given Family` 视为同一作者。
- 作者必须是完整集合；集合去重、排序后用于比较和新 SHA-256 指纹，因此作者顺序不改变身份。
- 年份必须是四位整数。
- 指纹输入是规范化后的 `{authors, title, year}` JSON；缺少任一项不得生成指纹。

PDF `contentHash` 只用于本地文件去重，不能成为跨用户文献身份。PDF 第一页正文只在 Desktop 本地提取有限提示，不得进入 Intuecho 或 Liteasy API 的身份请求。

## 兼容与迁移

已有八位十六进制 FNV 题名作者年份值是只读兼容别名。系统不得批量改写旧身份、`literatureId`、批注、论坛引用或 artifact 关联。

确认新记录时生成规范 SHA-256。遇到旧记录时，只有题名、年份和完整作者集合唯一一致才可复用原 `literatureId` 并附加 SHA-256 别名。多个相同书目记录、哈希命中但书目冲突或部分作者匹配都必须返回歧义/冲突，不能静默合并。

题名作者年份 SHA-256 是可多归属的候选别名，不拥有文献身份，也不受跨记录全局唯一约束。DOI、带版本号的 arXiv ID、OpenAlex ID 等 `confirmable` 标识仍保持全局唯一。历史无版本 arXiv 值标记为只读 legacy alias；仅依赖该值的旧记录降级为 `legacy_unverified`，重新抓取到明确 `vN` 前不得用于正式引用或同步。

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

当前 Crossref、arXiv、OpenAlex、Semantic Scholar、OpenReview、DBLP 和 PMLR 身份适配器声明
`resolveIdentity`、`search`、`refetchForConfirmation`。未声明的关系、全文和推荐能力不能被推断存在。

所有 provider 调用必须有超时、逐 provider 失败隔离和来源记录。外部候选确认必须调用 `refetchForConfirmation`；客户端提交的候选题录不能直接持久化。

## 三条隔离策略

| 链路 | 目标 | 准入与结果 |
| --- | --- | --- |
| 身份确认 | 高精度、可重新抓取、可持久化 | 仅稳定标识精确唯一，或题名、年份、完整作者集合唯一一致时自动确认 |
| 薄读外部检索 | 证据相关性、关系和全文能力 | 可使用相关性召回，但结果只是证据，不产生永久身份合并 |
| 推荐 | 高召回、排序、多样性和个性化 | 相似度只参与候选与排序，不产生永久身份合并 |

身份链路中，同题名候选可以留给用户选择；部分作者、模糊题名、同名多候选和多个完整匹配均为 `ambiguous`。完全无关的 provider 宽搜结果不能进入 PDF 身份候选。provider 超时或部分不可用不能放宽自动确认标准。

## PMLR 当前边界

截至 2026-08-10 的官方核验结果：

- `https://proceedings.mlr.press/v306/` 返回 404；官方总目录列出 v307-v309 和 v305，但未发布 v306。
- 官方公开仓库 `https://github.com/mlresearch/v306` 存在，描述为 ICML 2026 Proceedings，但当前只有模板 README 和 GitHub 工作流目录，没有论文 BibTeX、PDF 或可查询目录。
- 模板说明未来正式数据应包含论文 BibTeX 与 PDF；在这些数据实际发布且协议稳定前，网页或仓库模板不能伪装成正式 provider。

因此 `PMLR 306, 2026` 仍只作为有限提示并预填人工确认，不产生 PMLR identifier、候选成功或自动确认。对于已经正式发布且存在官方卷级 `bibliography.bib` 的卷，PMLR provider 可以按 `pmlr_id` 精确回查；确认时必须重新抓取卷文件、唯一命中 citation key，并保存文件 SHA-256、卷号、entry key 和正式论文 URL。未发布卷和缺少完整审计证据的记录不能进入确认事务。

## 配置与秘密边界

Intuecho 生产和本地开发入口都只从 Intuecho API 服务端环境读取 provider 配置：

- `INTUECHO_CROSSREF_ENDPOINT`
- `INTUECHO_ARXIV_ENDPOINT`
- `INTUECHO_OPENALEX_ENDPOINT` / `INTUECHO_OPENALEX_API_KEY`
- `INTUECHO_SEMANTIC_SCHOLAR_ENDPOINT` / `INTUECHO_SEMANTIC_SCHOLAR_API_KEY`

Crossref 和 arXiv 默认启用；OpenAlex 和 Semantic Scholar 只有服务端 key 非空时启用。密钥不得进入 Desktop、浏览器 bundle、API 响应、日志或测试快照，也不得与 Liteasy API 共用。
