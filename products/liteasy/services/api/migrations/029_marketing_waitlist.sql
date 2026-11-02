CREATE TABLE marketing_waitlist_applications (
  id uuid PRIMARY KEY,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  role text NOT NULL CHECK (length(role) BETWEEN 1 AND 32),
  research_field text NOT NULL CHECK (length(research_field) <= 200),
  problem text NOT NULL CHECK (length(problem) <= 2000),
  client_hash text NOT NULL CHECK (client_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_waitlist_created_idx ON marketing_waitlist_applications(created_at);
