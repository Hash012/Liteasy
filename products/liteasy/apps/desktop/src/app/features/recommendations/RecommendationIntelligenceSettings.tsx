import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Switch } from "@fluentui/react-components";
import { clearSemanticScope } from "../semantic-index/semanticIndexClient";
import { useRecommendationPreferences, saveRecommendationPreferences } from "./recommendationPreferences";
import { embedTexts, rerankTexts } from "../semantic-index/embeddingProvider";
import { deletePaperServiceKey, hasPaperServiceKey, savePaperServiceKey, validatePaperService } from "../paper-services/paperServiceTransport";
import { resolveLocalAccountKey } from "../library/localAccountKey";

export function RecommendationIntelligenceSettings() {
  const preferences = useRecommendationPreferences();
  const [draft, setDraft] = useState(preferences);
  const [secret, setSecret] = useState({ embedding: "", reranker: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController>();
  const account = resolveLocalAccountKey();
  useEffect(() => { setDraft(preferences); }, [preferences]);
  useEffect(() => { setSecret({ embedding: "", reranker: "" }); return () => request.current?.abort(); }, [account]);
  const save = (next: typeof preferences) => { try { saveRecommendationPreferences(next); setMessage("推荐设置已保存。"); } catch { setMessage("无法保存推荐设置，请检查本机存储。"); } };
  async function test(provider: "embedding" | "reranker") {
    const config = draft[provider]; const task = new AbortController(); request.current?.abort(); request.current = task; setBusy(true); setMessage("正在检查服务…");
    try {
      const service = validatePaperService({ provider, endpoint: config.endpoint });
      if (secret[provider].trim()) await savePaperServiceKey(service, secret[provider]);
      task.signal.throwIfAborted();
      if (provider === "embedding") {
        const vectors = await embedTexts({ ...config, dimensions: undefined }, ["数据库事务与并发控制", "Database transactions and concurrency control"], task.signal);
        task.signal.throwIfAborted();
        save({ ...draft, embedding: { ...config, endpoint: service.endpoint, dimensions: vectors[0].length } });
        setMessage(`已验证向量接口：${vectors[0].length} 维。研究内容仍按当前隐私范围发送。`);
      } else {
        await rerankTexts(config, "database transactions", ["Concurrency control in databases", "Insect habitats"], task.signal);
        task.signal.throwIfAborted(); save({ ...draft, reranker: { ...config, endpoint: service.endpoint } }); setMessage("重排接口可用。");
      }
      setSecret((value) => ({ ...value, [provider]: "" }));
    } catch (error) { if (!task.signal.aborted) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (request.current === task) setBusy(false); }
  }
  return <section className="recommendation-intelligence-settings" aria-label="关联分析设置">
    <Switch label="增强关联推荐" checked={preferences.hybridEnabled} onChange={(_, data) => save({ ...preferences, hybridEnabled: data.checked })} />
    <p>围绕文献内容、你的阅读问题和研究方向排序。未配置语义服务时使用本地词项匹配；随时可以关闭。</p>
    <Switch label="结合相关批注与笔记" checked={preferences.useAnnotations} onChange={(_, data) => save({ ...preferences, useAnnotations: data.checked })} />
    <Switch label="结合已确认的用户画像" checked={preferences.useProfile} onChange={(_, data) => save({ ...preferences, useProfile: data.checked })} />
    <Switch label="允许向外部服务发送笔记、批注和画像" checked={preferences.sendPrivateText} onChange={(_, data) => save({ ...preferences, sendPrivateText: data.checked })} />
    <p>关闭时，这些内容只在本机匹配；公开题录仍可用于联网检索。使用本机模型无需向外部发送。</p>
    {(["embedding", "reranker"] as const).map((provider) => <details key={provider}>
      <summary>{provider === "embedding" ? "语义检索服务" : "精细重排服务"}（可选）</summary>
      <div className="recommendation-service-fields">
        <Field label={provider === "embedding" ? "向量 API 基础地址" : "重排 API 基础地址"}><Input value={draft[provider].endpoint} placeholder="https://example.com/v1" onChange={(_, data) => setDraft({ ...draft, [provider]: { ...draft[provider], endpoint: data.value, dimensions: undefined } })} /></Field>
        <Field label={provider === "embedding" ? "向量模型" : "重排模型"}><Input value={draft[provider].model} onChange={(_, data) => setDraft({ ...draft, [provider]: { ...draft[provider], model: data.value, dimensions: undefined } })} /></Field>
        <Field label={provider === "embedding" ? "向量 API key" : "重排 API key"}><Input type="password" autoComplete="off" value={secret[provider]} placeholder="留空使用已保存密钥；本机服务可不填" onChange={(_, data) => setSecret({ ...secret, [provider]: data.value })} /></Field>
        <div><Button disabled={busy || !draft[provider].endpoint || !draft[provider].model} onClick={() => void test(provider)}>测试并保存</Button>
          <Button appearance="subtle" disabled={busy} onClick={() => { void (async () => {
            try { if (preferences[provider].endpoint && await hasPaperServiceKey({ provider, endpoint: preferences[provider].endpoint })) await deletePaperServiceKey({ provider, endpoint: preferences[provider].endpoint });
              save({ ...preferences, [provider]: { endpoint: "", model: "" } });
            } catch (error) { setMessage(String(error)); }
          })(); }}>停用服务</Button></div>
      </div>
    </details>)}
    {busy ? <Button appearance="subtle" onClick={() => { request.current?.abort(); setBusy(false); setMessage("服务检查已取消。"); }}>取消检查</Button> : null}
    <Button appearance="subtle" disabled={busy} onClick={() => { void (async () => {
      try {
        save({ ...preferences, hybridEnabled: false });
        await clearSemanticScope(account === "guest" ? "local" : account);
        setMessage("已停用增强推荐并清除检索缓存；文献、批注和笔记保持不变。重新开启后按需建立索引。");
      } catch (error) { setMessage(String(error)); }
    })(); }}>清除检索缓存</Button>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
