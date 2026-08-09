import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  Field,
  Input,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Tooltip
} from "@fluentui/react-components";
import {
  ArrowSyncRegular,
  DataUsageSettingsRegular,
  SaveRegular,
  SendRegular
} from "@fluentui/react-icons";
import { AdminApiError, type AdminApiClient } from "./api";
import type {
  AdminPrincipal,
  VisualizationEntitlement,
  VisualizationModality,
  VisualizationProviderRoute,
  VisualizationProviderRouteMutation,
  VisualizationQuotaPolicy,
  VisualizationUsageRow,
  VisualizationAuditRow
} from "./types";

const modalities: VisualizationModality[] = [
  "semantic_graph", "circuit", "physics_diagram", "biology_structure", "geometry_2d",
  "function_plot", "geometry_3d", "physics_process", "reaction_process", "raster_illustration"
];

function errorMessage(error: unknown) {
  if (error instanceof AdminApiError) return `${error.message}${error.traceId ? ` (${error.traceId})` : ""}`;
  return error instanceof Error ? error.message : "请求失败。";
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";
}

function integer(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function emptyRoute(): VisualizationProviderRouteMutation {
  return {
    circuitFailures: 0,
    circuitOpenUntil: null,
    circuitState: "closed",
    dataClasses: ["paper"],
    enabled: false,
    endpoint: "https://",
    maxConcurrency: 1,
    modalities: ["semantic_graph"],
    model: "",
    operations: ["structured_generation", "validation"],
    priority: 100,
    providerId: "",
    region: "global",
    revision: 1,
    routeId: "",
    secretRef: "viz-secret:",
    timeoutMs: 30000,
  };
}

function routeMutation(route: VisualizationProviderRoute, enabled = route.enabled): VisualizationProviderRouteMutation {
  const {
    updatedAt: _updatedAt,
    updatedBy: _updatedBy,
    ...mutation
  } = route;
  return { ...mutation, enabled };
}

export function VisualizationGovernanceView({ api, principal }: {
  api: AdminApiClient;
  principal: (AdminPrincipal & { authenticationFresh?: boolean }) | null;
}) {
  const [routes, setRoutes] = useState<VisualizationProviderRoute[]>([]);
  const [policies, setPolicies] = useState<VisualizationQuotaPolicy[]>([]);
  const [usage, setUsage] = useState<VisualizationUsageRow[]>([]);
  const [audit, setAudit] = useState<VisualizationAuditRow[]>([]);
  const [routeDraft, setRouteDraft] = useState<VisualizationProviderRouteMutation | null>(null);
  const [routeExpectedRevision, setRouteExpectedRevision] = useState(0);
  const [subjectId, setSubjectId] = useState("");
  const [entitlement, setEntitlement] = useState<VisualizationEntitlement | null>(null);
  const [entitlementSubject, setEntitlementSubject] = useState<string | null>(null);
  const [policySubject, setPolicySubject] = useState("");
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, { dailyUnits: number; monthlyUnits: number; maxConcurrency: number; timezone: string; reason: string }>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ intent: "error" | "success"; message: string } | null>(null);
  const [usageSubjectFilter, setUsageSubjectFilter] = useState("");
  const [auditSubjectFilter, setAuditSubjectFilter] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditFromFilter, setAuditFromFilter] = useState("");
  const [auditToFilter, setAuditToFilter] = useState("");

  const authorized = Boolean(principal?.roles.includes("platform_admin"));
  const mutationAuthorized = authorized && principal?.authenticationFresh !== false;

  async function load() {
    if (!authorized) return;
    setLoading(true);
    setNotice(null);
    try {
      const [routeResult, policyResult, usageResult, auditResult] = await Promise.all([
        api.listVisualizationProviderRoutes(),
        api.listVisualizationQuotaPolicies({ limit: 200 }),
        api.listVisualizationUsage({ limit: 50, ...(usageSubjectFilter.trim() ? { subjectId: usageSubjectFilter.trim() } : {}) }),
        api.listVisualizationAudit({
          limit: 50,
          ...(auditActionFilter.trim() ? { action: auditActionFilter.trim() } : {}),
          ...(auditFromFilter ? { from: auditFromFilter } : {}),
          ...(auditSubjectFilter.trim() ? { subjectId: auditSubjectFilter.trim() } : {}),
          ...(auditToFilter ? { to: auditToFilter } : {})
        })
      ]);
      setRoutes(routeResult.routes);
      setPolicies(policyResult.policies);
      setUsage(usageResult.rows);
      setAudit(auditResult.rows);
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [authorized, api]);

  async function toggleRoute(route: VisualizationProviderRoute, enabled: boolean) {
    if (!mutationAuthorized) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.saveVisualizationProviderRoute({
        expectedRevision: route.revision,
        reason: "管理员控制面板更新路由状态",
        route: routeMutation(route, enabled)
      });
      setRoutes((current) => current.map((item) => item.routeId === result.route.routeId ? result.route : item));
      setNotice({ intent: "success", message: "Provider 路由状态已保存。" });
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function testRoute(route: VisualizationProviderRoute) {
    if (!mutationAuthorized) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.testVisualizationProviderRoute({
        expectedRevision: route.revision,
        routeId: route.routeId,
        reason: "管理员路由连通性测试"
      });
      setNotice({ intent: "success", message: "Provider 路由测试完成。" });
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function queryEntitlement(event: FormEvent) {
    event.preventDefault();
    if (!subjectId.trim()) return;
    setEntitlement(null);
    setEntitlementSubject(null);
    setBusy(true);
    try {
      const result = await api.getVisualizationEntitlement({ subjectId: subjectId.trim() });
      setEntitlement(result.entitlement);
      setEntitlementSubject(subjectId.trim());
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveEntitlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mutationAuthorized || !entitlement || !entitlementSubject) return;
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      const result = await api.setVisualizationEntitlement({
        allowed: entitlement.allowed,
        allowedModalities: entitlement.allowedModalities,
        expectedRevision: entitlement.revision,
        explicitRequestsAllowed: entitlement.explicitRequestsAllowed,
        reason: String(data.get("reason") || "管理员控制面板更新"),
        subjectId: entitlementSubject
      });
      setEntitlement(result.entitlement);
      setNotice({ intent: "success", message: "可视化授权已保存。" });
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!routeDraft || !mutationAuthorized) return;
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      const route: VisualizationProviderRouteMutation = {
        ...routeDraft,
        endpoint: String(data.get("endpoint") || routeDraft.endpoint).trim(),
        model: String(data.get("model") || routeDraft.model).trim(),
        providerId: String(data.get("providerId") || routeDraft.providerId).trim(),
        routeId: String(data.get("routeId") || routeDraft.routeId).trim(),
        secretRef: String(data.get("secretRef") || routeDraft.secretRef).trim(),
        maxConcurrency: integer(String(data.get("maxConcurrency")), routeDraft.maxConcurrency),
        timeoutMs: integer(String(data.get("timeoutMs")), routeDraft.timeoutMs),
        operations: String(data.get("operations") || routeDraft.operations.join(",")).split(",").map((value) => value.trim()).filter(Boolean) as VisualizationProviderRouteMutation["operations"],
        modalities: String(data.get("modalities") || routeDraft.modalities.join(",")).split(",").map((value) => value.trim()).filter(Boolean) as VisualizationModality[],
        dataClasses: String(data.get("dataClasses") || routeDraft.dataClasses.join(",")).split(",").map((value) => value.trim()).filter(Boolean),
        priority: integer(String(data.get("priority")), routeDraft.priority),
        region: String(data.get("region") || routeDraft.region).trim()
      };
      const result = await api.saveVisualizationProviderRoute({
        expectedRevision: routeExpectedRevision,
        reason: String(data.get("reason") || "管理员控制面板更新"),
        route
      });
      setRoutes((current) => [...current.filter((item) => item.routeId !== result.route.routeId), result.route]);
      setRouteDraft(null);
      setRouteExpectedRevision(0);
      setNotice({ intent: "success", message: "Provider 路由已保存。" });
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy(policy: VisualizationQuotaPolicy) {
    if (!mutationAuthorized) return;
    setBusy(true);
    try {
      const data = policyDrafts[policy.subjectId] ?? {
        dailyUnits: policy.dailyUnits,
        monthlyUnits: policy.monthlyUnits,
        maxConcurrency: policy.maxConcurrency,
        timezone: policy.timezone,
        reason: policy.reason || "管理员控制面板更新"
      };
      const result = await api.setVisualizationQuotaPolicy({
        dailyUnits: integer(String(data.dailyUnits), policy.dailyUnits),
        expectedRevision: policy.revision,
        maxConcurrency: Math.max(1, integer(String(data.maxConcurrency), policy.maxConcurrency)),
        monthlyUnits: integer(String(data.monthlyUnits), policy.monthlyUnits),
        reason: String(data.reason || "管理员控制面板更新"),
        subjectId: policy.subjectId,
        timezone: String(data.timezone || policy.timezone)
      });
      setPolicies((current) => current.map((item) => item.subjectId === policy.subjectId ? result.policy : item));
      setNotice({ intent: "success", message: "配额策略已保存。" });
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function queryPolicy(event: FormEvent) {
    event.preventDefault();
    const subject = policySubject.trim();
    if (!subject) return;
    setBusy(true);
    try {
      const result = await api.listVisualizationQuotaPolicies({ limit: 1, subjectId: subject });
      if (result.policies[0]) {
        setPolicies((current) => [result.policies[0], ...current.filter((item) => item.subjectId !== subject)]);
      } else {
        setPolicies((current) => [{
          dailyUnits: 0,
          maxConcurrency: 1,
          monthlyUnits: 0,
          reason: "管理员创建可视化配额策略",
          revision: 0,
          subjectId: subject,
          timezone: "UTC",
          updatedAt: null,
          updatedBy: principal?.subjectId ?? ""
        }, ...current.filter((item) => item.subjectId !== subject)]);
      }
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  if (!authorized) {
    return <div className="admin-empty" role="status">需要平台管理员角色。可视化治理不可用。</div>;
  }

  return (
    <div className="admin-view visualization-governance">
      <div className="admin-control-heading">
        <DataUsageSettingsRegular aria-hidden />
        <Tooltip content="刷新可视化治理数据" relationship="label">
          <Button aria-label="刷新可视化治理" disabled={loading || busy} icon={<ArrowSyncRegular />} onClick={() => void load()} />
        </Tooltip>
      </div>
      {notice ? <div className={`admin-notice admin-notice-${notice.intent}`} role="status">{notice.message}</div> : null}
      {loading ? <div className="admin-progress"><Spinner label="正在加载" /></div> : null}
      {!loading ? <>
        <section className="admin-section">
          <h2>Provider 路由</h2>
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow>
            <TableHeaderCell>路由</TableHeaderCell><TableHeaderCell>Provider</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>修订</TableHeaderCell><TableHeaderCell>操作</TableHeaderCell>
          </TableRow></TableHeader><TableBody>
            {routes.map((route) => <TableRow key={route.routeId}>
              <TableCell>{route.routeId}<br /><small>{route.region}</small></TableCell><TableCell>{route.providerId}</TableCell>
              <TableCell><Switch aria-label={`${route.routeId} 路由状态`} checked={route.enabled} disabled={busy || !mutationAuthorized} label={route.enabled ? "启用" : "停用"} onChange={(_, data) => void toggleRoute(route, data.checked)} /></TableCell>
              <TableCell>{route.revision}</TableCell><TableCell><div className="admin-row-actions"><Button appearance="subtle" disabled={busy || !mutationAuthorized} onClick={() => { setRouteDraft(routeMutation(route)); setRouteExpectedRevision(route.revision); }}>编辑</Button><Tooltip content="测试 Provider 路由" relationship="label"><Button aria-label={`测试 ${route.routeId}`} disabled={busy || !mutationAuthorized} icon={<SendRegular />} onClick={() => void testRoute(route)} /></Tooltip></div></TableCell>
            </TableRow>)}
          </TableBody></Table></div>
          <Button appearance="secondary" disabled={!mutationAuthorized} onClick={() => { setRouteDraft(emptyRoute()); setRouteExpectedRevision(0); }}>新增路由</Button>
        </section>

        {routeDraft ? <section className="admin-section visualization-advanced"><h2>高级管理员 Provider 配置</h2><form className="admin-form admin-form-horizontal visualization-editor" onSubmit={saveRoute}>
          <Field label="路由 ID" required><Input aria-label="路由 ID" name="routeId" defaultValue={routeDraft.routeId} required /></Field><Field label="Provider ID" required><Input aria-label="Provider ID" name="providerId" defaultValue={routeDraft.providerId} required /></Field>
          <Field label="Endpoint" required><Input aria-label="Endpoint" name="endpoint" defaultValue={routeDraft.endpoint} required /></Field><Field label="Model" required><Input aria-label="Model" name="model" defaultValue={routeDraft.model} required /></Field>
          <Field label="Secret Ref" required><Input aria-label="Secret Ref" name="secretRef" defaultValue={routeDraft.secretRef} required /></Field><Field label="最大并发" required><Input aria-label="最大并发" name="maxConcurrency" defaultValue={String(routeDraft.maxConcurrency)} min={1} type="number" /></Field>
          <Field label="超时（毫秒）" required><Input aria-label="超时（毫秒）" name="timeoutMs" defaultValue={String(routeDraft.timeoutMs)} min={100} type="number" /></Field><Field label="优先级"><Input aria-label="优先级" name="priority" defaultValue={String(routeDraft.priority)} min={0} type="number" /></Field>
          <Field label="区域" required><Input aria-label="区域" name="region" defaultValue={routeDraft.region} required /></Field><Field label="操作（逗号分隔）" required><Input aria-label="操作（逗号分隔）" name="operations" defaultValue={routeDraft.operations.join(",")} required /></Field>
          <Field label="模态（逗号分隔）" required><Input aria-label="模态（逗号分隔）" name="modalities" defaultValue={routeDraft.modalities.join(",")} required /></Field><Field label="数据类别（逗号分隔）" required><Input aria-label="数据类别（逗号分隔）" name="dataClasses" defaultValue={routeDraft.dataClasses.join(",")} required /></Field>
          <Field label="原因"><Input aria-label="原因" name="reason" defaultValue="管理员控制面板更新" /></Field>
          <div className="admin-form-actions"><Button appearance="primary" disabled={busy || !mutationAuthorized} icon={<SaveRegular />} type="submit">保存</Button><Button appearance="subtle" onClick={() => { setRouteDraft(null); setRouteExpectedRevision(0); }} type="button">取消</Button></div>
        </form></section> : null}

        <section className="admin-section"><h2>用户授权</h2><form className="admin-filter" onSubmit={queryEntitlement}><Field label="用户 ID" required><Input aria-label="用户 ID" onChange={(_, data) => { setSubjectId(data.value); setEntitlement(null); setEntitlementSubject(null); }} value={subjectId} required /></Field><Button appearance="primary" disabled={busy} type="submit">查询</Button></form>
          {entitlement ? <form className="admin-form visualization-editor" onSubmit={saveEntitlement}>
            <Switch checked={entitlement.allowed} disabled={!mutationAuthorized || entitlementSubject !== subjectId.trim()} label="允许生成" onChange={(_, data) => setEntitlement({ ...entitlement, allowed: data.checked })} />
            <Switch checked={entitlement.explicitRequestsAllowed} disabled={!mutationAuthorized || entitlementSubject !== subjectId.trim()} label="允许显式请求" onChange={(_, data) => setEntitlement({ ...entitlement, explicitRequestsAllowed: data.checked })} />
            <fieldset className="visualization-modalities"><legend>允许的模态</legend>{modalities.map((modality) => <Checkbox disabled={!mutationAuthorized || entitlementSubject !== subjectId.trim()} checked={entitlement.allowedModalities.includes(modality)} key={modality} label={modality} onChange={(_, data) => setEntitlement({ ...entitlement, allowedModalities: data.checked ? [...entitlement.allowedModalities, modality] : entitlement.allowedModalities.filter((item) => item !== modality) })} />)}</fieldset>
            <Field label="原因"><Input name="reason" defaultValue="管理员控制面板更新" /></Field><Button appearance="primary" disabled={busy || !mutationAuthorized || entitlementSubject !== subjectId.trim()} icon={<SaveRegular />} type="submit">保存</Button>
          </form> : null}
        </section>

        <section className="admin-section"><h2>配额策略</h2><form className="admin-filter" onSubmit={queryPolicy}><Field label="配额用户 ID" required><Input aria-label="配额用户 ID" value={policySubject} onChange={(_, data) => setPolicySubject(data.value)} required /></Field><Button appearance="secondary" disabled={busy} type="submit">查询配额</Button></form><div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>用户</TableHeaderCell><TableHeaderCell>每日</TableHeaderCell><TableHeaderCell>每月</TableHeaderCell><TableHeaderCell>并发</TableHeaderCell><TableHeaderCell>时区</TableHeaderCell><TableHeaderCell>操作</TableHeaderCell></TableRow></TableHeader><TableBody>{policies.map((policy) => { const draft = policyDrafts[policy.subjectId] ?? { dailyUnits: policy.dailyUnits, monthlyUnits: policy.monthlyUnits, maxConcurrency: policy.maxConcurrency, timezone: policy.timezone, reason: policy.reason || "管理员控制面板更新" }; const update = (key: keyof typeof draft, value: string) => setPolicyDrafts((current) => ({ ...current, [policy.subjectId]: { ...draft, [key]: key === "timezone" || key === "reason" ? value : integer(value, Number(draft[key])) } })); return <TableRow key={policy.subjectId}><TableCell>{policy.subjectId}<br /><small>修订 {policy.revision}</small></TableCell><TableCell><Input aria-label={`${policy.subjectId} 每日配额`} value={String(draft.dailyUnits)} onChange={(_, data) => update("dailyUnits", data.value)} type="number" min={0} /></TableCell><TableCell><Input aria-label={`${policy.subjectId} 每月配额`} value={String(draft.monthlyUnits)} onChange={(_, data) => update("monthlyUnits", data.value)} type="number" min={0} /></TableCell><TableCell><Input aria-label={`${policy.subjectId} 并发限制`} value={String(draft.maxConcurrency)} onChange={(_, data) => update("maxConcurrency", data.value)} type="number" min={1} /></TableCell><TableCell><select aria-label={`${policy.subjectId} 时区`} value={draft.timezone} onChange={(event) => update("timezone", event.target.value)}><option value="UTC">UTC</option><option value="Asia/Shanghai">Asia/Shanghai</option><option value="America/Los_Angeles">America/Los_Angeles</option><option value="Europe/London">Europe/London</option></select></TableCell><TableCell><Input aria-label={`${policy.subjectId} 配额原因`} value={draft.reason} onChange={(_, data) => update("reason", data.value)} /><Button aria-label={`保存 ${policy.subjectId} 配额`} appearance="subtle" disabled={busy || !mutationAuthorized} icon={<SaveRegular />} onClick={() => void savePolicy(policy)} /></TableCell></TableRow>; })}</TableBody></Table></div></section>

        <section className="admin-section visualization-advanced"><h2>高级管理员数据</h2>
          <form className="visualization-filter" onSubmit={(event) => { event.preventDefault(); void load(); }}>
            <Field label="使用量用户 ID"><Input aria-label="使用量用户 ID" onChange={(_, data) => setUsageSubjectFilter(data.value)} value={usageSubjectFilter} /></Field>
            <Button appearance="secondary" disabled={busy || loading} type="submit">刷新使用量</Button>
          </form>
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>用户</TableHeaderCell><TableHeaderCell>事件</TableHeaderCell><TableHeaderCell>单位变化</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>Trace</TableHeaderCell></TableRow></TableHeader><TableBody>{usage.map((row) => <TableRow key={row.eventId}><TableCell>{row.subjectId}</TableCell><TableCell>{row.eventType}</TableCell><TableCell>{row.unitsDelta}</TableCell><TableCell>{date(row.createdAt)}</TableCell><TableCell>{row.traceId}</TableCell></TableRow>)}</TableBody></Table></div>
          <form className="visualization-filter" onSubmit={(event) => { event.preventDefault(); void load(); }}>
            <Field label="审计用户 ID"><Input aria-label="审计用户 ID" onChange={(_, data) => setAuditSubjectFilter(data.value)} value={auditSubjectFilter} /></Field><Field label="审计操作"><Input aria-label="审计操作" onChange={(_, data) => setAuditActionFilter(data.value)} value={auditActionFilter} /></Field><Field label="开始日期"><Input aria-label="开始日期" onChange={(_, data) => setAuditFromFilter(data.value)} type="date" value={auditFromFilter} /></Field><Field label="结束日期"><Input aria-label="结束日期" onChange={(_, data) => setAuditToFilter(data.value)} type="date" value={auditToFilter} /></Field>
            <Button appearance="secondary" disabled={busy || loading} type="submit">刷新审计</Button>
          </form>
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>操作</TableHeaderCell><TableHeaderCell>资源</TableHeaderCell><TableHeaderCell>原因</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>Trace</TableHeaderCell></TableRow></TableHeader><TableBody>{audit.map((row) => <TableRow key={row.auditId}><TableCell>{row.action}</TableCell><TableCell>{row.resourceType}:{row.resourceId ?? "-"}</TableCell><TableCell>{row.reason ?? "-"}</TableCell><TableCell>{date(row.occurredAt)}</TableCell><TableCell>{row.traceId}</TableCell></TableRow>)}</TableBody></Table></div>
        </section>
      </> : null}
    </div>
  );
}
