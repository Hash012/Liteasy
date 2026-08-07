import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createIntuechoApp } from "../../../Intuecho/services/api/src/server.mjs";

const webUrl = process.env.INTUECHO_WEB_ENDPOINT ?? "http://127.0.0.1:5174";
const publicApiUrl = "http://127.0.0.1:4040";
const testApiPort = 14040;
const testApiUrl = `http://127.0.0.1:${testApiPort}`;
const directory = await mkdtemp(join(tmpdir(), "intuecho-organization-web-e2e-"));
const sessions = {
  "organization-admin-token": { id: "organization-admin", initials: "管", name: "组织管理员" },
  "organization-author-token": { id: "organization-author", initials: "作", name: "批注作者" }
};

const literature = {
  identity: { id: "doi:10.1000/organization-e2e", kind: "doi", source: "metadata", value: "10.1000/organization-e2e" },
  metadata: { authors: ["Evidence Team"], documentType: "journal_article", title: "Organization Annotation Governance", year: 2026 }
};

const { app, db } = await createIntuechoApp({
  authorizeOrganizationAccess: async ({ organizationId, userId }) => ({
    allowed: organizationId === "organization-e2e" && new Set(["organization-admin", "organization-author"]).has(userId),
    role: userId === "organization-admin" ? "admin" : "member"
  }),
  authorizeOrganizationVisibility: async ({ organizationId, userId }) =>
    organizationId === "organization-e2e" && new Set(["organization-admin", "organization-author"]).has(userId),
  databasePath: join(directory, "intuecho.sqlite"),
  identityVerifier: async (token) => {
    assert.ok(sessions[token], "unexpected Web session token");
    return sessions[token];
  },
  listOrganizations: async (userId) => userId === "organization-admin" ? [{
    name: "证据研究组织",
    organizationId: "organization-e2e",
    role: "admin"
  }] : [],
  webOrigin: webUrl
});

let browser;
try {
  await app.listen({ host: "127.0.0.1", port: testApiPort });
  const created = await app.inject({
    headers: { authorization: "Bearer organization-author-token" },
    method: "POST",
    payload: {
      body: "组织成员共享的文献批注。",
      organizationId: "organization-e2e",
      shareToPlaza: false,
      tags: ["组织治理"],
      targets: [{ kind: "whole_document", literature }],
      visibility: "organization"
    },
    url: "/v1/annotations"
  });
  assert.equal(created.statusCode, 201, created.body);
  const annotationId = created.json().annotation.id;
  const withdrawn = await app.inject({
    headers: { authorization: "Bearer organization-admin-token" },
    method: "POST",
    payload: { action: "withdraw", reason: "浏览器组织治理验收先撤回内容。" },
    url: `/v1/annotations/${annotationId}/organization-moderation`
  });
  assert.equal(withdrawn.statusCode, 200, withdrawn.body);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  await page.addInitScript((session) => {
    localStorage.setItem("intuecho.auth.development-session.v1", JSON.stringify(session));
  }, {
    audience: "intuecho-web",
    email: "organization-admin@liteasy.local",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    name: "组织管理员",
    sessionId: "organization-admin-token",
    userId: "organization-admin"
  });
  await page.route(`${publicApiUrl}/**`, (route) => route.continue({
    url: route.request().url().replace(publicApiUrl, testApiUrl)
  }));
  await page.route("http://127.0.0.1:8787/v1/account/session", (route) => route.fulfill({
    body: JSON.stringify({ session: {
      audience: "intuecho-web",
      email: "organization-admin@liteasy.local",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      name: "组织管理员",
      sessionId: "organization-admin-token",
      userId: "organization-admin"
    } }),
    contentType: "application/json",
    status: 200
  }));

  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "组织批注" }).click();
  await page.getByRole("heading", { name: "组织批注" }).waitFor();
  await page.getByText("证据研究组织").waitFor();
  await page.getByText("已由组织管理员撤回").waitFor();
  await page.getByRole("button", { name: "恢复" }).click();
  const dialog = page.getByRole("dialog", { name: "恢复组织批注" });
  await dialog.getByLabel("治理原因").fill("复核文献证据后恢复组织批注。");
  await dialog.getByRole("button", { name: "确认" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("已恢复", { exact: true }).waitFor();
  await page.screenshot({ fullPage: true, path: "/tmp/intuecho-organization-web-e2e.png" });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "organization view has global horizontal overflow");
  await page.screenshot({ fullPage: true, path: "/tmp/intuecho-organization-web-e2e-mobile.png" });

  assert.equal(db.prepare("SELECT withdrawn_at FROM annotations_v2 WHERE id = ?").get(annotationId).withdrawn_at, null);
  assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_moderation_audit_v2 WHERE annotation_id = ?").get(annotationId).count, 2);
  process.stdout.write(`${JSON.stringify({ annotationId, mobileScreenshot: "/tmp/intuecho-organization-web-e2e-mobile.png", screenshot: "/tmp/intuecho-organization-web-e2e.png", verified: true })}\n`);
} finally {
  if (browser) await browser.close();
  await app.close();
  db.close();
  await rm(directory, { force: true, recursive: true });
}
