/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** PMTiles file relative to the app base (`/app/`), e.g. `data/capercailye-de.pmtiles` (build time). */
  readonly VITE_PMTILES_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
