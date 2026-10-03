import type { PublicationPreview } from "../features/forum/usePublicationPreview";
import { getAccountSessionGeneration } from "../features/account/accountSessionStorage";
import { useCallback, useRef } from "react";
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
  confirmShare?: (preview: PublicationPreview) => Promise<boolean>;
  createClient?: typeof createTeamAnnotationClient;
  endpoint: string;
  organizationSummary?: OrganizationSummary | null;
};

const unavailableMessage = "当前文献不属于可访问的组织文献库。";

export function useTeamAnnotationController({
  accountSession,
  confirmShare,
  createClient = createTeamAnnotationClient,
  endpoint,
  organizationSummary
}: UseTeamAnnotationControllerInput) {
  const currentAccount = useRef({ accountSession, endpoint, generation: getAccountSessionGeneration() });
  currentAccount.current = { accountSession, endpoint, generation: getAccountSessionGeneration() };
  const requireContext = useCallback((paper: Paper) => {
    const target = resolveOrganizationDocument(paper);
    if (!target || !accountSession) throw new Error(unavailableMessage);
    const generation = getAccountSessionGeneration();
    function assertCurrent() {
      if (currentAccount.current.endpoint !== endpoint || currentAccount.current.accountSession?.sessionId !== accountSession?.sessionId ||
        currentAccount.current.accountSession?.userId !== accountSession?.userId || currentAccount.current.accountSession?.issuer !== accountSession?.issuer ||
        generation !== getAccountSessionGeneration()) throw new Error("账号或服务已变化，请重新加载组织批注。");
    }
    assertCurrent();
    return { assertCurrent,
      client: createClient({
        accessToken: accountSession.sessionId,
        endpoint
      }),
      target
    };
  }, [accountSession?.sessionId, createClient, endpoint]);

  const loadOrganizationAnnotations = useCallback(async (paper: Paper) => {
    const { client, target, assertCurrent } = requireContext(paper);
    const result = await client.list(target);
    assertCurrent();
    return result.annotations;
  }, [requireContext]);

  const shareAnnotationToOrganization = useCallback(async (input: {
    annotation: PdfAnnotation;
    paper: Paper;
  }) => {
    const { client, target, assertCurrent } = requireContext(input.paper);
    const approvedAnnotation = structuredClone(input.annotation);
    const approved = await confirmShare?.({
      title: "预览组织批注副本", recipient: organizationSummary?.organizationId === target.organizationId ? organizationSummary.name : "当前文献所属组织",
      body: approvedAnnotation.note || approvedAnnotation.text || "",
      excerpts: [{ label: `${input.paper.title} · 第 ${approvedAnnotation.page} 页`, text: approvedAnnotation.excerpt ?? "" }], action: "确认复制到组织"
    });
    assertCurrent();
    if (!approved) throw new Error("已取消分享，本机批注未改变。");
    const result = await client.create({ annotation: approvedAnnotation, ...target });
    assertCurrent();
    return result;
  }, [requireContext, confirmShare, organizationSummary]);

  const updateOrganizationAnnotation = useCallback(async (input: {
    annotation: TeamAnnotation;
    note: string;
    paper: Paper;
  }) => {
    const { client, target, assertCurrent } = requireContext(input.paper);
    const result = await client.update({
      annotationId: input.annotation.annotationId,
      body: {
        ...input.annotation.body,
        note: input.note,
        updatedAt: new Date().toISOString()
      },
      expectedRevision: input.annotation.revision,
      organizationId: target.organizationId
    });
    assertCurrent();
    return result;
  }, [requireContext]);

  const deleteOrganizationAnnotation = useCallback(async (input: {
    annotation: TeamAnnotation;
    paper: Paper;
  }) => {
    const { client, target, assertCurrent } = requireContext(input.paper);
    await client.remove({
      annotationId: input.annotation.annotationId,
      expectedRevision: input.annotation.revision,
      organizationId: target.organizationId
    });
    assertCurrent();
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
