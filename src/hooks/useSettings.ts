// Was das Radio sich merkt: Sender, Lautstärke, letzter Sender, Einstellungen, Verlauf, Merkliste, YouTube-Links.
// Wird beim Start einmal geladen und danach bei jeder Änderung (gebündelt) gespeichert.
import { useEffect, useRef, useState } from 'react';
import { api, DEFAULT_STATIONS } from '../api';
import { DEFAULT_PREFS, mergePrefs } from '../prefs';
import type { Preferences, Station, Track, YouTubeItem } from '../types';

const SAVE_DELAY_MS = 400;

export function useSettings(onLoaded: (prefs: Preferences) => void) {
  const [stations, setStations] = useState<Station[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.7);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [history, setHistory] = useState<Track[]>([]);
  const [favorites, setFavorites] = useState<Track[]>([]);
  const [youtubeItems, setYoutubeItems] = useState<YouTubeItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    api.loadSettings().then((settings) => {
      const list = settings?.stations ?? DEFAULT_STATIONS;
      setStations(list);
      if (typeof settings?.volume === 'number') setVolume(settings.volume);
      const last = settings?.lastStationId;
      setCurrentId(last && list.some((s) => s.id === last) ? last : list[0]?.id ?? null);
      const loadedPrefs = mergePrefs(settings?.prefs);
      setPrefs(loadedPrefs);
      setHistory(settings?.history ?? []);
      setFavorites(settings?.favorites ?? []);
      setYoutubeItems(settings?.youtube ?? []);
      onLoadedRef.current(loadedPrefs);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(
      () => api.saveSettings({ stations, volume, lastStationId: currentId, prefs, history, favorites, youtube: youtubeItems }),
      SAVE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [loaded, stations, volume, currentId, prefs, history, favorites, youtubeItems]);

  return {
    loaded,
    stations,
    setStations,
    currentId,
    setCurrentId,
    volume,
    setVolume,
    prefs,
    setPrefs,
    history,
    setHistory,
    favorites,
    setFavorites,
    youtubeItems,
    setYoutubeItems,
  };
}
