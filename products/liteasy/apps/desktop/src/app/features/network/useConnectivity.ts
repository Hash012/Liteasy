import { useEffect, useState } from "react";

function readOnlineState() {
  if (typeof window === "undefined" || typeof window.navigator === "undefined") {
    return true;
  }

  return window.navigator.onLine;
}

export function useConnectivity() {
  const [isOnline, setIsOnline] = useState(readOnlineState);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return {
    isOnline
  };
}
