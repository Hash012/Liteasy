import { useRef, useState, useEffect, useCallback } from "react";
import { LibraryPane } from "../features/library/LibraryPane";
import { AssistantPane } from "../features/assistant/AssistantPane";
import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
import { createWorkspaceStore } from "../features/workspace/workspace.store";
import { createImportStore } from "../features/import/import.store";
import { createAssistantStore } from "../features/assistant/assistant.store";
import type { AssistantMode, AssistantMessage } from "../features/assistant/assistant.types";
import { mockAnswer } from "../features/retrieval/mockRetriever";
import { formatAnswer } from "../features/assistant/answerFormatter";
import { createSettingsStore } from "../features/settings/settings.store";
import { routeCommand } from "../features/assistant/commandRouter";
import { createArtifactStore, mockMindmapContent } from "../features/artifacts/artifact.store";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import liteasyClawLogo from "../../assets/liteasyclaw-logo.jpg";
import { createNotesStore } from "../features/notes/notes.store";
import { createReaderStore, type Highlight } from "../features/reader/reader.store";
import { SelectionMenu } from "../features/reader/SelectionMenu";
import { NotesPanel } from "../features/notes/NotesPanel";

function mockPaperContent(): string {
  return `深度学习在自然语言处理中的应用

近年来，基于 Transformer 架构的预训练语言模型在自然语言处理领域取得了突破性进展。BERT、GPT 系列模型通过大规模无监督预训练，在多项下游任务中刷新了最优结果。

注意力机制是 Transformer 的核心组件。自注意力（Self-Attention）通过计算序列中不同位置之间的相关性来生成上下文感知的表征，相比循环神经网络具有更好的并行性和长距离依赖捕捉能力。

在预训练阶段，BERT 采用掩码语言模型（Masked Language Model）和下一句预测（Next Sentence Prediction）两个任务，使模型能够学习深层的双向语言表示。GPT 系列则采用自回归语言模型，通过预测下一个词来训练模型。

实验结果表明，预训练语言模型在文本分类、命名实体识别、问答系统等任务上显著优于传统方法。然而，这些模型也面临着计算成本高、可解释性不足等挑战。`;
}

export function AppShell() {
  const workspaceStore = useRef(createWorkspaceStore()).current;
  const importStore = useRef(createImportStore()).current;
  const assistantStore = useRef(createAssistantStore()).current;
  const settingsStore = useRef(createSettingsStore()).current;
  const artifactStore = useRef(createArtifactStore()).current;
  const notesStore = useRef(createNotesStore()).current;
  const readerStore = useRef(createReaderStore()).current;

  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);

  const [readerPage, setReaderPage] = useState(1);
  const [readerScale, setReaderScale] = useState(1.2);
  const [readerHighlights, setReaderHighlights] = useState<Map<string, Highlight[]>>(new Map());
  const [paperFilePaths, setPaperFilePaths] = useState<Map<string, string>>(new Map());
  const [selMenuVisible, setSelMenuVisible] = useState(false);
  const [selMenuPos, setSelMenuPos] = useState({ x: 0, y: 0 });
  const [selText, setSelText] = useState("");
  const [selPageNo, setSelPageNo] = useState(1);
  const [selBbox, setSelBbox] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"assistant" | "notes">("assistant");
  const [pendingAnnotate, setPendingAnnotate] = useState(false);
  const [annotateGroupId, setAnnotateGroupId] = useState("");
  const [annotateText, setAnnotateText] = useState("");
  const [modalGroups, setModalGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [newGroupInput, setNewGroupInput] = useState("");
  const [notesRefreshKey, setNotesRefreshKey] = useState(0);

  // Dismiss selection menu on click-away
  useEffect(() => {
    if (!selMenuVisible) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".selection-menu") || target.closest(".reader-text-layer")) return;
      setSelMenuVisible(false);
      setSelText("");
      setSelBbox(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [selMenuVisible]);

  useEffect(() => {
    (async () => {
      try { await invoke("db_init"); } catch {}
      await workspaceStore.initFromDb?.();
      await settingsStore.initFromDb?.();
      // 恢复 paperFilePaths 映射，使 PDF 阅读器能获取文件路径
      const papers = workspaceStore.getState().papers;
      const paths = new Map<string, string>();
      for (const p of papers) {
        if (p.filePath) paths.set(p.id, p.filePath);
      }
      setPaperFilePaths(paths);
      refresh();
    })();
  }, []);

  const handleImport = async () => {
    let filePath: string | null = null;

    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      filePath = selected as string | null;
    } catch {
      // Tauri dialog not available (browser dev mode)
    }

    if (!filePath) {
      filePath = "user-selected-file.pdf";
    }

    // 重复导入检测
    const existing = workspaceStore.getPaperByPath(filePath);
    if (existing) {
      alert(`该文件已导入为「${existing.title}」，不能重复导入。`);
      return;
    }

    const jobId = importStore.startImport(filePath);
    importStore.markParsing(jobId);
    refresh();

    try {
      const result = (await invoke("import_pdf", { path: filePath })) as {
        jobId: string;
        status: string;
        title: string;
        content: string;
        pageCount: number;
        filePath: string;
      };
      const paperId = `paper-${result.jobId}`;
      const now = new Date().toISOString();

      importStore.markParsed(jobId, {
        paperId,
        title: result.title,
        content: result.content,
        pageCount: result.pageCount,
      });

      workspaceStore.addPaper({
        id: paperId,
        title: result.title,
        filePath: result.filePath,
        content: {
          fullText: result.content,
          pageCount: result.pageCount,
          importedAt: now,
        },
      });

      setPaperFilePaths(prev => {
        const next = new Map(prev);
        next.set(paperId, result.filePath);
        return next;
      });

      workspaceStore.setActivePaper(paperId);
      artifactStore.setReaderContent(paperId, result.title, result.content);
      refresh();
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      importStore.markFailed(jobId, errMsg);
      refresh();

      // Fallback to mock for browser-only dev mode
      if (typeof err === "string" && err.includes("Tauri")) {
        // already handled by markFailed above, do mock fallback
      }

      setTimeout(() => {
        const mockPaperId = `paper-${Date.now()}`;
        const mockTitle = `导入的文献 (${jobId})`;
        const mockText = mockPaperContent();
        const now = new Date().toISOString();

        importStore.markParsed(jobId, {
          paperId: mockPaperId,
          title: mockTitle,
          content: mockText,
          pageCount: 8,
        });

        workspaceStore.addPaper({
          id: mockPaperId,
          title: mockTitle,
          filePath: filePath ?? "",
          content: {
            fullText: mockText,
            pageCount: 8,
            importedAt: now,
          },
        });

        setPaperFilePaths(prev => {
          const next = new Map(prev);
          next.set(mockPaperId, filePath ?? "");
          return next;
        });

        workspaceStore.setActivePaper(mockPaperId);
        artifactStore.setReaderContent(mockPaperId, mockTitle, mockText);
        refresh();
      }, 1500);
    }
  };

  const handleTextSelect = useCallback((text: string, pageNo: number, bbox: string | null, menuX: number, menuY: number) => {
    setSelText(text);
    setSelPageNo(pageNo);
    setSelBbox(bbox);
    setSelMenuPos({ x: menuX, y: menuY });
    setSelMenuVisible(true);
  }, []);

  const handleAnnotate = useCallback(async () => {
    setSelMenuVisible(false);
    // Load existing groups for the active paper
    const activeId = workspaceStore.getState().activePaperId;
    if (activeId) {
      const gs = await notesStore.loadGroupsForPaper(activeId);
      setModalGroups(gs);
    }
    setPendingAnnotate(true);
  }, []);

  const handleToggleSelection = (id: string) => {
    workspaceStore.toggleSelection(id);
    workspaceStore.setActivePaper(id);
    const paper = workspaceStore.getPaper(id);
    if (paper?.content) {
      artifactStore.setReaderContent(id, paper.title, paper.content.fullText);
    }
    refresh();
  };

  const handleLockSelection = () => {
    if (workspaceStore.getState().selectionLocked) {
      workspaceStore.unlockSelection();
    } else {
      workspaceStore.lockSelection();
    }
    refresh();
  };

  const handleDeletePaper = async (id: string) => {
    const wasActive = workspaceStore.getState().activePaperId === id;
    // Optimistic: remove immediately
    setReaderHighlights(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    if (wasActive) {
      setPaperFilePaths(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      artifactStore.setReaderContent("", "", "");
    }
    // Fire DB delete in background, refresh UI now
    workspaceStore.deletePaper(id).then(() => refresh());
    refresh();
  };

  const handleModeChange = (mode: AssistantMode) => {
    assistantStore.setMode(mode);
    refresh();
  };

  const handleGenerateArtifact = (text: string): string | null => {
    const lower = text.toLowerCase();
    let artifactType: "mindmap" | "tree" | "ppt" | null = null;
    if (/思维导图|mind.?map/i.test(lower)) artifactType = "mindmap";
    else if (/树形展开|tree/i.test(lower)) artifactType = "tree";
    else if (/ppt|演示文稿/i.test(lower)) artifactType = "ppt";
    if (!artifactType) return null;

    const taskId = artifactStore.createTask(artifactType);
    artifactStore.markRunning(taskId);
    refresh();

    const artifactTitle =
      artifactType === "mindmap" ? "思维导图" : artifactType === "tree" ? "树形展开" : "PPT";

    setTimeout(() => {
      artifactStore.completeTask(taskId, {
        artifactId: `artifact-${Date.now()}`,
        title: artifactTitle,
        content: mockMindmapContent("工作区选中文献"),
      });
      refresh();
    }, 2000);

    return `正在生成${artifactTitle}，请查看中栏...`;
  };

  const handleSend = (text: string) => {
    const mode = assistantStore.getState().mode;
    const userMsg: AssistantMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
    };
    assistantStore.addMessage(userMsg);

    let responseText: string;
    if (mode === "command") {
      const artifactMsg = handleGenerateArtifact(text);
      if (artifactMsg) {
        responseText = artifactMsg;
      } else {
        const result = routeCommand(text);
        if (result.ok) {
          settingsStore.set(result.change.target, result.change.value);
        }
        responseText = result.message;
      }
    } else {
      const payload = mockAnswer(text);
      const formatted = formatAnswer(payload);
      responseText = formatted.text;
    }

    const assistantMsg: AssistantMessage = {
      id: `msg-${Date.now() + 1}`,
      role: "assistant",
      content: responseText,
    };
    assistantStore.addMessage(assistantMsg);
    refresh();
  };

  const activePaper = workspaceStore.getState().activePaperId
    ? workspaceStore.getPaper(workspaceStore.getState().activePaperId!)
    : undefined;

  return (
    <div className="app-frame">
      <header className="app-topbar">
        <div className="brand">
          <img alt="LiteasyClaw Logo" className="brand-logo" src={liteasyClawLogo} />
          <div className="brand-meta">
            <div className="brand-name">LiteasyClaw</div>
            <div className="brand-tagline">AI-driven paper-assisted reading platform</div>
          </div>
        </div>
      </header>

      <div className="app-shell">
        <aside className="pane left">
          <div className="pane-header">Library</div>
          <div className="pane-body">
            <LibraryPane
              importStore={importStore}
              onImport={handleImport}
              onLockSelection={handleLockSelection}
              onToggleSelection={handleToggleSelection}
              onDeletePaper={handleDeletePaper}
              workspaceStore={workspaceStore}
            />
          </div>
        </aside>
        <main className="pane center">
          <div className="pane-header">Reader</div>
          <div className="pane-body">
            <ArtifactTabs
              tabs={artifactStore.getOpenTabs()}
              readerFilePaths={paperFilePaths}
              readerPageNumber={readerPage}
              readerScale={readerScale}
              readerHighlights={readerHighlights.get(workspaceStore.getState().activePaperId ?? "") || []}
              onReaderPageChange={setReaderPage}
              onReaderScaleChange={setReaderScale}
              onTotalPages={(n) => readerStore.setTotalPages(n)}
              onTextSelect={handleTextSelect}
            />
          </div>
        </main>
        <section className="pane right">
          <div className="pane-header">
            <span style={{ cursor: "pointer", marginRight: 12 }}
              onClick={() => setRightTab("assistant")}
              className={rightTab === "assistant" ? "mode-button active" : "mode-button"}>
              AI 助手
            </span>
            <span style={{ cursor: "pointer" }}
              onClick={() => setRightTab("notes")}
              className={rightTab === "notes" ? "mode-button active" : "mode-button"}>
              笔记
            </span>
          </div>
          <div className="pane-body">
            {rightTab === "assistant" ? (
              <AssistantPane
                assistantStore={assistantStore}
                onModeChange={handleModeChange}
                onSend={handleSend}
              />
            ) : (
              <NotesPanel
                papers={workspaceStore.getState().papers.map(p => ({ id: p.id, title: p.title }))}
                notesStore={notesStore}
                onJumpToNote={(_paperId, _filePath, pageNo) => {
                  setReaderPage(pageNo);
                }}
                paperPaths={paperFilePaths}
                refreshKey={notesRefreshKey}
              />
            )}
          </div>
        </section>
      </div>
      <SelectionMenu
        visible={selMenuVisible}
        x={selMenuPos.x}
        y={selMenuPos.y}
        hasExistingHighlight={(() => {
          if (!selBbox) return false;
          const activeId = workspaceStore.getState().activePaperId;
          if (!activeId) return false;
          try {
            const sel = JSON.parse(selBbox) as { x: number; y: number; width: number; height: number };
            const paperHLs = readerHighlights.get(activeId) || [];
            return paperHLs.some(h => {
              if (h.pageNo !== selPageNo) return false;
              try {
                const b = JSON.parse(h.bbox) as { x: number; y: number; width: number; height: number };
                return !(sel.x + sel.width < b.x || b.x + b.width < sel.x ||
                         sel.y + sel.height < b.y || b.y + b.height < sel.y);
              } catch { return false; }
            });
          } catch { return false; }
        })()}
        onHighlight={() => {
          const activeId = workspaceStore.getState().activePaperId;
          if (!activeId) return;
          const h: Highlight = { id: `hl-${Date.now()}`, pageNo: selPageNo, bbox: selBbox ?? "{}", color: "#ffeb3b" };
          setReaderHighlights(prev => {
            const next = new Map(prev);
            const paperHighlights = [...(next.get(activeId) || []), h];
            next.set(activeId, paperHighlights);
            return next;
          });
          setSelMenuVisible(false);
        }}
        onRemoveHighlight={() => {
          const activeId = workspaceStore.getState().activePaperId;
          if (!activeId || !selBbox) return;
          try {
            const sel = JSON.parse(selBbox) as { x: number; y: number; width: number; height: number };
            setReaderHighlights(prev => {
              const next = new Map(prev);
              const paperHLs = (next.get(activeId) || []).filter(h => {
                if (h.pageNo !== selPageNo) return true; // keep different page highlights
                try {
                  const b = JSON.parse(h.bbox) as { x: number; y: number; width: number; height: number };
                  return (sel.x + sel.width < b.x || b.x + b.width < sel.x ||
                          sel.y + sel.height < b.y || b.y + b.height < sel.y);
                } catch { return true; }
              });
              next.set(activeId, paperHLs);
              return next;
            });
          } catch {}
          setSelMenuVisible(false);
        }}
        onAnnotate={handleAnnotate}
        onCopy={() => {
          navigator.clipboard.writeText(selText).catch(() => {});
          setSelMenuVisible(false);
        }}
      />
      {pendingAnnotate && (
        <div className="annotate-modal-overlay" onClick={() => { setPendingAnnotate(false); setAnnotateText(""); setAnnotateGroupId(""); setNewGroupInput(""); }}>
          <div className="annotate-modal" onClick={e => e.stopPropagation()}>
            <h4>添加批注</h4>
            <p className="annotate-selected-text">"{selText.slice(0, 100)}"</p>
            <select value={annotateGroupId} onChange={e => setAnnotateGroupId(e.target.value)}>
              <option value="">-- 选择或创建分组 --</option>
              {modalGroups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                placeholder="新分组名称"
                value={newGroupInput}
                onChange={e => setNewGroupInput(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === "Enter" && newGroupInput.trim()) {
                    const activeId = workspaceStore.getState().activePaperId;
                    if (!activeId) return;
                    const g = await notesStore.loadGroupsForPaper(activeId).then(() =>
                      notesStore.addGroup(activeId, newGroupInput.trim())
                    );
                    setAnnotateGroupId(g.id);
                    setModalGroups(prev => [...prev, { id: g.id, name: g.name }]);
                    setNewGroupInput("");
                  }
                }}
                style={{ flex: 1 }}
              />
            </div>
            <textarea
              rows={4}
              placeholder="输入批注内容..."
              value={annotateText}
              onChange={e => setAnnotateText(e.target.value)}
            />
            <div className="annotate-modal-actions">
              <button onClick={() => { setPendingAnnotate(false); setAnnotateText(""); setAnnotateGroupId(""); setNewGroupInput(""); }}>取消</button>
              <button onClick={async () => {
                const activeId = workspaceStore.getState().activePaperId;
                if (!activeId) return;
                let gid = annotateGroupId;
                if (!gid) {
                  const g = await notesStore.addGroup(activeId, newGroupInput.trim() || "默认分组");
                  gid = g.id;
                }
                await notesStore.addNote(gid, activeId, selText, annotateText, selPageNo, selBbox);
                setPendingAnnotate(false);
                setAnnotateText("");
                setAnnotateGroupId("");
                setNewGroupInput("");
                setNotesRefreshKey(k => k + 1);
                refresh();
              }} disabled={!annotateText.trim()}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
