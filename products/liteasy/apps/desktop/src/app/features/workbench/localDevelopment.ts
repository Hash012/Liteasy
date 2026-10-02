/** Offline browser boundary for explicit development and validated recovery profiles. */
export function initializeLocalDevelopment() {
  localStorage.setItem("liteasy.account.suppress-login-reminder.v1", "true");
  localStorage.setItem("liteasy.local-literature.v1", JSON.stringify({ "papers.local_mode": true, "profile.local_enabled": false }));
  const fetchOriginal = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.href);
    if (url.origin !== location.origin && !["blob:", "data:", "ipc:", "asset:"].includes(url.protocol) && !["ipc.localhost", "asset.localhost"].includes(url.hostname)) {
      return Promise.reject(new Error("local_development_network_disabled"));
    }
    return fetchOriginal(input, init);
  };
}
