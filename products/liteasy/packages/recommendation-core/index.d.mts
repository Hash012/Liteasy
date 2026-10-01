export type View = { importance?: number; id: string; kind: "document" | "annotation" | "profile"; title: string; text: string; path?: string; anchorRef?: string; vector?: number[] };
export type Candidate = { id: string; title: string; abstract?: string; subjects?: string[]; keywords?: string[]; publishedYear?: number; citationCount?: number; vector?: number[]; saved?: boolean };
export type Evidence = { viewId: string; kind: View["kind"]; title: string; path?: string; anchorRef?: string; matched: string[]; lexical: number; semantic: number };
export type FusionRoute = { id: "lexical_bm25" | "semantic" | "personalization"; rank: number; score: number; weight: number; contribution: number };
export type Hybrid = { routes: FusionRoute[]; version: string; score: number; preference: number; diversityPenalty: number; evidence: Evidence[] };
export type Keyword = { value: string; label: string; kind: "method" | "object" | "subject"; source: "provider" | "text" };
export const rankingVersion: string;
export function terms(value: string): string[];
export function cosine(left?: number[], right?: number[]): number;
export function bm25(query: string, documents: string[]): number[];
export function rrf(routes: { weight: number; scores: { id: string; score: number }[] }[], k?: number): Map<string, number>;
export function hybridRank<T extends Candidate>(candidates: T[], views: View[], options?: { semanticScores?: Record<string, Record<string, number>>; style?: string; year?: number; semanticFloor?: number }): (T & { hybrid: Hybrid })[];
export function keywords(item: Pick<Candidate, "title" | "abstract" | "keywords" | "subjects">, corpus?: Candidate[], vectors?: Record<string, number>): Keyword[];

export function rrfContribution(weight: number, rank: number, k?: number): number;

export function diversify<T extends Candidate & { hybrid: Hybrid }>(items: T[], options?: { style?: string }): T[];

export function bm25TokenScorer(documents: string[][]): { scoreAt(index: number, tokens: string[]): number; scoreTokens(tokens: string[]): number[] };
