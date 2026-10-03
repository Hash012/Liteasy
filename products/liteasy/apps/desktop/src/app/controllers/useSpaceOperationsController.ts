import { useRef, useState } from "react";
import type { AccountSession } from "../features/account/account.types";
import { accountActorStorageKey } from "../features/account/accountSessionBinding";
import { getAccountSessionGeneration } from "../features/account/accountSessionStorage";
import type { PublicationActorBinding } from "../features/forum/publicationActorBinding";
import type { Paper } from "../features/workspace/workspace.types";
import type { AgentArtifactResult } from "../features/artifacts/artifact.types";
import { loadPdfNotes } from "../features/notes/pdfNotesSource";
import { projectPdfPublication, projectThinPublication, projectTransfer, type SpaceOperation, type TransferOperationEvent } from "../features/spaces/spaceOperations";
import type { CloudLibraryScope } from "../features/library/cloudLibraryStorageClient";
import type { PdfAnnotationV2 } from "../features/pdf/pdfAnnotationStorage";

/** A bounded display projection over domain receipts. Refresh never sends or retries a mutation. */
export function useSpaceOperationsController(input: {
  session: AccountSession | null; endpoint: string; getActorBinding(): PublicationActorBinding | undefined;
  getPapers(): Paper[]; listArtifacts(): Promise<AgentArtifactResult[]>;
  openAnnotation(paper: Paper, annotation: PdfAnnotationV2): void; openArtifact(id: string): void;
  openLibrary(scope?: CloudLibraryScope): void;
}) {
  const actorKey = accountActorStorageKey(input.session, input.endpoint);
  const generation = getAccountSessionGeneration();
  const key = JSON.stringify([actorKey, input.endpoint, generation]);
  const latest = useRef({ input, key, actorKey, generation }); latest.current = { input, key, actorKey, generation };
  const [state, setState] = useState<{ key: string; rows: SpaceOperation[]; busy: boolean; message: string }>({ key, rows: [], busy: false, message: "" });
  const [transfers, setTransfers] = useState<{ key: string; events: TransferOperationEvent[] }>({ key, events: [] });
  const requestId = useRef(0);
  function reportTransfer(event: TransferOperationEvent) {
    if (event.actorKey !== latest.current.actorKey || event.generation !== latest.current.generation || latest.current.key !== key) return;
    setTransfers((previous) => ({ key, events: [event, ...(previous.key === key ? previous.events : []).filter((item) => item.id !== event.id)].slice(0, 30) }));
  }
  async function refresh() {
    const request = ++requestId.current, captured = latest.current;
    const current = () => latest.current.key === captured.key && getAccountSessionGeneration() === captured.generation && requestId.current === request;
    setState({ key: captured.key, rows: [], busy: true, message: "" });
    if (!captured.actorKey) { setState({ key: captured.key, rows: [], busy: false, message: "本机阅读与笔记可直接使用；登录不会自动上传。" }); return; }
    const actor = captured.input.getActorBinding();
    let failures = 0;
    const results = await Promise.allSettled([loadPdfNotes(captured.input.getPapers(), () => { failures++; }), captured.input.listArtifacts()]);
    if (!current()) return;
    const rows: SpaceOperation[] = [];
    if (results[0].status === "fulfilled") for (const note of results[0].value) {
      const row = projectPdfPublication({ id: note.key, title: note.title, publication: note.annotation?.publication, actor });
      if (row && note.paper && note.annotation) rows.push({ ...row, open: () => { if (current()) captured.input.openAnnotation(note.paper!, note.annotation!); } });
    }
    if (results[1].status === "fulfilled") for (const artifact of results[1].value) for (const annotation of artifact.thinReadingDocument?.annotations ?? []) {
      const row = projectThinPublication({ id: `${artifact.artifactId}:${annotation.id}`, title: artifact.title, annotation, actor });
      if (row) rows.push({ ...row, open: () => { if (current()) captured.input.openArtifact(artifact.artifactId); } });
    }
    setState({ key: captured.key, rows, busy: false, message: failures || results.some((result) => result.status === "rejected") ? "部分记录暂不可读取，请刷新重试；已有发布状态没有改变。" : rows.length ? "已读取当前账号的发布记录。网络结果仍以原操作回执为准。" : "当前账号暂无可显示的发布操作。" });
  }
  const transferRows = transfers.key === key ? transfers.events.map((event) => ({ ...projectTransfer(event), open: () => { if (latest.current.key === key) latest.current.input.openLibrary(event.target); } })) : [];
  return { rows: [...transferRows, ...(state.key === key ? state.rows : [])], busy: state.key === key && state.busy,
    message: state.key === key ? state.message : "", refresh, reportTransfer };
}
export type SpaceOperationsModel = Pick<ReturnType<typeof useSpaceOperationsController>, "rows" | "busy" | "message" | "refresh">;
