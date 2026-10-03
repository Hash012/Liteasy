import type { ObjectRepository } from "../features/objects/objectRepository";
import { refOf, type ObjectRef } from "../features/objects/object.types";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Spinner, Textarea } from "@fluentui/react-components";
import { isTauri } from "@tauri-apps/api/core";
import { getAccountSessionGeneration } from "../features/account/accountSessionStorage";
import { parseCommunitySourceLink, communitySourceLink, type CommunitySourceReference, type CommunitySourceRevision } from "../features/forum/communitySourceReference";
import type { ForumClient } from "../features/forum/forumClient";

export function useCommunitySourceController(input: {
  actorKey: string; client: Pick<ForumClient, "readCommunitySource">;
  repository: ObjectRepository; collect(ref: ObjectRef): Promise<void>; openNote(ref: ObjectRef): Promise<void>;
}) {
  const binding = `${input.actorKey}:${getAccountSessionGeneration()}`;
  const latest = useRef({ ...input, binding }); latest.current = { ...input, binding };
  const [state, setState] = useState<{ binding: string; reference: CommunitySourceReference; source?: CommunitySourceRevision; error?: string; busy?: boolean }>();
  const [reflection, setReflection] = useState("");
  const requestId = useRef(0);
  const saving = useRef<number>();
  async function open(link: string) {
    if (!link.startsWith("liteasy://community-sources/")) return;
    let reference: CommunitySourceReference;
    try { reference = parseCommunitySourceLink(link); } catch { return; }
    const request = ++requestId.current, captured = latest.current;
    setReflection(""); setState({ binding: captured.binding, reference, busy: true });
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
  const visible = state?.binding === binding ? state : undefined;
  const close = () => { ++requestId.current; setState(undefined); setReflection(""); };
  async function save() {
    if (!visible?.source || !reflection.trim() || latest.current.binding !== visible.binding || saving.current !== undefined) return;
    const captured = visible, request = requestId.current, text = reflection.trim();
    const current = () => latest.current.binding === captured.binding && requestId.current === request;
    saving.current = request;
    setState({ ...captured, busy: true, error: undefined });
    try {
      // Recheck current access at the explicit save, never use a withdrawn cached body.
      const source = await latest.current.client.readCommunitySource(captured.reference);
      if (!current()) return;
      const owner = latest.current;
      const sourceRef = { sourceNamespace: source.sourceNamespace, sourceId: source.sourceId, revision: source.revision, ...(source.locator ? { locator: source.locator } : {}) };
      const portableSource = source.visibility === "organization" && source.organizationId
        ? `---\nsourceNamespace: ${source.sourceNamespace}\nsourceId: ${JSON.stringify(source.sourceId)}\nrevision: ${source.revision}\norganizationId: ${JSON.stringify(source.organizationId)}\nsourcePolicy: organization-bound\n---\n\n` : "";
      const object = await owner.repository.create({ kind: "content.note", title: "社区阅读反思",
        sourceReferences: source.visibility === "organization" && source.organizationId ? [{ scopeType: "organization", scopeId: source.organizationId, paperId: `${source.sourceNamespace}:${source.sourceId}`, revision: source.revision }] : [],
        sourceResolution: source.visibility === "public" || source.sourceNamespace === "intuecho.literature" && source.literature || source.visibility === "organization" && source.organizationId ? undefined : "unavailable",
        content: { schema: "liteasy.note/v1", payload: {
        text: `${portableSource}${text}\n\n[来源 · 修订 ${source.revision}](${communitySourceLink(sourceRef)})\n\n<!-- liteasy-source: ${JSON.stringify(sourceRef)} -->`, origin: "user"
      } } });

      if (latest.current.binding !== captured.binding) return;
      await owner.collect(refOf(object));
      if (!current()) return;
      await owner.openNote(refOf(object));
      if (current()) close();
    } catch (error) {
      if (current()) setState({ binding: captured.binding, reference: captured.reference, error: error instanceof Error ? error.message : "笔记尚未保存，请重试。" });
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
        <Field label="带回个人笔记的想法"><Textarea value={reflection} onChange={(_, data) => setReflection(data.value)} /></Field>
        <p>仅保存你填写的想法与版本来源链接，不复制社区正文，也不覆盖已有笔记。以后读取来源仍需当前访问权限。</p>
      </> : null}
    </DialogContent><DialogActions><Button onClick={close}>关闭</Button>{visible?.source ? <Button appearance="primary" disabled={visible.busy || !reflection.trim()} onClick={() => void save()}>新建个人笔记</Button> : null}</DialogActions>
  </DialogBody></DialogSurface></Dialog> };
}
