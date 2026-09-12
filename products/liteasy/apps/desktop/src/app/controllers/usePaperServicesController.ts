import { useEffect, useMemo, useRef, useState } from "react";
import type { SettingsState } from "../features/settings/settings.types";
import type { Paper } from "../features/workspace/workspace.types";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
import type { MineruFigure } from "../features/import/import.types";
import { loadDurableEntries } from "../features/persistence/durableJsonStore";
import { extractWithConfiguredMineru } from "../features/paper-services/mineruServiceClient";
import { createMetadataProviderClient } from "../features/paper-services/metadataProviderClient";
import { createLiteratureAuthorityClient } from "../features/paper-identity/literatureAuthorityClient";

type Material = { chunks: RetrievalChunk[]; figures: MineruFigure[]; sourcePath?: string; contentHash?: string };
export function usePaperServicesController(input: {
  settings: SettingsState; papers: Paper[]; cloudEndpoint: string;
  getSessionId: () => string | null; loadPdfSource: (path: string) => Promise<Uint8Array>;
  onProgress: (message: string) => void;
}) {
  const [materials, setMaterials] = useState<Record<string, Material>>({});
  const [running, setRunning] = useState<string[]>([]);
  const pending = useRef(new Map<string, Promise<Material>>());
  useEffect(() => {
    let active = true;
    loadDurableEntries("paper-services").then((entries) => {
      if (!active) return;
      const restored: Record<string, Material> = {};
      for (const [key, value] of Object.entries(entries)) {
        const material = value as Material;
        if (key.startsWith("mineru:") && Array.isArray(material?.chunks) && material.chunks.some((chunk) => chunk.textExtraction === "mineru")) restored[key.slice(7)] = material;
      }
      setMaterials((current) => ({ ...restored, ...current }));
    }).catch((error) => { if (active) input.onProgress(`无法读取论文解析缓存：${String(error)}`); });
    return () => { active = false; };
  }, []);
  const literatureClient = useMemo(() => input.settings["papers.metadata_provider"] === "cloud"
    ? createLiteratureAuthorityClient({ endpoint: input.cloudEndpoint, getSessionId: () => input.getSessionId() ?? undefined })
    : createMetadataProviderClient({ provider: input.settings["papers.metadata_provider"], endpoint: input.settings["papers.metadata_endpoint"] }),
  [input.settings["papers.metadata_provider"], input.settings["papers.metadata_endpoint"], input.cloudEndpoint]);
  async function extract(paper: Paper): Promise<Material> {
    const existing = pending.current.get(paper.id);
    if (existing) return existing;
    const mode = input.settings["papers.mineru_mode"];
    if (mode === "local") throw new Error("请先在设置的“论文与薄读”中配置 MinerU 服务。");
    const task = extractWithConfiguredMineru({
      config: { provider: "mineru", endpoint: input.settings["papers.mineru_endpoint"].replace(/\/+$/, "") },
      mode, paper, loadPdfSource: input.loadPdfSource, onProgress: input.onProgress
    }).then((result) => {
      const material = { ...result, sourcePath: paper.sourcePath, contentHash: paper.contentHash };
      setMaterials((current) => ({ ...current, [paper.id]: material }));
      input.onProgress(`《${paper.title}》解析完成，可以切换阅读模式。`);
      return material;
    }).finally(() => {
      pending.current.delete(paper.id);
      setRunning((current) => current.filter((id) => id !== paper.id));
    });
    pending.current.set(paper.id, task);
    setRunning((current) => [...current, paper.id]);
    return task;
  }
  const resources = Object.fromEntries(input.papers.flatMap((paper) => {
    const material = materials[paper.id];
    return material && (material.contentHash && paper.contentHash ? material.contentHash === paper.contentHash : material.sourcePath === paper.sourcePath) ? [[paper.id, { textChunks: material.chunks, figures: material.figures }]] : [];
  }));
  return { extract, literatureClient, resources, running };
}
