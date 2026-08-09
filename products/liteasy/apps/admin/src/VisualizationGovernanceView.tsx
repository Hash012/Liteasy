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

function emptyRoute(): VisualizationProviderRoute {
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
    operations: ["validation"],
    priority: 100,
    providerId: "",
    region: "global",
    revision: 0,
    routeId: "",
    secretRef: "viz-secret:",
    timeoutMs: 30000,
    updatedAt: null,
    updatedBy: ""
  };
}

export function VisualizationGovernanceView({ api, principal }: {
  api: AdminApiClient;
  principal: AdminPrincipal | null;
}) {
  const [routes, setRoutes] = useState<VisualizationProviderRoute[]>([]);
  const [policies, setPolicies] = useState<VisualizationQuotaPolicy[]>([]);
  const [usage, setUsage] = useState<VisualizationUsageRow[]>([]);
  const [audit, setAudit] = useState<VisualizationAuditRow[]>([]);
  const [routeDraft, setRouteDraft] = useState<VisualizationProviderRoute | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [entitlement, setEntitlement] = useState<VisualizationEntitlement | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ intent: "error" | "success"; message: string } | null>(null);

  const authorized = Boolean(principal?.roles.includes("platform_admin"));

  async function load() {
    if (!authorized) return;
    setLoading(true);
    setNotice(null);
    try {
      const [routeResult, policyResult, usageResult, auditResult] = await Promise.all([
        api.listVisualizationProviderRoutes(),
        api.listVisualizationQuotaPolicies({ limit: 100 }),
        api.listVisualizationUsage({ limit: 50 }),
        api.listVisualizationAudit({ limit: 50 })
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

  async function queryEntitlement(event: FormEvent) {
    event.preventDefault();
    if (!subjectId.trim()) return;
    setBusy(true);
    try {
      const result = await api.getVisualizationEntitlement({ subjectId: subjectId.trim() });
      setEntitlement(result.entitlement);
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveEntitlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entitlement || !subjectId.trim()) return;
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      const result = await api.setVisualizationEntitlement({
        allowed: entitlement.allowed,
        allowedModalities: entitlement.allowedModalities,
        expectedRevision: entitlement.revision,
        explicitRequestsAllowed: entitlement.explicitRequestsAllowed,
        reason: String(data.get("reason") || "管理员控制面板更新"),
        subjectId: subjectId.trim()
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
    if (!routeDraft) return;
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      const route: VisualizationProviderRoute = {
        ...routeDraft,
        endpoint: String(data.get("endpoint") || routeDraft.endpoint).trim(),
        model: String(data.get("model") || routeDraft.model).trim(),
        providerId: String(data.get("providerId") || routeDraft.providerId).trim(),
        routeId: String(data.get("routeId") || routeDraft.routeId).trim(),
        secretRef: String(data.get("secretRef") || routeDraft.secretRef).trim(),
        maxConcurrency: integer(String(data.get("maxConcurrency")), routeDraft.maxConcurrency),
        timeoutMs: integer(String(data.get("timeoutMs")), routeDraft.timeoutMs)
      };
      const result = await api.saveVisualizationProviderRoute({
        expectedRevision: routeDraft.revision,
        reason: String(data.get("reason") || "管理员控制面板更新"),
        route
      });
      setRoutes((current) => [...current.filter((item) => item.routeId !== result.route.routeId), result.route]);
      setRouteDraft(null);
      setNotice({ intent: "success", message: "Provider 路由已保存。" });
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy(policy: VisualizationQuotaPolicy, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      const result = await api.setVisualizationQuotaPolicy({
        dailyUnits: integer(String(data.get("dailyUnits")), policy.dailyUnits),
        expectedRevision: policy.revision,
        maxConcurrency: Math.max(1, integer(String(data.get("maxConcurrency")), policy.maxConcurrency)),
        monthlyUnits: integer(String(data.get("monthlyUnits")), policy.monthlyUnits),
        reason: String(data.get("reason") || "管理员控制面板更新"),
        subjectId: policy.subjectId,
        timezone: policy.timezone
      });
      setPolicies((current) => current.map((item) => item.subjectId === policy.subjectId ? result.policy : item));
      setNotice({ intent: "success", message: "配额策略已保存。" });
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
              <TableCell>{route.routeId}<br /><small>{route.region}</small></TableCell><TableCell>{route.providerId}<br /><small>{route.model}</small></TableCell>
              <TableCell><Switch checked={route.enabled} label={route.enabled ? "启用" : "停用"} onChange={() => setRoutes((current) => current.map((item) => item.routeId === route.routeId ? { ...item, enabled: !item.enabled } : item))} /></TableCell>
              <TableCell>{route.revision}</TableCell><TableCell><div className="admin-row-actions"><Button appearance="subtle" onClick={() => setRouteDraft(route)}>编辑</Button><Tooltip content="测试 Provider 路由" relationship="label"><Button aria-label={`测试 ${route.routeId}`} icon={<SendRegular />} onClick={() => void api.testVisualizationProviderRoute({ expectedRevision: route.revision, providerRequest: { routes: [route], modality: route.modalities[0] ?? "semantic_graph", dataClass: route.dataClasses[0] ?? "paper" }, reason: "管理员路由连通性测试" })} /></Tooltip></div></TableCell>
            </TableRow>)}
          </TableBody></Table></div>
          <Button appearance="secondary" onClick={() => setRouteDraft(emptyRoute())}>新增路由</Button>
          {routeDraft ? <form className="admin-form admin-form-horizontal visualization-editor" onSubmit={saveRoute}>
            <Field label="路由 ID" required><Input name="routeId" defaultValue={routeDraft.routeId} required /></Field><Field label="Provider ID" required><Input name="providerId" defaultValue={routeDraft.providerId} required /></Field>
            <Field label="Endpoint" required><Input name="endpoint" defaultValue={routeDraft.endpoint} required /></Field><Field label="Model" required><Input name="model" defaultValue={routeDraft.model} required /></Field>
            <Field label="Secret Ref" required><Input name="secretRef" defaultValue={routeDraft.secretRef} required /></Field><Field label="最大并发" required><Input name="maxConcurrency" defaultValue={String(routeDraft.maxConcurrency)} min={1} type="number" /></Field>
            <Field label="超时（毫秒）" required><Input name="timeoutMs" defaultValue={String(routeDraft.timeoutMs)} min={100} type="number" /></Field><Field label="原因"><Input name="reason" defaultValue="管理员控制面板更新" /></Field>
            <div className="admin-form-actions"><Button appearance="primary" disabled={busy} icon={<SaveRegular />} type="submit">保存</Button><Button appearance="subtle" onClick={() => setRouteDraft(null)} type="button">取消</Button></div>
          </form> : null}
        </section>

        <section className="admin-section"><h2>用户授权</h2><form className="admin-filter" onSubmit={queryEntitlement}><Field label="用户 ID" required><Input aria-label="用户 ID" onChange={(_, data) => setSubjectId(data.value)} value={subjectId} required /></Field><Button appearance="primary" disabled={busy} type="submit">查询</Button></form>
          {entitlement ? <form className="admin-form visualization-editor" onSubmit={saveEntitlement}>
            <Switch checked={entitlement.allowed} label="允许生成" onChange={(_, data) => setEntitlement({ ...entitlement, allowed: data.checked })} />
            <Switch checked={entitlement.explicitRequestsAllowed} label="允许显式请求" onChange={(_, data) => setEntitlement({ ...entitlement, explicitRequestsAllowed: data.checked })} />
            <fieldset className="visualization-modalities"><legend>允许的模态</legend>{modalities.map((modality) => <Checkbox checked={entitlement.allowedModalities.includes(modality)} key={modality} label={modality} onChange={(_, data) => setEntitlement({ ...entitlement, allowedModalities: data.checked ? [...entitlement.allowedModalities, modality] : entitlement.allowedModalities.filter((item) => item !== modality) })} />)}</fieldset>
            <Field label="原因"><Input name="reason" defaultValue="管理员控制面板更新" /></Field><Button appearance="primary" disabled={busy} icon={<SaveRegular />} type="submit">保存</Button>
          </form> : null}
        </section>

        <section className="admin-section"><h2>配额策略</h2><div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>用户</TableHeaderCell><TableHeaderCell>每日</TableHeaderCell><TableHeaderCell>每月</TableHeaderCell><TableHeaderCell>并发</TableHeaderCell><TableHeaderCell>操作</TableHeaderCell></TableRow></TableHeader><TableBody>{policies.map((policy) => <TableRow key={policy.subjectId}><TableCell>{policy.subjectId}<br /><small>修订 {policy.revision}</small></TableCell><TableCell colSpan={3}><form className="visualization-inline-form" onSubmit={(event) => void savePolicy(policy, event)}><Input aria-label={`${policy.subjectId} 每日配额`} name="dailyUnits" defaultValue={String(policy.dailyUnits)} type="number" min={0} /><Input aria-label={`${policy.subjectId} 每月配额`} name="monthlyUnits" defaultValue={String(policy.monthlyUnits)} type="number" min={0} /><Input aria-label={`${policy.subjectId} 并发限制`} name="maxConcurrency" defaultValue={String(policy.maxConcurrency)} type="number" min={1} /><Input name="reason" defaultValue="管理员控制面板更新" /><Button aria-label={`保存 ${policy.subjectId} 配额`} appearance="subtle" disabled={busy} icon={<SaveRegular />} type="submit" /></form></TableCell><TableCell>{policy.timezone}</TableCell></TableRow>)}</TableBody></Table></div></section>

        <section className="admin-section visualization-advanced"><h2>高级管理员数据</h2><div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>用户</TableHeaderCell><TableHeaderCell>事件</TableHeaderCell><TableHeaderCell>单位变化</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>Trace</TableHeaderCell></TableRow></TableHeader><TableBody>{usage.map((row) => <TableRow key={row.eventId}><TableCell>{row.subjectId}</TableCell><TableCell>{row.eventType}</TableCell><TableCell>{row.unitsDelta}</TableCell><TableCell>{date(row.createdAt)}</TableCell><TableCell>{row.traceId}</TableCell></TableRow>)}</TableBody></Table></div><div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>操作</TableHeaderCell><TableHeaderCell>资源</TableHeaderCell><TableHeaderCell>原因</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>Trace</TableHeaderCell></TableRow></TableHeader><TableBody>{audit.map((row) => <TableRow key={row.auditId}><TableCell>{row.action}</TableCell><TableCell>{row.resourceType}:{row.resourceId ?? "-"}</TableCell><TableCell>{row.reason ?? "-"}</TableCell><TableCell>{date(row.occurredAt)}</TableCell><TableCell>{row.traceId}</TableCell></TableRow>)}</TableBody></Table></div></section>
      </> : null}
    </div>
  );
}
