import assert from "node:assert/strict";
import test from "node:test";
import {
  MarketingApplicationError,
  PostgresMarketingApplicationRepository
} from "./marketingApplicationRepository.mjs";

function row(overrides = {}) {
  return {
    applicant_role: "研究生",
    application_id: "123e4567-e89b-42d3-a456-426614174000",
    email: "reader@example.com",
    installer_downloaded_at: null,
    problem_statement: "理解复杂论文",
    research_field: "信息检索",
    source: "marketing-site",
    submitted_at: new Date("2026-08-13T08:00:00.000Z"),
    ...overrides
  };
}

test("validates and stores a marketing application", async () => {
  const queries = [];
  const repository = new PostgresMarketingApplicationRepository({
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [row()] };
    }
  });
  const result = await repository.create({
    applicationId: "123e4567-e89b-42d3-a456-426614174000",
    email: "Reader@Example.com",
    field: "信息检索",
    problem: "理解复杂论文",
    request: { userAgent: "browser" },
    role: "研究生",
    source: "marketing-site",
    submittedAt: "2026-08-13T08:00:00.000Z"
  });
  assert.equal(result.application.email, "reader@example.com");
  assert.equal(queries[0].values[2], "reader@example.com");
});

test("only platform administrators can list applications", async () => {
  const repository = new PostgresMarketingApplicationRepository({
    async query() { return { rows: [row()] }; }
  });
  await assert.rejects(
    () => repository.list({ roles: ["developer_diagnostics"] }),
    (error) => error instanceof MarketingApplicationError && error.status === 403
  );
  const result = await repository.list({ roles: ["platform_admin"] }, { limit: 20 });
  assert.equal(result.applications[0].applicationId, "123e4567-e89b-42d3-a456-426614174000");
});

test("records the first installer download", async () => {
  const repository = new PostgresMarketingApplicationRepository({
    async query() { return { rows: [row({ installer_downloaded_at: new Date("2026-08-13T08:05:00.000Z") })] }; }
  });
  const result = await repository.markInstallerDownloaded("123e4567-e89b-42d3-a456-426614174000");
  assert.equal(result.application.installerDownloadedAt, "2026-08-13T08:05:00.000Z");
});
