# site/ – landing page

Static English landing page (plain HTML + CSS, no JS, no build). Plan: `../LANDING-PLAN.md`.

```
index.html      page (lang="en"), SEO meta, Open Graph, JSON-LD
styles.css      colour tokens (from web/src/style/palette.ts) + layout
logo.svg        8-bit capercaillie, generated
favicon.svg     same file
robots.txt, sitemap.xml
img/            map screenshots (Phase 3): dahn, calmont, schwarzwald, feldberg, gpx, print
                (each .jpg and @2x.jpg) and og-image.jpg
scripts/logo.ts generates logo.svg and favicon.svg from a pixel matrix
```

## Logo

Edit `MATRIX` in `scripts/logo.ts` (24 x 24, one character per pixel, `.` = empty) and run
`bun run logo`. One `<path>` per colour, `shape-rendering="crispEdges"`. Legend: `K` body `#1f1f1f`,
`T` tail feathers `#3a3a3a`, `B` wing `#6e5a46`, `G` breast sheen `#3c7d3f`, `R` eye comb `#be2230`,
`W` beak / white patches `#eeebc6`.

## Placeholders

Every image sits in a `.shot` figure with `--forest-light` background and 3:2 aspect ratio. The
`<img>` already points at its final file name and is absolutely positioned inside the figure. While
the file is missing, the img has `color: transparent; font-size: 0` (alt text invisible) and an
`img::after` pseudo-element painted in the placeholder colour covers the broken-image icon
(Chrome and Firefox render pseudo-elements on broken images; loaded images do not). The alt text stays
available for screen readers. Once the files exist, nothing in the HTML needs to change.

## Deployment assumptions

- Landing page served at `/`, the built app at `/app/`; all CTAs link to `/app/`.
- Domain is open: `https://example.org/` in `canonical`, `og:*`, `twitter:image`, JSON-LD,
  `robots.txt` and `sitemap.xml` (search for `TODO: domain`).
