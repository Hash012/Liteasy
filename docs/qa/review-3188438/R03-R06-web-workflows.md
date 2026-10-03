# R03–R06 Web 工作流交付记录

复查基线为 `3188438c95dfc7f73b5ccf20a05ef69391e646cf`。本记录覆盖 Intuecho Web，并说明其 R02 command/revision 客户端依赖；API、Desktop 和最终集成验证另列。实现位于 `products/intuecho/apps/web/`，保留现有 Fluent 界面和 D01–D08 决策。

## 实现与回归

| 范围 | 实现路径（相对 Web 目录） | 交付行为与覆盖的缺陷 |
| --- | --- | --- |
| R03 草稿与会话 | `src/communityPersistence.ts`、`src/LocalDraftControls.tsx`、`src/identityClient.ts` | 草稿可跨组件重挂载与同账号重新登录保存；必须主动恢复，不自动提交。保存后再编辑会显示未保存；配额失败不宣称保存成功。换账号不会恢复上一账号草稿。 |
| R02 创建与恢复 | `src/communityCommands.ts`、`src/communityApi.ts` | 创建前持久化稳定 operationId、规范化 SHA-256 和冻结 payload；响应丢失保留原操作。增加跨客户端争用、损坏记录、已提交草稿再次打开、只读回执核实等回归。 |
| R03 预览与冲突 | `src/AnnotationComposer.tsx`、`src/AnnotationSendPreview.tsx`、`src/RevisionConflict.tsx`、`src/AnnotationApp.tsx` | 受众扩大、正文/来源变更撤销旧预览；作者资料发送前重读。普通回复使用轻量正文/实际受众/作者资料预览，独立副本使用完整预览。两者均传 `expectedAuthorProfileRevision`。编辑使用 `expectedRevision`；409 保留草稿，显式读取当前正文后可只采用新修订号。 |
| R04 零批注组织读书包 | `src/reading-group/readingGroup.ts`、`src/reading-group/OrganizationReadingGroup.tsx`、`src/LiteratureTargetEditor.tsx` | 通过 `collaboration.schemaVersion: 1` 和 kind 识别资料包及协作回复，旧标签/Markdown 前缀不推断类型。零批注组织可检索当前授权下已有的 confirmed 文献，或沿用 resolver/confirm；无资料时保持空态，不创建占位批注或伪造 confirmed/revision。 |
| R05 来源与笔记回流 | `src/SourceRevision.tsx`、`src/reading-group/OrganizationReadingGroup.tsx` | 保存 sourceNamespace/sourceId/revision/locator；显式读取并区分历史版与当前版，版本保留到 Desktop 链接。导出仅包含本人主动填写的复盘、版本化引用和组织来源标识，不复制组织正文，不覆盖已有笔记。 |
| R06 空间与操作 | `src/CommunityOperationCenter.tsx`、`src/AnnotationApp.tsx` | 当前账号本机社区 command 记录的派生投影，区分待发送、结果待核实、已提交和拒绝；不建立新的跨产品权威数据库。明确本机草稿、个人云、组织资料与 Intuecho 发布各自的范围。 |

修复中还复现了三个具体问题：`COMMAND_RESULT_UNAVAILABLE` / `COMMAND_PAYLOAD_CONFLICT` 的 409 曾被误标为未提交；切换来源时旧请求可能留下永久 pending；派生批注编辑曾显示 annotation revision，却发送 source reply revision，且缺少回复冲突恢复。对应回归现要求：保留原 command 待核实；来源/会话切换后清除旧正文与 pending；annotation 修订 9、source reply 修订 4 冲突时保留草稿，读取当前 reply 修订 5，再明确采用 5 提交。

## 所有权与结果未知边界

持久 owner 为 `[API environment, identity issuer, session userId(subject), audience]`，草稿再按编辑/回复目标 scope 隔离。token 和运行期 generation 不进入 owner。generation、actor binding 与挂载状态用于阻止旧异步结果更新新会话，不能代替持久所有权。退出不会删除原账号草稿；这是浏览器内逻辑隔离，不是同一 OS 用户之间的物理隔离。

Web Locks 序列化同 owner/type/target 的创建预留；缺少 Web Locks、存储配额不足或 command 记录损坏时，不启动创建请求。网络响应丢失、无法验证回执以及上述特殊 409 保留 `outcome_unknown`。重载只显示记录，只有点击“核实原操作（只读）”才 GET 回执；核实不会重发。`not_found` 后仍需用户明确重试，沿用原 ID 和冻结内容；已提交原草稿不能默默产生副本。确认 committed 后移除记录中的冻结正文。

`committed` 不代表当前仍有正文读取权；来源撤回/失权后不展示历史正文。操作中心不渲染持久 payload。取消窗口不撤回已提交内容；不加入广场的公开内容仍公开；通知已读不等于任务完成。这些状态均不是另一个业务事实来源。

## 历史验证与未运行项

以下为 Linux x86_64 / Node 22.13.1、Vitest/JSDOM 和 mock transport 的局部开发验证，列出的 agent SHA 对应提交所收录的变更。它们不是最终集成 SHA 的统一验收，不累加重叠测试计数。

| Agent SHA | 实际局部验证 |
| --- | --- |
| `54e68d6b`、`8521ef35` | 草稿与工作流切片；`8521ef35` 收录代码的最后局部检查：`communityPersistence` 3、`communityCommands` 7、`SourceRevision` 2，共 12/12；Web build 与 production-assets 检查通过。 |
| `529ddbcf` | 特殊 409 与来源切换回归先出现 3 项失败；修复后 `communityCommands` 9 + `SourceRevision` 4，共 13/13；Web build 与 production-assets 检查通过。 |
| `8167ea90` | 普通回复预览/资料复核与派生回复冲突回归先出现 5 项失败；修复后 `AnnotationComposer` 37 + `RevisionConflict` 1，共 38/38；Web build 与 production-assets 检查通过。含普通回复父受众改变、确认等待中换 actor 不发送旧草稿。 |

`8521ef35` 提交前的较早开发快照曾运行 Web 全套 109/109，其中包含空组织选材、类型识别、资料/引用变化、失权清除和个人复盘导出；之后增加了测试，因此该 109 不能作为 `8521ef35` 或后续提交的完整测试计数。最终同 SHA 结果以集成验证记录为准。

复现入口在 `products/intuecho/`：`npm ci`；`npm run test --workspace=@intuecho/web`；`npm run build --workspace=@intuecho/web`。局部检查可在 test 命令后用 `-- src/AnnotationComposer.test.tsx src/RevisionConflict.test.tsx` 等实际文件筛选。真实浏览器持久存储/Web Locks 多窗口行为、原生 deep link/OAuth/keyring、真实 IdP、生产环境及真人试点均为 `not_run`；JSDOM 的重挂载、transport/Web Locks mock 不等同于这些层的验收。

## 兼容与回滚

Web 使用 local storage v1、command protocol v1 和 collaboration schema v1；依赖服务端相应 command lookup、expectedRevision/profile revision、confirmed source 与历史版本读取契约。旧 collaboration 为 null 的内容继续按普通内容显示，未经确认或缺少修订的文献投影不可提升为 confirmed。旧会话缺少 issuer 时使用按 API 环境限定的兼容值；正常新会话记录 issuer，不跨 owner 自动迁移草稿。

本切片没有 Web 数据库迁移。回滚客户端时须协调服务端契约，不移除原操作 ID/摘要/未知回执来绕过恢复流程，也不把本机日志的 committed 当作可见性授权。旧客户端可能丢失 revision/command 保护，建议前向修复；保留 v1 本机记录供恢复，并避免降级后将未知操作作为全新创建再次发送。
