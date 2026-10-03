import type { ObjectRepository } from "../features/objects/objectRepository";
import { refOf, type ObjectRef } from "../features/objects/object.types";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Select, Spinner, Textarea } from "@fluentui/react-components";
import { isTauri } from "@tauri-apps/api/core";
import { getAccountSessionGeneration } from "../features/account/accountSessionStorage";
import { parseCommunitySourceLink, communitySourceLink, type CommunitySourceReference, type CommunitySourceRevision } from "../features/forum/communitySourceReference";
import type { ForumClient } from "../features/forum/forumClient";
import { createReflectionDraft, reflectionDrafts, reflectionSourceKey, removeReflectionDraft, writeReflectionDraft, type CommunityReflectionDraft } from "../features/forum/communityReflectionDrafts";

type ReflectionWorkingCopy = { draft: CommunityReflectionDraft; text: string; saved: boolean };

export function useCommunitySourceController(input: {
  actorKey: string; client: Pick<ForumClient, "readCommunitySource">;
  repository: ObjectRepository; collect(ref: ObjectRef): Promise<void>; openNote(ref: ObjectRef): Promise<void>;
}) {
  const binding = `${input.actorKey}:${getAccountSessionGeneration()}`;
  const latest = useRef({ ...input, binding }); latest.current = { ...input, binding };
  const [state, setState] = useState<{ binding: string; reference: CommunitySourceReference; source?: CommunitySourceRevision; error?: string; busy?: boolean }>();
  const [reflection, setReflection] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const writerId = useRef(crypto.randomUUID());
  const drafts = useRef(new Map<string, ReflectionWorkingCopy>());
  const activeDraftKey = useRef("");
  const persistentOwner = () => JSON.stringify([latest.current.actorKey, latest.current.repository.scopeId]);
  const requestId = useRef(0);
  const saving = useRef<number>();
  function persistReflection(copy: ReflectionWorkingCopy, text: string) {
    copy.text = text;
    try {
      copy.draft = writeReflectionDraft(copy.draft, text, writerId.current);
      copy.saved = true; setDraftStatus("想法已保存到本机草稿。");
      return true;
    } catch (error) {
      copy.saved = false;
      setDraftStatus(error instanceof Error ? error.message : "想法尚未保存，请保留窗口。");
      return false;
    }
  }
  function editReflection(text: string) {
    const copy = drafts.current.get(activeDraftKey.current);
    if (!copy || copy.draft.owner !== persistentOwner()) return;
    setReflection(text);
    persistReflection(copy, text);
  }
  async function open(link: string) {
    if (!link.startsWith("liteasy://community-sources/")) return;
    let reference: CommunitySourceReference;
    try { reference = parseCommunitySourceLink(link); } catch { return; }
    const request = ++requestId.current, captured = latest.current;
    const owner = persistentOwner(), key = reflectionSourceKey(owner, reference);
    let copy = drafts.current.get(key);
    let storageError = "";
    if (!copy) {
      let saved: CommunityReflectionDraft | undefined;
      try { saved = reflectionDrafts(owner, reference)[0]; }
      catch { storageError = "暂时无法读取本机草稿。新想法仍可填写，请确认保存结果。"; }
      copy = { draft: saved ?? createReflectionDraft(owner, reference, writerId.current), text: saved?.text ?? "", saved: Boolean(saved) };
      drafts.current.set(key, copy);
    }
    activeDraftKey.current = key;
    setReflection(copy.text);
    setDraftStatus(storageError || (copy.saved && copy.text ? "已恢复本机草稿，引用修订保持不变。" : copy.text ? "想法尚未保存，请保留窗口。" : ""));
    setState({ binding: captured.binding, reference, busy: true });
    try {
      const source = await captured.client.readCommunitySource(reference);
      if (latest.current.binding === captured.binding && requestId.current === request) setState({ binding: captured.binding, reference, source });
    } catch (error) {
      if (latest.current.binding === captured.binding && requestId.current === request) setState({ binding: captured.binding, reference, error: error instanceof Error ? error.message : "来源无法访问，请核对登录与当前权限。" });
    }
  }
  const openRef = useRef(open); openRef.current = open;
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.("a[href]")?.getAttribute("href");
      if (link?.startsWith("liteasy://community-sources/")) { event.preventDefault(); void openRef.current(link); }
    };
    document.addEventListener("click", click);
    let stop: (() => void) | undefined, disposed = false;
    if (isTauri()) void import("@tauri-apps/plugin-deep-link").then(async ({ getCurrent, onOpenUrl }) => {
      const listener = await onOpenUrl((links) => links.forEach((link) => void openRef.current(link)));
      if (disposed) listener(); else stop = listener;
      const links = await getCurrent();
      if (!disposed) links?.forEach((link) => void openRef.current(link));
    }).catch(() => { /* Manual in-app links still work when native deep linking is unavailable. */ });
    return () => { disposed = true; stop?.(); document.removeEventListener("click", click); ++requestId.current; };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if ([...drafts.current.values()].some((copy) => copy.text && !copy.saved)) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  const visible = state?.binding === binding ? state : undefined;
  const copy = visible ? drafts.current.get(activeDraftKey.current) : undefined;
  let recoverable: CommunityReflectionDraft[] = [];
  try { if (visible) recoverable = reflectionDrafts(persistentOwner(), visible.reference); }
  catch { /* Loading/saving handlers report storage errors without breaking the dialog. */ }
  const close = () => {
    const current = drafts.current.get(activeDraftKey.current);
    if (current?.text && !current.saved && !persistReflection(current, current.text)) return;
    ++requestId.current; setState(undefined); setReflection("");
  };
  async function save() {
    if (!visible || !reflection.trim() || latest.current.binding !== visible.binding || saving.current !== undefined) return;
    const working = drafts.current.get(activeDraftKey.current);
    if (!working || working.draft.owner !== persistentOwner()) return;
    if (!working.saved && !persistReflection(working, reflection)) return;
    const snapshot = working.draft, key = activeDraftKey.current;
    const captured = visible, request = requestId.current, text = reflection.trim();
    const current = () => latest.current.binding === captured.binding && requestId.current === request;
    saving.current = request;
    const operationId = `community-reflection:${snapshot.id}:${snapshot.localRevision}`;
    let verifiedSource: CommunitySourceRevision | undefined;
    setState({ ...captured, busy: true, error: undefined });
    try {
      // Recheck current access at the explicit save, never use a withdrawn cached body.
      const source = await latest.current.client.readCommunitySource(snapshot.reference);
      if (!current()) return;
      verifiedSource = source;
      const owner = latest.current;
      const sourceRef = { sourceNamespace: source.sourceNamespace, sourceId: source.sourceId, revision: source.revision, ...(source.locator ? { locator: source.locator } : {}) };
      const portableSource = source.visibility === "organization" && source.organizationId
        ? `---\nsourceNamespace: ${source.sourceNamespace}\nsourceId: ${JSON.stringify(source.sourceId)}\nrevision: ${source.revision}\norganizationId: ${JSON.stringify(source.organizationId)}\nsourcePolicy: organization-bound\n---\n\n` : "";
      const object = await owner.repository.create({ kind: "content.note", title: "社区阅读反思",
        sourceReferences: source.visibility === "organization" && source.organizationId ? [{ scopeType: "organization", scopeId: source.organizationId, paperId: `${source.sourceNamespace}:${source.sourceId}`, revision: source.revision }] : [],
        sourceResolution: source.visibility === "public" || source.sourceNamespace === "intuecho.literature" && source.literature || source.visibility === "organization" && source.organizationId ? undefined : "unavailable",
        content: { schema: "liteasy.note/v1", payload: {
        text: `${portableSource}${text}\n\n[来源 · 修订 ${source.revision}](${communitySourceLink(sourceRef)})\n\n<!-- liteasy-source: ${JSON.stringify(sourceRef)} -->`, origin: "user"
      } } }, operationId);

      if (latest.current.binding !== captured.binding) return;
      await owner.collect(refOf(object));
      if (!current()) return;
      await owner.openNote(refOf(object));
      if (current()) {
        const latestDraft = drafts.current.get(key)?.draft;
        if (latestDraft?.id === snapshot.id && latestDraft.localRevision === snapshot.localRevision) {
          // A restored draft may still belong to a live editor in another window.
          // Keep that copy; cleanup must not race its writer or change retry identity.
          if (snapshot.writerId === writerId.current) {
            try { removeReflectionDraft(snapshot); } catch { /* A completed note must not be repeated because local cleanup failed. */ }
          }
          drafts.current.delete(key);
          close();
        } else setState({ ...captured, busy: false });
      }
    } catch (error) {
      if (current()) setState({ binding: captured.binding, reference: snapshot.reference, source: verifiedSource, busy: false, error: error instanceof Error ? error.message : "笔记尚未保存，请重试。" });
    } finally { if (saving.current === request) saving.current = undefined; }
  }
  return { open, dialog: <Dialog open={Boolean(visible)} onOpenChange={(_, data) => { if (!data.open) close(); }}><DialogSurface><DialogBody>
    <DialogTitle>社区来源 · 修订 {visible?.reference.revision}</DialogTitle><DialogContent>
      {visible?.busy ? <Spinner size="tiny" label="正在核对来源" /> : null}
      {visible?.error ? <p role="alert">{visible.error}</p> : null}
      {visible?.source ? <><p>{visible.source.historical ? `正在阅读引用时的历史修订 ${visible.source.revision}；当前为修订 ${visible.source.currentRevision}。` : `引用修订与当前修订一致：${visible.source.revision}。`}</p>
        {visible.source.locator?.page ? <p>定位：第 {visible.source.locator.page} 页{visible.source.locator.anchorHash ? " · 已保留段落定位" : ""}</p> : null}
        <pre style={{ whiteSpace: "pre-wrap", maxHeight: "35vh", overflow: "auto" }}>{visible.source.body ?? visible.source.literature?.title ?? "此来源仅有题录信息。"}</pre>
        {visible.source.historical ? <Button disabled={visible.busy} onClick={() => void open(communitySourceLink({ ...visible.reference, revision: visible.source!.currentRevision }))}>查看当前修订</Button> : null}
      </> : null}
      {visible && (visible.source || reflection) ? <><Field label="带回个人笔记的想法"><Textarea value={reflection} onChange={(_, data) => editReflection(data.value)} /></Field>
        {recoverable.length > 1 ? <Field label="本机保留的想法草稿"><Select value={copy?.draft.id} onChange={(event) => {
          const selected = recoverable.find((draft) => draft.id === event.target.value);
          if (!selected || (copy?.text && !copy.saved && !persistReflection(copy, copy.text))) return;
          drafts.current.set(activeDraftKey.current, { draft: selected, text: selected.text, saved: true });
          setReflection(selected.text); setDraftStatus("已恢复所选草稿，其他版本仍保留。");
        }}>{recoverable.map((draft) => <option key={draft.id} value={draft.id}>{new Date(draft.updatedAt).toLocaleString()} · 修订 {draft.reference.revision} · {draft.text.slice(0, 24) || "空白想法"}</option>)}</Select></Field> : null}
        {copy && reflection ? <p>想法引用修订 {copy.draft.reference.revision}；切换预览不会改写引用。</p> : null}
        {copy && visible.source && copy.draft.reference.revision !== visible.source.revision ? <Button disabled={visible.busy} onClick={() => {
          copy.draft = { ...copy.draft, reference: visible.reference };
          if (persistReflection(copy, reflection)) setDraftStatus(`已改为引用修订 ${visible.reference.revision}，原想法草稿仍保留。`);
        }}>以当前预览修订作为引用</Button> : null}
        {draftStatus ? <p role={copy?.saved ? "status" : "alert"}>{draftStatus}</p> : null}
        <p>仅保存你填写的想法与版本来源链接，不复制社区正文，也不覆盖已有笔记。以后读取来源仍需当前访问权限。</p>
      </> : null}
    </DialogContent><DialogActions><Button onClick={close}>关闭</Button>{visible && (visible.source || reflection) ? <Button appearance="primary" disabled={visible.busy || !reflection.trim()} onClick={() => void save()}>新建个人笔记</Button> : null}</DialogActions>
  </DialogBody></DialogSurface></Dialog> };
}
