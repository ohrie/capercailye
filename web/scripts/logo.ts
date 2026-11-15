// Generates logo.svg and favicon.svg from a pixel matrix (8-bit capercaillie, male, displaying).
// Edit MATRIX, then run `bun run logo`. One character per pixel, `.` = empty.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const COLORS: Record<string, string> = {
  K: "#1f1f1f", // body (ink)
  T: "#3a3a3a", // tail feathers, plumage drawing
  B: "#6e5a46", // wing brown
  G: "#3c7d3f", // breast sheen (forest)
  R: "#be2230", // eye comb (trail red, the brand anchor)
  W: "#eeebc6", // beak, white shoulder patch, white undertail
};

const MATRIX = [
  "........................",
  "........................",
  "................TK......",
  "....KKK......TK.TK......",
  "...KRRKK.....TK.TK..TK..",
  ".WWKKKKK...K.TK.TK.TTK..",
  ".WWKKKK....K.TK.TK.TK..T",
  "...KKKK...TTKTK.TKTTK.TK",
  "...KKKK....TKTK.TKTK.TK.",
  "..KKKKK....TKTTTTKTKTTK.",
  ".KKGKKKK....TKTTKTKTTK.T",
  ".KGGGKKKK...TKTTKTTTKTTT",
  ".GGGGGKKKKKKKTKKTKTKTTKK",
  "..GGGGKKKKKKKKKKKKTTTKTT",
  "...GGKKKKKWWBBKKKKKTTTTK",
  "....KKKKKKWBBBBBKKKKKKK.",
  ".....KKKKKKKBBBBBKKWW...",
  "......KKKKKKKBBBKKWWW...",
  ".......KKKKKKKKKKKWW....",
  ".........KK..KK.........",
  ".........T...T..........",
  ".........T..TT..........",
  ".......TTT..TTT.........",
  "........................",
];

const SIZE = 24;

export function buildSvg(matrix: string[]): string {
  if (matrix.length !== SIZE) throw new Error(`matrix needs ${SIZE} rows, has ${matrix.length}`);
  const rects: Record<string, string[]> = {};
  matrix.forEach((row, y) => {
    if (row.length !== SIZE) throw new Error(`row ${y} needs ${SIZE} columns, has ${row.length}`);
    let x = 0;
    while (x < SIZE) {
      const c = row[x]!;
      if (c === ".") {
        x++;
        continue;
      }
      if (!COLORS[c]) throw new Error(`unknown colour '${c}' in row ${y}`);
      let w = 1;
      while (x + w < SIZE && row[x + w] === c) w++;
      (rects[c] ??= []).push(`M${x} ${y}h${w}v1h-${w}z`);
      x += w;
    }
  });
  const paths = Object.entries(rects)
    .map(([c, d]) => `<path fill="${COLORS[c]}" d="${d.join("")}"/>`)
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges">\n  ${paths}\n</svg>\n`;
}

const here = dirname(fileURLToPath(import.meta.url));
const svg = buildSvg(MATRIX);
// public/app/logo.svg is the app's favicon (/app/logo.svg), a copy of the same file.
for (const file of ["logo.svg", "favicon.svg", join("app", "logo.svg")]) {
  writeFileSync(join(here, "..", "public", file), svg);
}
console.log("wrote public/logo.svg, public/favicon.svg and public/app/logo.svg");
