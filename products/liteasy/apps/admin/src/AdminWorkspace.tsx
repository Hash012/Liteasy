import { useCallback, useEffect, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Select,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Textarea,
  Tooltip
} from "@fluentui/react-components";
import {
  ArrowSyncRegular,
  BrainCircuitRegular,
  ClipboardTaskListLtrRegular,
  CommentMultipleRegular,
  DatabaseRegular,
  DataUsageSettingsRegular,
  DeleteRegular,
  DocumentArrowDownRegular,
  FormMultipleRegular,
  GaugeRegular,
  KeyRegular,
  PeopleTeamRegular,
  PersonSettingsRegular,
  SearchRegular,
  SaveRegular,
  ShieldLockRegular,
  SignOutRegular
} from "@fluentui/react-icons";
import { AdminApiError, type AdminApiClient } from "./api";
import { VisualizationGovernanceView } from "./VisualizationGovernanceView";
import type {
  AccountDirectoryPage,
  AiProviderConfigurationStatus,
  AdminIdentity,
  AdminSession,
  AuditEvent,
  ForumAnnotation,
  ForumTagAppeal,
  GovernanceDirectory,
  ModelPolicy,
  MarketingApplication,
  OrganizationGovernance,
  RetrievalSource,
  StorageQuota
} from "./types";

type AdminView = "accounts" | "applications" | "audit" | "forum" | "models" | "organizations" | "overview" | "quotas" | "support" | "visualization";
type Notice = { intent: "error" | "success" | "warning"; message: string; title: string };
type RetrievalConnectorType = Exclude<RetrievalSource["connectorType"], null>;
type Confirmation = {
  action: (reason: string) => Promise<void>;
  detail: string;
  requireReason?: boolean;
  title: string;
};

const accountPageSize = 50;

const navigation: Array<{ icon: ReactElement; id: AdminView; label: string }> = [
  { icon: <ShieldLockRegular />, id: "overview", label: "概览" },
  { icon: <PeopleTeamRegular />, id: "accounts", label: "账号与角色" },
  { icon: <FormMultipleRegular />, id: "applications", label: "体验申请" },
  { icon: <DatabaseRegular />, id: "organizations", label: "组织治理" },
  { icon: <GaugeRegular />, id: "quotas", label: "配额" },
  { icon: <KeyRegular />, id: "support", label: "支持访问" },
  { icon: <BrainCircuitRegular />, id: "models", label: "模型与检索" },
  { icon: <DataUsageSettingsRegular />, id: "visualization", label: "可视化治理" },
  { icon: <ClipboardTaskListLtrRegular />, id: "audit", label: "审计" },
  { icon: <CommentMultipleRegular />, id: "forum", label: "论坛治理" }
];

const retrievalConnectorEndpoints: Record<RetrievalConnectorType, string> = {
  crossref: "https://api.crossref.org/works",
  openalex: "https://api.openalex.org/works",
  semantic_scholar: "https://api.semanticscholar.org/graph/v1/paper/search"
};

function errorMessage(error: unknown) {
  if (error instanceof AdminApiError) {
    return `${error.message}${error.traceId ? ` (${error.traceId})` : ""}`;
  }
  return error instanceof Error ? error.message : "请求失败。";
}

function value(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function numeric(form: FormData, name: string) {
  const result = Number(value(form, name));
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${name}_invalid`);
  return result;
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return "未配置";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toLocaleString("zh-CN", { maximumFractionDigits: unit ? 2 : 0 })} ${units[unit]}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function roleLabel(role: string) {
  return ({
    developer_diagnostics: "开发诊断管理员",
    platform_admin: "平台管理员"
  } as Record<string, string>)[role] ?? role;
}

function authenticationMethodLabel(method: string) {
  return ({ mfa: "多因素认证", otp: "动态验证码", pwd: "密码" } as Record<string, string>)[method] ?? method;
}

function accountStatusLabel(status: string) {
  return ({ active: "启用", deleted: "已删除", disabled: "禁用" } as Record<string, string>)[status] ?? status;
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="admin-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="admin-empty">{children}</div>;
}

function ReasonField({ minimum = 8 }: { minimum?: number }) {
  return (
    <Field label="原因" required>
      <Textarea maxLength={1000} minLength={minimum} name="reason" required resize="vertical" />
    </Field>
  );
}

export function AdminWorkspace({
  api,
  onLogout,
  onReauthenticate,
  session
}: {
  api: AdminApiClient;
  onLogout: () => Promise<void>;
  onReauthenticate: () => Promise<void>;
  session: AdminSession;
}) {
  const [view, setView] = useState<AdminView>("overview");
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [accountDirectory, setAccountDirectory] = useState<AccountDirectoryPage>({
    accounts: [], first: 0, max: accountPageSize, search: "", total: 0
  });
  const [selectedAccountSubject, setSelectedAccountSubject] = useState("");
  const [policy, setPolicy] = useState<ModelPolicy | null>(null);
  const [aiProviderConfiguration, setAiProviderConfiguration] = useState<AiProviderConfigurationStatus>({
    configured: false,
    mineruConfigured: false,
    modelProviderConfigured: false,
    revision: 0,
    updatedAt: null,
    updatedBy: null,
    writable: false
  });
  const [governance, setGovernance] = useState<GovernanceDirectory>({
    accountStatuses: [], organizations: [], roleGrants: [], supportGrants: []
  });
  const [sources, setSources] = useState<RetrievalSource[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [applications, setApplications] = useState<MarketingApplication[]>([]);
  const [nextApplicationBefore, setNextApplicationBefore] = useState<string | null>(null);
  const [nextAuditBefore, setNextAuditBefore] = useState<string | null>(null);
  const [forumAnnotations, setForumAnnotations] = useState<ForumAnnotation[]>([]);
  const [forumTagAppeals, setForumTagAppeals] = useState<ForumTagAppeal[]>([]);
  const [forumError, setForumError] = useState("");
  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationReason, setConfirmationReason] = useState("");
  const [sourceDraft, setSourceDraft] = useState<RetrievalSource | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const currentIdentity = await api.identity();
      setIdentity(currentIdentity);
      const [accountResult, governanceResult, modelResult, aiProviderResult, sourceResult, auditResult, forumResult, appealResult, applicationResult] = await Promise.allSettled([
        api.accounts({ first: 0, max: accountPageSize }),
        api.governance(),
        api.modelPolicy(),
        api.aiProviderConfiguration(),
        api.retrievalSources(),
        api.audit({ limit: 50 }),
        api.forumAnnotations(),
        api.forumTagAppeals(),
        api.marketingApplications({ limit: 100 })
      ]);
      if (accountResult.status === "fulfilled") setAccountDirectory(accountResult.value);
      else setNotice({ intent: "warning", message: errorMessage(accountResult.reason), title: "账号目录加载失败" });
      if (governanceResult.status === "fulfilled") setGovernance(governanceResult.value);
      else setNotice({ intent: "warning", message: errorMessage(governanceResult.reason), title: "治理目录加载失败" });
      if (modelResult.status === "fulfilled") setPolicy(modelResult.value);
      else if (!(modelResult.reason instanceof AdminApiError && modelResult.reason.code === "model_policy_not_configured")) {
        setNotice({ intent: "warning", message: errorMessage(modelResult.reason), title: "模型策略加载失败" });
      }
      if (aiProviderResult.status === "fulfilled") setAiProviderConfiguration(aiProviderResult.value);
      else setNotice({ intent: "warning", message: errorMessage(aiProviderResult.reason), title: "AI 服务配置加载失败" });
      if (sourceResult.status === "fulfilled") setSources(sourceResult.value.sources);
      if (auditResult.status === "fulfilled") {
        setAuditEvents(auditResult.value.events);
        setNextAuditBefore(auditResult.value.nextBefore);
      }
      if (forumResult.status === "fulfilled") {
        setForumAnnotations(forumResult.value.annotations);
        setForumError("");
      } else {
        setForumAnnotations([]);
        setForumError(errorMessage(forumResult.reason));
      }
      if (appealResult.status === "fulfilled") setForumTagAppeals(appealResult.value.appeals);
      else {
        setForumTagAppeals([]);
        setForumError((current) => current || errorMessage(appealResult.reason));
      }
      if (applicationResult.status === "fulfilled") {
        setApplications(applicationResult.value.applications);
        setNextApplicationBefore(applicationResult.value.nextBefore);
      } else {
        setNotice({ intent: "warning", message: errorMessage(applicationResult.reason), title: "体验申请加载失败" });
      }
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error), title: "管理数据加载失败" });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function execute(title: string, task: () => Promise<unknown>, after?: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await task();
      if (after) await after();
      setNotice({ intent: "success", message: title, title: "操作完成" });
    } catch (error) {
      setNotice({ intent: "error", message: errorMessage(error), title: "操作失败" });
    } finally {
      setBusy(false);
    }
  }

  function confirm(
    title: string,
    detail: string,
    action: (reason: string) => Promise<void>,
    requireReason = false
  ) {
    setConfirmationReason("");
    setConfirmation({ action, detail, requireReason, title });
  }

  async function submitAccountStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      reason: value(data, "reason"),
      status: value(data, "status") as "active" | "disabled" | "deleted",
      subjectId: value(data, "subjectId")
    };
    confirm(
      "确认账号状态变更",
      `${input.subjectId} -> ${input.status}`,
      () => execute("账号状态已更新。", () => api.accountStatus(input), refresh)
    );
  }

  async function loadAccounts(first: number, search: string) {
    await execute("账号目录已刷新。", async () => {
      setAccountDirectory(await api.accounts({ first, max: accountPageSize, search }));
    });
  }

  async function searchAccounts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await loadAccounts(0, value(data, "search"));
  }

  async function submitRoleGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const role = value(data, "role");
    if (role !== "platform_admin" && role !== "developer_diagnostics") {
      throw new Error("role_invalid");
    }
    await execute("平台角色已授予。", () => api.grantRole({
      reason: value(data, "reason"),
      role,
      subjectId: value(data, "subjectId")
    }), refresh);
  }

  async function submitRoleRevoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { grantId: value(data, "grantId"), reason: value(data, "reason") };
    confirm(
      "确认撤销平台角色",
      input.grantId,
      () => execute("平台角色已撤销。", () => api.revokeRole(input), refresh)
    );
  }

  function setOrganizationStatus(organization: OrganizationGovernance) {
    const status = organization.status === "active" ? "suspended" : "active";
    confirm(
      status === "suspended" ? "确认暂停组织" : "确认恢复组织",
      `${organization.name} (${organization.organizationId})`,
      (reason) => execute("组织状态已更新。", () => api.setOrganizationStatus({
        expectedRevision: organization.revision,
        organizationId: organization.organizationId,
        reason,
        status
      }), refresh),
      true
    );
  }

  async function loadQuota(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await execute("配额已读取。", async () => {
      const result = await api.quota({
        scopeId: value(data, "scopeId"),
        scopeType: value(data, "scopeType") as "user" | "organization"
      });
      setQuota(result.quota);
    });
  }

  async function saveQuota(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quota) return;
    const data = new FormData(event.currentTarget);
    await execute("存储配额已更新。", async () => {
      const result = await api.saveQuota({
        expectedRevision: quota.revision,
        limitBytes: numeric(data, "limitBytes"),
        reason: value(data, "reason"),
        scopeId: quota.scopeId,
        scopeType: quota.scopeType
      });
      setQuota(result.quota);
    }, refresh);
  }

  async function submitSupportGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await execute("支持访问已授予。", () => api.grantSupport({
      documentId: value(data, "documentId"),
      durationMinutes: numeric(data, "durationMinutes"),
      granteeSubject: value(data, "granteeSubject"),
      reason: value(data, "reason"),
      scopeId: value(data, "scopeId"),
      scopeType: value(data, "scopeType") as "user" | "organization"
    }), refresh);
  }

  async function submitSupportRevoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { grantId: value(data, "grantId"), reason: value(data, "reason") };
    confirm(
      "确认撤销支持访问",
      input.grantId,
      () => execute("支持访问已撤销。", () => api.revokeSupport(input), refresh)
    );
  }

  async function downloadSupportDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await execute("支持文献已下载。", async () => {
      const result = await api.downloadSupportDocument({
        documentId: value(data, "documentId"),
        grantId: value(data, "grantId")
      });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.download = result.fileName;
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
    }, refresh);
  }

  async function submitModelPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await execute("模型策略已保存。", async () => {
      const result = await api.saveModelPolicy({
        cloudProxyEndpoint: value(data, "cloudProxyEndpoint"),
        defaultProvider: value(data, "defaultProvider"),
        expectedRevision: policy?.revision ?? 0,
        reason: value(data, "reason")
      });
      setPolicy(result.policy);
    }, refresh);
  }

  async function submitAiProviderConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await execute("AI 服务配置已加密保存并生效。", async () => {
      const result = await api.saveAiProviderConfiguration({
        expectedRevision: aiProviderConfiguration.revision,
        mineruToken: value(data, "mineruToken"),
        reason: value(data, "reason"),
        textApiKey: value(data, "textApiKey"),
        textBaseUrl: value(data, "textBaseUrl"),
        textModel: value(data, "textModel"),
        textProvider: "deepseek",
        visionApiKey: value(data, "visionApiKey"),
        visionBaseUrl: value(data, "visionBaseUrl"),
        visionModel: value(data, "visionModel")
      });
      setAiProviderConfiguration(result.configuration);
      form.reset();
    });
  }

  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const connectorType = value(data, "connectorType") as RetrievalConnectorType;
    await execute("检索源已保存。", async () => {
      const result = await api.saveRetrievalSource({
        baseUrl: retrievalConnectorEndpoints[connectorType],
        connectorType,
        enabled: value(data, "enabled") === "true",
        expectedRevision: sourceDraft?.revision ?? 0,
        name: value(data, "name"),
        reason: value(data, "reason"),
        ...(sourceDraft ? { sourceId: sourceDraft.sourceId } : {}),
        sourceKind: value(data, "sourceKind") as "website" | "database"
      });
      setSources((current) => [
        ...current.filter((item) => item.sourceId !== result.source.sourceId),
        result.source
      ].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")));
      setSourceDraft(null);
    }, refresh);
  }

  function removeSource(source: RetrievalSource) {
    confirm(
      "确认移除检索源",
      source.name,
      (reason) => execute("检索源已移除。", () => api.removeRetrievalSource({
        expectedRevision: source.revision,
        reason,
        sourceId: source.sourceId
      }), refresh),
      true
    );
  }

  async function filterAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await execute("审计记录已刷新。", async () => {
      const result = await api.audit({
        ...(value(data, "action") ? { action: value(data, "action") } : {}),
        limit: 50
      });
      setAuditEvents(result.events);
      setNextAuditBefore(result.nextBefore);
    });
  }

  async function loadMoreAudit() {
    if (!nextAuditBefore) return;
    await execute("已加载更多审计记录。", async () => {
      const result = await api.audit({ before: nextAuditBefore, limit: 50 });
      setAuditEvents((current) => [...current, ...result.events]);
      setNextAuditBefore(result.nextBefore);
    });
  }

  function moderateAnnotation(annotation: ForumAnnotation) {
    const withdrawn = Boolean(annotation.withdrawnAt);
    const action = withdrawn ? "restore" : "withdraw";
    confirm(
      withdrawn ? "确认恢复批注" : "确认撤回批注",
      annotation.body.slice(0, 80) || annotation.id,
      (reason) => execute("批注状态已更新。", () => api.moderateForumAnnotation({
        action,
        annotationId: annotation.id,
        reason
      }), refresh),
      true
    );
  }

  function resolveTagAppeal(appeal: ForumTagAppeal, decision: "accepted" | "rejected") {
    confirm(
      decision === "accepted" ? "确认移除平台标签" : "确认维持平台标签",
      `#${appeal.tag} · ${appeal.annotationBody.slice(0, 80)}`,
      (reason) => execute("标签申诉已审核。", () => api.resolveForumTagAppeal({
        appealId: appeal.appealId,
        decision,
        reason
      }), refresh),
      true
    );
  }

  async function loadMoreApplications() {
    if (!nextApplicationBefore) return;
    await execute("已加载更多体验申请。", async () => {
      const result = await api.marketingApplications({ before: nextApplicationBefore, limit: 100 });
      setApplications((current) => [...current, ...result.applications]);
      setNextApplicationBefore(result.nextBefore);
    });
  }

  const activeLabel = navigation.find((item) => item.id === view)?.label ?? "管理后台";

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand"><ShieldLockRegular /><strong>Liteasy 管理后台</strong></div>
        <div className="admin-topbar-actions">
          <span className="admin-subject">{identity?.principal.subjectId ?? session.subjectId}</span>
          {identity?.principal.roles.map((role) => (
            <Badge appearance="filled" className="admin-role-badge" color="brand" key={role}>
              {roleLabel(role)}
            </Badge>
          ))}
          {identity ? (
            <Badge appearance="tint" className="admin-authentication-badge" color={identity.authentication.fresh ? "success" : "warning"}>
              {identity.authentication.fresh ? "多因素认证有效" : "需要重新认证"}
            </Badge>
          ) : null}
          <Tooltip content="刷新" relationship="label">
            <Button aria-label="刷新" icon={<ArrowSyncRegular />} onClick={() => void refresh()} />
          </Tooltip>
          <Tooltip content="退出" relationship="label">
            <Button aria-label="退出" icon={<SignOutRegular />} onClick={() => void onLogout()} />
          </Tooltip>
        </div>
      </header>

      <aside className="admin-navigation" aria-label="管理功能">
        {navigation.map((item) => (
          <Button
            appearance={view === item.id ? "primary" : "subtle"}
            aria-current={view === item.id ? "page" : undefined}
            icon={item.icon}
            key={item.id}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </aside>

      <main className="admin-content">
        <div className="admin-page-heading">
          <div><h1>{activeLabel}</h1><span>更新于 {formatDate(new Date().toISOString())}</span></div>
          {identity && !identity.authentication.fresh ? (
            <Button appearance="primary" onClick={() => void onReauthenticate()}>重新认证</Button>
          ) : null}
        </div>

        {notice ? (
          <MessageBar intent={notice.intent}>
            <MessageBarBody><MessageBarTitle>{notice.title}</MessageBarTitle>{notice.message}</MessageBarBody>
          </MessageBar>
        ) : null}

        {loading ? <div className="admin-progress"><Spinner label="正在加载" /></div> : null}
        {!loading && view === "overview" ? (
          <Overview
            forumError={forumError}
            governance={governance}
            identity={identity}
            policy={policy}
            sources={sources}
          />
        ) : null}
        {!loading && view === "accounts" ? (
          <AccountsView
            accountDirectory={accountDirectory}
            busy={busy}
            governance={governance}
            identity={identity}
            onAccountPage={(first) => loadAccounts(first, accountDirectory.search)}
            onAccountSearch={searchAccounts}
            onAccountStatus={submitAccountStatus}
            onRoleGrant={submitRoleGrant}
            onRoleRevoke={submitRoleRevoke}
            onSelectAccount={setSelectedAccountSubject}
            selectedAccountSubject={selectedAccountSubject}
          />
        ) : null}
        {!loading && view === "applications" ? (
          <ApplicationsView
            applications={applications}
            busy={busy}
            hasMore={Boolean(nextApplicationBefore)}
            onLoadMore={loadMoreApplications}
          />
        ) : null}
        {!loading && view === "organizations" ? (
          <OrganizationsView
            busy={busy}
            onStatusChange={setOrganizationStatus}
            organizations={governance.organizations}
          />
        ) : null}
        {!loading && view === "quotas" ? (
          <QuotaView busy={busy} onLoad={loadQuota} onSave={saveQuota} quota={quota} />
        ) : null}
        {!loading && view === "support" ? (
          <SupportView
            busy={busy}
            grants={governance.supportGrants}
            onDownload={downloadSupportDocument}
            onGrant={submitSupportGrant}
            onRevoke={submitSupportRevoke}
          />
        ) : null}
        {!loading && view === "models" ? (
          <ModelsView
            aiProviderConfiguration={aiProviderConfiguration}
            busy={busy}
            onCancelSource={() => setSourceDraft(null)}
            onEditSource={setSourceDraft}
            onRemoveSource={removeSource}
            onSavePolicy={submitModelPolicy}
            onSaveAiProviderConfiguration={submitAiProviderConfiguration}
            onSaveSource={submitSource}
            policy={policy}
            sourceDraft={sourceDraft}
            sources={sources}
          />
        ) : null}
        {!loading && view === "visualization" ? (
          <VisualizationGovernanceView
            api={api}
            principal={identity ? { ...identity.principal, authenticationFresh: identity.authentication.fresh } : null}
          />
        ) : null}
        {!loading && view === "audit" ? (
          <AuditView
            busy={busy}
            events={auditEvents}
            hasMore={Boolean(nextAuditBefore)}
            onFilter={filterAudit}
            onLoadMore={loadMoreAudit}
          />
        ) : null}
        {!loading && view === "forum" ? (
          <ForumView
            annotations={forumAnnotations}
            appeals={forumTagAppeals}
            busy={busy}
            error={forumError}
            onModerate={moderateAnnotation}
            onResolveAppeal={resolveTagAppeal}
          />
        ) : null}
      </main>

      {confirmation ? (
        <Dialog open onOpenChange={(_, data) => !data.open && setConfirmation(null)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{confirmation.title}</DialogTitle>
              <DialogContent>
                <p className="admin-confirm-detail">{confirmation.detail}</p>
                {confirmation.requireReason ? (
                  <Field label="原因" required>
                    <Textarea
                      autoFocus
                      minLength={8}
                      onChange={(_, data) => setConfirmationReason(data.value)}
                      required
                      value={confirmationReason}
                    />
                  </Field>
                ) : null}
              </DialogContent>
              <DialogActions>
                <Button appearance="secondary" onClick={() => setConfirmation(null)}>取消</Button>
                <Button
                  appearance="primary"
                  disabled={busy || Boolean(confirmation.requireReason && confirmationReason.trim().length < 8)}
                  onClick={() => {
                    const action = confirmation.action;
                    setConfirmation(null);
                    void action(confirmationReason.trim());
                  }}
                >
                  确认
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      ) : null}
    </div>
  );
}

function ApplicationsView({ applications, busy, hasMore, onLoadMore }: {
  applications: MarketingApplication[];
  busy: boolean;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
}) {
  return (
    <div className="admin-view">
      <div className="admin-metrics">
        <div className="admin-metric"><span>申请总数</span><strong>{applications.length}{hasMore ? "+" : ""}</strong></div>
        <div className="admin-metric"><span>已获取安装包</span><strong>{applications.filter((item) => item.installerDownloadedAt).length}</strong></div>
        <div className="admin-metric"><span>今日申请</span><strong>{applications.filter((item) => new Date(item.submittedAt).toDateString() === new Date().toDateString()).length}</strong></div>
      </div>
      <Section title="体验申请记录">
        {applications.length ? (
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow>
            <TableHeaderCell>提交时间</TableHeaderCell><TableHeaderCell>联系邮箱</TableHeaderCell><TableHeaderCell>身份 / 领域</TableHeaderCell><TableHeaderCell>希望解决的问题</TableHeaderCell><TableHeaderCell>安装包</TableHeaderCell>
          </TableRow></TableHeader><TableBody>
            {applications.map((application) => <TableRow key={application.applicationId}>
              <TableCell>{formatDate(application.submittedAt)}</TableCell>
              <TableCell><a href={`mailto:${application.email}`}>{application.email}</a></TableCell>
              <TableCell>{application.role}<br /><small>{application.field || "未填写"}</small></TableCell>
              <TableCell>{application.problem || "未填写"}</TableCell>
              <TableCell>{application.installerDownloadedAt ? <Badge color="success">已下载</Badge> : <Badge color="informative">未下载</Badge>}<br /><small>{formatDate(application.installerDownloadedAt)}</small></TableCell>
            </TableRow>)}
          </TableBody></Table></div>
        ) : <Empty>暂无体验申请</Empty>}
        {hasMore ? <Button disabled={busy} onClick={() => void onLoadMore()}>加载更多</Button> : null}
      </Section>
    </div>
  );
}

function Overview({
  forumError,
  governance,
  identity,
  policy,
  sources
}: {
  forumError: string;
  governance: GovernanceDirectory;
  identity: AdminIdentity | null;
  policy: ModelPolicy | null;
  sources: RetrievalSource[];
}) {
  return (
    <div className="admin-view">
      <div className="admin-metrics">
        <div className="admin-metric"><span>组织</span><strong>{governance.organizations.filter((item) => item.status !== "deleted").length}</strong></div>
        <div className="admin-metric"><span>活动平台角色</span><strong>{governance.roleGrants.filter((item) => item.state === "active").length}</strong></div>
        <div className="admin-metric"><span>启用检索源</span><strong>{sources.filter((item) => item.enabled).length}</strong></div>
        <div className="admin-metric"><span>活动支持授权</span><strong>{governance.supportGrants.filter((item) => !item.revokedAt && Date.parse(item.expiresAt) > Date.now()).length}</strong></div>
      </div>
      <Section title="当前身份">
        <dl className="admin-details">
          <div><dt>用户标识</dt><dd>{identity?.principal.subjectId ?? "-"}</dd></div>
          <div><dt>平台角色</dt><dd>{identity?.principal.roles.map(roleLabel).join("、") || "-"}</dd></div>
          <div><dt>登录验证</dt><dd>{identity?.authentication.methods.map(authenticationMethodLabel).join("、") || "-"}</dd></div>
          <div><dt>高风险操作认证</dt><dd>{identity?.authentication.fresh ? "最近 5 分钟内已完成多因素认证" : "需要重新完成多因素认证"}</dd></div>
        </dl>
      </Section>
      <Section title="模型策略">
        {policy ? (
          <dl className="admin-details">
            <div><dt>默认 Provider</dt><dd>{policy.defaultProvider}</dd></div>
            <div><dt>代理端点</dt><dd>{policy.cloudProxyEndpoint}</dd></div>
            <div><dt>修订号</dt><dd>{policy.revision}</dd></div>
            <div><dt>更新者</dt><dd>{policy.updatedBy}</dd></div>
          </dl>
        ) : <Empty>未配置模型策略</Empty>}
      </Section>
      {forumError ? (
        <MessageBar intent="warning"><MessageBarBody><MessageBarTitle>论坛治理不可用</MessageBarTitle>{forumError}</MessageBarBody></MessageBar>
      ) : null}
    </div>
  );
}

function AccountsView({ accountDirectory, busy, governance, identity, onAccountPage, onAccountSearch, onAccountStatus, onRoleGrant, onRoleRevoke, onSelectAccount, selectedAccountSubject }: {
  accountDirectory: AccountDirectoryPage;
  busy: boolean;
  governance: GovernanceDirectory;
  identity: AdminIdentity | null;
  onAccountPage: (first: number) => Promise<void>;
  onAccountSearch: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onAccountStatus: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRoleGrant: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRoleRevoke: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSelectAccount: (subjectId: string) => void;
  selectedAccountSubject: string;
}) {
  const pageEnd = Math.min(accountDirectory.first + accountDirectory.accounts.length, accountDirectory.total);
  const selectedAccount = accountDirectory.accounts.find((account) => account.subjectId === selectedAccountSubject);
  const selectedRoleGrants = selectedAccount?.activeRoleGrants ?? [];
  return (
    <div className="admin-view">
      <Section title="账号目录">
        <form className="admin-filter" onSubmit={onAccountSearch}>
          <Field label="搜索账号">
            <Input defaultValue={accountDirectory.search} maxLength={100} name="search" placeholder="用户名、邮箱或姓名" />
          </Field>
          <Button disabled={busy} icon={<SearchRegular />} type="submit">搜索</Button>
        </form>
        <div className="admin-directory-summary">
          <span>共 {accountDirectory.total} 个账号</span>
          {accountDirectory.total ? <span>当前显示 {accountDirectory.first + 1}-{pageEnd}</span> : null}
        </div>
        {accountDirectory.accounts.length ? (
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow>
            <TableHeaderCell>账号</TableHeaderCell><TableHeaderCell>邮箱</TableHeaderCell><TableHeaderCell>身份状态</TableHeaderCell><TableHeaderCell>平台角色</TableHeaderCell><TableHeaderCell>创建时间</TableHeaderCell><TableHeaderCell>用户标识</TableHeaderCell><TableHeaderCell>操作</TableHeaderCell>
          </TableRow></TableHeader><TableBody>
            {accountDirectory.accounts.map((account) => {
              const name = [account.firstName, account.lastName].filter(Boolean).join(" ");
              return <TableRow key={account.subjectId}>
                <TableCell>{name || account.username}<br /><small>{name ? account.username : account.accountType === "service" ? "服务账号" : "个人账号"}</small></TableCell>
                <TableCell>{account.email || "-"}{account.email ? <><br /><small>{account.emailVerified ? "已验证" : "未验证"}</small></> : null}</TableCell>
                <TableCell><Badge color={account.enabled ? "success" : "danger"}>{account.enabled ? "启用" : "禁用"}</Badge>{account.projectedStatus ? <><br /><small>平台记录：{accountStatusLabel(account.projectedStatus.status)}</small></> : null}</TableCell>
                <TableCell>{account.platformRoles.length ? account.platformRoles.map(roleLabel).join("、") : "-"}</TableCell>
                <TableCell>{formatDate(account.createdAt)}</TableCell>
                <TableCell><span className="admin-identifier">{account.subjectId}</span></TableCell>
                <TableCell><Button appearance="subtle" onClick={() => onSelectAccount(account.subjectId)}>用于操作</Button></TableCell>
              </TableRow>;
            })}
          </TableBody></Table></div>
        ) : <Empty>{accountDirectory.search ? "没有匹配的账号" : "暂无账号"}</Empty>}
        <div className="admin-directory-pagination">
          <Button disabled={busy || accountDirectory.first === 0} onClick={() => void onAccountPage(Math.max(0, accountDirectory.first - accountDirectory.max))}>上一页</Button>
          <Button disabled={busy || pageEnd >= accountDirectory.total} onClick={() => void onAccountPage(accountDirectory.first + accountDirectory.max)}>下一页</Button>
        </div>
      </Section>
      <div className="admin-two-columns">
      <Section title="变更账号状态">
        <form className="admin-form" onSubmit={onAccountStatus}>
          <Field hint="可从上方账号目录选择，也可填写 Keycloak 用户 ID。" label="用户标识" required><Input name="subjectId" onChange={(_, data) => onSelectAccount(data.value)} required value={selectedAccountSubject} /></Field>
          <Field label="目标状态" required>
            <Select name="status"><option value="active">启用</option><option value="disabled">禁用</option><option value="deleted">删除</option></Select>
          </Field>
          <ReasonField />
          <Button appearance="primary" disabled={busy} icon={<PersonSettingsRegular />} type="submit">提交变更</Button>
        </form>
      </Section>
      <Section title="授予平台角色">
        <form className="admin-form" onSubmit={onRoleGrant}>
          <Field hint="可从上方账号目录选择，也可填写 Keycloak 用户 ID。" label="用户标识" required><Input name="subjectId" onChange={(_, data) => onSelectAccount(data.value)} required value={selectedAccountSubject} /></Field>
          <Field hint="开发诊断管理员仅用于受控环境故障诊断，可查看模型、端点及任务中间诊断信息。" label="平台角色" required>
            <Select name="role" required>
              <option value="platform_admin">平台管理员</option>
              <option value="developer_diagnostics">开发诊断管理员</option>
            </Select>
          </Field>
          <ReasonField />
          <Button appearance="primary" disabled={busy} icon={<SaveRegular />} type="submit">授予角色</Button>
        </form>
      </Section>
      <Section title="撤销平台角色">
        <form className="admin-form" onSubmit={onRoleRevoke}>
          <Field hint={selectedAccount ? `当前账号：${selectedAccount.username}` : "请先在账号目录中选择账号。"} label="要撤销的平台角色" required>
            <Select disabled={!selectedRoleGrants.length} key={selectedAccountSubject} name="grantId" required>
              {!selectedRoleGrants.length ? <option value="">该账号没有活动的平台角色</option> : null}
              {selectedRoleGrants.map((grant) => <option key={grant.grantId} value={grant.grantId}>{roleLabel(grant.role)}</option>)}
            </Select>
          </Field>
          <ReasonField />
          <Button appearance="secondary" disabled={busy || !selectedRoleGrants.length} icon={<DeleteRegular />} type="submit">撤销角色</Button>
        </form>
      </Section>
      <Section title="我的角色授权">
        {identity?.principal.grants.length ? (
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>Grant ID</TableHeaderCell><TableHeaderCell>角色</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell></TableRow></TableHeader><TableBody>
            {identity.principal.grants.map((grant) => <TableRow key={grant.grantId}><TableCell>{grant.grantId}</TableCell><TableCell>{grant.role}</TableCell><TableCell>{grant.state}</TableCell></TableRow>)}
          </TableBody></Table></div>
        ) : <Empty>没有活动角色授权</Empty>}
      </Section>
      <Section title="平台角色授权">
        {governance.roleGrants.length ? (
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>Subject</TableHeaderCell><TableHeaderCell>角色</TableHeaderCell><TableHeaderCell>Grant ID</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell></TableRow></TableHeader><TableBody>
            {governance.roleGrants.map((grant) => <TableRow key={grant.grantId}><TableCell>{grant.subjectId}</TableCell><TableCell>{grant.role}</TableCell><TableCell>{grant.grantId}</TableCell><TableCell>{grant.state}</TableCell></TableRow>)}
          </TableBody></Table></div>
        ) : <Empty>没有平台角色授权</Empty>}
      </Section>
      <Section title="账号状态变更记录">
        {governance.accountStatuses.length ? (
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>Subject</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>更新时间</TableHeaderCell><TableHeaderCell>原因</TableHeaderCell></TableRow></TableHeader><TableBody>
            {governance.accountStatuses.map((account) => <TableRow key={account.subjectId}><TableCell>{account.subjectId}</TableCell><TableCell>{account.status}</TableCell><TableCell>{formatDate(account.updatedAt)}</TableCell><TableCell>{account.reason}</TableCell></TableRow>)}
          </TableBody></Table></div>
        ) : <Empty>没有账号状态变更记录</Empty>}
      </Section>
      </div>
    </div>
  );
}

function OrganizationsView({ busy, onStatusChange, organizations }: {
  busy: boolean;
  onStatusChange: (organization: OrganizationGovernance) => void;
  organizations: OrganizationGovernance[];
}) {
  return (
    <div className="admin-view">
      <Section title="组织">
        {organizations.length ? (
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>组织</TableHeaderCell><TableHeaderCell>负责人</TableHeaderCell><TableHeaderCell>成员</TableHeaderCell><TableHeaderCell>存储</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>操作</TableHeaderCell></TableRow></TableHeader><TableBody>
            {organizations.map((organization) => <TableRow key={organization.organizationId}>
              <TableCell>{organization.name}<br /><small>{organization.organizationId}</small></TableCell>
              <TableCell>{organization.ownerSubject}</TableCell>
              <TableCell>{organization.memberCount}</TableCell>
              <TableCell>{formatBytes(organization.usedBytes)} / {formatBytes(organization.limitBytes)}</TableCell>
              <TableCell><Badge color={organization.status === "active" ? "success" : organization.status === "suspended" ? "warning" : "danger"}>{organization.status}</Badge></TableCell>
              <TableCell>{organization.status !== "deleted" ? <Button appearance="secondary" disabled={busy} onClick={() => onStatusChange(organization)}>{organization.status === "active" ? "暂停" : "恢复"}</Button> : null}</TableCell>
            </TableRow>)}
          </TableBody></Table></div>
        ) : <Empty>没有组织</Empty>}
      </Section>
    </div>
  );
}

function QuotaView({ busy, onLoad, onSave, quota }: {
  busy: boolean;
  onLoad: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  quota: StorageQuota | null;
}) {
  return (
    <div className="admin-view admin-two-columns">
      <Section title="查询配额">
        <form className="admin-form" onSubmit={onLoad}>
          <Field label="作用域" required><Select name="scopeType"><option value="user">用户</option><option value="organization">组织</option></Select></Field>
          <Field label="作用域 ID" required><Input name="scopeId" required /></Field>
          <Button appearance="primary" disabled={busy} type="submit">查询</Button>
        </form>
      </Section>
      <Section title="当前配额">
        {quota ? (
          <>
            <dl className="admin-details">
              <div><dt>已使用</dt><dd>{formatBytes(quota.usedBytes)}</dd></div>
              <div><dt>上限</dt><dd>{formatBytes(quota.limitBytes)}</dd></div>
              <div><dt>修订号</dt><dd>{quota.revision}</dd></div>
              <div><dt>更新者</dt><dd>{quota.updatedBy ?? "-"}</dd></div>
            </dl>
            <form className="admin-form admin-form-spaced" onSubmit={onSave}>
              <Field label="字节上限" required><Input defaultValue={String(quota.limitBytes ?? 0)} min="0" name="limitBytes" required type="number" /></Field>
              <ReasonField />
              <Button appearance="primary" disabled={busy} icon={<SaveRegular />} type="submit">保存配额</Button>
            </form>
          </>
        ) : <Empty>尚未选择配额作用域</Empty>}
      </Section>
    </div>
  );
}

function SupportView({ busy, grants, onDownload, onGrant, onRevoke }: {
  busy: boolean;
  grants: GovernanceDirectory["supportGrants"];
  onDownload: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onGrant: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRevoke: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <div className="admin-view admin-two-columns">
      <Section title="授予限时访问">
        <form className="admin-form" onSubmit={onGrant}>
          <Field label="管理员 Subject" required><Input name="granteeSubject" required /></Field>
          <Field label="作用域" required><Select name="scopeType"><option value="user">用户</option><option value="organization">组织</option></Select></Field>
          <Field label="作用域 ID" required><Input name="scopeId" required /></Field>
          <Field label="文献 ID" required><Input name="documentId" required /></Field>
          <Field label="分钟" required><Input defaultValue="15" max="60" min="1" name="durationMinutes" required type="number" /></Field>
          <ReasonField minimum={12} />
          <Button appearance="primary" disabled={busy} icon={<KeyRegular />} type="submit">授予访问</Button>
        </form>
      </Section>
      <Section title="撤销访问">
        <form className="admin-form" onSubmit={onRevoke}>
          <Field label="Grant ID" required><Input name="grantId" required /></Field>
          <ReasonField />
          <Button appearance="secondary" disabled={busy} icon={<DeleteRegular />} type="submit">撤销访问</Button>
        </form>
      </Section>
      <Section title="下载支持文献">
        <form className="admin-form" onSubmit={onDownload}>
          <Field label="Grant ID" required><Input name="grantId" required /></Field>
          <Field label="文献 ID" required><Input name="documentId" required /></Field>
          <Button appearance="primary" disabled={busy} icon={<DocumentArrowDownRegular />} type="submit">下载 PDF</Button>
        </form>
      </Section>
      <Section title="支持授权">
        {grants.length ? (
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>Grant ID</TableHeaderCell><TableHeaderCell>管理员</TableHeaderCell><TableHeaderCell>文献</TableHeaderCell><TableHeaderCell>到期</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell></TableRow></TableHeader><TableBody>
            {grants.map((grant) => <TableRow key={grant.grantId}><TableCell>{grant.grantId}</TableCell><TableCell>{grant.granteeSubject}</TableCell><TableCell>{grant.documentId}</TableCell><TableCell>{formatDate(grant.expiresAt)}</TableCell><TableCell>{grant.revokedAt ? "已撤销" : Date.parse(grant.expiresAt) <= Date.now() ? "已过期" : "有效"}</TableCell></TableRow>)}
          </TableBody></Table></div>
        ) : <Empty>没有支持授权</Empty>}
      </Section>
    </div>
  );
}

function ModelsView({
  aiProviderConfiguration,
  busy,
  onCancelSource,
  onEditSource,
  onRemoveSource,
  onSavePolicy,
  onSaveAiProviderConfiguration,
  onSaveSource,
  policy,
  sourceDraft,
  sources
}: {
  aiProviderConfiguration: AiProviderConfigurationStatus;
  busy: boolean;
  onCancelSource: () => void;
  onEditSource: (source: RetrievalSource) => void;
  onRemoveSource: (source: RetrievalSource) => void;
  onSavePolicy: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSaveAiProviderConfiguration: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSaveSource: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  policy: ModelPolicy | null;
  sourceDraft: RetrievalSource | null;
  sources: RetrievalSource[];
}) {
  return (
    <div className="admin-view">
      <Section title="AI 服务凭据">
        <dl className="admin-details">
          <div><dt>模型服务</dt><dd><Badge color={aiProviderConfiguration.modelProviderConfigured ? "success" : "warning"}>{aiProviderConfiguration.modelProviderConfigured ? "已配置" : "未配置"}</Badge></dd></div>
          <div><dt>MinerU</dt><dd><Badge color={aiProviderConfiguration.mineruConfigured ? "success" : "warning"}>{aiProviderConfiguration.mineruConfigured ? "已配置" : "未配置"}</Badge></dd></div>
          <div><dt>修订号</dt><dd>{aiProviderConfiguration.revision}</dd></div>
          <div><dt>更新时间</dt><dd>{formatDate(aiProviderConfiguration.updatedAt)}</dd></div>
        </dl>
        <form className="admin-form admin-form-horizontal" onSubmit={onSaveAiProviderConfiguration}>
          <Field label="文本 API 地址" required><Input autoComplete="off" defaultValue="https://api.deepseek.com" name="textBaseUrl" readOnly required type="url" /></Field>
          <Field label="文本模型" required><Input autoComplete="off" defaultValue="deepseek-chat" name="textModel" readOnly required /></Field>
          <Field label="文本 API Key" required><Input autoComplete="new-password" name="textApiKey" required type="password" /></Field>
          <Field label="视觉 API 地址（留空保留）"><Input autoComplete="off" name="visionBaseUrl" placeholder="https://vip.auto-code.net/v1" type="url" /></Field>
          <Field label="视觉模型（留空保留）"><Input autoComplete="off" name="visionModel" placeholder="gpt-5.6-sol" /></Field>
          <Field label="视觉 API Key（留空保留）"><Input autoComplete="new-password" name="visionApiKey" type="password" /></Field>
          <Field label="MinerU Token（留空保留）"><Input autoComplete="new-password" name="mineruToken" type="password" /></Field>
          <ReasonField />
          <Button appearance="primary" disabled={busy || !aiProviderConfiguration.writable} icon={<ShieldLockRegular />} type="submit">加密保存并应用</Button>
        </form>
      </Section>
      <Section title="模型代理策略">
        <form className="admin-form admin-form-horizontal" key={policy?.revision ?? 0} onSubmit={onSavePolicy}>
          <Field label="代理端点" required><Input defaultValue={policy?.cloudProxyEndpoint ?? ""} name="cloudProxyEndpoint" required type="url" /></Field>
          <Field label="默认 Provider" required><Input defaultValue={policy?.defaultProvider ?? ""} name="defaultProvider" required /></Field>
          <ReasonField />
          <Button appearance="primary" disabled={busy} icon={<SaveRegular />} type="submit">保存策略</Button>
        </form>
      </Section>
      <Section title={sourceDraft ? "编辑检索源" : "新增检索源"}>
        <form className="admin-form admin-form-horizontal" key={sourceDraft?.sourceId ?? "new"} onSubmit={onSaveSource}>
          <Field label="名称" required><Input defaultValue={sourceDraft?.name ?? ""} maxLength={120} name="name" required /></Field>
          <Field label="类型" required><Select defaultValue={sourceDraft?.sourceKind ?? "database"} name="sourceKind"><option value="website">网站</option><option value="database">数据库</option></Select></Field>
          <Field label="连接器" required><Select defaultValue={sourceDraft?.connectorType ?? "crossref"} name="connectorType"><option value="crossref">Crossref</option><option value="openalex">OpenAlex</option><option value="semantic_scholar">Semantic Scholar</option></Select></Field>
          <Field label="状态"><Select defaultValue={String(sourceDraft?.enabled ?? true)} name="enabled"><option value="true">启用</option><option value="false">停用</option></Select></Field>
          <ReasonField />
          <div className="admin-form-actions">
            <Button appearance="primary" disabled={busy} icon={<SaveRegular />} type="submit">保存</Button>
            {sourceDraft ? <Button appearance="secondary" onClick={onCancelSource} type="button">取消编辑</Button> : null}
          </div>
        </form>
      </Section>
      <Section title="检索源">
        {sources.length ? (
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>名称</TableHeaderCell><TableHeaderCell>连接器</TableHeaderCell><TableHeaderCell>类型</TableHeaderCell><TableHeaderCell>地址</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>操作</TableHeaderCell></TableRow></TableHeader><TableBody>
            {sources.map((source) => (
              <TableRow key={source.sourceId}>
                <TableCell>{source.name}</TableCell><TableCell>{source.connectorType ?? "待重新配置"}</TableCell><TableCell>{source.sourceKind}</TableCell><TableCell>{source.baseUrl}</TableCell>
                <TableCell><Badge color={source.enabled ? "success" : "subtle"}>{source.enabled ? "启用" : "停用"}</Badge></TableCell>
                <TableCell><div className="admin-row-actions"><Button appearance="subtle" onClick={() => onEditSource(source)}>编辑</Button><Button appearance="subtle" icon={<DeleteRegular />} onClick={() => onRemoveSource(source)}>移除</Button></div></TableCell>
              </TableRow>
            ))}
          </TableBody></Table></div>
        ) : <Empty>没有检索源</Empty>}
      </Section>
    </div>
  );
}

function AuditView({ busy, events, hasMore, onFilter, onLoadMore }: {
  busy: boolean;
  events: AuditEvent[];
  hasMore: boolean;
  onFilter: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onLoadMore: () => Promise<void>;
}) {
  return (
    <div className="admin-view">
      <form className="admin-filter" onSubmit={onFilter}>
        <Field label="动作"><Input name="action" /></Field>
        <Button appearance="primary" disabled={busy} type="submit">筛选</Button>
      </form>
      <Section title="审计事件">
        {events.length ? (
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>操作者</TableHeaderCell><TableHeaderCell>动作</TableHeaderCell><TableHeaderCell>资源</TableHeaderCell><TableHeaderCell>原因</TableHeaderCell><TableHeaderCell>Trace ID</TableHeaderCell></TableRow></TableHeader><TableBody>
            {events.map((event) => <TableRow key={event.auditId}><TableCell>{formatDate(event.occurredAt)}</TableCell><TableCell>{event.actorId}</TableCell><TableCell>{event.action}</TableCell><TableCell>{event.resourceType}{event.resourceId ? `:${event.resourceId}` : ""}</TableCell><TableCell>{event.reason ?? "-"}</TableCell><TableCell>{event.traceId}</TableCell></TableRow>)}
          </TableBody></Table></div>
        ) : <Empty>没有审计事件</Empty>}
        {hasMore ? <Button appearance="secondary" disabled={busy} onClick={() => void onLoadMore()}>加载更多</Button> : null}
      </Section>
    </div>
  );
}

function ForumView({ annotations, appeals, busy, error, onModerate, onResolveAppeal }: {
  annotations: ForumAnnotation[];
  appeals: ForumTagAppeal[];
  busy: boolean;
  error: string;
  onModerate: (annotation: ForumAnnotation) => void;
  onResolveAppeal: (appeal: ForumTagAppeal, decision: "accepted" | "rejected") => void;
}) {
  if (error) return <MessageBar intent="error"><MessageBarBody><MessageBarTitle>论坛治理不可用</MessageBarTitle>{error}</MessageBarBody></MessageBar>;
  return (
    <div className="admin-view">
      <Section title="平台标签申诉">
        {appeals.length ? (
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>标签</TableHeaderCell><TableHeaderCell>批注</TableHeaderCell><TableHeaderCell>申诉人</TableHeaderCell><TableHeaderCell>理由</TableHeaderCell><TableHeaderCell>操作</TableHeaderCell></TableRow></TableHeader><TableBody>
            {appeals.map((appeal) => <TableRow key={appeal.appealId}><TableCell>#{appeal.tag}</TableCell><TableCell>{appeal.annotationBody.slice(0, 100)}</TableCell><TableCell>{appeal.authorName}<br /><small>{appeal.submittedBy}</small></TableCell><TableCell>{appeal.reason}</TableCell><TableCell><div className="admin-row-actions"><Button appearance="primary" disabled={busy} onClick={() => onResolveAppeal(appeal, "accepted")}>移除标签</Button><Button appearance="secondary" disabled={busy} onClick={() => onResolveAppeal(appeal, "rejected")}>维持标签</Button></div></TableCell></TableRow>)}
          </TableBody></Table></div>
        ) : <Empty>没有待审核的标签申诉</Empty>}
      </Section>
      <Section title="批注">
        {annotations.length ? (
          <div className="admin-table-wrap"><Table size="small"><TableHeader><TableRow><TableHeaderCell>批注</TableHeaderCell><TableHeaderCell>作者</TableHeaderCell><TableHeaderCell>可见范围</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>操作</TableHeaderCell></TableRow></TableHeader><TableBody>
            {annotations.map((annotation) => {
              const withdrawn = Boolean(annotation.withdrawnAt);
              return <TableRow key={annotation.id}><TableCell>{annotation.body.slice(0, 100)}</TableCell><TableCell>{annotation.authorName || annotation.authorId}</TableCell><TableCell>{annotation.visibility}</TableCell><TableCell><Badge color={withdrawn ? "danger" : "success"}>{withdrawn ? "已撤回" : "有效"}</Badge></TableCell><TableCell><Button appearance="secondary" disabled={busy} onClick={() => onModerate(annotation)}>{withdrawn ? "恢复" : "撤回"}</Button></TableCell></TableRow>;
            })}
          </TableBody></Table></div>
        ) : <Empty>没有批注</Empty>}
      </Section>
    </div>
  );
}
