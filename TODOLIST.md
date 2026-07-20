# LiteasyClaw 协作 TODOLIST

更新时间：2026-07-20

## 本轮已完成

- [x] 多模态产物标签可在主内容区、左右栏和下栏之间拖拽，位置写入本地 Dock 配置。
- [x] 产物停靠右栏时，点击证据只在中央 Reader 打开对应论文和 PDF 页，右栏产物保持可见。
- [x] PDF 批注卡片按内容高度从上到下堆叠，不再按剩余高度均分。
- [x] 多模态产物持久删除、普通对话/产物生成终止、重复生成确认。
- [x] Evidence 索引显示论文、页码和原文摘录，并支持页级 PDF 跳转。
- [x] 多 Session Chat、持久产物目录、流式 SubAgent 工作记录和动态树预览。

## 下一步：P0

- [ ] 为 Evidence 保存 PDF.js text item 字符范围或 bounding boxes，实现页内句级高亮，而不只是页级定位。
- [ ] 为动态产物 Dock 增加拖拽位置预览、同一区域内标签排序，以及键盘移动的可见操作提示。
- [ ] 将普通 Chat session registry 从前端内存迁移到轻量持久存储，恢复应用重启前的会话。
- [ ] 统一 ArtifactTask 与普通 Agent run 的状态面板、取消原因和错误重试入口。
- [ ] 更新旧 Assistant UI contract 测试，清理当前全量测试中的历史失败。

## 下一步：P1

- [ ] 将 AnalysisRun、Evidence、Claim 和 Artifact catalog 迁移到 SQLite 分表/WAL，并保留 JSON 显式导出。
- [ ] 增加产物重命名、标签、搜索、批量导出以及可恢复的回收站语义。
- [ ] 为多论文产物增加证据覆盖率视图，按论文、章节、实验表格和局限项展示缺口。
- [ ] 为 PDF 批注增加持久化、点击批注跳页、删除/编辑以及与 Chat session 的双向引用。
- [ ] 对 PDF.js worker、主应用包和大图片做按需加载，降低当前生产包体积。

## 协作约定

- Agent 生成结果保存在 `project-docs/agent-results/`；确认不含敏感内容后再提交。
- 本地密钥只放在 `LiteasyClaw/services/dev-cloud/.env.local` 或被忽略的 `project-docs/test-api.md`。
- 修改桌面端至少运行 `npm run build` 和受影响的 Vitest；修改 dev-cloud 运行其 `npm test`。
- 不要把“关闭产物标签”实现成“删除产物文件”；删除必须经过明确确认。
