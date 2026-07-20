/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LITEASY_DEV_CLOUD_PORT?: string;
  readonly VITE_LITEASY_OPENAI_MODEL?: string;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}
