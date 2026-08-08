export type AdminRuntimeConfig = {
  cloudUrl: string;
  forumUrl: string;
};

function endpoint(value: string, name: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name}_invalid`);
  }
  const loopback = parsed.protocol === "http:" &&
    new Set(["127.0.0.1", "[::1]", "localhost"]).has(parsed.hostname);
  if (
    parsed.username || parsed.password || parsed.search || parsed.hash ||
    (parsed.protocol !== "https:" && !(import.meta.env.DEV && loopback))
  ) {
    throw new Error(`${name}_invalid`);
  }
  return parsed.toString().replace(/\/$/, "");
}

export function loadAdminRuntimeConfig(): AdminRuntimeConfig {
  const defaultCloud = import.meta.env.DEV ? "http://127.0.0.1:8787" : window.location.origin;
  return {
    cloudUrl: endpoint(import.meta.env.VITE_LITEASY_CLOUD_URL ?? defaultCloud, "admin_cloud_url"),
    forumUrl: endpoint(import.meta.env.VITE_INTUECHO_API_URL ?? defaultCloud, "admin_forum_url")
  };
}
