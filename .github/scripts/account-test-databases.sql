-- Ephemeral CI only: two products, separate app/migration roles and databases.
-- Run against the workflow's loopback PostgreSQL service, never a shared server.
CREATE ROLE liteasy_ci_migrator LOGIN PASSWORD 'ephemeral-liteasy-migrator';
CREATE ROLE liteasy_ci_app LOGIN PASSWORD 'ephemeral-liteasy-app';
CREATE ROLE intuecho_ci_migrator LOGIN PASSWORD 'ephemeral-intuecho-migrator';
CREATE ROLE intuecho_ci_app LOGIN PASSWORD 'ephemeral-intuecho-app';
CREATE DATABASE liteasy_ci_test OWNER liteasy_ci_migrator;
CREATE DATABASE intuecho_ci_test OWNER intuecho_ci_migrator;
REVOKE ALL ON DATABASE liteasy_ci_test FROM PUBLIC;
REVOKE ALL ON DATABASE intuecho_ci_test FROM PUBLIC;
GRANT CONNECT ON DATABASE liteasy_ci_test TO liteasy_ci_app;
GRANT CONNECT ON DATABASE intuecho_ci_test TO intuecho_ci_app;
