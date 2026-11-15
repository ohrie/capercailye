# site/ – landing page

Static English landing page (plain HTML + CSS, two tiny scripts, no build). Spec: `../SPEC.md`, section 4.9.

```
index.html      page (lang="en"), SEO meta, Open Graph, JSON-LD
styles.css      colour tokens (from web/src/style/palette.ts) + layout
logo.svg        8-bit capercaillie, generated
favicon.svg     same file
robots.txt, sitemap.xml
img/            map screenshots (scripts/snapshots.ts): dahn, calmont, schwarzwald, feldberg, gpx, print
                (each .jpg and @2x.jpg) and og-image.jpg
scripts/logo.ts generates logo.svg and favicon.svg from a pixel matrix
scripts/snapshots.ts renders img/ from the running web app (needs two dev servers and a Chrome binary, see its header; `CHROME_PATH` sets the binary)
mail.js         assembles the contact address in the browser (Impressum, Datenschutz)
impressum/, datenschutz/   legal pages (German)
quellen/        sources and licences page (German; OSM, relief per state, bus stops, fonts, libraries); linked
                from the footer, the app sidebar and the map credits; noindex, not in the sitemap
```

## Logo

Edit `MATRIX` in `scripts/logo.ts` (24 x 24, one character per pixel, `.` = empty) and run
`bun run logo`. One `<path>` per colour, `shape-rendering="crispEdges"`. Legend: `K` body `#1f1f1f`,
`T` tail feathers `#3a3a3a`, `B` wing `#6e5a46`, `G` breast sheen `#3c7d3f`, `R` eye comb `#be2230`,
`W` beak / white patches `#eeebc6`.

## Image fallback

The gallery has a one-line image credit (OSM, relief, bus stops, link to `/quellen/`); keep it in step
with what the screenshots show.

Every image sits in a `.shot` figure with `--forest-light` background and 3:2 aspect ratio. The
`<img>` already points at its final file name and is absolutely positioned inside the figure. If
a file is missing, the img has `color: transparent; font-size: 0` (alt text invisible) and an
`img::after` pseudo-element painted in the placeholder colour covers the broken-image icon
(Chrome and Firefox render pseudo-elements on broken images; loaded images do not). The alt text stays
available for screen readers.

## Deployment assumptions

- Landing page served at `/`, the built app at `/app/`; all CTAs link to `/app/`.
- The domain is hardcoded in `canonical`, `og:*`, `twitter:image`, JSON-LD, `robots.txt` and
  `sitemap.xml`.
