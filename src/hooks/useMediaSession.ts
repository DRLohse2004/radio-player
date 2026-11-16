// Windows-Medienanzeige (Medientasten, Overlay): Titel, Status und Tasten.
import { useEffect, useRef } from 'react';
import type { NowPlaying, Station } from '../types';

export interface MediaControls {
  isPlaying: boolean;
  toggle: () => void;
  prev: () => void;
  next: () => void;
}

export function useMediaSession(nowPlaying: NowPlaying | null, station: Station | null, controls: MediaControls) {
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: nowPlaying?.title ?? station?.name ?? 'Radio',
      artist: nowPlaying?.artist ?? (nowPlaying?.title ? '' : station?.name ?? ''),
      album: nowPlaying?.album ?? station?.name ?? '',
      artwork: nowPlaying?.cover?.startsWith('http') ? [{ src: nowPlaying.cover, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
  }, [nowPlaying?.title, nowPlaying?.artist, nowPlaying?.album, nowPlaying?.cover, station?.name]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = controls.isPlaying ? 'playing' : 'paused';
  }, [controls.isPlaying]);

  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    // play/pause gezielt setzen statt umschalten – sonst kann ein doppelt ankommendes
    // Signal (Medientaste, Windows-Overlay) die Wiedergabe ungewollt beenden
    const c = () => controlsRef.current;
    const handlers: [MediaSessionAction, () => void][] = [
      ['play', () => !c().isPlaying && c().toggle()],
      ['pause', () => c().isPlaying && c().toggle()],
      ['stop', () => c().isPlaying && c().toggle()],
      ['previoustrack', () => c().prev()],
      ['nexttrack', () => c().next()],
    ];
    for (const [action, handler] of handlers) navigator.mediaSession.setActionHandler(action, handler);
  }, []);
}
