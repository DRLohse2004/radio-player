import { describe, expect, it } from 'vitest';
import { consumeTop, extractSong, moveSong, nextTrack, setSongs, topTrack } from './queue';
import type { Wish } from './types';

const song = (id: string) => ({ id, title: `Song ${id}`, channel: null, duration: 180, thumbnail: null });
const video = (id: string): Wish => ({ id, videoId: `v${id}`, title: `Video ${id}`, channel: null, duration: 200, thumbnail: null, by: 'Anna', clientId: 'a' });
const playlist = (id: string, songs: string[]): Wish => ({ ...video(id), count: songs.length, entries: songs.map(song) });
const ids = (q: Wish[]) => q.map((w) => (w.entries ? `${w.id}[${w.entries.map((s) => s.id).join('')}]` : w.id)).join(' ');

describe('Queue', () => {
  it('spielt oben: Playlist Song für Song, danach der nächste Eintrag', () => {
    let q = [playlist('p', ['1', '2']), video('x')];
    expect(topTrack(q)).toMatchObject({ id: 'p:1', from: 'Video p', wishedBy: 'Anna' });
    expect(nextTrack(q)?.id).toBe('p:2');
    q = consumeTop(q);
    expect(ids(q)).toBe('p[2] x');
    q = consumeTop(q);
    expect(ids(q)).toBe('x');
    expect(topTrack(consumeTop(q))).toBeNull();
  });

  it('verschiebt Songs in der Playlist und zieht sie heraus', () => {
    const q = [video('x'), playlist('p', ['1', '2', '3'])];
    expect(ids(moveSong(q, 'p', '3', 0))).toBe('x p[312]');
    expect(ids(extractSong(q, 'p', '2', 0, 'n'))).toBe('n x p[13]');
    expect(extractSong(q, 'p', '2', 0, 'n')[0]).toMatchObject({ videoId: '2', by: 'Anna' });
    // letzter Song heraus: Playlist verschwindet, Ziel hinter ihr bleibt richtig
    const one = [playlist('p', ['1']), video('x')];
    expect(ids(extractSong(one, 'p', '1', 2, 'n'))).toBe('x n');
  });

  it('übernimmt Songs ohne Doppelte; leere Playlist fällt raus', () => {
    const q = [{ ...video('p'), count: 0 }];
    expect(setSongs(q, 'p', [song('1'), song('1'), song('2')])[0]).toMatchObject({ count: 2 });
    expect(setSongs(q, 'p', [])).toEqual([]);
  });
});
