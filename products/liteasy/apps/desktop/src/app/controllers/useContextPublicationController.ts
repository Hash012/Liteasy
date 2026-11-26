import { useEffect, useRef, useState } from "react";
import type { AccountSession } from "../features/account/account.types";
import { accountActorStorageKey } from "../features/account/accountSessionBinding";
import { contextFailure, createPersonalContextClient, type ContextEntryInput, type ContextWrite } from "../features/context-cloud/contextClient";
import type { ContextPublicationModel, ContextSelection } from "../features/research-context/contextPublication";
import { sha256Hex } from "../features/paper-identity/paperIdentity";

export function useContextPublicationController(session: AccountSession | null, createClient = createPersonalContextClient) {
  const [selection, setSelection] = useState<ContextSelection>();
  const [scope, setScope] = useState("personal"); const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [basis, setBasis] = useState<ContextEntryInput["basis"]>("user_authored");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const pending = useRef<{ input: ContextWrite; startedAt: number }>();
  const epoch = useRef(0);
  const openedBinding = useRef("");
  const binding = accountActorStorageKey(session, session?.endpoint ?? "");
  const sessionKey = `${binding ?? "guest"}:${session?.sessionId ?? ""}`;
  useEffect(() => { epoch.current++; setSelection(undefined); setBody(""); setTitle(""); setBusy(false); setError(""); setNotice(""); pending.current = undefined; return () => { epoch.current++; }; }, [binding, session?.sessionId]);
  function open(value: ContextSelection) {
    openedBinding.current = sessionKey;
    epoch.current++; pending.current = undefined; setSelection({ ...value, source: { ...value.source, capturedAt: value.source.capturedAt ?? new Date().toISOString() } }); setTitle(Array.from(value.title).slice(0, 160).join("")); setBody(value.text); setBasis(value.basis); setError(""); setNotice("");
  }
  const model: ContextPublicationModel = { selection: openedBinding.current === sessionKey ? selection : undefined, scope, title, body, basis, busy, error, notice, setScope, setTitle, setBody, setBasis,
    close: () => { epoch.current++; setSelection(undefined); pending.current = undefined; setBusy(false); },
    save: async () => {
      if (!selection || !session || !binding) { setError("请先登录云账号。"); return; }
      const generation = epoch.current; setBusy(true); setError("");
      try {
        const client = createClient(session);
        const contentHash = await sha256Hex(selection.text);
        const source = { ...selection.source, contentHash };
        const key = await sha256Hex(JSON.stringify({ origin: source.origin, sourceId: source.sourceId, contentHash, scope,
          ...(selection.kind === "profile" ? {} : { title, body, basis }) }));
        const page = await client.list({ scopes: [scope], tags: [key] });
        if (page.entries.length) { if (generation === epoch.current) setNotice(`该来源版本已发布 · ${page.entries[0].id} · 版本 ${page.entries[0].revision}。云端修正已保留。`); return; }
        const entry: ContextEntryInput = { scopeKey: scope, kind: selection.kind ?? "understanding", title, bodyMarkdown: body, basis, tags: [key], sourceRefs: [source], attributes: { publication: "selected-source" } };
        const old = pending.current;
        if (old && Date.now() - old.startedAt >= 604800_000) throw new Error("context_retry_expired");
        if (!old || (old.input.action === "create" && JSON.stringify(old.input.entry) !== JSON.stringify(entry))) pending.current = { startedAt: Date.now(), input: { schemaVersion: "liteasy.context-write/v1", operationId: crypto.randomUUID(), action: "create", entry } };
        const receipt = await client.write(pending.current!.input);
        if (generation === epoch.current) { pending.current = undefined; setNotice(`云端已保存 · ${receipt.entryId} · 版本 ${receipt.revision}`); }
      } catch (failure) { if (generation === epoch.current) setError(contextFailure(failure)); }
      finally { if (generation === epoch.current) setBusy(false); }
    }
  };
  return { open, model };
}
