# R07 组织生命周期补强

复查基线 `3188438c95dfc7f73b5ccf20a05ef69391e646cf`。在独立 PostgreSQL 16.15、Linux x86_64、Node 22.13.1 中，先创建注销 job，再把该账号设为组织 owner，原实现成功提交；新测试得到 `Missing expected rejection`，确认是实际漏洞。

组织写操作现在与账号注销使用相同账户事务锁；授予邀请、角色、恢复成员和负责人转移同时检查目标账号。多账号按 subject 排序加锁。撤销/暂停成员仍可处理已注销目标，不扩大任何权限。注销检查改为 READ COMMITTED，在等待交接锁后读取已提交的 owner，避免旧快照。已有邀请者降权、过期/撤回、并发双交接、owner 导出例外、离组作者权限继续由现有服务裁决。

`verifyOrganizationLifecycleConcurrency` 在现有受保护的 PostgreSQL runner 内执行：注销后创建/受让失败；先注销则交接失败；先交接则注销失败；退出和交接只有一个成功；同名组织仍按不同 ID 操作。使用 PostgreSQL 的 blocking-pids 观察等待，不以定时 sleep 假定竞态。无 schema 迁移。

本次局部验证：API Node suite 497 passed / 4 skipped；真实 PostgreSQL integration 成功（28 migrations，含现有邀请失效、双交接和新混合并发）。这些结果仅描述本次变更检查；最终统一提交及脚本/fixture 摘要以本目录最终验证记录为准，不与历史统计相加。原生客户端、真实 IdP 与生产环境不在该结果范围。

回滚代码会重新允许注销账号获得组织写权限，建议前向修复。无需迁移用户数据或修改 D01–D08 决策；本机文件未被触及。
