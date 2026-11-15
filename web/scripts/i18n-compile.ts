// Compiles messages/*.json into src/paraglide/ (generated, not committed). Runs before the type
// check in `bun run build` and before `bun test` (bunfig.toml); `astro dev` and `astro build`
// regenerate it through the Vite plugin as well.
import { compile } from "@inlang/paraglide-js";
import { paraglideOptions } from "../paraglide.config.mjs";

await compile({
  ...paraglideOptions,
  project: new URL("../project.inlang", import.meta.url).pathname,
  outdir: new URL("../src/paraglide", import.meta.url).pathname,
});
