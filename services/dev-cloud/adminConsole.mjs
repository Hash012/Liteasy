import { getPublicOrigin } from "./config.mjs";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPercent(used, limit) {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return "0%";
  }

  return `${Math.round((used / limit) * 100)}%`;
}

export function buildAdminGovernanceDashboardPayload(request, config, builders) {
  const organizationList = builders.buildOrganizationListPayload({});
  const governance = builders.buildOrganizationGovernancePayload({}).summary;
  const demoState = builders.buildAdminDemoStatePayload();
  const publicOrigin = getPublicOrigin(request, config);

  return {
    dashboard: {
      name: "Liteasy Operations Governance Dashboard",
      environment: "local-demo",
      generatedAt: "2026-05-15T00:00:00Z",
      apiPolicy: {
        defaultProvider: config.defaultProvider,
        localDirectEnabled: config.localDirectEnabled,
        modelAccessMode: config.modelAccessMode,
        policyVersion: config.policyVersion
      },
      users: {
        activeUsers: 16,
        desktopCustomers: organizationList.organizations.length,
        pendingSupportTickets: 2
      },
      threeEndStatus: {
        desktop: {
          label: "客户桌面软件端",
          status: "manual-start",
          url: config.desktopOrigin ?? "http://127.0.0.1:1420/"
        },
        devCloud: {
          label: "服务器部署端",
          status: "online",
          url: `${publicOrigin}/`
        },
        adminConsole: {
          label: "内部运营与运维后台",
          status: "online",
          url: `${publicOrigin}/admin/`
        }
      },
      organizations: organizationList.organizations,
      auditQueue: governance.auditQueue,
      demoState,
      quota: governance.quota,
      runningTasks: governance.runningTasks,
      recentAuditEvents: governance.recentAuditEvents
    }
  };
}

export function buildAdminConsoleHtml(request, config, builders) {
  const dashboard = buildAdminGovernanceDashboardPayload(request, config, builders).dashboard;
  const modelCallsPercent = formatPercent(dashboard.quota.modelCallsUsed, dashboard.quota.modelCallsLimit);
  const storagePercent = formatPercent(dashboard.quota.storageUsedGb, dashboard.quota.storageLimitGb);
  const endpointCards = Object.values(dashboard.threeEndStatus)
    .map(
      (endpoint) => `<div class="endpoint">
            <span class="status-pill">${escapeHtml(endpoint.status)}</span>
            <strong>${escapeHtml(endpoint.label)}</strong><br />
            <a href="${escapeHtml(endpoint.url)}">${escapeHtml(endpoint.url)}</a>
          </div>`
    )
    .join("");
  const apiPolicyItems = [
    ["默认 Provider", dashboard.apiPolicy.defaultProvider],
    ["模型接入模式", dashboard.apiPolicy.modelAccessMode],
    ["本地直连策略", dashboard.apiPolicy.localDirectEnabled ? "已开放" : "未开放"],
    ["策略版本", dashboard.apiPolicy.policyVersion]
  ]
    .map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
  const organizationRows = dashboard.organizations
    .map(
      (organization) => `<tr>
              <td>${escapeHtml(organization.name)}</td>
              <td>${escapeHtml(organization.myRole)}</td>
              <td>${escapeHtml(organization.memberCount)}</td>
              <td>${escapeHtml(organization.sharedLibraryName)}</td>
            </tr>`
    )
    .join("");
  const runningTasks = dashboard.runningTasks
    .map((task) => `<li><strong>${escapeHtml(task.label)}</strong><span>${escapeHtml(task.status)}</span></li>`)
    .join("");
  const recentAuditEvents = dashboard.recentAuditEvents
    .map((event) => `<li><strong>${escapeHtml(event.label)}</strong><span>${escapeHtml(event.risk)}</span></li>`)
    .join("");
  const demoActivities = dashboard.demoState.activities
    .map((activity) => `<li><strong>${escapeHtml(activity.label)}</strong><span>${escapeHtml(activity.at)}</span></li>`)
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Liteasy Operations Console</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; background: #f4f1ea; color: #1f3345; font-family: ui-serif, "Noto Serif SC", serif; }
      main { max-width: 1120px; margin: 0 auto; padding: 48px 24px; }
      .card { border: 1px solid #d9d2c3; border-radius: 18px; background: rgba(255, 255, 255, 0.86); box-shadow: 0 18px 40px rgba(31, 51, 69, 0.08); padding: 24px; }
      h1 { margin: 0 0 8px; font-size: 34px; }
      h2 { margin: 30px 0 12px; font-size: 20px; }
      p { line-height: 1.7; }
      code, a { color: #24527a; }
      table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 14px; }
      th, td { border-bottom: 1px solid #e7dfd0; padding: 12px 10px; text-align: left; }
      th { color: #5c6470; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 16px; }
      .endpoint, .metric { border: 1px solid #e2dccf; border-radius: 14px; padding: 14px; background: #fbfaf7; }
      .label { color: #6b7280; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
      .status-pill { float: right; border: 1px solid #c8d7ca; border-radius: 999px; background: #edf6ee; color: #315f3d; font-size: 11px; font-weight: 800; padding: 3px 8px; }
      .metric strong { display: block; margin-top: 8px; font-size: 30px; }
      .metric span { color: #6b7280; font-size: 13px; }
      .stack { display: grid; gap: 10px; list-style: none; margin: 0; padding: 0; }
      .stack li { align-items: center; background: #fbfaf7; border: 1px solid #e2dccf; border-radius: 14px; display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; }
      .stack span { border-radius: 999px; background: #f1efe8; color: #5c6470; font-size: 12px; font-weight: 800; padding: 4px 9px; }
      form { border: 1px solid #e2dccf; border-radius: 14px; background: #fbfaf7; display: grid; gap: 12px; margin-top: 14px; padding: 16px; }
      label { display: grid; gap: 6px; color: #5c6470; font-size: 13px; font-weight: 800; }
      select { border: 1px solid #d9d2c3; border-radius: 10px; color: #1f3345; font: inherit; padding: 9px 10px; }
      button { border: 1px solid #24415f; border-radius: 999px; background: #1f3345; color: #fff; cursor: pointer; font: inherit; font-weight: 800; padding: 10px 14px; }
      .form-status { color: #315f3d; font-size: 13px; font-weight: 800; min-height: 18px; }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <div class="label">内部运营与运维后台</div>
        <h1>Liteasy Operations Console</h1>
        <p>这是 Liteasy 内部运营和运维团队使用的本地 demo 后台，用于配置 API 策略、观察客户组织资源、配额、后台任务和审计队列；桌面软件端才是客户使用的产品。生成时间：${escapeHtml(dashboard.generatedAt)}。</p>
        <div class="grid">${endpointCards}</div>
        <h2>平台资源摘要</h2>
        <div class="grid">
          <div class="metric"><span>模型调用配额</span><strong>${escapeHtml(modelCallsPercent)}</strong><span>${escapeHtml(dashboard.quota.modelCallsUsed)} / ${escapeHtml(dashboard.quota.modelCallsLimit)} 次</span></div>
          <div class="metric"><span>存储使用量</span><strong>${escapeHtml(storagePercent)}</strong><span>${escapeHtml(dashboard.quota.storageUsedGb)} GB / ${escapeHtml(dashboard.quota.storageLimitGb)} GB</span></div>
          <div class="metric"><span>待审核队列</span><strong>${escapeHtml(dashboard.auditQueue.pendingReview)}</strong><span>高风险 ${escapeHtml(dashboard.auditQueue.highRisk)} 项</span></div>
        </div>
        <h2>API 策略</h2>
        <div class="grid">${apiPolicyItems}</div>
        <form id="api-policy-form">
          <div class="label">运维下发 API 策略</div>
          <label>默认 Provider
            <select name="defaultProvider">
              <option value="openai"${dashboard.apiPolicy.defaultProvider === "openai" ? " selected" : ""}>openai</option>
              <option value="mock"${dashboard.apiPolicy.defaultProvider === "mock" ? " selected" : ""}>mock</option>
            </select>
          </label>
          <label>模型接入模式
            <select name="modelAccessMode">
              <option value="cloud_proxy"${dashboard.apiPolicy.modelAccessMode === "cloud_proxy" ? " selected" : ""}>cloud_proxy</option>
              <option value="local_direct"${dashboard.apiPolicy.modelAccessMode === "local_direct" ? " selected" : ""}>local_direct</option>
            </select>
          </label>
          <label>本地直连策略
            <select name="localDirectEnabled">
              <option value="false"${dashboard.apiPolicy.localDirectEnabled ? "" : " selected"}>未开放</option>
              <option value="true"${dashboard.apiPolicy.localDirectEnabled ? " selected" : ""}>已开放</option>
            </select>
          </label>
          <button type="submit">保存 API 策略</button>
          <div class="form-status" id="api-policy-status"></div>
        </form>
        <h2>用户与账号</h2>
        <div class="grid">
          <div class="metric"><span>活跃客户用户</span><strong>${escapeHtml(dashboard.users.activeUsers)}</strong><span>来自 ${escapeHtml(dashboard.users.desktopCustomers)} 个客户组织</span></div>
          <div class="metric"><span>待处理支持请求</span><strong>${escapeHtml(dashboard.users.pendingSupportTickets)}</strong><span>demo 运维队列</span></div>
          <div class="metric"><span>活跃会话数</span><strong>${escapeHtml(dashboard.demoState.summary.activeSessionCount)}</strong><span>来自当前 Demo 状态</span></div>
          <div class="metric"><span>收藏总数</span><strong>${escapeHtml(dashboard.demoState.summary.collectionItemCount)}</strong><span>用户云端私有长期数据</span></div>
          <div class="metric"><span>推荐缓存条目数</span><strong>${escapeHtml(dashboard.demoState.summary.recommendationCacheEntryCount)}</strong><span>当前云端缓存 scope</span></div>
        </div>
        <h2>客户组织资源</h2>
        <table>
          <thead><tr><th>客户组织</th><th>客户侧角色样例</th><th>成员</th><th>共享文献库</th></tr></thead>
          <tbody>${organizationRows}</tbody>
        </table>
        <h2>最近活动</h2>
        <ul class="stack">${demoActivities}</ul>
        <h2>后台任务</h2>
        <ul class="stack">${runningTasks}</ul>
        <h2>近期审计</h2>
        <ul class="stack">${recentAuditEvents}</ul>
        <h2>Demo 运维动作</h2>
        <form id="demo-ops-form">
          <div class="label">Roadshow Controls</div>
          <button type="button" id="demo-reset-button">重置 Demo 数据</button>
          <button type="button" id="demo-reseed-button">重新播种 Demo 数据</button>
          <div class="form-status" id="demo-ops-status"></div>
        </form>
        <h2>运维数据接口</h2>
        <p><code>/v1/admin/governance-dashboard</code></p>
        <p><code>/v1/admin/demo-state</code></p>
      </section>
    </main>
    <script>
      const form = document.getElementById("api-policy-form");
      const status = document.getElementById("api-policy-status");
      const demoOpsStatus = document.getElementById("demo-ops-status");
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const response = await fetch("/v1/admin/model-policy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            defaultProvider: formData.get("defaultProvider"),
            localDirectEnabled: formData.get("localDirectEnabled") === "true",
            modelAccessMode: formData.get("modelAccessMode")
          })
        });
        const payload = await response.json();
        status.textContent = response.ok
          ? "已保存策略：" + payload.policy.policyVersion
          : "策略保存失败";
      });
      document.getElementById("demo-reset-button")?.addEventListener("click", async () => {
        const response = await fetch("/v1/admin/demo-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const payload = await response.json();
        demoOpsStatus.textContent = response.ok && payload.reset ? "已重置 Demo 数据" : "Demo 重置失败";
      });
      document.getElementById("demo-reseed-button")?.addEventListener("click", async () => {
        const response = await fetch("/v1/admin/demo-reseed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const payload = await response.json();
        demoOpsStatus.textContent = response.ok && payload.reseeded ? "已重新播种 Demo 数据" : "Demo 播种失败";
      });
    </script>
  </body>
</html>`;
}
