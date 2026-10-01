import { useCallback, useEffect, useRef, useState } from "react";
import { accountClient, guestAccount, type AccountStatus } from "../features/account/accountClient";
import { notifyLibraryChanged } from "../features/library/libraryEvents";

export function useAccountController() {
  const [account, setAccount] = useState<AccountStatus>(guestAccount);
  const [ready, setReady] = useState(false);
  const [guest, setGuest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const scope = useRef("local");
  const update = useCallback((next: AccountStatus) => {
    if (!mounted.current) return;
    if (scope.current !== next.scope) { setGuest(false); setNotice(""); scope.current = next.scope; }
    setAccount(next);
    setReady(true);
  }, []);
  const refresh = useCallback(async () => { update(await accountClient.status()); }, [update]);
  useEffect(() => {
    mounted.current = true;
    const check = () => { if (document.visibilityState !== "hidden") void refresh().catch((reason) => { if (mounted.current) setError(String(reason)); }); };
    check(); window.addEventListener("focus", check); const timer = setInterval(check, 2500);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [refresh]);
  const run = async (operation: () => Promise<AccountStatus>) => {
    setBusy(true); setError(""); setNotice("");
    try { update(await operation()); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const copyGuest = () => run(async () => {
    const original = scope.current;
    const result = await accountClient.copyGuest();
    const next = await accountClient.status();
    notifyLibraryChanged(original);
    if (mounted.current && next.scope === original) { setGuest(false); setNotice(`已复制 ${result.copied} 份资料，跳过 ${result.skipped} 份重复资料。本机原件仍保留。`); }
    return next;
  });
  return { account, ready, refresh: () => refresh().catch((reason) => setError(String(reason))), busy, error: error || account.error || "", notice, scope: guest ? "local" : account.scope, guest,
    setGuest, available: accountClient.available(), begin: (url: string) => run(() => accountClient.begin(url)),
    cancel: () => run(accountClient.cancel), logout: () => run(accountClient.logout), copyGuest };
}
