import { PostgresAccountLifecycleRepository } from "./accountLifecycleRepository.mjs";
import { AccountLifecycleService } from "./accountLifecycleService.mjs";
import { AiProviderConfigurationService } from "./aiProviderConfigurationService.mjs";
import { PostgresAgentArtifactRepository } from "./agentArtifactRepository.mjs";
import { PostgresGrobidParseRepository } from "./grobidParseRepository.mjs";
import { GrobidParseService } from "./grobidParseService.mjs";
import { createIdentityVerifier, verifyIdentityProviderReadiness } from "./identityVerifier.mjs";
import { IdentityAdminClient } from "./identityAdminClient.mjs";
import { IntuechoLifecycleClient } from "./intuechoLifecycleClient.mjs";
import { IntuechoLiteratureClient } from "./intuechoLiteratureClient.mjs";
import { CrossrefRecommendationProvider } from "./crossrefRecommendationProvider.mjs";
import { createExternalRetrievalConnectors } from "./externalRetrievalConnectors.mjs";
import {
  ExternalKnowledgeService,
  PostgresExternalKnowledgeRepository
} from "./externalKnowledgeService.mjs";
import { PostgresLibraryRepository } from "./libraryRepository.mjs";
import { PostgresMarketingApplicationRepository } from "./marketingApplicationRepository.mjs";
import { ModelProxyService } from "./modelProxyService.mjs";
import { createModelUpstreamProviders } from "./modelUpstreamProviders.mjs";
import { MineruPdfService } from "./mineruPdfService.mjs";
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
import { EnvironmentVisualizationSecretStore } from "./visualizationSecretStore.mjs";
import { validateVisualizationArtifact } from "./visualizationArtifactValidator.mjs";
import { VisualizationArtifactCompilerRegistry } from "./visualizationArtifactCompiler.mjs";
import { productionStaticScienceVisualizationCompilers } from "./staticScienceVisualizationCompilers.mjs";
import { productionInteractiveMathVisualizationCompilers } from "./interactiveMathVisualizationCompilers.mjs";
import { productionProcessRasterVisualizationCompilers } from "./processRasterVisualizationCompilers.mjs";
import { PostgresVisualizationGenerationRepository } from "./visualizationGenerationRepository.mjs";
import { VisualizationOrchestrationService } from "./visualizationOrchestrationService.mjs";
import { VisualizationOrchestrationWorker } from "./visualizationOrchestrationWorker.mjs";
import { PostgresVisualizationRepository } from "./visualizationRepository.mjs";
import { VisualizationService } from "./visualizationService.mjs";
import { productionVisualizationProviderAdapters } from "./visualizationStructuredProviderAdapter.mjs";
import { ThinReadingVisualizationSourceResolver } from "./thinReadingVisualizationSource.mjs";
import { LocalTesseractRasterOcr } from "./visualizationRasterOcr.mjs";

export async function startCloudRuntime(config, dependencies = {}) {
  const pool = dependencies.pool ?? createPostgresPool(config.database);
  const objectStore = dependencies.objectStore ?? new S3ObjectStore(config.s3);
  const identityVerifier = dependencies.identityVerifier ?? createIdentityVerifier(config.identity);
  const identityReadinessCheck = dependencies.identityReadinessCheck ?? verifyIdentityProviderReadiness;
  const identityAdminClient = dependencies.identityAdminClient ?? new IdentityAdminClient(config.identity);
  const intuechoLifecycleClient = dependencies.intuechoLifecycleClient ??
    new IntuechoLifecycleClient(config.intuecho);
  const literatureAuthorityClient = dependencies.literatureAuthorityClient ??
    dependencies.literatureProjectionVerifier ??
    (config.intuecho?.literatureProjection
      ? new IntuechoLiteratureClient(config.intuecho.literatureProjection, {
          fetchImpl: dependencies.intuechoLiteratureFetch
        })
      : undefined);
  const accountLifecycleRepository = dependencies.accountLifecycleRepository ??
    new PostgresAccountLifecycleRepository(pool);
  const agentArtifactRepository = dependencies.agentArtifactRepository ??
    new PostgresAgentArtifactRepository(pool);
  const grobidParseRepository = dependencies.grobidParseRepository ??
    new PostgresGrobidParseRepository(pool);
  const grobidParseService = dependencies.grobidParseService ?? new GrobidParseService({
    ...config.grobid,
    fetchImpl: dependencies.grobidFetch,
    repository: grobidParseRepository
  });
  const accountLifecycleService = dependencies.accountLifecycleService ?? new AccountLifecycleService(
    accountLifecycleRepository,
    identityAdminClient,
    intuechoLifecycleClient
  );
  const libraryRepository = dependencies.libraryRepository ?? new PostgresLibraryRepository(pool, {
    literatureProjectionVerifier: literatureAuthorityClient
  });
  const marketingApplicationRepository = dependencies.marketingApplicationRepository ??
    new PostgresMarketingApplicationRepository(pool);
  const visualizationRepository = dependencies.visualizationRepository ??
    new PostgresVisualizationRepository(pool);
  const visualizationArtifactCompilerRegistry = dependencies.visualizationArtifactCompilerRegistry ??
    new VisualizationArtifactCompilerRegistry({
      catalog: dependencies.visualizationBuiltinCatalog,
      compilers: dependencies.visualizationArtifactCompilers ?? {
        ...productionStaticScienceVisualizationCompilers,
        ...productionInteractiveMathVisualizationCompilers,
        ...productionProcessRasterVisualizationCompilers
      },
      validateArtifact: dependencies.visualizationArtifactValidator ?? validateVisualizationArtifact
    });
  const visualizationProviderAdapters = dependencies.visualizationProviderAdapters ??
    productionVisualizationProviderAdapters;
  const visualizationSecretStore = dependencies.visualizationSecretStore ??
    new EnvironmentVisualizationSecretStore(config.visualization?.secrets ?? {});
  const visualizationProviderGateway = dependencies.visualizationProviderGateway ??
    (dependencies.visualizationProviderGatewayFactory
      ? dependencies.visualizationProviderGatewayFactory({
        adapters: visualizationProviderAdapters,
        egressPolicy: { allowedHostnames: config.visualization?.egressHostnames ?? [] },
        secretStore: visualizationSecretStore
      })
      : new VisualizationProviderGateway({
        adapters: visualizationProviderAdapters,
        egressPolicy: { allowedHostnames: config.visualization?.egressHostnames ?? [] },
        secretStore: visualizationSecretStore
      }));
  const thinReadingVisualizationSourceResolver = dependencies.thinReadingVisualizationSourceResolver ??
    new ThinReadingVisualizationSourceResolver({ agentArtifactRepository, pool });
  const visualizationDocumentAuthorizer = dependencies.visualizationDocumentAuthorizer ??
    (async ({ document, subjectId }) => {
      if (document?.authorization?.kind === "agent_artifact") {
        const authorization = document.authorization;
        const source = await thinReadingVisualizationSourceResolver.resolve({
          artifactId: authorization.artifactId,
          nodeId: authorization.nodeId,
          subjectId
        });
        const current = source.documents.find((candidate) => candidate.documentId === document.documentId);
        return {
          allowed: source.artifactRevision === authorization.artifactRevision &&
            source.intentHash === authorization.intentHash &&
            current?.sourceIdentityHash === document.sourceIdentityHash,
          artifactId: authorization.artifactId,
          artifactRevision: authorization.artifactRevision,
          intentHash: authorization.intentHash,
          kind: "agent_artifact",
          nodeId: authorization.nodeId,
          scopeId: subjectId,
          scopeType: "user",
          sourceIdentityHash: current?.sourceIdentityHash
        };
      }
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
  const visualizationRasterOcr = dependencies.visualizationRasterOcr ?? new LocalTesseractRasterOcr();
  const visualizationService = dependencies.visualizationService ?? new VisualizationService({
    authorizeDocument: visualizationDocumentAuthorizer,
    gateway: visualizationProviderGateway,
    objectStore,
    rasterOcr: visualizationRasterOcr,
    repository: visualizationRepository,
    validateArtifact: dependencies.visualizationArtifactValidator ?? validateVisualizationArtifact
  });
  const visualizationGenerationRepository = dependencies.visualizationGenerationRepository ??
    new PostgresVisualizationGenerationRepository(pool);
  const visualizationOrchestrationWorker = dependencies.visualizationOrchestrationWorker ??
    new VisualizationOrchestrationWorker({
      compilerRegistry: visualizationArtifactCompilerRegistry,
      generationRepository: visualizationGenerationRepository,
      sourceResolver: thinReadingVisualizationSourceResolver,
      visualizationService
    });
  const visualizationOrchestrationService = dependencies.visualizationOrchestrationService ??
    new VisualizationOrchestrationService({
      compilerRegistry: visualizationArtifactCompilerRegistry,
      generationRepository: visualizationGenerationRepository,
      sourceResolver: thinReadingVisualizationSourceResolver,
      visualizationService,
      worker: visualizationOrchestrationWorker
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
  const mineruPdfService = dependencies.mineruPdfService ?? new MineruPdfService({
    ...config.mineru,
    model: config.models?.providers?.openai,
    modelFetch: dependencies.modelFetch
  });
  const aiProviderConfigurationService = dependencies.aiProviderConfigurationService ??
    new AiProviderConfigurationService({
      encryptionKey: config.platform?.configurationEncryptionKey,
      environment: config.environment,
      fallbackConfig: config,
      fetchImpl: dependencies.modelFetch,
      mineruPdfService,
      modelProxyService,
      pool,
      visualizationSecretStore
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
    const grobid = await grobidParseService.assertConfigured();
    const rasterOcr = typeof visualizationRasterOcr.assertConfigured === "function"
      ? await visualizationRasterOcr.assertConfigured()
      : { engine: visualizationRasterOcr.engine ?? "injected", languages: [] };
    const storageWorkflows = await pdfUploadService.repairPendingWorkflows();
    const pdfSecurity = await pdfUploadService.assertNoUnverifiedObjects();
    await aiProviderConfigurationService.initialize();
    visualizationOrchestrationWorker.scheduleRecovery?.();
    return {
      accountLifecycleService,
      aiProviderConfigurationService,
      identityAdminClient,
      agentArtifactRepository,
      close: async () => {
        try {
          await visualizationOrchestrationService.close?.();
        } finally {
          await pool.end();
        }
      },
      identityVerifier,
      grobidParseService,
      externalKnowledgeService,
      libraryRepository,
      marketingApplicationRepository,
      literatureAuthorityClient,
      modelProxyService,
      mineruPdfService,
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
      visualizationArtifactCompilerRegistry,
      visualizationGenerationRepository,
      visualizationOrchestrationService,
      visualizationOrchestrationWorker,
      visualizationProviderGateway,
      visualizationRasterOcr,
      visualizationRepository,
      visualizationService,
      readiness: Object.freeze({
        identity: identity.discovery && identity.jwks ? "ready" : "failed",
        grobid: grobid.configured ? "ready" : "unavailable",
        migrations: "current",
        get modelProxy() { return modelProxyService.configured ? "configured" : "unavailable"; },
        get mineru() { return mineruPdfService.configured ? "configured" : "unavailable"; },
        objectStorage: objectStorage.privateAccess ? "ready" : "failed",
        pdfSecurity: pdfSecurity.unverified === 0 ? "ready" : "failed",
        postgres: postgres.writable ? "ready" : "failed",
        rasterOcr: rasterOcr.languages.includes("eng") && rasterOcr.languages.includes("chi_sim") ? "ready" : "injected",
        storageWorkflows: storageWorkflows.scanned === storageWorkflows.repaired ? "current" : "failed"
      })
    };
  } catch (error) {
    await Promise.resolve(visualizationOrchestrationService.close?.()).catch(() => {});
    await pool.end().catch(() => {});
    throw error;
  }
}
