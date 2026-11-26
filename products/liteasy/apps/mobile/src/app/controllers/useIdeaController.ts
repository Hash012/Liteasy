import { useCallback, useEffect, useRef, useState } from "react";
import { libraryRepository } from "../features/library/libraryRepository";
import { createIdeaDraft, readIdeaDrafts, saveIdeaDraft, type IdeaDraft } from "../features/ideas/ideaDrafts";
import { submitIdea } from "../features/ideas/ideaSubmission";
import type { SharedCapture } from "../features/capture/shareInbox";
import type { AccountStatus } from "../features/account/accountClient";

export function useIdeaController(scope: string, account: AccountStatus) {
  const repository = libraryRepository();
  const [drafts, setDrafts] = useState<IdeaDraft[]>([]); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const running = useRef(false);
  const refresh = useCallback(async () => { const version = epoch.current; const values = await readIdeaDrafts(repository, scope); if (version === epoch.current) setDrafts(values); }, [repository, scope]);
  useEffect(() => { epoch.current++; setDrafts([]); setError(""); setNotice(""); setBusy(false); void refresh().catch((reason) => setError(String(reason))); return () => { epoch.current++; }; }, [refresh]);
  async function run(operation: () => Promise<string | void>) {
    if (running.current) return false;
    running.current = true;
    const version = epoch.current; setBusy(true); setError(""); setNotice("");
    try { const message = await operation(); if (version === epoch.current) { await refresh(); setNotice(message ?? "本机已保存"); } return true; }
    catch (reason) { if (version === epoch.current) { await refresh(); setError(reason instanceof Error ? reason.message : "操作未完成，草稿仍保留。"); } return false; }
    finally { running.current = false; if (version === epoch.current) setBusy(false); }
  }
  return { drafts: drafts.filter((draft) => draft.ownerScope === scope), busy, error, notice, account,
    create: () => createIdeaDraft(scope),
    capture: (capture: SharedCapture) => run(async () => {
      if ((await readIdeaDrafts(repository, scope)).some((draft) => draft.shareId === capture.id)) return "该分享已有本机 Idea 草稿。";
      await saveIdeaDraft(repository, createIdeaDraft(scope, capture));
    }),
    save: (draft: IdeaDraft) => run(async () => { if (draft.ownerScope !== scope) throw new Error("草稿账号已变化。"); if (draft.pending || draft.receipt) throw new Error("已提交内容保持原样，请新建草稿记录修改。"); await saveIdeaDraft(repository, { ...draft, updatedAt: new Date().toISOString() }); }),
    submit: (draft: IdeaDraft) => run(async () => { await submitIdea(draft, account, repository); return "云端已保存"; }),
    copyToAccount: (draft: IdeaDraft) => run(async () => {
      if (scope !== "local" || !account.subject || account.scope === "local") throw new Error("请先登录目标账号。");
      await saveIdeaDraft(repository, { ...draft, id: crypto.randomUUID(), ownerScope: account.scope, pending: undefined, receipt: undefined });
      return "已复制为当前账号的本机草稿，请切换到该账号草稿后明确提交。";
    })
  };
}
