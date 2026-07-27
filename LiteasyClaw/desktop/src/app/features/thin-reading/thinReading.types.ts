export type ThinReadingPaper = {
  id: string;
  title: string;
};

export type ThinReadingNodeSource =
  | { kind: "root_overview" }
  | { kind: "omitted_section"; label: string; sectionKey: string }
  | { kind: "selected_text"; excerpt: string; prompt?: string };

export type ThinReadingBranchSource = Exclude<ThinReadingNodeSource, { kind: "root_overview" }>;

export type ThinReadingRecommendationScope =
  | { kind: "whole_paper"; paperId?: string }
  | { kind: "section"; paperId?: string; sectionKey: string }
  | { kind: "selected_passage"; paperId?: string; excerpt: string };

export type ThinReadingSectionToken = {
  id: string;
  label: string;
  sectionKey: string;
};

export type ThinReadingIntuechoRecommendation = {
  id: string;
  compatibility: number;
  note: string;
  relationship: string;
};

export type ThinReadingNode = {
  childIds: readonly string[];
  createdAt: string;
  depth: number;
  id: string;
  omittedSections: readonly ThinReadingSectionToken[];
  parentId?: string;
  recommendationScope: ThinReadingRecommendationScope;
  recommendations: readonly ThinReadingIntuechoRecommendation[];
  source: ThinReadingNodeSource;
  summary: string;
  title: string;
  withinPaperClosure: boolean;
};

export type ThinReadingDocument = {
  artifactId: string;
  paperIds: readonly string[];
  title: string;
  targetLanguage: string;
  activeNodeId: string;
  nodes: Readonly<Record<string, ThinReadingNode>>;
  rootNodeId: string;
  version: "liteasy.thin-reading/v1";
};

export type CreateThinReadingDocumentInput = {
  artifactId: string;
  papers: readonly ThinReadingPaper[];
  targetLanguage: string;
  importedChunksByPaperId?: Readonly<Record<string, readonly string[]>>;
};

export type AdvanceThinReadingDocumentInput = {
  parentNodeId: string;
  source: ThinReadingBranchSource;
  summary: string;
  title: string;
  createdAt?: string;
  withinPaperClosure?: boolean;
};
