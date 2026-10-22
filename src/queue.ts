// Die eine YouTube-Queue: Was oben steht, spielt. Ist ein Song zu Ende (oder „Weiter“), fällt er oben weg –
// bei Playlists Song für Song. Reine Funktionen, damit Host, Room und Handy dieselben Regeln teilen.

import { moveTo } from './list';
import type { Wish, YouTubeEntry, YouTubeItem } from './types';

export const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

// shortcut: lange Playlists werden auf 200 Songs gekürzt, damit der Zustand fürs Handy klein bleibt – bei Bedarf nachladen
export const MAX_SONGS = 200;

export const isPlaylist = (wish: Wish) => wish.count !== undefined;

/** Songs einer Playlist übernehmen (doppelte Videos nur einmal, höchstens MAX_SONGS) */
export function setSongs(queue: Wish[], wishId: string, songs: YouTubeEntry[]): Wish[] {
  const seen = new Set<string>();
  const unique = songs.filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, MAX_SONGS);
  if (unique.length === 0) return queue.filter((w) => w.id !== wishId);
  return queue.map((w) => (w.id === wishId ? { ...w, entries: unique, count: unique.length } : w));
}

/** Oberster Song ist fertig: aus der Playlist bzw. ganz aus der Queue nehmen */
export function consumeTop(queue: Wish[]): Wish[] {
  const [top, ...rest] = queue;
  if (!top) return queue;
  if (top.entries && top.entries.length > 1) return [{ ...top, entries: top.entries.slice(1), count: top.entries.length - 1 }, ...rest];
  return rest;
}

/** Song innerhalb seiner Playlist verschieben (toIndex wie beim Ziehen: Platz davor) */
export function moveSong(queue: Wish[], wishId: string, songId: string, toIndex: number): Wish[] {
  return queue.map((w) => (w.id === wishId && w.entries ? { ...w, entries: moveTo(w.entries, songId, toIndex) } : w));
}

/** Song aus der Playlist herausziehen: Er wird ein eigener Eintrag an Platz toIndex der Queue (vor dem Herausnehmen gezählt) */
export function extractSong(queue: Wish[], wishId: string, songId: string, toIndex: number, newId: string): Wish[] {
  const from = queue.findIndex((w) => w.id === wishId);
  const playlist = queue[from];
  const song = playlist?.entries?.find((s) => s.id === songId);
  if (!playlist || !song || !Number.isInteger(toIndex) || toIndex < 0 || toIndex > queue.length) return queue;
  const single: Wish = {
    id: newId,
    videoId: song.id,
    title: song.title,
    channel: song.channel,
    duration: song.duration,
    thumbnail: song.thumbnail,
    by: playlist.by,
    clientId: playlist.clientId,
  };
  const rest = playlist.entries!.filter((s) => s.id !== songId);
  const next = [...queue];
  next.splice(toIndex, 0, single);
  const at = next.indexOf(playlist);
  if (rest.length) next[at] = { ...playlist, entries: rest, count: rest.length };
  else next.splice(at, 1);
  return next;
}

/** Was jetzt spielen soll: der oberste Song – bei einer Playlist ihr erster (null = Songs werden noch geladen) */
export function topTrack(queue: Wish[]): YouTubeItem | null {
  const top = queue[0];
  if (!top) return null;
  if (isPlaylist(top)) {
    const song = top.entries?.[0];
    if (!song) return null;
    return {
      id: `${top.id}:${song.id}`,
      url: watchUrl(song.id),
      title: song.title,
      channel: song.channel,
      thumbnail: song.thumbnail,
      kind: 'video',
      wishedBy: top.by,
      from: top.title,
    };
  }
  return {
    id: `${top.id}:${top.videoId}`,
    url: top.url ?? watchUrl(top.videoId),
    title: top.title,
    channel: top.channel,
    thumbnail: top.thumbnail,
    kind: top.live ? 'live' : 'video',
    wishedBy: top.by,
  };
}

/** Der Song danach – zum Vorab-Auflösen, damit der Wechsel ohne Pause klappt */
export function nextTrack(queue: Wish[]): YouTubeItem | null {
  return topTrack(consumeTop(queue));
}
