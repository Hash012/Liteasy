import { useEffect, useState } from "react";

type UseCloudAvailabilityProbeInput = {
  enabled: boolean;
  endpoint: string;
};

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

export function useCloudAvailabilityProbe({
  enabled,
  endpoint
}: UseCloudAvailabilityProbeInput) {
  const [isCloudReachable, setIsCloudReachable] = useState(true);

  useEffect(() => {
    if (!enabled) {
      setIsCloudReachable(false);
      return;
    }

    if (isMockEndpoint(endpoint)) {
      setIsCloudReachable(true);
      return;
    }

    let active = true;

    void fetch(`${endpoint.replace(/\/+$/, "")}/healthz`)
      .then((response) => {
        if (!active) {
          return;
        }

        setIsCloudReachable(response.ok);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setIsCloudReachable(false);
      });

    return () => {
      active = false;
    };
  }, [enabled, endpoint]);

  return {
    isCloudReachable
  };
}
