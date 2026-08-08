export function buildAdminConsoleHtml() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Liteasy 管理后台</title>
    <style>
      :root { color-scheme: light; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f5f5f5; color: #242424; }
      header { align-items: center; background: #fff; border-bottom: 1px solid #ddd; display: flex; height: 48px; padding: 0 20px; }
      main { margin: 0 auto; max-width: 1180px; padding: 22px 20px 48px; }
      h1 { font-size: 22px; margin: 0 0 18px; } h2 { font-size: 16px; margin: 0 0 12px; }
      form { align-items: end; display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
      label { color: #424242; display: grid; font-size: 12px; gap: 5px; }
      input, select { background: #fff; border: 1px solid #bdbdbd; border-radius: 4px; font: inherit; min-height: 34px; padding: 6px 9px; width: 100%; }
      input:focus, select:focus { border-color: #0f6cbd; outline: 1px solid #0f6cbd; }
      button { background: #0f6cbd; border: 0; border-radius: 4px; color: #fff; cursor: pointer; font: inherit; min-height: 32px; padding: 5px 12px; width: max-content; }
      button.secondary { background: #fff; border: 1px solid #bdbdbd; color: #242424; }
      button.danger { background: #c50f1f; } button:disabled { cursor: default; opacity: .55; }
      #status { color: #a4262c; font-size: 13px; min-height: 22px; margin-top: 10px; }
      #status.ok { color: #107c10; } [hidden] { display: none !important; }
      .toolbar { align-items: center; display: flex; justify-content: space-between; margin-bottom: 16px; }
      .metrics { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 16px; }
      .metric, section.panel { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 14px; }
      section.panel { margin: 10px 0; } .metric span { color: #616161; display: block; font-size: 12px; }
      .metric strong { display: block; font-size: 22px; margin-top: 4px; }
      .table-wrap { overflow-x: auto; } table { border-collapse: collapse; width: 100%; }
      th, td { border-bottom: 1px solid #e6e6e6; font-size: 12px; padding: 8px; text-align: left; vertical-align: middle; }
      th { color: #616161; font-weight: 600; } td.actions { white-space: nowrap; }
      td.actions button { margin-right: 6px; } .muted { color: #707070; }
      @media (max-width: 640px) { main { padding: 16px 10px 32px; } .metrics { grid-template-columns: 1fr; } form { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header><strong>Liteasy 管理后台</strong></header>
    <main>
      <section id="login">
        <h1>管理员登录</h1>
        <form id="login-form">
          <label>邮箱<input autocomplete="username" name="email" required type="email" /></label>
          <label>密码<input autocomplete="current-password" name="password" required type="password" /></label>
          <label>动态验证码<input autocomplete="one-time-code" inputmode="numeric" maxlength="6" name="mfaCode" pattern="[0-9]{6}" required /></label>
          <button type="submit">登录</button>
        </form>
        <form hidden id="password-form">
          <label>邮箱<input autocomplete="username" name="email" required type="email" /></label>
          <label>一次性密码<input autocomplete="current-password" name="password" required type="password" /></label>
          <label>新密码<input autocomplete="new-password" minlength="12" name="newPassword" required type="password" /></label>
          <label>动态验证码<input autocomplete="one-time-code" inputmode="numeric" maxlength="6" name="mfaCode" pattern="[0-9]{6}" required /></label>
          <button type="submit">更换密码</button>
        </form>
      </section>
      <section hidden id="dashboard">
        <div class="toolbar"><h1>平台治理</h1><button class="secondary" id="logout" type="button">退出</button></div>
        <div class="metrics">
          <div class="metric"><span>用户</span><strong id="user-count">0</strong></div>
          <div class="metric"><span>组织</span><strong id="organization-count">0</strong></div>
          <div class="metric"><span>活动会话</span><strong id="session-count">0</strong></div>
        </div>
        <section class="panel"><h2>账号状态</h2><div class="table-wrap"><table><thead><tr><th>账号</th><th>套餐</th><th>状态</th><th>操作</th></tr></thead><tbody id="account-rows"></tbody></table></div></section>
        <section class="panel"><h2>存储配额</h2><form id="quota-form">
          <label>作用域<select name="scopeType"><option value="user">用户</option><option value="organization">组织</option></select></label>
          <label>作用域 ID<input name="scopeId" required /></label>
          <label>字节上限<input min="0" name="limitBytes" required type="number" /></label>
          <label>原因<input maxlength="500" name="reason" required /></label><button type="submit">更新配额</button>
        </form></section>
        <section class="panel"><h2>模型策略</h2><form id="model-form">
          <label>默认提供方<select name="defaultProvider"><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option></select></label>
          <label>访问模式<select name="modelAccessMode"><option value="cloud_proxy">云端代理</option><option value="local_direct">本地直连</option></select></label>
          <label><span>允许本地直连</span><select name="localDirectEnabled"><option value="false">关闭</option><option value="true">开启</option></select></label>
          <label>原因<input maxlength="500" name="reason" required /></label>
          <button type="submit">保存策略</button>
        </form></section>
        <section class="panel"><h2>检索网站与数据库</h2><form id="source-form">
          <input name="sourceId" type="hidden" /><label>名称<input maxlength="120" name="name" required /></label>
          <label>类型<select name="sourceKind"><option value="website">网站</option><option value="database">数据库</option></select></label>
          <label>基础 URL<input name="baseUrl" placeholder="https://" required type="url" /></label>
          <label>状态<select name="enabled"><option value="true">启用</option><option value="false">停用</option></select></label>
          <label>原因<input maxlength="500" name="reason" required /></label><button type="submit">保存检索源</button>
        </form><div class="table-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>地址</th><th>状态</th><th>操作</th></tr></thead><tbody id="source-rows"></tbody></table></div></section>
        <section class="panel"><h2>限时支持访问</h2><form id="support-form">
          <label>管理员用户 ID<input name="granteeUserId" required /></label>
          <label>作用域<select name="scopeType"><option value="user">用户</option><option value="organization">组织</option></select></label>
          <label>作用域 ID<input name="scopeId" required /></label>
          <label>分钟<input max="60" min="1" name="durationMinutes" required type="number" value="15" /></label>
          <label>原因<input maxlength="1000" name="reason" required /></label><button type="submit">授予访问</button>
        </form><div class="table-wrap"><table><thead><tr><th>授权</th><th>目标</th><th>到期</th><th>状态</th><th>操作</th></tr></thead><tbody id="grant-rows"></tbody></table></div></section>
        <section class="panel"><h2>Intuecho 帖子治理</h2><p class="muted" id="forum-state"></p><div class="table-wrap"><table><thead><tr><th>帖子</th><th>作者</th><th>状态</th><th>操作</th></tr></thead><tbody id="forum-rows"></tbody></table></div></section>
        <section class="panel"><h2>近期审计</h2><div class="table-wrap"><table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>风险</th></tr></thead><tbody id="audit-rows"></tbody></table></div></section>
      </section>
      <div id="status" role="status"></div>
    </main>
    <script>
      let token = "";
      const byId = (id) => document.getElementById(id);
      const request = async (path, options = {}) => {
        const response = await fetch(path, { ...options, headers: { ...(options.headers || {}), Authorization: "Bearer " + token } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || payload.error || "请求失败");
        return payload;
      };
      const post = (path, body) => request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const showStatus = (message, ok = false) => { byId("status").textContent = message; byId("status").className = ok ? "ok" : ""; };
      const formBody = (form) => Object.fromEntries(new FormData(form).entries());
      const cell = (row, value, className) => { const td = row.insertCell(); td.textContent = value ?? ""; if (className) td.className = className; return td; };
      const button = (label, action, danger = false) => { const value = document.createElement("button"); value.type = "button"; value.textContent = label; value.className = danger ? "danger" : "secondary"; value.addEventListener("click", action); return value; };
      function rows(targetId, values, render) { const target = byId(targetId); target.replaceChildren(); values.forEach((value) => render(target.insertRow(), value)); }
      async function refresh() {
        const [data, policy, sources, forum] = await Promise.all([
          request("/v1/admin/governance-dashboard"), request("/v1/admin/model-policy"), request("/v1/admin/retrieval-sources"),
          request("/v1/admin/forum/posts").catch((error) => ({ error: error.message, posts: [] }))
        ]);
        byId("user-count").textContent = data.users.total; byId("organization-count").textContent = data.organizations.total; byId("session-count").textContent = data.sessions.active;
        const model = byId("model-form"); model.elements.defaultProvider.value = policy.defaultProvider; model.elements.modelAccessMode.value = policy.modelAccessMode; model.elements.localDirectEnabled.value = String(policy.localDirectEnabled);
        rows("account-rows", data.users.items, (row, account) => {
          cell(row, account.displayName + "\\n" + account.email); cell(row, account.membershipTier); cell(row, account.status);
          const actions = cell(row, "", "actions");
          if (account.status === "active") actions.append(button("禁用", () => changeAccount(account.id, "disabled"), true));
          if (account.status === "disabled") actions.append(button("启用", () => changeAccount(account.id, "active")));
          if (account.status !== "deleted") actions.append(button("删除", () => changeAccount(account.id, "deleted"), true));
        });
        rows("source-rows", sources.sources, (row, source) => {
          cell(row, source.name); cell(row, source.sourceKind); cell(row, source.baseUrl); cell(row, source.enabled ? "启用" : "停用");
          const actions = cell(row, "", "actions"); actions.append(button("编辑", () => editSource(source))); actions.append(button("移除", () => removeSource(source), true));
        });
        rows("grant-rows", data.supportGrants, (row, grant) => {
          cell(row, grant.grantId); cell(row, grant.scopeType + ":" + grant.scopeId); cell(row, grant.expiresAt); cell(row, grant.revokedAt ? "已撤销" : "有效");
          const actions = cell(row, "", "actions"); if (!grant.revokedAt) actions.append(button("撤销", () => revokeGrant(grant.grantId), true));
        });
        byId("forum-state").textContent = forum.error || "";
        rows("forum-rows", forum.posts, (row, postEntry) => {
          cell(row, postEntry.title || postEntry.body.slice(0, 80)); cell(row, postEntry.author_name); cell(row, postEntry.withdrawn_at ? "已撤回" : "公开");
          const actions = cell(row, "", "actions"); actions.append(button(postEntry.withdrawn_at ? "恢复" : "撤回", () => moderatePost(postEntry), !postEntry.withdrawn_at));
        });
        rows("audit-rows", data.auditEvents, (row, entry) => { cell(row, entry.occurredAt); cell(row, entry.actorId); cell(row, entry.action); cell(row, entry.risk); });
      }
      async function changeAccount(userId, status) { const reason = prompt("请输入账号状态变更原因"); if (!reason) return; try { await post("/v1/admin/accounts/status", { userId, status, reason }); await refresh(); showStatus("账号状态已更新。", true); } catch (error) { showStatus(error.message); } }
      function editSource(source) { const form = byId("source-form"); for (const key of ["sourceId", "name", "sourceKind", "baseUrl", "enabled"]) form.elements[key].value = String(source[key]); form.elements.reason.focus(); }
      async function removeSource(source) { const reason = prompt("请输入移除检索源的原因"); if (!reason) return; try { await post("/v1/admin/retrieval-sources/remove", { sourceId: source.sourceId, reason }); await refresh(); showStatus("检索源已移除。", true); } catch (error) { showStatus(error.message); } }
      async function revokeGrant(grantId) { const reason = prompt("请输入撤销支持访问的原因"); if (!reason) return; try { await post("/v1/admin/support-access/revoke", { grantId, reason }); await refresh(); showStatus("支持访问已撤销。", true); } catch (error) { showStatus(error.message); } }
      async function moderatePost(postEntry) { const reason = prompt("请输入帖子治理原因"); if (!reason) return; try { await post("/v1/admin/forum/posts/moderate", { action: postEntry.withdrawn_at ? "restore" : "withdraw", postId: postEntry.id, reason }); await refresh(); showStatus("帖子状态已更新。", true); } catch (error) { showStatus(error.message); } }
      byId("login-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const payload = await post("/v1/account/login", { ...formBody(event.currentTarget), audience: "liteasy-admin" }); token = payload.session.sessionId; await refresh(); byId("login").hidden = true; byId("dashboard").hidden = false; showStatus(""); } catch (error) { if (error.message.includes("更换")) { byId("password-form").hidden = false; byId("password-form").elements.email.value = event.currentTarget.elements.email.value; } showStatus(error.message); } });
      byId("password-form").addEventListener("submit", async (event) => { event.preventDefault(); try { await post("/v1/account/change-bootstrap-password", formBody(event.currentTarget)); event.currentTarget.hidden = true; showStatus("一次性密码已更换，请使用新密码登录。", true); } catch (error) { showStatus(error.message); } });
      byId("quota-form").addEventListener("submit", async (event) => { event.preventDefault(); const body = formBody(event.currentTarget); body.limitBytes = Number(body.limitBytes); try { await post("/v1/admin/storage-quota", body); showStatus("配额已更新。", true); } catch (error) { showStatus(error.message); } });
      byId("model-form").addEventListener("submit", async (event) => { event.preventDefault(); const body = formBody(event.currentTarget); body.localDirectEnabled = body.localDirectEnabled === "true"; try { await post("/v1/admin/model-policy", body); showStatus("模型策略已保存。", true); } catch (error) { showStatus(error.message); } });
      byId("source-form").addEventListener("submit", async (event) => { event.preventDefault(); const body = formBody(event.currentTarget); body.enabled = body.enabled === "true"; if (!body.sourceId) delete body.sourceId; try { await post("/v1/admin/retrieval-sources", body); event.currentTarget.reset(); await refresh(); showStatus("检索源已保存。", true); } catch (error) { showStatus(error.message); } });
      byId("support-form").addEventListener("submit", async (event) => { event.preventDefault(); const body = formBody(event.currentTarget); body.durationMinutes = Number(body.durationMinutes); try { await post("/v1/admin/support-access/grant", body); await refresh(); showStatus("限时支持访问已授予。", true); } catch (error) { showStatus(error.message); } });
      byId("logout").addEventListener("click", async () => { try { await post("/v1/account/logout", { sessionId: token }); } finally { token = ""; byId("dashboard").hidden = true; byId("login").hidden = false; } });
    </script>
  </body>
</html>`;
}
