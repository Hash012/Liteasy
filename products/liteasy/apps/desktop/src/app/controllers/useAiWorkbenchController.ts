import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactType } from "../features/artifacts/artifact.types";
import type { Paper } from "../features/workspace/workspace.types";

type Input = {
  scopeId: string;
  papers: Paper[];
  openedPapers: Paper[];
  activePaperId?: string;
  startAnalysis(type: ArtifactType, papers: Paper[], options?: import("../features/artifacts/useArtifactActions").AgentArtifactGenerationOptions): string;
};

/** A confirmed selection belongs to this launch only; library selection never changes it. */
export function useAiWorkbenchController(input: Input) {
  const [openedScope, setOpenedScope] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState<Paper[] | null>(null);
  const [message, setMessage] = useState("");
  const launching = useRef(false);
  const papers = useMemo(() => [...new Map([...input.openedPapers, ...input.papers].map((paper) => [paper.id, paper])).values()], [input.openedPapers, input.papers]);
  useEffect(() => { setOpenedScope(undefined); setSelectedIds([]); setConfirmed(null); setMessage(""); }, [input.scopeId]);
  const available = new Set(papers.filter((paper) => paper.sourcePath).map((paper) => paper.id));
  const selectionValid = selectedIds.length > 0 && selectedIds.every((id) => available.has(id));
  const confirmedValid = Boolean(confirmed?.length && confirmed.every((paper) => available.has(paper.id)));
  function revise(ids: string[]) {
    setSelectedIds([...new Set(ids)].filter((id) => available.has(id)));
    setConfirmed(null); setMessage("");
  }
  return {
    open: openedScope === input.scopeId, papers, selectedIds, confirmed: confirmedValid ? confirmed : null,
    message, selectionValid,
    show() {
      revise(input.activePaperId ? [input.activePaperId] : []);
      setOpenedScope(input.scopeId);
    },
    close() { setOpenedScope(undefined); },
    toggle(id: string) { revise(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]); },
    includeOpened() { revise([...selectedIds, ...input.openedPapers.map((paper) => paper.id)]); },
    clear() { revise([]); },
    confirm() {
      if (!selectionValid) { setMessage("请选择可读取全文的论文，再确认本次任务的文献。"); return; }
      setConfirmed(selectedIds.map((id) => ({ ...papers.find((paper) => paper.id === id)! })));
      setMessage("");
    },
    start(type: ArtifactType, systemPrompt?: string) {
      if (!confirmedValid || !confirmed || openedScope !== input.scopeId || launching.current) return;
      launching.current = true;
      try {
        // Thin reading is one document per task; other capabilities use the entire confirmed set.
        const launch = (papers: Paper[]) => systemPrompt === undefined ? input.startAnalysis(type, papers) : input.startAnalysis(type, papers, { systemPrompt });
        const messages = type === "thin_reading"
          ? confirmed.map((paper) => `《${paper.title}》：${launch([paper])}`)
          : [launch(confirmed)];
        setMessage(messages.join("\n"));
      } catch (error) { setMessage(error instanceof Error ? error.message : "任务启动失败，请重试。"); }
      finally { launching.current = false; }
    }
  };
}
export type AiWorkbenchModel = ReturnType<typeof useAiWorkbenchController>;
