import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ObjectRepository } from "../objects/objectRepository";
import type { BoardFileBinding } from "../boards/boardFileFormat";
import type { NoteFileService } from "../note-files/noteFileService";
import type { Paper } from "../workspace/workspace.types";
import { liteasyPath, resourceTargetSchema, type ResourceLocation, type ResourceTarget } from "./liteasyPath";

export async function describeResourceLocation(input: {
  target: ResourceTarget; repository: ObjectRepository; files: NoteFileService;
  getPapers(): Paper[]; active(): boolean; artifactScopeId: string; reveal?: boolean;
}): Promise<ResourceLocation> {
  const check = () => { if (!input.active()) throw new Error("账号已切换。"); };
  check();
  const target = resourceTargetSchema.parse(input.target);
  const path = liteasyPath(input.repository.scopeId, target);
  let physicalTarget = target;
  if (target.kind === "object") {
    const object = target.followLatest ? await input.repository.resolveLatest(target.ref.objectId) : await input.repository.get(target.ref);
    const binding = object.kind === "workspace.board"
      ? await input.repository.getBoardFileBinding<BoardFileBinding>(object.objectId)
      : await input.repository.getObjectFileBinding(object.objectId);
    const revision = binding && ("savedRevision" in binding ? binding.savedRevision : binding.objectRevision);
    if (binding && revision === object.revision) {
      // A changed or missing external file no longer stores this exact snapshot.
      const file = await input.files.readFile(binding.mountId, binding.path).catch(() => null);
      if (file && file.version === binding.version)
        physicalTarget = { kind: "external-file", mountId: binding.mountId, path: binding.path };
    }
  }
  check();
  let physicalPath: string, physicalKind: ResourceLocation["physicalKind"] = "file", canReveal = isTauri();
  if (physicalTarget.kind === "external-file") {
    const mount = (await input.files.listMounts()).find((entry) => entry.id === physicalTarget.mountId);
    if (!mount) throw new Error("文件夹授权已不可用，请重新连接。");
    if (isTauri()) {
      const location = await invoke<{ path: string }>("note_files_dispatch", { scope: input.repository.scopeId,
        request: { action: input.reveal ? "revealFile" : "locateFile", mountId: physicalTarget.mountId, path: physicalTarget.path } });
      physicalPath = location.path;
    } else {
      physicalPath = `浏览器授权位置：${mount.location}${mount.kind === "directory" ? `/${physicalTarget.path}` : ""}（浏览器不提供系统绝对路径）`;
      physicalKind = "browser"; canReveal = false;
    }
  } else if ((physicalTarget.kind === "artifact" || physicalTarget.kind === "artifact-annotation") && input.artifactScopeId !== "device") {
    physicalPath = "Liteasy 云端资源，本机没有独立文件。"; physicalKind = "cloud"; canReveal = false;
  } else if (!isTauri()) {
    physicalPath = "当前浏览器的本地存储（没有独立系统文件）"; physicalKind = "browser"; canReveal = false;
  } else {
    let request: Record<string, string>;
    if (physicalTarget.kind === "paper") {
      const paper = input.getPapers().find((item) => item.id === physicalTarget.paperId);
      if (!paper) throw new Error("论文在当前工作区不可用。");
      if (!paper.sourcePath) throw new Error("论文尚无可定位的文件，请先导入或下载全文。");
      if (/^https?:\/\//i.test(paper.sourcePath)) return { liteasyPath: path, physicalPath: paper.sourcePath, physicalKind: "cloud", canReveal: false };
      request = { kind: "paper", path: paper.sourcePath };
    } else if (physicalTarget.kind === "artifact" || physicalTarget.kind === "artifact-annotation") request = { kind: "artifact", id: physicalTarget.artifactId };
    else if (physicalTarget.kind === "pdf-annotation") request = { kind: "pdf-annotation", paperId: physicalTarget.paperId };
    else { request = { kind: "object" }; physicalKind = "database"; }
    const result = await invoke<{ path: string }>("resource_location", { scope: input.repository.scopeId, request, revealInFolder: input.reveal ?? false });
    physicalPath = result.path;
  }
  check();
  return { liteasyPath: path, physicalPath, physicalKind, canReveal };
}
