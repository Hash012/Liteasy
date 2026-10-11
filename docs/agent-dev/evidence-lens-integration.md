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

## 已实现接口（2026-10-11）

- `evidenceReport.ts`：严格报告 schema；`parseEvidenceReport` 单独恢复；`projectEvidenceReport` 使用当前答案版本、可访问来源、当前来源版本和执行器授予的 `trustedVerificationIds`，而非相信 JSON 自己声明核验。精确定位还需 `verifiedPassageIds`。
- `evidenceAdapters.ts`：原文实体／真实资产读取快照投影；`bindEvidenceSnapshots` 防止报告替换实际引文与位置。
- `components/MessageEvidence.tsx`：实际聊天来源解析、范围检查、复用 workbench／引用导航。`components/EvidenceLens.tsx` 只做展示。
- `thin-reading/thinReadingEvidenceReport.ts`：根／深节点统一适配、外部摘要覆盖、持久化冻结与保守恢复。
- `evidenceCopy.ts`：复制和捕获附带原文快照与 Liteasy 链接，不输出旧概率评分。
- `workspaceWriteConfirmation.ts`：接入原有审批状态机，具体操作批准后重验证并返回写入回执。

真实执行、红绿测试、浏览器数据和明确未验证项见 [验收记录](../qa/evidence-lens-final-review.md)。

## 追加交付：展示与研究闭环

- 来源型回答首次展开直接给出前两段摘录和真实导航；论断型默认四条，全部内容仍可在同栏 Inspector 检索。失败／超时保留可见状态，核验执行细节折叠。仅元信息的来源也可分页查看完整列表。
- `features/research-loop/researchLoop.ts` 拥有结构化计划、缺口、决策和停止原因。`runWorkspaceAgent` 的 `research` 工具直接参与现有 search/read/answer 循环；未解决缺口不能提前完成或发起写入。规划判断不是独立语义核验。
- `AssistantPane` 与历史解析保存研究快照，状态卡区分完成、复核、预算耗尽、等待条件和中断。恢复的快照仅用于展示；不会恢复工具执行权限。再次提问是新轮次，需重新读取来源并重查版本。
- 实际研究范围为现有资产服务可以读取的材料；复用现有账号、组织权限和单次写入确认。简单问候无需调用研究工具，不自动加载正文。
- `scripts/research-loop-eval.mjs` 对公开 PDF 做直接模型、固定窗口检索、生产工具循环对照；`scripts/research-loop-score.mjs` 仅处理独立人工标签，不调用模型或读取密钥。质量指标未标注时为 `not_measured`。
