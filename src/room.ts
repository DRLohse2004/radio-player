// Rooms (Gast-Seite): Verbindung zu einem Host-Radio halten, Befehle schicken und – beim Mithören –
// dasselbe wie der Host selbst abspielen. Der Host liefert dafür die Stream-Adresse bzw. das
// YouTube-Video samt Position; den Ton holt sich jedes Radio selbst aus dem Netz.

import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { HostListen, HostState, PlayerStatus, RoomPrefs } from './types';

export type RoomStatus = 'off' | 'connecting' | 'connected' | 'error';

export function newClientId() {
  return `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Verbindung zum Host */
export function useRoom(prefs: RoomPrefs, ready: boolean, myName: string) {
  const [status, setStatus] = useState<RoomStatus>('off');
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState<HostState | null>(null);
  const [admin, setAdmin] = useState<string | null>(null);
  const join = prefs.join;

  useEffect(
    () =>
      api.onRoomEvent((event) => {
        if (event.type === 'state') setHost(event.state);
        else {
          setStatus(event.status);
          setError(event.error);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!ready || !join) {
      setStatus('off');
      setHost(null);
      return;
    }
    setStatus('connecting');
    setError(null);
    setAdmin(null);
    api.roomConnect({ url: join.url, key: join.key, clientId: prefs.clientId, name: myName });
    return () => {
      api.roomDisconnect();
    };
  }, [ready, join?.url, join?.key, prefs.clientId, myName]);

  const adminRef = useRef(admin);
  adminRef.current = admin;

  const call = useCallback(async (path: string, body?: unknown) => {
    const result = await api.roomRequest({ method: body === undefined ? 'GET' : 'POST', path, body, admin: adminRef.current ?? undefined });
    if (result.status !== 200) throw new Error(result.body?.error ?? 'Der Host hat abgelehnt.');
    return result.body;
  }, []);

  const command = useCallback((action: string, value?: unknown) => call('/api/command', { action, value }), [call]);
  const search = useCallback(
    async (query: string) => (await call(`/api/search?q=${encodeURIComponent(query)}`)).results as SearchResult[],
    [call],
  );
  const playlist = useCallback(
    async (id: string) => (await call(`/api/playlist?id=${encodeURIComponent(id)}`)).entries as SearchResult[],
    [call],
  );
  /** Einzelnes Video oder (whole) die ganze Playlist wünschen */
  const wish = useCallback((id: string, whole = false) => call('/api/wish', whole ? { playlist: id } : { id }), [call]);
  const login = useCallback(
    async (pin: string) => {
      const body = await call('/api/admin', { pin });
      setAdmin(body.token);
    },
    [call],
  );

  return { status, error, host, admin: !!admin, command, search, playlist, wish, login, logout: () => setAdmin(null) };
}

export interface SearchResult {
  id: string;
  title: string;
  channel: string | null;
  duration: number;
  thumbnail: string | null;
  live?: boolean;
  kind?: 'playlist';
}

/** Beim Mithören dasselbe wie der Host abspielen */
export function useListen(
  audioRef: React.RefObject<HTMLAudioElement>,
  listen: HostListen | null,
  playing: boolean,
  volume: number,
  /** Lautstärke-Regler der WebAudio-Kette (für den Visualizer); ohne: direkt am Element */
  gain: GainNode | null = null,
) {
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const listenRef = useRef(listen);
  listenRef.current = listen;

  const target = !playing || !listen || listen.kind === 'none' ? null : listen.kind === 'radio' ? `radio|${listen.url}` : `yt|${listen.url}`;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = gain ? 1 : volume;
    if (gain) gain.gain.setTargetAtTime(volume, gain.context.currentTime, 0.05);
  }, [audioRef, volume, gain]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const reset = () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
    reset();
    setError(null);
    const current = listenRef.current;
    if (!target || !current || current.kind === 'none') {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    const start = () =>
      audio.play().catch((err: unknown) => {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setStatus('error');
          setError('Wiedergabe nicht möglich.');
        }
      });

    if (current.kind === 'radio') {
      // über den eigenen Stream-Proxy wie beim normalen Radio (Session 0 = keine Titel an die App)
      api.getStreamUrl(current.url, 0).then((src) => {
        if (cancelled) return;
        audio.src = src;
        start();
      });
    } else {
      api
        .youtubeResolve(current.url)
        .then((stream) => {
          if (cancelled) return;
          if (stream.hls && Hls.isSupported()) {
            const hls = new Hls({ liveSyncDurationCount: 3 });
            hls.on(Hls.Events.ERROR, (_e, data) => {
              if (data.fatal) {
                setStatus('error');
                setError('YouTube-Livestream bricht ab.');
              }
            });
            hls.loadSource(stream.url);
            hls.attachMedia(audio);
            hlsRef.current = hls;
          } else {
            audio.src = stream.url;
            const now = listenRef.current;
            if (now?.kind === 'youtube' && !now.live) audio.currentTime = expectedPosition(now);
          }
          start();
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setStatus('error');
          setError(err.message);
        });
    }
    return () => {
      cancelled = true;
      reset();
    };
  }, [audioRef, target]);

  // YouTube-Videos: bei Sprüngen des Hosts (Spulen, Hänger) nachziehen
  const position = listen?.kind === 'youtube' && !listen.live ? `${listen.position}|${listen.at}` : null;
  useEffect(() => {
    const audio = audioRef.current;
    const now = listenRef.current;
    if (!audio || !position || now?.kind !== 'youtube' || !audio.src || audio.readyState < 1) return;
    const expected = expectedPosition(now);
    if (Math.abs(audio.currentTime - expected) > 4) audio.currentTime = expected;
  }, [audioRef, position]);

  const events = {
    onPlaying: () => setStatus('playing'),
    onWaiting: () => setStatus('loading'),
    onError: () => {
      if (target) {
        setStatus('error');
        setError('Stream nicht erreichbar.');
      }
    },
  };

  return { status, error, events };
}

function expectedPosition(listen: Extract<HostListen, { kind: 'youtube' }>) {
  return Math.max(0, listen.position + (Date.now() - listen.at) / 1000);
}
