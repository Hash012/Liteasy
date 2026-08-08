import { useEffect, useState } from "react";
import type { AccountSession } from "./account.types";
import {
  loadAccountCapabilities,
  type AccountCapabilities,
  type AccountCapabilitiesTransport
} from "./accountCapabilitiesClient";

const unavailableCapabilities: AccountCapabilities = {
  developerDiagnostics: false
};

export function useAccountCapabilities({
  accountSession,
  endpoint,
  transport
}: {
  accountSession: AccountSession | null;
  endpoint: string;
  transport?: AccountCapabilitiesTransport;
}) {
  const [capabilities, setCapabilities] = useState(unavailableCapabilities);

  useEffect(() => {
    let active = true;
    setCapabilities(unavailableCapabilities);
    if (!accountSession) return () => { active = false; };
    void loadAccountCapabilities({
      endpoint,
      sessionId: accountSession.sessionId,
      transport
    }).then((result) => {
      if (active) setCapabilities(result);
    }).catch(() => {
      if (active) setCapabilities(unavailableCapabilities);
    });
    return () => { active = false; };
  }, [accountSession?.sessionId, endpoint, transport]);

  return capabilities;
}
