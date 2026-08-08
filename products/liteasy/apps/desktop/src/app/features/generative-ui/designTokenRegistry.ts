export type UIDslTokenName = "none" | "xs" | "sm" | "md" | "lg";

const spacingTokens: UIDslTokenName[] = ["none", "xs", "sm", "md", "lg"];

export function hasSpacingToken(token: unknown): token is UIDslTokenName {
  return typeof token === "string" && spacingTokens.includes(token as UIDslTokenName);
}
