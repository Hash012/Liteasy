import type { RecommendationDownloadOptions, RecommendationItem } from "../recommendations/recommendation.types";

export type ImportedPaper = { paperId: string; title: string; filePath: string; duplicate: boolean; message: string };
export type ImportPaper = (item: RecommendationItem, options: RecommendationDownloadOptions, signal: AbortSignal) => Promise<ImportedPaper>;
