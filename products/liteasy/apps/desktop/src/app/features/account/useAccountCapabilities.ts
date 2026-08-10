import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountSession } from "./account.types";
import {
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
  transport
}: {
  accountSession: AccountSession | null;
  endpoint: string;
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
    void loadAccountCapabilities({
      endpoint,
      sessionId: accountSession.sessionId,
      transport
    }).then((result) => {
      if (active) setState({ key: sessionKey, capabilities: result });
    }).catch(() => {
      if (active) setState({ key: sessionKey, capabilities: unavailableCapabilities });
    });
    return () => { active = false; };
  }, [accountSession?.sessionId, endpoint, sessionKey, transport]);

  const capabilities = !invalidated.current && state.key === sessionKey ? state.capabilities : unavailableCapabilities;
  return useMemo(() => ({
    ...capabilities,
    invalidate,
    refresh,
    setMultimodalVisualizationCapability
  }), [capabilities, invalidate, refresh, setMultimodalVisualizationCapability]);
}
