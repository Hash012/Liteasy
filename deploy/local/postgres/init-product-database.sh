#!/usr/bin/env bash
set -euo pipefail

identifier='^[A-Za-z_][A-Za-z0-9_]{0,62}$'
for name in APP_ROLE MIGRATOR_ROLE DATABASE_NAME TEST_DATABASE_NAME; do
  value="${!name:-}"
  if [[ ! "$value" =~ $identifier ]]; then
    echo "invalid PostgreSQL identifier in $name" >&2
    exit 1
  fi
done
for name in APP_PASSWORD MIGRATOR_PASSWORD; do
  if [[ ${#name} -lt 1 || -z "${!name:-}" ]]; then
    echo "missing password in $name" >&2
    exit 1
  fi
done

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_role="$APP_ROLE" \
  --set=app_password="$APP_PASSWORD" \
  --set=migrator_role="$MIGRATOR_ROLE" \
  --set=migrator_password="$MIGRATOR_PASSWORD" \
  --set=database_name="$DATABASE_NAME" \
  --set=test_database_name="$TEST_DATABASE_NAME" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'app_role', :'app_password'
) \gexec
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'migrator_role', :'migrator_password'
) \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database_name', :'migrator_role') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'test_database_name', :'migrator_role') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'app_role') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'test_database_name', :'app_role') \gexec
SQL

for database in "$DATABASE_NAME" "$TEST_DATABASE_NAME"; do
  psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" \
    --set=app_role="$APP_ROLE" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_role') \gexec
SQL
done
