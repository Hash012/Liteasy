import type { ObjectRepository } from "../objects/objectRepository";
import type { NoteFileService } from "../note-files/noteFileService";
import type { Paper } from "../workspace/workspace.types";
import { liteasyPath, type ResourceTarget } from "./liteasyPath";

export type ResourcePathCandidate = { title: string; kind: string; path: string };

export async function searchResourcePaths(input: {
  query: string; repository: ObjectRepository; files: NoteFileService;
  getPapers(): Paper[]; getArtifacts(): Promise<Array<{ artifactId: string; title: string }>>; active(): boolean;
}): Promise<ResourcePathCandidate[]> {
  const check = () => { if (!input.active()) throw new Error("账号已切换，请重新搜索。"); };
  check();
  const query = input.query.trim().toLocaleLowerCase();
  const result: ResourcePathCandidate[] = [];
  const add = (title: string, kind: string, target: ResourceTarget, match = false) => {
    const path = liteasyPath(input.repository.scopeId, target);
    if (match || `${title} ${kind} ${path}`.toLocaleLowerCase().includes(query)) result.push({ title, kind, path });
  };
  // Read title records only; object bodies and embedded images are resolved on selection.
  let objectQuery = query;
  if (query.startsWith("liteasy://objects/")) {
    try { objectQuery = decodeURIComponent(query.split("/")[3].split("?")[0]); }
    catch { objectQuery = query; }
  }
  for (const object of await input.repository.searchTitles(objectQuery, 20)) {
    add(object.title, "笔记 / 白板 / 内容", { kind: "object", ref: { objectId: object.objectId, revision: "latest" }, followLatest: true }, true);
  }
  check();
  for (const paper of input.getPapers()) add(paper.title, "论文", { kind: "paper", paperId: paper.id });
  for (const artifact of await input.getArtifacts()) add(artifact.title, "生成产物", { kind: "artifact", artifactId: artifact.artifactId });
  check();
  for (const mount of await input.files.listMounts()) {
    check();
    // An unavailable external mount must not hide the rest of the library.
    for (const file of await input.files.listEntries(mount.id).catch(() => [])) {
      if (file.kind === "file" && /\.(md|markdown|canvas)$/i.test(file.path))
        add(file.name, `${mount.name} · ${file.path}`, { kind: "external-file", mountId: mount.id, path: file.path });
    }
  }
  check();
  return [...new Map(result.map((item) => [item.path, item])).values()].slice(0, 30);
}
