export type AccountMembershipTier = "basic" | "pro";

export type AccountSession = {
  /** Bound by the verified native identity flow, never inferred from display fields. */
  endpoint?: string;
  issuer?: string;
  email: string;
  expiresAt: string;
  membershipTier?: AccountMembershipTier;
  name: string;
  sessionId: string;
  userId?: string;
};
