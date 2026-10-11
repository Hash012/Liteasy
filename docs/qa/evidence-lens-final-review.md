# Evidence Lens 决赛整改验收记录

日期：2026-10-11。分支：`feat/evidence-lens-final`。
实现提交：`37e740077f6d279e239b19cdbfa7c2df5347f6dd`；基线：`ad24b8c95d9a0002e75ad10a1a46e3360eaf656a`。

## 交付内容

- WP00：实际入口映射见 [集成说明](../agent-dev/evidence-lens-integration.md)。任务包 MANIFEST 全部匹配，HTML 原型预览／进入详情交互已实际打开。
- WP01：本地结构检查不再声称 GPT 模型审计；HTTP 审计默认 10 秒超时，覆盖响应体解析，支持取消；失败／超时保留真实降级原因。旧 model 字符串不是执行身份证明，不显示语义评分概率。
- WP02：工作区资产写入与扩展变更不再按关键词授权。生成具体目标、操作、内容、版本的确认提案，批准时重查范围／权限／版本，复用现有五分钟过期、账号绑定、单次消费与防重放机制。确认后返回真实保存回执，本次不自动继续模型循环。
- WP03：`features/evidence` 唯一拥有报告契约、来源快照适配、状态投影和复制。去重按真实来源／位置；结构规则、生成模型和旧审计不能支持语义结论。独立核验需执行器提供可信回执 ID，精确文本定位也需可信定位验证 ID；报告自己声明无效。失效版本、变更答案、流式内容降级。
- WP04：默认紧凑摘要；可展开逐条论断、同栏 Peek 与带筛选的 Inspector。无可靠文本 span 时采用独立论断列表，不改写 Markdown。普通问答的检索摘要仍留在 analysis 来源矩阵，不制造回答论断；无真实逐条绑定时只展示来源。旧消息显示来源与未逐条核验。复用真实阅读器回调，位置缺失／打不开可解释，预览不覆盖相邻 PDF。历史报告的 PDF 标题、覆盖范围由宿主快照恢复，报告无法用附加资源路径替换论文导航目标。
- WP05：普通检索问答、资源快照问答、工作区实际 read、快／严谨薄读根及深节点接入。取消多论文 synthesis 将全部引用视为支持和检索得分当语义置信度的做法。报告随消息与薄读节点保存；损坏可选报告独立降级。复制及捕获回答保留来源快照／Liteasy 链接，原 PaperAnchorEntity 关联继续保留。

未修改 Rust、依赖、锁文件、工作流、语言包或用户手册。没有把任务包示例论文接入生产数据。原工作区 `.gitignore`、`AGENTS.md` 和已有未跟踪文档保持原样。

## 自动化验证

工具链：仓库 `.nvmrc` 的 Node 22.23.2；Linux WSL2 6.18.33.2；Chromium 151.0.7922.34。以下命令在 `products/liteasy/apps/desktop` 运行。

| 验证 | 实际结果 |
| --- | --- |
| 新审计回归先跑基线 | 10 条失败；无超时请求会挂起的基线用例未持续等待。修复后相关 4 文件 117 条通过 |
| 否定句授权回归 | 基线合法 write 调用发生一次；修复后零次、待具体确认。权限／确认相关累计 50 条通过 |
| 契约、快照恢复、复制与消息渲染 | 最后一次相关 4 文件 31 条通过；新增可信回执退化回归 3 文件 25 条通过 |
| 薄读／多论文／产物回归 | 相关 121 条通过；另补根／深节点证据按钮真实回调、坏报告及快／严谨入口回归 |
| `npm test` | 538 文件通过、2 文件跳过；3746 项通过、5 项跳过，214.87 秒（`c26639ba`）。最后来源绑定修复另跑 5 文件 35 项通过，覆盖标题／范围恢复和跨类型路径注入；未重复无关全套 |
| `npm run ci:smoke` | 通过：大小写冲突、Tauri 资源与现有语言契约 |
| `npm run build` | 通过；最终来源绑定修复后的构建通过（Vite 21.67 秒），生产资源检查 158 文件通过。保留既有大 chunk 提示，不宣称消除了体积问题 |
| `npm run ci:contracts` | 已提交代码上通过；`Selected paths match Git; no generated-file or lockfile drift detected.` |
| `git diff --check` | 通过 |

没有改动 Rust 宿主，因此没有另跑 Cargo；没有 Windows 环境，因此本记录不代表 Installer 或原生 WebView2 验收。普通完整单测不调用真实模型，live 用例默认跳过，真实模型结果单列如下。

## 浏览器交互与性能

可重现：先启动本仓库 Vite，再运行：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:1425 \
PLAYWRIGHT_EXECUTABLE_PATH=/home/tjm/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
npx playwright test src/tests/browser/evidenceLens.browser.spec.ts --workers=1
```

11/11 通过，12.17 秒，0 skipped / flaky / errors。浏览器 fixture 是明确标识的测试资料，不是真实研究结论，且不进入生产 bundle。

- 320／360／480／1280px × 深浅主题：页面和证据区无水平溢出；长 DOI 换行；Peek 不超过 380×420px。
- 200% **CSS 内容缩放**：键盘可进入、Escape 关闭并还原焦点；不是 Windows DPI 或 F11 验收。
- `prefers-reduced-motion` 生效；关键信息不依赖颜色和 hover。
- 实际 MessageEvidence 适配器的来源打开回调保留 paperId/page/quote；此项是 browser fixture 回调测试，不冒充真实 PDF GUI 跳转。
- 50 条论断、100 段引用：展开 25.90ms，首次仅挂载 12 条论断、不预先渲染引用正文。是一次本机测量，不是普遍性能保证。

原始 JSON：`/tmp/liteasy-evidence-browser-results.json`；截图：`/tmp/liteasy-evidence-browser/`，包括 `peek-320-dark.png`、各尺寸明暗详情和 `content-zoom-200-dark.png`（各测试子目录中）。已实际查看 320px 深色预览。运行产物未纳入 Git；上述命令可重新生成。

## 真实 PDF 与模型执行

```bash
LITEASY_THIN_READING_LIVE_EVAL_MODE=fast npm run test:thin-reading-live-model
LITEASY_THIN_READING_LIVE_EVAL_MODE=rigorous npm run test:thin-reading-live-model
```

两条均走新增显式 `generationMode` 分支、真实 PDF 文本提取以及生产 `generateAssistantAnswer`；没有把未传 generationMode 的旧 eval 当作新路径验收。

| 项目 | 快速 | 严谨 |
| --- | --- | --- |
| 数据 | 公开 ColBERT PDF，第 1–3 页 | 相同 |
| 来源 SHA-256 | `2e487d9b96e3c2e5e286d843e98a066adc0442faa3a6e8ddbd1771221bf9ae14` | 相同 |
| 服务 | 本地 dev-cloud → DeepSeek，trace 为 live/cloud_proxy | 相同 |
| 请求模型 | deepseek-v4-flash | deepseek-v4-flash |
| 返回的实际模型身份 | 传输未暴露，不能由请求名推断 | 同左 |
| 实际墙钟耗时 | 9181ms | 4406ms（另记录单调时钟 3200ms） |
| 生成正文长度 | 865 字符 | 726 字符 |
| 引用匹配真实页文本 | 3/3 | 3/3 |
| 有效 PaperAnchorOpenRequest | 3/3 | 3/3 |
| 报告材料覆盖 | 部分正文 | 部分正文 |
| 独立语义核验 | 无；readingReview=unverified | 无；readingReview=unverified |
| token／费用 | 传输未提供／未测 | 相同 |

输出：桌面目录 `test-results/evidence-lens-live-fast.json` 与 `evidence-lens-live-rigorous.json`。密钥未打印、未保存到报告。此项为 **Linux 脚本执行真实桌面生成函数**，不是整套 AppShell 原生用户操作录像。未人工标注逐条结论，unsupported-claim rate 和学术正确率 **未测**，3/3 仅说明引文位置匹配。

## 测试矩阵对应与限制

| 矩阵 | 覆盖证据与边界 |
| --- | --- |
| C01–C05、C20 | answerAuditTruth / modelAuditClient / generateAssistantAnswer；高 retrieval 分数、HTTP 500、超时、坏 JSON 不冒充语义支持；未知远端身份明确保守 |
| C06–C12、C14–C15、C19 | evidenceReport / thinReadingEvidenceReport：重复／悬空标识、版本、范围、引文快照篡改、同名异版本、关系分歧、抽象覆盖、span 变化。矛盾状态投影用受控 fixture 验证，不代表有自动反证模型服务 |
| C13 | evidencePersistence、assistantHistoryPersistence、thinReadingEvidenceReport：旧消息／坏报告不损坏正文或产物 |
| C16–C18、C21 | workspaceAgentSafety：否定句、来源注入、批准／拒绝／过期、范围切换、权限变化、版本冲突、单次消费、重启和取消竞态保存回执 |
| C22–C25、C28 | EvidenceLens 单测＋11 项真实 Chromium 交互：窄栏、主题、键盘、过滤不变更真值、计数一致、展开性能 |
| C26–C27 | streaming 投影及组件回归；无定位禁用、打开回调错误提示。真实网站下载故障不在本次功能范围内 |

### 仍需人工环境验收

1. Windows 当前版本打开真实 PDF → 快／严谨薄读 → 展开证据 → 点击原文 → 确认实际 WebView2 阅读器定位和焦点；切换文件版本后重开旧报告。
2. 真实组织账户下，撤销来源访问权后再次打开报告／确认写入，核对服务器拒绝与本地提示。代码及受控集成已有防护测试，本次没有连接真实组织账户验收。
3. 实际屏幕阅读器语音输出，以及 Windows DPI 200% 的原生组合。浏览器 ARIA／键盘和 CSS zoom 已测，不能代替辅助技术实机测试。

P1 研究计划循环、自动反证、缺口驱动检索和消融评测按任务包定义独立后续推进；本次没有伪造它们的能力。当前可信降级允许真实来源可追溯，并明确核验缺口；不存在独立核验执行器时不出现“已获语义支持”的生产状态。
