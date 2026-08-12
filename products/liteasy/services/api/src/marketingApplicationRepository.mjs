const roles = new Set(["本科生", "研究生", "青年研究者", "研究团队成员", "其他学习者"]);

export class MarketingApplicationError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function text(value, maximum, code, { required = false } = {}) {
  if (typeof value !== "string") throw new MarketingApplicationError(code);
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if ((required && normalized.length === 0) || normalized.length > maximum) {
    throw new MarketingApplicationError(code);
  }
  return normalized;
}

function applicationId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new MarketingApplicationError("marketing_application_id_invalid");
  }
  return value.toLowerCase();
}

function date(value, code) {
  const result = new Date(value);
  if (typeof value !== "string" || !Number.isFinite(result.getTime())) {
    throw new MarketingApplicationError(code);
  }
  return result;
}

function mapApplication(row) {
  return {
    applicationId: row.application_id,
    email: row.email,
    field: row.research_field,
    installerDownloadedAt: row.installer_downloaded_at?.toISOString() ?? null,
    problem: row.problem_statement,
    role: row.applicant_role,
    source: row.source,
    submittedAt: row.submitted_at.toISOString()
  };
}

function requirePlatformAdmin(principal) {
  if (!principal?.roles?.includes("platform_admin")) {
    throw new MarketingApplicationError("platform_admin_required", 403);
  }
}

export class PostgresMarketingApplicationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create(input) {
    const id = applicationId(input.applicationId);
    const submittedAt = date(input.submittedAt, "marketing_application_date_invalid");
    const email = text(input.email, 254, "marketing_application_email_invalid", { required: true }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new MarketingApplicationError("marketing_application_email_invalid");
    }
    const role = text(input.role, 40, "marketing_application_role_invalid", { required: true });
    if (!roles.has(role)) throw new MarketingApplicationError("marketing_application_role_invalid");
    const field = text(input.field ?? "", 120, "marketing_application_field_invalid");
    const problem = text(input.problem ?? "", 1000, "marketing_application_problem_invalid");
    if (input.source !== "marketing-site") throw new MarketingApplicationError("marketing_application_source_invalid");
    const request = input.request && typeof input.request === "object" && !Array.isArray(input.request)
      ? input.request
      : {};
    const result = await this.pool.query(`
      INSERT INTO marketing_experience_applications(
        application_id, submitted_at, email, applicant_role, research_field,
        problem_statement, source, request_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, 'marketing-site', $7::jsonb)
      ON CONFLICT (application_id) DO UPDATE SET application_id = EXCLUDED.application_id
      RETURNING *
    `, [id, submittedAt.toISOString(), email, role, field, problem, JSON.stringify(request)]);
    return { application: mapApplication(result.rows[0]) };
  }

  async markInstallerDownloaded(idInput) {
    const id = applicationId(idInput);
    const result = await this.pool.query(`
      UPDATE marketing_experience_applications
         SET installer_downloaded_at = COALESCE(installer_downloaded_at, now())
       WHERE application_id = $1
       RETURNING *
    `, [id]);
    if (!result.rows[0]) throw new MarketingApplicationError("marketing_application_not_found", 404);
    return { application: mapApplication(result.rows[0]) };
  }

  async list(principal, input = {}) {
    requirePlatformAdmin(principal);
    const limit = input.limit === undefined ? 100 : Number(input.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new MarketingApplicationError("marketing_application_limit_invalid");
    }
    const before = input.before ? date(input.before, "marketing_application_cursor_invalid") : null;
    const result = await this.pool.query(`
      SELECT * FROM marketing_experience_applications
       WHERE ($1::timestamptz IS NULL OR submitted_at < $1)
       ORDER BY submitted_at DESC, application_id DESC
       LIMIT $2
    `, [before?.toISOString() ?? null, limit]);
    return {
      applications: result.rows.map(mapApplication),
      nextBefore: result.rows.length === limit ? result.rows.at(-1).submitted_at.toISOString() : null
    };
  }
}
