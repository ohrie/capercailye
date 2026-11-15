// Sample sheet of waymark signs for visual checks (not part of the app bundle).
//
//   bun src/osmc/sample-sheet.ts <osmc-count.tsv> <out-dir> [count=60]
//
// Reads the frequency list (tab-separated: count, share %, cumulative %, value; "#" lines are
// comments), writes <out-dir>/waymarks.html with the most frequent values plus edge cases, fallback
// signs and combined images, and renders it to <out-dir>/waymarks.png with headless Chrome.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { osmcToSvg, parseOsmc, waymarkSvg, type WaymarkEntry } from "./index";

const [tsv, outDir, countArg] = process.argv.slice(2);
if (!tsv || !outDir) {
  console.error("Usage: bun src/osmc/sample-sheet.ts <osmc-count.tsv> <out-dir> [count]");
  process.exit(1);
}
const count = Number(countArg ?? 60);
const rows = readFileSync(tsv, "utf8")
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("\t"))
  .slice(0, count)
  .map(([n, share, , value]) => ({ n: Number(n), share: Number(share), value: value! }));

const ZOOM = 5; // screen px per CSS px of the print size
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function cell(
  img: { svg: string; width: number; height: number } | undefined,
  label: string,
  note = "",
): string {
  const pic = img
    ? `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(img.svg)}" width="${img.width * ZOOM}" height="${img.height * ZOOM}">` +
      `<img class="real" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(img.svg)}" width="${img.width}" height="${img.height}">`
    : `<div class="none">—</div>`;
  return `<figure>${pic}<figcaption>${esc(label)}${note ? `<br><small>${esc(note)}</small>` : ""}</figcaption></figure>`;
}

const edge = [
  "yellow::yellow_diamond",
  "black::white_diamond:HII:black",
  "white:white_circle::S3:white",
  "yellow:yellow_circle::2:yellow",
  "green:green_circlce:white_dot:green_triangle",
  "orange:orange:red_right:white_backslash",
  "blue:blue_diamond_line:grey_diamond:m:green",
  "red:white:red_triangle_turned:WWW:black",
  "green:white:Waldachtaler Heimatweg:green",
  "red:white:<",
  "black:white:tower",
  "blue:blue_round:white_hiker",
  "red:red_diamond::1:white",
  "white:white:white_bar:W:blue",
  "black:black:red_bowl:SG:white",
  "green:green_frame:red_arrow",
  "red:white:red_diamond:/:white",
  "blue:white:blue_wheelchair",
  "red:white:red_heart",
  "black:white:black_wolfshook",
  "yellow:white:yellow_shell_modern",
  "blue:white:blue_bicycle",
  "red:white:red_wheel",
  "green:white:green_hexagon:BEA:white",
  "black:white:black_crest",
  "blue:white:blue_lower:MD:black",
  "red:white:red_L",
  "blue:white:blue_turned_T",
  "red:white:red_fork",
  "red:yellow:white_diamond:black_diamond_right",
];

const fallback: [WaymarkEntry[], string][] = [
  [[{ ref: "HW3", colour: "red" }], "ref+colour red"],
  [[{ ref: "E1", colour: "yellow" }], "ref+colour yellow"],
  [[{ ref: "12" }], "ref"],
  [[{ name: "Rundweg Hohenzollern" }], "name"],
  [[{ osmc: "green", ref: "G2" }], "unreadable → ref + waycolor"],
  [
    [
      { osmc: "yellow:white:yellow_diamond" },
      { osmc: "blue:white:blue_diamond" },
      { osmc: "red:white:red_diamond:W:blue" },
      { ref: "HW1", colour: "red" },
    ],
    "combined (4)",
  ],
  [
    [
      { osmc: "yellow:white:yellow_diamond" },
      { osmc: "yellow:white:yellow_diamond" },
      { ref: "7" },
      { ref: "7" },
    ],
    "combined with duplicates",
  ],
];

const parts: string[] = [];
parts.push(`<h2>Most frequent ${rows.length} values in BW</h2><div class="grid">`);
for (const r of rows) {
  const p = parseOsmc(r.value);
  parts.push(
    cell(
      osmcToSvg(r.value),
      r.value,
      `${r.n} (${r.share.toFixed(2)} %)${p.issues.length ? " ⚠ " + p.issues.join("; ") : ""}`,
    ),
  );
}
parts.push(`</div><h2>Special cases</h2><div class="grid">`);
for (const v of edge) {
  const p = parseOsmc(v);
  parts.push(cell(osmcToSvg(v), v, p.issues.join("; ")));
}
parts.push(`</div><h2>Fallback and combination</h2><div class="grid">`);
for (const [entries, label] of fallback) parts.push(cell(waymarkSvg(entries), label));
parts.push(`</div>`);

const html = `<!doctype html><meta charset="utf-8"><title>Waymarks</title><style>
body{font:12px sans-serif;margin:16px;background:#c3dda2}
.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
figure{margin:0;background:#edf4da;padding:6px;display:flex;flex-direction:column;align-items:center;gap:4px}
figcaption{font:11px monospace;text-align:center;word-break:break-all}
img.real{image-rendering:auto}
.none{font-size:30px;color:#888}
h2{margin:18px 0 8px}
</style>${parts.join("\n")}`;

mkdirSync(outDir, { recursive: true });
const htmlPath = join(outDir, "waymarks.html");
writeFileSync(htmlPath, html);
const pngPath = join(outDir, "waymarks.png");
const chrome = Bun.spawnSync([
  "google-chrome-stable",
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--screenshot=${pngPath}`,
  "--window-size=1400,4200",
  `file://${htmlPath}`,
]);
if (chrome.exitCode !== 0) console.error(new TextDecoder().decode(chrome.stderr));
console.log(`${htmlPath}\n${pngPath}`);
