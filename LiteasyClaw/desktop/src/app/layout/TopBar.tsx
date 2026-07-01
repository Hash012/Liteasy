import { AccountStatusPanel } from "../features/account/AccountStatusPanel";
import { AppBrand } from "./AppBrand";
import type { AccountSession } from "../features/account/account.types";

type TopBarProps = {
  accountMessage?: string;
  accountPending?: boolean;
  accountSession: AccountSession | null;
  cloudAvailabilityStatus?: "available" | "unavailable";
  onLogin: () => void;
  onLogout: () => void;
};

export function TopBar({
  accountMessage,
  accountPending,
  accountSession,
  cloudAvailabilityStatus = "available",
  onLogin,
  onLogout
}: TopBarProps) {
  return (
    <header className="app-topbar">
      <AppBrand />
      <AccountStatusPanel
        cloudAvailabilityStatus={cloudAvailabilityStatus}
        message={accountMessage}
        onLogin={onLogin}
        onLogout={onLogout}
        pending={accountPending}
        session={accountSession}
      />
    </header>
  );
}
