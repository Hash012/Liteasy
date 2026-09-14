import { useEffect, useMemo, useRef, useState } from "react";
import type { AssistantComposerSuggestion, AssistantContextToken } from "../features/assistant/assistant.types";
import type { ArtifactTab } from "../features/artifacts/artifact.types";
import { createNoteFileService, subscribeNoteFiles } from "../features/note-files/noteFileService";
import { ARTIFACT_CONTEXT_MIME } from "../features/object-transfer/contextTransfer";
import { makeObjectTransfer, OBJECT_TRANSFER_MIME } from "../features/object-transfer/objectTransfer";
import { refOf, type ObjectEnvelope, type ObjectRef } from "../features/objects/object.types";
import type { ObjectRepository } from "../features/objects/objectRepository";
import type { ObjectWorkbenchPort } from "../features/objects/objectWorkbenchPort";

import { createNoteFileCatalogIndex, type CatalogFile } from "../features/note-files/noteFileCatalogIndex";

/** Catalog stores may publish a new array for progress without changing any entries. */
function useStableCatalogItems<T>(items: T[]) {
  const previous = useRef(items);
  if (previous.current !== items && (previous.current.length !== items.length ||
    items.some((item, index) => item !== previous.current[index]))) {
    previous.current = items;
  }
  return previous.current;
}

export function useAssistantContextCatalog(input: {
  artifacts: ArtifactTab[];
  objects: ObjectEnvelope[];
  port: ObjectWorkbenchPort;
  repository: ObjectRepository;
}) {
  const latest = useRef(input);
  latest.current = input;
  const scopeId = input.repository.scopeId;
  const artifacts = useStableCatalogItems(input.artifacts);
  const objects = useStableCatalogItems(input.objects);
  const files = useMemo(() => createNoteFileService(scopeId, () => latest.current.repository.scopeId), [scopeId]);
  const [catalog, setCatalog] = useState<CatalogFile[]>([]);
  useEffect(() => {
    setCatalog([]);
    const index = createNoteFileCatalogIndex({ files, onChange: setCatalog });
    void index.refresh();
    const unsubscribe = subscribeNoteFiles(scopeId, index.change);
    const focus = () => index.requestRefresh();
    window.addEventListener("focus", focus);
    return () => { index.dispose(); unsubscribe(); window.removeEventListener("focus", focus); };
  }, [files, scopeId]);

  return useMemo(() => {
    function assertCurrentScope() {
      if (latest.current.repository.scopeId !== scopeId) throw new Error("账号已切换，请重新选择上下文。");
    }

    async function resolveTransfer(mime: string, value: string): Promise<AssistantContextToken> {
      assertCurrentScope();
      const attachments = await latest.current.port.receiveContextDrop?.({ getData: (key) => key === mime ? value : "" });
      if (!attachments?.length) throw new Error("这份内容暂时无法添加，请刷新后重试。");
      const attachment = attachments[0];
      return { id: `object-${JSON.stringify(attachment.ref)}`, kind: "object", label: attachment.title,
        detail: attachment.detail, prompt: "", contextRefs: attachments.flatMap((item) => item.refs) };
    }

    async function resolveObject(ref: ObjectRef) {
      return resolveTransfer(OBJECT_TRANSFER_MIME, JSON.stringify(makeObjectTransfer([ref])));
    }

    const suggestions: AssistantComposerSuggestion[] = [
      ...artifacts.map((artifact) => ({
        id: `artifact-${artifact.artifactId}`, trigger: "@" as const, label: artifact.title,
        detail: artifact.sourcePath ?? artifact.resultPath ?? `产物/${artifact.type === "thin_reading" ? "薄读" : "生成文档"}/${artifact.title}`,
        resolveToken: () => resolveTransfer(ARTIFACT_CONTEXT_MIME, artifact.artifactId),
      })),
      ...catalog.map((file) => ({
        id: `file-${file.mountId}-${file.path}`, trigger: "@" as const, label: file.name, detail: file.location,
        resolveToken: async () => {
          const snapshot = await files.readFile(file.mountId, file.path);
          assertCurrentScope();
          let ref: ObjectRef;
          if (/\.canvas$/i.test(file.name)) {
            const board = await latest.current.port.resolveBoardFile?.(snapshot);
            if (!board) throw new Error("当前白板文件无法加入上下文。");
            ref = board;
          } else {
            if (!snapshot.text.trim()) throw new Error("这份文件还没有可添加的正文。");
            ref = refOf(await input.repository.projectLegacy(`note-file-${file.mountId}-${file.path}`, {
              kind: "content.note", title: file.name,
              content: { schema: "liteasy.note/v1", payload: { text: snapshot.text, origin: "external" } },
            }));
          }
          return { ...await resolveObject(ref), detail: file.location };
        },
      })),
      ...objects.filter((object) => ["content.note", "workspace.board", "content.fragment"].includes(object.kind)).map((object) => ({
        id: `saved-${object.objectId}`, trigger: "@" as const, label: object.title,
        detail: `${object.kind === "workspace.board" ? "研究白板" : "笔记"}/${object.title}`,
        resolveToken: async () => resolveObject(refOf(await input.repository.resolveLatest(object.objectId))),
      })),
    ];
    return suggestions;
  }, [artifacts, objects, input.repository, catalog, files, scopeId]);
}
