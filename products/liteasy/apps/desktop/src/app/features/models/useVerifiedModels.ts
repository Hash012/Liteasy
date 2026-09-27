import { useCallback, useEffect, useRef, useState } from "react";
import { hasDirectModelKey } from "./directModelTransport";
import { directModelNeedsKey } from "./modelProviders";
import { loadVerifiedModelProfiles, verifiedModelProfilesEvent, verifiedModelProfilesKey, type VerifiedModelProfile } from "./verifiedModelProfiles";

export function useVerifiedModels() {
  const [profiles, setProfiles] = useState<VerifiedModelProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const request = ++generation.current;
    setLoading(true);
    const saved = loadVerifiedModelProfiles();
    void Promise.all(saved.map(async (profile) => {
      try { return !directModelNeedsKey(profile.config) || await hasDirectModelKey(profile.config) ? profile : null; }
      catch { return null; }
    })).then((available) => {
      if (generation.current !== request) return;
      setProfiles(available.filter((profile): profile is VerifiedModelProfile => profile !== null));
      setLoading(false);
    });
  }, []);
  useEffect(() => {
    refresh();
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === verifiedModelProfilesKey) refresh(); };
    window.addEventListener(verifiedModelProfilesEvent, refresh);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", refresh);
    return () => {
      generation.current += 1;
      window.removeEventListener(verifiedModelProfilesEvent, refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  return { profiles, loading, refresh };
}
