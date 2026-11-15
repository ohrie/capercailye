// Paraglide compiler options, shared by the Vite plugin (astro.config.mjs) and the standalone
// compile step (scripts/i18n-compile.ts), so both produce the same code in src/paraglide/.
export const paraglideOptions = {
  project: "./project.inlang",
  outdir: "./src/paraglide",
  // The generated .js has no types of its own; tsc --noEmit needs the declarations.
  emitTsDeclarations: true,
  // Landing page: every message call passes its locale explicitly at build time, so no strategy
  // is involved. App: the only client strategy is "custom-appLanguage", defined in src/i18n.ts
  // (?lang=, then navigator.languages). On the server it falls through to baseLocale (en).
  // No cookie and no localStorage strategy: the language is never stored.
  strategy: ["custom-appLanguage", "baseLocale"],
};
