# RV01–RV36 验收记录

代码候选：`acdf679894ab8b60b0ab339cc937198a6f8b0586`。`pass` 只代表本行指定的合成/隔离测试层；`partial` 不能代替真实浏览器、原生平台或人工验收。共 17 pass、14 partial、5 not_run。完整命令与摘要见 [verification.json](verification.json)。

| 场景 | 状态 | 实际覆盖及限制 |
| --- | --- | --- |
| RV01 · 私密标签不影响公开标签 | pass | 真实 SQLite/PG 合成私密标签隔离；无许可的公共 corpus 推断关闭。 |
| RV02 · 组织与互关样本隔离 | pass | 组织、互关与 public 样本按可见受众分域；公共输出不使用无权样本。 |
| RV03 · 合法同scope与撤回 | pass | 合法组织推断及撤回检查；旧 unscoped 标签留存审计但不再参与展示、搜索或新推断。 |
| RV04 · 提交后丢响应 | partial | SQLite 模拟提交后响应丢失、PG 并发同命令重试与 Web transport/JSDOM 分层通过；未做真实浏览器到服务端断网演练。 |
| RV05 · 重复ID异内容 | pass | SQLite/PG 同 operationId 不同 digest 拒绝，首次正文保留。 |
| RV06 · 回复与读书包重试 | partial | 真实仓库 reply 并发重试与 typed reading pack 共用 command 契约；未独立执行真实浏览器读书包断网全链。 |
| RV07 · 双窗口旧版本编辑 | partial | 服务端旧 revision 拒绝及 Web 草稿/显式新 base 恢复通过；未执行两个真实浏览器窗口。 |
| RV08 · 跨账号回执读取 | pass | 同 operationId 的不同主体读取为 not_found；撤回内容不可经回执复活；销号清理 receipt。 |
| RV09 · 编辑扩大受众 | partial | JSDOM 冻结正文、受众、来源及资料预览；确认前不写，API 仍裁决 scope。真实浏览器未运行。 |
| RV10 · 父scope锁 | pass | 既有父 scope lock 在 SQLite/PG 回归中保持；有回复不搬移他人内容。 |
| RV11 · 草稿刷新与存储失败 | partial | JSDOM 存储实例恢复与 quota/写失败测试通过；未测真实浏览器崩溃或跨设备持久性。 |
| RV12 · 预览后身份变化 | partial | Web actor/端点/资料与 Desktop issuer/endpoint/账号变更负例通过；真实 IdP 切换未运行。 |
| RV13 · 零数据组织第一包 | partial | 真实仓库零批注组织的题录来源与 Web source picker 回归通过；尚无真人首用验证。 |
| RV14 · 标签和语言变更 | pass | typed collaboration 独立于标签和 Markdown 标题；schema/SQLite/PG 通过，元数据不增加权限。 |
| RV15 · 旧内容迁移歧义 | pass | 旧无 typed metadata 内容保持普通批注；JSON null/SQL NULL 迁移兼容已真实 PG 修复验证。 |
| RV16 · 引用提交竞态 | pass | 真实 PostgreSQL 用行锁屏障观察引用在提交期间修改/撤回，拒绝旧版本或无权来源。 |
| RV17 · 定位与更正回流 | partial | 版本接口/历史权限及 Desktop hook 的新建反思、陈旧请求、重复保存与失败重试通过；原生深链未运行。 |
| RV18 · 空间状态理解 | partial | UI/DOM 验证本机、云端、组织及 public 非广场说明；发布与已读分开，未知不称失败。真人理解测试未运行。 |
| RV19 · 普通阅读零外发 | partial | local-only 与普通阅读本地来源回归通过；未测三平台真实关闭重启及文件原件行为。 |
| RV20 · 邀请失效竞态 | pass | 既有 invitation 当前角色、过期、撤销与 revision 场景通过，旧卡片不授予权限。 |
| RV21 · 交接与销号并发 | pass | 真实 PG 验证 deletion-first/transfer-first/leave-transfer 多事务屏障；唯一 owner 与无主保护保持。 |
| RV22 · 离组例外矩阵 | pass | SQLite/PG 五身份×六类读取矩阵及写/删负例通过；只保留已批准作者例外。 |
| RV23 · 扫描对象数据库分步失败 | not_run | 缺少隔离 S3 与真实 scanner；已提供受保护的分阶段故障脚本，配置负例通过。 |
| RV24 · 旧备份恢复缺日志 | pass | 真实 pg_dump/pg_restore 事件前备份，15 项检查；缺失/改写/旧高水位/坏签名/部分回放不开放业务 CONNECT。签名生产者为合成测试。 |
| RV25 · 真实身份多audience吊销 | not_run | 缺少隔离 IdP realm 与四 audience 的实际登录/refresh 会话；脚本与边界负例已交付。 |
| RV26 · Desktop单独变更触发 | pass | CI policy 和实际选取文件测试覆盖 Desktop-only cloud/source/Agent 入口，服务与客户端套件不可跳过。 |
| RV27 · 三平台原生恢复 | not_run | 未运行 Windows/Linux/macOS 原生 OAuth、keyring 与冷启动 handoff。 |
| RV28 · 证据可携带 | pass | 同一干净代码 SHA 的七份白名单记录、脚本/fixture 哈希及未执行层；原始日志和私密配置不提交。 |
| RV29 · 规模查询与公平分页 | pass | 真实 PG 100/1000/10000 合成根条目，30 条页面固定 9 次查询，对比逐条读取 240 次；当前 scope 与公平 cursor 通过。不是生产容量指标。 |
| RV30 · 撤权派生视图 | partial | 当前权限再检查、撤回历史/通知裁剪、来源与 Agent 外发负例通过；未验证生产缓存和所有原生恢复链。 |
| RV31 · 自主任务试点 | not_run | 没有真实自愿参与者，只有经同意后可用的离线记录工具与模板。 |
| RV32 · 成本与商业证据 | not_run | 没有实际付费服务用量或支持成本，金额保持 null。 |
| RV33 · 不可信正文诱导外发 | partial | 真实工具入口使用合成不可信正文，测试中不能新增上传/公开/邀请/取密钥能力；未调用付费真实模型做攻击评测。 |
| RV34 · 来源与允许的本地资料 | partial | 内部对象复制/派生、旧索引回退、外部文件 marker 防降级及合法本地资产回归通过；未验证三平台实际备份还原。 |
| RV35 · 确认范围与网络模式 | partial | local-only 在准备正文/模型/网络之前停止外发，批准绑定 actor/env/session/payload/TTL；真实外部 MCP 客户端未运行。 |
| RV36 · 独立重复内容的合法性 | pass | 新 operationId 的相同正文仍允许创建；只对重试去重，不按正文永久合并。 |
