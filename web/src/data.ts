// Optional data files. MapLibre treats a vector source whose PMTiles file cannot be loaded as
// "never loaded": `idle` would not fire any more and the placement and the PDF export (both wait
// for it) would hang. Optional sources are therefore only added to the style when the file exists.

/** First bytes of every PMTiles archive. */
const PMTILES_MAGIC = "PMTiles";

/**
 * Whether `url` serves a PMTiles archive. A tiny range request (not HEAD: a single-page-app
 * server answers HEAD for a missing file with 200) that checks the magic bytes and aborts the
 * rest, so a server ignoring Range does not send the whole file.
 */
export async function pmtilesExists(url: string): Promise<boolean> {
  const abort = new AbortController();
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${PMTILES_MAGIC.length - 1}` },
      signal: abort.signal,
    });
    if (!res.ok || !res.body) return false;
    const reader = res.body.getReader();
    const chunk = await reader.read();
    const head = new TextDecoder().decode(chunk.value?.subarray(0, PMTILES_MAGIC.length));
    return head === PMTILES_MAGIC;
  } catch {
    return false;
  } finally {
    abort.abort();
  }
}
