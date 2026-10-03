import type { z } from "zod";

export type CommunityPreference = {
  targetKind: "thread" | "literature" | "organization" | "author";
  targetId: string;
  subscribed: boolean;
  muted: boolean;
  blocked: boolean;
};
export type CommunityReportInput = { revision: number; reason: "spam" | "harassment" | "privacy" | "other"; detail: string };
export type CommunityReportResolution = { status: "resolved" | "dismissed"; reason: "reviewed" | "insufficient_evidence" | "duplicate" | "outside_scope" };
export type CommunityReport = {
  id: string; annotationId: string; revision: number; reason: CommunityReportInput["reason"]; detail: string;
  status: "pending" | CommunityReportResolution["status"]; createdAt: string; resolvedAt: string | null;
  resolutionReason: CommunityReportResolution["reason"] | null;
};
export type CommunityNotification = {
  id: string; available: false;
} | {
  id: string; available: true; kind: "reply"; createdAt: string; readAt: string | null;
  target: { annotationId: string; revision: number };
};
export declare const communityPreferenceSchema: z.ZodType<CommunityPreference>;
export declare const communityReportSchema: z.ZodType<CommunityReportInput>;
export declare const communityReportResolutionSchema: z.ZodType<CommunityReportResolution>;
