// Icon system entry point: registers the POI provider ("poi:<name>") and re-exports the runtime.
import { POI_ICONS, poiIconSvg } from "./registry";
import { registerImageProvider } from "./runtime";

export { installIcons, preloadImages, registerImageProvider, type ImageProvider } from "./runtime";

export const POI_IMAGE_PREFIX = "poi";

registerImageProvider(POI_IMAGE_PREFIX, poiIconSvg);

/** All POI image ids (for warm-up). */
export const POI_IMAGE_IDS: readonly string[] = Object.keys(POI_ICONS).map(
  (name) => `${POI_IMAGE_PREFIX}:${name}`,
);
