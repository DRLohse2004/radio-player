// YouTube-Wiedergabe: yt-dlp (Hauptprozess) liefert die Audio-Adresse, gespielt wird sie in einem
// eigenen <audio>-Element – Videos direkt, Livestreams über hls.js.

import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { PlayerStatus, YouTubeItem, YouTubeStream } from './types';

export { watchUrl } from './queue';

/** Audio-Adressen laufen nach einigen Stunden ab – vorab geholte nur kurz verwenden */
const CACHE_MS = 60 * 60 * 1000;

export interface YouTubeNow {
  item: YouTubeItem;
  title: string;
  channel: string | null;
  cover: string | null;
  fallbackCover: string | null;
  duration: number;
  live: boolean;
}

export interface YouTubeState {
  status: PlayerStatus;
  /** Wiedergabe gewünscht (auch während des Ladens) */
  playing: boolean;
  now: YouTubeNow | null;
  error: string | null;
}

const INITIAL: YouTubeState = { status: 'idle', playing: false, now: null, error: null };

interface Options {
  /** Song zu Ende oder „Weiter“ – die Queue entscheidet, was als Nächstes kommt */
  onEnded?: () => void;
}

export function useYouTube(audioRef: React.RefObject<HTMLAudioElement>, options: Options = {}) {
  const [state, setState] = useState<YouTubeState>(INITIAL);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stateRef = useRef(state);
  stateRef.current = state;
  const hlsRef = useRef<Hls | null>(null);
  const requestRef = useRef(0);
  const streamCache = useRef(new Map<string, { stream: YouTubeStream; at: number }>());
  const retryRef = useRef(false);

  const detach = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }, [audioRef]);

  const resolveStream = useCallback(async (url: string, fresh = false) => {
    const cached = streamCache.current.get(url);
    if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.stream;
    const stream = await api.youtubeResolve(url);
    if (!stream.live) streamCache.current.set(url, { stream, at: Date.now() });
    return stream;
  }, []);

  /** Nächsten Song schon vorab auflösen, damit der Wechsel ohne Pause klappt */
  const prefetch = useCallback((url: string) => void resolveStream(url).catch(() => {}), [resolveStream]);

  const attach = useCallback(
    (stream: YouTubeStream, startAt = 0) => {
      const audio = audioRef.current;
      if (!audio) return;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      if (stream.hls && Hls.isSupported()) {
        const hls = new Hls({ liveSyncDurationCount: 3, lowLatencyMode: false });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) audio.dispatchEvent(new Event('error'));
        });
        hls.loadSource(stream.url);
        hls.attachMedia(audio);
        hlsRef.current = hls;
      } else {
        audio.src = stream.url;
        if (startAt > 0) audio.currentTime = startAt;
      }
      audio.play().catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) audio.dispatchEvent(new Event('error'));
      });
    },
    [audioRef],
  );

  /** Video bzw. Livestream laden und abspielen */
  const start = useCallback(
    async (item: YouTubeItem, startAt = 0, fresh = false) => {
      const request = ++requestRef.current;
      audioRef.current?.pause();
      const url = item.url;
      setState((s) => ({
        ...s,
        status: 'loading',
        playing: true,
        error: null,
        now: {
          item,
          title: item.title,
          channel: item.channel,
          cover: item.thumbnail,
          fallbackCover: null,
          duration: 0,
          live: item.kind === 'live',
        },
      }));
      try {
        const stream = await resolveStream(url, fresh);
        if (request !== requestRef.current) return;
        setState((s) =>
          s.now
            ? {
                ...s,
                now: {
                  ...s.now,
                  title: stream.title,
                  channel: stream.channel ?? s.now.channel,
                  cover: stream.thumbnail ?? s.now.cover,
                  fallbackCover: stream.fallbackThumbnail,
                  duration: stream.duration ? stream.duration * 1000 : 0,
                  live: stream.live,
                },
              }
            : s,
        );
        attach(stream, startAt);
      } catch (err) {
        if (request !== requestRef.current) return;
        detach();
        setState((s) => ({ ...s, status: 'error', playing: false, error: String((err as Error).message || err) }));
      }
    },
    [attach, audioRef, detach, resolveStream],
  );

  const play = useCallback(
    (item: YouTubeItem) => {
      retryRef.current = false;
      return start(item);
    },
    [start],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setState((s) => ({ ...s, playing: false, status: s.status === 'error' ? 'error' : 'idle' }));
  }, [audioRef]);

  const resume = useCallback(() => {
    const { now } = stateRef.current;
    const audio = audioRef.current;
    if (!now || !audio) return;
    // Livestream: wieder live einsteigen; abgelaufene Adresse: neu holen und an derselben Stelle weiter
    if (now.live || !audio.src) {
      start(now.item, now.live ? 0 : audio.currentTime || 0, true);
      return;
    }
    setState((s) => ({ ...s, playing: true, status: 'loading', error: null }));
    audio.play().catch(() => audio.dispatchEvent(new Event('error')));
  }, [audioRef, start]);

  const toggle = useCallback(() => (stateRef.current.playing ? pause() : resume()), [pause, resume]);

  // Weiter = Song fertig: die Queue rückt nach. Zurück springt an den Anfang des Songs.
  const next = useCallback(() => optionsRef.current.onEnded?.(), []);
  const prev = useCallback(() => {
    if (audioRef.current && !stateRef.current.now?.live) audioRef.current.currentTime = 0;
  }, [audioRef]);

  const stop = useCallback(() => {
    requestRef.current += 1;
    detach();
    setState(INITIAL);
  }, [detach]);

  const seek = useCallback(
    (fraction: number) => {
      const audio = audioRef.current;
      const { now } = stateRef.current;
      if (!audio || !now || now.live || !now.duration) return;
      audio.currentTime = Math.max(0, Math.min(1, fraction)) * (now.duration / 1000);
    },
    [audioRef],
  );

  // Ereignisse des Audio-Elements
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlaying = () => {
      retryRef.current = false;
      setState((s) => ({ ...s, status: 'playing', playing: true }));
    };
    const onWaiting = () => setState((s) => (s.playing ? { ...s, status: 'loading' } : s));
    const onEnded = () => optionsRef.current.onEnded?.();
    const onError = () => {
      const { now, playing } = stateRef.current;
      if (!now || !playing || (!audio.getAttribute('src') && !hlsRef.current)) return;
      // Einmal neu auflösen (z. B. abgelaufene Adresse), dann aufgeben
      if (!retryRef.current) {
        retryRef.current = true;
        start(now.item, now.live ? 0 : audio.currentTime || 0, true);
        return;
      }
      setState((s) => ({ ...s, status: 'error', playing: false, error: 'Wiedergabe von YouTube fehlgeschlagen.' }));
    };
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [audioRef, start]);

  useEffect(() => () => hlsRef.current?.destroy(), []);

  const position = useCallback(() => (audioRef.current?.currentTime ?? 0) * 1000, [audioRef]);

  return { state, play, prefetch, pause, resume, toggle, next, prev, stop, seek, position };
}
