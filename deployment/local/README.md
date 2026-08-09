# Local deployment foundation

This directory provides a rebuildable development foundation for the future Linux
deployment. It is not a production deployment and it does not import demo users,
local SQLite data, local document libraries, cached objects, or fixed secrets.

The stack contains:

- a TLS-enabled PostgreSQL 16 instance for Liteasy, with separate online and migrator roles;
- a second TLS-enabled PostgreSQL 16 instance and volume for Intuecho, also with separate roles;
- a third PostgreSQL volume used only by Keycloak;
- Keycloak with three public PKCE clients and distinct confidential service clients;
- the Liteasy Keycloak management adapter for account disable, session logout, and deletion.

## Commands

Prerequisites are Node.js 20+, Docker Engine, and Docker Compose v2. The current
Linux account must be allowed to access the Docker socket.

```bash
node deployment/local/foundation.mjs prepare
node deployment/local/foundation.mjs start
node deployment/local/foundation.mjs migrate
node deployment/local/foundation.mjs verify
node deployment/local/foundation.mjs status
node deployment/local/foundation.mjs restart
node deployment/local/foundation.mjs stop
```

Run `prepare`, `start`, `migrate`, and `verify` in that order for a new environment.
`prepare` creates or completes `deployment/local/.env` with mode `0600`; reruns only add
missing keys and never replace existing values. The file is ignored by Git. The
Keycloak administration URL is `${KEYCLOAK_PUBLIC_URL}/admin/`; its generated
bootstrap account must not be used as a Liteasy product account. Product test
accounts must be registered through the real local Keycloak registration flow.

## Development test accounts

No product user is preloaded and there is no repository-wide test password. After
`start` succeeds, open `http://127.0.0.1:18081/realms/liteasy/account/` with the
default ports, choose Register, and create a personal account such as
`qa.<name-or-id>@liteasy.local`. The local realm requires at least 12 characters with
uppercase, lowercase, digit, and special-character classes. Keep the password in a
personal password manager and never commit it. If `KEYCLOAK_PUBLIC_URL` was changed,
use that origin instead of `http://127.0.0.1:18081`.

The generated `KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME` and password are infrastructure
credentials stored in the ignored mode-`0600` `.env`; they are only for Keycloak
administration and are not Liteasy Admin credentials. Liteasy platform-admin tests
also require the registered user's IdP subject to be granted `platform_admin` by the
Liteasy API bootstrap/role workflow. Database roles and confidential clients are
machine identities, not developer accounts.

`stop` runs Compose `down` without deleting volumes. Do not add `--volumes` unless
the explicit intent is to destroy all local infrastructure state. The wrapper only
targets the `liteasy-local-foundation` Compose project and does not manage unrelated
containers.

## Configuration

`deployment/local/.env.example` is the non-secret schema. Images, bind address, runtime
host, Liteasy/Intuecho database ports, Keycloak and identity-management ports,
Keycloak public URL, issuer and internal service URL, redirect URIs, and Web origins are all configurable.
If `KEYCLOAK_HOST_PORT` changes, set `KEYCLOAK_PUBLIC_URL` and `KEYCLOAK_ISSUER` to
the corresponding externally reachable values. The runtime verifier reads these
values instead of assuming port `18081`.

The default ports remain Liteasy PostgreSQL `55432`, Intuecho PostgreSQL `55433`,
Keycloak `18081`, and identity-management `9090`, all bound to `127.0.0.1`. Image
tags are parameters so a Linux deployment can pin reviewed digests without editing
Compose. No command prints secret values.

## Identity boundaries

The public clients are `liteasy-desktop-public`, `intuecho-web`, and
`liteasy-admin-public`, with access-token audiences `liteasy-desktop`,
`intuecho-web`, and `liteasy-admin`. Password grants are disabled and PKCE S256 is
required. Confidential clients are separate for Liteasy Cloud introspection,
Intuecho API introspection, identity-management introspection, organization
authorization, visualization generation, lifecycle calls, and Keycloak Admin
REST. The lifecycle caller secret is not used by identity-management to
introspect tokens.

`verify` checks discovery issuer and the advertised token, JWKS, introspection, and
revocation endpoints; obtains all three scoped service tokens; validates issuer,
client ID, audience, and scopes; and sends the lifecycle token to the protected adapter route.
The route deliberately targets a nonexistent subject, so authorization and the
Keycloak Admin boundary are exercised without changing a product account.

The local realm deliberately does not claim MFA completion. Staging must configure
a real WebAuthn or OTP enrollment flow and prove that the resulting access token has
the `amr` value accepted by Liteasy's fresh-MFA gate. A local successful login is
therefore OIDC/PKCE evidence, not production MFA evidence.

## Database boundaries

The application roles
cannot create schema objects; only their dedicated migrators run SQL migrations.
The migration script is repeatable and targets the product databases. Separate
`liteasy_test` and `intuecho_test` databases exist for destructive integration suites,
but the script never runs those suites implicitly.

After migration, the isolated Intuecho PostgreSQL suite can be run without placing
credentials on the command line:

```bash
node deployment/local/verify-intuecho-postgres-integration.mjs
```

The wrapper only targets the loopback `intuecho_test` database, clears its business
tables, and validates migrations `001-009`, replies, derived annotations, ratings,
organization owner/admin checks, audit immutability, edited-history cleanup, and
account deletion. It must never be
pointed at the development or production database.

The current Compose foundation contains databases, Keycloak, and identity-management.
Intuecho API/Web browser acceptance is run as local host processes on parameterized
development endpoints; it is not yet a production image rollout. The verified
defaults are API `4040` and Web `5174`, and desktop clients must receive these through
their environment configuration rather than embedding production endpoints.

The self-signed PostgreSQL certificates and all volumes are local development
artifacts. Staging and production require a trusted CA, `verify-full`, managed
encryption at rest, backups, monitoring, and independent credentials.

## Migration and environment boundaries

Move to Linux by rebuilding from reviewed image digests, environment-specific
configuration, managed secrets, and the immutable migration sets. Do not copy
development SQLite files, local test databases, Docker volumes, self-signed private
keys, caches, or `deployment/local/.env`. Keycloak, Liteasy, and Intuecho databases and
roles remain isolated in every environment.

This Compose file is development-only: it runs Keycloak development mode, permits
local HTTP, and creates self-signed PostgreSQL TLS material. Staging and production
must use separate configuration, exact approved origins, HTTPS-only public and
internal endpoints, database TLS `verify-full`, a secret manager, network policy,
trusted certificates, backups/PITR, monitoring, and environment-specific client
credentials. Production values must never be added to this local file.

## Failure recovery

- If startup fails, run `status` and inspect `docker compose --env-file deployment/local/.env --file deployment/local/compose.yaml logs --no-color <service>` before changing configuration.
- After a connection or permission fix, rerun `migrate`; immutable checksums and the migration ledger make successful migrations idempotent.
- After a configuration fix, rerun `start` and `verify`. Keycloak startup reconciles the local confidential secrets, public origins, and required management roles against an existing realm.
- A checksum mismatch is not recoverable by editing an applied migration. Stop, identify the artifact/version mismatch, and restore or deploy a reviewed forward migration.
- Volume deletion is not a normal recovery step. Use a reviewed backup/restore path for material data.
