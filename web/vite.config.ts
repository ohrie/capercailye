import { defineConfig, loadEnv } from "vite";
import { serveData } from "./vite-plugin-serve-data.ts";

export default defineConfig(({ mode }) => {
  // CAPERCAILYE_DATA (data directory served under <base>data/): process environment or .env.local.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    // URL prefix of the deployed app, e.g. VITE_BASE=/app/ (with leading and trailing slash).
    base: process.env.VITE_BASE ?? "/",
    plugins: [serveData({ dir: env.CAPERCAILYE_DATA || undefined })],
    server: { port: 5173 },
    // Pre-bundle up front so the first page load does not trigger a dependency reload.
    optimizeDeps: { include: ["maplibre-gl", "pmtiles", "jspdf", "@tmcw/togeojson"] },
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 2000,
      // Licence notices of all bundled third-party code (BSD/MIT/ISC/Apache/MPL require them with
      // binary redistribution). Linked from the sources page (site/quellen/).
      license: { fileName: "third-party-licenses.txt" },
    },
  };
});
