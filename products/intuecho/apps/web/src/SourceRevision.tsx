import { Button } from "@fluentui/react-components";
import type { CommunitySourceReference } from "@intuecho/contracts";
import { useEffect, useRef, useState } from "react";
import { communityApi } from "./communityApi";
import { getIdentitySessionGeneration } from "./identityClient";
import { desktopSourceUrl } from "./reading-group/readingGroup";

export function SourceRevision({ reference }: { reference: CommunitySourceReference }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof communityApi.sourceRevision>>>();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  const current = useRef(reference);
  current.current = reference;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setResult(undefined); setStatus(""); }, [reference.sourceNamespace, reference.sourceId, reference.revision]);
  async function read() {
    const requested = reference;
    const generation = getIdentitySessionGeneration();
    const stillCurrent = () => mounted.current && generation === getIdentitySessionGeneration() && current.current === requested;
    setPending(true); setResult(undefined); setStatus("");
    try {
      const value = await communityApi.sourceRevision(requested);
      if (!stillCurrent()) return;
      if (value.sourceId !== requested.sourceId || value.sourceNamespace !== requested.sourceNamespace || value.revision !== requested.revision) throw new Error("来源版本回执不一致。");
      setResult(value);
    } catch { if (stillCurrent()) setStatus("无法访问此来源版本；来源可能已撤回、权限已变化或网络暂不可用。"); }
    finally { if (stillCurrent()) setPending(false); }
  }
  return <section aria-label={`来源 ${reference.sourceId} 修订 ${reference.revision}`}>
    <p>{{ "intuecho.annotation": "批注", "intuecho.reply": "讨论回复", "intuecho.literature": "文献" }[reference.sourceNamespace]} · {reference.sourceId} · 引用修订 {reference.revision}{reference.locator?.page ? ` · 第 ${reference.locator.page} 页` : ""}</p>
    <Button type="button" disabled={pending} onClick={() => void read()}>{pending ? "正在核对来源" : "核对引用版本"}</Button>
    <a href={desktopSourceUrl(reference)}>在 Liteasy 打开此来源版本</a>
    {result && <><p>{result.historical ? `历史引用：修订 ${result.revision}；当前修订 ${result.currentRevision}` : `与当前修订 ${result.currentRevision} 一致`}</p>{result.body && <p className="reading-group-body">{result.body}</p>}{result.literature && <p>{result.literature.title}</p>}</>}
    {status && <p role="status">{status}</p>}
  </section>;
}
