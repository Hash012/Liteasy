import { useCallback } from "react";
import type { AccountSession } from "../features/account/account.types";
import type { OrganizationSummary } from "../features/organization/organization.types";
import {
  createTeamAnnotationClient,
  resolveOrganizationDocument,
  type TeamAnnotation
} from "../features/organization/teamAnnotationClient";
import type { PdfAnnotation } from "../features/pdf/pdfAnnotationStorage";
import type { Paper } from "../features/workspace/workspace.types";

type UseTeamAnnotationControllerInput = {
  accountSession: AccountSession | null;
  createClient?: typeof createTeamAnnotationClient;
  endpoint: string;
  organizationSummary?: OrganizationSummary | null;
};

const unavailableMessage = "当前文献不属于可访问的组织文献库。";

export function useTeamAnnotationController({
  accountSession,
  createClient = createTeamAnnotationClient,
  endpoint,
  organizationSummary
}: UseTeamAnnotationControllerInput) {
  const requireContext = useCallback((paper: Paper) => {
    const target = resolveOrganizationDocument(paper);
    if (!target || !accountSession) throw new Error(unavailableMessage);
    return {
      client: createClient({
        accessToken: accountSession.sessionId,
        endpoint
      }),
      target
    };
  }, [accountSession?.sessionId, createClient, endpoint]);

  const loadOrganizationAnnotations = useCallback(async (paper: Paper) => {
    const { client, target } = requireContext(paper);
    const result = await client.list(target);
    return result.annotations;
  }, [requireContext]);

  const shareAnnotationToOrganization = useCallback(async (input: {
    annotation: PdfAnnotation;
    paper: Paper;
  }) => {
    const { client, target } = requireContext(input.paper);
    return client.create({ annotation: input.annotation, ...target });
  }, [requireContext]);

  const updateOrganizationAnnotation = useCallback(async (input: {
    annotation: TeamAnnotation;
    note: string;
    paper: Paper;
  }) => {
    const { client, target } = requireContext(input.paper);
    return client.update({
      annotationId: input.annotation.annotationId,
      body: {
        ...input.annotation.body,
        note: input.note,
        updatedAt: new Date().toISOString()
      },
      expectedRevision: input.annotation.revision,
      organizationId: target.organizationId
    });
  }, [requireContext]);

  const deleteOrganizationAnnotation = useCallback(async (input: {
    annotation: TeamAnnotation;
    paper: Paper;
  }) => {
    const { client, target } = requireContext(input.paper);
    await client.remove({
      annotationId: input.annotation.annotationId,
      expectedRevision: input.annotation.revision,
      organizationId: target.organizationId
    });
  }, [requireContext]);

  const readerBindings = useCallback((paper: Paper) => {
    const target = resolveOrganizationDocument(paper);
    if (!target || !accountSession) return {};
    const activeSummary = organizationSummary?.organizationId === target.organizationId
      ? organizationSummary
      : undefined;
    const actorId = activeSummary?.members.find((member) =>
      member.subject === accountSession.userId ||
      member.subject === `user:${accountSession.userId}`
    )?.subject ?? accountSession.userId;
    return {
      canModerateOrganizationAnnotations:
        activeSummary?.myRole === "owner" || activeSummary?.myRole === "admin",
      loadOrganizationAnnotations,
      onDeleteOrganizationAnnotation: deleteOrganizationAnnotation,
      onShareAnnotationToOrganization: shareAnnotationToOrganization,
      onUpdateOrganizationAnnotation: updateOrganizationAnnotation,
      organizationAnnotationActorId: actorId
    };
  }, [
    accountSession,
    deleteOrganizationAnnotation,
    loadOrganizationAnnotations,
    organizationSummary,
    shareAnnotationToOrganization,
    updateOrganizationAnnotation
  ]);

  return { readerBindings };
}
