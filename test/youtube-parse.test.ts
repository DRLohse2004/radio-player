import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseInfo, parseResolve, parsePlaylists, parseVideos } = require('../electron/youtube.cjs').parse;

describe('YouTube: Antworten von yt-dlp auswerten', () => {
  it('erkennt ein Video', () => {
    const r = parseInfo({ id: 'dQw4w9WgXcQ', title: 'Song', uploader: 'Kanal', duration: 213 }, 'https://youtu.be/x');
    expect(r).toEqual({
      kind: 'video',
      title: 'Song',
      channel: 'Kanal',
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      duration: 213,
      entries: [],
    });
  });

  it('schneidet bei Livestreams Datum und Uhrzeit vom Titel ab', () => {
    const r = parseInfo({ id: 'jfKfPfyJRdk', title: 'lofi radio 2026-11-16 08:30', is_live: true }, 'u');
    expect(r.kind).toBe('live');
    expect(r.title).toBe('lofi radio');
  });

  it('nimmt den Link als Titel, wenn yt-dlp keinen liefert', () => {
    expect(parseInfo({}, 'https://example.org/v').title).toBe('https://example.org/v');
  });

  it('liest Playlists ohne private und gelöschte Videos', () => {
    const r = parseInfo(
      {
        _type: 'playlist',
        title: 'Mix',
        channel: 'Ich',
        entries: [
          { id: 'aaaaaaaaaaa', title: 'Eins', duration: 100 },
          { id: 'bbbbbbbbbbb', title: '[Private video]' },
          { id: 'ccccccccccc', title: '[Deleted video]' },
          null,
          { id: 'ddddddddddd', uploader: 'Band' },
        ],
      },
      'u',
    );
    expect(r.kind).toBe('playlist');
    expect(r.entries.map((e: { id: string }) => e.id)).toEqual(['aaaaaaaaaaa', 'ddddddddddd']);
    expect(r.entries[1]).toMatchObject({ title: 'ddddddddddd', channel: 'Band', duration: 0 });
    expect(r.thumbnail).toBe('https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
  });

  it('wählt bei der Wiedergabe das Audioformat und erkennt HLS', () => {
    const file = parseResolve({ id: 'aaaaaaaaaaa', title: 'T', requested_formats: [{ url: 'https://cdn/a.webm', protocol: 'https', ext: 'webm' }] }, 'u');
    expect(file).toMatchObject({ url: 'https://cdn/a.webm', hls: false, live: false, ext: 'webm' });
    const live = parseResolve({ id: 'aaaaaaaaaaa', is_live: true, url: 'https://cdn/x.m3u8', protocol: 'm3u8_native' }, 'u');
    expect(live).toMatchObject({ url: 'https://cdn/x.m3u8', hls: true, live: true });
    expect(live.thumbnail).toBe('https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg');
    expect(live.fallbackThumbnail).toBe('https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
  });

  it('zeigt in der Suche nur abspielbare Videos, keine Livestreams', () => {
    const list = parseVideos({
      _type: 'playlist',
      entries: [
        { id: 'aaaaaaaaaaa', title: 'Video' },
        { id: 'bbbbbbbbbbb', title: 'Live', is_live: true },
        { id: 'ccccccccccc', title: 'Auch live', live_status: 'is_live' },
        { id: 'UCkanal1234567', title: 'Kanal statt Video' },
      ],
    });
    expect(list.map((v: { id: string }) => v.id)).toEqual(['aaaaaaaaaaa']);
    expect(parseVideos({ id: 'aaaaaaaaaaa', title: 'Einzeln' })).toHaveLength(1);
  });

  it('nimmt aus der Playlist-Suche nur gültige Playlist-IDs', () => {
    const list = parsePlaylists({
      entries: [
        { id: 'PLabcdefghijklmnop', title: 'Gute Liste', thumbnails: [{ url: 'https://i/t.jpg' }] },
        { id: 'kurz', title: 'Zu kurz' },
        { title: 'Ohne ID' },
      ],
    });
    expect(list).toEqual([{ id: 'PLabcdefghijklmnop', kind: 'playlist', title: 'Gute Liste', channel: null, duration: 0, thumbnail: 'https://i/t.jpg' }]);
    expect(parsePlaylists({})).toEqual([]);
  });
});
