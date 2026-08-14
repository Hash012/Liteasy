import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountSession } from "./account.types";
import {
  AccountCapabilitiesClientError,
  loadAccountCapabilities,
  parseMultimodalVisualizationCapability,
  type AccountCapabilities,
  type AccountCapabilitiesTransport,
  unavailableMultimodalVisualizationCapability
} from "./accountCapabilitiesClient";

const unavailableCapabilities: AccountCapabilities = {
  developerDiagnostics: false,
  multimodalVisualization: unavailableMultimodalVisualizationCapability
};

export function useAccountCapabilities({
  accountSession,
  endpoint,
  refreshSession,
  transport
}: {
  accountSession: AccountSession | null;
  endpoint: string;
  refreshSession?: () => Promise<AccountSession | null>;
  transport?: AccountCapabilitiesTransport;
}) {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<{ key: string; capabilities: AccountCapabilities }>({
    key: "",
    capabilities: unavailableCapabilities
  });
  const sessionKey = `${accountSession?.sessionId ?? ""}:${endpoint}:${generation}`;
  const invalidated = useRef(true);
  const previousSessionKey = useRef(sessionKey);
  if (previousSessionKey.current !== sessionKey) {
    previousSessionKey.current = sessionKey;
    invalidated.current = true;
  }
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  const invalidate = useCallback(() => {
    invalidated.current = true;
    setState({ key: "", capabilities: unavailableCapabilities });
  }, []);
  const setMultimodalVisualizationCapability = useCallback((value: unknown) => {
    const multimodalVisualization = parseMultimodalVisualizationCapability(value);
    setState((current) => {
      if (current.key !== sessionKey) return current;
      return {
        ...current,
        capabilities: {
          ...current.capabilities,
          multimodalVisualization
        }
      };
    });
  }, [sessionKey]);

  useEffect(() => {
    let active = true;
    invalidated.current = false;
    setState({ key: sessionKey, capabilities: unavailableCapabilities });
    if (!accountSession) return () => { active = false; };
    const load = async () => {
      try {
        return await loadAccountCapabilities({
          endpoint,
          sessionId: accountSession.sessionId,
          transport
        });
      } catch (error) {
        if (!(error instanceof AccountCapabilitiesClientError) || error.status !== 401 || !refreshSession) {
          throw error;
        }
        const refreshed = await refreshSession();
        if (!refreshed) throw error;
        return loadAccountCapabilities({ endpoint, sessionId: refreshed.sessionId, transport });
      }
    };
    void load().then((result) => {
      if (active) setState({ key: sessionKey, capabilities: result });
    }).catch(() => {
      if (active) setState({ key: sessionKey, capabilities: unavailableCapabilities });
    });
    return () => { active = false; };
  }, [accountSession?.sessionId, endpoint, refreshSession, sessionKey, transport]);

  const capabilities = !invalidated.current && state.key === sessionKey ? state.capabilities : unavailableCapabilities;
  return useMemo(() => ({
    ...capabilities,
    invalidate,
    refresh,
    setMultimodalVisualizationCapability
  }), [capabilities, invalidate, refresh, setMultimodalVisualizationCapability]);
}
