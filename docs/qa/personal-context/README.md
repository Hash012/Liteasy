# Personal Context v0.2 实施与验证

日期：2026-11-26；基线 `b46e359c`；范围为用户提供规格的 M0–M3。计划 ID 不是实际 GitHub PR 号。
`pr-plan.json` 保留实现与验收的区别：01–23 已有代码，等待审阅及相应真实环境验收；24 的 pilot 尚未执行。

## 实现落点

| 计划项 | 代码与产物 |
| --- | --- |
| 01 | `packages/context-contracts/`，三个生成 schema，架构 ADR |
| 02–04 | API `src/context/`，029 迁移，账号禁用/注销清理，桌面 ContextGrantPanel |
| 05–08 | `packages/context-client/`，`apps/cli/`，安装包、CAS、回执恢复、有界读取、目录归组 |
| 09–11、20–23 | `packages/context-skills/`，六个工作流及 Codex/Claude Code 显式包装，CLI 安装管理 |
| 12–14、19 | ResearchContextPanel、选择发布 controller、笔记/批注/对话入口、画像字段选择、组背景模板 |
| 15 | CLI `zoteroMarkdown.mjs`，原始 reference/imported 快照，hash、回链及显式 CAS 更新 |
| 16 | `contextAgentTools.ts` 与现有 workspace Agent 循环，不改旧 document-only skill schema |
| 17–18 | Android Idea 本机持久化、分享转草稿、有限 mobile 路由、原生 expectedScope 校验 |
| 24 | 本目录的 pilot 操作与待收集证据，不伪造真实用户试用 |

表中代码路径相对 `products/liteasy/`。新服务共用现有正式 PostgreSQL；没有将 dev-cloud 用作 Context 后端。
API Docker 构建现在使用仓库根目录为 context，包含共享契约和既有 device-control 包，并在构建时导入 server 校验依赖。
部署需先应用 029 迁移，再启动相应 API；未在此任务中操作生产部署。

## 已运行的本地验证

环境：Linux、Node 22.23.2（桌面 `.nvmrc`）、本机 PostgreSQL 16 隔离数据库。
所有数据、凭据与来源示例均为合成内容。没有读取个人 Zotero 库，没有将真实研究资料上传到外部服务。

- API 全套：512 项，507 通过，5 项按现有环境条件跳过。真实 Context PostgreSQL 测试另外显式启用并通过。
- Context 数据库/HTTP/CLI：凭据轮换与撤销、双账号隔离、并发 CAS、历史、归档、删除后重放、中文过滤、微秒分页、事务回滚、Unicode 整条预算、mobile audience、超时恢复及窗口限制。
- SDK：HTTP 编码、host transport、错误映射、origin/路径限制和拒绝重定向。
- CLI：JSON/stdout/stderr、凭据边界、两个目录同归组、两宿主安装/升级/卸载保留用户修改、Zotero 身份区分。
- 真实 `.tgz` 在仓库外安装，验证 help/version、stdin 登录、doctor、logout；仅 Linux 本地结果，不替代 Windows 原生验收。
- 桌面：受影响组件、AppShell/原文件集成、旧 research-skills、Quick Ask、真实 workspace Context 工具循环、选定内容发布和冲突保留检查通过；`ci:smoke`、内容边界与生产构建通过。
- `ci:ui` 与其 `ci:context` 分别通过 216/200 项测试；四个新界面已登记现有 UI inventory，选择器与修订折叠沿用已审核的公共控件。隔离的干净提交 worktree 通过 `ci:contracts`，生成契约和锁文件无漂移。
- 浏览器：`personalContext.browser.spec.ts` 验证实际请求 expectedRevision、保留冲突编辑、来源可达性；已检查截图，运行生成物不提交。
- Mobile：14 个测试文件、27 项测试和前端生产构建通过。草稿重启、丢失响应使用原操作、guest 与账号切换均有合成验证。
- Android：仓库 wrapper 指定的 Gradle 8.14.3、JDK 17，`compileUniversalDebugKotlin` 与 `testUniversalDebugUnitTest` 通过。此次 Kotlin 检查排除 Rust 构建，不声称 APK/真机已经通过。
- Skills：六个 Codex 包通过 skill-creator 校验；六个 Claude 包保留并检查其专用 `disable-model-invocation` 字段。独立合成行为推演覆盖未知资源/指导、过时 CFP、来源夹带指令、计划与完成、超时恢复；属于文档/行为推演，不是两种实际宿主的端到端通过。
- Workflow：actionlint 与仓库 CI 脚本测试通过。Windows/Linux 同一产物安装、PostgreSQL/API 镜像等由 `.github/workflows/liteasy-context.yml` 验证。

远端证据：

- [Personal context and CLI：PostgreSQL、API 镜像、同一产物的 Windows/Linux 安装通过](https://github.com/Hash012/Liteasy/actions/runs/45792725920)。Windows 包检查包含原生 PowerShell，测试明确使用受限文件凭据存储；不等同于所有用户环境的 Credential Manager 已验证。
- [Android APK、ARM64/16 KiB 包装和原生测试构建通过](https://github.com/Hash012/Liteasy/actions/runs/45792725702)。未运行真实设备上的用户资料 pilot。
- 正式服务原有完整 PostgreSQL 集成脚本在独立临时集群、分离迁移/应用账号下通过，验证 29 项迁移、账号删除与组织并发。额外同步其迁移清单，保持精确断言。
- 账号边界 CI 暴露后台界面测试过早读取加载中控件的竞态；改为等待实际控件，并保留主体/revision/reason 断言，通过真实 API 客户端额外断言序列化请求的幂等键。Admin 全套 22 项及生产构建通过。

审阅入口：[PR #14](https://github.com/Hash012/Liteasy/pull/14)。以上运行针对同一实现代码；后续仅集成脚本、后台测试和验证记录修订仍按对应 CI 检查。

复跑真实数据库场景：先构建 CLI，再提供一个专用测试数据库 URL（需要创建临时 schema 的权限）：

```bash
node products/liteasy/apps/cli/scripts/build.mjs
LITEASY_CONTEXT_TEST_DATABASE_URL='YOUR_TEST_DATABASE_URL' node --test products/liteasy/services/api/src/context/contextPostgres.integration.test.mjs
```

测试会创建/删除自己唯一命名的 schema，不应指向生产数据库。

## 未被掩盖的失败与边界

额外运行 dev-cloud 全套时，大 JSON 请求断言得到 502 而非 413；在原始 `b46e359c` 隔离 worktree 同样复现。
另一个 OpenAlex/arXiv 合并测试在首次全套运行失败，单独重跑通过，原始基线全套也通过该项。
未修改这两处无关开发服务实现或放宽断言。系统凭据库、真实账号部署及跨设备用户试用仍需各自证据，不能从安装包 smoke、Linux 或静态校验推导通过。

## Pilot 待执行

先固定最终 commit、CLI/Skill 版本、实际 API origin、Windows/Linux/Android 版本和两种宿主版本。
使用用户选定的少量材料；指标留空直到实际试用，不填造效果百分比。

1. Windows 桌面登录，在数据管理生成限定 personal/project scope 的凭据；安装同一 CLI 产物，桌面关闭后写入一条认识，保留服务回执。
2. Linux 安装相同产物并使用属于同一账号的专用凭据，`context show ID --json` 对照 ID/revision/正文；普通未唤起任务应无 Context API 调用。
3. 在 Codex/Claude 分别显式唤起 context；桌面修改该条目后再次读取，确认新 revision。尝试旧 revision 更新，确认冲突。
4. 导入两份引用同一论文的 Zotero Markdown 笔记，检查两个独立快照；重复导入识别原快照；改变未知笔记身份的内容产生新快照。
5. 从笔记/批注/对话发布选定内容，勾选本机画像字段，创建有来源/更新时间/未知项的私有组背景。
6. Android 输入或系统分享为 Idea；本机保存后强退/重启；明确提交后在 Linux 用 `--kind idea --status draft` 读取同一条目。
7. Android 断网、重试、A→退出→B；原草稿不混传，guest 只经明确复制进入目标账号。撤销 grant 后读写/回执均应失败。
8. 任选论文推荐、方向匹配、换路线或认识关联任务，记录所用条目 revision、已核查来源、最小行动、未知项和真实反馈。只有明确请求保存才调用 capture。

待收集：真实条目回执、各端版本、宿主显式/隐式调用证据、重复交代次数/主动时间、错误陈述、来源可核查率、恢复与纠正成本。
没有真实材料与设备试用之前，PR-24 保持 planned，不影响前面阶段的独立代码交付。
