import { defineConfig } from "vite";
import { serveData } from "./vite-plugin-serve-data.ts";

export default defineConfig({
  // URL prefix of the deployed app, e.g. VITE_BASE=/app/ (with leading and trailing slash).
  base: process.env.VITE_BASE ?? "/",
  plugins: [serveData()],
  server: { port: 5173 },
  // Pre-bundle up front so the first page load does not trigger a dependency reload.
  optimizeDeps: { include: ["maplibre-gl", "pmtiles", "jspdf", "@tmcw/togeojson"] },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
