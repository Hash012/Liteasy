import type {
  CommunityNotification, CommunityPreference, CommunityReport, CommunityReportInput, CommunityReportResolution
} from "../../../../packages/contracts/src/communityGovernance";
export type { CommunityNotification, CommunityPreference, CommunityReport, CommunityReportInput, CommunityReportResolution };

export type CommunityGovernanceApi = {
  preferences(): Promise<{ preferences: CommunityPreference[] }>;
  setPreference(preference: CommunityPreference): Promise<{ preference: CommunityPreference }>;
  notifications(): Promise<{ notifications: CommunityNotification[] }>;
  markNotificationRead(id: string): Promise<{ id: string; read: true }>;
  reportAnnotation(id: string, input: CommunityReportInput): Promise<{ report: CommunityReport }>;
  myReports(): Promise<{ reports: CommunityReport[] }>;
  reviewReports(): Promise<{ reports: CommunityReport[] }>;
  resolveReport(id: string, input: CommunityReportResolution): Promise<{ report: CommunityReport }>;
};
