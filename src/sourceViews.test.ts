// @vitest-environment jsdom
// (jsdom nur, weil die importierten Module die Oberflächen-API laden)
import { describe, expect, it } from 'vitest';
import { airplayView, bluetoothView, spotifyView, youtubeView } from './sourceViews';
import type { SpotifyState } from './spotify';
import type { BluetoothState } from './bluetooth';
import type { AirPlayState } from './airplay';
import type { YouTubeState } from './youtube';

const spotify = (patch: Partial<SpotifyState> = {}): SpotifyState => ({
  process: { running: true, port: 1, error: null },
  connected: true,
  active: false,
  username: null,
  track: null,
  paused: true,
  stopped: true,
  buffering: false,
  position: 0,
  positionAt: 0,
  volume: 0.5,
  authCode: null,
  ...patch,
});

describe('Anzeige der Quellen', () => {
  it('Spotify: von „aus“ über „bereit“ bis „läuft“', () => {
    expect(spotifyView(spotify(), false).statusText).toBe('Spotify aus');
    expect(spotifyView(spotify({ connected: false }), true)).toMatchObject({ statusText: 'Startet …', status: 'loading' });
    expect(spotifyView(spotify(), true)).toMatchObject({ statusText: 'Bereit für Spotify', status: 'idle', nowPlaying: null });
    const track = { uri: 'spotify:track:1', name: 'Song', artists: ['A', 'B'], album: '', cover: 'c', duration: 1 };
    const v = spotifyView(spotify({ active: true, paused: false, stopped: false, track }), true);
    expect(v.status).toBe('playing');
    expect(v.nowPlaying).toMatchObject({ artist: 'A, B', title: 'Song', album: null, cover: 'c' });
  });

  it('Spotify: Fehler des Dienstes', () => {
    const v = spotifyView(spotify({ connected: false, process: { running: false, port: 0, error: 'kaputt' } }), true);
    expect(v).toMatchObject({ statusText: 'Fehler', status: 'error' });
  });

  it('Bluetooth: verbundenes Handy mit und ohne Titelinfos', () => {
    const state: BluetoothState = { running: true, ready: true, devices: [], error: null, output: null, media: null };
    const phone = { id: 'p', name: 'Handy', state: 'connected' } as never;
    expect(bluetoothView(state, null, true)).toMatchObject({ statusText: 'Bereit für Bluetooth', status: 'idle' });
    // ohne Titelinfos gilt ein verbundenes Handy als spielend
    expect(bluetoothView(state, phone, true)).toMatchObject({ statusText: 'Bluetooth läuft', status: 'playing', nowPlaying: null });
    const media = { source: 's', title: 'T', artist: 'A', album: '', playing: false, cover: null, updatedAt: 0 };
    const v = bluetoothView({ ...state, media }, phone, true);
    expect(v).toMatchObject({ statusText: 'Pausiert', status: 'idle' });
    expect(v.station.name).toBe('Bluetooth · Handy');
  });

  it('AirPlay: iPhone verbunden', () => {
    const base = { running: true, error: null, client: null, playing: false, title: null, artist: null, album: null, cover: null } as unknown as AirPlayState;
    expect(airplayView(base, true).statusText).toBe('Bereit für AirPlay');
    const v = airplayView({ ...base, client: 'iPhone', playing: true, title: 'T', artist: 'A' }, true);
    expect(v).toMatchObject({ statusText: 'AirPlay läuft', status: 'playing' });
    expect(v.station.name).toBe('AirPlay · iPhone');
    expect(airplayView({ ...base, running: false, error: 'Port belegt' }, true)).toMatchObject({ statusText: 'Fehler', status: 'error' });
  });

  it('YouTube: Laden, Livestream und Pause', () => {
    const now = { item: { id: 'i', url: 'u', title: 't', from: 'Mix' }, title: 'Song', channel: 'Kanal', cover: 'c', fallbackCover: null, duration: 1, live: false } as never;
    const idle: YouTubeState = { status: 'idle', playing: false, now: null, error: null };
    expect(youtubeView(idle).statusText).toBe('Bereit');
    expect(youtubeView({ ...idle, status: 'loading', playing: true }).statusText).toBe('Lade von YouTube …');
    expect(youtubeView({ ...idle, status: 'playing', playing: true, now: { ...(now as object), live: true } as never }).statusText).toBe('YouTube live');
    const paused = youtubeView({ ...idle, now });
    expect(paused.statusText).toBe('Pausiert');
    expect(paused.station.name).toBe('YouTube · Mix');
    expect(paused.nowPlaying).toMatchObject({ artist: 'Kanal', title: 'Song', album: 'Mix' });
  });
});
