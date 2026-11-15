import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import { paraglideOptions } from "./paraglide.config.mjs";
import { serveData } from "./vite-plugin-serve-data.ts";

// CAPERCAILYE_DATA (data directory served under /app/data/): process environment or .env.local.
const env = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");

export default defineConfig({
  // The site lives at the root; the map app is the page /app/ (src/pages/app/).
  base: "/",
  // /impressum/ etc. are built as directory/index.html.
  trailingSlash: "ignore",
  build: { format: "directory" },
  // Landing page in two languages: / (en, the default, no prefix) and /de/. The legal pages and the
  // app exist once, under their own URLs (no /de/impressum/ etc.): there are no pages for them in
  // pages/de/, and the "de" locale only claims the /de/ prefix. Paraglide's texts have their own
  // locale list (project.inlang/settings.json); keep both in step.
  i18n: { locales: ["en", "de"], defaultLocale: "en", routing: { prefixDefaultLocale: false } },
  server: { port: 5173 },
  devToolbar: { enabled: false },
  vite: {
    // Astro only exposes PUBLIC_*; the app reads VITE_PMTILES_PATH (src/config.ts).
    envPrefix: ["PUBLIC_", "VITE_"],
    plugins: [
      // Compiles messages/*.json into src/paraglide/ at every dev start and build (also see
      // scripts/i18n-compile.ts, which tsc and bun test rely on).
      paraglideVitePlugin({ ...paraglideOptions, isServer: "import.meta.env.SSR" }),
      serveData({ dir: env.CAPERCAILYE_DATA || undefined }),
    ],
    // Pre-bundle up front so the first page load does not trigger a dependency reload.
    optimizeDeps: {
      include: ["maplibre-gl", "pmtiles", "jspdf", "@tmcw/togeojson", "cupertino-pane"],
    },
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 2000,
      // Licence notices of all bundled third-party code (BSD/MIT/ISC/Apache/MPL require them with
      // binary redistribution). Linked from the sources page (src/pages/quellen/); served at
      // /app/third-party-licenses.txt.
      license: { fileName: "app/third-party-licenses.txt" },
    },
  },
});
