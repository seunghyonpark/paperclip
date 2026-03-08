/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DISABLE_LIVE_UPDATES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
