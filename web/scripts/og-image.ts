// Generates the Open Graph / social preview images (1200x630) from the Dahn map photo, the logo
// and a short text. Edit TEXT / VARIANTS / the CSS below, then run `bun run og` (all variants)
// or `bun run og light` (only the named ones).
// Needs Chrome/Chromium: CHROME_PATH (default /opt/google/chrome/chrome).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const TEXT = {
  name: "capercailye",
  slogan: "Drucke deine Wanderkarte",
  sub: "Kostenfrei. Auf DIN A4 Papier. Auf OpenStreetMap Basis",
};

// scrim = gradient laid over the map, text = text colour, sub = colour of the second line.
const VARIANTS: Record<
  string,
  { file: string; scrim: string; text: string; sub: string; sat: number }
> = {
  dark: {
    file: "og-image.jpg", // the one referenced by Landing.astro
    scrim: "rgba(14,30,18,.96) 0%, rgba(14,30,18,.9) 45%, rgba(14,30,18,.35) 100%",
    text: "#fff",
    sub: "#d9e6d4",
    sat: 0.8,
  },
  light: {
    file: "og-image-light.jpg",
    scrim: "rgba(255,255,255,.92) 0%, rgba(255,255,255,.82) 60%, rgba(255,255,255,.1) 100%",
    text: "#14281a",
    sub: "#33493a",
    sat: 1,
  },
};

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const dataUri = (file: string, mime: string) =>
  `data:${mime};base64,${readFileSync(join(pub, file)).toString("base64")}`;

const render = (v: (typeof VARIANTS)[string]) => `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; position: relative;
    font-family: system-ui, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif; }
  .map { position: absolute; inset: 0; background: url(${dataUri("img/dahn@2x.jpg", "image/jpeg")})
    center 40% / cover; filter: saturate(${v.sat}); }
  /* dark forest scrim: strong behind the text on the left, lighter on the right so the map shows */
  .scrim { position: absolute; inset: 0;
    background: linear-gradient(100deg, ${v.scrim}); }
  .content { position: absolute; left: 80px; top: 0; bottom: 0; width: 1040px;
    display: flex; flex-direction: column; justify-content: center; color: ${v.text}; }
  .brand { display: flex; align-items: center; gap: 28px; }
  .brand img { width: 128px; height: 128px; image-rendering: pixelated; background: #eeebc6;
    border-radius: 12px; padding: 10px; }
  .name { font-size: 76px; font-weight: 800; letter-spacing: -1px; }
  .slogan { margin-top: 44px; font-size: 68px; font-weight: 700; line-height: 1.1; }
  .sub { margin-top: 24px; font-size: 30px; line-height: 1.3; color: ${v.sub}; }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 12px; background: #be2230; }
</style>
<div class="map"></div><div class="scrim"></div>
<div class="content">
  <div class="brand"><img src="${dataUri("logo.svg", "image/svg+xml")}" alt=""><div class="name">${TEXT.name}</div></div>
  <div class="slogan">${TEXT.slogan}</div>
  <div class="sub">${TEXT.sub}</div>
</div>
<div class="bar"></div>`;

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(VARIANTS);
const unknown = names.filter((n) => !(n in VARIANTS));
if (unknown.length)
  throw new Error(
    `unknown variant: ${unknown.join(", ")} (have ${Object.keys(VARIANTS).join(", ")})`,
  );

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome",
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const name of names) {
  const v = VARIANTS[name]!;
  await page.setContent(render(v));
  await page.screenshot({ path: join(pub, "img", v.file), type: "jpeg", quality: 88 });
  console.log(`wrote public/img/${v.file}`);
}
await browser.close();
