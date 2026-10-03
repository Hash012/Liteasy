# R09 受影响入口与同提交证据

`.github/scripts/account-boundary-policy.mjs` 是工作流的 required-suite 映射。Desktop 的账号、会话、组织、来源、分享/发布/转移代码变化会同时选择桌面契约与服务测试；Admin、Mobile 选择自身测试与服务测试；权威服务、共享契约及此门禁变化选择三个客户端。无关桌面样式和文档不触发本套重验证，仍由既有 Desktop CI 检查。无法确定 diff 时保守全选。此流程不请求安装器。

独立 `npm ci` 后，`run-account-boundary-suite.mjs` 运行固定命令组，真实 PostgreSQL 任一步非零退出会阻止后续命令并使 required gate 失败。只有实际选择的客户端参与矩阵；不允许把必要 job 的 skipped 当成功。原有 PostgreSQL 使用分库及分离的 migrator/app role。

每个结果 JSON 只导出提交/树/dirty diff 摘要、OS/架构/Node、仓库脚本与 fixture 的 SHA-256、固定命令及退出码。测试中源文件漂移使结果失败。工件仅匹配 `test-results/account-boundaries/*.json`；不包含 stdout、环境变量、正文、数据库备份、密码或原始诊断。各 suite 分别绑定同一 checkout，不将旧 `/tmp` 日志或不同提交的计数合并。没有执行的 native OAuth/keyring/handoff、IdP、S3/scanner 与真人试点明确为 `not_run`。

运行：`node .github/scripts/run-account-boundary-suite.mjs services-unit`；设置隔离数据库变量后运行 `services-postgres`；客户端参数为 `desktop` / `admin` / `mobile`。不接受任意 shell 命令。工作流上传结果摘要，失败或前置安装失败导致未产出摘要时仍通过 job 状态失败，不以缺报告推定成功。

本次修改的 workflow lint 和 92 项 CI script 测试通过；最终统一提交验证记录另列。此提交没有推送，因此不声称 GitHub 工作流已实际执行。
