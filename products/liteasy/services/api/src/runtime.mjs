import { PostgresAccountLifecycleRepository } from "./accountLifecycleRepository.mjs";
import { AccountLifecycleService } from "./accountLifecycleService.mjs";
import { PostgresAgentArtifactRepository } from "./agentArtifactRepository.mjs";
import { createIdentityVerifier, verifyIdentityProviderReadiness } from "./identityVerifier.mjs";
import { IdentityAdminClient } from "./identityAdminClient.mjs";
import { IntuechoLifecycleClient } from "./intuechoLifecycleClient.mjs";
import { CrossrefRecommendationProvider } from "./crossrefRecommendationProvider.mjs";
import { createExternalRetrievalConnectors } from "./externalRetrievalConnectors.mjs";
import {
  ExternalKnowledgeService,
  PostgresExternalKnowledgeRepository
} from "./externalKnowledgeService.mjs";
import { PostgresLibraryRepository } from "./libraryRepository.mjs";
import { ModelProxyService } from "./modelProxyService.mjs";
import { createModelUpstreamProviders } from "./modelUpstreamProviders.mjs";
import { verifyPostgresMigrations } from "./migrations.mjs";
import { PostgresOrganizationGovernanceRepository } from "./organizationGovernanceRepository.mjs";
import { PostgresOrganizationPolicyRepository } from "./organizationPolicyRepository.mjs";
import { createPostgresPool, verifyPostgresReadiness } from "./postgres.mjs";
import { PdfUploadService } from "./pdfUploadService.mjs";
import { HttpsPdfSecurityScanner } from "./pdfSecurityScanner.mjs";
import { PostgresPersonalizationRepository } from "./personalizationRepository.mjs";
import { PostgresPlatformAdminRepository } from "./platformAdminRepository.mjs";
import { PostgresRecommendationRepository } from "./recommendationRepository.mjs";
import { RecommendationService } from "./recommendationService.mjs";
import { S3ObjectStore } from "./s3ObjectStore.mjs";
import { SecureExternalPdfDownloader } from "./secureExternalPdfDownloader.mjs";
import { PostgresTeamAnnotationRepository } from "./teamAnnotationRepository.mjs";
import { authorizeLibraryScope } from "./libraryAuthorization.mjs";
import { VisualizationProviderGateway } from "./visualizationProviderGateway.mjs";
import { validateVisualizationArtifact } from "./visualizationArtifactValidator.mjs";
import { PostgresVisualizationRepository } from "./visualizationRepository.mjs";
import { VisualizationService } from "./visualizationService.mjs";

export async function startCloudRuntime(config, dependencies = {}) {
  const pool = dependencies.pool ?? createPostgresPool(config.database);
  const objectStore = dependencies.objectStore ?? new S3ObjectStore(config.s3);
  const identityVerifier = dependencies.identityVerifier ?? createIdentityVerifier(config.identity);
  const identityReadinessCheck = dependencies.identityReadinessCheck ?? verifyIdentityProviderReadiness;
  const identityAdminClient = dependencies.identityAdminClient ?? new IdentityAdminClient(config.identity);
  const intuechoLifecycleClient = dependencies.intuechoLifecycleClient ??
    new IntuechoLifecycleClient(config.intuecho);
  const accountLifecycleRepository = dependencies.accountLifecycleRepository ??
    new PostgresAccountLifecycleRepository(pool);
  const agentArtifactRepository = dependencies.agentArtifactRepository ??
    new PostgresAgentArtifactRepository(pool);
  const accountLifecycleService = dependencies.accountLifecycleService ?? new AccountLifecycleService(
    accountLifecycleRepository,
    identityAdminClient,
    intuechoLifecycleClient
  );
  const libraryRepository = dependencies.libraryRepository ?? new PostgresLibraryRepository(pool);
  const visualizationRepository = dependencies.visualizationRepository ??
    new PostgresVisualizationRepository(pool);
  const visualizationProviderGateway = dependencies.visualizationProviderGateway ??
    new VisualizationProviderGateway({
      adapters: dependencies.visualizationProviderAdapters ?? {},
      egressPolicy: config.visualization?.egressPolicy
    });
  const visualizationDocumentAuthorizer = dependencies.visualizationDocumentAuthorizer ??
    (async ({ document, subjectId }) => {
      const scope = await authorizeLibraryScope(pool, {
        audience: "liteasy-desktop",
        subject: subjectId
      }, document, "read");
      const current = await libraryRepository.getDownloadablePdf(scope, document?.documentId);
      return {
        allowed: current.contentHash === document?.sourceIdentityHash,
        scopeId: scope.scopeId,
        scopeType: scope.scopeType,
        sourceIdentityHash: current.contentHash
      };
    });
  const visualizationService = dependencies.visualizationService ?? new VisualizationService({
    authorizeDocument: visualizationDocumentAuthorizer,
    gateway: visualizationProviderGateway,
    repository: visualizationRepository,
    validateArtifact: dependencies.visualizationArtifactValidator ?? validateVisualizationArtifact
  });
  const organizationGovernanceRepository = dependencies.organizationGovernanceRepository ??
    new PostgresOrganizationGovernanceRepository(pool);
  const organizationPolicyRepository = dependencies.organizationPolicyRepository ??
    new PostgresOrganizationPolicyRepository(pool);
  const personalizationRepository = dependencies.personalizationRepository ??
    new PostgresPersonalizationRepository(pool);
  const platformAdminRepository = dependencies.platformAdminRepository ??
    new PostgresPlatformAdminRepository(pool, { environment: config.environment });
  const modelProviders = dependencies.modelProviders ?? createModelUpstreamProviders(
    config.models,
    { fetchImpl: dependencies.modelFetch }
  );
  const modelProxyService = dependencies.modelProxyService ?? new ModelProxyService({
    loadPolicy: () => platformAdminRepository.loadModelPolicy(),
    providers: modelProviders
  });
  const retrievalConfig = config.retrieval ?? {
    contactEmail: config.recommendation.mailto,
    maximumPdfBytes: 32 * 1024 * 1024,
    timeoutMs: config.recommendation.timeoutMs
  };
  const externalRetrievalConnectors = dependencies.externalRetrievalConnectors ??
    createExternalRetrievalConnectors(retrievalConfig, { fetchImpl: dependencies.retrievalFetch });
  const externalKnowledgeRepository = dependencies.externalKnowledgeRepository ??
    new PostgresExternalKnowledgeRepository(pool);
  const externalPdfDownloader = dependencies.externalPdfDownloader ?? new SecureExternalPdfDownloader({
    contactEmail: retrievalConfig.contactEmail,
    maximumBytes: retrievalConfig.maximumPdfBytes,
    timeoutMs: retrievalConfig.timeoutMs
  });
  const externalKnowledgeService = dependencies.externalKnowledgeService ?? new ExternalKnowledgeService({
    connectors: externalRetrievalConnectors,
    downloader: externalPdfDownloader,
    repository: externalKnowledgeRepository
  });
  const recommendationRepository = dependencies.recommendationRepository ??
    new PostgresRecommendationRepository(pool);
  const recommendationProvider = dependencies.recommendationProvider ??
    new CrossrefRecommendationProvider(config.recommendation);
  const recommendationService = dependencies.recommendationService ??
    new RecommendationService(
      recommendationRepository,
      recommendationProvider,
      externalKnowledgeRepository
    );
  const teamAnnotationRepository = dependencies.teamAnnotationRepository ??
    new PostgresTeamAnnotationRepository(pool);
  const pdfSecurityScanner = dependencies.pdfSecurityScanner ?? (
    dependencies.pdfUploadService
      ? undefined
      : new HttpsPdfSecurityScanner(config.pdfSecurity, { fetchImpl: dependencies.pdfScannerFetch })
  );
  const pdfUploadService = dependencies.pdfUploadService ?? new PdfUploadService(
    libraryRepository,
    objectStore,
    pdfSecurityScanner
  );
  try {
    const postgres = await verifyPostgresReadiness(pool);
    await verifyPostgresMigrations(pool);
    const objectStorage = await objectStore.assertSecurityConfiguration();
    const identity = await identityReadinessCheck(config.identity);
    const storageWorkflows = await pdfUploadService.repairPendingWorkflows();
    const pdfSecurity = await pdfUploadService.assertNoUnverifiedObjects();
    return {
      accountLifecycleService,
      agentArtifactRepository,
      close: async () => pool.end(),
      identityVerifier,
      externalKnowledgeService,
      libraryRepository,
      modelProxyService,
      objectStore,
      organizationGovernanceRepository,
      organizationPolicyRepository,
      personalizationRepository,
      pdfUploadService,
      platformAdminRepository,
      pool,
      recommendationRepository,
      recommendationService,
      teamAnnotationRepository,
      visualizationProviderGateway,
      visualizationRepository,
      visualizationService,
      readiness: Object.freeze({
        identity: identity.discovery && identity.jwks ? "ready" : "failed",
        migrations: "current",
        modelProxy: Object.keys(modelProviders).length > 0 ? "configured" : "unavailable",
        objectStorage: objectStorage.privateAccess ? "ready" : "failed",
        pdfSecurity: pdfSecurity.unverified === 0 ? "ready" : "failed",
        postgres: postgres.writable ? "ready" : "failed",
        storageWorkflows: storageWorkflows.scanned === storageWorkflows.repaired ? "current" : "failed"
      })
    };
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}
