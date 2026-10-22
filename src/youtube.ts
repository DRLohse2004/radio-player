// YouTube-Wiedergabe: yt-dlp (Hauptprozess) liefert die Audio-Adresse, gespielt wird sie in einem
// eigenen <audio>-Element – Videos direkt, Livestreams über hls.js.

import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { PlayerStatus, YouTubeEntry, YouTubeItem, YouTubeStream } from './types';

export const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

/** Audio-Adressen laufen nach einigen Stunden ab – vorab geholte nur kurz verwenden */
const CACHE_MS = 60 * 60 * 1000;

export interface YouTubeNow {
  item: YouTubeItem;
  /** Titel der Playlist (leer bei Einzelvideo/Livestream) */
  entries: YouTubeEntry[];
  index: number;
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
  /** Playlist-Inhalte, die gerade geladen werden (Item-ID) */
  loadingList: string | null;
}

const INITIAL: YouTubeState = { status: 'idle', playing: false, now: null, error: null, loadingList: null };

interface Options {
  /** Nächsten Musikwunsch aus der Wunschliste nehmen (null = keiner) */
  nextWish?: () => YouTubeItem | null;
}

export function useYouTube(audioRef: React.RefObject<HTMLAudioElement>, options: Options = {}) {
  const [state, setState] = useState<YouTubeState>(INITIAL);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  /** Wo es nach den Wünschen weitergeht */
  const resumeRef = useRef<{ item: YouTubeItem; entries: YouTubeEntry[]; index: number; live: boolean } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const hlsRef = useRef<Hls | null>(null);
  const requestRef = useRef(0);
  const entriesCache = useRef(new Map<string, YouTubeEntry[]>());
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

  /** Nächsten Playlist-Titel schon vorab auflösen, damit der Wechsel ohne Pause klappt */
  const prefetch = useCallback(
    (entries: YouTubeEntry[], index: number) => {
      const next = entries[index + 1];
      if (next) resolveStream(watchUrl(next.id)).catch(() => {});
    },
    [resolveStream],
  );

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

  /** Titel index der Liste (bzw. das Video/den Livestream) laden und abspielen */
  const start = useCallback(
    async (item: YouTubeItem, entries: YouTubeEntry[], index: number, startAt = 0, fresh = false) => {
      const request = ++requestRef.current;
      audioRef.current?.pause();
      const entry = entries[index];
      const url = entry ? watchUrl(entry.id) : item.url;
      setState((s) => ({
        ...s,
        status: 'loading',
        playing: true,
        error: null,
        now: {
          item,
          entries,
          index,
          title: entry?.title ?? s.now?.title ?? item.title,
          channel: entry?.channel ?? item.channel,
          cover: entry?.thumbnail ?? item.thumbnail,
          fallbackCover: null,
          duration: (entry?.duration ?? 0) * 1000,
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
        prefetch(entries, index);
      } catch (err) {
        if (request !== requestRef.current) return;
        detach();
        setState((s) => ({ ...s, status: 'error', playing: false, error: String((err as Error).message || err) }));
      }
    },
    [attach, audioRef, detach, prefetch, resolveStream],
  );

  const play = useCallback(
    async (item: YouTubeItem, index = 0) => {
      retryRef.current = false;
      resumeRef.current = null;
      if (item.kind !== 'playlist') return start(item, [], 0);
      let entries = entriesCache.current.get(item.id);
      if (!entries) {
        const request = ++requestRef.current;
        detach();
        setState((s) => ({ ...s, loadingList: item.id, status: 'loading', playing: true, error: null }));
        try {
          entries = (await api.youtubeInfo(item.url)).entries;
          entriesCache.current.set(item.id, entries);
        } catch (err) {
          if (request === requestRef.current)
            setState((s) => ({ ...s, loadingList: null, status: 'error', playing: false, error: String((err as Error).message || err) }));
          return;
        } finally {
          setState((s) => (s.loadingList === item.id ? { ...s, loadingList: null } : s));
        }
        if (request !== requestRef.current) return;
      }
      if (entries.length === 0) {
        setState((s) => ({ ...s, status: 'error', playing: false, error: 'Die Playlist ist leer oder privat.' }));
        return;
      }
      return start(item, entries, Math.min(index, entries.length - 1));
    },
    [detach, start],
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
      start(now.item, now.entries, now.index, now.live ? 0 : audio.currentTime || 0, true);
      return;
    }
    setState((s) => ({ ...s, playing: true, status: 'loading', error: null }));
    audio.play().catch(() => audio.dispatchEvent(new Event('error')));
  }, [audioRef, start]);

  const toggle = useCallback(() => (stateRef.current.playing ? pause() : resume()), [pause, resume]);

  const step = useCallback(
    (delta: number) => {
      const { now } = stateRef.current;
      if (!now) return;
      retryRef.current = false;
      if (now.entries.length > 1) {
        const index = (now.index + delta + now.entries.length) % now.entries.length;
        start(now.item, now.entries, index);
      } else if (!now.live && audioRef.current) {
        // Einzelvideo: "Zurück" springt an den Anfang
        audioRef.current.currentTime = 0;
      }
    },
    [audioRef, start],
  );
  /** Wunsch abspielen und merken, wo es danach weitergeht */
  const playWish = useCallback(
    (wish: YouTubeItem) => {
      const { now } = stateRef.current;
      const back = now && !now.item.wishedBy ? { item: now.item, entries: now.entries, index: now.index, live: now.live } : resumeRef.current;
      retryRef.current = false;
      const started = wish.kind === 'playlist' ? play(wish) : start(wish, [], 0);
      // play() vergisst die Rückkehr-Stelle – für Wünsche gilt sie weiter
      resumeRef.current = back;
      return started;
    },
    [play, start],
  );

  /** Weiter: zuerst Wünsche, dann zurück zur Playlist bzw. zum Livestream */
  const advance = useCallback(
    (manual: boolean) => {
      const { now } = stateRef.current;
      // Gewünschte Playlist erst zu Ende spielen, dann der nächste Wunsch
      if (now?.item.wishedBy && now.index < now.entries.length - 1) return void start(now.item, now.entries, now.index + 1);
      const wish = optionsRef.current.nextWish?.();
      if (wish) return void playWish(wish);
      if (now?.item.wishedBy) {
        const back = resumeRef.current;
        resumeRef.current = null;
        if (back?.live) return void start(back.item, [], 0);
        if (back && back.entries.length > 1) return void start(back.item, back.entries, (back.index + 1) % back.entries.length);
        if (!manual) setState((s) => ({ ...s, playing: false, status: 'idle' }));
        return;
      }
      if (now && now.entries.length > 1) step(1);
      else if (!manual) setState((s) => ({ ...s, playing: false, status: 'idle' }));
    },
    [playWish, start, step],
  );
  const next = useCallback(() => advance(true), [advance]);
  const prev = useCallback(() => step(-1), [step]);

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
    const onEnded = () => advance(false);
    const onError = () => {
      const { now, playing } = stateRef.current;
      if (!now || !playing || (!audio.getAttribute('src') && !hlsRef.current)) return;
      // Einmal neu auflösen (z. B. abgelaufene Adresse), dann aufgeben
      if (!retryRef.current) {
        retryRef.current = true;
        start(now.item, now.entries, now.index, now.live ? 0 : audio.currentTime || 0, true);
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
  }, [audioRef, start, advance]);

  useEffect(() => () => hlsRef.current?.destroy(), []);

  const position = useCallback(() => (audioRef.current?.currentTime ?? 0) * 1000, [audioRef]);
  const entriesFor = useCallback((itemId: string) => entriesCache.current.get(itemId) ?? null, []);

  return { state, play, playWish, pause, resume, toggle, next, prev, stop, seek, position, entriesFor };
}
