import { useEffect, useState } from "react";
import { Button, Field, Input, Textarea, Checkbox } from "@fluentui/react-components";
import { DisclosureSection } from "../../shared/ui/productPrimitives";
import { createRecommendationEvidenceStore, localRecommendationScope, type EvidenceState } from "./recommendationEvidence";
import { subscribeObjectStorage } from "../objects/objectStorage";
import type { InterestFacet } from "../../../../../../packages/recommendation-core/v2.mjs";
export function RecommendationInterestsSettings() {
  const scope = localRecommendationScope(), store = createRecommendationEvidenceStore(scope);
  const [state, setState] = useState<EvidenceState>();
  const [selected, select] = useState<string[]>([]), [message, setMessage] = useState("");
  useEffect(() => { let active = true; const load = () => { void store.read().then(value => { if (active) setState(value); }).catch(() => {}); }; load(); const off = subscribeObjectStorage(scope, keys => { if (keys?.includes("recommendation/v2/evidence")) load(); }); return () => { active = false; off(); }; }, [scope]);
  const update = (facets: InterestFacet[]) => { void store.updateFacets(facets).catch(error => setMessage(String(error))); };
  const change = (id: string, patch: Partial<InterestFacet>) => setState(value => value ? { ...value, facets: value.facets.map(facet => facet.id === id ? { ...facet, ...patch } : facet) } : value);
  return <DisclosureSection title="研究课题与本机历史">
    <p>自动整理的课题标为“待确认”。确认或固定的目标由你维护，最多六个。</p>
    <Button size="small" disabled={!state || state.facets.length >= 6} onClick={() => setState(value => value ? { ...value, facets: [...value.facets, { id: crypto.randomUUID(), version: crypto.randomUUID(), label: "新课题", problem: "", methods: [], tasksOrDatasets: [], metrics: [], stage: "unspecified", unresolvedQuestions: [], status: "tentative", evidenceIds: [], exclusions: [], confidenceBand: "limited" }] } : value)}>添加研究课题</Button>
    {state?.facets.map(facet => <div key={facet.id} className="recommendation-interest-editor">
      <Checkbox label={`选择课题 ${facet.label}`} checked={selected.includes(facet.id)} onChange={(_, data) => select(data.checked ? [...selected, facet.id] : selected.filter(id => id !== facet.id))} />
      <Field label="课题名称"><Input value={facet.label} onChange={(_, data) => change(facet.id, { label: data.value })} /></Field>
      <Field label="研究问题（分号分隔可拆分）"><Textarea value={facet.problem} onChange={(_, data) => change(facet.id, { problem: data.value })} /></Field>
      <p>{({ tentative: "待确认", confirmed: "已确认", pinned: "已固定", paused: "已暂停" })[facet.status]} · {facet.evidenceIds.length} 条本机依据</p>
      <div className="recommendation-feed-actions">
        <Button size="small" onClick={() => update(state.facets.map(value => value.id === facet.id ? { ...value, status: "confirmed" } : value))}>保存并确认</Button>
        <Button size="small" appearance="subtle" onClick={() => update(state.facets.map(value => value.id === facet.id ? { ...value, status: "pinned" } : value))}>固定</Button>
        <Button size="small" appearance="subtle" onClick={() => update(state.facets.map(value => value.id === facet.id ? { ...value, status: value.status === "paused" ? "confirmed" : "paused" } : value))}>{facet.status === "paused" ? "恢复" : "暂停"}</Button>
        <Button size="small" appearance="subtle" onClick={() => { const parts = facet.problem.split(/[；;\n]+/).map(text => text.trim()).filter(Boolean); if (parts.length < 2) { setMessage("请先用分号分开两个研究问题。"); return; } update([...state.facets.filter(value => value.id !== facet.id), ...parts.map(text => ({ ...facet, id: crypto.randomUUID(), label: text.slice(0, 50), problem: text, status: "confirmed" as const }))]); }}>拆分</Button>
        <Button size="small" appearance="subtle" onClick={() => update(state.facets.filter(value => value.id !== facet.id))}>删除课题</Button>
      </div>
    </div>)}
    {selected.length > 1 && state ? <Button size="small" onClick={() => { const merging = state.facets.filter(facet => selected.includes(facet.id)); update([...state.facets.filter(facet => !selected.includes(facet.id)), { ...merging[0], id: crypto.randomUUID(), problem: merging.map(facet => facet.problem).join("；"), evidenceIds: [...new Set(merging.flatMap(facet => [...facet.evidenceIds]))], status: "confirmed" }]); select([]); }}>合并所选课题</Button> : null}
    <DisclosureSection title={`已记录依据 · ${state?.events.length ?? 0}`}>
      {state?.events.slice(-30).reverse().map(event => <div key={event.id}><p>{event.text.slice(0, 200)} · {new Date(event.at).toLocaleString()}</p><Button size="small" appearance="subtle" onClick={() => { void store.forget([event.sourceId]); }}>忘记此来源</Button></div>)}
    </DisclosureSection>
    <Button size="small" appearance="subtle" onClick={() => { void store.clearHistory(); }}>清除本机推荐历史</Button>
    <Button size="small" appearance="subtle" onClick={() => { void store.resetInterests(); }}>重置研究课题</Button>
    {message ? <p role="status">{message}</p> : null}
  </DisclosureSection>;
}
