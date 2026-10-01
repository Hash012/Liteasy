# 推荐、关键词与全文获取：实现和验收记录

依据：[2026-10-01 spec](../superpowers/specs/2026-10-01-liteasy-personalized-recommendations-and-fulltext-spec.md)。实现于 2026-10-01 至 10-02；本次安装包版本为 0.1.28，统一更新 npm、Cargo 与 Tauri 版本。

## 使用入口

- 推荐条目显示两行题名、年月、三个彩色关键词及展开按钮。单击查看底栏，双击／Enter 打开中栏详情；关键词可筛选，作者和摘要保留在详情。支持年份、已收藏和经过探测的 PDF 筛选。
- 设置 → 论文与推荐 → 论文推荐：打开「增强关联推荐」，可分别启用批注／笔记和已确认画像。默认不启用新排序，原有推荐仍工作。
- 可配置独立的向量、重排接口；「测试并保存」验证响应和维度。未配置或失败时回退本地词项匹配。模型与端点变更隔离索引，不混用相同维度的不同模型。
- 「允许向外部服务发送笔记、批注和画像」默认关闭。关闭时这些输入只在本机匹配；本机模型地址可使用 HTTP，远程地址要求 HTTPS。密钥复用系统凭据库。
- 清除检索缓存不会删除资产；清理时停用增强推荐，重新开启后按需建立缓存。

## 模块与边界

| 模块 | 实现 |
| --- | --- |
| 输入投影 | `recommendationContext.ts` 复用资源接口、论文项目、批注和已确认画像。Markdown、电子书、白板均可参与；白板只投影文字及显式关系。AI 自动解释不当成用户偏好；同一批注按身份去重。 |
| 更新与取消 | `useRecommendationContextController` 对编辑事件防抖；账户、选择、修订和设置变化取消旧请求。目录只查现有标题索引，不递归读取外部 Vault。 |
| 本地索引 | Rust `semantic_index` 使用 bundled SQLite FTS5 和静态 `sqlite-vec 0.1.9`；账户／工作区／模型独立数据库。查询运行于后台线程并可中断。中文预分词后进入 FTS。缓存位于数据根目录 `cache/semantic-index`，不在 WebDAV 工作区导出范围内。 |
| 私有资产缓存 | 只索引已选中并已读取的片段；从缓存召回本地资产时核验当前资源修订，已删除／改版的内容失效。画像、纯批注查询不作为可召回资产永久保存。 |
| 排序 | `products/liteasy/packages/recommendation-core` 提供 BM25、余弦、加权 RRF、主题门槛、MMR 和短语抽取。开发服务共享 BM25／RRF 数学核心，保留其既有策略和接口。桌面策略标识为 `personalized-hybrid-v1`。 |
| 召回 | 文献供应商主题搜索、明确批注问题、配置供应商支持的引用关系、本地题录索引与候选缓存合并。多文献轮询分配候选预算。Crossref 扩展直接参考文献；OpenAlex 扩展引用和被引关系。 |
| 可解释呈现 | 保留视图贡献、匹配词、批注路径，详情通过应用导航打开 `liteasy://` 链接。本地候选双击打开实际资产，可拖进上下文。 |
| 全文 | `paperPdfResolver` 发现 → 探测 → 下载；诊断含来源、HTTP 状态、耗时和去掉查询参数的地址。原生下载在 Rust 流式落盘、检查文件头／结束标记／长度并计算 SHA-256，返回句柄；导入复用既有去重逻辑。 |
| 网站 | `ExternalNavigation.open` 通过 Rust 调用系统浏览器；失败时保留复制链接。详情不用 iframe，也不依赖 `target=_blank` 在 WebView 内自行生效。 |

边界和预算：每次最多 16 个联网检索种子、3 个并发供应商请求、200 个排序候选；引用扩展最多针对 3 个有 DOI 的种子。每个片段最多 8,000 字符，embedding 每批 16 项，reranker 至多前 30 项，语义阶段总预算 45 秒。题录先显示，后续更新排序。原生索引最多 50,000 片段；浏览器预览使用有界内存缓存。

PDF 探测每批 12 篇、并发 3，忽略 Range 的服务也只读取有上限的片段，不能把「提供了 URL」当成可下载。成功探测缓存 10 分钟，失败可重试；无开放地址、访问受限、传输失败分别处理。原生 PDF 上限 256 MiB，传输取消会清理半成品。OpenAlex 内容接口仅在配置对应密钥后启用，密钥不随跳转转发。

## 可复现验证

在 `products/liteasy/apps/desktop` 运行；Node 和 Rust 版本按仓库现有配置选择。

```bash
npm test
npm run ci:smoke
npm run build
npm run ci:contracts  # 需包含本次变更的干净快照
cargo check --locked --all-targets --no-default-features --manifest-path src-tauri/Cargo.toml
cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml paper_fulltext::
cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml semantic_index::
cargo test --locked --no-default-features --manifest-path src-tauri/Cargo.toml external_navigation::
npx playwright test src/tests/browser/recommendationList.browser.spec.ts src/tests/browser/displayPolish.browser.spec.ts
npx vite-node scripts/evaluate-personalized-recommendations.ts
```

共享算法和开发服务回归（仓库根目录）：

```bash
node --test products/liteasy/packages/recommendation-core/*.test.mjs development/dev-cloud/payloads/recommendation*.test.mjs
```

2026-10-02 的最终代码验证结果：

- 全量桌面测试：466 个测试文件通过、2 个跳过；3,162 项测试通过、4 项跳过。
- `ci:smoke`、前端生产构建和干净快照上的 `ci:contracts` 均通过；生成资源检查覆盖 157 个文件。
- 共享排序核心和开发服务：36 项测试通过；浅深主题、窄栏及交互浏览器测试：5 项通过。
- Rust 锁定依赖检查通过；真实 FTS／向量查询 2 项、流式传输 4 项、外链校验 1 项测试通过。Windows 性能基准作为显式忽略测试另行执行。

契约检查使用包含本次功能的隔离快照，不混入当前工作区既有修改。Linux 使用的 Rust 工具链与 Windows workflow 小版本不同，这些结果不代表 Windows 编译已验收。

另通过实际 TypeScript 解析入口下载 arXiv `2402.12482`，得到 HTTP 200 和 284,060 字节 PDF。PMLR `das24a.html` 能打开，且指向 `raw.githubusercontent.com/mlresearch/v235/main/assets/das24a/das24a.pdf`；本环境请求该文件超时，独立 Python／Node 下载也复现超时。因此 PMLR 的真实下载未通过，不能计入开放样例验收。该联网检查运行于 Linux，无 WebView CORS 限制，也不代替原生 Windows 下载验证。

## 尚未满足的发布门槛

`development/test-data/personalized-recommendations/queries.json` 提供 30 组工程编写样例，覆盖同名歧义、论文、Markdown、电子书、批注和画像。它们明确标为 `pending-human-review`，不冒充人工标注。评测脚本对比原基线、词法、混合、混合加画像，输出 nDCG@10 和明显离题率；没有实际模型向量、人工复核或质量未过线时，默认启用门槛保持失败。

Windows 基准命令：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/benchmark-recommendations-windows.ps1
```

该脚本单独运行 release 测试程序：10,000 资产、50,000 片段、768 维，记录热检索 P95、200 候选融合 P95、硬件和工作集峰值，不把编译器内存计入查询内存。此环境没有 Windows 实机，未宣称达到 P95 < 500ms / 新增内存 < 200MiB，也未宣称 Windows 安装包已通过。

交付安装包前仍需在 Windows 实测：arXiv、PMLR、出版社跳转各一个已知开放样例，双击详情 → 唤起系统浏览器 → 保存指定目录 → 打开 PDF 阅读；确认取消、代理及受限站点反馈。随后按 `AGENTS.md` 请求并确认完整 Installer CI。浏览器 mock HTTP 和 Linux 原生流测试不能代替这项验收。

技术依据：[sqlite-vec Rust 静态接入](https://alexgarcia.xyz/sqlite-vec/rust.html)、[SQLite FTS5](https://www.sqlite.org/fts5.html#the_bm25_function)、[OpenAlex 引用查询](https://help.openalex.org/how-to/api-recipes/)、[OpenAlex 全文接口](https://help.openalex.org/access/fulltext/)。
