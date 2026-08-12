CREATE TABLE marketing_experience_applications (
  application_id text PRIMARY KEY CHECK (application_id ~ '^[0-9a-f-]{36}$'),
  submitted_at timestamptz NOT NULL,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  applicant_role text NOT NULL CHECK (length(applicant_role) BETWEEN 1 AND 40),
  research_field text NOT NULL DEFAULT '' CHECK (length(research_field) <= 120),
  problem_statement text NOT NULL DEFAULT '' CHECK (length(problem_statement) <= 1000),
  source text NOT NULL CHECK (source = 'marketing-site'),
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  installer_downloaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(request_metadata) = 'object')
);

CREATE INDEX marketing_experience_applications_submitted_idx
  ON marketing_experience_applications(submitted_at DESC, application_id DESC);

CREATE INDEX marketing_experience_applications_email_idx
  ON marketing_experience_applications(lower(email), submitted_at DESC);
