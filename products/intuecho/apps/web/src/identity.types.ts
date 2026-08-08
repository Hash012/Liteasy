export type IdentityMode = "development" | "oauth" | "unavailable";

export type IdentitySession = {
  audience: "intuecho-web";
  email: string;
  expiresAt: string;
  name: string;
  sessionId: string;
  userId: string;
};
