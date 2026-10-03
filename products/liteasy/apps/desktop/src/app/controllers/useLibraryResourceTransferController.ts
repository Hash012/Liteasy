import type { TransferOperationEvent } from "../features/spaces/spaceOperations";
import { importDownloadedPdf, releaseDownloadedPdf } from "../features/paper-services/paperFullTextTransport";
import { useCallback, useRef } from "react";
import { captureAccountSessionRequest } from "../features/account/accountSessionBinding";
import { planLibraryResourceTransfer, type LibraryResourceTransferPlan } from "../features/library/libraryResourceTransferPlan";
import type { RecommendationItem } from "../features/recommendations/recommendation.types";
import { downloadRecommendationPdf } from "../features/recommendations/recommendationPdfClient";
import {
  createCloudLibraryStorageClient,
  type CloudLibraryScope
} from "../features/library/cloudLibraryStorageClient";
import {
  addMetadataOnlyLibraryEntry,
  createLocalLibraryPdfStream,
  createLocalLibraryFolder,
  persistDroppedPdfFiles,
  persistPdfByteStream,
  purgeLocalLibraryTrashItem,
  readLocalLibraryPdf,
  trashLocalMetadataEntry,
  trashLocalLibraryResource
} from "../features/library/libraryFileSystemClient";
import { sanitizeExternalPdfFileName } from "../features/library/externalPdfDownload";
import type { ModelTransport } from "../features/models/modelHttpClient";
import type {
  LibraryResourceEntrySource,
  LibraryResourceFolderTree,
  LibraryResourceTransferSource,
  LibraryResourceTransferTarget
} from "../features/library/libraryResourceTransfer.types";
import {
  canExportFromOrganization,
  canManageOrganizationLibrary,
  canUploadToOrganization
} from "../features/organization/organizationStoragePolicy";

type Input = {
  endpoint: string;
  onOperation?: (event: TransferOperationEvent) => void;
  confirmTransfer?: (plan: LibraryResourceTransferPlan) => Promise<boolean>;
  onRecommendationSaved: (recommendation: RecommendationItem) => void | Promise<void>;
  refreshCloudTrees: () => void | Promise<void>;
  refreshLocalLibrary: () => void | Promise<void>;
  transport?: ModelTransport;
};

function requireCloudScope(target: LibraryResourceTransferTarget): CloudLibraryScope {
  if (!target.scope) throw new Error("目标云端文献库不可用。");
  return target.scope;
}

function requireExpectedRevision(target: LibraryResourceTransferTarget) {
  if (!Number.isSafeInteger(target.expectedRevision) || target.expectedRevision! < 0) {
    throw new Error("目标文献库状态已过期，请刷新后重试。");
  }
  return target.expectedRevision!;
}

export function useLibraryResourceTransferController(input: Input) {
  const endpointRef = useRef(input.endpoint);
  endpointRef.current = input.endpoint;
  return useCallback(async (
    sourceInput: LibraryResourceTransferSource,
    targetInput: LibraryResourceTransferTarget
  ) => {
    const plan = planLibraryResourceTransfer(sourceInput, targetInput);
    const { source, target } = plan;
    const binding = captureAccountSessionRequest(input.endpoint);
    const needsAccount = source.area === "collection" || source.area === "organization" ||
      target.area === "collection" || target.area === "organization" ||
      (source.area === "recommendation" && Boolean(binding.sessionId));
    function assertCurrent() {
      if (!needsAccount) return;
      binding.assertCurrent();
      if (endpointRef.current !== input.endpoint) throw new Error("账号或云服务已变化，请重新操作。");
    }
    let cancelled = false;
    async function guarded<T>(operation: () => T | Promise<T>): Promise<T> {
      assertCurrent();
      const result = await operation();
      if (result && typeof result === "object" && "status" in result && result.status === "cancelled") cancelled = true;
      assertCurrent();
      return result;
    }
    const operation = { id: crypto.randomUUID(), actorKey: binding.actorKey, generation: binding.generation,
      title: source.area === "recommendation" ? source.recommendation.title : "entry" in source ? source.entry.title || "资料转移" : source.folder.name,
      target: target.scope };
    input.onOperation?.({ ...operation, phase: "running" });
    try {
      await (async () => {
    assertCurrent();
    if (source.area === "collection" && source.scope.scopeId !== binding.subject) throw new Error("个人云收藏不属于当前账号，请刷新后重试。");
    if (target.area === "collection" && target.scope?.scopeId !== binding.subject) throw new Error("目标个人云收藏不属于当前账号，请刷新后重试。");
    if (input.confirmTransfer && !await guarded(() => input.confirmTransfer!(structuredClone(plan)))) throw new Error("已取消资料转移。");

    if (target.area === "recommendation") {
      throw new Error("关联推荐不接受拖入内容。");
    }
    const policyClient = createCloudLibraryStorageClient({ endpoint: input.endpoint, sessionBinding: binding });
    const sourceOrganizationId = source.area === "organization"
      ? source.scope.scopeId
      : undefined;
    const targetOrganizationId = target.area === "organization"
      ? requireCloudScope(target).scopeId
      : undefined;
    const sameOrganization = Boolean(
      sourceOrganizationId && sourceOrganizationId === targetOrganizationId
    );
    if (sourceOrganizationId) {
      const access = await guarded(() => policyClient.getOrganizationStoragePolicy(sourceOrganizationId));
      if (sameOrganization) {
        if (!canManageOrganizationLibrary(access.role)) {
          throw new Error("当前组织角色不能移动组织文献库内容。");
        }
      } else if (!canExportFromOrganization(access)) {
        throw new Error("当前组织策略不允许将文献复制出组织库。");
      }
    }
    if (targetOrganizationId && !sameOrganization) {
      const access = await guarded(() => policyClient.getOrganizationStoragePolicy(targetOrganizationId));
      if (!canUploadToOrganization(access)) {
        throw new Error("当前组织策略不允许向组织文献库新增内容。");
      }
    }

    if (source.area === "recommendation") {
      const pdf = await downloadRecommendationPdf({
        endpoint: input.endpoint,
        recommendation: source.recommendation,
        nativeDownload: target.area === "local",
        transport: input.transport
      });
      const metadata = {
        ...(source.recommendation.canonicalId?.startsWith("doi:")
          ? { doi: source.recommendation.canonicalId.slice(4) }
          : {}),
        externalUrl: source.recommendation.sourceUrl,
        sourceId: source.recommendation.id,
        title: source.recommendation.title
      };
      if (target.area === "local") {
        try {
        assertCurrent();
        if (pdf?.downloadId) {
          await guarded(() => importDownloadedPdf(pdf.downloadId!, sanitizeExternalPdfFileName(source.recommendation.title), target.localFolderPath));
        } else if (pdf) {
          await guarded(() => persistPdfByteStream({
            fileName: sanitizeExternalPdfFileName(source.recommendation.title),
            stream: new Blob([pdf.bytes.slice().buffer], { type: "application/pdf" }).stream(),
            targetFolderPath: target.localFolderPath
          }));
        } else {
          await guarded(() => addMetadataOnlyLibraryEntry(metadata));
        }
        await guarded(() => input.refreshLocalLibrary());
        await guarded(() => input.onRecommendationSaved(source.recommendation));
        } finally { if (pdf?.downloadId) await releaseDownloadedPdf(pdf.downloadId); }
        return;
      }
      assertCurrent();
      const client = createCloudLibraryStorageClient({ endpoint: input.endpoint, sessionBinding: binding });
      const scope = requireCloudScope(target);
      if (pdf) {
        await guarded(() => client.uploadDocumentStream({
          createBody: async () => new Blob(
            [pdf.bytes.slice().buffer],
            { type: "application/pdf" }
          ).stream(),
          expectedRevision: requireExpectedRevision(target),
          fileName: sanitizeExternalPdfFileName(source.recommendation.title),
          folderId: target.folderId,
          onDuplicate: () => false,
          scope
        }));
      } else {
        await guarded(() => client.createMetadataEntry({
          ...metadata,
          expectedRevision: requireExpectedRevision(target),
          folderId: target.folderId,
          scope
        }));
      }
      if (target.area === "collection") await guarded(() => input.onRecommendationSaved(source.recommendation));
      await guarded(() => input.refreshCloudTrees());
      return;
    }

    if ("folder" in source) {
      if (source.area === "local" && target.area === "local") return;
      const client = createCloudLibraryStorageClient({ endpoint: input.endpoint, sessionBinding: binding });
      if (source.area !== "local" && target.area !== "local") {
        const targetScope = requireCloudScope(target);
        if (
          source.scope.scopeId === targetScope.scopeId &&
          source.scope.scopeType === targetScope.scopeType
        ) {
          await guarded(() => client.updateFolder(source.scope, source.folder.folderId, {
            expectedRevision: requireExpectedRevision(target),
            parentFolderId: target.folderId ?? null
          }));
          await guarded(() => input.refreshCloudTrees());
          return;
        }
      }

      const createdMetadataEntryIds: string[] = [];
      async function copyEntryToLocal(entrySource: LibraryResourceEntrySource, folderPath: string) {
        if (entrySource.area === "local") {
          if (!entrySource.entry.path) {
            const result = await guarded(() => addMetadataOnlyLibraryEntry({
              sourceId: entrySource.entry.id,
              title: entrySource.entry.title
            }));
            if (result.created) createdMetadataEntryIds.push(result.documentId);
            return;
          }
          const bytes = await guarded(() => readLocalLibraryPdf(entrySource.entry.path!));
          await guarded(() => persistDroppedPdfFiles({
            files: [new File([Uint8Array.from(bytes)], `${entrySource.entry.title}.pdf`, {
              type: "application/pdf"
            })],
            onDuplicate: () => true,
            targetFolderPath: folderPath
          }));
          return;
        }
        const cloudEntry = entrySource.entry;
        if (cloudEntry.entryKind === "metadata_only") {
          const result = await guarded(() => addMetadataOnlyLibraryEntry({
            doi: cloudEntry.doi,
            externalUrl: cloudEntry.externalUrl,
            sourceId: cloudEntry.sourceId ?? cloudEntry.documentId,
            title: cloudEntry.title
          }));
          if (result.created) createdMetadataEntryIds.push(result.documentId);
          return;
        }
        const stream = await guarded(() => client.downloadDocumentStream(
          entrySource.scope,
          cloudEntry.documentId,
          "export"
        ));
        await guarded(() => persistPdfByteStream({
          fileName: cloudEntry.fileName,
          onDuplicate: () => true,
          stream,
          targetFolderPath: folderPath
        }));
      }

      if (target.area === "local") {
        const parentPath = target.localFolderPath;
        if (!parentPath) throw new Error("目标本地目录不可用。");
        let createdRootPath = "";
        const copyLocalTree = async (tree: LibraryResourceFolderTree, parent: string) => {
          const snapshot = await guarded(() => createLocalLibraryFolder(tree.name, parent));
          const created = snapshot.folders.find((folder) =>
            folder.name === tree.name &&
            folder.parentPath === (parent === snapshot.rootPath ? null : parent)
          );
          if (!created) throw new Error(`无法确认新建目录：${tree.name}`);
          if (!createdRootPath) createdRootPath = created.path;
          for (const entry of tree.entries) await guarded(() => copyEntryToLocal(entry, created.path));
          for (const child of tree.children) await guarded(() => copyLocalTree(child, created.path));
        };
        try {
          await guarded(() => copyLocalTree(source.tree, parentPath));
        } catch (error) {
          let cleanupComplete = true;
          if (createdRootPath) {
            try {
              const trashed = await guarded(() => trashLocalLibraryResource(createdRootPath));
              const createdTrash = trashed.trashEntries.find((entry) =>
                entry.originalRelativePath.endsWith(source.tree.name)
              );
              if (createdTrash) await guarded(() => purgeLocalLibraryTrashItem(createdTrash.trashId));
              else cleanupComplete = false;
            } catch {
              cleanupComplete = false;
            }
          }
          for (const documentId of createdMetadataEntryIds.reverse()) {
            try {
              const trashed = await guarded(() => trashLocalMetadataEntry(documentId));
              await guarded(() => purgeLocalLibraryTrashItem(trashed.trashId));
            } catch {
              cleanupComplete = false;
            }
          }
          if (!cleanupComplete) {
            throw new Error(`目录复制失败且清理未完成：${error instanceof Error ? error.message : String(error)}`);
          }
          throw error;
        }
        await guarded(() => input.refreshLocalLibrary());
        return;
      }

      const targetScope = requireCloudScope(target);
      let revision = requireExpectedRevision(target);
      let createdRootFolderId = "";
      const copyEntryToCloud = async (entrySource: LibraryResourceEntrySource, folderId: string) => {
        if (entrySource.area === "local") {
          if (!entrySource.entry.path) {
            const result = await guarded(() => client.createMetadataEntry({
              expectedRevision: revision,
              folderId,
              scope: targetScope,
              sourceId: entrySource.entry.id,
              title: entrySource.entry.title
            }));
            revision = result.revision;
            return;
          }
          const result = await guarded(() => client.uploadDocumentStream({
            createBody: async () => (await guarded(() => createLocalLibraryPdfStream(entrySource.entry.path!))).stream,
            expectedRevision: revision,
            fileName: `${entrySource.entry.title}.pdf`,
            folderId,
            onDuplicate: () => true,
            scope: targetScope
          }));
          if (typeof result.revision === "number") revision = result.revision;
          return;
        }
        const result = await guarded(() => client.copyEntry({
          documentId: entrySource.entry.documentId,
          expectedRevision: revision,
          source: entrySource.scope,
          target: { ...targetScope, folderId }
        }));
        revision = result.revision;
      };
      const copyCloudTree = async (tree: LibraryResourceFolderTree, parentFolderId?: string) => {
        const created = await guarded(() => client.createFolder(targetScope, tree.name, parentFolderId, revision));
        revision = created.revision;
        if (!createdRootFolderId) createdRootFolderId = created.folder.folderId;
        for (const entry of tree.entries) await guarded(() => copyEntryToCloud(entry, created.folder.folderId));
        for (const child of tree.children) await guarded(() => copyCloudTree(child, created.folder.folderId));
      };
      try {
        await guarded(() => copyCloudTree(source.tree, target.folderId));
      } catch (error) {
        if (createdRootFolderId) {
          try {
            const trashed = await guarded(() => client.trashFolder(targetScope, createdRootFolderId, revision));
            await guarded(() => client.purgeFolder(targetScope, createdRootFolderId, trashed.revision));
          } catch {
            throw new Error(`目录复制失败且目标清理未完成：${error instanceof Error ? error.message : String(error)}`);
          }
        }
        throw error;
      }
      await guarded(() => input.refreshCloudTrees());
      return;
    }

    if (source.area === "local") {
      if (target.area === "local") return;
      const client = createCloudLibraryStorageClient({ endpoint: input.endpoint, sessionBinding: binding });
      const scope = requireCloudScope(target);
      if (!source.entry.path) {
        await guarded(() => client.createMetadataEntry({
          expectedRevision: requireExpectedRevision(target),
          folderId: target.folderId,
          scope,
          sourceId: source.entry.id,
          title: source.entry.title
        }));
      } else {
        await guarded(() => client.uploadDocumentStream({
          createBody: async () => (await guarded(() => createLocalLibraryPdfStream(source.entry.path!))).stream,
          expectedRevision: requireExpectedRevision(target),
          fileName: `${source.entry.title}.pdf`,
          folderId: target.folderId,
          onDuplicate: () => false,
          scope
        }));
      }
      await guarded(() => input.refreshCloudTrees());
      return;
    }

    const cloudEntry = source.entry;
    if (target.area === "local") {
      if (cloudEntry.entryKind === "metadata_only") {
        await guarded(() => addMetadataOnlyLibraryEntry({
          doi: cloudEntry.doi,
          externalUrl: cloudEntry.externalUrl,
          sourceId: cloudEntry.sourceId ?? cloudEntry.documentId,
          title: cloudEntry.title
        }));
      } else {
        const client = createCloudLibraryStorageClient({ endpoint: input.endpoint, sessionBinding: binding });
        const stream = await guarded(() => client.downloadDocumentStream(
          source.scope,
          cloudEntry.documentId,
          "export"
        ));
        await guarded(() => persistPdfByteStream({
          fileName: cloudEntry.fileName,
          stream,
          targetFolderPath: target.localFolderPath
        }));
      }
      await guarded(() => input.refreshLocalLibrary());
      return;
    }

    const client = createCloudLibraryStorageClient({ endpoint: input.endpoint, sessionBinding: binding });
    const targetScope = requireCloudScope(target);
    if (
      source.scope.scopeId === targetScope.scopeId &&
      source.scope.scopeType === targetScope.scopeType
    ) {
      await guarded(() => client.updateDocument(source.scope, source.entry.documentId, {
        expectedRevision: requireExpectedRevision(target),
        folderId: target.folderId ?? null
      }));
    } else {
      await guarded(() => client.copyEntry({
        documentId: source.entry.documentId,
        expectedRevision: requireExpectedRevision(target),
        source: source.scope,
        target: { ...targetScope, folderId: target.folderId }
      }));
    }
    await guarded(() => input.refreshCloudTrees());
      })();
      input.onOperation?.({ ...operation, phase: cancelled ? "cancelled" : "completed" });
    } catch (error) {
      const status = (error as { status?: number })?.status;
      input.onOperation?.({ ...operation, error, phase: error instanceof Error && error.message === "已取消资料转移。" ? "cancelled" : status && status >= 400 && status < 500 ? "failed" : "unknown" });
      throw error;
    }
  }, [input]);
}
