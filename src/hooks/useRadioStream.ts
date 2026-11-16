// Radio-Wiedergabe: Stream verbinden, bei Abbruch neu versuchen, Titel und Cover erkennen.
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { api, isDesktop } from '../api';
import { attachToGraph, connectAudio, type AudioGraph } from '../audio';
import { parseStreamTitle } from '../metadata';
import { addToHistory, normalizeName } from '../tracks';
import type { NowPlaying, PlayerStatus, Track } from '../types';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

interface Options {
  audioRef: RefObject<HTMLAudioElement>;
  /** wird mit an den WebAudio-Graphen gehängt (gleiche Lautstärke, gleicher Visualizer) */
  ytAudioRef: RefObject<HTMLAudioElement>;
  /** Adresse des Senders, solange er spielen soll – sonst null */
  streamUrl: string | null;
  wantPlay: boolean;
  stationName: string;
  setHistory: Dispatch<SetStateAction<Track[]>>;
}

export function useRadioStream({ audioRef, ytAudioRef, streamUrl, wantPlay, stationName, setHistory }: Options) {
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [graph, setGraph] = useState<AudioGraph | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const sessionRef = useRef(0);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef<number>();
  /** Namen, die nicht als Titel gelten (Sendername, vom Stream gemeldeter Name) */
  const stationNamesRef = useRef<string[]>([]);
  stationNamesRef.current = [stationName];
  const stationNameRef = useRef('');
  stationNameRef.current = stationName;

  // In der Desktop-App läuft der Ton über WebAudio (für den Visualizer). Die Streams kommen
  // dann vom lokalen Proxy, der die nötige CORS-Freigabe mitschickt.
  useEffect(() => {
    if (isDesktop && audioRef.current) {
      const g = connectAudio(audioRef.current);
      if (g && ytAudioRef.current) attachToGraph(g, ytAudioRef.current);
      setGraph(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const session = ++sessionRef.current;
    window.clearTimeout(retryTimerRef.current);
    setNowPlaying(null);

    if (!streamUrl) {
      // Live-Stream komplett trennen, damit "Play" wieder live einsteigt statt alten Puffer zu spielen
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    graph?.context.resume().catch(() => {});
    api.getStreamUrl(streamUrl, session).then((src) => {
      if (cancelled) return;
      audio.src = src;
      audio.play().catch((err: unknown) => {
        // AbortError = durch Senderwechsel überholt, kein echter Fehler
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          audio.dispatchEvent(new Event('error'));
        }
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, retryNonce]);

  const handleStreamFailure = useCallback(() => {
    if (!wantPlay) return;
    setStatus('error');
    window.clearTimeout(retryTimerRef.current);
    if (retriesRef.current < MAX_RETRIES) {
      retriesRef.current += 1;
      retryTimerRef.current = window.setTimeout(() => setRetryNonce((n) => n + 1), RETRY_DELAY_MS);
    }
  }, [wantPlay]);

  // --- Titel & Cover ---------------------------------------------------------

  useEffect(
    () =>
      api.onTitle(({ session, title }) => {
        if (session !== sessionRef.current) return;
        setNowPlaying((prev) => (prev?.raw === title ? prev : parseStreamTitle(title, stationNamesRef.current)));
      }),
    [],
  );

  useEffect(
    () =>
      api.onStationInfo(({ session, name }) => {
        if (session === sessionRef.current) stationNamesRef.current.push(name);
      }),
    [],
  );

  const trackKey = nowPlaying?.artist && nowPlaying.title ? nowPlaying.raw : null;
  useEffect(() => {
    if (!trackKey || !nowPlaying?.artist || !nowPlaying.title) return;
    const { artist, title } = nowPlaying;
    let cancelled = false;
    api.lookupCover(artist, title).then((info) => {
      if (cancelled) return;
      // korrekte Schreibweise übernehmen, wenn es eindeutig derselbe Titel ist
      const track: Track = {
        id: `t-${Date.now().toString(36)}`,
        artist: info?.artist && normalizeName(info.artist) === normalizeName(artist) ? info.artist : artist,
        title: info?.title && normalizeName(info.title) === normalizeName(title) ? info.title : title,
        album: info?.album ?? null,
        cover: info?.cover ?? null,
        station: stationNameRef.current,
        time: new Date().toISOString(),
      };
      setHistory((list) => addToHistory(list, track));
      if (!info) return;
      setNowPlaying((prev) =>
        prev && prev.raw === trackKey ? { ...prev, cover: track.cover, album: track.album, artist: track.artist, title: track.title } : prev,
      );
    });
    return () => {
      cancelled = true;
    };
    // nur bei neuem Titel suchen, nicht nach der eigenen Aktualisierung
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  /** Nach einer Nutzeraktion (Play, Senderwechsel) wieder volle Anzahl Versuche */
  const resetRetries = useCallback(() => {
    retriesRef.current = 0;
  }, []);

  /** Handler für das <audio>-Element des Radios */
  const audioEvents = {
    onPlaying: () => {
      retriesRef.current = 0;
      setStatus('playing');
    },
    onWaiting: () => wantPlay && setStatus('loading'),
    onError: handleStreamFailure,
    onEnded: handleStreamFailure,
  };

  return {
    status,
    nowPlaying,
    graph,
    /** Verbindung verloren, ein neuer Versuch ist geplant */
    retrying: status === 'error' && retriesRef.current < MAX_RETRIES && wantPlay,
    resetRetries,
    audioEvents,
  };
}
