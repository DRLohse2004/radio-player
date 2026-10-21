import { api } from './api';

const MIN_SIZE = 64;
const MAX_ASPECT = 1.6;

/** Lädt ein Bild probeweise und gibt seine Größe zurück (null bei Fehler/Timeout). */
function probeImage(url: string, timeoutMs = 6000): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => done(null), timeoutMs);
    function done(result: { width: number; height: number } | null) {
      window.clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(result);
    }
    img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => done(null);
    img.src = url;
  });
}

function isUsable(url: string, size: { width: number; height: number }) {
  // SVGs ohne feste Größe melden 0 – die skalieren ohnehin beliebig
  if (/\.svg(\?|$)/i.test(url) && size.width === 0) return true;
  const { width, height } = size;
  return (
    width >= MIN_SIZE && height >= MIN_SIZE && width / height <= MAX_ASPECT && height / width <= MAX_ASPECT
  );
}

/** Sucht ein brauchbares Senderlogo (groß genug, annähernd quadratisch). */
export async function findStationLogo(name: string, url: string): Promise<string | null> {
  let candidates: string[] = [];
  try {
    candidates = await api.lookupLogos(name, url);
  } catch {
    return null;
  }
  for (const candidate of candidates) {
    const size = await probeImage(candidate);
    if (size && isUsable(candidate, size)) return candidate;
  }
  return null;
}
