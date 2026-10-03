import { Button } from "@fluentui/react-components";
import type { CommunitySourceReference } from "@intuecho/contracts";
import { useEffect, useRef, useState } from "react";
import { communityApi } from "./communityApi";
import { getIdentitySessionGeneration } from "./identityClient";
import { desktopSourceUrl } from "./reading-group/readingGroup";
import "./source-revision.css";

type SourceResult = Awaited<ReturnType<typeof communityApi.sourceRevision>>;

export function SourceRevision({ reference }: { reference: CommunitySourceReference }) {
  const binding = JSON.stringify([getIdentitySessionGeneration(), reference]);
  return <SourceRevisionContent key={binding} reference={reference} />;
}

function SourceRevisionContent({ reference }: { reference: CommunitySourceReference }) {
  const [result, setResult] = useState<SourceResult>();
  const [comparison, setComparison] = useState<SourceResult>();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  const referenceKey = JSON.stringify(reference);
  const current = useRef(referenceKey);
  current.current = referenceKey;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setResult(undefined); setComparison(undefined); setStatus(""); }, [reference.sourceNamespace, reference.sourceId, reference.revision]);
  function verify(value: SourceResult, requested: CommunitySourceReference) {
    if (value.sourceId !== requested.sourceId || value.sourceNamespace !== requested.sourceNamespace || value.revision !== requested.revision ||
      !Number.isSafeInteger(value.currentRevision) || value.currentRevision < value.revision) throw new Error("来源版本回执不一致。");
  }
  async function read(compareCurrent = false) {
    const requested = reference;
    const generation = getIdentitySessionGeneration();
    const stillCurrent = () => mounted.current && generation === getIdentitySessionGeneration() && current.current === JSON.stringify(requested);
    setPending(true); setResult(undefined); setComparison(undefined); setStatus("");
    try {
      const value = await communityApi.sourceRevision(requested);
      if (!stillCurrent()) return;
      verify(value, requested);
      if (compareCurrent && value.currentRevision !== value.revision) {
        const currentReference = { ...requested, revision: value.currentRevision };
        const latest = await communityApi.sourceRevision(currentReference);
        if (!stillCurrent()) return;
        verify(latest, currentReference);
        setComparison(latest);
      }
      setResult(value);
    } catch { if (stillCurrent()) setStatus("无法访问此来源版本；来源可能已撤回、权限已变化或网络暂不可用。"); }
    finally { if (stillCurrent()) setPending(false); }
  }
  return <section aria-label={`来源 ${reference.sourceId} 修订 ${reference.revision}`}>
    <p>{{ "intuecho.annotation": "批注", "intuecho.reply": "讨论回复", "intuecho.literature": "文献" }[reference.sourceNamespace]} · {reference.sourceId} · 引用修订 {reference.revision}{reference.locator?.page ? ` · 第 ${reference.locator.page} 页` : ""}</p>
    <Button type="button" disabled={pending} onClick={() => void read()}>{pending ? "正在核对来源" : "核对引用版本"}</Button>
    <a href={desktopSourceUrl(reference)}>在 Liteasy 打开此来源版本</a>
    {result && <><p>{result.historical ? `历史引用：修订 ${result.revision}；当前修订 ${result.currentRevision}` : `与当前修订 ${result.currentRevision} 一致`}</p>
      {result.currentRevision !== reference.revision && <Button type="button" disabled={pending} onClick={() => void read(true)}>对照当前版本</Button>}
      <div className={comparison ? "source-revision-comparison" : ""}>
        <section aria-label={`引用版本 ${result.revision}`}><strong>引用版本 · 修订 {result.revision}</strong>{result.body && <p className="reading-group-body">{result.body}</p>}{result.literature && <p>{result.literature.title}</p>}</section>
        {comparison && <section aria-label={`核对版本 ${comparison.revision}`}><strong>核对时的当前版本 · 修订 {comparison.revision}</strong>{comparison.body && <p className="reading-group-body">{comparison.body}</p>}{comparison.literature && <p>{comparison.literature.title}</p>}{comparison.historical && <p>核对期间来源又有更新，可再次对照当前版本。</p>}</section>}
      </div>
      {comparison && <p>原引用仍固定在修订 {reference.revision}。对照不会改写你的引用或个人复盘。</p>}
    </>}
    {status && <p role="status">{status}</p>}
  </section>;
}
