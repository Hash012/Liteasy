import { readFile } from "node:fs/promises";

const dataFile = process.env.WAITLIST_DATA_FILE ?? "/var/lib/liteasy/waitlist/waitlist-submissions.jsonl";
const apiUrl = process.env.WAITLIST_APPLICATION_API_URL ?? "";
const secret = process.env.WAITLIST_APPLICATION_API_SECRET ?? "";

if (!apiUrl || !secret) throw new Error("waitlist_application_api_not_configured");

const records = (await readFile(dataFile, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

let imported = 0;
for (const record of records) {
  const response = await fetch(`${apiUrl}/v1/internal/marketing/applications`, {
    body: JSON.stringify({
      applicationId: record.id,
      email: record.email,
      field: record.field ?? "",
      problem: record.problem ?? "",
      request: record.request ?? {},
      role: record.role,
      source: record.source,
      submittedAt: record.submittedAt
    }),
    headers: {
      "content-type": "application/json",
      "x-liteasy-marketing-secret": secret
    },
    method: "POST"
  });
  if (!response.ok) throw new Error(`waitlist_import_failed:${response.status}:${record.id}`);
  imported += 1;
}

console.log(JSON.stringify({ imported, ok: true }));
