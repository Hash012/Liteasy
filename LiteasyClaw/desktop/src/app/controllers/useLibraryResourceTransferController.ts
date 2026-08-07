import { useCallback } from "react";
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
  return useCallback(async (
    source: LibraryResourceTransferSource,
    target: LibraryResourceTransferTarget
  ) => {
    if (target.area === "recommendation") {
      throw new Error("关联推荐不接受拖入内容。");
    }
    const policyClient = createCloudLibraryStorageClient({ endpoint: input.endpoint });
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
      const access = await policyClient.getOrganizationStoragePolicy(sourceOrganizationId);
      if (sameOrganization) {
        if (!canManageOrganizationLibrary(access.role)) {
          throw new Error("当前组织角色不能移动组织文献库内容。");
        }
      } else if (!canExportFromOrganization(access)) {
        throw new Error("当前组织策略不允许将文献复制出组织库。");
      }
    }
    if (targetOrganizationId && !sameOrganization) {
      const access = await policyClient.getOrganizationStoragePolicy(targetOrganizationId);
      if (!canUploadToOrganization(access)) {
        throw new Error("当前组织策略不允许向组织文献库新增内容。");
      }
    }

    if (source.area === "recommendation") {
      const pdf = await downloadRecommendationPdf({
        endpoint: input.endpoint,
        recommendation: source.recommendation,
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
        if (pdf) {
          await persistPdfByteStream({
            fileName: sanitizeExternalPdfFileName(source.recommendation.title),
            stream: new Blob([pdf.bytes.slice().buffer], { type: "application/pdf" }).stream(),
            targetFolderPath: target.localFolderPath
          });
        } else {
          await addMetadataOnlyLibraryEntry(metadata);
        }
        await input.refreshLocalLibrary();
        return;
      }
      const client = createCloudLibraryStorageClient({ endpoint: input.endpoint });
      const scope = requireCloudScope(target);
      if (pdf) {
        await client.uploadDocumentStream({
          createBody: async () => new Blob(
            [pdf.bytes.slice().buffer],
            { type: "application/pdf" }
          ).stream(),
          expectedRevision: requireExpectedRevision(target),
          fileName: sanitizeExternalPdfFileName(source.recommendation.title),
          folderId: target.folderId,
          onDuplicate: () => false,
          scope
        });
      } else {
        await client.createMetadataEntry({
          ...metadata,
          expectedRevision: requireExpectedRevision(target),
          folderId: target.folderId,
          scope
        });
      }
      if (target.area === "collection") await input.onRecommendationSaved(source.recommendation);
      await input.refreshCloudTrees();
      return;
    }

    if ("folder" in source) {
      if (source.area === "local" && target.area === "local") return;
      const client = createCloudLibraryStorageClient({ endpoint: input.endpoint });
      if (source.area !== "local" && target.area !== "local") {
        const targetScope = requireCloudScope(target);
        if (
          source.scope.scopeId === targetScope.scopeId &&
          source.scope.scopeType === targetScope.scopeType
        ) {
          await client.updateFolder(source.scope, source.folder.folderId, {
            expectedRevision: requireExpectedRevision(target),
            parentFolderId: target.folderId ?? null
          });
          await input.refreshCloudTrees();
          return;
        }
      }

      async function copyEntryToLocal(entrySource: LibraryResourceEntrySource, folderPath: string) {
        if (entrySource.area === "local") {
          if (!entrySource.entry.path) {
            await addMetadataOnlyLibraryEntry({
              sourceId: entrySource.entry.id,
              title: entrySource.entry.title
            });
            return;
          }
          const bytes = await readLocalLibraryPdf(entrySource.entry.path);
          await persistDroppedPdfFiles({
            files: [new File([Uint8Array.from(bytes)], `${entrySource.entry.title}.pdf`, {
              type: "application/pdf"
            })],
            onDuplicate: () => true,
            targetFolderPath: folderPath
          });
          return;
        }
        if (entrySource.entry.entryKind === "metadata_only") {
          await addMetadataOnlyLibraryEntry({
            doi: entrySource.entry.doi,
            externalUrl: entrySource.entry.externalUrl,
            sourceId: entrySource.entry.sourceId ?? entrySource.entry.documentId,
            title: entrySource.entry.title
          });
          return;
        }
        const stream = await client.downloadDocumentStream(
          entrySource.scope,
          entrySource.entry.documentId,
          entrySource.area === "organization" ? "export" : "download"
        );
        await persistPdfByteStream({
          fileName: entrySource.entry.fileName,
          onDuplicate: () => true,
          stream,
          targetFolderPath: folderPath
        });
      }

      if (target.area === "local") {
        const parentPath = target.localFolderPath;
        if (!parentPath) throw new Error("目标本地目录不可用。");
        let createdRootPath = "";
        const copyLocalTree = async (tree: LibraryResourceFolderTree, parent: string) => {
          const snapshot = await createLocalLibraryFolder(tree.name, parent);
          const created = snapshot.folders.find((folder) =>
            folder.name === tree.name &&
            folder.parentPath === (parent === snapshot.rootPath ? null : parent)
          );
          if (!created) throw new Error(`无法确认新建目录：${tree.name}`);
          if (!createdRootPath) createdRootPath = created.path;
          for (const entry of tree.entries) await copyEntryToLocal(entry, created.path);
          for (const child of tree.children) await copyLocalTree(child, created.path);
        };
        try {
          await copyLocalTree(source.tree, parentPath);
        } catch (error) {
          if (createdRootPath) {
            try {
              const trashed = await trashLocalLibraryResource(createdRootPath);
              const createdTrash = trashed.trashEntries.find((entry) =>
                entry.originalRelativePath.endsWith(source.tree.name)
              );
              if (createdTrash) await purgeLocalLibraryTrashItem(createdTrash.trashId);
            } catch {
              throw new Error(`目录复制失败且清理未完成：${error instanceof Error ? error.message : String(error)}`);
            }
          }
          throw error;
        }
        await input.refreshLocalLibrary();
        return;
      }

      const targetScope = requireCloudScope(target);
      let revision = requireExpectedRevision(target);
      let createdRootFolderId = "";
      const copyEntryToCloud = async (entrySource: LibraryResourceEntrySource, folderId: string) => {
        if (entrySource.area === "local") {
          if (!entrySource.entry.path) {
            const result = await client.createMetadataEntry({
              expectedRevision: revision,
              folderId,
              scope: targetScope,
              sourceId: entrySource.entry.id,
              title: entrySource.entry.title
            });
            revision = result.revision;
            return;
          }
          const result = await client.uploadDocumentStream({
            createBody: async () => (await createLocalLibraryPdfStream(entrySource.entry.path!)).stream,
            expectedRevision: revision,
            fileName: `${entrySource.entry.title}.pdf`,
            folderId,
            onDuplicate: () => true,
            scope: targetScope
          });
          if (typeof result.revision === "number") revision = result.revision;
          return;
        }
        const result = await client.copyEntry({
          documentId: entrySource.entry.documentId,
          expectedRevision: revision,
          source: entrySource.scope,
          target: { ...targetScope, folderId }
        });
        revision = result.revision;
      };
      const copyCloudTree = async (tree: LibraryResourceFolderTree, parentFolderId?: string) => {
        const created = await client.createFolder(targetScope, tree.name, parentFolderId, revision);
        revision = created.revision;
        if (!createdRootFolderId) createdRootFolderId = created.folder.folderId;
        for (const entry of tree.entries) await copyEntryToCloud(entry, created.folder.folderId);
        for (const child of tree.children) await copyCloudTree(child, created.folder.folderId);
      };
      try {
        await copyCloudTree(source.tree, target.folderId);
      } catch (error) {
        if (createdRootFolderId) {
          try {
            const trashed = await client.trashFolder(targetScope, createdRootFolderId, revision);
            await client.purgeFolder(targetScope, createdRootFolderId, trashed.revision);
          } catch {
            throw new Error(`目录复制失败且目标清理未完成：${error instanceof Error ? error.message : String(error)}`);
          }
        }
        throw error;
      }
      await input.refreshCloudTrees();
      return;
    }

    if (source.area === "local") {
      if (target.area === "local") return;
      const client = createCloudLibraryStorageClient({ endpoint: input.endpoint });
      const scope = requireCloudScope(target);
      if (!source.entry.path) {
        await client.createMetadataEntry({
          expectedRevision: requireExpectedRevision(target),
          folderId: target.folderId,
          scope,
          sourceId: source.entry.id,
          title: source.entry.title
        });
      } else {
        await client.uploadDocumentStream({
          createBody: async () => (await createLocalLibraryPdfStream(source.entry.path!)).stream,
          expectedRevision: requireExpectedRevision(target),
          fileName: `${source.entry.title}.pdf`,
          folderId: target.folderId,
          onDuplicate: () => false,
          scope
        });
      }
      await input.refreshCloudTrees();
      return;
    }

    if (target.area === "local") {
      if (source.entry.entryKind === "metadata_only") {
        await addMetadataOnlyLibraryEntry({
          doi: source.entry.doi,
          externalUrl: source.entry.externalUrl,
          sourceId: source.entry.sourceId ?? source.entry.documentId,
          title: source.entry.title
        });
      } else {
        const client = createCloudLibraryStorageClient({ endpoint: input.endpoint });
        const stream = await client.downloadDocumentStream(
          source.scope,
          source.entry.documentId,
          source.area === "organization" ? "export" : "download"
        );
        await persistPdfByteStream({
          fileName: source.entry.fileName,
          stream,
          targetFolderPath: target.localFolderPath
        });
      }
      await input.refreshLocalLibrary();
      return;
    }

    const client = createCloudLibraryStorageClient({ endpoint: input.endpoint });
    const targetScope = requireCloudScope(target);
    if (
      source.scope.scopeId === targetScope.scopeId &&
      source.scope.scopeType === targetScope.scopeType
    ) {
      await client.updateDocument(source.scope, source.entry.documentId, {
        expectedRevision: requireExpectedRevision(target),
        folderId: target.folderId ?? null
      });
    } else {
      await client.copyEntry({
        documentId: source.entry.documentId,
        expectedRevision: requireExpectedRevision(target),
        source: source.scope,
        target: { ...targetScope, folderId: target.folderId }
      });
    }
    await input.refreshCloudTrees();
  }, [input]);
}
