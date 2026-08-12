import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadIdentityManagementConfig } from "../../platform/identity-service/src/config.mjs";
import {
  loadCloudConfig,
  loadMigrationDatabaseConfig
} from "../../products/liteasy/services/api/src/config.mjs";
import {
  loadIntuechoMigrationConfig,
  loadIntuechoProductionConfig
} from "../../products/intuecho/services/api/src/productionConfig.mjs";
import { parseEnvFile } from "./verify-config.mjs";

const directory = new URL("./", import.meta.url);

function environment(name) {
  return parseEnvFile(fs.readFileSync(new URL(`templates/${name}.env.example`, directory), "utf8"));
}

test("service templates satisfy the production configuration parsers", () => {
  const liteasy = environment("liteasy-api");
  const intuecho = environment("intuecho-api");
  loadCloudConfig(liteasy);
  loadMigrationDatabaseConfig(liteasy);
  loadIntuechoProductionConfig(intuecho);
  loadIntuechoMigrationConfig(intuecho);
  loadIdentityManagementConfig(environment("identity-management"));
});

test("the staging realm has three PKCE clients and separated service identities", () => {
  const source = fs.readFileSync(new URL("keycloak/liteasy-staging-realm.json", directory), "utf8");
  const realm = JSON.parse(source);
  const publicClients = realm.clients.filter((client) => client.publicClient);
  assert.deepEqual(publicClients.map((client) => client.clientId).sort(), [
    "intuecho-web",
    "liteasy-admin-public",
    "liteasy-desktop-public"
  ]);
  assert.equal(publicClients.every((client) =>
    client.attributes?.["pkce.code.challenge.method"] === "S256" &&
    client.directAccessGrantsEnabled === false &&
    ["basic", "email", "profile"].every((scope) => client.defaultClientScopes?.includes(scope))
  ), true);
  assert.equal(realm.clients.filter((client) => client.serviceAccountsEnabled).every((client) =>
    client.defaultClientScopes?.includes("basic")
  ), true);
  const clientScopes = new Map(realm.clientScopes.map((scope) => [scope.name, scope]));
  assert.deepEqual(
    [...clientScopes.keys()].filter((name) => ["basic", "email", "profile"].includes(name)).sort(),
    ["basic", "email", "profile"]
  );
  assert.equal(clientScopes.get("basic").protocolMappers.some((mapper) =>
    mapper.protocolMapper === "oidc-sub-mapper" && mapper.config?.["access.token.claim"] === "true"
  ), true);
  assert.equal(clientScopes.get("basic").protocolMappers.some((mapper) =>
    mapper.config?.["claim.name"] === "auth_time"
  ), true);
  assert.equal(clientScopes.get("profile").protocolMappers.some((mapper) =>
    mapper.config?.["claim.name"] === "preferred_username"
  ), true);
  assert.equal(clientScopes.get("email").protocolMappers.some((mapper) =>
    mapper.config?.["claim.name"] === "email"
  ), true);
  assert.equal(new Set(realm.clients.map((client) => client.clientId)).size, realm.clients.length);
  assert.equal(realm.users.length, 1);
  assert.equal(realm.users[0].serviceAccountClientId, "liteasy-keycloak-admin");

  const configured = environment("keycloak");
  const referencedVariables = [...source.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((match) => match[1]);
  assert.equal(referencedVariables.every((name) => configured[name]), true);
});

test("the gateway restricts Keycloak administration to explicit operator CIDRs", () => {
  const gateway = environment("gateway");
  assert.equal(
    gateway.ACME_EMAIL,
    "replace-with-monitored-certificate-email@example.invalid"
  );
  assert.equal(
    gateway.KEYCLOAK_ADMIN_ALLOWED_CIDRS,
    "replace-with-space-separated-operator-public-cidrs"
  );

  const caddyfile = fs.readFileSync(new URL("Caddyfile", directory), "utf8");
  assert.match(
    caddyfile,
    /not remote_ip private_ranges \{\$KEYCLOAK_ADMIN_ALLOWED_CIDRS\}/
  );
  assert.equal(caddyfile.match(/KEYCLOAK_ADMIN_ALLOWED_CIDRS/g)?.length, 1);
});

test("staging containers rotate local Docker logs", () => {
  const compose = fs.readFileSync(new URL("compose.yaml", directory), "utf8");
  assert.match(compose, /x-json-logging: &json-logging/);
  assert.match(compose, /max-file: "5"/);
  assert.match(compose, /max-size: "10m"/);
  assert.equal(compose.match(/logging: \*json-logging/g)?.length, 3);
});

test("Liteasy API image build includes shared runtime schemas", () => {
  const dockerfile = fs.readFileSync(
    new URL("../../products/liteasy/services/api/Dockerfile", import.meta.url),
    "utf8"
  );
  const ignore = fs.readFileSync(
    new URL("../../products/liteasy/.dockerignore", import.meta.url),
    "utf8"
  );
  assert.match(dockerfile, /services\/api\/package\.json/);
  assert.match(dockerfile, /packages\/shared\/visualizationArtifact\.v1\.schema\.json/);
  assert.match(dockerfile, /packages\/shared\/visualizationBuiltins\.v1\.json/);
  assert.match(dockerfile, /import\(\"\.\/src\/server\.mjs\"\)/);
  assert.match(ignore, /!packages\/shared\/visualizationArtifact\.v1\.schema\.json/);
  assert.match(ignore, /!packages\/shared\/visualizationBuiltins\.v1\.json/);
});

test("all application images expose the immutable source revision", () => {
  const dockerfiles = [
    "gateway.Dockerfile",
    "../../products/liteasy/services/api/Dockerfile",
    "../../products/intuecho/services/api/Dockerfile",
    "../../platform/identity-service/Dockerfile"
  ];

  for (const dockerfile of dockerfiles) {
    const source = fs.readFileSync(new URL(dockerfile, directory), "utf8");
    assert.match(source, /ARG SOURCE_REVISION/);
    assert.match(source, /ARG SOURCE_VERSION/);
    assert.match(source, /org\.opencontainers\.image\.revision=\$\{SOURCE_REVISION\}/);
    assert.match(source, /org\.opencontainers\.image\.source=\$\{SOURCE_URL\}/);
    assert.match(source, /org\.opencontainers\.image\.version=\$\{SOURCE_VERSION\}/);
  }
});

test("the Intuecho API can build native dependencies without prebuilt downloads", () => {
  const dockerfile = fs.readFileSync(
    new URL("../../products/intuecho/services/api/Dockerfile", import.meta.url),
    "utf8"
  );
  assert.match(dockerfile, /apk add --no-cache --virtual \.build-deps python3 make g\+\+/);
  assert.match(dockerfile, /apk del \.build-deps/);
});

test("the staging PDF scanner is pinned, internal, and self-contained", () => {
  const scannerDirectory = new URL("pdf-scanner/", directory);
  const compose = fs.readFileSync(new URL("compose.yaml", scannerDirectory), "utf8");
  const clamavDockerfile = fs.readFileSync(
    new URL("clamav.Dockerfile", scannerDirectory),
    "utf8"
  );
  const adapterDockerfile = fs.readFileSync(new URL("Dockerfile", scannerDirectory), "utf8");
  const runtimeInstaller = fs.readFileSync(
    new URL("install-runtime.sh", scannerDirectory),
    "utf8"
  );
  const swapInstaller = fs.readFileSync(new URL("install-swap.sh", scannerDirectory), "utf8");

  assert.match(clamavDockerfile, /^FROM clamav\/clamav@sha256:[a-f0-9]{64}$/m);
  assert.match(adapterDockerfile, /^FROM node@sha256:[a-f0-9]{64}$/m);
  assert.match(compose, /scanner:\n    internal: true/);
  assert.doesNotMatch(compose, /^\s+ports:/m);
  assert.match(compose, /clamav:[\s\S]+?networks:\n      - scanner/);
  assert.match(compose, /freshclam:[\s\S]+?networks:\n      - update-egress/);
  assert.match(compose, /pdf-scanner:[\s\S]+?networks:\n      - scanner\n      - application-backend/);
  assert.match(compose, /PDF_SCANNER_MAX_BYTES: "33554432"/);
  assert.match(compose, /PDF_SCANNER_MAX_CONCURRENT: "1"/);
  assert.doesNotMatch(runtimeInstaller, /\/root\/liteasy-pdf-scanner/);
  assert.doesNotMatch(swapInstaller, /\/root\/liteasy-pdf-scanner/);
  assert.match(runtimeInstaller, /script_directory=/);
  assert.match(runtimeInstaller, /docker run --rm/);
  assert.match(runtimeInstaller, /--network none/);
  assert.match(runtimeInstaller, /^node_image=node@sha256:[a-f0-9]{64}$/m);
  assert.match(swapInstaller, /script_directory=/);
});

test("only Liteasy services receive the scanner CA trust bundle", () => {
  const compose = fs.readFileSync(new URL("compose.yaml", directory), "utf8");
  assert.equal(compose.match(/NODE_EXTRA_CA_CERTS: \/run\/certs\/liteasy-api-ca\.pem/g)?.length, 2);
  assert.equal(
    compose.match(/\$\{STAGING_RUNTIME_DIR(?::\?set STAGING_RUNTIME_DIR)?\}\/liteasy-api-ca\.pem/g)?.length,
    2
  );
  assert.equal(compose.match(/:\/run\/certs\/liteasy-api-ca\.pem:ro/g)?.length, 2);
  assert.equal(compose.match(/NODE_EXTRA_CA_CERTS: \/run\/certs\/aliyun-rds-ca\.pem/g)?.length, 3);
});

test("maintenance scheduling reports success and failure to the system log", () => {
  const script = fs.readFileSync(new URL("scripts/run-maintenance.sh", directory), "utf8");
  const service = fs.readFileSync(
    new URL("systemd/liteasy-staging-maintenance.service", directory),
    "utf8"
  );
  const timer = fs.readFileSync(
    new URL("systemd/liteasy-staging-maintenance.timer", directory),
    "utf8"
  );
  assert.match(script, /readonly repository=\/opt\/liteasy\/repository/);
  assert.match(script, /result=success/);
  assert.match(script, /result=failure exit_code=/);
  assert.match(service, /ExecStart=\/bin\/bash \/usr\/local\/sbin\/liteasy-staging-maintenance/);
  assert.match(timer, /OnCalendar=\*-\*-\* 03:20:00 Asia\/Shanghai/);
  assert.match(timer, /Persistent=true/);
});

test("the beginner runbook keeps critical deployment and recovery steps explicit", () => {
  const runbook = fs.readFileSync(new URL("README.md", directory), "utf8");
  for (const expected of [
    "本文当前是否完整",
    "先确认公网 IP 不会在停机后变化",
    "/opt/liteasy/repository",
    "Settings -> Deploy keys -> Add deploy key",
    "git checkout --detach <git-sha>",
    "迁移前不能跳过手工备份",
    "liteasy-staging-maintenance.timer",
    "result=failure test=true",
    "执行一次隔离的 RDS 时间点恢复演练",
    "后续版本如何更新部署",
    "没有新迁移时的仅应用回滚",
    "已应用新迁移时如何处理",
    "Authenticode 是当前强制停止点",
    "公开下载路径是当前强制停止点"
  ]) {
    assert.ok(runbook.includes(expected), `missing runbook requirement: ${expected}`);
  }
  for (const databaseUser of [
    "user=liteasy_app",
    "user=liteasy_migrator",
    "user=intuecho_app",
    "user=intuecho_migrator",
    "user=keycloak_app"
  ]) {
    assert.ok(runbook.includes(databaseUser), `missing RDS connection check: ${databaseUser}`);
  }
  assert.doesNotMatch(runbook, /git clone <你的只读仓库地址>/);
});

test("runtime templates require a real monitored research contact", () => {
  const liteasy = fs.readFileSync(new URL("templates/liteasy-api.env.example", directory), "utf8");
  assert.doesNotMatch(liteasy, /operations@liteasyclaw\.com/);
  assert.equal(
    liteasy.match(/replace-with-monitored-research-contact@example\.invalid/g)?.length,
    2
  );
});
