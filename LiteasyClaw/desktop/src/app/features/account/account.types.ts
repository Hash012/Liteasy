export type AccountMembershipTier = "basic" | "pro";

export type AccountSession = {
  email: string;
  expiresAt: string;
  membershipTier?: AccountMembershipTier;
  name: string;
  sessionId: string;
};
