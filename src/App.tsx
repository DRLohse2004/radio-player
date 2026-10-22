import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, DEFAULT_STATIONS, isDesktop, newStationId } from './api';
import { attachToGraph, connectAudio, type AudioGraph } from './audio';
import { FullscreenView } from './components/FullscreenView';
import { ExpandIcon, HeartIcon, HistoryIcon, PhoneIcon, RoomIcon, SettingsIcon, SidebarIcon, VolumeIcon } from './components/Icons';
import { LibraryPanel } from './components/LibraryPanel';
import { Controls, Cover, STATUS_TEXT, TrackInfo } from './components/Player';
import { KindBadge } from './components/Segment';
import { SettingsDialog } from './components/SettingsDialog';
import { SpotifySidebar, SpotifyStage } from './components/SpotifyPanel';
import { BluetoothSidebar, BluetoothStage } from './components/BluetoothPanel';
import { YouTubeSidebar } from './components/YouTubeSidebar';
import { YouTubeStage } from './components/YouTubeStage';
import { useYouTube, watchUrl } from './youtube';
import { newRemoteKey, useRemote } from './remote';
import { newClientId, useRoom } from './room';
import { RoomDialog } from './components/RoomDialog';
import { RoomView } from './components/RoomView';
import { RemoteDialog } from './components/RemoteDialog';
import { StartupStatus, type StartupItem } from './components/StartupStatus';
import { UpdateBanner, useUpdate } from './components/UpdateBanner';
import { useBluetooth } from './bluetooth';
import { useAirPlay } from './airplay';
import { AirPlaySidebar, AirPlayStage } from './components/AirPlayPanel';
import { StationEditor } from './components/StationEditor';
import { StationList } from './components/StationList';
import { StationStore } from './components/StationStore';
import { deckStations, FlapTrack, Spectrum, StationDeck, TuningScale, VuMeter } from './components/ThemeDeck';
import { findStationLogo } from './logo';
import { parseStreamTitle } from './metadata';
import { isSpotifyPlaying, useSpotify } from './spotify';
import type { HostListen, NowPlaying, PlayerStatus, Preferences, RoomPrefs, SourceTab, Station, StoreStation, Track, YouTubeItem } from './types';
import './App.css';
import './features.css';
import './store.css';
import './spotify.css';
import './layout.css';
import { DECK_THEMES, THEMES, useTheme } from './themes';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;
const MAX_HISTORY = 200;

const DEFAULT_PREFS: Preferences = {
  autoplay: false,
  startFullscreen: false,
  schedule: { enabled: false, start: '08:00', stop: '17:00', days: [1, 2, 3, 4, 5] },
  weatherCity: '',
  swapMinutes: 5,
  visualizer: true,
  spotify: { enabled: false, mode: 'network', deviceName: '' },
  bluetooth: { enabled: false },
  airplay: { enabled: false, name: '' },
  sidebarOpen: true,
  remote: {
    enabled: false,
    key: '',
    pin: '',
    guestVolume: true,
    guestSkip: true,
    guestStations: true,
    maxWishes: 3,
    maxMinutes: 15,
    qrInFullscreen: false,
  },
  autoUpdate: true,
  room: { open: false, name: '', join: null, mode: 'listen', volume: 0.7, clientId: '' },
  tabs: { radio: true, youtube: true, spotify: true, airplay: true, bluetooth: true },
  theme: 'standard',
};

type Tab = SourceTab;
const TABS: { id: Tab; label: string }[] = [
  { id: 'radio', label: 'Radio' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'airplay', label: 'AirPlay' },
  { id: 'bluetooth', label: 'Bluetooth' },
];
const YOUTUBE_URL = /^https?:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i;
const SPOTIFY_STATION: Station = { id: 'spotify', name: 'Spotify Connect', url: '' };

function hhmm(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Liegt der Zeitpunkt an einem aktiven Tag zwischen Ein- und Ausschaltzeit? */
function withinSchedule(schedule: Preferences['schedule'], date: Date) {
  if (!schedule.enabled || !schedule.days.includes(date.getDay())) return false;
  const time = hhmm(date);
  return time >= schedule.start && time < schedule.stop;
}

function sameTrack(a: Pick<Track, 'artist' | 'title'>, b: Pick<Track, 'artist' | 'title'>) {
  return normalizeName(a.artist) === normalizeName(b.artist) && normalizeName(a.title) === normalizeName(b.title);
}

function normalizeName(s: string | null | undefined) {
  return (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName);
}

export default function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [wantPlay, setWantPlay] = useState(false);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [retryNonce, setRetryNonce] = useState(0);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);

  const [editing, setEditing] = useState<Station | 'new' | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);

  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  useTheme(prefs.theme);
  const [history, setHistory] = useState<Track[]>([]);
  const [favorites, setFavorites] = useState<Track[]>([]);
  const [graph, setGraph] = useState<AudioGraph | null>(null);
  const [tab, setTab] = useState<Tab>('radio');
  /** Quelle, die zuletzt gestartet wurde – sie bleibt in der Mitte, egal welcher Reiter offen ist */
  const [source, setSource] = useState<Tab>('radio');
  const [youtubeItems, setYoutubeItems] = useState<YouTubeItem[]>([]);
  /** dieses Radio ist einem Room beigetreten (hört mit oder steuert den Host) */
  const joined = !!prefs.room.join;
  const [hostname, setHostname] = useState('PC');

  const audioRef = useRef<HTMLAudioElement>(null);
  const ytAudioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef(0);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef<number>();
  const stationNamesRef = useRef<string[]>([]);

  const current = stations.find((s) => s.id === currentId) ?? null;
  const streamUrl = wantPlay ? current?.url ?? null : null;
  stationNamesRef.current = [current?.name ?? ''];
  const stationNameRef = useRef('');
  stationNameRef.current = current?.name ?? '';

  // --- Einstellungen laden/speichern ---------------------------------------

  useEffect(() => {
    api.loadSettings().then((settings) => {
      const list = settings?.stations ?? DEFAULT_STATIONS;
      setStations(list);
      if (typeof settings?.volume === 'number') setVolume(settings.volume);
      const last = settings?.lastStationId;
      setCurrentId(last && list.some((s) => s.id === last) ? last : list[0]?.id ?? null);
      const loadedPrefs: Preferences = {
        ...DEFAULT_PREFS,
        ...settings?.prefs,
        schedule: { ...DEFAULT_PREFS.schedule, ...settings?.prefs?.schedule },
        spotify: { ...DEFAULT_PREFS.spotify, ...settings?.prefs?.spotify },
        bluetooth: { ...DEFAULT_PREFS.bluetooth, ...settings?.prefs?.bluetooth },
        airplay: { ...DEFAULT_PREFS.airplay, ...settings?.prefs?.airplay },
        remote: { ...DEFAULT_PREFS.remote, ...settings?.prefs?.remote },
        room: { ...DEFAULT_PREFS.room, ...settings?.prefs?.room },
        tabs: { ...DEFAULT_PREFS.tabs, ...settings?.prefs?.tabs },
      };
      if (!THEMES.some((t) => t.id === loadedPrefs.theme)) loadedPrefs.theme = 'standard';
      if (!loadedPrefs.room.clientId) loadedPrefs.room.clientId = newClientId();
      // Im Room hört man mit statt selbst zu starten
      const inRoom = !!loadedPrefs.room.join;
      setPrefs(loadedPrefs);
      setHistory(settings?.history ?? []);
      setFavorites(settings?.favorites ?? []);
      setYoutubeItems(settings?.youtube ?? []);
      // Autostart: sofort spielen, wenn gewünscht oder wir im Zeitplan-Fenster sind
      if (!inRoom && (loadedPrefs.autoplay || withinSchedule(loadedPrefs.schedule, new Date()))) {
        setWantPlay(true);
        if (loadedPrefs.startFullscreen) setFullscreen(true);
      }
      setSettingsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = window.setTimeout(
      () => api.saveSettings({ stations, volume, lastStationId: currentId, prefs, history, favorites, youtube: youtubeItems }),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [settingsLoaded, stations, volume, currentId, prefs, history, favorites, youtubeItems]);

  // --- Zeitplan ----------------------------------------------------------------

  const lastScheduleRef = useRef('');
  useEffect(() => {
    if (!prefs.schedule.enabled) return;
    const check = () => {
      const now = new Date();
      const { schedule } = prefs;
      if (!schedule.days.includes(now.getDay())) return;
      const time = hhmm(now);
      const key = `${now.toDateString()} ${time}`;
      if (lastScheduleRef.current === key) return;
      if (time === schedule.start) {
        lastScheduleRef.current = key;
        retriesRef.current = 0;
        setWantPlay(true);
        if (prefs.startFullscreen) setFullscreen(true);
      } else if (time === schedule.stop) {
        lastScheduleRef.current = key;
        setWantPlay(false);
        setFullscreen(false);
      }
    };
    check();
    const timer = window.setInterval(check, 15_000);
    return () => window.clearInterval(timer);
  }, [prefs]);

  // --- Automatische Logo-Suche (ein Sender nach dem anderen) ------------------

  const logoPending = stations.find((s) => !s.logo && !s.logoChecked) ?? null;
  const logoPendingKey = logoPending ? `${logoPending.id}|${logoPending.name}|${logoPending.url}` : null;
  useEffect(() => {
    if (!settingsLoaded || !logoPending) return;
    const { id, name, url } = logoPending;
    let cancelled = false;
    findStationLogo(name, url).then((logo) => {
      if (cancelled) return;
      setStations((list) =>
        list.map((s) => (s.id === id && !s.logo ? { ...s, logo: logo ?? undefined, logoChecked: true } : s)),
      );
    });
    return () => {
      cancelled = true;
    };
    // nur neu starten, wenn sich der zu prüfende Sender ändert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, logoPendingKey]);

  // --- Wiedergabe ------------------------------------------------------------

  // In der Desktop-App läuft der Ton über WebAudio (für den Visualizer). Die Streams kommen
  // dann vom lokalen Proxy, der die nötige CORS-Freigabe mitschickt.
  useEffect(() => {
    if (isDesktop && audioRef.current) {
      const g = connectAudio(audioRef.current);
      if (g && ytAudioRef.current) attachToGraph(g, ytAudioRef.current);
      setGraph(g);
    }
  }, []);

  useEffect(() => {
    for (const audio of [audioRef.current, ytAudioRef.current]) {
      if (!audio) continue;
      audio.volume = graph ? 1 : volume;
      audio.muted = graph ? false : muted;
    }
    graph?.gain.gain.setTargetAtTime(muted ? 0 : volume, graph.context.currentTime, 0.05);
  }, [volume, muted, graph]);

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
      setHistory((list) => (list[0] && sameTrack(list[0], track) ? list : [track, ...list].slice(0, MAX_HISTORY)));
      if (!info) return;
      setNowPlaying((prev) =>
        prev && prev.raw === trackKey
          ? { ...prev, cover: track.cover, album: track.album, artist: track.artist, title: track.title }
          : prev,
      );
    });
    return () => {
      cancelled = true;
    };
    // nur bei neuem Titel suchen, nicht nach der eigenen Aktualisierung
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);

  // --- Steuerung ---------------------------------------------------------------

  const togglePlay = useCallback(() => {
    if (!current) return;
    retriesRef.current = 0;
    setWantPlay((p) => !p);
  }, [current]);

  const selectStation = useCallback((id: string) => {
    retriesRef.current = 0;
    setTab('radio');
    setCurrentId(id);
    setWantPlay(true);
  }, []);

  const step = useCallback(
    (delta: number) => {
      if (stations.length === 0) return;
      const index = stations.findIndex((s) => s.id === currentId);
      const next = stations[(index + delta + stations.length) % stations.length];
      retriesRef.current = 0;
      setCurrentId(next.id);
    },
    [stations, currentId],
  );
  const prevStation = useCallback(() => step(-1), [step]);
  const nextStation = useCallback(() => step(1), [step]);

  const saveStation = (values: Omit<Station, 'id'>) => {
    if (editing === 'new') {
      const station = { id: newStationId(), ...values };
      setStations((list) => [...list, station]);
      if (!currentId) setCurrentId(station.id);
    } else if (editing) {
      // Logo bewusst geleert -> nicht automatisch neu befüllen;
      // neuer Name/neue Adresse ohne Logo -> erneut suchen
      const clearedLogo = Boolean(editing.logo) && !values.logo;
      const sourceChanged = values.url !== editing.url || values.name !== editing.name;
      const logoChecked = values.logo || clearedLogo ? true : sourceChanged ? false : editing.logoChecked;
      setStations((list) => list.map((s) => (s.id === editing.id ? { ...s, ...values, logoChecked } : s)));
    }
    setEditing(null);
  };

  const deleteStation = (id: string) => {
    const index = stations.findIndex((s) => s.id === id);
    const remaining = stations.filter((s) => s.id !== id);
    setStations(remaining);
    if (id === currentId) {
      setWantPlay(false);
      setCurrentId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
    }
  };

  const closeEditor = useCallback(() => setEditing(null), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeStore = useCallback(() => setStoreOpen(false), []);

  // --- Sender-Store ------------------------------------------------------------------

  const addFromStore = (station: StoreStation, name: string) => {
    const added: Station = { id: newStationId(), name, url: station.url };
    setStations((list) => [...list, added]);
    if (!currentId) setCurrentId(added.id);
  };

  // Hörprobe im Store: Hauptplayer anhalten und danach wieder fortsetzen
  const wantPlayRef = useRef(wantPlay);
  wantPlayRef.current = wantPlay;
  const previewRef = useRef({ active: false, resume: false });
  const handlePreviewChange = useCallback((active: boolean) => {
    const preview = previewRef.current;
    if (active && !preview.active) {
      preview.active = true;
      preview.resume = wantPlayRef.current;
      setWantPlay(false);
    } else if (!active && preview.active) {
      preview.active = false;
      if (preview.resume) setWantPlay(true);
    }
  }, []);

  const moveStation = (id: string, toIndex: number) => {
    setStations((list) => {
      const from = list.findIndex((s) => s.id === id);
      if (from < 0) return list;
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(from < toIndex ? toIndex - 1 : toIndex, 0, moved);
      return next;
    });
  };

  // --- Merkliste -------------------------------------------------------------------

  const isFavorite = useCallback(
    (track: Pick<Track, 'artist' | 'title'>) => favorites.some((f) => sameTrack(f, track)),
    [favorites],
  );
  const toggleFavorite = (track: Track) =>
    setFavorites((list) =>
      list.some((f) => sameTrack(f, track)) ? list.filter((f) => !sameTrack(f, track)) : [track, ...list],
    );
  const currentTrack: Track | null =
    nowPlaying?.artist && nowPlaying.title
      ? history.find((t) => sameTrack(t, { artist: nowPlaying.artist!, title: nowPlaying.title! })) ?? {
          id: `t-${nowPlaying.raw}`,
          artist: nowPlaying.artist,
          title: nowPlaying.title,
          album: nowPlaying.album,
          cover: nowPlaying.cover,
          station: current?.name ?? '',
          time: new Date().toISOString(),
        }
      : null;

  // --- Spotify Connect ---------------------------------------------------------------

  useEffect(() => {
    api.getHostname().then(setHostname);
  }, []);

  const spotify = useSpotify({ ...prefs.spotify, enabled: prefs.spotify.enabled && prefs.tabs.spotify }, settingsLoaded);
  const sp = spotify.state;
  const spotifyPlaying = isSpotifyPlaying(sp);
  const spotifyDefaultName = `Radio ${hostname}`;

  // Kommt ein Spotify-Stream herein: Radio anhalten, zum Spotify-Reiter wechseln und merken,
  // ob danach das Radio wieder weiterlaufen soll.
  const radioResumeRef = useRef(false);
  const lastSpotifyPlayingRef = useRef(false);
  useEffect(() => {
    if (spotifyPlaying && !lastSpotifyPlayingRef.current) {
      if (wantPlayRef.current) radioResumeRef.current = true;
      setWantPlay(false);
      youtubeRef.current.pause();
      setSource('spotify');
      setTab('spotify');
    }
    lastSpotifyPlayingRef.current = spotifyPlaying;
  }, [spotifyPlaying]);

  // Spotify-Sitzung beendet (anderes Gerät gewählt, getrennt): zurück zum Radio, falls es vorher lief
  const lastSpotifyActiveRef = useRef(false);
  useEffect(() => {
    if (!sp.active && lastSpotifyActiveRef.current && radioResumeRef.current) {
      radioResumeRef.current = false;
      setTab('radio');
      setWantPlay(true);
    }
    lastSpotifyActiveRef.current = sp.active;
  }, [sp.active]);

  // Radio wird gestartet, während Spotify spielt: Spotify pausieren, damit nicht beides läuft
  useEffect(() => {
    if (wantPlay) {
      setSource('radio');
      youtubeRef.current.pause();
    }
    if (wantPlay && isSpotifyPlaying(spotifyStateRef.current)) {
      radioResumeRef.current = false;
      spotify.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantPlay]);
  const spotifyStateRef = useRef(sp);
  spotifyStateRef.current = sp;

  // Spotify-Titel kommen ebenfalls in den Verlauf
  const spotifyTrackUri = spotifyPlaying ? sp.track?.uri : undefined;
  useEffect(() => {
    const t = spotifyStateRef.current.track;
    if (!spotifyTrackUri || !t) return;
    const track: Track = {
      id: `s-${Date.now().toString(36)}`,
      artist: t.artists.join(', '),
      title: t.name,
      album: t.album || null,
      cover: t.cover,
      station: 'Spotify',
      time: new Date().toISOString(),
    };
    setHistory((list) => (list[0] && sameTrack(list[0], track) ? list : [track, ...list].slice(0, MAX_HISTORY)));
  }, [spotifyTrackUri]);

  const spotifyNowPlaying: NowPlaying | null = sp.active && sp.track
    ? {
        raw: sp.track.uri,
        kind: 'music',
        artist: sp.track.artists.join(', '),
        title: sp.track.name,
        album: sp.track.album || null,
        cover: sp.track.cover,
      }
    : null;

  const spotifyStatusText = !prefs.spotify.enabled
    ? 'Spotify aus'
    : spotifyPlaying
      ? 'Spotify läuft'
      : sp.active
        ? 'Pausiert'
        : sp.connected
          ? 'Bereit für Spotify'
          : sp.process.error
            ? 'Fehler'
            : 'Startet …';
  const spotifyStatusClass: PlayerStatus = spotifyPlaying
    ? 'playing'
    : sp.process.error && !sp.process.running
      ? 'error'
      : prefs.spotify.enabled && !sp.connected
        ? 'loading'
        : 'idle';

  // --- Bluetooth-Empfang -------------------------------------------------------------

  const bt = useBluetooth(prefs.bluetooth.enabled && prefs.tabs.bluetooth, settingsLoaded);
  const btDevice = bt.connected;
  const btMedia = btDevice ? bt.state.media : null;
  const btPlaying = !!btDevice && (btMedia ? btMedia.playing : true);

  // Handy verbindet sich: Radio/Spotify anhalten und zum Bluetooth-Reiter wechseln
  const lastBtDeviceRef = useRef<string | null>(null);
  useEffect(() => {
    const id = btDevice?.id ?? null;
    if (id && !lastBtDeviceRef.current) {
      if (wantPlayRef.current) radioResumeRef.current = true;
      setWantPlay(false);
      youtubeRef.current.pause();
      setSource('bluetooth');
      if (isSpotifyPlaying(spotifyStateRef.current)) spotify.pause();
      setTab('bluetooth');
    } else if (!id && lastBtDeviceRef.current && radioResumeRef.current) {
      radioResumeRef.current = false;
      setTab('radio');
      setWantPlay(true);
    }
    lastBtDeviceRef.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btDevice?.id]);

  // Radio wird gestartet, während das Handy per Bluetooth spielt: Handy pausieren (sofern steuerbar)
  const btPlayingRef = useRef(false);
  btPlayingRef.current = !!btMedia?.playing;
  useEffect(() => {
    if (wantPlay && btPlayingRef.current) {
      radioResumeRef.current = false;
      bt.mediaAction('playpause');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantPlay]);

  // Bluetooth-Titel in den Verlauf
  const btTrackKey = btMedia?.playing && btMedia.title ? `${btMedia.artist}|${btMedia.title}` : null;
  useEffect(() => {
    if (!btTrackKey || !btMedia) return;
    const track: Track = {
      id: `b-${Date.now().toString(36)}`,
      artist: btMedia.artist,
      title: btMedia.title,
      album: btMedia.album || null,
      cover: null, // Bilder vom Handy sind nur Datenblöcke – nicht im Verlauf speichern
      station: `Bluetooth (${btDevice?.name ?? 'Handy'})`,
      time: new Date().toISOString(),
    };
    setHistory((list) => (list[0] && sameTrack(list[0], track) ? list : [track, ...list].slice(0, MAX_HISTORY)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btTrackKey]);

  const btNowPlaying: NowPlaying | null = btMedia?.title
    ? {
        raw: `${btMedia.artist} - ${btMedia.title}`,
        kind: 'music',
        artist: btMedia.artist,
        title: btMedia.title,
        album: btMedia.album || null,
        cover: btMedia.cover,
      }
    : null;
  const btStation: Station = { id: 'bluetooth', name: btDevice ? `Bluetooth · ${btDevice.name}` : 'Bluetooth', url: '' };
  const btStatusText = !prefs.bluetooth.enabled
    ? 'Bluetooth aus'
    : btDevice
      ? btPlaying
        ? 'Bluetooth läuft'
        : 'Pausiert'
      : bt.state.ready
        ? 'Bereit für Bluetooth'
        : 'Startet …';
  const btStatusClass: PlayerStatus = btDevice
    ? btPlaying
      ? 'playing'
      : 'idle'
    : prefs.bluetooth.enabled && !bt.state.ready
      ? 'loading'
      : 'idle';

  // --- AirPlay ------------------------------------------------------------------------

  const ap = useAirPlay(prefs.airplay.enabled && prefs.tabs.airplay, prefs.airplay.name, settingsLoaded);
  const apSession = !!ap.state.client;
  const apPlaying = apSession && ap.state.playing;

  // iPhone startet AirPlay: Radio/Spotify anhalten und zum AirPlay-Reiter wechseln
  const lastApPlayingRef = useRef(false);
  useEffect(() => {
    if (apPlaying && !lastApPlayingRef.current) {
      if (wantPlayRef.current) radioResumeRef.current = true;
      setWantPlay(false);
      youtubeRef.current.pause();
      setSource('airplay');
      if (isSpotifyPlaying(spotifyStateRef.current)) spotify.pause();
      setTab('airplay');
    }
    lastApPlayingRef.current = apPlaying;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apPlaying]);

  // AirPlay beendet: zurück zum Radio, falls es vorher lief
  const lastApSessionRef = useRef(false);
  useEffect(() => {
    if (!apSession && lastApSessionRef.current && radioResumeRef.current) {
      radioResumeRef.current = false;
      setTab('radio');
      setWantPlay(true);
    }
    lastApSessionRef.current = apSession;
  }, [apSession]);

  // AirPlay-Titel in den Verlauf
  const apTrackKey = apPlaying && ap.state.title ? `${ap.state.artist}|${ap.state.title}` : null;
  useEffect(() => {
    if (!apTrackKey || !ap.state.title) return;
    const track: Track = {
      id: `a-${Date.now().toString(36)}`,
      artist: ap.state.artist ?? '',
      title: ap.state.title,
      album: ap.state.album,
      cover: null, // Cover vom iPhone sind Datenblöcke – nicht im Verlauf speichern
      station: `AirPlay (${ap.state.client ?? 'iPhone'})`,
      time: new Date().toISOString(),
    };
    setHistory((list) => (list[0] && sameTrack(list[0], track) ? list : [track, ...list].slice(0, MAX_HISTORY)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apTrackKey]);

  const apNowPlaying: NowPlaying | null = ap.state.title
    ? {
        raw: `${ap.state.artist ?? ''} - ${ap.state.title}`,
        kind: 'music',
        artist: ap.state.artist,
        title: ap.state.title,
        album: ap.state.album,
        cover: ap.state.cover,
      }
    : null;
  const apStation: Station = { id: 'airplay', name: ap.state.client ? `AirPlay · ${ap.state.client}` : 'AirPlay', url: '' };
  const apStatusText = !prefs.airplay.enabled
    ? 'AirPlay aus'
    : apSession
      ? apPlaying
        ? 'AirPlay läuft'
        : 'Pausiert'
      : ap.state.error
        ? 'Fehler'
        : ap.state.running
          ? 'Bereit für AirPlay'
          : 'Startet …';
  const apStatusClass: PlayerStatus = apPlaying
    ? 'playing'
    : ap.state.error
      ? 'error'
      : prefs.airplay.enabled && !ap.state.running
        ? 'loading'
        : 'idle';

  // --- YouTube ---------------------------------------------------------------------------

  const takeWishRef = useRef<() => YouTubeItem | null>(() => null);
  const yt = useYouTube(ytAudioRef, { nextWish: () => takeWishRef.current() });
  const youtubeRef = useRef(yt);
  youtubeRef.current = yt;
  const ytNow = yt.state.now;
  const ytPlaying = yt.state.playing;

  // YouTube startet: Radio, Spotify und Handy anhalten
  useEffect(() => {
    if (!ytPlaying) return;
    setSource('youtube');
    radioResumeRef.current = false;
    setWantPlay(false);
    if (isSpotifyPlaying(spotifyStateRef.current)) spotify.pause();
    if (btPlayingRef.current) bt.mediaAction('playpause');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytPlaying]);

  const addYoutube = async (url: string) => {
    if (!YOUTUBE_URL.test(url)) throw new Error('Das ist kein YouTube-Link (youtube.com oder youtu.be).');
    if (youtubeItems.some((i) => i.url === url)) throw new Error('Dieser Link ist schon gespeichert.');
    const info = await api.youtubeInfo(url);
    const item: YouTubeItem = {
      id: newStationId(),
      url,
      title: info.title,
      channel: info.channel,
      thumbnail: info.thumbnail,
      kind: info.kind,
      count: info.kind === 'playlist' ? info.entries.length : undefined,
    };
    setYoutubeItems((list) => [...list, item]);
  };
  const moveYoutube = (id: string, toIndex: number) =>
    setYoutubeItems((list) => {
      const from = list.findIndex((i) => i.id === id);
      if (from < 0) return list;
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(from < toIndex ? toIndex - 1 : toIndex, 0, moved);
      return next;
    });
  const deleteYoutube = (id: string) => {
    if (ytNow?.item.id === id) yt.stop();
    setYoutubeItems((list) => list.filter((i) => i.id !== id));
  };

  // YouTube-Titel in den Verlauf
  const ytTrackKey = ytNow && yt.state.status === 'playing' ? `${ytNow.item.id}|${ytNow.index}|${ytNow.title}` : null;
  useEffect(() => {
    if (!ytTrackKey || !ytNow) return;
    const track: Track = {
      id: `y-${Date.now().toString(36)}`,
      artist: ytNow.channel ?? '',
      title: ytNow.title,
      album: ytNow.entries.length > 1 ? ytNow.item.title : null,
      cover: ytNow.fallbackCover ?? ytNow.cover,
      station: 'YouTube',
      time: new Date().toISOString(),
    };
    setHistory((list) => (list[0] && sameTrack(list[0], track) ? list : [track, ...list].slice(0, MAX_HISTORY)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytTrackKey]);

  const ytNowPlaying: NowPlaying | null = ytNow
    ? {
        raw: ytNow.title,
        kind: 'music',
        artist: ytNow.channel,
        title: ytNow.title,
        album: ytNow.entries.length > 1 ? ytNow.item.title : null,
        cover: ytNow.cover,
      }
    : null;
  const ytStation: Station = { id: 'youtube', name: ytNow && ytNow.entries.length > 1 ? `YouTube · ${ytNow.item.title}` : 'YouTube', url: '' };
  const ytStatusText =
    yt.state.status === 'loading'
      ? 'Lade von YouTube …'
      : yt.state.status === 'error'
        ? 'YouTube-Fehler'
        : ytPlaying
          ? ytNow?.live
            ? 'YouTube live'
            : 'YouTube läuft'
          : ytNow
            ? 'Pausiert'
            : 'Bereit';

  // --- Was zeigt die Mitte? ------------------------------------------------------------
  // Die zuletzt gestartete Quelle, solange sie aktiv ist – sonst die des offenen Reiters.
  const sourceActive: Record<Tab, boolean> = {
    radio: wantPlay,
    // auch pausiert: "Play" (z. B. vom Handy) soll YouTube fortsetzen statt das Radio zu starten
    youtube: ytPlaying || yt.state.status === 'loading' || !!ytNow,
    spotify: sp.active,
    airplay: apSession,
    bluetooth: !!btDevice,
  };
  // Offener Reiter wurde ausgeblendet: auf den ersten sichtbaren wechseln
  useEffect(() => {
    if (!prefs.tabs[tab]) setTab(TABS.find((t) => prefs.tabs[t.id])?.id ?? 'radio');
  }, [prefs.tabs, tab]);
  const view: Tab = sourceActive[source] ? source : tab;

  const onSpotifyTab = view === 'spotify';
  const onBtTab = view === 'bluetooth';
  const onApTab = view === 'airplay';
  const onYtTab = view === 'youtube';
  const noControl = { canControl: false, toggle: () => {}, prev: () => {}, next: () => {}, volume: 1, setVolume: () => {} };
  const ui = onApTab
    ? { ...noControl, isPlaying: apPlaying }
    : onYtTab
    ? {
        isPlaying: ytPlaying,
        canControl: !!ytNow,
        toggle: yt.toggle,
        prev: yt.prev,
        next: yt.next,
        volume: muted ? 0 : volume,
        setVolume: (v: number) => {
          setVolume(v);
          setMuted(false);
        },
      }
    : onBtTab
    ? {
        isPlaying: btPlaying,
        canControl: !!btMedia,
        toggle: () => bt.mediaAction('playpause'),
        prev: () => bt.mediaAction('prev'),
        next: () => bt.mediaAction('next'),
        volume: 1,
        setVolume: () => {},
      }
    : onSpotifyTab
    ? {
        isPlaying: spotifyPlaying,
        canControl: sp.active,
        toggle: spotify.playPause,
        prev: spotify.prev,
        next: spotify.next,
        volume: sp.volume,
        setVolume: spotify.setVolume,
      }
    : {
        isPlaying: wantPlay,
        canControl: !!current,
        toggle: togglePlay,
        prev: prevStation,
        next: nextStation,
        volume: muted ? 0 : volume,
        setVolume: (v: number) => {
          setVolume(v);
          setMuted(false);
        },
      };

  // --- Vollbild ------------------------------------------------------------------

  useEffect(() => {
    api.setFullScreen(fullscreen).catch(() => {});
  }, [fullscreen]);

  useEffect(() => {
    // Im Browser kann der Nutzer das Vollbild auch selbst verlassen
    const onChange = () => !document.fullscreenElement && !isDesktop && setFullscreen(false);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // --- Tastatur ------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || settingsOpen || storeOpen || remoteOpen || roomOpen || joined) return;
      if (e.key === 'F11') {
        e.preventDefault();
        setFullscreen((f) => !f);
      } else if (e.key === 'Escape') {
        setFullscreen(false);
      } else if (!isTypingTarget(e.target)) {
        if (e.key === ' ') {
          e.preventDefault();
          ui.toggle();
        } else if (e.key === 'ArrowRight') ui.next();
        else if (e.key === 'ArrowLeft') ui.prev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, settingsOpen, storeOpen, remoteOpen, roomOpen, joined, ui.toggle, ui.next, ui.prev]);

  // --- Windows-Medienanzeige (Medientasten, Overlay) -------------------------

  const viewStation = onApTab ? apStation : onBtTab ? btStation : onSpotifyTab ? SPOTIFY_STATION : onYtTab ? ytStation : current;
  const viewNowPlaying = onApTab ? apNowPlaying : onBtTab ? btNowPlaying : onSpotifyTab ? spotifyNowPlaying : onYtTab ? ytNowPlaying : nowPlaying;
  const viewStatus: PlayerStatus = onApTab
    ? apStatusClass
    : onBtTab
      ? btStatusClass
      : onSpotifyTab
        ? spotifyPlaying
          ? 'playing'
          : 'idle'
        : onYtTab
          ? yt.state.status
          : status;

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: viewNowPlaying?.title ?? viewStation?.name ?? 'Radio',
      artist: viewNowPlaying?.artist ?? (viewNowPlaying?.title ? '' : viewStation?.name ?? ''),
      album: viewNowPlaying?.album ?? viewStation?.name ?? '',
      artwork: viewNowPlaying?.cover?.startsWith('http') ? [{ src: viewNowPlaying.cover, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
  }, [viewNowPlaying?.title, viewNowPlaying?.artist, viewNowPlaying?.album, viewNowPlaying?.cover, viewStation?.name]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = ui.isPlaying ? 'playing' : 'paused';
  }, [ui.isPlaying]);

  const uiRef = useRef(ui);
  uiRef.current = ui;
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    // play/pause gezielt setzen statt umschalten – sonst kann ein doppelt ankommendes
    // Signal (Medientaste, Windows-Overlay) die Wiedergabe ungewollt beenden
    const handlers: [MediaSessionAction, () => void][] = [
      ['play', () => !uiRef.current.isPlaying && uiRef.current.toggle()],
      ['pause', () => uiRef.current.isPlaying && uiRef.current.toggle()],
      ['stop', () => uiRef.current.isPlaying && uiRef.current.toggle()],
      ['previoustrack', () => uiRef.current.prev()],
      ['nexttrack', () => uiRef.current.next()],
    ];
    for (const [action, handler] of handlers) navigator.mediaSession.setActionHandler(action, handler);
  }, []);

  // --- Fernbedienung (Handy) -------------------------------------------------------------

  const httpOnly = (url: string | null | undefined) => (url && /^https?:\/\//.test(url) ? url : null);
  // Für Radios im Room: was sie selbst abspielen müssen, um mitzuhören
  const ytEntry = ytNow?.entries[ytNow.index];
  const hostListen: HostListen =
    view === 'radio' && wantPlay && current
      ? { kind: 'radio', url: current.url }
      : onYtTab && ytNow
        ? {
            kind: 'youtube',
            url: ytEntry ? watchUrl(ytEntry.id) : ytNow.item.url,
            live: ytNow.live,
            position: ytNow.live ? 0 : Math.round(yt.position() / 100) / 10,
            at: ytNow.live ? 0 : Date.now(),
          }
        : { kind: 'none', reason: onSpotifyTab ? 'Spotify' : onApTab ? 'AirPlay' : onBtTab ? 'Bluetooth' : '' };
  const remoteSnapshot = {
    source: view,
    sourceName: viewStation?.name ?? '',
    status: viewStatus,
    playing: ui.isPlaying,
    canControl: ui.canControl,
    title: viewNowPlaying?.title ?? null,
    artist: viewNowPlaying?.artist ?? null,
    album: viewNowPlaying?.album ?? null,
    cover: httpOnly(onYtTab ? ytNow?.fallbackCover ?? ytNow?.cover : viewNowPlaying?.cover),
    wishedBy: onYtTab ? ytNow?.item.wishedBy ?? null : null,
    live: onYtTab ? !!ytNow?.live : view === 'radio',
    volume: Math.round(ui.volume * 100) / 100,
    volumeEnabled: !(onBtTab || onApTab || (onSpotifyTab && !sp.active)),
    progress:
      onYtTab && ytNow && !ytNow.live && ytNow.duration
        ? { position: Math.round(yt.position()), duration: ytNow.duration, at: Date.now() }
        : null,
    stations: stations.map((st) => ({ id: st.id, name: st.name, logo: httpOnly(st.logo) })),
    currentStationId: view === 'radio' ? currentId : null,
    youtube: youtubeItems.map((i) => ({ id: i.id, title: i.title, thumbnail: httpOnly(i.thumbnail), kind: i.kind })),
    listen: hostListen,
    receivers: {
      spotify: {
        enabled: prefs.spotify.enabled && prefs.tabs.spotify,
        name: prefs.spotify.deviceName.trim() || spotifyDefaultName,
        running: sp.process.running,
        client: sp.active ? sp.username ?? 'Spotify' : null,
        error: sp.process.error,
      },
      airplay: {
        enabled: prefs.airplay.enabled && prefs.tabs.airplay,
        name: ap.state.name || prefs.airplay.name.trim() || `Radio ${hostname}`,
        running: ap.state.running,
        client: ap.state.client,
        error: ap.state.error,
      },
    },
  };
  // Auch ein pausierter YouTube-Titel zählt: Der Wunsch kommt danach, statt ihn zu verdrängen
  const anythingActive = wantPlay || !!ytNow || yt.state.status === 'loading' || spotifyPlaying || apSession || !!btDevice;
  const roomName = prefs.room.name.trim() || `Radio ${hostname}`;
  const remote = useRemote(prefs.remote, { open: prefs.room.open, name: roomName }, settingsLoaded, remoteSnapshot, {
    toggle: () => uiRef.current.toggle(),
    next: () => uiRef.current.next(),
    prev: () => uiRef.current.prev(),
    setVolume: (v) => uiRef.current.setVolume(v),
    selectStation: (id) => {
      if (!stations.some((st) => st.id === id)) return false;
      selectStation(id);
      return true;
    },
    playYoutube: (id) => {
      const item = youtubeItems.find((i) => i.id === id);
      if (!item) return false;
      yt.play(item);
      return true;
    },
    startWishes: () => {
      const wish = takeWishRef.current();
      if (wish) yt.playWish(wish);
    },
    // Läuft gar nichts, startet ein Wunsch sofort – sonst wartet er, bis YouTube weiterspielt
    wishAdded: () => {
      if (!anythingActive) {
        const wish = takeWishRef.current();
        if (wish) yt.playWish(wish);
      }
    },
    // Admin im Room: Empfang am Host schalten – beim Einschalten auch den Reiter einblenden
    setReceiver: (kind, enabled) =>
      setPrefs((p) => ({
        ...p,
        [kind]: { ...p[kind], enabled },
        tabs: enabled ? { ...p.tabs, [kind]: true } : p.tabs,
      })),
  });
  takeWishRef.current = remote.takeWish;

  // --- Rooms: dieses Radio hört bei einem anderen mit oder steuert es ------------------------

  const room = useRoom(prefs.room, settingsLoaded, roomName);

  const setRoom = (patch: Partial<RoomPrefs>) =>
    setPrefs((p) => ({
      ...p,
      room: { ...p.room, ...patch },
      // Als Host braucht es den Webserver und damit einen Schlüssel
      remote: patch.open && !p.remote.key ? { ...p.remote, key: newRemoteKey() } : p.remote,
    }));
  // Beim Beitreten die eigene Wiedergabe beenden
  useEffect(() => {
    if (!joined) return;
    setWantPlay(false);
    youtubeRef.current.stop();
    if (isSpotifyPlaying(spotifyStateRef.current)) spotify.pause();
    setFullscreen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);

  const update = useUpdate(prefs.autoUpdate, settingsLoaded);

  // --- Startanzeige: was im Hintergrund noch hochfährt ------------------------------------

  const startupItems: StartupItem[] = [{ label: 'Einstellungen und Sender', state: settingsLoaded ? 'done' : 'pending' }];
  if (prefs.spotify.enabled)
    startupItems.push({ label: 'Spotify Connect', state: sp.connected ? 'done' : sp.process.error ? 'error' : 'pending' });
  if (prefs.airplay.enabled)
    startupItems.push({ label: 'AirPlay', state: ap.state.running ? 'done' : ap.state.error ? 'error' : 'pending' });
  if (prefs.bluetooth.enabled)
    startupItems.push({ label: 'Bluetooth-Empfang', state: bt.state.ready ? 'done' : bt.state.error ? 'error' : 'pending' });
  if (prefs.remote.enabled)
    startupItems.push({
      label: 'Fernbedienung',
      state: remote.info.running ? 'done' : remote.info.error ? 'error' : 'pending',
      detail: remote.info.running && remote.info.addresses?.[0] ? remote.info.addresses[0].address : undefined,
    });
  if (joined)
    startupItems.push({
      label: `Room ${prefs.room.join?.name ?? ''}`,
      state: room.status === 'connected' ? 'done' : room.status === 'error' ? 'error' : 'pending',
    });
  if (wantPlay && view === 'radio')
    startupItems.push({ label: current ? `Sender ${current.name}` : 'Sender', state: status === 'playing' ? 'done' : status === 'error' ? 'error' : 'pending' });

  // --- Darstellung -----------------------------------------------------------------

  const cover = onApTab
    ? ap.state.client
      ? ap.state.cover
      : null
    : onBtTab
        ? btMedia?.cover ?? null
        : onSpotifyTab
          ? sp.track?.cover ?? null
          : onYtTab
            ? ytNow?.cover ?? null
            : nowPlaying?.cover ?? null;
  const setSidebarOpen = (open: boolean) => setPrefs((p) => ({ ...p, sidebarOpen: open }));
  const closeSidebar = () => setSidebarOpen(false);
  const volumeStyle = { '--fill': `${ui.volume * 100}%` } as CSSProperties;
  const visibleTabs = TABS.filter((t) => prefs.tabs[t.id]);
  const theme = prefs.theme;
  const deck = DECK_THEMES.includes(theme) ? deckStations(stations, currentId) : [];
  const analyser = graph?.analyser ?? null;
  const tabPlaying: Record<Tab, boolean> = {
    radio: wantPlay,
    youtube: ytPlaying,
    spotify: spotifyPlaying,
    airplay: apSession,
    bluetooth: !!btDevice,
  };

  return (
    <div className={`app${prefs.sidebarOpen ? ' sidebar-open' : ''}`}>
      <audio
        ref={audioRef}
        preload="none"
        crossOrigin={isDesktop ? 'anonymous' : undefined}
        onPlaying={() => {
          retriesRef.current = 0;
          setStatus('playing');
        }}
        onWaiting={() => wantPlay && setStatus('loading')}
        onError={handleStreamFailure}
        onEnded={handleStreamFailure}
      />
      <audio ref={ytAudioRef} preload="none" crossOrigin={isDesktop ? 'anonymous' : undefined} />

      {joined ? (
        <RoomView
          room={room}
          prefs={prefs.room}
          sidebarOpen={prefs.sidebarOpen}
          onSidebar={setSidebarOpen}
          onChange={setRoom}
          onOpenDialog={() => setRoomOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          fullscreen={fullscreen}
          onFullscreen={setFullscreen}
          display={{ weatherCity: prefs.weatherCity, swapMinutes: prefs.swapMinutes, visualizer: prefs.visualizer }}
        />
      ) : (
      <>
      {prefs.sidebarOpen &&
        (tab === 'radio' ? (
          <StationList
            stations={stations}
            currentId={currentId}
            status={status}
            onSelect={selectStation}
            onAdd={() => setEditing('new')}
            onEdit={(station) => setEditing(station)}
            onDelete={deleteStation}
            onMove={moveStation}
            onOpenStore={() => setStoreOpen(true)}
            onClose={closeSidebar}
          />
        ) : tab === 'youtube' ? (
          <YouTubeSidebar
            items={youtubeItems}
            state={yt.state}
            entriesFor={yt.entriesFor}
            wishes={remote.wishes}
            onRemoveWish={remote.removeWish}
            onStartWishes={() => {
              const wish = takeWishRef.current();
              if (wish) yt.playWish(wish);
            }}
            onPlay={(item, index) => yt.play(item, index)}
            onAdd={addYoutube}
            onRename={(id, title) => setYoutubeItems((list) => list.map((i) => (i.id === id ? { ...i, title } : i)))}
            onDelete={deleteYoutube}
            onMove={moveYoutube}
            onClose={closeSidebar}
          />
        ) : tab === 'spotify' ? (
          <SpotifySidebar
            prefs={prefs.spotify}
            defaultName={spotifyDefaultName}
            state={sp}
            onPrefsChange={(spotifyPrefs) => setPrefs((p) => ({ ...p, spotify: spotifyPrefs }))}
            onForgetAccount={spotify.forgetAccount}
            onClose={closeSidebar}
          />
        ) : tab === 'airplay' ? (
          <AirPlaySidebar
            enabled={prefs.airplay.enabled}
            name={prefs.airplay.name}
            defaultName={`Radio ${hostname}`}
            state={ap.state}
            onEnabledChange={(enabled) => setPrefs((p) => ({ ...p, airplay: { ...p.airplay, enabled } }))}
            onNameChange={(name) => setPrefs((p) => ({ ...p, airplay: { ...p.airplay, name } }))}
            onClose={closeSidebar}
          />
        ) : (
          <BluetoothSidebar
            enabled={prefs.bluetooth.enabled}
            hostname={hostname}
            state={bt.state}
            connected={btDevice}
            onEnabledChange={(enabled) => setPrefs((p) => ({ ...p, bluetooth: { enabled } }))}
            onConnect={bt.connect}
            onDisconnect={bt.disconnect}
            onClose={closeSidebar}
          />
        ))}

      <main className="stage">
        <div className="stage-backdrop">{cover && <img key={cover} src={cover} alt="" />}</div>

        <header className="stage-top">
          <div className="stage-top-left">
          <button
            className={`icon-button${prefs.sidebarOpen ? ' active' : ''}`}
            onClick={() => setSidebarOpen(!prefs.sidebarOpen)}
            title={prefs.sidebarOpen ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden'}
          >
            <SidebarIcon size={20} />
          </button>
          {onYtTab ? (
            <div className={`status-chip ${yt.state.status}`}>
              <span className={`live-dot ${yt.state.status}`} />
              {ytStatusText}
            </div>
          ) : onApTab ? (
            <div className={`status-chip ${apStatusClass}`}>
              <span className={`live-dot ${apStatusClass}`} />
              {apStatusText}
            </div>
          ) : onBtTab ? (
            <div className={`status-chip ${btStatusClass}`}>
              <span className={`live-dot ${btStatusClass}`} />
              {btStatusText}
            </div>
          ) : onSpotifyTab ? (
            <div className={`status-chip ${spotifyStatusClass}`}>
              <span className={`live-dot ${spotifyStatusClass}`} />
              {spotifyStatusText}
            </div>
          ) : (
            <div className={`status-chip ${status}`}>
              <span className={`live-dot ${status}`} />
              {status === 'error' && retriesRef.current < MAX_RETRIES && wantPlay
                ? 'Verbindung verloren – neuer Versuch …'
                : STATUS_TEXT[status]}
            </div>
          )}
          </div>
          {visibleTabs.length > 1 ? (
            <div className="tabs stage-tabs" role="tablist">
              {visibleTabs.map(({ id, label }) => (
                <button key={id} role="tab" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                  {label}
                  {tabPlaying[id] && <span className={`tab-dot${id === 'radio' ? '' : ` ${id}`}`} />}
                </button>
              ))}
            </div>
          ) : (
            <div />
          )}
          <div className="stage-actions">
            <button
              className={`icon-button${libraryOpen ? ' active' : ''}`}
              onClick={() => setLibraryOpen((o) => !o)}
              title="Verlauf & gemerkte Songs"
            >
              <HistoryIcon size={20} />
            </button>
            <button
              className={`icon-button${prefs.remote.enabled ? ' active' : ''}`}
              onClick={() => setRemoteOpen(true)}
              title="Fernbedienung übers Handy"
            >
              <PhoneIcon size={20} />
              {remote.clients.some((c) => c.online) && <span className="badge-dot" />}
            </button>
            <button
              className={`icon-button${prefs.room.open ? ' active' : ''}`}
              onClick={() => setRoomOpen(true)}
              title="Room: mit anderen Radios zusammenschließen"
            >
              <RoomIcon size={20} />
              {remote.clients.some((c) => c.online && c.kind === 'radio') && <span className="badge-dot" />}
            </button>
            <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Einstellungen">
              <SettingsIcon size={20} />
            </button>
            <button className="icon-button" onClick={() => setFullscreen(true)} title="Vollbild (F11)">
              <ExpandIcon size={20} />
            </button>
          </div>
        </header>

        {onApTab ? (
          <AirPlayStage
            enabled={prefs.airplay.enabled}
            deviceName={ap.state.name || prefs.airplay.name.trim() || `Radio ${hostname}`}
            state={ap.state}
            position={ap.position}
            onEnable={() => setPrefs((p) => ({ ...p, airplay: { ...p.airplay, enabled: true } }))}
          />
        ) : onBtTab ? (
          <BluetoothStage
            enabled={prefs.bluetooth.enabled}
            hostname={hostname}
            state={bt.state}
            connected={btDevice}
            onEnable={() => setPrefs((p) => ({ ...p, bluetooth: { enabled: true } }))}
          />
        ) : onSpotifyTab ? (
          <SpotifyStage
            prefs={prefs.spotify}
            defaultName={spotifyDefaultName}
            state={sp}
            onEnable={() => setPrefs((p) => ({ ...p, spotify: { ...p.spotify, enabled: true } }))}
          />
        ) : onYtTab ? (
          <YouTubeStage
            state={yt.state}
            hasItems={youtubeItems.length > 0}
            sidebarOpen={prefs.sidebarOpen}
            position={yt.position}
            onSeek={yt.seek}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        ) : (
        <>
        {(theme === 'kofferradio' || theme === 'roehre') && deck.length > 0 && (
          <TuningScale theme={theme} stations={deck} currentId={currentId} onSelect={selectStation} />
        )}
        <section className="now-playing">
          {theme === 'roehre' && <VuMeter analyser={analyser} active={status === 'playing'} side="left" />}
          <div className={theme === 'roehre' ? 'vfd' : 'np-main'}>
          <Cover cover={cover} station={current} kind={nowPlaying?.kind} className="main-cover" />
          <div className="np-text">
            <div className="np-station">
              {current?.name}
              {nowPlaying && nowPlaying.kind !== 'program' && status === 'playing' && <KindBadge kind={nowPlaying.kind} />}
            </div>
            {theme === 'tafel' ? <FlapTrack nowPlaying={nowPlaying} station={current} /> : <TrackInfo nowPlaying={nowPlaying} station={current} />}
            {theme === 'phosphor' && <Spectrum analyser={analyser} active={status === 'playing'} />}
            {currentTrack && (
              <button
                className={`like-button${isFavorite(currentTrack) ? ' active' : ''}`}
                onClick={() => toggleFavorite(currentTrack)}
                title={isFavorite(currentTrack) ? 'Nicht mehr merken' : 'Song merken'}
              >
                <HeartIcon size={18} filled={isFavorite(currentTrack)} />
                {isFavorite(currentTrack) ? 'Gemerkt' : 'Merken'}
              </button>
            )}
          </div>
          </div>
          {theme === 'roehre' && <VuMeter analyser={analyser} active={status === 'playing'} side="right" />}
          {theme === 'kofferradio' && <div className="speaker-grille" aria-hidden="true" />}
        </section>
        {deck.length > 0 && (
          <StationDeck theme={theme} stations={deck} currentId={currentId} playing={wantPlay} onSelect={selectStation} />
        )}
        </>
        )}

        <footer className="player-bar">
          {theme === 'phosphor' && (
            <div className="key-hints" aria-hidden="true">
              [←] zurück [Leer] pause [→] weiter [F11] vollbild
            </div>
          )}
          <Controls
            isPlaying={ui.isPlaying}
            disabled={!ui.canControl}
            onToggle={ui.toggle}
            onPrev={ui.prev}
            onNext={ui.next}
          />
          <div className="volume">
            <button
              className="icon-button"
              onClick={() => (view === 'radio' || view === 'youtube') && setMuted((m) => !m)}
              title={onBtTab || onApTab ? 'Lautstärke am Handy regeln' : onSpotifyTab ? 'Spotify-Lautstärke' : muted ? 'Ton an' : 'Stumm'}
            >
              <VolumeIcon size={20} muted={ui.volume === 0} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={ui.volume}
              style={volumeStyle}
              disabled={onBtTab || onApTab || (onSpotifyTab && !sp.active)}
              aria-label={onSpotifyTab ? 'Spotify-Lautstärke' : 'Lautstärke'}
              onChange={(e) => ui.setVolume(Number(e.target.value))}
            />
          </div>
        </footer>
      </main>
      </>
      )}

      {fullscreen && !joined && (
        <FullscreenView
          station={viewStation}
          nowPlaying={viewNowPlaying}
          status={viewStatus}
          isPlaying={ui.isPlaying}
          history={history}
          weatherCity={prefs.weatherCity}
          swapMinutes={prefs.swapMinutes}
          // Spotify gibt den Ton direkt über Windows aus – dafür gibt es keine Visualisierung
          analyser={view === 'radio' || view === 'youtube' ? graph?.analyser ?? null : null}
          showVisualizer={prefs.visualizer}
          qr={prefs.remote.enabled && prefs.remote.qrInFullscreen ? remote.info.qr ?? null : null}
          onToggle={ui.toggle}
          onPrev={ui.prev}
          onNext={ui.next}
          onExit={() => setFullscreen(false)}
        />
      )}

      <StartupStatus loaded={settingsLoaded} items={startupItems} />
      <UpdateBanner state={update} />

      {libraryOpen && (
        <LibraryPanel
          history={history}
          favorites={favorites}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
          onClearHistory={() => setHistory([])}
          onClose={() => setLibraryOpen(false)}
        />
      )}

      {storeOpen && (
        <StationStore
          stations={stations}
          volume={volume}
          onAdd={addFromStore}
          onPreviewChange={handlePreviewChange}
          onClose={closeStore}
        />
      )}

      {remoteOpen && (
        <RemoteDialog
          prefs={prefs.remote}
          info={remote.info}
          clients={remote.clients}
          onChange={(remotePrefs) => setPrefs((p) => ({ ...p, remote: remotePrefs }))}
          onClose={() => setRemoteOpen(false)}
        />
      )}

      {roomOpen && (
        <RoomDialog
          prefs={prefs.room}
          defaultName={`Radio ${hostname}`}
          info={remote.info}
          clients={remote.clients}
          onChange={setRoom}
          onClose={() => setRoomOpen(false)}
        />
      )}

      {settingsOpen && <SettingsDialog prefs={prefs} update={update} onChange={setPrefs} onClose={closeSettings} />}

      {editing && (
        <StationEditor station={editing === 'new' ? null : editing} onSave={saveStation} onCancel={closeEditor} />
      )}
    </div>
  );
}
