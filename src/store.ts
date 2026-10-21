import type { StoreStation } from './types';

export interface Category {
  id: string;
  label: string;
}

// --- Genres: Zuordnung über die Tags der Radio-Browser-Datenbank ---------------

export const GENRES: (Category & { keywords: string[] })[] = [
  { id: 'pop', label: 'Pop & Charts', keywords: ['pop', 'charts', 'top 40', 'top40', 'hits'] },
  { id: 'rock', label: 'Rock & Alternative', keywords: ['rock', 'alternative', 'indie', 'metal', 'punk'] },
  { id: 'dance', label: 'Dance & House', keywords: ['dance', 'house', 'edm', 'club', 'trance', 'party'] },
  { id: 'electronic', label: 'Electronic & Techno', keywords: ['electronic', 'electro', 'techno', 'minimal', 'drum and bass'] },
  { id: 'chill', label: 'Chillout & Lounge', keywords: ['chill', 'lounge', 'ambient', 'relax', 'downtempo', 'easy listening'] },
  { id: 'hiphop', label: 'Hip-Hop & R&B', keywords: ['hip hop', 'hiphop', 'hip-hop', 'rap', 'rnb', 'r&b', 'urban', 'black'] },
  { id: 'decades', label: '70er, 80er, 90er', keywords: ['70s', '80s', '90s', '70er', '80er', '90er', '2000s', '00s'] },
  { id: 'oldies', label: 'Oldies & Classic Hits', keywords: ['oldie', 'classic hits', 'classic rock', '60s', '50s'] },
  { id: 'schlager', label: 'Schlager & Volksmusik', keywords: ['schlager', 'volksmusik', 'deutsch', 'german'] },
  { id: 'jazz', label: 'Jazz, Soul & Blues', keywords: ['jazz', 'soul', 'blues', 'funk', 'swing'] },
  { id: 'classical', label: 'Klassik', keywords: ['classical', 'klassik', 'classic', 'opera', 'oper', 'orchestra'] },
  { id: 'news', label: 'Nachrichten & Talk', keywords: ['news', 'talk', 'information', 'nachrichten', 'kultur', 'culture', 'politik'] },
  { id: 'local', label: 'Lokal & Regional', keywords: ['local', 'lokal', 'regional', 'lokalradio'] },
];

/** Suchwort für die weltweite Server-Suche nach Genre */
export const GENRE_SERVER_TAG: Record<string, string> = {
  pop: 'pop',
  rock: 'rock',
  dance: 'dance',
  electronic: 'electronic',
  chill: 'chillout',
  hiphop: 'hip hop',
  decades: '80s',
  oldies: 'oldies',
  schlager: 'schlager',
  jazz: 'jazz',
  classical: 'classical',
  news: 'news',
  local: 'local',
};

export function matchesGenre(station: StoreStation, genreId: string) {
  const genre = GENRES.find((g) => g.id === genreId);
  if (!genre) return false;
  return station.tags.some((tag) => genre.keywords.some((k) => tag.includes(k)));
}

/**
 * Sortierhilfe innerhalb eines Genres: Sender, bei denen das Genre zu den ersten Tags gehört,
 * kommen nach vorn; Sender, die Dutzende Schlagwörter aufzählen, nach hinten.
 */
export function genreRank(station: StoreStation, genreId: string) {
  const genre = GENRES.find((g) => g.id === genreId);
  if (!genre) return 0;
  const index = station.tags.findIndex((tag) => genre.keywords.some((k) => tag.includes(k)));
  const primary = index >= 0 && index < 3 ? 0 : 1;
  const spammy = station.tags.length > 12 || station.name.length > 60 ? 2 : 0;
  return primary + spammy;
}

// --- Betreiber: Zuordnung über die Domain von Stream bzw. Webseite --------------

export const OPERATORS: (Category & { domains: string[]; names?: RegExp })[] = [
  {
    id: 'ard',
    label: 'ARD',
    domains: [
      'wdr.de', 'swr.de', 'swr3.de', 'ndr.de', 'br.de', 'br-klassik.de', 'bayern3.de', 'hr.de', 'hr-online.de',
      'hr3.de', 'youfm.de', 'mdr.de', 'jumpradio.de', 'sputnik.de', 'rbb-online.de', 'rbb24.de', 'radioeins.de',
      'fritz.de', 'radiodrei.de', 'antennebrandenburg.de', 'sr.de', 'sr-online.de', 'radiobremen.de',
      'bremeneins.de', 'bremenvier.de', 'bremenzwei.de', 'einslive.de', 'dasding.de', 'n-joy.de', 'ndr2.de',
      'rndfnk.com', 'ard.de', 'ardaudiothek.de', 'cosmo.de',
    ],
    names: /\b(wdr ?\d|1live|swr ?\d|ndr ?\d|n-joy|bayern ?\d|br-klassik|hr\d|you fm|mdr|jump|sputnik|rbb|radioeins|fritz|dasding|cosmo|bremen (eins|vier|zwei|next))\b/i,
  },
  {
    id: 'dlr',
    label: 'Deutschlandradio',
    domains: ['dlf.de', 'deutschlandfunk.de', 'deutschlandradio.de', 'deutschlandfunkkultur.de', 'deutschlandfunknova.de', 'dradio.de'],
    names: /deutschlandfunk|\bdlf\b/i,
  },
  { id: 'antenne', label: 'Antenne Bayern Gruppe', domains: ['antenne.de', 'rockantenne.de', 'chillout.de', 'oldie-antenne.de'] },
  { id: 'absolut', label: 'Absolut Radio', domains: ['absolutradio.de', 'antenne-deutschland.de'] },
  { id: 'regiocast', label: 'Regiocast (80s80s, 90s90s, Bob …)', domains: ['80s80s.de', '90s90s.de', 'radiobob.de', 'regiocast.de', 'radiopsr.de', 'rsa-sachsen.de', 'r-sa.de', 'deinradio.de'] },
  { id: 'sunshine', label: 'sunshine live', domains: ['sunshine-live.de'] },
  { id: 'bigfm', label: 'bigFM', domains: ['bigfm.de'] },
  { id: 'ffh', label: 'Hit Radio FFH', domains: ['ffh.de', 'planetradio.de', 'harmonyfm.de'] },
  { id: 'ffn', label: 'radio ffn', domains: ['ffn.de'] },
  { id: 'rpr', label: 'RPR1', domains: ['rpr1.de'] },
  { id: 'rtl', label: 'RTL Radio', domains: ['0rtl.de', '6rtl.com', 'rtlradio.de', '104.6rtl.com'] },
  { id: 'energy', label: 'ENERGY', domains: ['energy.de', 'nrj.de'] },
  { id: 'regenbogen', label: 'Radio Regenbogen', domains: ['regenbogen.de'] },
  { id: 'klassik', label: 'Klassik Radio', domains: ['klassikradio.de'] },
  { id: 'nrw', label: 'NRW-Lokalradios', domains: ['lokalradio.nrw', 'radionrw.de'] },
  { id: 'fluxfm', label: 'FluxFM', domains: ['fluxfm.de'] },
  { id: 'rautemusik', label: 'RauteMusik', domains: ['rautemusik.fm'] },
  { id: 'technobase', label: 'TechnoBase.FM & Co.', domains: ['technobase.fm', 'housetime.fm', 'hardbase.fm', 'trancebase.fm', 'technolovers.fm'] },
  { id: 'onefm', label: '1.FM', domains: ['1.fm', '1cloud.fm'] },
  { id: 'jamfm', label: 'JAM FM', domains: ['jam.fm'] },
  { id: 'lautfm', label: 'laut.fm (Community)', domains: ['laut.fm'] },
];

function hostOf(url: string | null) {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const operatorCache = new Map<string, string | null>();

/** Betreiber eines Senders (oder null, wenn keiner der bekannten passt). */
export function operatorOf(station: StoreStation): string | null {
  const cached = operatorCache.get(station.id);
  if (cached !== undefined) return cached;
  const hosts = [hostOf(station.url), hostOf(station.homepage)].filter(Boolean);
  let found: string | null = null;
  for (const op of OPERATORS) {
    const byDomain = hosts.some((h) => op.domains.some((d) => h === d || h.endsWith(`.${d}`)));
    if (byDomain || op.names?.test(station.name)) {
      found = op.id;
      break;
    }
  }
  operatorCache.set(station.id, found);
  return found;
}

export function operatorLabel(id: string | null) {
  return OPERATORS.find((o) => o.id === id)?.label ?? null;
}

// --- Aufbereitung ---------------------------------------------------------------

/** "Deutschlandfunk | DLF | MP3 128k" -> "Deutschlandfunk | DLF" (Codec-Angaben entfernen) */
export function cleanName(name: string) {
  return name
    .replace(/\s*[|(\-–]\s*(mp3|aac\+?|opus|ogg|flac|hd)\b[^|)]*\)?\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Anzeigename: Codec-Angaben weg und überlange Schlagwort-Namen
 * ("# TOP 100 CLUB CHARTS - DANCE & DJ MIX RADIO - 24 HOURS ... @ TikTok Hits, ...") kürzen.
 */
export function displayName(name: string) {
  let result = cleanName(name).replace(/^[#_\s-]+|[_\s-]+$/g, '');
  if (result.length > 42) {
    const cut = result.search(/\s(@|-|–|\||\()\s?|,/);
    if (cut >= 3) result = result.slice(0, cut).trim();
  }
  return result.length > 60 ? `${result.slice(0, 57).trim()} …` : result;
}

/** Doppelte Einträge (gleicher Sender in mehreren Qualitäten) zusammenfassen – der meistgehörte gewinnt. */
export function dedupe(stations: StoreStation[]) {
  const seen = new Set<string>();
  const result: StoreStation[] = [];
  for (const station of stations) {
    const key = cleanName(station.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(station);
  }
  return result;
}

/** Freitextsuche über Name, Tags und Betreiber */
export function matchesQuery(station: StoreStation, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [station.name, station.tags.join(' '), operatorLabel(operatorOf(station)) ?? '']
    .join(' ')
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function normalizeUrl(url: string) {
  return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}
