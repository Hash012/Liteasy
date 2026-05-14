import { AccountStatusPanel } from "../features/account/AccountStatusPanel";
import { AppBrand } from "./AppBrand";
import type { AccountSession } from "../features/account/account.types";
import type { SettingsState } from "../features/settings/settings.types";

type TopBarProps = {
  accountMessage?: string;
  accountPending?: boolean;
  accountSession: AccountSession | null;
  modelAccessMode: SettingsState["models.access_mode"];
  onLogin: () => void;
  onLogout: () => void;
};

export function TopBar({
  accountMessage,
  accountPending,
  accountSession,
  modelAccessMode,
  onLogin,
  onLogout
}: TopBarProps) {
  return (
    <header className="app-topbar">
      <AppBrand modelAccessMode={modelAccessMode} />
      <AccountStatusPanel
        message={accountMessage}
        onLogin={onLogin}
        onLogout={onLogout}
        pending={accountPending}
        session={accountSession}
      />
    </header>
  );
}
