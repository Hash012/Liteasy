import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";

const identityBaseUrl = process.env.LITEASY_IDENTITY_ENDPOINT ?? "http://127.0.0.1:8787";
const forumApiUrl = process.env.INTUECHO_API_ENDPOINT ?? "http://127.0.0.1:4040";
const forumWebUrl = process.env.INTUECHO_WEB_ENDPOINT ?? "http://127.0.0.1:5174";

async function request(baseUrl, path, { body, sessionId } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {})
    },
    method: body === undefined ? "GET" : "POST"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${payload.message ?? payload.error ?? "unknown error"}`);
  return payload;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const email = `forum.browser.${suffix}@liteasy.local`;
const password = `Browser-E2E-${randomBytes(18).toString("base64url")}!`;
const body = `浏览器恢复并发布桌面草稿 ${suffix}`;
const anchorHash = `browser-e2e:${suffix}:colbert`;

const registered = await request(identityBaseUrl, "/v1/account/register", {
  body: { audience: "liteasy-desktop", displayName: "浏览器联调用户", email, password }
});
const desktopSession = registered.session;
assert(desktopSession?.audience === "liteasy-desktop", "desktop registration failed");

const literature = {
  identity: {
    id: "doi:10.1145/3397271.3401075",
    kind: "doi",
    source: "metadata",
    value: "10.1145/3397271.3401075"
  },
  metadata: {
    authors: ["Omar Khattab", "Matei Zaharia"],
    documentType: "conference_paper",
    title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
    year: 2020
  }
};

const handoff = await request(forumApiUrl, "/v1/integrations/desktop/annotation-handoffs", {
  body: {
    body,
    shareToPlaza: true,
    tags: ["浏览器联调"],
    targets: [{
      anchorHash,
      excerpt: "ColBERT uses contextualized late interaction for passage retrieval.",
      kind: "source_passage",
      literature,
      page: 1,
      rects: []
    }],
    visibility: "public"
  },
  sessionId: desktopSession.sessionId
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { height: 800, width: 1280 } });
try {
  await page.goto(`${forumWebUrl}/?handoff=${encodeURIComponent(handoff.handoffId)}`, {
    waitUntil: "domcontentloaded"
  });
  const dialog = page.getByRole("dialog", { name: "登录" });
  await dialog.getByLabel("邮箱").fill(email);
  await dialog.getByLabel("密码").fill(password);
  await dialog.getByRole("button", { exact: true, name: "登录" }).click();

  const composer = page.locator(".annotation-drawer");
  await composer.getByRole("heading", { name: "发布批注" }).waitFor();
  const bodyEditor = composer.getByLabel("批注内容");
  await bodyEditor.waitFor();
  assert(await bodyEditor.inputValue() === body, "desktop annotation body was not restored in the Web composer");
  assert(await composer.getByText(/第 1 页/).isVisible(), "desktop source passage was not restored");
  await page.waitForTimeout(300);
  const desktopStyle = await composer.evaluate((element) => ({
    backgroundColor: getComputedStyle(element).backgroundColor,
    opacity: getComputedStyle(element).opacity
  }));
  assert(desktopStyle.opacity === "1", "composer animation did not settle to full opacity");
  assert(!desktopStyle.backgroundColor.endsWith(", 0)"), "composer background is transparent");
  await page.screenshot({ fullPage: true, path: "/tmp/intuecho-desktop-handoff-e2e.png" });

  await page.setViewportSize({ height: 844, width: 390 });
  await page.waitForTimeout(100);
  const mobileBox = await composer.boundingBox();
  const mobileLayout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowElements: [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement;
        const parentStyle = parent ? getComputedStyle(parent) : null;
        return {
          className: element.className?.toString().slice(0, 120) ?? "",
          left: Math.round(rect.left),
          parentClassName: parent?.className?.toString().slice(0, 120) ?? "",
          parentDisplay: parentStyle?.display ?? "",
          parentGridTemplateColumns: parentStyle?.gridTemplateColumns ?? "",
          right: Math.round(rect.right),
          tagName: element.tagName,
          width: Math.round(rect.width)
        };
      })
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .slice(0, 10)
  }));
  assert(mobileBox && mobileBox.x === 0 && Math.round(mobileBox.width) === 390, "composer does not fill the narrow viewport");
  assert(
    mobileLayout.scrollWidth <= mobileLayout.clientWidth,
    `narrow composer causes horizontal overflow: ${JSON.stringify(mobileLayout)}`
  );
  await page.screenshot({ fullPage: true, path: "/tmp/intuecho-desktop-handoff-e2e-mobile.png" });

  await composer.getByRole("button", { exact: true, name: "发布" }).click();
  await composer.waitFor({ state: "detached" });

  const feed = await request(
    forumApiUrl,
    `/v1/plaza?literatureIdentityKind=doi&literatureIdentityValue=${encodeURIComponent(literature.identity.value)}`
  );
  const post = feed.annotations?.find((item) => item.body === body);
  assert(post, "published browser annotation was not returned to the desktop contextual feed");
  console.log(JSON.stringify({
    handoffId: handoff.handoffId,
    postId: post.id,
    screenshot: "/tmp/intuecho-desktop-handoff-e2e.png",
    mobileScreenshot: "/tmp/intuecho-desktop-handoff-e2e-mobile.png",
    subjectId: desktopSession.userId,
    verified: true
  }, null, 2));
} finally {
  await browser.close();
}
