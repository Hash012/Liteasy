/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INTUECHO_API_URL?: string;
  readonly VITE_LITEASY_CLOUD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
