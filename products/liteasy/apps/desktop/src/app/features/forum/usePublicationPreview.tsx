import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { useEffect, useRef, useState } from "react";
import { normalizePublicationActorBinding, samePublicationActor, type PublicationActorBinding } from "./publicationActorBinding";

export type PublicationPreview = {
  title: string;
  recipient: string;
  body: string;
  excerpts?: readonly { label: string; text: string }[];
  action?: string;
};

type Pending = { preview: PublicationPreview; actor: PublicationActorBinding; resolve(value: boolean): void };

/** A local preview only. No handoff, upload or publication is started by opening it. */
export function usePublicationPreview(getActor: () => PublicationActorBinding | undefined) {
  const actorGetter = useRef(getActor);
  actorGetter.current = getActor;
  const pendingRef = useRef<Pending | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const actorKey = JSON.stringify(getActor());
  function finish(approved: boolean) {
    const request = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    request?.resolve(approved && samePublicationActor(request.actor, actorGetter.current()));
  }
  useEffect(() => { if (pendingRef.current && !samePublicationActor(pendingRef.current.actor, actorGetter.current())) finish(false); }, [actorKey]);
  useEffect(() => () => { pendingRef.current?.resolve(false); pendingRef.current = null; }, []);
  function confirm(preview: PublicationPreview): Promise<boolean> {
    pendingRef.current?.resolve(false);
    const actor = normalizePublicationActorBinding(actorGetter.current());
    if (!actor) return Promise.resolve(false);
    return new Promise((resolve) => {
      const request = { actor, preview: structuredClone(preview), resolve };
      pendingRef.current = request;
      setPending(request);
    });
  }
  return {
    confirm,
    dialog: <Dialog open={Boolean(pending)} onOpenChange={(_, data) => { if (!data.open) finish(false); }}>
      <DialogSurface><DialogBody><DialogTitle>{pending?.preview.title ?? "发送预览"}</DialogTitle>
        <DialogContent>
          <p><strong>接收范围：</strong>{pending?.preview.recipient}</p>
          <p>下面仅列出本次操作涉及的内容。不会附带全文 PDF、其他笔记、聊天记录或本机路径。</p>
          {pending?.preview.body && <section aria-label="批注正文" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{pending.preview.body}</section>}
          {pending?.preview.excerpts?.map((excerpt, index) => <section key={index} style={{ marginBlock: 12 }}><strong>{excerpt.label}</strong><blockquote style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{excerpt.text}</blockquote></section>)}
          <p>发送身份：当前登录账号 · {pending?.actor.subject}</p>
        </DialogContent>
        <DialogActions><Button onClick={() => finish(false)}>取消</Button><Button appearance="primary" onClick={() => finish(true)}>{pending?.preview.action ?? "确认发送"}</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  };
}
