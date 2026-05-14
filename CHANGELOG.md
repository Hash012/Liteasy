# Liteasy 开发变更日志

## 2026-05-12 — Phase 0-1 最小闭环实现

### 概览

在现有桌面端骨架基础上，完成了从 UI-Stores 联通到全链路 mock 交互的最小可行闭环。用户现在可以：启动桌面 → 导入文献 → 勾选锁定 → 三模式对话（问答/解释/命令）→ 生成思维导图并在中栏查看。

### 新建文件

| 文件 | 说明 |
|---|---|
| `desktop/src/app/features/retrieval/retrieval.types.ts` | Citation、PaperChunk、AnswerPayload 类型定义 |
| `desktop/src/app/features/retrieval/mockRetriever.ts` | Mock 检索器，基于关键词匹配返回预制论文片段和回答 |
| `desktop/src/app/features/assistant/answerFormatter.ts` | 回答格式化，将 AnswerPayload 转为带引用编号和可信度的文本 |
| `desktop/src/app/features/settings/settings.types.ts` | 设置项类型定义（SettingKey、SettingDefinition、SettingChange） |
| `desktop/src/app/features/settings/settingsRegistry.ts` | 设置白名单注册表（联网推荐、用户画像、默认模式、语言） |
| `desktop/src/app/features/settings/settings.store.ts` | 设置状态存储，读写当前设置值 |
| `desktop/src/app/features/assistant/commandRouter.ts` | Rule-based 命令路由，将自然语言映射为结构化设置命令 |
| `desktop/src/app/features/artifacts/artifact.types.ts` | 产物任务和标签页类型定义 |
| `desktop/src/app/features/artifacts/artifact.store.ts` | 产物任务状态机（queued→running→completed/failed）+ mock 思维导图内容生成 |
| `desktop/src/app/features/artifacts/ArtifactTabs.tsx` | 中栏多标签页组件，含默认 Reader 标签和产物标签 |
| `desktop/src/tests/answerFormatter.test.ts` | 回答格式化器测试（3 tests） |
| `desktop/src/tests/commandRouter.test.ts` | 命令路由测试（6 tests） |
| `desktop/src/tests/artifact.store.test.ts` | 产物存储测试（3 tests） |
| `desktop/src/vite-env.d.ts` | Vite 环境类型声明（jpg/png 模块） |
| `docs/qa/phase1-test-guide.md` | Phase 1 非开发者测试指南（8 个测试步骤 + 手动清单 + 故障排除） |

### 修改文件

| 文件 | 变更内容 |
|---|---|
| `desktop/src/app/layout/AppShell.tsx` | 核心整合：创建所有 store 实例，实现 handleImport（Tauri invoke + mock 回退）、handleSend（命令路由 / mock 问答分发）、handleGenerateArtifact（异步产物生成），中栏接入 ArtifactTabs |
| `desktop/src/app/features/library/LibraryPane.tsx` | 改为接收 store props，从 workspaceStore 读取论文列表和勾选状态，显示导入任务状态 |

### 删除文件

（无）

### 测试结果

```
6 test files | 15 tests | 15 passed
TypeScript: 0 errors
```

### 关键设计决策

- **全前端 mock 策略**：不接真实 LLM API、不做 PDF 解析，用 fixture 数据跑通交互闭环
- **Store 按需实例化**：AppShell 用 useRef 创建单例 store，通过 props 注入子组件，无额外状态管理库
- **Tauri 渐进式集成**：`import_pdf` Rust 命令已就绪，前端自动检测 Tauri 环境，不可用时回退 mock
- **命令路由白名单**：仅允许已注册的设置项被命令修改，未知命令返回可理解的错误提示
