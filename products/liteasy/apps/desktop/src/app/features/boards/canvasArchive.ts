import { hashText } from "../context/objectContext";
import type { BoardFileBinding } from "./boardFileFormat";
import { strToU8, zip } from "fflate";
import { serializeCanvasFile, parseCanvasFile } from "./boardFileFormat";
import type { ObjectEnvelope } from "../objects/object.types";
import type { ObjectRepository } from "../objects/objectRepository";
import type { AgentAssetService } from "../resource-filesystem/agentAssetService";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { stageDataUrl, stageImage } from "../objects/objectAssets";
/** Portable Canvas + real relative image files. No network or new directory grants. */
export async function createCanvasArchive(board: ObjectEnvelope, repository: ObjectRepository, assets: AgentAssetService): Promise<Blob> {
  const placements = await repository.listPlacements(board.objectId);
  if (placements.length > 200) throw new Error("单次附件导出最多 200 张卡片，请拆分白板后导出。");
  const binding = await repository.getBoardFileBinding<BoardFileBinding>(board.objectId);
  const document = parseCanvasFile(await serializeCanvasFile({ board, placements, edges: await repository.listEdges(board.objectId), repository, binding }));
  const files: Record<string, Uint8Array> = {}, missing: string[] = []; let bytes = 0;
  async function image(source: string, base: string) {
    try {
      const value = source.startsWith("data:image/") ? await stageDataUrl(source) : await (async () => {
        if (/^https?:/i.test(source)) throw new Error("远程图片保留来源网址");
        const images = await assets.resolveImages(source.startsWith("liteasy://") ? source : base, source.startsWith("liteasy://") ? {} : { relativePath: source });
        if (!images[0]) throw new Error("图片缺失");
        return stageImage(Uint8Array.from(atob(images[0].base64), (char) => char.charCodeAt(0)), images[0].mediaType);
      })();
      const path = `attachments/${value.sha256}.${value.mediaType.split("/")[1].replace("jpeg", "jpg")}`;
      if (!files[path]) { bytes += value.byteLength; if (bytes > 24 * 1024 * 1024) throw new Error("附件总大小超过 24 MiB"); files[path] = Uint8Array.from(atob(value.base64), (char) => char.charCodeAt(0)); }
      return path;
    } catch (error) { missing.push(`${source.slice(0, 300)}：${String(error)}`); return source; }
  }
  for (const node of document.nodes) {
    const placement = placements.find((item) => item.placementId === node.id); if (!placement) continue;
    const base = liteasyPath(repository.scopeId, { kind: "object", ref: placement.ref });
    if (node.text) {
      const matches = [...node.text.matchAll(/!\[([^\]]*)\]\(([^\s)]+)\)/g)];
      for (const match of matches) node.text = node.text.replace(match[0], `![${match[1]}](${await image(match[2], base)})`);
    }
    const block = (node.liteasy as { block?: { data?: { image?: unknown } } } | undefined)?.block;
    if (typeof block?.data?.image === "string" && block.data.image) {
      const path = await image(block.data.image, base); block.data.image = path;
      if (node.type === "text" && !node.text?.includes(`](${path})`)) node.text = `${node.text ?? ""}\n\n![图片](${path})`;
    }
    if (block && node.type === "text") (node.liteasy as Record<string, unknown>).portableTextHash = await hashText(node.text ?? "");
    if (node.type === "file") missing.push(`${node.file}：外部文件引用保留，请将对应文件与此白板一起迁移。`);
  }
  if ((await repository.resolveLatest(board.objectId)).revision !== board.revision) throw new Error("导出期间白板发生变化，请重新导出。");
  files["board.canvas"] = strToU8(JSON.stringify(document, null, 2) + "\n");
  files["README.md"] = strToU8(`# ${board.title}\n\n解压整个文件夹后打开 board.canvas，attachments 应保留在相同目录。\n\n${missing.length ? "## 未打包的引用\n\n" + missing.map((line) => "- " + line).join("\n") : "所有已识别图片附件已打包。"}\n`);
  const result = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 0 }, (error, data) => error ? reject(error) : resolve(data)));
  return new Blob([result.slice().buffer as ArrayBuffer], { type: "application/zip" });
}
