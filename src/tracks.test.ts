import { describe, expect, it } from 'vitest';
import { addToHistory, MAX_HISTORY, sameTrack, toggleInList } from './tracks';
import type { Track } from './types';

const song = (artist: string, title: string, id = `${artist}-${title}`): Track => ({ id, artist, title, album: null, cover: null, station: 'X', time: '' });

describe('Songs vergleichen und merken', () => {
  it('erkennt denselben Song trotz anderer Schreibweise', () => {
    expect(sameTrack(song('AC/DC', 'Back In Black'), song('acdc', 'back in black'))).toBe(true);
    expect(sameTrack(song('Beyoncé', 'Halo'), song('Beyonce', 'Halo'))).toBe(false);
    expect(sameTrack(song('A', 'Eins'), song('A', 'Zwei'))).toBe(false);
  });

  it('setzt neue Songs vorne in den Verlauf, aber nicht doppelt hintereinander', () => {
    const one = addToHistory([], song('A', 'Eins'));
    const again = addToHistory(one, song('a', 'EINS', 'neu'));
    expect(again).toBe(one);
    expect(addToHistory(one, song('B', 'Zwei')).map((t) => t.title)).toEqual(['Zwei', 'Eins']);
  });

  it('begrenzt den Verlauf', () => {
    let list: Track[] = [];
    for (let i = 0; i < MAX_HISTORY + 10; i++) list = addToHistory(list, song('A', `Song ${i}`));
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0].title).toBe(`Song ${MAX_HISTORY + 9}`);
  });

  it('merkt und vergisst Songs', () => {
    const marked = toggleInList([], song('A', 'Eins'));
    expect(marked).toHaveLength(1);
    expect(toggleInList(marked, song('a', 'eins', 'anderer-id'))).toEqual([]);
  });
});
