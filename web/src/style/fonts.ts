// Font stacks (public/fonts, Noto Sans, OFL 1.1) and the shared print halo.
import { COLORS } from "./palette";
import { mm } from "./units";

export const FONT_REGULAR = ["Noto Sans Regular"];
export const FONT_ITALIC = ["Noto Sans Italic"];
export const FONT_MEDIUM = ["Noto Sans Medium"];

/** White text halo, width in paper mm (MapLibre clamps halos to roughly a quarter of the size). */
export function halo(widthMm = 0.3) {
  return {
    "text-halo-color": COLORS.halo,
    "text-halo-width": mm(widthMm),
    "text-halo-blur": mm(0.05),
  } as const;
}
