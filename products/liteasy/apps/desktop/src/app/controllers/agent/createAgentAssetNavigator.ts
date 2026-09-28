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
  return async (path: string) => {
    const check = () => { if (!input.active()) throw new Error("账号已切换，请重新打开文件。"); };
    check();
    const target = parseLiteasyPath(path, input.repository.scopeId);
    if (target.kind === "external-file") {
      const file = await input.files.readFile(target.mountId, target.path);
      check(); await input.openFile(file); return;
    }
    if (target.kind === "paper") {
      const paper = input.getPapers().find((item) => item.id === target.paperId);
      if (!paper) throw new Error("论文已移出当前文库。");
      input.openPaper(paper); return;
    }
    if (target.kind === "artifact") { input.openArtifact(target.artifactId); return; }
    if (target.kind !== "object") throw new Error("此链接暂不支持直接打开，请在文库中查看。");
    const object = await input.repository.resolveLatest(target.ref.objectId);
    check();
    if (object.kind === "content.note") {
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
    await input.openObject(objectLink(refOf(object)));
  };
}
