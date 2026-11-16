import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, isDesktop, newStationId } from './api';
import { FullscreenView } from './components/FullscreenView';
import { ExpandIcon, HeartIcon, HistoryIcon, PhoneIcon, RoomIcon, SettingsIcon, SidebarIcon, VolumeIcon } from './components/Icons';
import { LibraryPanel } from './components/LibraryPanel';
import { Controls, Cover, STATUS_TEXT, TrackInfo } from './components/Player';
import { KindBadge } from './components/Segment';
import { SettingsDialog } from './components/SettingsDialog';
import { SpotifySidebar, SpotifyStage } from './components/SpotifyPanel';
import { BluetoothSidebar, BluetoothStage } from './components/BluetoothPanel';
import { YouTubeSidebar, YtDlpFooter } from './components/YouTubeSidebar';
import { YouTubeStage } from './components/YouTubeStage';
import { useYouTube } from './youtube';
import { useCast } from './cast';
import { CastButton } from './components/CastButton';
import { newRemoteKey, useRemote } from './remote';
import { useRoom } from './room';
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
import { withinSchedule } from './schedule';
import { editFromRemote } from './remoteEdit';
import { airplayView, bluetoothView, spotifyView, youtubeView } from './sourceViews';
import { sameTrack, toggleInList } from './tracks';
import { useFullscreen } from './hooks/useFullscreen';
import { useLogoSearch } from './hooks/useLogoSearch';
import { useMediaSession } from './hooks/useMediaSession';
import { useRadioStream } from './hooks/useRadioStream';
import { useRecordTrack } from './hooks/useRecordTrack';
import { useSchedule } from './hooks/useSchedule';
import { useSettings } from './hooks/useSettings';
import { useWindowKeys } from './hooks/useWindowKeys';
import { useYouTubeQueue } from './hooks/useYouTubeQueue';
import { isSpotifyPlaying, useSpotify } from './spotify';
import type { HostListen, PlayerStatus, RoomPrefs, SourceTab, Station, StoreStation, Track, YouTubeItem } from './types';
import './App.css';
import './features.css';
import './store.css';
import './spotify.css';
import './layout.css';
import { DECK_THEMES, useTheme } from './themes';
import { VOLUME_STEP } from './shortcuts';
import { moveTo } from './list';



type Tab = SourceTab;
const TABS: { id: Tab; label: string }[] = [
  { id: 'radio', label: 'Radio' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'airplay', label: 'AirPlay' },
  { id: 'bluetooth', label: 'Bluetooth' },
];
const YOUTUBE_URL = /^https?:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i;



function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName);
}

export default function App() {
  const [muted, setMuted] = useState(false);
  const [wantPlay, setWantPlay] = useState(false);
  const [editing, setEditing] = useState<Station | 'new' | null>(null);
  const [fullscreen, setFullscreen] = useFullscreen();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  // Einmalcode für ein Gerät, das sich im sicheren Modus verbinden will – groß anzeigen, bis es geklappt hat
  const [joinCode, setJoinCode] = useState<{ code: string; name: string; kind: 'phone' | 'radio' } | null>(null);
  useEffect(() => api.onRemoteCode(setJoinCode), []);

  // --- Einstellungen laden/speichern ---------------------------------------
  const {
    loaded: settingsLoaded,
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
  } = useSettings((loadedPrefs) => {
    // Autostart: sofort spielen, wenn gewünscht oder wir im Zeitplan-Fenster sind – im Room hört man mit
    if (!loadedPrefs.room.join && (loadedPrefs.autoplay || withinSchedule(loadedPrefs.schedule, new Date()))) {
      setWantPlay(true);
      if (loadedPrefs.startFullscreen) setFullscreen(true);
    }
  });
  useTheme(prefs.theme);
  const [tab, setTab] = useState<Tab>('radio');
  /** Quelle, die zuletzt gestartet wurde – sie bleibt in der Mitte, egal welcher Reiter offen ist */
  const [source, setSource] = useState<Tab>('radio');
  /** dieses Radio ist einem Room beigetreten (hört mit oder steuert den Host) */
  const joined = !!prefs.room.join;
  const [hostname, setHostname] = useState('PC');

  const audioRef = useRef<HTMLAudioElement>(null);
  const ytAudioRef = useRef<HTMLAudioElement>(null);

  const current = stations.find((s) => s.id === currentId) ?? null;

  // --- Wiedergabe, Titel & Cover ----------------------------------------------

  const radio = useRadioStream({
    audioRef,
    ytAudioRef,
    streamUrl: wantPlay ? current?.url ?? null : null,
    wantPlay,
    stationName: current?.name ?? '',
    setHistory,
  });
  const { status, nowPlaying, graph, resetRetries } = radio;

  // --- Zeitplan ----------------------------------------------------------------

  useSchedule(prefs.schedule, {
    onStart: () => {
      resetRetries();
      setWantPlay(true);
      if (prefs.startFullscreen) setFullscreen(true);
    },
    onStop: () => {
      setWantPlay(false);
      setFullscreen(false);
    },
  });

  useLogoSearch(stations, setStations, settingsLoaded);

  // --- Steuerung ---------------------------------------------------------------

  const togglePlay = useCallback(() => {
    if (!current) return;
    resetRetries();
    setWantPlay((p) => !p);
  }, [current, resetRetries]);

  const selectStation = useCallback(
    (id: string) => {
      resetRetries();
      setTab('radio');
      setCurrentId(id);
      setWantPlay(true);
    },
    [resetRetries, setCurrentId],
  );

  const step = useCallback(
    (delta: number) => {
      if (stations.length === 0) return;
      const index = stations.findIndex((s) => s.id === currentId);
      const next = stations[(index + delta + stations.length) % stations.length];
      resetRetries();
      setCurrentId(next.id);
    },
    [stations, currentId, resetRetries, setCurrentId],
  );
  const prevStation = useCallback(() => step(-1), [step]);
  const nextStation = useCallback(() => step(1), [step]);

  const saveStation = (values: Omit<Station, 'id'>, target: Station | null) => {
    if (!target) {
      const station = { id: newStationId(), ...values };
      setStations((list) => [...list, station]);
      if (!currentId) setCurrentId(station.id);
    } else {
      // Logo bewusst geleert -> nicht automatisch neu befüllen;
      // neuer Name/neue Adresse ohne Logo -> erneut suchen
      const clearedLogo = Boolean(target.logo) && !values.logo;
      const sourceChanged = values.url !== target.url || values.name !== target.name;
      const logoChecked = values.logo || clearedLogo ? true : sourceChanged ? false : target.logoChecked;
      setStations((list) => list.map((s) => (s.id === target.id ? { ...s, ...values, logoChecked } : s)));
    }
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

  const moveStation = (id: string, toIndex: number) => setStations((list) => moveTo(list, id, toIndex));

  // --- Merkliste -------------------------------------------------------------------

  const isFavorite = useCallback(
    (track: Pick<Track, 'artist' | 'title'>) => favorites.some((f) => sameTrack(f, track)),
    [favorites],
  );
  const toggleFavorite = (track: Track) => setFavorites((list) => toggleInList(list, track));
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
  useRecordTrack(spotifyPlaying ? sp.track?.uri : undefined, () => {
    const t = spotifyStateRef.current.track;
    return t
      ? { id: `s-${Date.now().toString(36)}`, artist: t.artists.join(', '), title: t.name, album: t.album || null, cover: t.cover, station: 'Spotify', time: new Date().toISOString() }
      : null;
  }, setHistory);

  const spotifyV = spotifyView(sp, prefs.spotify.enabled);
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
  useRecordTrack(btTrackKey, () =>
    btMedia
      ? {
          id: `b-${Date.now().toString(36)}`,
          artist: btMedia.artist,
          title: btMedia.title,
          album: btMedia.album || null,
          cover: null, // Bilder vom Handy sind nur Datenblöcke – nicht im Verlauf speichern
          station: `Bluetooth (${btDevice?.name ?? 'Handy'})`,
          time: new Date().toISOString(),
        }
      : null,
  setHistory);

  const btV = bluetoothView(bt.state, btDevice, prefs.bluetooth.enabled);

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
  useRecordTrack(apTrackKey, () =>
    ap.state.title
      ? {
          id: `a-${Date.now().toString(36)}`,
          artist: ap.state.artist ?? '',
          title: ap.state.title,
          album: ap.state.album,
          cover: null, // Cover vom iPhone sind Datenblöcke – nicht im Verlauf speichern
          station: `AirPlay (${ap.state.client ?? 'iPhone'})`,
          time: new Date().toISOString(),
        }
      : null,
  setHistory);

  const apV = airplayView(ap.state, prefs.airplay.enabled);

  // --- YouTube ---------------------------------------------------------------------------

  // Song zu Ende oder „Weiter“: die Queue rückt nach (der Ref wird unten gesetzt, sobald die Queue da ist)
  const ytEndedRef = useRef(() => {});
  const yt = useYouTube(ytAudioRef, { onEnded: () => ytEndedRef.current() });
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
  const moveYoutube = (id: string, toIndex: number) => setYoutubeItems((list) => moveTo(list, id, toIndex));
  const deleteYoutube = (id: string) => {
    setYoutubeItems((list) => list.filter((i) => i.id !== id));
  };

  // YouTube-Titel in den Verlauf
  const ytTrackKey = ytNow && yt.state.status === 'playing' ? `${ytNow.item.id}|${ytNow.title}` : null;
  useRecordTrack(ytTrackKey, () =>
    ytNow
      ? {
          id: `y-${Date.now().toString(36)}`,
          artist: ytNow.channel ?? '',
          title: ytNow.title,
          album: ytNow.item.from ?? null,
          cover: ytNow.fallbackCover ?? ytNow.cover,
          station: 'YouTube',
          time: new Date().toISOString(),
        }
      : null,
  setHistory);

  const ytV = youtubeView(yt.state);

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
        // Play nimmt immer, was oben in der Queue steht
        toggle: () => (ytPlaying ? yt.pause() : startQueueRef.current()),
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

  // --- Windows-Medienanzeige (Medientasten, Overlay) -------------------------

  const viewSource = onApTab ? apV : onBtTab ? btV : onSpotifyTab ? spotifyV : onYtTab ? ytV : null;
  const viewStation = viewSource ? viewSource.station : current;
  const viewNowPlaying = viewSource ? viewSource.nowPlaying : nowPlaying;
  // Spotify zeigt nur „spielt“ oder nicht – Verbindungsstatus steht im eigenen Statusfeld
  const viewStatus: PlayerStatus = onSpotifyTab ? (spotifyPlaying ? 'playing' : 'idle') : viewSource ? viewSource.status : status;

  useMediaSession(viewNowPlaying, viewStation, ui);
  const uiRef = useRef(ui);
  uiRef.current = ui;

  // --- Fernbedienung (Handy) -------------------------------------------------------------

  const httpOnly = (url: string | null | undefined) => (url && /^https?:\/\//.test(url) ? url : null);
  // Für Radios im Room: was sie selbst abspielen müssen, um mitzuhören
  const hostListen: HostListen =
    view === 'radio' && wantPlay && current
      ? { kind: 'radio', url: current.url }
      : onYtTab && ytNow
        ? {
            kind: 'youtube',
            url: ytNow.item.url,
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
    // Room-Radios zeigen dieselben Listen wie der Host (Admins bearbeiten sie dort auch)
    stations: stations.map((st) => ({ id: st.id, name: st.name, url: st.url, logo: httpOnly(st.logo) ?? undefined })),
    currentStationId: view === 'radio' ? currentId : null,
    youtube: youtubeItems.map((i) => ({ ...i, thumbnail: httpOnly(i.thumbnail) })),
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
  // Chromecast folgt der eigenen Wiedergabe; die läuft solange stumm weiter (Titel, Queue, Position)
  const cast = useCast({
    media: hostListen,
    playing: ui.isPlaying,
    volume: muted ? 0 : volume,
    title: hostListen.kind === 'youtube' ? remoteSnapshot.title : null,
    artist: hostListen.kind === 'youtube' ? remoteSnapshot.artist : null,
    cover: hostListen.kind === 'youtube' ? remoteSnapshot.cover : httpOnly(viewStation?.logo),
    station: viewStation?.name ?? '',
  });

  useEffect(() => {
    for (const audio of [audioRef.current, ytAudioRef.current]) {
      if (!audio) continue;
      audio.volume = graph ? 1 : volume;
      audio.muted = graph ? false : muted || !!cast.device;
    }
    graph?.gain.gain.setTargetAtTime(muted || cast.device ? 0 : volume, graph.context.currentTime, 0.05);
  }, [volume, muted, graph, cast.device]);

  // Auch ein pausierter YouTube-Titel zählt: Der Wunsch kommt danach, statt ihn zu verdrängen
  const anythingActive = wantPlay || !!ytNow || yt.state.status === 'loading' || spotifyPlaying || apSession || !!btDevice;
  const roomName = prefs.room.name.trim() || `Radio ${hostname}`;
  const remote = useRemote(prefs.remote, { open: prefs.room.open, secure: prefs.room.secure, name: roomName }, settingsLoaded, remoteSnapshot, {
    toggle: () => uiRef.current.toggle(),
    next: () => uiRef.current.next(),
    prev: () => uiRef.current.prev(),
    setVolume: (v) => uiRef.current.setVolume(v),
    selectStation: (id) => {
      if (!stations.some((st) => st.id === id)) return false;
      selectStation(id);
      return true;
    },
    findYoutube: (id) => youtubeItems.find((i) => i.id === id),
    startQueue: () => startQueueRef.current(),
    // Läuft gar nichts, startet die Queue sofort – sonst wartet der Wunsch, bis er oben steht
    wishAdded: () => {
      if (!anythingActive) startQueueRef.current();
    },
    edit: (action, value) =>
      editFromRemote(
        {
          stations,
          saveStation,
          deleteStation,
          moveStation,
          addYoutube,
          renameYoutube: (id, title) => setYoutubeItems((list) => list.map((i) => (i.id === id ? { ...i, title } : i))),
          deleteYoutube,
          moveYoutube,
        },
        action,
        value,
      ),
    // Admin im Room: Empfang am Host schalten – beim Einschalten auch den Reiter einblenden
    setReceiver: (kind, enabled) =>
      setPrefs((p) => ({
        ...p,
        [kind]: { ...p[kind], enabled },
        tabs: enabled ? { ...p.tabs, [kind]: true } : p.tabs,
      })),
  });

  // --- YouTube-Queue: was oben steht, spielt ------------------------------------------------
  const { queue, queueNow, startQueue, playTop } = useYouTubeQueue(yt, remote);
  const startQueueRef = useRef(startQueue);
  startQueueRef.current = startQueue;
  ytEndedRef.current = remote.consume;
  const hostClient = { clientId: 'host', name: roomName, admin: true };

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

  useWindowKeys((e: KeyboardEvent) => {
    if (editing || settingsOpen || storeOpen || remoteOpen || roomOpen || joined) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const key = e.key;
    if (key === 'F11') {
      e.preventDefault();
      setFullscreen((f) => !f);
      return;
    }
    if (key === 'Escape') {
      setFullscreen(false);
      return;
    }
    const fKey = /^F([1-5])$/.exec(key);
    if (fKey) {
      e.preventDefault();
      const target = visibleTabs[Number(fKey[1]) - 1];
      if (target) setTab(target.id);
      return;
    }
    // In Eingabefeldern tippt man – dort gelten nur F-Tasten
    const target = e.target;
    if (target instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
    // Leertaste auf einem Knopf drückt den Knopf
    if (key === ' ' && isTypingTarget(target)) return;
    const changeVolume = (delta: number) => {
      if (onBtTab || onApTab || (onSpotifyTab && !sp.active)) return;
      ui.setVolume(Math.min(1, Math.max(0, Math.round((ui.volume + delta) * 100) / 100)));
    };
    const actions: Record<string, () => void> = {
      ' ': ui.toggle,
      ArrowRight: ui.next,
      ArrowLeft: ui.prev,
      ArrowUp: () => changeVolume(VOLUME_STEP),
      ArrowDown: () => changeVolume(-VOLUME_STEP),
      t: () => (view === 'radio' || view === 'youtube') && setMuted((m) => !m),
      m: () => currentTrack && toggleFavorite(currentTrack),
      v: () => setLibraryOpen((o) => !o),
      s: () => setSidebarOpen(!prefs.sidebarOpen),
      '/': () => setStoreOpen(true),
      ',': () => setSettingsOpen(true),
    };
    const action = actions[key.length === 1 ? key.toLowerCase() : key];
    if (action) {
      e.preventDefault();
      action();
    } else if (/^[1-9]$/.test(key) && stations[Number(key) - 1]) {
      e.preventDefault();
      selectStation(stations[Number(key) - 1].id);
    }
  });
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
        {...radio.audioEvents}
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
          shortcuts={!settingsOpen && !roomOpen}
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
            rights={{ edit: true, play: true }}
            search={api.youtubeSearch}
            loadPlaylist={api.youtubePlaylist}
            onWish={async (r, whole, now) => {
              const error = remote.addWish(
                whole
                  ? { id: r.id, title: r.title, channel: r.channel, thumbnail: r.thumbnail, duration: 0, count: 0 }
                  : { id: r.id, title: r.title, channel: r.channel, thumbnail: r.thumbnail, duration: r.duration },
                hostClient,
                now,
              );
              if (error) throw new Error(error);
              if (now) playTop();
            }}
            onSave={addYoutube}
            onPlay={(item) => {
              if (!remote.queueItem(item, hostClient, true)) playTop();
            }}
            onQueue={(item) => remote.queueItem(item, hostClient)}
            onRename={(id, title) => setYoutubeItems((list) => list.map((i) => (i.id === id ? { ...i, title } : i)))}
            onDelete={deleteYoutube}
            onMove={moveYoutube}
            onClose={closeSidebar}
            queue={queue}
            youtubeActive={sourceActive.youtube}
            canMoveQueue
            canRemove={() => true}
            onStartQueue={startQueue}
            onMoveWish={remote.moveWish}
            onRemoveWish={remote.removeWish}
            onMoveSong={remote.moveSongTo}
            footer={<YtDlpFooter />}
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
            title={prefs.sidebarOpen ? 'Seitenleiste ausblenden (S)' : 'Seitenleiste einblenden (S)'}
          >
            <SidebarIcon size={20} />
          </button>
          {onYtTab ? (
            <div className={`status-chip ${yt.state.status}`}>
              <span className={`live-dot ${yt.state.status}`} />
              {ytV.statusText}
            </div>
          ) : onApTab ? (
            <div className={`status-chip ${apV.status}`}>
              <span className={`live-dot ${apV.status}`} />
              {apV.statusText}
            </div>
          ) : onBtTab ? (
            <div className={`status-chip ${btV.status}`}>
              <span className={`live-dot ${btV.status}`} />
              {btV.statusText}
            </div>
          ) : onSpotifyTab ? (
            <div className={`status-chip ${spotifyV.status}`}>
              <span className={`live-dot ${spotifyV.status}`} />
              {spotifyV.statusText}
            </div>
          ) : (
            <div className={`status-chip ${status}`}>
              <span className={`live-dot ${status}`} />
              {radio.retrying
                ? 'Verbindung verloren – neuer Versuch …'
                : STATUS_TEXT[status]}
            </div>
          )}
          </div>
          {visibleTabs.length > 1 ? (
            <div className="tabs stage-tabs" role="tablist">
              {visibleTabs.map(({ id, label }, i) => (
                <button key={id} role="tab" className={tab === id ? 'active' : ''} onClick={() => setTab(id)} data-key={`F${i + 1}`} title={`${label} (F${i + 1})`}>
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
              title="Verlauf & gemerkte Songs (V)"
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
            <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Einstellungen (,)">
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
            current={!!queueNow}
            queue={queue}
            canMove
            canRemove={() => true}
            startLabel={queue.length && queueNow !== 'playing' ? (queueNow === 'paused' ? 'Weiter' : 'Jetzt spielen') : null}
            onStart={startQueue}
            onMove={remote.moveWish}
            onRemove={remote.removeWish}
            onMoveSong={remote.moveSongTo}
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
            {(theme === 'phosphor' || theme === 'terminal') && <Spectrum analyser={analyser} active={status === 'playing'} />}
            {currentTrack && (
              <button
                className={`like-button${isFavorite(currentTrack) ? ' active' : ''}`}
                onClick={() => toggleFavorite(currentTrack)}
                title={isFavorite(currentTrack) ? 'Nicht mehr merken (M)' : 'Song merken (M)'}
                data-key="M"
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
          <StationDeck theme={theme} stations={deck} all={stations} currentId={currentId} playing={wantPlay} onSelect={selectStation} />
        )}
        {theme === 'terminal' && (
          <button className="term-search" onClick={() => setStoreOpen(true)} title="Sender-Store öffnen (/)">
            <span className="term-prompt">›</span> Sender suchen …<span className="term-cursor" aria-hidden="true" />
            <kbd>/</kbd>
          </button>
        )}
        </>
        )}

        <footer className="player-bar">
          {theme === 'phosphor' && (
            <div className="key-hints" aria-hidden="true">
              [←] zurück [Leer] pause [→] weiter [F11] vollbild
            </div>
          )}
          {theme === 'terminal' && (
            <div className="key-hints" aria-hidden="true">
              <kbd>←</kbd> <kbd>Leer</kbd> <kbd>→</kbd> <kbd>↑↓</kbd> <kbd>,</kbd> Kürzel
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
            {isDesktop && <CastButton cast={cast} />}
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

      {joinCode && (
        <div className="modal-backdrop join-code" onMouseDown={(e) => e.target === e.currentTarget && setJoinCode(null)}>
          <div className="modal join-code-box">
            <p>
              {joinCode.kind === 'radio' ? 'Das Radio' : 'Das Handy'} „{joinCode.name}“ möchte sich verbinden.
              <br />
              Diesen Code dort eingeben:
            </p>
            <div className="join-code-digits">
              {joinCode.code.slice(0, 3)} {joinCode.code.slice(3)}
            </div>
            <button className="button" onClick={() => setJoinCode(null)}>
              Ausblenden
            </button>
          </div>
        </div>
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
        <StationEditor
          station={editing === 'new' ? null : editing}
          onSave={(values) => {
            saveStation(values, editing === 'new' ? null : editing);
            setEditing(null);
          }}
          onCancel={closeEditor}
        />
      )}
    </div>
  );
}
