import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { IdentityError } from "./identityVerifier.mjs";
import { LibraryAuthorizationError } from "./libraryAuthorization.mjs";
import { LibraryRepositoryError } from "./libraryRepository.mjs";
import { ModelProxyError } from "./modelProxyService.mjs";
import { PdfUploadError } from "./pdfUploadService.mjs";
import { createCloudRequestHandler } from "./server.mjs";
import { VisualizationServiceError } from "./visualizationService.mjs";

function request(method, url, body, authorization = "Bearer valid") {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  stream.method = method;
  stream.url = url;
  stream.headers = {
    authorization,
    ...(body === undefined ? {} : { "content-type": "application/json" })
  };
  return stream;
}

function response() {
  const result = new Writable({
    write(chunk, _encoding, callback) {
      this.body = Buffer.concat([this.body, Buffer.from(chunk)]);
      callback();
    }
  });
  result.body = Buffer.alloc(0);
  result.writeHead = function writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  };
  return result;
}

function jsonBody(result) {
  return JSON.parse(result.body.toString("utf8"));
}

function internalConfig() {
  return {
    allowedOrigins: [],
    database: { sslMode: "verify-full" },
    environment: "production",
    identity: {
      intuechoServiceClientId: "intuecho-organization-service",
      visualizationServiceClientId: "liteasy-visualization-service"
    },
    s3: { region: "test" }
  };
}

function runtime() {
  const calls = [];
  return {
    accountLifecycleService: {
      async setStatus(principal, identity, input) {
        calls.push({ accountStatus: input, identity, principal });
        return {
          account: { status: input.status, subjectId: input.subjectId },
          sessionRevocation: { allSessionsRevoked: input.status !== "active", audiences: [] }
        };
      }
    },
    agentArtifactRepository: {
      async list(subjectId) {
        calls.push({ agentArtifactList: true, subjectId });
        return { artifacts: [] };
      },
      async remove(subjectId, artifactId, traceId) {
        calls.push({ agentArtifactRemove: artifactId, subjectId, traceId });
        return { artifactId, deleted: true, path: `liteasy://agent-artifacts/${artifactId}` };
      },
      async rename(subjectId, artifactId, title, traceId) {
        calls.push({ agentArtifactRename: { artifactId, title }, subjectId, traceId });
        return { artifact: { artifactId, title }, revision: 2 };
      },
      async save(subjectId, body, traceId) {
        calls.push({ agentArtifactSave: body, subjectId, traceId });
        return {
          artifact: body,
          path: `liteasy://agent-artifacts/${body.artifactId}`,
          revision: 1
        };
      }
    },
    calls,
    identityVerifier: {
      async verifyAuthorizationHeader(header, audience) {
        calls.push({ audience, header });
        return {
          audience,
          authenticationMethods: ["pwd", "mfa"],
          authTime: Math.floor(Date.now() / 1000) - 10,
          subject: audience === "liteasy-admin" ? "admin_1" : "user_1"
        };
      },
      async verifyServiceAuthorizationHeader(header, requirement) {
        calls.push({ requirement, serviceHeader: header });
        return {
          audience: "liteasy-internal",
          clientId: requirement.clientId,
          scopes: [requirement.requiredScope],
          subject: "intuecho-service"
        };
      }
    },
    externalKnowledgeService: {
      async download(principal, input) {
        calls.push({ externalPdf: input, principal });
        return {
          byteLength: 9,
          bytesBase64: Buffer.from("%PDF-test").toString("base64"),
          contentHash: "a".repeat(64),
          contentType: "application/pdf",
          finalUrl: "https://papers.example/paper.pdf",
          sourceId: input.sourceId
        };
      },
      async search(principal, input) {
        calls.push({ externalKnowledge: input, principal });
        return { retrieval: { attempts: 1, id: "retrieval_1", reused: false, status: "completed" }, sources: [] };
      },
      async relations(principal, input, signal) {
        calls.push({ externalRelations: input, principal, signal });
        return { edges: [], warnings: [] };
      }
    },
    libraryRepository: {
      async copyEntry(sourceScope, targetScope, input) {
        calls.push({ copy: input, sourceScope, targetScope });
        return { entry: { documentId: "document_copy" }, revision: 1 };
      },
      async createFolder(scope, input) { calls.push({ input, scope }); return { folder: { folderId: "folder_1" }, revision: 1 }; },
      async createMetadataEntry() { throw new Error("not used"); },
      async updateEntry(scope, input) {
        calls.push({ libraryEntryUpdate: input, scope });
        return { document: { documentId: input.documentId, metadata: { literature: input.literature } }, revision: 2 };
      },
      async getDownloadablePdf(scope, documentId) {
        calls.push({ documentId, scope });
        if (typeof documentId !== "string" || !documentId) {
          throw new LibraryRepositoryError("library_document_invalid");
        }
        if (documentId !== "document_1") throw new LibraryRepositoryError("library_document_not_found", 404);
        return {
          byteLength: 14,
          contentHash: "a".repeat(64),
          documentId,
          fileName: "paper.pdf",
          mediaType: "application/pdf",
          metadata: {},
          revision: 3,
          storageKey: "private/objects/aa/hash"
        };
      },
      async getTree(scope) { calls.push({ scope }); return { tree: { entries: [], folders: [], revision: 0, ...scope } }; },
      async recordDocumentAccess(scope, input) { calls.push({ access: input, scope }); }
    },
    modelProxyService: {
      async generate(input, context) {
        calls.push({ modelGenerate: input, modelContext: context });
        return {
          answer: "Live answer",
          execution: { backend: "cloud", mode: "live", provider: input.provider }
        };
      },
      async *generateStream(input, context) {
        calls.push({ modelContext: context, modelStream: input });
        yield "Live ";
        yield "stream";
      }
    },
    objectStore: {
      async openObject(storageKey) {
        calls.push({ storageKey });
        return {
          body: Readable.from([Buffer.from("%PDF-content\n")]),
          byteLength: 14,
          mediaType: "application/pdf",
          metadata: { sha256: "a".repeat(64) }
        };
      }
    },
    organizationGovernanceRepository: {
      async authorizeIntuechoAccess(input) {
        calls.push({ authorizeIntuechoAccess: input });
        return { allowed: input.userSubject === "member_1", role: input.userSubject === "member_1" ? "member" : null };
      },
      async acceptInvitation(identity, input) {
        calls.push({ organizationAcceptInvitation: input, identity });
        return {
          membership: { revision: 0, role: "member", status: "active", subject: identity.subject },
          organizationId: "organization_1",
          organizationRevision: 2
        };
      },
      async invite(identity, input) {
        calls.push({ organizationInvite: input, identity });
        return {
          invitation: {
            invitationToken: "orginv_test",
            organizationId: input.organizationId,
            role: input.role,
            targetSubject: input.targetSubject
          },
          organizationRevision: 1
        };
      },
      async inviteFromIntuecho(identity, input) {
        calls.push({ identity, inviteFromIntuecho: input });
        return {
          invitation: {
            invitationId: "orginvite_1",
            invitationToken: "orginv_token",
            organizationId: input.organizationId,
            revision: 0,
            role: input.role,
            targetSubject: input.targetSubject
          },
          organizationRevision: 2
        };
      },
      async listForIntuecho(input) {
        calls.push({ organizationListForIntuecho: input });
        return {
          activeOrganizationId: "organization_1",
          organizations: [{ myRole: "member", name: "研究组织", organizationId: "organization_1" }]
        };
      },
      async list(identity) {
        calls.push({ organizationList: true, identity });
        return { activeOrganizationId: "", organizations: [] };
      },
      async summary(identity, input) {
        calls.push({ organizationSummary: input, identity });
        return { summary: { organizationId: input.organizationId } };
      }
    },
    organizationPolicyRepository: {
      async get(scope) {
        calls.push({ organizationPolicyGet: true, scope });
        return {
          exportPolicy: "disabled", revision: 0, role: scope.role,
          updatedAt: "2026-08-06T00:00:00.000Z", updatedBy: "owner_1",
          uploadPolicy: "owner_admins"
        };
      },
      async update(scope, input) {
        calls.push({ organizationPolicyUpdate: input, scope });
        if (scope.role !== "owner") {
          throw new LibraryRepositoryError("organization_policy_owner_required", 403);
        }
        return {
          exportPolicy: input.exportPolicy, revision: input.expectedRevision + 1,
          role: scope.role, updatedAt: "2026-08-06T00:00:00.000Z",
          updatedBy: input.actorId, uploadPolicy: input.uploadPolicy
        };
      }
    },
    personalizationRepository: {
      async get(subjectId) {
        calls.push({ personalizationGet: true, subjectId });
        return { enabled: true, personalizationVersion: 0, profile: {}, tags: [] };
      },
      async recordSignal(subjectId, input) {
        calls.push({ personalizationSignal: input, subjectId });
        if (input.disabledForTest) {
          throw new LibraryRepositoryError("personalization_disabled", 409);
        }
        return { enabled: true, personalizationVersion: 1, profile: {}, tags: [] };
      },
      async syncLocalManifest(subjectId, input) {
        calls.push({ manifestSync: input, subjectId });
        if (input.disabledForTest) {
          throw new LibraryRepositoryError("personalization_disabled", 409);
        }
        return { acceptedCount: input.documents.length, personalizationVersion: 1, syncId: "sync_1" };
      }
    },
    platformAdminRepository: {
      async hasRole(subjectId, role) {
        calls.push({ hasRole: role, subjectId });
        return true;
      },
      async getModelPolicy(principal) {
        calls.push({ getModelPolicy: true, principal });
        return {
          cloudProxyEndpoint: "https://models.example.com/liteasy",
          defaultProvider: "openai",
          policyVersion: "policy-1",
          revision: 1,
          syncedAt: "2026-08-07T00:00:00.000Z",
          updatedBy: "admin_1"
        };
      },
      async getQuota(principal, input) {
        calls.push({ getQuota: input, principal });
        return {
          quota: {
            configured: true,
            limitBytes: 1048576,
            revision: 1,
            scopeId: input.scopeId,
            scopeType: input.scopeType,
            usedBytes: 0
          }
        };
      },
      async grantRole(principal, input) {
        calls.push({ grantRole: input, principal });
        return { grant: { grantId: "rolegrant_1", role: input.role, subjectId: input.subjectId } };
      },
      async listRetrievalSources(principal) {
        calls.push({ listRetrievalSources: true, principal });
        return { sources: [] };
      },
      async listGovernance(principal) {
        calls.push({ listGovernance: true, principal });
        return { accountStatuses: [], organizations: [], roleGrants: [], supportGrants: [] };
      },
      async loadModelPolicy() {
        calls.push({ loadModelPolicy: true });
        return {
          cloudProxyEndpoint: "https://models.example.com/liteasy",
          defaultProvider: "openai",
          policyVersion: "policy-1",
          revision: 1,
          syncedAt: "2026-08-07T00:00:00.000Z",
          updatedBy: "admin_1"
        };
      },
      async principal(identity) {
        calls.push({ adminPrincipal: identity });
        return { roles: ["platform_admin"], subjectId: identity.subject };
      },
      async resolveSupportScope(principal, input) {
        calls.push({ principal, resolveSupportScope: input });
        return {
          actorId: principal.subjectId,
          grant: {
            documentId: input.documentId,
            grantId: input.grantId,
            reason: "Investigate user reported PDF corruption"
          },
          role: "support",
          scopeId: "user_1",
          scopeType: "user"
        };
      },
      async setQuota(principal, input) {
        calls.push({ principal, setQuota: input });
        return {
          quota: {
            configured: true,
            limitBytes: input.limitBytes,
            revision: input.expectedRevision + 1,
            scopeId: input.scopeId,
            scopeType: input.scopeType,
            usedBytes: 0
          }
        };
      },
      async setModelPolicy(principal, input) {
        calls.push({ principal, setModelPolicy: input });
        return { policy: { ...input, revision: input.expectedRevision + 1 } };
      },
      async saveRetrievalSource(principal, input) {
        calls.push({ principal, saveRetrievalSource: input });
        return { source: { ...input, revision: input.expectedRevision + 1 } };
      },
      async removeRetrievalSource(principal, input) {
        calls.push({ principal, removeRetrievalSource: input });
        return { removed: true, sourceId: input.sourceId };
      },
      async setOrganizationStatus(principal, input) {
        calls.push({ principal, setOrganizationStatus: input });
        return { organization: { organizationId: input.organizationId, revision: input.expectedRevision + 1, status: input.status } };
      }
    },
    pool: {},
    readiness: { identity: "ready", migrations: "current", objectStorage: "ready", postgres: "ready" },
    recommendationRepository: {
      async clearCache(subjectId, input) {
        calls.push({ recommendationCacheClear: input, subjectId });
        return { cleared: true };
      },
      async recordFeedback(subjectId, input) {
        calls.push({ recommendationFeedback: input, subjectId });
        return { feedback: { action: input.action }, invalidatedCacheEntries: 1 };
      }
    },
    recommendationService: {
      async generate(subjectId, input) {
        calls.push({ recommendationGenerate: input, subjectId });
        return { recommendations: [] };
      },
      async issuePdfGrant(subjectId, input) {
        calls.push({ recommendationPdfGrant: input, subjectId });
        return {
          fullTextGrantId: "pdfgrant_12345678-abcd",
          fullTextUrl: "https://publisher.example/paper.pdf",
          sourceId: input.candidateId
        };
      }
    },
    teamAnnotationRepository: {
      async create(scope, input) {
        calls.push({ annotationCreate: input, scope });
        return {
          annotationId: "annotation_1",
          body: input.body,
          documentId: input.documentId,
          organizationId: scope.scopeId,
          revision: 1,
          uploadedBy: input.actorId
        };
      }
    },
    visualizationOrchestrationService: {
      async cancel(subjectId, requestId, input, traceId) {
        calls.push({ subjectId, traceId, visualizationCancel: { input, requestId } });
        return { reasonCode: "cancelled", requestId, resultArtifactIds: [], status: "cancelled" };
      },
      async start(subjectId, input, traceId) {
        calls.push({ subjectId, traceId, visualizationStart: input });
        return { requestId: input.requestId, resultArtifactIds: [], retryAfterMs: 500, status: "queued" };
      },
      async status(subjectId, requestId) {
        calls.push({ subjectId, visualizationStatus: requestId });
        return {
          artifacts: [{ artifactId: "result-1", artifactVersion: "liteasy.visualization/v1" }],
          requestId,
          resultArtifactIds: ["result-1"],
          status: "succeeded"
        };
      }
    },
    visualizationService: {
      async accountCapability(subjectId) {
        calls.push({ visualizationCapability: true, subjectId });
        return {
          allowed: true,
          availableModalities: ["semantic_graph"],
          enabled: true,
          quota: { available: true, remainingBand: "available" },
          serviceAvailable: true
        };
      },
      async listAudit(principal, input) {
        calls.push({ principal, visualizationAudit: input });
        return { rows: [] };
      },
      async setEntitlement(principal, input) {
        calls.push({ principal, visualizationEntitlement: input });
        return { entitlement: { allowed: input.allowed, subjectId: input.subjectId } };
      },
      async setPreference(subjectId, input) {
        calls.push({ subjectId, visualizationPreference: input });
        return { allowed: true, availableModalities: [], enabled: input.enabled, quota: { available: true }, serviceAvailable: true };
      },
      async testProviderRoute(principal, input) {
        calls.push({ principal, visualizationProviderProbe: input });
        throw new VisualizationServiceError("visualization_provider_unavailable", 503);
      },
      async generate(subjectId, input, context) {
        calls.push({ context, subjectId, visualizationGenerate: input });
        return { reservation: { reservationId: "reservation-1" }, result: { text: "validated" } };
      }
    }
  };
}

test("authenticates formal model generation and derives the subject from the desktop token", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/model/generate", {
    model: "gpt-5-mini",
    prompt: "Explain this paper",
    provider: "openai",
    source: "cloud_proxy"
  }), result);

  assert.equal(result.status, 200);
  assert.equal(jsonBody(result).answer, "Live answer");
  const call = instance.calls.find((item) => item.modelGenerate);
  assert.equal(call.modelContext.subjectId, "user_1");
  assert.match(call.modelContext.traceId, /^trace_/);
  assert.equal(instance.calls.some((item) => item.audience === "liteasy-desktop"), true);
});

test("binds formal Agent artifact operations to the desktop token subject", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const artifact = {
    agent: { runId: "run_1", status: "completed" },
    answer: "analysis",
    artifactId: "artifact_1",
    artifactType: "tree",
    citations: [],
    createdAt: "2026-08-07T00:00:00.000Z",
    papers: [],
    title: "Tree",
    version: "liteasy.agent-artifact/v1"
  };
  const saved = response();
  await handler(request("POST", "/v1/agent-artifacts", artifact), saved);
  const listed = response();
  await handler(request("GET", "/v1/agent-artifacts"), listed);
  const removed = response();
  await handler(request("DELETE", "/v1/agent-artifacts/artifact_1"), removed);

  assert.equal(saved.status, 201);
  assert.equal(jsonBody(saved).path, "liteasy://agent-artifacts/artifact_1");
  assert.equal(listed.status, 200);
  assert.deepEqual(jsonBody(listed).artifacts, []);
  assert.equal(removed.status, 200);
  assert.equal(instance.calls.find((item) => item.agentArtifactSave).subjectId, "user_1");
  assert.equal(instance.calls.find((item) => item.agentArtifactList).subjectId, "user_1");
  assert.equal(instance.calls.find((item) => item.agentArtifactRemove).subjectId, "user_1");
});

test("authenticates formal external retrieval and derives PDF grant ownership from the token", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const searchResult = response();
  await handler(request("POST", "/v1/research/external-knowledge", {
    artifactId: "artifact_1",
    query: "retrieval evidence"
  }), searchResult);
  const pdfResult = response();
  await handler(request("POST", "/v1/research/external-pdf", {
    grantId: "pdfgrant_12345678-abcd",
    sourceId: "crossref:10.1000/test"
  }), pdfResult);

  assert.equal(searchResult.status, 200);
  assert.equal(pdfResult.status, 200);
  assert.equal(instance.calls.find((item) => item.externalKnowledge).principal.subjectId, "user_1");
  assert.equal(instance.calls.find((item) => item.externalPdf).principal.subjectId, "user_1");
  assert.equal(instance.calls.filter((item) => item.audience === "liteasy-desktop").length, 2);
});

test("authenticates formal paper relations and rejects anonymous access", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const body = {
    artifactId: "artifact_relations",
    papers: [{ id: "paper-a", provider: "openalex", sourceId: "W1" }]
  };
  const authenticated = response();
  await handler(request("POST", "/v1/research/paper-relations", body), authenticated);
  assert.equal(authenticated.status, 200);
  assert.equal(instance.calls.find((item) => item.externalRelations).principal.subjectId, "user_1");

  const anonymousInstance = runtime();
  anonymousInstance.identityVerifier.verifyAuthorizationHeader = async () => {
    throw new IdentityError("authentication_required", 401);
  };
  const anonymous = response();
  await createCloudRequestHandler(anonymousInstance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  })(request("POST", "/v1/research/paper-relations", body), anonymous);
  assert.equal(anonymous.status, 401);
});

test("streams the desktop NDJSON contract through the authenticated cloud route", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/model/generate-stream", {
    model: "gpt-5-mini",
    prompt: "Stream this answer",
    provider: "openai",
    source: "cloud_proxy"
  }), result);

  assert.equal(result.status, 200);
  assert.equal(result.headers["content-type"], "application/x-ndjson; charset=utf-8");
  const events = result.body.toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.type), ["delta", "delta", "completed"]);
  assert.equal(events.at(-1).answer, "Live stream");
  assert.equal(events.at(-1).execution.mode, "live");
});

test("finishes an already-started model stream with a stable error event", async () => {
  const instance = runtime();
  instance.modelProxyService.generateStream = async function* generateStream() {
    yield "Partial";
    throw new ModelProxyError("model_provider_timeout", 504);
  };
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/model/generate-stream", {
    model: "gpt-5-mini",
    prompt: "Do not echo this input",
    provider: "openai",
    source: "cloud_proxy"
  }), result);

  assert.equal(result.status, 200);
  const events = result.body.toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.type), ["delta", "error"]);
  assert.equal(events[1].code, "model_provider_timeout");
  assert.match(events[1].traceId, /^trace_/);
  assert.equal(result.body.includes(Buffer.from("Do not echo this input")), false);
});

test("returns stable model errors without exposing upstream details", async () => {
  const instance = runtime();
  instance.modelProxyService.generate = async () => {
    throw new ModelProxyError("model_provider_unavailable", 503);
  };
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/model/generate", {
    model: "gpt-5-mini",
    prompt: "Sensitive source text",
    provider: "openai",
    source: "cloud_proxy"
  }), result);

  assert.equal(result.status, 503);
  assert.equal(jsonBody(result).code, "model_provider_unavailable");
  assert.equal(result.body.includes(Buffer.from("Sensitive source text")), false);
  assert.match(jsonBody(result).traceId, /^trace_/);
});

test("keeps health public but authenticates and derives personal library scope", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: ["http://tauri.localhost"], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  });
  const healthResponse = response();
  await handler(request("GET", "/healthz"), healthResponse);
  assert.equal(healthResponse.status, 200);
  assert.equal(instance.calls.length, 0);

  const treeResponse = response();
  await handler(request("POST", "/v1/library/tree", { scopeId: "user_1", scopeType: "user" }), treeResponse);
  assert.equal(treeResponse.status, 200);
  assert.deepEqual(instance.calls.at(-1).scope, {
    actorId: "user_1", role: "owner", scopeId: "user_1", scopeType: "user"
  });
});

test("publishes only audience-specific desktop and admin public-client OIDC configuration", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: ["http://tauri.localhost"],
    database: { sslMode: "verify-full" },
    environment: "production",
    identity: {
      adminClientId: "liteasy-admin-public",
      clientId: "liteasy-cloud",
      clientSecret: "must-not-leak",
      desktopClientId: "liteasy-desktop-public",
      issuer: "https://identity.internal",
      revocationUrl: "https://identity.internal/oauth2/revoke"
    },
    s3: { region: "test" }
  });
  const result = response();
  await handler(request("GET", "/v1/identity/desktop-config"), result);
  assert.equal(result.status, 200);
  assert.deepEqual(jsonBody(result), {
    audience: "liteasy-desktop",
    authorizationFlow: "authorization_code_pkce",
    clientId: "liteasy-desktop-public",
    issuer: "https://identity.internal",
    revocationUrl: "https://identity.internal/oauth2/revoke"
  });
  assert.equal(result.body.includes("must-not-leak"), false);
  const adminResult = response();
  await handler(request("GET", "/v1/identity/admin-config"), adminResult);
  assert.equal(adminResult.status, 200);
  assert.deepEqual(jsonBody(adminResult), {
    audience: "liteasy-admin",
    authorizationFlow: "authorization_code_pkce",
    clientId: "liteasy-admin-public",
    issuer: "https://identity.internal"
  });
  assert.equal(adminResult.body.includes("must-not-leak"), false);
  assert.equal(instance.calls.length, 0);
});

test("enables desktop diagnostics only outside production after a database role check", async () => {
  const productionRuntime = runtime();
  const productionHandler = createCloudRequestHandler(productionRuntime, {
    allowedOrigins: [], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  });
  const productionResult = response();
  await productionHandler(
    request("GET", "/v1/account/capabilities"),
    productionResult
  );
  assert.equal(productionResult.status, 200);
  assert.deepEqual(jsonBody(productionResult), {
    developerDiagnostics: false,
    multimodalVisualization: {
      allowed: true,
      availableModalities: ["semantic_graph"],
      enabled: true,
      quota: { available: true, remainingBand: "available" },
      serviceAvailable: true
    }
  });
  assert.equal(productionRuntime.calls.some((item) => item.hasRole), false);
  assert.equal(productionRuntime.calls[0].audience, "liteasy-desktop");

  const stagingRuntime = runtime();
  const stagingHandler = createCloudRequestHandler(stagingRuntime, {
    allowedOrigins: [], database: { sslMode: "verify-full" },
    environment: "staging", s3: { region: "test" }
  });
  const stagingResult = response();
  await stagingHandler(request("GET", "/v1/account/capabilities"), stagingResult);
  assert.equal(stagingResult.status, 200);
  assert.equal(jsonBody(stagingResult).developerDiagnostics, true);
  assert.equal(jsonBody(stagingResult).multimodalVisualization.enabled, true);
  assert.deepEqual(
    stagingRuntime.calls.find((item) => item.hasRole),
    { hasRole: "developer_diagnostics", subjectId: "user_1" }
  );
});

test("persists the signed-in user's visualization preference", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, internalConfig());
  const result = response();
  await handler(request("POST", "/v1/account/preferences/multimodal-visualization/set", {
    enabled: false,
    idempotencyKey: "preference-0001"
  }), result);
  assert.equal(result.status, 200, result.body.toString("utf8"));
  const mutation = instance.calls.find((item) => item.visualizationPreference);
  assert.equal(mutation.subjectId, "user_1");
  assert.match(mutation.visualizationPreference.traceId, /^trace_/);
});

test("requires fresh platform administrator authorization for visualization entitlement changes", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, internalConfig());
  const result = response();
  await handler(request("POST", "/v1/admin/visualization/entitlements/set", {
    allowed: true,
    allowedModalities: ["semantic_graph"],
    expectedRevision: 0,
    explicitRequestsAllowed: true,
    idempotencyKey: "entitlement-0001",
    reason: "Approved for the research account",
    subjectId: "user_2"
  }), result);
  assert.equal(result.status, 200, result.body.toString("utf8"));
  assert.equal(instance.calls[0].audience, "liteasy-admin");
  const mutation = instance.calls.find((item) => item.visualizationEntitlement);
  assert.equal(mutation.principal.subjectId, "admin_1");
  assert.match(mutation.visualizationEntitlement.traceId, /^trace_/);

  const staleInstance = runtime();
  staleInstance.identityVerifier.verifyAuthorizationHeader = async (_header, audience) => ({
    audience,
    authenticationMethods: ["pwd", "mfa"],
    authTime: Math.floor(Date.now() / 1000) - 600,
    subject: "admin_1"
  });
  const staleResult = response();
  await createCloudRequestHandler(staleInstance, internalConfig())(request(
    "POST",
    "/v1/admin/visualization/entitlements/set",
    {
      allowed: true,
      allowedModalities: ["semantic_graph"],
      expectedRevision: 0,
      explicitRequestsAllowed: true,
      idempotencyKey: "entitlement-0002",
      reason: "Approved for the research account",
      subjectId: "user_2"
    }
  ), staleResult);
  assert.equal(staleResult.status, 403);
  assert.equal(staleInstance.calls.some((item) => item.visualizationEntitlement), false);
});

test("returns a stable provider probe failure through the fresh admin route", async () => {
  const instance = runtime();
  const result = response();
  await createCloudRequestHandler(instance, internalConfig())(request(
    "POST",
    "/v1/admin/visualization/providers/test",
    {
      expectedRevision: 3,
      idempotencyKey: "probe-failure-1",
      reason: "verify provider route",
      routeId: "route-1",
      providerRequest: { modality: "semantic_graph", dataClass: "paper" }
    }
  ), result);
  assert.equal(result.status, 503);
  assert.equal(jsonBody(result).code, "visualization_provider_unavailable");
  const probe = instance.calls.find((item) => item.visualizationProviderProbe);
  assert.equal(probe.principal.subjectId, "admin_1");
  assert.match(probe.visualizationProviderProbe.traceId, /^trace_/);
});

test("returns a replayable cancellation status through the fresh admin route", async () => {
  const instance = runtime();
  instance.visualizationService.testProviderRoute = async (principal, input) => {
    instance.calls.push({ principal, visualizationProviderProbe: input });
    throw new VisualizationServiceError("visualization_request_aborted", 499);
  };
  const result = response();
  await createCloudRequestHandler(instance, internalConfig())(request(
    "POST",
    "/v1/admin/visualization/providers/test",
    {
      expectedRevision: 3,
      idempotencyKey: "probe-cancel-1",
      reason: "verify provider route",
      routeId: "route-1",
      providerRequest: { modality: "semantic_graph", dataClass: "paper" }
    }
  ), result);
  assert.equal(result.status, 499);
  assert.equal(jsonBody(result).code, "visualization_request_aborted");
});

test("applies strict platform administrator visualization audit filters", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, internalConfig());
  const filtered = response();
  await handler(request(
    "GET",
    "/v1/admin/visualization/audit?subjectId=user-1&action=visualization_entitlement_updated&from=2026-08-01&to=2026-08-09&limit=25"
  ), filtered);
  assert.equal(filtered.status, 200, filtered.body.toString("utf8"));
  assert.deepEqual(instance.calls.find((item) => item.visualizationAudit).visualizationAudit, {
    action: "visualization_entitlement_updated",
    from: "2026-08-01",
    limit: 25,
    subjectId: "user-1",
    to: "2026-08-09"
  });

  const malformed = response();
  await handler(request("GET", "/v1/admin/visualization/audit?from=2026-08-10&to=2026-08-09"), malformed);
  assert.equal(malformed.status, 400);
  assert.equal(instance.calls.filter((item) => item.visualizationAudit).length, 1);
});

test("internal visualization generation requires the dedicated service identity", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, internalConfig());
  const result = response();
  await handler(request("POST", "/v1/internal/visualization/generate", {
    input: { providerRequest: {}, reservation: {} },
    subjectId: "user_1"
  }), result);
  assert.equal(result.status, 200, result.body.toString("utf8"));
  assert.deepEqual(instance.calls.find((item) => item.requirement).requirement, {
    clientId: "liteasy-visualization-service",
    requiredScope: "visualization:generate"
  });
  assert.equal(instance.calls.find((item) => item.visualizationGenerate).subjectId, "user_1");
});

test("serves subject-bound account visualization start, status, and cancellation", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, internalConfig());
  const started = response();
  await handler(request("POST", "/v1/account/visualization/requests", {
    artifactId: "artifact-1",
    nodeId: "node-1",
    requestId: "request-1",
    requestedArtifactCount: 1
  }), started);
  assert.equal(started.status, 202, started.body.toString("utf8"));
  assert.equal(instance.calls.find((item) => item.visualizationStart).subjectId, "user_1");

  const status = response();
  await handler(request("GET", "/v1/account/visualization/requests/request-1"), status);
  assert.equal(status.status, 200, status.body.toString("utf8"));
  assert.deepEqual(jsonBody(status).artifacts, [
    { artifactId: "result-1", artifactVersion: "liteasy.visualization/v1" }
  ]);
  assert.equal(instance.calls.find((item) => item.visualizationStatus).subjectId, "user_1");

  const cancelled = response();
  await handler(request("POST", "/v1/account/visualization/requests/request-1/cancel", {
    idempotencyKey: "request-1:cancel:user"
  }), cancelled);
  assert.equal(cancelled.status, 200, cancelled.body.toString("utf8"));
  assert.equal(instance.calls.find((item) => item.visualizationCancel).subjectId, "user_1");
});

test("keeps desktop account and confidential visualization identities non-interchangeable", async () => {
  const instance = runtime();
  instance.identityVerifier.verifyAuthorizationHeader = async (header, audience) => {
    if (header === "Bearer service" || audience !== "liteasy-desktop") {
      throw new IdentityError("access_token_invalid", 401);
    }
    return { audience, subject: "user_1" };
  };
  instance.identityVerifier.verifyServiceAuthorizationHeader = async (header) => {
    if (header === "Bearer desktop") throw new IdentityError("service_client_mismatch", 403);
    return { clientId: "liteasy-visualization-service", scopes: ["visualization:generate"] };
  };
  const handler = createCloudRequestHandler(instance, internalConfig());

  const serviceAtAccountRoute = response();
  await handler(request("POST", "/v1/account/visualization/requests", {
    artifactId: "artifact-1",
    nodeId: "node-1",
    requestId: "request-1",
    requestedArtifactCount: 1,
    subjectId: "user_2"
  }, "Bearer service"), serviceAtAccountRoute);
  assert.equal(serviceAtAccountRoute.status, 401);
  assert.equal(instance.calls.some((item) => item.visualizationStart), false);

  const desktopAtInternalRoute = response();
  await handler(request("POST", "/v1/internal/visualization/generate", {
    input: { providerRequest: {}, reservation: {} },
    subjectId: "user_2"
  }, "Bearer desktop"), desktopAtInternalRoute);
  assert.equal(desktopAtInternalRoute.status, 403);
  assert.equal(instance.calls.some((item) => item.visualizationGenerate), false);
});

test("passes identity-derived actor and server trace into a mutation", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: ["http://tauri.localhost"], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/library/folders/create", {
    expectedRevision: 0,
    idempotencyKey: "folder-create-0001",
    name: "Research",
    scopeId: "user_1",
    scopeType: "user"
  }), result);
  assert.equal(result.status, 200);
  const mutation = instance.calls.at(-1);
  assert.equal(mutation.input.actorId, "user_1");
  assert.match(mutation.input.traceId, /^trace_/);
});

test("requires the admin audience and fresh MFA before a platform role mutation", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: ["http://tauri.localhost"], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/admin/roles/grant", {
    idempotencyKey: "grant-role-0001",
    reason: "Add the security operations administrator",
    role: "platform_admin",
    subjectId: "admin_2"
  }), result);
  assert.equal(result.status, 200, result.body.toString("utf8"));
  assert.equal(instance.calls[0].audience, "liteasy-admin");
  const mutation = instance.calls.find((call) => call.grantRole);
  assert.equal(mutation.principal.subjectId, "admin_1");
  assert.match(mutation.grantRole.traceId, /^trace_/);

  const withoutMfa = runtime();
  withoutMfa.identityVerifier.verifyAuthorizationHeader = async (_header, audience) => ({
    audience,
    authenticationMethods: ["pwd"],
    authTime: Math.floor(Date.now() / 1000) - 10,
    subject: "admin_1"
  });
  const denied = response();
  await createCloudRequestHandler(withoutMfa, {
    allowedOrigins: ["http://tauri.localhost"], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  })(request("POST", "/v1/admin/roles/grant", {
    idempotencyKey: "grant-role-0002",
    reason: "Add the security operations administrator",
    role: "platform_admin",
    subjectId: "admin_2"
  }), denied);
  assert.equal(denied.status, 403);
  assert.equal(jsonBody(denied).code, "mfa_required");
  assert.equal(withoutMfa.calls.some((call) => call.grantRole), false);
});

test("requires the admin audience and fresh MFA for account lifecycle changes", async () => {
  const instance = runtime();
  const result = response();
  await createCloudRequestHandler(instance, {
    allowedOrigins: ["http://tauri.localhost"], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  })(request("POST", "/v1/admin/accounts/status", {
    idempotencyKey: "disable-user-0001",
    reason: "Approved security suspension",
    status: "disabled",
    subjectId: "user_2"
  }), result);
  assert.equal(result.status, 200, result.body.toString("utf8"));
  const call = instance.calls.find((item) => item.accountStatus);
  assert.equal(call.principal.subjectId, "admin_1");
  assert.equal(call.accountStatus.subjectId, "user_2");
  assert.match(call.accountStatus.traceId, /^trace_/);
  assert.equal(instance.calls[0].audience, "liteasy-admin");
});

test("reads and updates storage quotas through the administrator audience", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: ["http://tauri.localhost"], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  });
  const readResult = response();
  await handler(request("POST", "/v1/admin/quotas/get", {
    scopeId: "user_2",
    scopeType: "user"
  }), readResult);
  assert.equal(readResult.status, 200, readResult.body.toString("utf8"));
  assert.equal(instance.calls.find((item) => item.getQuota).principal.subjectId, "admin_1");

  const updateResult = response();
  await handler(request("POST", "/v1/admin/quotas/set", {
    expectedRevision: 1,
    idempotencyKey: "set-quota-0001",
    limitBytes: 2097152,
    reason: "Approved storage increase",
    scopeId: "user_2",
    scopeType: "user"
  }), updateResult);
  assert.equal(updateResult.status, 200, updateResult.body.toString("utf8"));
  const mutation = instance.calls.find((item) => item.setQuota);
  assert.equal(mutation.principal.subjectId, "admin_1");
  assert.match(mutation.setQuota.traceId, /^trace_/);
  assert.equal(instance.calls.filter((item) => item.audience === "liteasy-admin").length, 2);
});

test("lists governance metadata and requires fresh MFA for organization suspension", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: ["http://tauri.localhost"], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  });
  const listResult = response();
  await handler(request("GET", "/v1/admin/governance"), listResult);
  assert.equal(listResult.status, 200, listResult.body.toString("utf8"));
  assert.equal(instance.calls.find((item) => item.listGovernance).principal.subjectId, "admin_1");

  const statusResult = response();
  await handler(request("POST", "/v1/admin/organizations/status", {
    expectedRevision: 2,
    idempotencyKey: "suspend-organization-0001",
    organizationId: "organization_1",
    reason: "Approved security response suspension",
    status: "suspended"
  }), statusResult);
  assert.equal(statusResult.status, 200, statusResult.body.toString("utf8"));
  const mutation = instance.calls.find((item) => item.setOrganizationStatus);
  assert.equal(mutation.principal.subjectId, "admin_1");
  assert.equal(mutation.setOrganizationStatus.status, "suspended");
  assert.match(mutation.setOrganizationStatus.traceId, /^trace_/);
});

test("serves desktop model policy and protects control-plane administration", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: ["http://tauri.localhost"], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  });

  const desktopResult = response();
  await handler(request("GET", "/v1/model-policy"), desktopResult);
  assert.equal(desktopResult.status, 200, desktopResult.body.toString("utf8"));
  assert.equal(instance.calls[0].audience, "liteasy-desktop");
  assert.equal(jsonBody(desktopResult).cloudProxyEndpoint, "https://models.example.com/liteasy");

  const adminResult = response();
  await handler(request("GET", "/v1/admin/retrieval-sources"), adminResult);
  assert.equal(adminResult.status, 200, adminResult.body.toString("utf8"));
  assert.equal(instance.calls.find((item) => item.listRetrievalSources).principal.subjectId, "admin_1");

  const policyResult = response();
  await handler(request("POST", "/v1/admin/model-policy/set", {
    cloudProxyEndpoint: "https://models.example.com/liteasy",
    defaultProvider: "openai",
    expectedRevision: 1,
    idempotencyKey: "set-model-policy-0001",
    reason: "Approved model proxy rotation"
  }), policyResult);
  assert.equal(policyResult.status, 200, policyResult.body.toString("utf8"));
  const policyMutation = instance.calls.find((item) => item.setModelPolicy);
  assert.equal(policyMutation.principal.subjectId, "admin_1");
  assert.match(policyMutation.setModelPolicy.traceId, /^trace_/);

  const sourceResult = response();
  await handler(request("POST", "/v1/admin/retrieval-sources/save", {
    baseUrl: "https://api.openalex.org",
    enabled: true,
    expectedRevision: 0,
    idempotencyKey: "save-source-0001",
    name: "OpenAlex",
    reason: "Approved scholarly retrieval source",
    sourceKind: "database"
  }), sourceResult);
  assert.equal(sourceResult.status, 200, sourceResult.body.toString("utf8"));
  const sourceMutation = instance.calls.find((item) => item.saveRetrievalSource);
  assert.equal(sourceMutation.principal.subjectId, "admin_1");
  assert.match(sourceMutation.saveRetrievalSource.traceId, /^trace_/);
});

test("streams a scope-bound support document and records the grant in admin audit", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: ["http://tauri.localhost"], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/admin/support/documents/download", {
    documentId: "document_1",
    grantId: "supportgrant_1"
  }), result);
  assert.equal(result.status, 200, result.body.toString("utf8"));
  assert.equal(result.headers["content-type"], "application/pdf");
  assert.equal(result.body.toString("utf8"), "%PDF-content\n");
  const access = instance.calls.find((call) => call.access);
  assert.equal(access.access.action, "support_document_accessed");
  assert.equal(access.access.supportGrantId, "supportgrant_1");
  assert.equal(access.scope.role, "support");
});

test("returns stable safe errors without internal exception text", async () => {
  const instance = runtime();
  instance.identityVerifier.verifyAuthorizationHeader = async () => {
    throw new IdentityError("access_token_invalid");
  };
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: ["http://tauri.localhost"], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/library/tree", { scopeType: "user" }), result);
  assert.equal(result.status, 401);
  assert.equal(result.body.includes("access_token_invalid"), true);
  assert.match(jsonBody(result).traceId, /^trace_/);
});

test("maps PDF scanner rejection and outage to stable upload errors", async () => {
  for (const [code, status] of [
    ["pdf_security_rejected", 422],
    ["pdf_security_scanner_unavailable", 503]
  ]) {
    const instance = runtime();
    instance.pdfUploadService = {
      async upload() { throw new PdfUploadError(code, status); }
    };
    const handler = createCloudRequestHandler(instance, {
      allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
    });
    const upload = Readable.from(["%PDF-test"]);
    upload.method = "POST";
    upload.url = "/v1/library/documents/upload";
    upload.headers = {
      authorization: "Bearer valid",
      "content-type": "application/pdf",
      "x-idempotency-key": "pdf-upload-0001",
      "x-liteasy-expected-revision": "0",
      "x-liteasy-file-name": "paper.pdf",
      "x-liteasy-scope-id": "user_1",
      "x-liteasy-scope-type": "user"
    };
    const result = response();
    await handler(upload, result);

    assert.equal(result.status, status);
    assert.equal(jsonBody(result).code, code);
    assert.equal(JSON.stringify(jsonBody(result)).includes("scanner.internal"), false);
  }
});

test("allows only exact configured CORS origins and returns a bounded preflight", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: ["http://tauri.localhost"], database: { sslMode: "verify-full" },
    environment: "production", s3: { region: "test" }
  });
  const allowedRequest = request("OPTIONS", "/v1/library/tree");
  allowedRequest.headers.origin = "http://tauri.localhost";
  const allowedResponse = response();
  await handler(allowedRequest, allowedResponse);
  assert.equal(allowedResponse.status, 204);
  assert.equal(allowedResponse.headers["access-control-allow-origin"], "http://tauri.localhost");
  assert.equal(allowedResponse.headers["access-control-allow-credentials"], undefined);
  assert.match(allowedResponse.headers["access-control-allow-headers"], /x-liteasy-session-id/);
  assert.equal(allowedResponse.headers["access-control-allow-methods"], "DELETE, GET, PATCH, POST, OPTIONS");

  const deniedRequest = request("OPTIONS", "/v1/library/tree");
  deniedRequest.headers.origin = "https://untrusted.example";
  const deniedResponse = response();
  await handler(deniedRequest, deniedResponse);
  assert.equal(deniedResponse.status, 403);
  assert.equal(deniedResponse.headers["access-control-allow-origin"], undefined);
});

test("authorizes a document by scope-bound id without exposing or opening its object", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/library/documents/authorize", {
    documentId: "document_1", scopeId: "user_1", scopeType: "user"
  }), result);

  assert.equal(result.status, 200);
  const authorization = jsonBody(result);
  assert.equal(authorization.document.documentId, "document_1");
  assert.equal(authorization.document.contentHash, "a".repeat(64));
  assert.equal(authorization.revision, 3);
  assert.match(authorization.serverNow, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Date.parse(authorization.expiresAt) > Date.parse(authorization.serverNow));
  assert.equal(instance.calls.some((call) => call.storageKey), false);
  assert.equal(instance.calls.some((call) => call.access?.action === "authorize_pdf_read"), true);
});

test("cannot address an object by storage key or content hash", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/library/documents/download", {
    contentHash: "a".repeat(64),
    scopeId: "user_1",
    scopeType: "user",
    storageKey: "private/objects/aa/hash"
  }), result);

  assert.equal(result.status, 400);
  assert.equal(jsonBody(result).code, "library_document_invalid");
  assert.equal(instance.calls.some((call) => call.storageKey), false);
});

test("returns not found when a document id is absent from the authorized scope", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/library/documents/download", {
    documentId: "document_in_another_scope", scopeId: "user_1", scopeType: "user"
  }), result);

  assert.equal(result.status, 404);
  assert.equal(jsonBody(result).code, "library_document_not_found");
  assert.equal(instance.calls.some((call) => call.storageKey), false);
});

test("enforces organization export policy before looking up the document", async () => {
  const instance = runtime();
  instance.pool.query = async () => ({ rows: [{
    export_policy: "disabled",
    member_role: "member",
    member_status: "active",
    organization_status: "active",
    owner_subject: "owner_1",
    upload_policy: "owner_admins"
  }] });
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/library/documents/export", {
    documentId: "document_1", scopeId: "organization_1", scopeType: "organization"
  }), result);

  assert.equal(result.status, 403);
  assert.equal(jsonBody(result).code, "organization_export_forbidden");
  assert.equal(instance.calls.some((call) => call.documentId), false);
});

test("streams verified PDF bytes with inline and attachment response modes", async () => {
  for (const [route, disposition, auditAction] of [
    ["download", "inline", "download_pdf"],
    ["export", "attachment", "export_pdf"]
  ]) {
    const instance = runtime();
    const handler = createCloudRequestHandler(instance, {
      allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
    });
    const result = response();
    await handler(request("POST", `/v1/library/documents/${route}`, {
      documentId: "document_1", scopeId: "user_1", scopeType: "user"
    }), result);

    assert.equal(result.status, 200);
    assert.equal(result.headers["content-type"], "application/pdf");
    assert.equal(result.headers["content-length"], "14");
    assert.match(result.headers["content-disposition"], new RegExp(`^${disposition};`));
    assert.equal(result.body.toString("utf8"), "%PDF-content\n");
    assert.equal(instance.calls.some((call) => call.access?.action === auditAction), true);
  }
});

test("refuses an object whose length, media type, or hash metadata differs from PostgreSQL", async () => {
  for (const mismatch of [
    { byteLength: 13, mediaType: "application/pdf", metadata: { sha256: "a".repeat(64) } },
    { byteLength: 14, mediaType: "application/octet-stream", metadata: { sha256: "a".repeat(64) } },
    { byteLength: 14, mediaType: "application/pdf", metadata: { sha256: "b".repeat(64) } }
  ]) {
    const instance = runtime();
    instance.objectStore.openObject = async () => ({ body: Readable.from([]), ...mismatch });
    const handler = createCloudRequestHandler(instance, {
      allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
    });
    const result = response();
    await handler(request("POST", "/v1/library/documents/download", {
      documentId: "document_1", scopeId: "user_1", scopeType: "user"
    }), result);
    assert.equal(result.status, 500);
    assert.equal(jsonBody(result).code, "storage_object_integrity_mismatch");
  }
});

test("authorizes both source export and target upload for a cross-scope copy", async () => {
  const instance = runtime();
  instance.pool.query = async (_sql, values) => {
    const organizationId = values[0];
    return { rows: [{
      export_policy: organizationId === "org_source" ? "all_members" : "disabled",
      member_role: "member",
      member_status: "active",
      organization_status: "active",
      owner_subject: "owner_1",
      upload_policy: organizationId === "org_target" ? "all_members" : "owner_admins"
    }] };
  };
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/library/entries/copy", {
    documentId: "document_1",
    expectedRevision: 0,
    idempotencyKey: "entry-copy-0001",
    source: { scopeId: "org_source", scopeType: "organization" },
    target: { folderId: "folder_target", scopeId: "org_target", scopeType: "organization" }
  }), result);

  assert.equal(result.status, 200);
  const call = instance.calls.find((item) => item.copy);
  assert.equal(call.sourceScope.scopeId, "org_source");
  assert.equal(call.targetScope.scopeId, "org_target");
  assert.equal(call.copy.folderId, "folder_target");
});

test("does not call the copy repository when target organization upload is forbidden", async () => {
  const instance = runtime();
  instance.pool.query = async (_sql, values) => {
    const organizationId = values[0];
    return { rows: [{
      export_policy: organizationId === "org_source" ? "all_members" : "disabled",
      member_role: "member",
      member_status: "active",
      organization_status: "active",
      owner_subject: "owner_1",
      upload_policy: "owner_admins"
    }] };
  };
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/library/entries/copy", {
    documentId: "document_1",
    expectedRevision: 0,
    idempotencyKey: "entry-copy-denied-0001",
    source: { scopeId: "org_source", scopeType: "organization" },
    target: { folderId: "folder_target", scopeId: "org_target", scopeType: "organization" }
  }), result);

  assert.equal(result.status, 403);
  assert.equal(jsonBody(result).code, "organization_upload_forbidden");
  assert.equal(instance.calls.some((item) => item.copy), false);
});

test("lets an organization owner update storage policy with identity-derived actor data", async () => {
  const instance = runtime();
  instance.pool.query = async () => ({ rows: [{
    export_policy: "disabled",
    member_role: null,
    member_status: null,
    organization_status: "active",
    owner_subject: "user_1",
    upload_policy: "owner_admins"
  }] });
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/org/storage-policy/update", {
    actorId: "attacker",
    expectedRevision: 2,
    exportPolicy: "all_members",
    idempotencyKey: "policy-update-0001",
    organizationId: "organization_1",
    uploadPolicy: "all_members"
  }), result);

  assert.equal(result.status, 200);
  const call = instance.calls.find((item) => item.organizationPolicyUpdate);
  assert.equal(call.scope.role, "owner");
  assert.equal(call.organizationPolicyUpdate.actorId, "user_1");
  assert.match(call.organizationPolicyUpdate.traceId, /^trace_/);
});

test("denies an organization member policy mutation before repository persistence", async () => {
  const instance = runtime();
  instance.pool.query = async () => ({ rows: [{
    export_policy: "all_members",
    member_role: "member",
    member_status: "active",
    organization_status: "active",
    owner_subject: "owner_1",
    upload_policy: "all_members"
  }] });
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/org/storage-policy/update", {
    expectedRevision: 0,
    exportPolicy: "disabled",
    idempotencyKey: "policy-update-0002",
    organizationId: "organization_1",
    uploadPolicy: "owner_admins"
  }), result);

  assert.equal(result.status, 403);
  assert.equal(jsonBody(result).code, "organization_manage_forbidden");
  assert.equal(instance.calls.some((item) => item.organizationPolicyUpdate), false);
});

test("derives personalization ownership only from the verified access token", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/personalization/signal", {
    actorId: "attacker",
    idempotencyKey: "signal-create-0001",
    subjectId: "attacker",
    type: "document_opened"
  }), result);

  assert.equal(result.status, 200);
  const call = instance.calls.find((item) => item.personalizationSignal);
  assert.equal(call.subjectId, "user_1");
  assert.equal(call.personalizationSignal.actorId, "user_1");
});

test("returns a stable conflict when disabled personalization rejects new data", async () => {
  for (const [route, body] of [
    ["/v1/personalization/signal", { disabledForTest: true, idempotencyKey: "signal-disabled-0001" }],
    ["/v1/documents/metadata-sync", { disabledForTest: true, documents: [], idempotencyKey: "manifest-disabled-0001" }]
  ]) {
    const instance = runtime();
    const handler = createCloudRequestHandler(instance, {
      allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
    });
    const result = response();
    await handler(request("POST", route, body), result);
    assert.equal(result.status, 409);
    assert.equal(jsonBody(result).code, "personalization_disabled");
    assert.match(jsonBody(result).traceId, /^trace_/);
  }
});

test("wraps metadata synchronization results in the desktop response contract", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/documents/metadata-sync", {
    documents: [{ syncDocumentId: "sync_document_1", title: "Paper" }],
    idempotencyKey: "manifest-sync-0001",
    subjectId: "attacker"
  }), result);

  assert.equal(result.status, 200);
  assert.deepEqual(jsonBody(result), {
    result: { acceptedCount: 1, personalizationVersion: 1, syncId: "sync_1" }
  });
  const call = instance.calls.find((item) => item.manifestSync);
  assert.equal(call.subjectId, "user_1");
});

test("derives recommendation ownership from the Bearer token and ignores forged session ids", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const generated = response();
  await handler(request("POST", "/v1/recommendations", {
    selectedDocuments: [{ id: "document_1", title: "Target paper" }],
    sessionId: "attacker"
  }), generated);
  const feedback = response();
  await handler(request("POST", "/v1/recommendations/feedback", {
    action: "dismissed",
    candidate: { id: "candidate_1", source: "Crossref", title: "Candidate" },
    idempotencyKey: "recommendation-feedback-0001",
    sessionId: "attacker"
  }), feedback);

  assert.equal(generated.status, 200);
  assert.equal(feedback.status, 200);
  assert.equal(instance.calls.find((item) => item.recommendationGenerate).subjectId, "user_1");
  assert.equal(instance.calls.find((item) => item.recommendationFeedback).subjectId, "user_1");
  assert.match(instance.calls.find((item) => item.recommendationGenerate).recommendationGenerate.traceId, /^trace_/);
});

test("issues recommendation PDF grants for the verified desktop subject", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/recommendations/pdf-grant", {
    candidateId: "reading-candidate:doi:10.1000/test"
  }), result);

  assert.equal(result.status, 200);
  assert.equal(jsonBody(result).sourceId, "reading-candidate:doi:10.1000/test");
  const call = instance.calls.find((item) => item.recommendationPdfGrant);
  assert.equal(call.subjectId, "user_1");
  assert.deepEqual(call.recommendationPdfGrant, {
    candidateId: "reading-candidate:doi:10.1000/test"
  });
});

test("creates a team annotation with organization membership and token-derived authorship", async () => {
  const instance = runtime();
  instance.pool.query = async () => ({ rows: [{
    export_policy: "disabled",
    member_role: "member",
    member_status: "active",
    organization_status: "active",
    owner_subject: "owner_1",
    upload_policy: "owner_admins"
  }] });
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/org/annotations/create", {
    actorId: "attacker",
    body: {
      clientAnnotationId: "local_annotation_1",
      excerpt: "Evidence",
      kind: "note",
      page: 3,
      rects: [],
      text: "Shared note",
      updatedAt: "2026-08-06T00:00:00.000Z"
    },
    documentId: "document_1",
    idempotencyKey: "annotation-create-0001",
    organizationId: "organization_1"
  }), result);

  assert.equal(result.status, 200);
  const call = instance.calls.find((item) => item.annotationCreate);
  assert.equal(call.scope.role, "member");
  assert.equal(call.annotationCreate.actorId, "user_1");
  assert.match(call.annotationCreate.traceId, /^trace_/);
});

test("derives organization invitation actors from the access token and ignores client identity fields", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/org/invite", {
    actorId: "attacker",
    displayName: "Forged administrator",
    expectedRevision: 0,
    idempotencyKey: "organization-invite-0001",
    organizationId: "organization_1",
    role: "member",
    sessionId: "untrusted-session",
    targetSubject: "user_2"
  }), result);

  assert.equal(result.status, 200);
  const call = instance.calls.find((item) => item.organizationInvite);
  assert.equal(call.identity.subject, "user_1");
  assert.equal(call.organizationInvite.actorId, "attacker");
  assert.match(call.organizationInvite.traceId, /^trace_/);
});

test("accepts an organization invitation only as the verified token subject", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const result = response();
  await handler(request("POST", "/v1/org/join", {
    expectedInvitationRevision: 0,
    idempotencyKey: "organization-accept-0001",
    invitationToken: `orginv_${"a".repeat(43)}`,
    subject: "attacker"
  }), result);

  assert.equal(result.status, 200);
  const call = instance.calls.find((item) => item.organizationAcceptInvitation);
  assert.equal(call.identity.subject, "user_1");
  assert.equal(call.organizationAcceptInvitation.subject, "attacker");
});

test("routes organization list and summary through the same desktop token audience", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, {
    allowedOrigins: [], database: { sslMode: "verify-full" }, environment: "production", s3: { region: "test" }
  });
  const listResponse = response();
  await handler(request("POST", "/v1/org/list", { sessionId: "ignored" }), listResponse);
  const summaryResponse = response();
  await handler(request("POST", "/v1/org/summary", {
    organizationId: "organization_1", sessionId: "ignored"
  }), summaryResponse);

  assert.equal(listResponse.status, 200);
  assert.equal(summaryResponse.status, 200);
  assert.equal(instance.calls.find((item) => item.organizationList).identity.subject, "user_1");
  assert.equal(instance.calls.find((item) => item.organizationSummary).identity.subject, "user_1");
  assert.equal(instance.calls.filter((item) => item.audience === "liteasy-desktop").length, 2);
});

test("authorizes Intuecho organization visibility only through the dedicated service audience", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, internalConfig());
  const result = response();
  await handler(request("POST", "/v1/internal/intuecho/organizations/access", {
    organizationId: "organization_1",
    userSubject: "member_1"
  }, "Bearer service-token"), result);

  assert.equal(result.status, 200);
  assert.deepEqual(jsonBody(result), { allowed: true, role: "member" });
  assert.deepEqual(instance.calls.find((item) => item.requirement).requirement, {
    clientId: "intuecho-organization-service",
    requiredScope: "organization:authorize"
  });
  assert.deepEqual(instance.calls.find((item) => item.authorizeIntuechoAccess).authorizeIntuechoAccess, {
    organizationId: "organization_1",
    userSubject: "member_1"
  });

  const memberships = response();
  await handler(request("POST", "/v1/internal/intuecho/organizations/memberships", {
    userSubject: "member_1"
  }, "Bearer service-token"), memberships);
  assert.equal(memberships.status, 200);
  assert.equal(jsonBody(memberships).organizations[0].organizationId, "organization_1");
  assert.deepEqual(instance.calls.find((item) => item.organizationListForIntuecho).organizationListForIntuecho, {
    userSubject: "member_1"
  });
});

test("creates Intuecho invitation cards through Liteasy authority without trusting a Web token", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, internalConfig());
  const result = response();
  await handler(request("POST", "/v1/internal/intuecho/organizations/invitations", {
    actorSubject: "admin_1",
    idempotencyKey: "intuecho-message-0001",
    organizationId: "organization_1",
    role: "member",
    targetSubject: "user_2"
  }, "Bearer service-token"), result);

  assert.equal(result.status, 201);
  assert.equal(jsonBody(result).invitation.invitationId, "orginvite_1");
  const call = instance.calls.find((item) => item.inviteFromIntuecho);
  assert.equal(call.identity.audience, "liteasy-internal");
  assert.equal(call.inviteFromIntuecho.actorSubject, "admin_1");
  assert.match(call.inviteFromIntuecho.traceId, /^trace_/);
  assert.equal(instance.calls.some((item) => item.audience === "liteasy-desktop"), false);
});

test("forwards literature metadata through the managed library mutation boundary", async () => {
  const instance = runtime();
  const handler = createCloudRequestHandler(instance, internalConfig());
  const result = response();
  const literature = {
    authors: ["Ada Lovelace"],
    identifiers: [{ kind: "doi", source: "manual", value: "10.1000/liteasy" }],
    literatureId: "literature:doi:10.1000/liteasy",
    provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual" },
    title: "Cloud Literature Metadata",
    year: 2026
  };

  await handler(request("POST", "/v1/library/documents/update", {
    documentId: "document_1",
    expectedRevision: 1,
    idempotencyKey: "literature-route-1",
    literature,
    scopeType: "user"
  }), result);

  assert.equal(result.status, 200);
  const call = instance.calls.find((item) => item.libraryEntryUpdate);
  assert.deepEqual(call.libraryEntryUpdate.literature, literature);
  assert.equal(call.libraryEntryUpdate.actorId, "user_1");
  assert.deepEqual(call.scope, {
    actorId: "user_1", role: "owner", scopeId: "user_1", scopeType: "user"
  });
});

test("rejects organization literature writes from a member before repository access", async () => {
  const instance = runtime();
  instance.pool.query = async () => ({ rows: [{
    export_policy: "all_members",
    member_role: "member",
    member_status: "active",
    organization_status: "active",
    owner_subject: "owner_1",
    upload_policy: "all_members"
  }] });
  const handler = createCloudRequestHandler(instance, internalConfig());
  const result = response();

  await handler(request("POST", "/v1/library/documents/update", {
    documentId: "document_1",
    expectedRevision: 1,
    idempotencyKey: "literature-org-member-1",
    literature: {
      authors: ["Ada Lovelace"],
      identifiers: [{ kind: "doi", source: "manual", value: "10.1000/liteasy" }],
      literatureId: "literature:doi:10.1000/liteasy",
      provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual" },
      title: "Cloud Literature Metadata"
    },
    scopeId: "organization_1",
    scopeType: "organization"
  }), result);

  assert.equal(result.status, 403);
  assert.equal(jsonBody(result).code, "organization_manage_forbidden");
  assert.equal(instance.calls.some((item) => item.libraryEntryUpdate), false);
});
