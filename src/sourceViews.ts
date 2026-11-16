// Was der Player für Spotify, Bluetooth, AirPlay und YouTube anzeigt: Song, „Sender“-Zeile und Status.
// Reine Funktionen aus dem Zustand der jeweiligen Quelle – getestet in sourceViews.test.ts.
import type { AirPlayState } from './airplay';
import type { BluetoothState } from './bluetooth';
import { isSpotifyPlaying, type SpotifyState } from './spotify';
import type { NowPlaying, PlayerStatus, Station, BtDevice } from './types';
import type { YouTubeState } from './youtube';

export interface SourceView {
  nowPlaying: NowPlaying | null;
  station: Station;
  statusText: string;
  status: PlayerStatus;
}

export const SPOTIFY_STATION: Station = { id: 'spotify', name: 'Spotify Connect', url: '' };

export function spotifyView(sp: SpotifyState, enabled: boolean): SourceView {
  const playing = isSpotifyPlaying(sp);
  return {
    nowPlaying:
      sp.active && sp.track
        ? {
            raw: sp.track.uri,
            kind: 'music',
            artist: sp.track.artists.join(', '),
            title: sp.track.name,
            album: sp.track.album || null,
            cover: sp.track.cover,
          }
        : null,
    station: SPOTIFY_STATION,
    statusText: !enabled
      ? 'Spotify aus'
      : playing
        ? 'Spotify läuft'
        : sp.active
          ? 'Pausiert'
          : sp.connected
            ? 'Bereit für Spotify'
            : sp.process.error
              ? 'Fehler'
              : 'Startet …',
    status: playing ? 'playing' : sp.process.error && !sp.process.running ? 'error' : enabled && !sp.connected ? 'loading' : 'idle',
  };
}

export function bluetoothView(state: BluetoothState, device: BtDevice | null, enabled: boolean): SourceView {
  const media = device ? state.media : null;
  const playing = !!device && (media ? media.playing : true);
  return {
    nowPlaying: media?.title
      ? {
          raw: `${media.artist} - ${media.title}`,
          kind: 'music',
          artist: media.artist,
          title: media.title,
          album: media.album || null,
          cover: media.cover,
        }
      : null,
    station: { id: 'bluetooth', name: device ? `Bluetooth · ${device.name}` : 'Bluetooth', url: '' },
    statusText: !enabled ? 'Bluetooth aus' : device ? (playing ? 'Bluetooth läuft' : 'Pausiert') : state.ready ? 'Bereit für Bluetooth' : 'Startet …',
    status: device ? (playing ? 'playing' : 'idle') : enabled && !state.ready ? 'loading' : 'idle',
  };
}

export function airplayView(state: AirPlayState, enabled: boolean): SourceView {
  const session = !!state.client;
  const playing = session && state.playing;
  return {
    nowPlaying: state.title
      ? {
          raw: `${state.artist ?? ''} - ${state.title}`,
          kind: 'music',
          artist: state.artist,
          title: state.title,
          album: state.album,
          cover: state.cover,
        }
      : null,
    station: { id: 'airplay', name: state.client ? `AirPlay · ${state.client}` : 'AirPlay', url: '' },
    statusText: !enabled
      ? 'AirPlay aus'
      : session
        ? playing
          ? 'AirPlay läuft'
          : 'Pausiert'
        : state.error
          ? 'Fehler'
          : state.running
            ? 'Bereit für AirPlay'
            : 'Startet …',
    status: playing ? 'playing' : state.error ? 'error' : enabled && !state.running ? 'loading' : 'idle',
  };
}

export function youtubeView(state: YouTubeState): SourceView {
  const now = state.now;
  return {
    nowPlaying: now
      ? { raw: now.title, kind: 'music', artist: now.channel, title: now.title, album: now.item.from ?? null, cover: now.cover }
      : null,
    station: { id: 'youtube', name: now?.item.from ? `YouTube · ${now.item.from}` : 'YouTube', url: '' },
    statusText:
      state.status === 'loading'
        ? 'Lade von YouTube …'
        : state.status === 'error'
          ? 'YouTube-Fehler'
          : state.playing
            ? now?.live
              ? 'YouTube live'
              : 'YouTube läuft'
            : now
              ? 'Pausiert'
              : 'Bereit',
    status: state.status,
  };
}
