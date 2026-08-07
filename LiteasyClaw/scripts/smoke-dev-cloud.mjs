import path from "node:path";
import { fileURLToPath } from "node:url";

const checks = [
  { contentType: "application/json", path: "/", status: 200 },
  { contentType: "application/json", path: "/healthz", status: 200 },
  { contains: "Liteasy 管理后台", contentType: "text/html", path: "/admin/", status: 200 },
  { contentType: "application/json", path: "/v1/admin/demo-state", status: 404 }
];

export async function runDevCloudSmoke(baseUrl, fetchImpl = fetch) {
  if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl)) {
    throw new Error("smoke_invalid_origin: provide an http or https Liteasy dev-cloud origin");
  }
  const origin = baseUrl.replace(/\/+$/, "");
  const results = [];
  for (const check of checks) {
    const response = await fetchImpl(`${origin}${check.path}`);
    if (response.status !== check.status) {
      throw new Error(`smoke_failed: ${check.path} returned ${response.status}, expected ${check.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes(check.contentType)) {
      throw new Error(`smoke_failed: ${check.path} returned unexpected content type ${contentType}`);
    }
    const body = await response.text();
    if (check.contains && !body.includes(check.contains)) {
      throw new Error(`smoke_failed: ${check.path} is missing the expected product marker`);
    }
    results.push({ path: check.path, status: response.status });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error("Usage: node LiteasyClaw/scripts/smoke-dev-cloud.mjs <base-url>");
    process.exitCode = 1;
  } else {
    try {
      const results = await runDevCloudSmoke(baseUrl);
      for (const result of results) {
        process.stdout.write(`PASS ${result.path} (${result.status})\n`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
