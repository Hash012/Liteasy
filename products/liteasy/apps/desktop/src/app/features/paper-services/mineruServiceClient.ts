import { unzipSync, strFromU8 } from "fflate";
import { buildPdfChunksFromPages } from "../import/pdfTextExtractor";
import type { MineruFigure } from "../import/import.types";
import type { Paper } from "../workspace/workspace.types";
import { encodeBytes, paperServiceRequest, type PaperServiceConfig } from "./paperServiceTransport";
import { loadDurableEntries, putDurableEntry } from "../persistence/durableJsonStore";

export function parseMineruArchive(bytes: Uint8Array, paper: Paper) {
  let expandedSize = 0;
  const files = unzipSync(bytes, { filter: (file) => {
    expandedSize += file.originalSize;
    if (file.originalSize > 32 * 1024 * 1024 || expandedSize > 40 * 1024 * 1024) throw new Error("MinerU 结果包超过本地保存限制，请使用较小的论文文件。");
    return true;
  } });
  const markdownPath = Object.keys(files).find((path) => /(?:^|\/)full\.md$/.test(path)) ?? Object.keys(files).find((path) => path.endsWith(".md"));
  if (!markdownPath) throw new Error("MinerU 结果包缺少 Markdown 正文。");
  const markdown = strFromU8(files[markdownPath]);
  const contentPath = Object.keys(files).find((path) => /(?:_content_list|content_list)\.json$/.test(path));
  const items: any[] = contentPath ? JSON.parse(strFromU8(files[contentPath])) : [];
  const pageTexts = new Map<number,string[]>();
  for (const item of items) {
    const text = item.text ?? item.table_body ?? item.image_caption?.join("\n") ?? "";
    if (text) { const page = Number(item.page_idx ?? 0) + 1; pageTexts.set(page, [...(pageTexts.get(page) ?? []), text]); }
  }
  const pages = [...pageTexts].map(([page, parts]) => ({ page, text: parts.join("\n\n"), textExtraction: "mineru" as const }));
  if (!pages.length) pages.push({ page: 1, text: markdown, textExtraction: "mineru" });
  const chunks = buildPdfChunksFromPages(paper, pages);
  if (!chunks.length) throw new Error("MinerU 没有返回可阅读的正文。");
  chunks[0] = { ...chunks[0], sourceMarkdown: markdown };
  const figures: MineruFigure[] = Object.entries(files).flatMap(([path, bytes], index) => {
    const extension = path.match(/\.(png|jpe?g|webp)$/i)?.[1];
    if (!extension) return [];
    const item = items.find((item) => item.img_path && path.endsWith(item.img_path));
    return [{ id: `${paper.id}-mineru-${index}`, sourcePath: path, page: Number(item?.page_idx ?? 0) + 1,
      alt: item?.image_caption?.join(" ") ?? "论文图片", dataUrl: `data:image/${extension === "jpg" ? "jpeg" : extension};base64,${encodeBytes(bytes)}` }];
  });
  return { chunks, figures };
}
export async function extractWithConfiguredMineru(input: {
  config: PaperServiceConfig; mode: "official" | "custom"; paper: Paper;
  loadPdfSource(path: string): Promise<Uint8Array>; onProgress?: (message: string) => void;
}) {
  const { config, paper } = input;
  const key = `mineru:${paper.id}`;
  const stored = await loadDurableEntries("paper-services");
  const cached = stored[key] as { chunks?: ReturnType<typeof buildPdfChunksFromPages>; figures?: MineruFigure[]; batchId?: string; uploadUrl?: string; uploaded?: boolean; endpoint?: string; sourcePath?: string; contentHash?: string } | undefined;
  if (cached?.chunks?.length && (cached.contentHash && paper.contentHash ? cached.contentHash === paper.contentHash : cached.sourcePath === paper.sourcePath)) return { chunks: cached.chunks, figures: cached.figures ?? [] };
  const check = async (response: Response) => { if (!response.ok) throw new Error(`MinerU 请求失败（HTTP ${response.status}），已保留解析任务。`); return response.json(); };
  let result: { chunks: ReturnType<typeof buildPdfChunksFromPages>; figures: MineruFigure[] };
  if (input.mode === "custom") {
    const bytes = await input.loadPdfSource(paper.sourcePath!);
    const response = await check(await paperServiceRequest(config, `${config.endpoint}/v1/pdf/mineru-extract`, { method: "POST", json: { bytesBase64: encodeBytes(bytes), filename: `${paper.title.replace(/\.pdf$/i,"").replace(/[<>:"/\\|?*]/g,"_")}.pdf` } }));
    const chunks = buildPdfChunksFromPages(paper, response.pages.map((page: any) => ({ ...page, textExtraction: "mineru" })));
    if (!chunks.length) throw new Error("解析服务没有返回正文。");
    if (response.markdown) chunks[0].sourceMarkdown = response.markdown;
    result = { chunks, figures: response.figures ?? [] };
  } else {
    let batchId = cached?.endpoint === config.endpoint && (cached.contentHash && paper.contentHash ? cached.contentHash === paper.contentHash : cached.sourcePath === paper.sourcePath) ? cached.batchId : undefined;
    let uploadUrl = batchId ? cached?.uploadUrl : undefined;
    let uploaded = batchId ? cached?.uploaded !== false : false;
    if (!batchId) {
      const payload = await check(await paperServiceRequest(config, `${config.endpoint}/api/v4/file-urls/batch`, { method: "POST", json: { files: [{ name: `${paper.title.replace(/\.pdf$/i,"").replace(/[<>:"/\\|?*]/g,"_")}.pdf` }], model_version: "vlm", enable_formula: true, enable_table: true } }));
      if (payload.code !== 0 || !payload.data?.file_urls?.[0]) throw new Error(`MinerU 未接受解析请求：${payload.msg ?? "响应不完整"}`);
      batchId = payload.data.batch_id;
      uploadUrl = payload.data.file_urls[0];
      await putDurableEntry("paper-services", key, { batchId, uploadUrl, uploaded: false, endpoint: config.endpoint, sourcePath: paper.sourcePath, contentHash: paper.contentHash });
    }
    if (!uploaded && uploadUrl) {
      const bytes = await input.loadPdfSource(paper.sourcePath!);
      const upload = await paperServiceRequest(config, uploadUrl, { method: "PUT", body: bytes, authenticate: false });
      if (!upload.ok) {
        if (upload.status === 403) await putDurableEntry("paper-services", key, undefined);
        throw new Error(`MinerU 文件上传失败（HTTP ${upload.status}），请再次解析。`);
      }
      uploaded = true;
      await putDurableEntry("paper-services", key, { batchId, uploaded, endpoint: config.endpoint, sourcePath: paper.sourcePath, contentHash: paper.contentHash });
    }
    let download: string | undefined;
    for (let attempt = 0; attempt < 180; attempt++) {
      const payload = await check(await paperServiceRequest(config, `${config.endpoint}/api/v4/extract-results/batch/${batchId}`));
      if (payload.code !== 0) throw new Error(`MinerU 查询失败：${payload.msg ?? "未知错误"}`);
      const task = payload.data?.extract_result?.[0];
      if (task?.state === "done") { download = task.full_zip_url; break; }
      if (task?.state === "failed") { await putDurableEntry("paper-services", key, undefined); throw new Error(`MinerU 解析失败：${task.err_msg ?? "请检查论文文件"}`); }
      input.onProgress?.(`MinerU 正在解析${task?.extract_progress ? ` ${task.extract_progress.extracted_pages}/${task.extract_progress.total_pages} 页` : "论文"}，任务已保存。`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (!download) throw new Error("MinerU 仍在处理，任务已保存，稍后再次解析会继续查询。");
    const archive = await paperServiceRequest(config, download, { authenticate: false });
    if (!archive.ok) throw new Error("MinerU 结果下载中断，可重试下载。");
    result = parseMineruArchive(new Uint8Array(await archive.arrayBuffer()), paper);
  }
  await putDurableEntry("paper-services", key, { ...result, endpoint: config.endpoint, sourcePath: paper.sourcePath, contentHash: paper.contentHash });
  return result;
}
