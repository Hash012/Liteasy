function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildOrganizationListPayload(body, repository) {
  return repository.list(text(body.sessionId));
}

export function buildOrganizationSummaryPayload(body, repository, storageRepository) {
  const organizationId = text(body.organizationId);
  const ownerKey = text(body.sessionId);
  const quota = storageRepository.getQuota("organization", organizationId);
  const documents = storageRepository.listEntries("organization", organizationId);
  return {
    summary: repository.getSummary(organizationId, ownerKey, {
      ...quota,
      documents
    })
  };
}

export function buildOrganizationSharedLibraryManifestPayload(
  body,
  repository,
  storageRepository
) {
  const organizationId = text(body.organizationId);
  const ownerKey = text(body.sessionId);
  const identity = repository.getManifestIdentity(organizationId, ownerKey);
  const tree = storageRepository.getTree("organization", organizationId);
  return {
    manifest: {
      documents: tree.entries.map((entry) => ({
        entryKind: entry.entryKind,
        folderId: entry.folderId ?? identity.rootFolderId,
        id: entry.documentId,
        sourcePath: entry.entryKind === "pdf"
          ? `org://${organizationId}/shared-library/${entry.documentId}.pdf`
          : `org://${organizationId}/shared-library/${entry.documentId}`,
        title: entry.title
      })),
      folders: [
        {
          id: identity.rootFolderId,
          name: identity.name,
          parentId: null,
          path: `org://${organizationId}/shared-library`
        },
        ...tree.folders.map((folder) => ({
          id: folder.folderId,
          name: folder.name,
          parentId: folder.parentFolderId ?? identity.rootFolderId,
          path: `org://${organizationId}/shared-library/${folder.folderId}`
        }))
      ],
      name: identity.name,
      organizationId,
      revision: tree.revision,
      rootFolderId: identity.rootFolderId,
      status: identity.status
    }
  };
}

export function buildOrganizationGovernancePayload(body, repository, storageRepository) {
  const organizationId = text(body.organizationId);
  const ownerKey = text(body.sessionId);
  return {
    summary: repository.getGovernance(
      organizationId,
      ownerKey,
      storageRepository.getQuota("organization", organizationId)
    )
  };
}

export function buildOrganizationCreatePayload(body, repository) {
  return repository.create(body.name, text(body.sessionId), body.displayName);
}

export function buildOrganizationJoinPayload(body, repository) {
  if (text(body.invitationToken)) {
    return repository.joinByInvitation(
      text(body.invitationToken),
      text(body.sessionId),
      body.displayName
    );
  }
  return repository.join(body.organizationId, text(body.sessionId), body.displayName);
}

export function buildOrganizationInvitePayload(body, repository) {
  return repository.invite(
    body.organizationId,
    text(body.sessionId),
    body.targetSubject ?? body.targetUserId,
    body.memberRole ?? body.role
  );
}

export function buildOrganizationLeavePayload(body, repository) {
  return repository.leave(body.organizationId, text(body.sessionId));
}

export function buildOrganizationMemberRolePayload(body, repository) {
  return repository.changeMemberRole(
    body.organizationId,
    text(body.sessionId),
    body.targetSubject,
    body.role
  );
}

export function buildOrganizationMemberStatusPayload(body, repository) {
  return repository.setMemberStatus(
    body.organizationId,
    text(body.sessionId),
    body.targetSubject,
    body.status
  );
}

export function buildOrganizationOwnershipTransferPayload(body, repository) {
  return repository.transferOwnership(
    body.organizationId,
    text(body.sessionId),
    body.targetSubject
  );
}

export function buildOrganizationStoragePolicyPayload(body, repository) {
  return repository.getPolicy(text(body.organizationId), text(body.sessionId));
}

export function buildOrganizationStoragePolicyUpdatePayload(body, repository) {
  return repository.updatePolicy(text(body.organizationId), text(body.sessionId), {
    exportPolicy: body.exportPolicy,
    uploadPolicy: body.uploadPolicy
  });
}
