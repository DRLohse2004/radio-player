// Anbindung an den lokalen Spotify-Connect-Dienst (go-librespot):
// Prozess starten/stoppen über den Hauptprozess, Live-Zustand über dessen REST-API + WebSocket.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { SpotifyPrefs, SpotifyProcessState } from './types';

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  cover: string | null;
  duration: number;
}

export interface SpotifyState {
  process: SpotifyProcessState;
  /** WebSocket zum Dienst steht */
  connected: boolean;
  /** Dieses Gerät ist in Spotify als Wiedergabegerät ausgewählt */
  active: boolean;
  username: string | null;
  track: SpotifyTrack | null;
  paused: boolean;
  stopped: boolean;
  buffering: boolean;
  /** Position in ms zum Zeitpunkt positionAt (Date.now()) */
  position: number;
  positionAt: number;
  /** 0..1 */
  volume: number;
  /** Kopplungscode im Konto-Modus, solange noch nicht gekoppelt */
  authCode: { url: string; code: string } | null;
}

const INITIAL: SpotifyState = {
  process: { running: false, port: 0, error: null },
  connected: false,
  active: false,
  username: null,
  track: null,
  paused: true,
  stopped: true,
  buffering: false,
  position: 0,
  positionAt: 0,
  volume: 0.6,
  authCode: null,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function toTrack(t: any): SpotifyTrack | null {
  if (!t || !t.uri) return null;
  return {
    uri: t.uri,
    name: t.name ?? '',
    artists: Array.isArray(t.artist_names) ? t.artist_names : [],
    album: t.album_name ?? '',
    cover: t.album_cover_url || null,
    duration: Number(t.duration) || 0,
  };
}

export function isSpotifyPlaying(s: SpotifyState) {
  return s.active && !!s.track && !s.paused && !s.stopped;
}

export function useSpotify(prefs: SpotifyPrefs, ready: boolean) {
  const [state, setState] = useState<SpotifyState>(INITIAL);
  const patch = useCallback((p: Partial<SpotifyState>) => setState((s) => ({ ...s, ...p })), []);
  const base = state.process.running && state.process.port ? `http://localhost:${state.process.port}` : null;
  const baseRef = useRef(base);
  baseRef.current = base;

  // --- Prozess ---------------------------------------------------------------

  useEffect(() => {
    api.spotifyState().then((process) => patch({ process }));
    return api.onSpotifyState((process) => patch({ process }));
  }, [patch]);

  // Start/Stopp nach Einstellungen; Gerätename mit kurzer Verzögerung (Tippen)
  useEffect(() => {
    if (!ready) return;
    if (!prefs.enabled) {
      api.spotifyStop();
      setState((s) => ({ ...INITIAL, process: s.process }));
      return;
    }
    const timer = window.setTimeout(() => {
      setState((s) => ({ ...INITIAL, process: s.process }));
      api.spotifyStart({ deviceName: prefs.deviceName, mode: prefs.mode }).then((process) => patch({ process }));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [ready, prefs.enabled, prefs.mode, prefs.deviceName, patch]);

  // --- Zustand vom Dienst --------------------------------------------------------

  const refreshStatus = useCallback(async () => {
    const url = baseRef.current;
    if (!url) return;
    try {
      const response = await fetch(`${url}/status`);
      if (response.status === 204) {
        patch({ active: false, username: null, track: null, stopped: true, paused: true });
        return;
      }
      const s = await response.json();
      const track = toTrack(s.track);
      patch({
        username: s.username || null,
        track,
        active: !!track && !s.stopped,
        paused: !!s.paused,
        stopped: !!s.stopped,
        buffering: !!s.buffering,
        position: Number(s.track?.position) || 0,
        positionAt: Date.now(),
        volume: s.volume_steps ? s.volume / s.volume_steps : 0.6,
      });
    } catch {
      // Dienst startet noch
    }
  }, [patch]);

  useEffect(() => {
    if (!base) {
      patch({ connected: false });
      return;
    }
    let socket: WebSocket | null = null;
    let retry = 0;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(`${base.replace('http', 'ws')}/events`);
      socket.onopen = () => {
        patch({ connected: true });
        refreshStatus();
      };
      socket.onclose = () => {
        patch({ connected: false });
        if (!closed) retry = window.setTimeout(connect, 1500);
      };
      socket.onmessage = (message) => {
        let event: { type: string; data: any };
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }
        const d = event.data ?? {};
        switch (event.type) {
          case 'active':
            patch({ active: true });
            refreshStatus();
            break;
          case 'inactive':
            patch({ active: false, track: null, paused: true, stopped: true });
            break;
          case 'metadata':
            patch({ track: toTrack(d), position: Number(d.position) || 0, positionAt: Date.now() });
            break;
          case 'playing':
            patch({ active: true, paused: false, stopped: false, buffering: false });
            refreshStatus();
            break;
          case 'paused':
            patch({ paused: true });
            refreshStatus();
            break;
          case 'not_playing':
          case 'stopped':
            patch({ stopped: true, paused: true });
            break;
          case 'seek':
            patch({ position: Number(d.position) || 0, positionAt: Date.now() });
            break;
          case 'volume':
            if (d.max) patch({ volume: d.value / d.max });
            break;
        }
      };
    };
    // der Dienst braucht nach dem Start einen Moment, bis die API lauscht
    retry = window.setTimeout(connect, 800);
    const poll = window.setInterval(refreshStatus, 10_000);
    return () => {
      closed = true;
      window.clearTimeout(retry);
      window.clearInterval(poll);
      socket?.close();
    };
  }, [base, patch, refreshStatus]);

  // Kopplungscode abfragen, solange im Konto-Modus noch niemand angemeldet ist
  const needsCode = !!base && prefs.mode === 'account' && !state.username;
  useEffect(() => {
    if (!needsCode) {
      patch({ authCode: null });
      return;
    }
    const load = async () => {
      try {
        const response = await fetch(`${baseRef.current}/auth/code`);
        if (response.status === 200) {
          const data = await response.json();
          patch({ authCode: { url: data.url, code: data.code } });
        } else {
          patch({ authCode: null });
          refreshStatus();
        }
      } catch {
        // noch nicht bereit
      }
    };
    load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [needsCode, patch, refreshStatus]);

  // --- Steuerung -----------------------------------------------------------------

  const post = useCallback(async (path: string, body?: unknown) => {
    const url = baseRef.current;
    if (!url) return;
    try {
      await fetch(`${url}${path}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      // Dienst nicht erreichbar
    }
  }, []);

  const controls = {
    playPause: useCallback(() => post('/player/playpause'), [post]),
    pause: useCallback(() => post('/player/pause'), [post]),
    next: useCallback(() => post('/player/next'), [post]),
    prev: useCallback(() => post('/player/prev'), [post]),
    setVolume: useCallback(
      (value: number) => {
        patch({ volume: value });
        post('/player/volume', { volume: Math.round(value * 100) });
      },
      [patch, post],
    ),
    forgetAccount: useCallback(async () => {
      await api.spotifyForget();
      setState((s) => ({ ...INITIAL, process: s.process }));
      // danach mit denselben Einstellungen neu starten
      const process = await api.spotifyStart({ deviceName: prefs.deviceName, mode: prefs.mode });
      patch({ process });
    }, [patch, prefs.deviceName, prefs.mode]),
  };

  return { state, ...controls };
}

/** Aktuelle Wiedergabeposition, sekündlich fortgeschrieben */
export function useSpotifyPosition(state: SpotifyState) {
  const [, tick] = useState(0);
  const playing = isSpotifyPlaying(state);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [playing]);
  const elapsed = playing ? Date.now() - state.positionAt : 0;
  return Math.min(state.position + elapsed, state.track?.duration || Infinity);
}
