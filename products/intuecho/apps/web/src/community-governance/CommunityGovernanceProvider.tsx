import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { CommunityGovernanceApi, CommunityPreference } from "./governance.types";

type GovernanceContext = { actorBinding: string; api: CommunityGovernanceApi; preferences: CommunityPreference[]; refresh: () => void };
const Context = createContext<GovernanceContext | null>(null);
export const useCommunityGovernance = () => useContext(Context);

export function CommunityGovernanceProvider({ actorBinding, api, children }: { actorBinding: string; api: CommunityGovernanceApi; children: ReactNode }) {
  return <BoundProvider key={actorBinding} actorBinding={actorBinding} api={api}>{children}</BoundProvider>;
}
function BoundProvider({ actorBinding, api, children }: { actorBinding: string; api: CommunityGovernanceApi; children: ReactNode }) {
  const [preferences, setPreferences] = useState<CommunityPreference[]>([]);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    void api.preferences().then((result) => { if (active) setPreferences(result.preferences); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "无法读取订阅设置。"); });
    return () => { active = false; };
  }, [api, version]);
  return <Context.Provider value={{ actorBinding, api, preferences, refresh: () => setVersion((value) => value + 1) }}>
    {error && <p role="status">{error}</p>}{children}
  </Context.Provider>;
}
