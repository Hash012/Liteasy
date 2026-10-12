import { revealResource } from "../../features/resource-links/resourceReveal";
import type { AssetOpenLocation } from "../../features/resource-filesystem/assetNavigation";
import { parseLiteasyPath } from "../../features/resource-filesystem/liteasyPath";
import { objectLink, refOf } from "../../features/objects/object.types";
import type { ObjectRepository } from "../../features/objects/objectRepository";
import type { PaperProjectRepository } from "../../features/paper-projects/paperProjectRepository";
import type { Paper } from "../../features/workspace/workspace.types";
import type { NoteFileService, NoteFileSnapshot } from "../../features/note-files/noteFileService";
import type { PaperAttachmentController } from "../usePaperAttachmentController";

/** Route verified asset receipts through the same editors used by the library. */
export function createAgentAssetNavigator(input: {
  repository: ObjectRepository;
  projects: PaperProjectRepository;
  files: NoteFileService;
  active(): boolean;
  getPapers(): Paper[];
  openAttachment: PaperAttachmentController["open"];
  openObject(link: string): Promise<void>;
  openFile(file: NoteFileSnapshot): void | Promise<void>;
  openPaper(paper: Paper): void;
  openArtifact(id: string): void;
}) {
  return async (path: string, location?: AssetOpenLocation) => {
    const check = () => { if (!input.active()) throw new Error("账号已切换，请重新打开文件。"); };
    check();
    if (location && location.scopeId !== input.repository.scopeId) throw new Error("引用属于其他账号。");
    const reveal = () => { if (location) revealResource({ path, line: location.line, quote: location.quote }); };
    const target = parseLiteasyPath(path, input.repository.scopeId);
    if (target.kind === "external-file") {
      const file = await input.files.readFile(target.mountId, target.path);
      check();
      if (location && file.version !== location.revision) throw new Error("revision_unavailable：文件版本已变化，无法打开被引用版本。");
      reveal(); await input.openFile(file); return;
    }
    if (target.kind === "paper") {
      const paper = input.getPapers().find((item) => item.id === target.paperId);
      if (!paper) throw new Error("论文已移出当前文库。");
      if (location && paper.contentHash !== location.revision) throw new Error("revision_unavailable：论文版本已变化。");
      input.openPaper(paper); return;
    }
    if (target.kind === "artifact") { if (location) throw new Error("revision_unavailable：此产物尚不支持历史版本导航。"); input.openArtifact(target.artifactId); return; }
    if (target.kind !== "object") throw new Error("此链接暂不支持直接打开，请在文库中查看。");
    const pinned = location?.revision ?? (!target.followLatest ? target.ref.revision : undefined);
    const object = pinned ? await input.repository.get({ objectId: target.ref.objectId, revision: pinned }) : await input.repository.resolveLatest(target.ref.objectId);
    check();
    if (!pinned && object.kind === "content.note") {
      for (const project of await input.projects.listProjects()) {
        const asset = (await input.projects.listAssets(project.projectId)).find((item) => item.ref?.objectId === object.objectId);
        const paper = input.getPapers().find((item) => item.id === project.paperId);
        check();
        if (asset && paper) {
          await input.openAttachment({ id: asset.assetId, kind: "note", label: asset.title, objectId: object.objectId }, paper);
          return;
        }
      }
    }
    reveal();
    await input.openObject(objectLink(refOf(object)));
  };
}
