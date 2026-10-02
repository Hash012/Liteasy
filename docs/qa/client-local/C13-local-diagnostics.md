# C13 — 自愿本地诊断与合成回归（部分交付）

日期：2026-10-03（Asia/Shanghai）。代码提交：`3bb1e903481e89e2aee11986cfb8eef69c0629cc`，基线 `0fba97be`。

本次完成默认关闭的本地诊断、帮助页预览与主动下载，以及原位置文件打开管线的合成回归。**C13 整卡未完成**：三个控制器阶段不等于首次可读首屏，也不等于六类用户完整任务验收。没有用户访谈、真实模型质量或效率改善结论。

## 交付行为

- 帮助页顶部“本地诊断”默认关闭；启用仅对本次窗口有效。离开帮助页可继续复现，切换账号或卸载原文件控制器会关闭并清空，重新加载仍关闭。
- 沿用现有帮助入口和 `useOriginalFileOpenController`／原文件服务，不新建文件数据库、不重读路径。采集仅包住选择文件、读取已授权文件、调用已有阅读器回调三个阶段；选择器取消单独记录，异常仅映射成固定错误码。
- 内存环形缓冲区最多 100 条记录，记录阶段、状态、可选 PDF／EPUB 格式、毫秒耗时、序号及固定错误码。没有绝对时间、源对象 ID、grant、文件名、路径、异常原文、正文、查询词、账号、聊天或凭据字段。
- 关闭、清空、重新启用或账号切换均使旧 generation 失效；尚未结束的阶段及同一选择流程余下的阶段不会进入新会话。原始错误仍按既有界面路径显示，不进入诊断导出。
- 先预览固定快照，可删除快照条目、去掉整组环境信息；下载内容与当下预览逐字相同，预览后出现的新事件不会悄悄加入。清空或会话变化使旧预览失效。
- 环境只含包版本、运行环境枚举、从当前窗口 UA 提取的 OS／架构枚举、引擎类型和数字版本。不导出完整 UA，不探测主机名、账号目录或系统日志。无法识别时为 `unknown`；引擎数字不冒充完整原生 WebView 安装版本。
- 下载失败显示复制预览的退路，无自动上传地址、网络调用、遥测 SDK、持久化开关或诊断文件扫描。C00 的 `npm run client:doctor` 仍是开发机工具链／原生依赖诊断入口，本功能不复制该脚本的探测实现，也不导入已有自由文本日志。

## 分层 fixture 与真实执行结果

稳定 fixture：`development/test-data/client-diagnostics/original-open.json`。所有路径、账号样式字串、grant、正文／聊天标记和 token 都是合成负例。12 字节的 PDF 描述符仅用于模拟传输，不是真 PDF；未读取私人文件。

| 层 | 证据 | 结果及边界 |
| --- | --- | --- |
| 回归先行 | `/tmp/liteasy-c13-red.log` | 既有帮助测试 4 项通过、新入口测试 1 项失败：找不到“本地诊断”。 |
| collector／导出边界 | `localDiagnostics.test.ts` | 4 项：默认不观察时钟／错误，固定错误码，晚到成功和失败失效，冻结且有界的记录，允许字段投影。 |
| 实际控制器＋模拟服务 | `originalFileDiagnostics.test.tsx` | 8 项：选择成功／取消，读失败，阅读器失败，队列打开，默认不采集，换账号，关闭后重新启用。 chooser/read/queue/reader 都是测试替身，不是原生 IPC。 |
| UI／Blob | `localDiagnosticsPanel.test.tsx` | 2 项：删除、环境排除、精确下载快照、帮助页离开／返回、账号 reset 使预览失效。Blob 创建和点击在 jsdom 中替换。 |
| 受影响原有功能 | `helpModule.test.tsx`、`originalFileOpenController.test.tsx` | 11 项：帮助和原文件生命周期继续通过。 |
| Chromium 实际应用 | `browser/localDiagnostics.browser.spec.ts` | 1 项通过：真实 AppShell 帮助页下载环境信息包并与预览逐字比较，重新加载恢复 opt-out。新浏览器配置、无文档；没有 native mock，也没有真实 Tauri 传输。 |

定向测试总计 25 项通过，日志 `/tmp/liteasy-c13-focused.log`。UI teardown 的 `act` 包裹随后修正；仅重跑受影响的两个 UI 测试，日志 `/tmp/liteasy-c13-panel-final.log`，2/2 通过且无该警告。

Chromium 日志 `/tmp/liteasy-c13-browser.log`，截图位于桌面目录 `test-results/localDiagnostics.browser-h-5612c-y-reload-returns-to-opt-out/diagnostics-reviewed.png`；产物未提交。初次使用 Playwright 自动 webServer 等待未起服务，人工终止后改用独立 localhost 1433 与 localhost `NO_PROXY`；不把首次等待写为测试通过。临时 Vite 已停止。

## 度量定义与未建立的基线

本次只定义后续可比较的指标。下列用户任务基线均为 **not_measured**；测试运行时长不填入用户任务耗时。

| 度量 | 起点 → 终点 | 正确性／失败口径 |
| --- | --- | --- |
| 首次资料打开 | 用户确认选定合成资料 → 第一处实际可阅读内容绘制 | 同一冷启动配置、格式、大小及设备；损坏格式、无权限和取消分开。当前 `open_reader` 只到回调完成，未测绘制。 |
| 正确找到来源 | 给定明确研究问题 → 用户或 fixture 核查命中同一源修订和正确位置 | 无证据、错误页、过时修订分别计数；不能以搜索返回结果代替正确找到。 |
| 形成用户确认产物 | 用户开始整理 → 用户审阅并确认持久化的产物版本 | 原文／模型／用户观点可区分，引用可回查；自动生成结束不是确认结束。 |
| 批处理安全完成 | 用户确认具体计划 → 每项都有可核查的最终状态／回执 | 记录成功、未执行、失败、冲突、重试次数及原字节保护；故障第 17 项后不允许整批假成功。 |
| 第二次继续任务 | 重新启动同一合成配置 → 回到预期源版本、位置与已保存产物并继续 | 首次会话须完整关闭；恢复失败、修订失配和只读状态分别记录，不能用下载次数代替继续使用。 |

将来比较已有工具与 Liteasy，必须先固定同一合成任务、工具版本、设备、预热条件、重复次数和计时方法，同时记错误及上下文切换。当前没有对照样本，不宣称整体更快、更易用、付费意愿或留存提升。

## 命令与环境

桌面目录中执行，`PATH=/home/tjm/.cache/ms-playwright-go/1.50.1:$PATH`：

```sh
npm ci --no-audit --no-fund
npm test -- src/tests/localDiagnostics.test.ts src/tests/localDiagnosticsPanel.test.tsx src/tests/originalFileDiagnostics.test.tsx src/tests/helpModule.test.tsx src/tests/originalFileOpenController.test.tsx
npm test -- src/tests/localDiagnosticsPanel.test.tsx
npm run ci:smoke
npm run build
# 独立终端先运行 npx vite --host 127.0.0.1 --port 1433 --strictPort
NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost PLAYWRIGHT_BASE_URL=http://127.0.0.1:1433 npx playwright test src/tests/browser/localDiagnostics.browser.spec.ts --workers=1
# 代码提交且工作区干净后
npm run ci:contracts
```

smoke 9/9；生产构建通过并验证 157 个产物，仍有既有大 chunk 提示；干净提交 contracts 通过，无 schema／锁文件漂移。对应日志为 `/tmp/liteasy-c13-smoke.log`、`/tmp/liteasy-c13-build.log`、`/tmp/liteasy-c13-contracts.log`。文档提交前另运行 `git diff --check`。

环境：Ubuntu 24.04.3 LTS，x86_64，WSL2 `6.18.33.2-microsoft-standard-WSL2`；Chromium `151.0.7922.34`。本地 Node `22.13.1`，仓库要求 `22.23.2`；本地 Rust `1.98.0`，Windows workflow 要求 `1.98.1`。没有 Rust 改动，未执行 Rust 检查；Linux 浏览器结果不是 Windows、macOS、Tauri WebView 或安装包验收。

## 未验证范围与回退

- S01／S07 仅有相关控制器阶段的合成覆盖；HTML／EPUB 完整阅读、搜索、标注、冷启动恢复以及三平台所有 OS 打开路径均未在本次执行。六类用户完整成功及失败用例、S02–S06／S08–S12 均未在本次新增验收；既有其他任务报告不能自动升级为本卡通过。
- 原生 WebView 下载、真实选择器、账号 native IPC、原文件 I/O、Windows／macOS 安装包、键盘／屏幕阅读器全流程与性能基线均未执行。用户可以复制 JSON 预览；不能声称已确认所有 WebView 支持下载按钮。
- 队列接收前／subscribe／drain 失败和释放 grant 失败没有单独诊断事件；不覆盖全文提取、模型、批处理、同步、恢复等其他阶段。
- 没有修改源文件、数据库 schema、已保存用户状态、备份格式、共享契约、锁文件、服务、部署或网络策略。回退可撤销本提交；诊断仅内存态，无迁移。已下载文件只由用户自行保管／删除，不会被程序回读或自动上报。

机器可读结果见同目录 `C13-verification.json`；`release_ready` 为 false。
