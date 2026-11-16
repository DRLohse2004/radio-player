// Songs im Verlauf und in der Merkliste: Vergleich und Verlauf ergänzen.
import type { Track } from './types';

export const MAX_HISTORY = 200;

/** Für Vergleiche: nur Buchstaben und Ziffern, klein geschrieben */
export function normalizeName(s: string | null | undefined) {
  return (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Derselbe Song, auch bei anderer Schreibweise ("AC/DC" = "ACDC") */
export function sameTrack(a: Pick<Track, 'artist' | 'title'>, b: Pick<Track, 'artist' | 'title'>) {
  return normalizeName(a.artist) === normalizeName(b.artist) && normalizeName(a.title) === normalizeName(b.title);
}

/** Song vorne in den Verlauf – außer er steht dort schon (z. B. erneut gemeldet) */
export function addToHistory(list: Track[], track: Track): Track[] {
  return list[0] && sameTrack(list[0], track) ? list : [track, ...list].slice(0, MAX_HISTORY);
}

/** Song merken bzw. wieder vergessen */
export function toggleInList(list: Track[], track: Track): Track[] {
  return list.some((f) => sameTrack(f, track)) ? list.filter((f) => !sameTrack(f, track)) : [track, ...list];
}
