import type { AccountSession } from "../account/account.types";

export type CloudAvailabilityStatus = "available" | "unavailable";

type GetCloudAvailabilityStatusInput = {
  accountSession: AccountSession | null;
  isCloudReachable?: boolean;
  isOnline: boolean;
};

export function getCloudAvailabilityStatus({
  accountSession,
  isCloudReachable = true,
  isOnline
}: GetCloudAvailabilityStatusInput): CloudAvailabilityStatus {
  if (!isOnline) {
    return "unavailable";
  }

  if (!accountSession) {
    return "unavailable";
  }

  if (!isCloudReachable) {
    return "unavailable";
  }

  return "available";
}
