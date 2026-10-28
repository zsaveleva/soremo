/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAP_BASE?: 'vector' | 'raster';
}

interface ImportMetaEnv {
  /** '1' — статическая демо-версия без API (GitHub Pages). */
  readonly VITE_STATIC?: string;
}
