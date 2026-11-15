// Runtime icon rasterisation for MapLibre (browser only).
//
// Icons are not taken from a pre-built sprite: the export map renders at a pixel ratio of up to
// 3.125, so every icon is rasterised from SVG at OVERSAMPLE x and added with that pixel ratio.
// Images are resolved on demand through MapLibre's missing-image resolver
// (Map#setMissingStyleImageResolver, MapLibre >= 6): the worker waits for the resolver's
// promise before it lays out a tile, so a map that reached `idle` with all tiles loaded has
// every icon it needs. That is what the PDF export relies on (print/render.ts waits for idle).
//
// Image ids are "<prefix>:<name>"; providers for a prefix return an SVG (see registry.ts).
// src/osmc registers "waymark" (single waymark signs) the same way.
import type { Map as MapLibreMap } from "maplibre-gl";
import type { SvgImage } from "./registry";

export type ImageProvider = (name: string) => SvgImage | undefined;

/** Raster oversampling; above the highest export pixel ratio (300 dpi / 96 = 3.125). */
export const OVERSAMPLE = 4;

const providers = new Map<string, ImageProvider>();
const rasterCache = new Map<string, Promise<ImageData | undefined>>();

/** Registers an SVG provider for image ids "<prefix>:<name>". */
export function registerImageProvider(prefix: string, provider: ImageProvider): void {
  if (prefix.includes(":")) throw new Error(`Image prefix must not contain a colon: ${prefix}`);
  providers.set(prefix, provider);
  for (const id of rasterCache.keys()) if (id.startsWith(`${prefix}:`)) rasterCache.delete(id);
}

/** Looks up the SVG for an image id, or undefined if no provider knows it. */
export function svgForImageId(id: string): SvgImage | undefined {
  const i = id.indexOf(":");
  if (i < 0) return undefined;
  return providers.get(id.slice(0, i))?.(id.slice(i + 1));
}

async function rasterise(image: SvgImage): Promise<ImageData> {
  const w = Math.max(1, Math.round(image.width * OVERSAMPLE));
  const h = Math.max(1, Math.round(image.height * OVERSAMPLE));
  // Explicit pixel size: some browsers rasterise SVGs without width/height at 150 x 150 / 0 x 0.
  const svg = image.svg.replace(/^<svg /, `<svg width="${w}" height="${h}" `);
  const img = new Image(w, h);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas not available");
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Rasterised image for an id (cached across maps), or undefined if unknown. */
export function rasterImage(id: string): Promise<ImageData | undefined> {
  let p = rasterCache.get(id);
  if (!p) {
    const svg = svgForImageId(id);
    p = svg ? rasterise(svg) : Promise.resolve(undefined);
    p.catch(() => rasterCache.delete(id));
    rasterCache.set(id, p);
  }
  return p;
}

function addRaster(map: MapLibreMap, id: string, data: ImageData): void {
  if (map.hasImage(id)) return;
  // Copy: MapLibre keeps the buffer, the cache is shared between the main and export maps.
  const copy = { width: data.width, height: data.height, data: new Uint8ClampedArray(data.data) };
  map.addImage(id, copy, { pixelRatio: OVERSAMPLE });
}

/**
 * Lets the map resolve "<prefix>:<name>" images from the registered providers.
 * Call right after `new Map(...)` (before the style has loaded tiles); survives setStyle.
 */
export function installIcons(map: MapLibreMap): void {
  map.setMissingStyleImageResolver(async (id) => {
    if (!svgForImageId(id)) return;
    try {
      const data = await rasterImage(id);
      if (data && map.style) addRaster(map, id, data);
    } catch (err) {
      console.warn(`Pictogram ${id} could not be created:`, err);
    }
  });
}

/** Rasterises the given ids in advance (optional warm-up, e.g. before an export). */
export async function preloadImages(ids: readonly string[]): Promise<void> {
  await Promise.allSettled(ids.map((id) => rasterImage(id)));
}
