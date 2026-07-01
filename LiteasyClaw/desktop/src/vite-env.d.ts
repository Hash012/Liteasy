/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LITEASY_DEV_CLOUD_PORT?: string;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}
