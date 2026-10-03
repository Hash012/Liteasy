import { organizationChoiceSchema } from "@intuecho/contracts";
import { AnnotationCommunityError } from "./annotationCommunitySqlite.mjs";

// Projection only: never infer a new publishing permission from a display role.
export async function currentOrganizationChoices(listOrganizations, subject) {
  if (!listOrganizations) throw new AnnotationCommunityError("ORGANIZATION_AUTHORIZATION_UNAVAILABLE", 503);
  try {
    const memberships = await listOrganizations(subject);
    if (!Array.isArray(memberships) || memberships.length > 1000) throw new Error("Invalid membership response");
    return memberships.map((membership) => {
      const compatible = membership?.allowedActions === undefined ? {
        ...membership,
        allowedActions: [], authorizationRevision: 0, policyRevision: null,
        denialReasons: { comment: "organization_authority_upgrade_required" },
        policyExceptions: [], actionConstraints: { inviteRoles: [] }
      } : membership;
      const parsed = organizationChoiceSchema.safeParse(compatible);
      if (!parsed.success) throw new Error("Invalid membership response");
      return parsed.data;
    });
  } catch {
    throw new AnnotationCommunityError("ORGANIZATION_AUTHORIZATION_UNAVAILABLE", 503);
  }
}
