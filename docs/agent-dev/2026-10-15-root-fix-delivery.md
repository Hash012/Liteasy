# Root fix 2026-10-15 delivery

Baseline: `0bbc0b69920c96bea0491c13cafecbe1b38eba28` (desktop 0.1.56).
Input: `Liteasy_Root_Fix_20261015.zip`, SHA256 `e7c0d375ff166f191b3abd82440f2dc1e0e05a77cb0edb7f94d69a26f62b864c`.
Isolated branch: `codex/root-fix-20261015`. Existing changes in the user's main workspace are preserved.

## Baseline and scope

Pack validation: 38 hashes, 4 supplied screenshots, 27 source locations, 64 acceptance cases and 7 work packages verified. The pack's reference tests are not product acceptance tests. Local environment: Linux, Node 22.23.2. No access to the affected Windows user's library or display settings; original-library and physical DPI checks remain NOT_RUN until separately evidenced.

| Findings | Reproduction / regression boundary | Baseline evidence |
| --- | --- | --- |
| F01 | workspace board → reference service → preview | Board read returns JSON Canvas; preview reconstructs markdown |
| F02–F03 | Notes controller with shared objects / placements | Automatic rows flatten boards and members; single-title membership map |
| F04 | native annotation loader → notes presentation | Title copied from markdown first line |
| F05–F06 | actual useObjectWorkbenchController composition | Missing native annotation registration; zero/ambiguous routes conflated |
| F07 | Notes toolbar / shared primitives | Mixed input and option-picker density |
| F08 | inventory projection | Asset counts are distinct from processing readiness |
| F09 | workspace drop → import scheduling | Import eagerly queues full extraction |
| F10 | reader raster / text / optional glyph stages | Native text does not require heavy extraction; optional geometry can delay text |
| F11 | library associated items | Three extraction views occupy default list |
| F12–F14 | recommendation disclosure / refresh | Repeated title, explanation is not curation, migration provenance per card |
| F15–F16 | coordinator CAS / ranking / UI | Feedback lifetime tied to feed, imprecise undo and inconsistent ranking |
| F17 | research enhancer evidence stat | Replaces revision while retaining previously captured text |

## Stages

0. Add privacy-preserving route diagnostics and production composition characterization.
1. Typed presentation in the existing registry, native annotation routing, preserved content bindings.
2. Board-centric Notes projection, AST-derived titles, shared toolbar density.
3. Lazy PDF processing, independent reader stages, immutable extraction references.
4. Durable idempotent feedback and unified ranking projection.
5. Explicit bounded AI curation with frozen and validated evidence.
6. Cross-surface verification and delivery evidence.

Each stage is a separate reversible commit. No migration deletes original objects, placements, edges, annotations, or old extraction anchors. Validation, remaining limitations, and rollback evidence are recorded below as work completes; pending stages are not claimed as delivered.

## 交付实现（0.1.57）

- 原生批注与资源预览使用同一个注册入口；白板自身展示固定布局，来源意图定位原始 PDF。上下文选择器移除旧类型白名单与重复 Markdown 旁路。历史布局缺失明确报错，不偷换最新版本。
- 白板笔记按根聚合，共享成员保留每个 placement 和固定 revision；多选上下文保存布局和内部边。自动标题从共享 AST 派生，用户命名和正文不改写；笔记工具栏使用共享紧凑密度。
- PDF 默认打开时准备全文，支持全局/单篇 manual、on-import、on-open。现有 import store 承担串行执行、持久结果、跨窗口 CAS 租约、取消和来源/recipe 校验。绘制、原生文字、可选 glyph 几何分阶段；全文版本归档不覆盖旧锚点。
- 修复浏览器回归实际发现的问题：`sha256:` 格式与 native 64 位十六进制版本校验不一致，曾使批注重开时被过滤；现在保持一致且损坏可选版本字段不再丢正文。页内编辑浮窗约束在阅读区域，保存按钮可操作。
- 推荐反馈独立于 provider/feed 保存，返回幂等回执、精确撤销并保留其他维度；四种排序统一消费偏好。提交失败留在当前卡重试，隐藏卡保留占位。
- AI 精选和单篇解释是显式动作，复用现有网关/配额；冻结候选、授权证据和反馈版本，预算内选择子集并报告真实数量。旧文本不能换贴新 revision；候选外输出、伪造 quote/hash、变更或撤权后的结果拒绝发布。旧列表可恢复。AI 生成仍默认关闭。

## 已执行验证

环境：Linux，Node 22.23.2，Rust 1.98.1，Playwright Chromium 1234；合成夹具与仓库已有 PDF，未使用受影响用户的原始私有库。

| 命令/范围 | 实际结果 |
| --- | --- |
| `npm test`（完整桌面） | 首轮 612 文件，4299 通过、7 失败、9 既有跳过；失败逐项定位修复，受影响组重新执行通过。最终提交的完整 CI 另行生成报告，不把首轮写成全绿。 |
| `npm run ci:content` / `ci:export` | 25 / 52 项通过；边界检查通过。 |
| `npm run ci:ui` | UI 边界、审查清单及 211 项 UI 测试通过；随后 `ci:context` 192 项通过。 |
| `npm run ci:smoke` / `npm run build` | 模块大小写、资源、语言包检查通过；生产构建验证 231 个文件。Vite 保留大 chunk 提示。 |
| `npm run ci:ui-browser` | 99 项，97 首轮通过；2 个旧提示文案断言失败，更新为新行为并加标题唯一性断言后，深浅主题复测均通过。 |
| 真实 PDF 选字专项 | 100/120/80% 正反拖选、复制、高亮并重开一致；双栏边界与 Markdown 批注保存通过。 |
| `resourcePresentation` / `boardNotesProjection` / `resourceRoutingDiagnostics` | 6 / 5 / 2 项通过，使用生产组合根及真实 IndexedDB 实现。 |
| `pdfProcessingPolicy` / `useWorkspaceActions` | 8 / 19 项通过；包含 100 导入零重任务、跨窗口合并、取消、策略重开、写盘失败和重试。 |
| 推荐反馈/协调/模型机制 | `RecommendationList` 8、coordinator 12、feedback projection 9、research enhancer 8 项通过。模型调用采用可控制的 transport，不宣称实际语义质量。 |
| `cargo +1.98.1 check --locked --all-targets --no-default-features --manifest-path src-tauri/Cargo.toml` | 通过。 |
| `cargo +1.98.1 test --locked --no-default-features --manifest-path src-tauri/Cargo.toml user_paper_store::tests` | 5 项通过，包括不可变全文归档的实际文件读写。其余 Rust 测试被过滤，并非已通过全部宿主测试。 |

验收矩阵：[64 项逐条记录](2026-10-15-root-fix-acceptance.json)。目前 40 PASS、24 NOT_RUN；NOT_RUN 记录部分证据及缺少的相应层级，未降级验收定义。运行日志和截图交付在 `Liteasy-root-fix-0.1.57-evidence.zip`，不将运行生成物提交为源文件。

推荐工程回放使用 15 个合成研究问题、6 篇可核验真实题录，两个日期共 30 快照。当前 Linux 机器 p95 3.215 ms、增量 RSS 15.5 MiB，仅限六候选工程回放；不是 200 候选的实测，不代表推荐语义提升。相关性、理由事实性、置信区间和人工对照仍 NOT_RUN。

## 数据与回退

原对象、placement、关系和显式个人文件夹引用保留；聚合测试比较改动前后原对象序列化内容。全文历史按内容 hash 归档；旧格式载入保守处理，不将无出处的旧文本补造 sourceHash。反馈迁移有持久标记，重复执行不增加事件；有界历史压缩保留有效状态，超期撤销明确拒绝。

每阶段有独立提交。回退展示时保留新版数据与全文归档，优先打开原文件；不要让旧二进制写回新反馈存储或清除目录。旧版本二进制回滚/前进两次的完整演练尚未做，不能把迁移幂等测试称为回滚验收。

## 仍需专项验证的边界

Windows 物理 DPI/触屏、原用户库、无 OCR 扫描件及密码/超大 PDF、故障注入的完整浏览器链、1000 笔记/100 白板性能与任务压力、真实 AI 按钮至账户预算全链和人工推荐质量尚未完整验收。内部 Notes 当前仍读取现有对象头及缓存正文投影，不声称已完成大规模懒加载优化。Windows installer 必须以最终提交 CI 的 Release 链接、实际安装启动、NSIS 和上传结果为准；Linux 构建不替代该结果。

## 安装前复核补充

提交 `305bddd7` 的完整 CI 已通过：两片完整桌面套件共 4324 个用例条目，零失败/错误（包括原有 skipped）；99 项浏览器检查通过，Windows Release、NSIS、实际安装与 WebView2 启动、cleanliness 和上传通过。随后复核发现白板的“打开内容”动作仍可进入原生 JSON 行选择器，已改为复用同一注册表示；普通文本直接复用已读取的 ContentFragment，避免重复读取。专项 8 个浏览器路径及最终 44 项受影响测试、smoke、生产构建通过。此补充提交重新请求完整安装包 CI，交付以该次产物为准。
