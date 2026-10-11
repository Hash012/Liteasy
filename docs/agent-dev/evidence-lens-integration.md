# Evidence Lens 真实入口与整改边界

基线：`ad24b8c95d9a0002e75ad10a1a46e3360eaf656a`。实现分支：`feat/evidence-lens-final`。
任务包校验：MANIFEST.sha256 全部通过。原型只用于交互参考，不接入其虚构论文。

## 入口映射

| 入口 | 当前调用与数据 | 整改边界 |
| --- | --- | --- |
| 普通工作区对话 | `controllers/agent/createDesktopAgentService.ts` 有 assets 时进入 `runWorkspaceAgent.ts`；无 assets 进入 `features/assistant/generateAssistantAnswer.ts` | 实际工具读取快照才是资料；生成完成不代表核验完成 |
| 普通检索问答 | `generateAssistantAnswer.ts` 检索 citations，direct 本地 `answerAuditor.ts`，cloud `modelAuditClient.ts`，失败本地回退 | 本地只做结构检查；远端返回的模型名字不能证明模型实际执行；降级保留原因 |
| 多文献比较 | `paper-analysis/multiPaperAnalysisWorkflow.ts` 准备 evidence/paperClaims，再完成 synthesis | 现有 synthesis 将整篇回答绑定全部 evidence，audit 分数不能证明逐条支持，必须取消这一推断 |
| 快速／严谨薄读 | `thin-reading/adaptiveThinReading.ts` 经 gateway 生成 rootSeed；readingReview 为 unverified/advisory | 两种模式都不能自称独立语义核验；`ThinReadingTab.tsx` 渲染当前节点 summarySentences 和 paperEvidenceSpans，深读复用同一路径 |
| 消息展示 | `assistant/AssistantMessageList.tsx` 渲染 audit/publicWorkflowAudits/PaperAnchorReferences | 合并成渐进证据入口，旧消息仅来源列表，不制造结论或概率 |
| 引用定位 | `paper-anchors/paperAnchorEntity.ts` 保存来源标识、quote、页码、可选 hash/offset/ObjectRef；paperAnchorOpenRequest | 复用真实打开回调，缺页码不可跳转；无版本或不能验证文本不得标作精确定位 |
| 会话恢复 | `controllers/agent/agentStatePersistence.ts` 验证 runs/events；消息由 Agent 事件投影并缓存 | 新报告可选且单独校验；坏报告不能破坏旧消息；不恢复未经确认的写入能力 |
| 写操作 | `runWorkspaceAgent.ts` mayWrite 曾按用户文本关键词判定，assets 端已有 revision 与权限保护 | 改成具体工具操作的显式确认，不能从否定句、资料或模型输出授予写权限 |

## 统一契约与所有权

`features/evidence/` 唯一拥有 EvidenceReportV1、校验、状态投影、来源适配和证据 UI。
它依赖现有 PaperAnchorEntity/ObjectRef，不依赖 layout。Controller 传入来源快照与执行回执；模型输出不能自行制造核验回执。

三个独立维度：来源可定位（locator）、材料覆盖（coverage）、结论语义核验（assessment）。结构检查只描述结构；无法取得独立核验记录时统一未核验。摘要计数和检查页使用同一投影。旧 audit/citations 不转换成已支持结论。

## 实施顺序与验收

1. 审计身份与降级真实性、写入确认：先失败后通过的回归。
2. 契约、验证和保守迁移；测试悬空关系、版本失效、跨范围、重复引用。
3. 摘要／逐条入口／预览／同栏检查视图；实际问答与薄读接入、恢复与复制。
4. 全套桌面测试、smoke、build、干净提交 contracts；浏览器交互与 QA 记录。

当前开发机为 Linux。Windows 原生 PDF 跳转和真实模型核验只有实际执行成功后才能记为已验证；不会以 fixture 或 Linux 构建冒充。没有独立语义核验能力时交付可解释的未核验状态，P1 研究循环不作为 P0 UI 的隐式前提。
