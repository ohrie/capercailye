// Renders the landing-page images from the running web app (see SPEC.md, section 4.9).
//
//   bun scripts/snapshots.ts [name ...] [--rp http://localhost:5180] [--bw http://localhost:5181]
//
// Needs two dev servers (from web/): `bunx vite --port 5180` for the Rhineland-Palatinate data and a
// second one on 5181 whose CAPERCAILYE_DATA directory has `capercailye-rp.pmtiles` symlinked to the
// Baden-Württemberg file (the app always loads that name), see README.md. Without names, all images
// are rendered. Output goes to ../img as JPEG (@1x and @2x; the OG image only @1x).
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "img");
// @2x is lower: the pixel density hides the artefacts, and it keeps img/ under about 6 MB.
const QUALITY = { 1: 80, 2: 62 } as const;

type Region = "rp" | "bw";

interface Shot {
  name: string;
  region: Region;
  center: [number, number];
  zoom: number;
  width?: number;
  height?: number;
  /**
   * Renders a viewport this many times larger at a device scale factor divided by it, so the
   * image shows more map at the same pixel size (print view: the zoom is fixed by the scale).
   */
  zoomOut?: number;
  /** Only @1x (OG image). */
  single?: boolean;
  /** Extra preparation after the camera is set (GPX, print view). */
  prepare?: (page: Page) => Promise<void>;
}

const DAHN: [number, number] = [7.767, 49.1495];
const FELDBERG: [number, number] = [8.004, 47.874];
// Around scripts/sample-dahn.gpx (a ~7 km stretch of marked trails north-east of Dahn).
const GPX_CENTER: [number, number] = [7.79, 49.154];
const GPX_ZOOM = 13.4;

const SHOTS: Shot[] = [
  { name: "dahn", region: "rp", center: DAHN, zoom: 14 },
  { name: "calmont", region: "rp", center: [7.115, 50.103], zoom: 14 },
  { name: "schwarzwald", region: "bw", center: [8.2, 48.25], zoom: 7.7 },
  { name: "feldberg", region: "bw", center: FELDBERG, zoom: 14 },
  {
    name: "gpx",
    region: "rp",
    center: GPX_CENTER,
    zoom: GPX_ZOOM,
    prepare: async (page) => {
      const gpx = readFileSync(join(HERE, "sample-dahn.gpx"), "utf8");
      await page.evaluate(
        ([text, center, zoom]) => {
          const c = window.__capercailye;
          c.loadGpx(text as string);
          // Loading a track switches to the sheet view; the picture shows the plain map.
          c.setState({ mode: "explore" });
          // loadGpx fits the map to the track; put the camera back.
          c.map.jumpTo({ center: center as [number, number], zoom: zoom as number });
        },
        [gpx, GPX_CENTER, GPX_ZOOM] as const,
      );
    },
  },
  {
    name: "print",
    region: "bw",
    center: FELDBERG,
    zoom: 14,
    zoomOut: 1.5,
    prepare: async (page) => {
      // Two portrait sheets side by side at 1:25 000 around the Feldberg, in print view.
      await page.evaluate(
        ([lng, lat]) => {
          const c = window.__capercailye;
          const dLat = 3300 / 111320;
          const dLon = 4700 / (111320 * Math.cos((lat * Math.PI) / 180));
          c.setState({
            mode: "sheets",
            printView: true,
            print: {
              mode: "scale",
              scale: 25000,
              pages: 2,
              orientation: "portrait",
              area: { west: lng - dLon, east: lng + dLon, south: lat - dLat, north: lat + dLat },
            },
          });
          c.map.jumpTo({ center: [lng, lat] });
          const l = c.layout();
          console.log(`print layout: ${l.cols} x ${l.rows} sheets, zoom ${l.zoom.toFixed(2)}`);
        },
        FELDBERG,
      );
    },
  },
  {
    name: "og-image",
    region: "rp",
    center: DAHN,
    zoom: 14,
    height: 630,
    single: true,
  },
];

function parseArgs(): { names: string[]; base: Record<Region, string> } {
  const names: string[] = [];
  const base: Record<Region, string> = { rp: "http://localhost:5180", bw: "http://localhost:5181" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--rp") base.rp = argv[++i]!;
    else if (argv[i] === "--bw") base.bw = argv[++i]!;
    else names.push(argv[i]!);
  }
  for (const n of names) {
    if (!SHOTS.some((s) => s.name === n)) throw new Error(`Unknown image "${n}"`);
  }
  return { names, base };
}

/** Waits for `idle`, lets the symbol placement settle, then waits for `idle` again. */
async function settle(page: Page): Promise<void> {
  const idle = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const map = window.__capercailye.map;
          const t = setTimeout(() => reject(new Error("map did not become idle in 60 s")), 60_000);
          const done = () => {
            clearTimeout(t);
            resolve();
          };
          // Already idle? A fresh jumpTo has queued work, so wait for the next event either way.
          map.once("idle", done);
          map.triggerRepaint();
        }),
    );
  await idle();
  await page.waitForTimeout(1500);
  await idle();
}

async function render(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  shot: Shot,
  base: string,
  scale: 1 | 2,
): Promise<void> {
  const k = shot.zoomOut ?? 1;
  const width = (shot.width ?? 1200) * k;
  const height = (shot.height ?? 800) * k;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale / k,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`  page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.text().startsWith("print layout")) console.log(`  ${m.text()}`);
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__capercailye, null, { timeout: 60_000 });
  await page.click("#sidebar-collapse");
  await page.addStyleTag({
    content: ".maplibregl-control-container, #sidebar-expand { display: none !important }",
  });
  await page.evaluate(
    ([c, z]) => {
      window.__capercailye.map.resize();
      window.__capercailye.map.jumpTo({ center: c as [number, number], zoom: z as number });
    },
    [shot.center, shot.zoom] as const,
  );
  await shot.prepare?.(page);
  await settle(page);
  const file = join(OUT, scale === 1 ? `${shot.name}.jpg` : `${shot.name}@2x.jpg`);
  await page.locator("#map").screenshot({ path: file, type: "jpeg", quality: QUALITY[scale] });
  console.log(`  ${file} (${Math.round(statSync(file).size / 1024)} kB)`);
  await context.close();
}

const { names, base } = parseArgs();
const browser = await chromium.launch({
  executablePath: "/opt/google/chrome/chrome",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
try {
  for (const shot of SHOTS) {
    if (names.length && !names.includes(shot.name)) continue;
    console.log(shot.name);
    await render(browser, shot, base[shot.region], 1);
    if (!shot.single) await render(browser, shot, base[shot.region], 2);
  }
} finally {
  await browser.close();
}

declare global {
  interface Window {
    __capercailye: {
      map: {
        resize(): void;
        jumpTo(o: { center: [number, number]; zoom?: number }): void;
        once(type: "idle", cb: () => void): void;
        triggerRepaint(): void;
      };
      setState(patch: Record<string, unknown>): void;
      loadGpx(text: string): unknown;
      layout(): { cols: number; rows: number; zoom: number };
    };
  }
}
