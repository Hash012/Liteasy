# R00 基线、命令边界与政策继承

任务包：`Liteasy-review-3188438-Codex-2026-10-03`；SHA256SUMS 全部校验通过。开始时 main/origin/main 均为 `3188438c95dfc7f73b5ccf20a05ef69391e646cf`。原目录已有 `.gitignore` 和未跟踪文档改动，保持不动；本轮在独立 `feat/review-3188438` worktree 实施，三个并行工作树分别负责社区 API、社区 Web 和 Desktop 边界。没有 push、合并 main、生产发布或安装器请求。

## 发现与处理口径

| Review | 基线依据与本轮验证方向 |
| --- | --- |
| F01 标签派生跨受众 | SQLite 真实落库负例先红；修复后 SQLite / 独立 PostgreSQL 验证 private/mutual/组织隔离。公共样本没有明确训练/推断许可，因此关闭公共 corpus 推断；不删除人工标签、已有申诉/审计。 |
| F02 Web 创建无稳定操作身份 | 基线 Web POST 到服务随机 UUID；本轮补版本化 command、同事务 receipt、持久客户端记录与只读结果核实。独立新 operation ID 的相同正文仍是合法新意图。 |
| F03 旧编辑覆盖及预览差异 | 基线行锁不能检查客户端所见 revision；本轮 HTTP 更新需要 expectedRevision，缺失 428、过期 409，保留草稿。编辑、回复及读书包发送覆盖同一预览规则。 |
| F04 草稿 state 不等于落盘 | 本轮补 stable actor/env/issuer 归属、显式恢复和失败提示；浏览器本地存储不是针对同一 OS 用户的物理安全隔离。 |
| F05 类型依赖标签/正文 | 新版本 collaboration metadata 独立于标签、语言、Markdown 标题；有歧义旧内容维持普通批注，不自动升级权限。零批注组织可以选择确认文献。 |
| F06 验证范围与工件缺口 | 现有 real PG CI 已存在，不重新声称从零建设。本轮扩充 Desktop/Admin/Mobile/共享契约映射，添加同提交白名单证据。未跑的 native/云链/真人层不标绿。 |

源码复查额外确认了组织交接与注销的实际竞态，以及 JSON null/SQL NULL 的新增字段兼容问题；都有真实 PostgreSQL 复现与修复。具体测试提交及各层结果见总验收矩阵，不能把本表当所有平台已通过。

## 入口 × 命令 × 裁决

| 入口 / 命令 | 身份与目标 | 预览 / 版本 | 操作与回执 | 权威 / 验证层 |
| --- | --- | --- | --- | --- |
| Web create annotation / reading pack | verified principal；private/mutual/明确 organization/public；public 非广场仍公开 | 冻结实际 payload、资料快照、受众；profile revision | 持久 command protocol v1、UUID、canonical digest；同事务唯一 receipt；未知状态只读核实 | Intuecho repository SQLite + PG；Web JSDOM 请求断言 |
| Web create reply / publish reply copy | verified actor + 当前父对象；不能移动别人的回复 | 父 audience/revision、作者资料、发布副本预览 | create_reply 独立 operation ID；receipt 与业务/通知原子提交 | Intuecho 当前父对象权限；事务 + 客户端负例 |
| Web update annotation/reply | 只允许当前已有编辑权；保持既有离组规则 | 客户端 expectedRevision；扩大受众重预览；父 scope lock | 冲突不自动重发，不用正文 hash 永久合并 | HTTP 428/409 + SQLite/PG；保留历史版本 |
| 读书包 / 主持人摘要 sourceRefs | 当前 viewer + sourceNamespace/sourceId/revision | 服务端提交时锁定并检查真实版本及当前可见性 | schema 版本化 collaboration；来源深链明确历史/当前 | Intuecho 权威服务；不可用时不借历史绕过撤权 |
| Desktop 文件转移 / PDF 发布 | 原有端点、issuer、verified subject、scope；generation 仅运行时 fence | 原有逐项预览、来源策略及 revision | 复用 transfer/publication journals，取消本地队列不等于远端已撤回 | Liteasy API / Intuecho 各自裁决，UI 仅投影 |
| Desktop Agent / MCP / 本机笔记 | 本机入口保留；受控来源沿复制/产物传递 | 实际工具声明、local-only、scoped approval；无法确认来源时关闭外发路径 | 不创建通用云授权数据库；工具调用执行时重检 | Desktop tool/source policy 测试；不冒充真实模型/原生验证 |
| Liteasy 组织 create/invite/transfer/leave | verified actor；精确 organization ID；当前 owner/admin/member | 原有 expected organization/member/invitation revision | 原有 idempotency key；新增账户删除 fence | Liteasy PG 唯一权限真相；真实多事务交接/退出/注销 |
| Admin 账号生命周期 / identity adapter | 管理员实际授权；跨产品独立 DB | 原有 lifecycle stages 与重试 | 各域删除/撤回日志，不宣称分布式 ACID | PG 已测；真实 IdP 各 audience refresh 单独 not_run |
| Mobile 账号、scope 与同步 | 现有 actor 绑定与移动契约 | 沿用各服务契约，不推导新授权 | 进入同提交 CI 的移动 contract suite | 前端测试/构建与原生运行分开记录 |

## 最小政策 ADR：保持 D01–D08 HOLD

本轮技术修复不是新的业务授权。D01 组织内容公开/外部模型审批未定义，新增外发能力保持关闭且说明原因；D02 保留已批准的作者查看/删除例外，不新增离线租约或远程删除私人文件；D03 维持现有公开正文匿名留存，不编造保留期限；D04 只做现任负责人交接与无主保护，负责人失联的争议接管不实现；D05 不增加 guest、anonymous、子项目 ACL；D06 不默认公开 PDF 全文，也不创造“合法字数”；D07 不接支付、价格、隐式遥测或自动用户画像上报；D08 保持私聊互关，直接组织邀请接口不等于已经批准新投递渠道。

后续扩展审批只允许在现有 authority 返回的 capability/policyExceptions 之外添加**显式未启用**的策略接口；不得由 UI 或 Agent 自行授权。owner 导出例外和离组作者已有权利应照实显示及精确测试。拒绝信息区分身份、权限、来源、网络与存储失败，不用统一“网络异常”掩盖真实原因。
