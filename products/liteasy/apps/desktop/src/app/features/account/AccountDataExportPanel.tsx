import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner } from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import type { AccountSession } from "./account.types";
import { accountActorStorageKey } from "./accountSessionBinding";
import { createAccountDataExportClient, type AccountDataExportPlan } from "./accountDataExport";

export function AccountDataExportPanel({ session, createClient = createAccountDataExportClient }: {
  session: AccountSession | null;
  createClient?: typeof createAccountDataExportClient;
}) {
  const endpoint = session?.endpoint ?? "";
  const endpointRef = useRef(endpoint);
  endpointRef.current = endpoint;
  const clientRef = useRef<ReturnType<typeof createAccountDataExportClient>>();
  if (!clientRef.current) clientRef.current = createClient({ getEndpoint: () => endpointRef.current });
  const active = useRef<AbortController>();
  const [plan, setPlan] = useState<AccountDataExportPlan>();
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    active.current?.abort();
    active.current = undefined;
    setPlan(undefined);
    setSelection([]);
    setBusy(false);
    setMessage("");
    setError("");
    return () => { active.current?.abort(); active.current = undefined; };
  }, [endpoint, session?.sessionId, session?.issuer, session?.userId]);

  function cancel() {
    active.current?.abort();
    active.current = undefined;
    setPlan(undefined);
    setBusy(false);
    setMessage("已取消，未下载资料包。");
    setError("");
  }
  async function run(operation: (controller: AbortController) => Promise<void>) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    setMessage("");
    try { await operation(controller); }
    catch (failure) {
      if (active.current === controller && !controller.signal.aborted) {
        setPlan(undefined);
        setError(failure instanceof Error ? failure.message : "导出失败，未下载资料包。");
      }
    } finally {
      if (active.current === controller) { active.current = undefined; setBusy(false); }
    }
  }
  async function prepare() {
    await run(async (controller) => {
      const next = await clientRef.current!.prepare(controller.signal);
      if (active.current !== controller || controller.signal.aborted) return;
      setSelection([]);
      setPlan(next);
    });
  }
  async function exportSelected() {
    if (!plan) return;
    await run(async (controller) => {
      const receipt = await clientRef.current!.export(plan, [...selection], controller.signal);
      if (active.current !== controller || controller.signal.aborted) return;
      setPlan(undefined);
      setMessage(`已发起 ZIP 下载：${receipt.documentCount} 条文献清单、云画像及 ${receipt.artifactCount} 份所选产物。`);
    });
  }
  const available = Boolean(accountActorStorageKey(session, endpoint));
  return <section aria-label="本人云资料导出">
    <h3>本人云资料包</h3>
    <p className="profile-muted">下载当前云账号的文献清单、云画像和所选产物正文。PDF、本机笔记、组织资料与 Intuecho 数据不包含在此包中。</p>
    {!available ? <p className="profile-muted">登录已验证的云账号后可预览导出。</p> : null}
    <Button icon={<ArrowDownloadRegular />} disabled={!available || busy} onClick={() => void prepare()}>预览本人云资料包</Button>
    {busy ? <><Spinner size="tiny" label="正在核实本人云资料" /><Button onClick={cancel}>取消导出</Button></> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <Dialog open={Boolean(plan)} onOpenChange={(_, data) => { if (!data.open) cancel(); }}>
      <DialogSurface><DialogBody>
        <DialogTitle>确认导出本人云资料包</DialogTitle>
        <DialogContent>
          {plan ? <>
            <p>云账号：{plan.subject} · 服务：{plan.endpoint}</p>
            <p>包含 {plan.documentCount} 条当前文献清单、云画像；按下方选择加入产物正文和版本出处。预览在 5 分钟后失效，下载前会重新核实身份与来源。</p>
            <p>不包含：{plan.exclusions.join("、")}。这不是全产品账号数据备份。</p>
            <div aria-label="可选云产物">
              {plan.artifacts.length ? plan.artifacts.map((artifact) => <div key={artifact.artifactId}>
                <Checkbox label={artifact.title} disabled={busy || Boolean(artifact.excludedReason)}
                  checked={selection.includes(artifact.artifactId)} onChange={(_, data) => setSelection((current) => data.checked
                    ? [...current, artifact.artifactId] : current.filter((id) => id !== artifact.artifactId))} />
                {artifact.excludedReason ? <span>未纳入：{artifact.excludedReason}</span> : null}
              </div>) : <p>暂无可选产物。</p>}
            </div>
          </> : null}
        </DialogContent>
        <DialogActions><Button onClick={cancel}>取消</Button>
          <Button appearance="primary" disabled={busy} onClick={() => void exportSelected()}>导出所选资料（{selection.length} 份产物）</Button>
        </DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </section>;
}
