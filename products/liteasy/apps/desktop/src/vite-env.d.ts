/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FORUM_API_URL?: string;
  readonly VITE_FORUM_WEB_URL?: string;
  readonly VITE_LITEASY_CLOUD_URL?: string;
  readonly VITE_LITEASY_DEV_CLOUD_PORT?: string;
  readonly VITE_LITEASY_OPENAI_MODEL?: string;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}
