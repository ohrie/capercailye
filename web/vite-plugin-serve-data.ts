// Vite plugin: serves large local files (PMTiles) under a URL prefix with
// HTTP Range support, without copying them into the repository.
import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import type { Connect, Plugin } from "vite";

export interface ServeDataOptions {
  /** URL prefix, with leading and trailing slash. Defaults to `<base>data/` (Vite `base`). */
  prefix?: string;
  /** Directory on disk. Defaults to $CAPERCAILYE_DATA or ~/.local/share/capercailye. */
  dir?: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".pmtiles": "application/vnd.pmtiles",
  ".json": "application/json",
  ".pbf": "application/x-protobuf",
};

export function defaultDataDir(): string {
  return process.env.CAPERCAILYE_DATA ?? join(homedir(), ".local", "share", "capercailye");
}

/** Parses a single-range "bytes=" header. Returns null if unsatisfiable, undefined if absent/ignored. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | undefined {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Multi-range or malformed: ignore and serve the full body (allowed by RFC 9110).
  if (!m) return undefined;
  const [, a, b] = m;
  if (a === "" && b === "") return undefined;
  let start: number;
  let end: number;
  if (a === "") {
    // Suffix range: last N bytes.
    const n = Number(b);
    if (n === 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return null;
  return { start, end };
}

function handler(dir: string, prefix: string): Connect.NextHandleFunction {
  const root = resolve(dir);
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    if (!req.url || !req.url.startsWith(prefix)) return next();
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const rel = decodeURIComponent(req.url.slice(prefix.length).split("?")[0] ?? "");
    const file = resolve(root, rel);
    if (file !== root && !file.startsWith(root + sep)) {
      res.statusCode = 403;
      return res.end();
    }
    let size: number;
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error("not a file");
      size = st.size;
    } catch {
      res.statusCode = 404;
      return res.end(`Nicht gefunden: ${rel}`);
    }
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", CONTENT_TYPES[extname(file)] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    const range = parseRange(req.headers.range, size);
    if (range === null) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${size}`);
      return res.end();
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    res.statusCode = range ? 206 : 200;
    if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    if (req.method === "HEAD" || size === 0) return res.end();
    const stream = createReadStream(file, { start, end });
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  };
}

export function serveData(options: ServeDataOptions = {}): Plugin {
  const dir = options.dir ?? defaultDataDir();
  // The prefix follows Vite's `base` (e.g. VITE_BASE=/app/ serves the data under /app/data/).
  let base = "/";
  const prefix = () => options.prefix ?? `${base}data/`;
  return {
    name: "capercailye-serve-data",
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use(handler(dir, prefix()));
      server.config.logger.info(`  Daten: ${prefix()} -> ${dir}`);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler(dir, prefix()));
    },
  };
}
