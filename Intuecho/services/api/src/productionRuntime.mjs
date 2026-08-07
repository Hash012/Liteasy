import { createPlatformAdminAuthorizer } from "./adminAuthorizer.mjs";
import { PostgresAccountLifecycleRepository } from "./accountLifecycleRepository.mjs";
import { verifyIntuechoMigrations } from "./migrations.mjs";
import { createIntuechoPool, verifyIntuechoPostgres } from "./postgres.mjs";
import { PostgresForumRepository } from "./postgresForumRepository.mjs";
import { PostgresAnnotationCommunityRepository } from "./postgresAnnotationCommunityRepository.mjs";
import { OrganizationAuthorizationClient } from "./organizationAuthorizationClient.mjs";
import {
  createProductionIdentityVerifier,
  verifyIntuechoIdentityReadiness
} from "./productionIdentity.mjs";

export async function startIntuechoProductionRuntime(config, dependencies = {}) {
  const pool = dependencies.pool ?? createIntuechoPool(config.database);
  const identityVerifier = dependencies.identityVerifier ?? createProductionIdentityVerifier(config.identity);
  const adminAuthorizer = dependencies.adminAuthorizer ?? createPlatformAdminAuthorizer({
    baseUrl: config.adminApiUrl
  });
  const repository = dependencies.repository ?? new PostgresForumRepository(pool);
  const organizationAuthorizer = dependencies.organizationAuthorizer ??
    new OrganizationAuthorizationClient(config.organizationAuthorization, {
      fetchImpl: dependencies.organizationFetch
    });
  const annotationCommunityRepository = dependencies.annotationCommunityRepository ??
    new PostgresAnnotationCommunityRepository(pool, {
      authorizeOrganizationAccess: (input) => organizationAuthorizer.authorizeAccess(input),
      authorizeOrganizationInvitation: (input) => organizationAuthorizer.authorizeInvitation(input),
      authorizeOrganizationVisibility: (input) => organizationAuthorizer.authorizeVisibility(input),
      listOrganizations: (userId) => organizationAuthorizer.listMemberships(userId)
    });
  const accountLifecycleRepository = dependencies.accountLifecycleRepository ??
    new PostgresAccountLifecycleRepository(pool);
  try {
    const [postgres, migrations, identity, administration] = await Promise.all([
      verifyIntuechoPostgres(pool),
      verifyIntuechoMigrations(pool),
      dependencies.verifyIdentityReadiness?.() ?? verifyIntuechoIdentityReadiness(config.identity),
      adminAuthorizer.readiness()
    ]);
    return Object.freeze({
      accountLifecycleRepository,
      adminAuthorizer,
      annotationCommunityRepository,
      identityVerifier,
      organizationAuthorizer,
      pool,
      readiness: Object.freeze({ administration, identity, migrations, postgres }),
      repository
    });
  } catch (error) {
    if (!dependencies.pool) await pool.end();
    throw error;
  }
}
