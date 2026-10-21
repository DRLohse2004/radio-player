import type { ContentKind, NowPlaying } from './types';

/** "JASON MRAZ" -> "Jason Mraz"; gemischte Schreibweise bleibt unverändert. */
export function tidyCase(text: string): string {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 3 || letters !== letters.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s\-([/&"])(\p{L})/gu, (_m, prefix: string, char: string) => prefix + char.toUpperCase());
}

// Eindeutige Begriffe gelten immer, mehrdeutige (englische Wörter, die auch in Songtiteln
// vorkommen wie "Good News") nur, wenn der Text nicht nach "Interpret - Titel" aussieht.
const STRONG_PATTERNS: [ContentKind, RegExp][] = [
  ['news', /nachrichten|schlagzeilen|tagesschau|newsflash|\bnews um\b/i],
  ['traffic', /verkehrs?(info|lage|meldung|service)|\bverkehr\b|\bstau(s|meldung)?\b|blitzer|wetterbericht|\bwetter\b/i],
  ['ad', /werbung|werbeblock|\banzeige\b|gewinnspiel|jetzt (anrufen|bestellen|buchen)|sponsored|präsentiert von/i],
  [
    'talk',
    /moderation|interview|hörertelefon|morgenshow|morningshow|hotline|whatsapp|www\.|https?:\/\/|\.(de|com|fm)\b|\d{4,}[\s/-]*\d+/i,
  ],
];
const WEAK_PATTERNS: [ContentKind, RegExp][] = [
  ['news', /\bnews\b/i],
  ['traffic', /\b(traffic|weather)\b/i],
  ['ad', /\b(spot|commercial|advert\w*|rabatt|angebot\w*)\b/i],
  ['talk', /\b(talk|podcast|sendung|studio|telefon|kontakt|comedy|show)\b/i],
];

function words(text: string) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** true, wenn alle Wörter des Sendernamens im Text vorkommen (Eigenwerbung, Slogan) */
function mentionsStation(text: string, stationNames: string[]) {
  const textWords = words(text);
  return stationNames.some((name) => {
    const nameWords = words(name);
    return nameWords.length > 0 && nameWords.every((w) => textWords.includes(w));
  });
}

/**
 * Zerlegt "Interpret - Titel" und schätzt, ob Musik läuft oder Nachrichten, Werbung usw.
 * Reiner Infotext oder Sendername ergibt artist/title = null.
 */
export function parseStreamTitle(raw: string, stationNames: string[]): NowPlaying {
  const text = raw.trim();
  const empty: NowPlaying = { raw: text, kind: 'program', artist: null, title: null, album: null, cover: null };
  if (!text) return empty;

  const lower = text.toLowerCase();
  if (stationNames.some((name) => name && name.toLowerCase() === lower)) return { ...empty, raw: '' };

  const separator = text.indexOf(' - ');
  const artist = separator > 0 ? text.slice(0, separator).trim() : '';
  const title = separator > 0 ? text.slice(separator + 3).trim() : '';
  const looksLikeSong = Boolean(artist && title);

  const strong = STRONG_PATTERNS.find(([, pattern]) => pattern.test(text));
  if (strong) return { ...empty, kind: strong[0] };
  if (!looksLikeSong) {
    const weak = WEAK_PATTERNS.find(([, pattern]) => pattern.test(text));
    return { ...empty, kind: weak ? weak[0] : 'program' };
  }
  if (mentionsStation(text, stationNames)) return { ...empty, kind: 'program' };

  return { ...empty, kind: 'music', artist: tidyCase(artist), title: tidyCase(title) };
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Stabile Akzentfarbe pro Sender (für Platzhalter-Logos). */
export function stationHue(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}
