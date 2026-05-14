# Liteasy 持久化存储与阅读批注系统设计

日期：2026-05-13

## 1. 概述

对 Liteasy Phase 0-1 桌面端原型进行三项核心改造：

1. **持久化存储** — 全内存 store 改造为 SQLite 持久化
2. **PDF 阅读器** — 纯文本提取渲染替换为 PDF.js 原生渲染
3. **批注系统** — 新增文本选中、浮动菜单、分组笔记功能

三项改造共享数据层（SQLite），统一设计、分步实施。

## 2. 持久化存储

### 2.1 技术选型

Rust `rusqlite`（bundled SQLite），数据库文件存储在 `~/.local/share/liteasy/data.db`。

### 2.2 表结构

```sql
CREATE TABLE papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content TEXT,
  page_count INTEGER DEFAULT 0,
  imported_at TEXT NOT NULL
);

CREATE TABLE note_groups (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES note_groups(id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  selected_text TEXT NOT NULL,
  note_text TEXT DEFAULT '',
  page_no INTEGER NOT NULL,
  bbox TEXT,
  color TEXT DEFAULT '#ffeb3b',
  created_at TEXT NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'qa',
  title TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citation_refs TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 2.3 Tauri Commands

| Command | 方向 | 说明 |
|---------|------|------|
| `db_init` | 前端→Rust | 初始化数据库，创建表 |
| `db_save_paper` | 前端→Rust | 保存/更新论文 |
| `db_load_papers` | 前端→Rust | 加载全部论文 |
| `db_delete_paper` | 前端→Rust | 删除论文及关联数据 |
| `db_save_note_group` | 前端→Rust | 保存/更新笔记分组 |
| `db_load_note_groups` | 前端→Rust | 按 paper_id 加载分组 |
| `db_delete_note_group` | 前端→Rust | 删除分组及关联笔记 |
| `db_save_note` | 前端→Rust | 保存/更新笔记 |
| `db_load_notes` | 前端→Rust | 按 paper_id 或 group_id 加载笔记 |
| `db_delete_note` | 前端→Rust | 删除笔记 |
| `db_save_conversation` | 前端→Rust | 保存对话及消息 |
| `db_load_conversations` | 前端→Rust | 加载对话列表/详情 |
| `db_save_setting` | 前端→Rust | 保存设置项 |
| `db_load_settings` | 前端→Rust | 加载全部设置 |

### 2.4 Store 改造

现有内存 store（workspace / import / assistant / settings / artifact）改造为：

- **启动时**：调用对应 `db_load_*` 命令恢复状态
- **变更时**：调用对应 `db_save_*` 命令持久化
- import store 生命周期跟随导入任务，不持久化（但成功导入的 paper 走 `db_save_paper`）

## 3. PDF 阅读器

### 3.1 技术选型

`pdfjs-dist`（PDF.js），通过 Web Worker 异步渲染 PDF 页面到 Canvas，叠加透明 text layer 支持文本选择。

### 3.2 渲染架构

```
原始 PDF 文件 (本地路径)
  → Tauri convertFileSrc() 转换为可访问 URL
    → PDF.js 加载
      → Canvas 逐页渲染（保留完整排版）
      → Text layer 透明叠加（支持选中、搜索）
      → 高亮层叠加（已批注标记）
```

### 3.3 ReaderPane 改造

- 废弃当前纯文本分段渲染
- 新组件结构：
  - 顶部工具栏：页码导航、缩放、搜索
  - 主区域：Canvas + text layer + highlight layer
  - 浮动菜单：选中文字后弹出（高亮/批注/复制/收藏）

### 3.4 与原系统的兼容

- Rust 端 `import_pdf` 命令保持不变，继续执行文本提取
- 提取的文本存入 `papers.content` 字段，用于全文检索
- 阅读器使用原始 PDF 文件渲染，不依赖提取文本

## 4. 批注系统

### 4.1 交互流程

```
中栏选中文字
  → 浮动菜单出现（高亮 / 批注 / 复制 / 收藏）
    → 点击「批注」
      → 弹出分组选择器（已有分组列表 + 新建分组）
        → 输入批注内容
          → 存入 SQLite（selected_text + note_text + page_no + bbox + group_id）
            → 右栏笔记面板刷新
            → PDF 页面上持久渲染高亮标记
```

### 4.2 笔记面板

右栏 Assistant 区域新增「笔记」标签页：

```
┌─ AI 助手 ─┬─ 笔记 ─┐
│                      │
│  📄 Paper A          │
│    📁 关键公式       │
│    📁 待复现实验     │
│    📁 引用素材       │
│  📄 Paper B          │
│    📁 方法对比       │
│  + 新建分组          │
│                      │
└──────────────────────┘
```

- 论文级一级折叠
- 分组级二级折叠
- 笔记条目显示选中原文摘要 + 批注预览
- 点击笔记条目 → 中栏跳转到对应 PDF 页码并高亮原文位置

### 4.3 数据模型

```
Paper (1) ──→ (N) NoteGroup ──→ (N) Note
```

笔记独立存储于 SQLite `notes` 表，通过 `paper_id` 关联论文，通过 `group_id` 关联分组。

## 5. 文件变更清单

### 新增

| 文件 | 说明 |
|------|------|
| `desktop/src-tauri/src/db.rs` | SQLite 初始化 + 全部 CRUD 操作 |
| `desktop/src/app/features/reader/reader.store.ts` | 阅读器状态（当前页码、缩放、高亮列表） |
| `desktop/src/app/features/notes/NotesPanel.tsx` | 笔记面板组件 |
| `desktop/src/app/features/notes/notes.store.ts` | 笔记状态管理 |
| `desktop/src/app/features/notes/notes.types.ts` | 笔记类型定义 |
| `desktop/src/tests/notes.store.test.ts` | 笔记 store 测试 |
| `desktop/src/tests/db.test.ts` | 数据库操作测试 |

### 修改

| 文件 | 变更 |
|------|------|
| `desktop/src-tauri/Cargo.toml` | + rusqlite (bundled) |
| `desktop/src-tauri/src/main.rs` | + db_init, db_* commands |
| `desktop/package.json` | + pdfjs-dist |
| `desktop/src/app/features/reader/ReaderPane.tsx` | 完全重写为 PDF.js 渲染 |
| `desktop/src/app/features/artifacts/ArtifactTabs.tsx` | 适配新 ReaderPane props |
| `desktop/src/app/layout/AppShell.tsx` | 集成 NotesPanel + 启动时 db_init |
| `desktop/src/app/styles/app.css` | 新增浮动菜单、笔记面板、阅读器样式 |
| `desktop/src/app/features/workspace/workspace.store.ts` | 启动加载 + 变更持久化 |
| `desktop/src/app/features/assistant/assistant.store.ts` | 对话持久化 |
| `desktop/src/app/features/settings/settings.store.ts` | 设置持久化 |

### 不变

- `import.store.ts`（生命周期仅在导入过程，不持久化）
- `mockRetriever.ts`（Phase 2 替换）
- `commandRouter.ts`（设置白名单逻辑不变）
- `answerFormatter.ts`

## 6. 测试策略

- `notes.store.test.ts` — 笔记分组 CRUD、笔记 CRUD、层级查询
- `db.test.ts` — SQLite 表创建、基本 CRUD、外键级联删除
- 现有 6 个测试文件保持通过（可能需要适配 props 变更）
- 手动验收：导入 PDF → 选中文字批注 → 关闭重开 → 确认笔记恢复
