import type { ObjectRepository } from "../objects/objectRepository";
import { isPaperMetadataReference, refOf, type ObjectRef } from "../objects/object.types";
import type { ResourceContextAttachment } from "../object-transfer/contextTransfer";
import { artifactContextText } from "../artifacts/artifactContext";
import type { AgentArtifactResult } from "../artifacts/artifact.types";
import { paperAnchorsForArtifact } from "../paper-anchors/paperAnchorAdapters";
import type { NoteFileService, NoteFileSnapshot } from "../note-files/noteFileService";
import { loadPdfNotes } from "../notes/pdfNotesSource";
import { artifactAnnotationNotes } from "../notes/artifactNotesSource";
import type { Paper } from "../workspace/workspace.types";
import type { PdfAnnotationCaptureInput } from "../objects/objectWorkbenchPort";
import { parseLiteasyPath } from "./liteasyPath";
import { parseResourceUri } from "./resourceFileService";
import { canonicalResourceJson, resourceContentRevision } from "./resourceFileContent";

export async function contextAttachments(repository: ObjectRepository, refs: ObjectRef[], active: () => boolean): Promise<ResourceContextAttachment[]> {
  const attachments: ResourceContextAttachment[] = [];
  for (const ref of refs) {
    if (!active()) throw new Error("账号已切换。");
    const object = await repository.get(ref);
    const members = object.kind === "workspace.board" ? await repository.listPlacements(object.objectId) : [];
    const edges = object.kind === "workspace.board" ? await repository.listEdges(object.objectId) : [];
    if (object.kind === "workspace.board" && (await repository.resolveLatest(object.objectId)).revision !== ref.revision)
      throw new Error("白板已变化，请重新加入以固定最新内容。");
    const contextRefs = [ref, ...members.map((member) => member.ref)];
    if (object.kind === "workspace.board") {
      if (!active()) throw new Error("账号已切换。");
      const fixed = { snapshotId: crypto.randomUUID(), scopeId: repository.scopeId, boardRef: ref,
        text: `白板结构（固定于加入上下文时；坐标表示空间布局，连接表示用户组织关系，不等于已证实的因果关系）：\n${JSON.stringify({
          elements: members.map((member) => ({ id: member.placementId, ref: member.ref, position: member.position,
            size: member.size, collapsed: member.collapsed, view: member.viewId })), connections: edges,
        }, null, 2)}` };
      await repository.saveSnapshot(fixed);
      contextRefs.push({ ...ref, selectorId: `board-context:${fixed.snapshotId}` });
    }
    attachments.push({ ref, refs: contextRefs, title: object.title, kind: object.kind,
      detail: object.kind === "workspace.board" ? `${members.length} 个元素 · 已固定版本`
        : isPaperMetadataReference(object) ? "题录已固定 · 正文按需读取" : "已固定版本" });
  }
  // Adding a locator fixes its version. Text/image loading and budget selection
  // belong to execution, so opening the context picker never reads every body twice.
  if (!active()) throw new Error("账号已切换。");
  return attachments;
}

export async function resolveLiteasyContext(input: {
  path: string; repository: ObjectRepository; active(): boolean; artifactScopeId: string;
  files: NoteFileService; getPapers(): Paper[]; getArtifacts(): Promise<AgentArtifactResult[]>;
  capturePapers(ids: string[]): Promise<ObjectRef[]>;
  captureAnnotation(input: PdfAnnotationCaptureInput): Promise<ObjectRef[]>;
  resolveBoard(file: NoteFileSnapshot): Promise<ObjectRef>;
}) {
  if (!input.active()) throw new Error("账号已切换。");
  const { repository } = input;
  let pinnedArtifact: AgentArtifactResult | undefined;
  const target = input.path.startsWith("liteasy://resources/") ? await (async () => {
    const ref = parseResourceUri(input.path);
    if (ref.providerId !== "artifacts" || ref.scopeId !== input.artifactScopeId) throw new Error("资源不属于当前账户或不支持读取。");
    pinnedArtifact = (await input.getArtifacts()).find((artifact) => artifact.artifactId === ref.resourceId);
    if (!pinnedArtifact) throw new Error("生成产物不可用。");
    if (ref.revision && await resourceContentRevision(canonicalResourceJson(pinnedArtifact)) !== ref.revision)
      throw new Error("该产物版本已变化，请重新复制当前 Liteasy Path。");
    return { kind: "artifact" as const, artifactId: ref.resourceId };
  })() : parseLiteasyPath(input.path, repository.scopeId);
  let refs: ObjectRef[];
  if (target.kind === "object") {
    const object = target.followLatest ? await repository.resolveLatest(target.ref.objectId) : await repository.get(target.ref);
    refs = [{ ...refOf(object), ...(target.ref.selectorId ? { selectorId: target.ref.selectorId } : {}) }];
  } else if (target.kind === "paper") {
    refs = await input.capturePapers([target.paperId]);
  } else if (target.kind === "external-file") {
    const file = await input.files.readFile(target.mountId, target.path);
    if (/\.canvas$/i.test(file.path)) refs = [await input.resolveBoard(file)];
    else {
      const object = await repository.projectLegacy(`note-file-${file.mountId}-${file.path}`, {
        kind: "content.note", title: file.name,
        content: { schema: "liteasy.note/v1", payload: { text: file.text, origin: "external" } },
      });
      await repository.setObjectFileBinding(object.objectId, { mountId: file.mountId, path: file.path, version: file.version, objectRevision: object.revision });
      refs = [refOf(object)];
    }
  } else if (target.kind === "pdf-annotation") {
    const paper = input.getPapers().find((item) => item.id === target.paperId);
    if (!paper) throw new Error("论文在当前工作区不可用。");
    const note = (await loadPdfNotes([paper])).find((item) => item.annotation?.id === target.annotationId);
    if (!note?.annotation) throw new Error("论文批注不可用。");
    refs = await input.captureAnnotation({ paper, annotation: note.annotation });
  } else {
    const artifact = pinnedArtifact ?? (await input.getArtifacts()).find((item) => item.artifactId === target.artifactId);
    if (!artifact) throw new Error("生成产物在当前账户不可用。");
    const note = target.kind === "artifact-annotation" ? artifactAnnotationNotes([artifact]).find((item) =>
      item.target.kind === "artifact-annotation" && item.target.annotationId === target.annotationId) : undefined;
    if (target.kind === "artifact-annotation" && !note) throw new Error("产物批注已不可用。");
    const text = note?.text ?? artifactContextText(artifact);
    if (!text.trim()) throw new Error("该资源没有可分析的正文。");
    const object = await repository.projectLegacy(note ? `artifact-annotation-context-${artifact.artifactId}-${target.kind === "artifact-annotation" ? target.annotationId : ""}` : `artifact-context-${artifact.artifactId}`, {
      kind: "artifact.document", title: note?.title ?? artifact.title, runId: artifact.agent.runId,
      paperAnchors: note?.paperAnchors ?? paperAnchorsForArtifact(artifact),
      content: { schema: "liteasy.document/v1", payload: { legacyArtifactId: artifact.artifactId,
        blocks: [{ blockId: "document", type: "markdown", text, sourceRefs: [] }] } },
    });
    refs = [refOf(object)];
  }
  return contextAttachments(repository, refs, input.active);
}
