let trustedRemoteProxyEndpoint: string | null = null;

function canonicalRemoteEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * Remote proxy trust is granted only by a successfully decoded control-plane
 * policy response. Mutable desktop settings alone cannot add an arbitrary
 * network destination to this session allowlist.
 */
export function trustModelProxyEndpointFromPolicy(endpoint: string) {
  trustedRemoteProxyEndpoint = canonicalRemoteEndpoint(endpoint);
}

export function isTrustedRemoteModelProxyEndpoint(endpoint: string) {
  const canonical = canonicalRemoteEndpoint(endpoint);
  return canonical !== null && canonical === trustedRemoteProxyEndpoint;
}

export function clearTrustedModelProxyEndpointsForTests() {
  trustedRemoteProxyEndpoint = null;
}
