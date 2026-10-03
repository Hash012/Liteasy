# 0.1.36 工业化增量 review

输入包：`Liteasy-industrial-review-0.1.36-2026-10-03.zip`，SHA-256 为 `25e9d0ac379bcee93e6745a33aaa6f9276df4df5690b0cd33d729981807561bb`；包内 `SHA256SUMS.txt` 已逐项核对。源码基线是 `1b73dc5493c84d1e12515854572c89f18792629a`。

实施分支为 `feat/industrial-review-0136`，独立工作区为 `/home/tjm/proj/Liteasy-industrial-review`。原 main 工作区的 `.gitignore` 和未跟踪开发文档保持不动。遵循总控文件的首波范围：M00 草稿/操作故障隔离、M01 分页/恢复导航，M07 验证贯穿；随后完成 M04 的“继续上次讨论—核对来源版本—保留个人反思”切片，包含 M03 普通回复简化。其余任务不能用本轮结果替代验收。

## 本轮实现与结果

最终代码提交：`a2864a38cefd9118d312deacac8be1d3cff68786`。后续收口提交仅增加本目录文档。

| 用户行为 | 之前 | 现在 |
| --- | --- | --- |
| 发送独立批注 | 同一账号的一项未知发送会阻塞其他新建 | 独立草稿/操作互不阻塞，同一操作 ID 保持冻结和幂等；只核实不重发 |
| 多窗口写作 | 新稿共享槽位，旧完成回调可能删除新稿 | 独立 draftId/revision、350ms 自动保存、条件清理和冲突分支；关页保留最后输入 |
| 本机异常记录 | 一条坏记录可能使整个列表不可用 | 保留原始字节、隔离坏记录、健康数据继续可用；可主动导出；存储失败不显示已保存 |
| 最新广场 | 只能看到首批结果 | 接入现有 cursor API，保留筛选、重试、返回位置与重新鉴权；不支持分页的筛选明确回退原接口 |
| 核实操作 | 需要手工寻找资源 | 从操作中心打开原稿、结果或冲突说明；每次结果导航重新鉴权 |
| 普通同范围回复 | 重复预览审批 | 一次明确发送，仍检查账号、父条目修订和受众；扩大发布范围保留确认 |
| 第二次参加读书组 | 摘要、问题、证据混在长列表 | 展示前次主持人摘要与未解决项，筛选问题/原文对照/摘要，保留来源版本 |
| 个人反思 | 切换预览或关闭可能丢失；导出可能悄悄换版本 | 按账号/来源独立保存，预览不改变引用，明确操作才换引用；导出前重新鉴权 |

已通过：Intuecho Web 全量 **168 项**、API **298 项**、契约类型检查；桌面相关 **20 项**、smoke **9 项**；Web 与桌面生产构建；桌面 `ci:contracts`。构建仍有既有的大 chunk 提示，本轮没有修改阈值。

真实 Chromium **11/11** 通过：执行前后均为上述 SHA，工作区均干净，`cleanUnchangedSource=true`，无页面异常、无外部网络请求。覆盖 P01–P05、真实双窗口编辑与配额失败、关页后的迟到提交、65 条三页遍历、重试/返回/刷新/筛选取消/撤权和恢复导航。M04 的版本/反思回归是 JSDOM 与本机存储测试，**未将它描述为 Windows 原生或真人读书组验收**。

工具链：Ubuntu 24.04.3 / WSL2 x86_64，Node **22.13.1**，Chromium **151.0.7922.34**。`.nvmrc` 要求 **22.23.2**，本机可用版本不完全相同，已作为未验证项记录。依赖使用锁文件 `npm ci` 安装，没有升级锁文件或应用版本。

详细命令、日志摘要与文件哈希见 [verification.json](verification.json)；逐项范围见 [SCENARIOS.md](SCENARIOS.md) 和 [scenarios.json](scenarios.json)。浏览器原始 trace、截图和合成请求日志保存在 `/tmp/liteasy-industrial-final-a2864a38/`；测试日志保存在 verification 中的本机路径，未把运行生成物加入源码库。

## 复现与恢复

```bash
cd products/intuecho
npm ci
npm test
npm run build

cd ../liteasy/apps/desktop
npm ci
npm test -- src/tests/useCommunitySourceController.test.tsx src/tests/communityReflectionDrafts.test.ts src/tests/communitySourceReference.test.ts
npm run ci:smoke
npm run build
npm run ci:contracts

cd ../../../..
node products/intuecho/scripts/industrial-community-browser.mjs
```

浏览器命令要求本机已安装 Playwright Chromium；可用 `LITEASY_CHROMIUM_EXECUTABLE` 指定已有浏览器。脚本固定创建隔离 loopback HTTP 服务和临时浏览器上下文，不能指定生产端点。报告目录可由 `LITEASY_BROWSER_REPORT_DIR` 指定。

草稿升级读取旧 v1 而不删除原件，恢复编辑写入独立 v2 分支；保存失败先复制/导出内容再关闭窗口。未知操作只通过原 ID 核实；损坏的未知操作不能重放。完整完成记录保留最近 100 条，较早回执压缩为不可自动淘汰的意图标记；未知正文和草稿不因容量压力被自动删除。桌面恢复了其他窗口的反思后，提交成功也不会清理另一编辑器拥有的原草稿。

没有数据库迁移、权限政策变更或新外发入口。M02/M05/M06 的完整原生旅程、全面旧客户端协议协商、真实 PostgreSQL/IdP/S3/scanner、Windows 安装运行和 M08 真人试点尚未验收。当前候选仅限上述经验证切片，不能据此宣称整个工业化任务包或生产环境已验收。

## 验证口径

- 包内五个 probe 是旧行为复现，不能当修复验收。仓库回归使用真实契约和完整有效 fixture，红测必须失败在目标行为上。
- JSDOM、真实 Chromium 的跨窗口存储、合成 HTTP、真实数据库、原生客户端和真实 IdP/S3/scanner 分层记录。浏览器真实 Web Locks/localStorage 不等于真实账号或生产服务已验收。
- 最终结果绑定实际被测代码提交、文件摘要、命令、退出码与工具链。测试后的纯文档提交不冒充被测代码 SHA。
- 构建安装包、实际安装运行、生产发布是不同阶段。本任务包禁止自动 push/merge/release/deploy，因此不因完成本地验证而执行这些动作。

## 兼容与恢复原则

持久归属仍绑定 API 环境、issuer、subject 和 audience；运行期 generation 仅隔离在途请求。草稿、冻结操作与服务端回执分别存储。新草稿不是重试旧操作的手段；结果未知时保留原 ID 和 payload，核实本身不能触发发送。

旧浏览器记录必须保留并可恢复，损坏原始字节不能为了“解锁”而删除。降级客户端不具备新草稿与条件删除语义，优先前向修复，不以清空 localStorage 回退。已提交的本地记录不是持续正文访问许可，结果导航必须重新向服务端查询。

协议与环境门禁见 [M07 兼容矩阵](M07-compatibility.md)。实际命令与验收状态在收口时记录，不从历史测试数或 CI 绿灯推导本轮通过。
