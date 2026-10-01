import { hasNativeHost, nativeRequest } from "../../platform/native";

export type AccountStatus = { scope: string; subject?: string; apiBaseUrl: string; expiresAt?: number; pending?: boolean; error?: string };
export const guestAccount: AccountStatus = { scope: "local", apiBaseUrl: "" };
export const accountClient = {
  available: hasNativeHost,
  status: () => hasNativeHost() ? nativeRequest<AccountStatus>("accountStatus") : Promise.resolve(guestAccount),
  begin: (apiBaseUrl: string) => nativeRequest<AccountStatus>("beginLogin", { apiBaseUrl }),
  cancel: () => nativeRequest<AccountStatus>("cancelLogin"),
  logout: () => nativeRequest<AccountStatus>("logout"),
  copyGuest: () => nativeRequest<{ copied: number; skipped: number }>("copyGuestLibrary"),
  request: <T>(path: string, method = "GET", body?: Record<string, unknown>) => nativeRequest<T>("accountRequest", { path, method, body })
};
