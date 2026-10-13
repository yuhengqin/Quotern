/// <reference types="vite/client" />

/** Injected at build time from package.json via Vite `define`. */
declare const __APP_VERSION__: string;

/** Static asset imports for icon files. */
declare module '*.ico' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  /** Optional HTTP API root; desktop normally uses the local IPC transport. */
  readonly VITE_API_BASE?: string;
  readonly VITE_API_BEARER?: string;
  /** Dev-only: force portable “available” update UI for style checks. */
  readonly VITE_MOCK_PORTABLE_UPDATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
