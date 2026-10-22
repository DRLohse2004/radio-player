import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { isDesktop } from '../api';
import type { AudioGraph } from '../audio';
import { useListen, type SearchResult, type useRoom } from '../room';
import type { HostReceiver, PlayerStatus, RoomPrefs, Station, Track } from '../types';
import { FullscreenView } from './FullscreenView';
import { CloseIcon, ExpandIcon, HeadphonesIcon, PlusIcon, RoomIcon, SearchIcon, SettingsIcon, SidebarIcon, VolumeIcon } from './Icons';
import { Controls, Cover } from './Player';
import { Queue } from './Queue';
import { StationLogo } from './StationLogo';
import { VOLUME_STEP } from '../shortcuts';

type Room = ReturnType<typeof useRoom>;

interface Props {
  room: Room;
  prefs: RoomPrefs;
  sidebarOpen: boolean;
  onSidebar(open: boolean): void;
  onChange(patch: Partial<RoomPrefs>): void;
  onOpenDialog(): void;
  /** Einstellungen dieses Radios öffnen */
  onOpenSettings(): void;
  fullscreen: boolean;
  onFullscreen(open: boolean): void;
  /** Vollbild-Einstellungen dieses Radios */
  display: { weatherCity: string; swapMinutes: number; visualizer: boolean };
  /** Tastenkürzel aktiv – aus, solange ein Dialog offen ist */
  shortcuts: boolean;
}

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Ansicht eines Radios, das einem Room beigetreten ist: zeigt und steuert den Host */
export function RoomView({ room, prefs, sidebarOpen, onSidebar, onChange, onOpenDialog, onOpenSettings, fullscreen, onFullscreen, display, shortcuts }: Props) {
  const host = room.host;
  const audioRef = useRef<HTMLAudioElement>(null);
  const listening = prefs.mode === 'listen';

  // Eigene WebAudio-Kette fürs Mithören, damit der Visualizer im Vollbild etwas zu sehen hat
  const [graph, setGraph] = useState<AudioGraph | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!isDesktop || !audio) return;
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.85;
      const gain = context.createGain();
      context.createMediaElementSource(audio).connect(analyser);
      analyser.connect(gain);
      gain.connect(context.destination);
      setGraph({ context, analyser, gain });
      return () => {
        context.close();
      };
    } catch {
      // ohne Visualizer weiter
    }
  }, []);

  const listen = useListen(audioRef, listening ? host?.listen ?? null : null, !!host?.playing, prefs.volume, graph?.gain ?? null);
  useEffect(() => {
    if (host?.playing) graph?.context.resume().catch(() => {});
  }, [graph, host?.playing]);
  const [message, setMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState<'stations' | 'youtube' | 'receivers'>('stations');
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  // Empfang am Host nur für Admins – nach dem Abmelden zurück zu den Sendern
  const receivers = room.admin ? host?.receivers : undefined;
  useEffect(() => {
    if (panel === 'receivers' && !receivers) setPanel('stations');
  }, [panel, receivers]);

  // Tastenkürzel wie im eigenen Radio – der Handler wird unten bei jedem Render neu gesetzt
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rules = host?.rules;
  const may = (rule: boolean | undefined) => room.admin || rule !== false;
  const run = (action: string, value?: unknown) =>
    room.command(action, value).catch((err: Error) => setMessage(err.message));

  // Senderlogo des Hosts als Ersatz, wenn der Titel kein Cover hat – wie im normalen Radio
  const hostStation = host?.stations?.find((st) => st.id === host.currentStationId);
  const station: Station | null = host
    ? { id: 'host', name: host.sourceName || prefs.join?.name || 'Host', url: '', logo: hostStation?.logo ?? undefined }
    : null;
  const nowPlaying = host?.title
    ? { raw: host.title, kind: 'music' as const, artist: host.artist ?? null, title: host.title, album: host.album ?? null, cover: host.cover ?? null }
    : null;
  const notListenable = listening && host?.playing && host.listen?.kind === 'none' && host.listen.reason;

  // Lautstärke: beim Mithören die eigene, als Fernbedienung die des Hosts
  const volume = listening ? prefs.volume : host?.volume ?? 0;
  const volumeDisabled = !listening && (!host?.volumeEnabled || !may(rules?.guestVolume));
  const volumeStyle = { '--fill': `${volume * 100}%` } as CSSProperties;

  keyRef.current = (e: KeyboardEvent) => {
    if (!shortcuts || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'F11') {
      e.preventDefault();
      onFullscreen(!fullscreen);
      return;
    }
    if (e.key === 'Escape') {
      if (fullscreen) onFullscreen(false);
      return;
    }
    const target = e.target;
    if (target instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
    if (e.key === ' ' && target instanceof HTMLButtonElement) return;
    const changeVolume = (delta: number) => {
      if (volumeDisabled) return;
      const v = Math.min(1, Math.max(0, Math.round((volume + delta) * 100) / 100));
      if (listening) onChange({ volume: v });
      else run('volume', v);
    };
    const actions: Record<string, () => void> = {
      ' ': () => run('toggle'),
      ArrowRight: () => run('next'),
      ArrowLeft: () => run('prev'),
      ArrowUp: () => changeVolume(VOLUME_STEP),
      ArrowDown: () => changeVolume(-VOLUME_STEP),
      s: () => onSidebar(!sidebarOpen),
      ',': onOpenSettings,
    };
    const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    const station = /^[1-9]$/.test(e.key) ? host?.stations?.[Number(e.key) - 1] : undefined;
    if (action) {
      e.preventDefault();
      action();
    } else if (station) {
      e.preventDefault();
      run('station', station.id);
    }
  };

  const connection =
    room.status === 'connected'
      ? listening
        ? listen.status === 'error'
          ? listen.error ?? 'Fehler beim Mithören'
          : notListenable
            ? `${host?.listen?.kind === 'none' ? host.listen.reason : ''} läuft nur beim Host`
            : host?.playing
              ? listen.status === 'playing'
                ? 'Hört mit'
                : 'Verbinde …'
              : 'Host pausiert'
        : 'Fernbedienung'
      : room.status === 'error'
        ? room.error ?? 'Verbindung verloren'
        : 'Verbinde mit Host …';
  // „Zuvor“ im Vollbild: die letzten Titel, die beim Host liefen, seit dieses Radio verbunden ist
  const [history, setHistory] = useState<Track[]>([]);
  const trackKey = host?.playing && host.title ? `${host.artist ?? ''}|${host.title}` : null;
  useEffect(() => {
    if (!trackKey || !host?.title) return;
    const track: Track = {
      id: `h-${Date.now().toString(36)}`,
      artist: host.artist ?? '',
      title: host.title,
      album: host.album ?? null,
      cover: host.cover ?? null,
      station: host.sourceName ?? '',
      time: new Date().toISOString(),
    };
    setHistory((list) => (list[0]?.title === track.title && list[0]?.artist === track.artist ? list : [track, ...list].slice(0, 20)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackKey]);
  const fsStatus: PlayerStatus = listening && host?.playing && !notListenable ? listen.status : host?.playing ? 'playing' : 'idle';

  const chipClass = room.status === 'error' || listen.status === 'error' ? 'error' : room.status === 'connected' ? (host?.playing ? 'playing' : 'idle') : 'loading';

  return (
    <>
      <audio ref={audioRef} preload="none" crossOrigin={isDesktop ? 'anonymous' : undefined} {...listen.events} />

      {fullscreen && (
        <FullscreenView
          station={station}
          nowPlaying={nowPlaying}
          status={fsStatus}
          isPlaying={!!host?.playing}
          history={history}
          weatherCity={display.weatherCity}
          swapMinutes={display.swapMinutes}
          analyser={listening ? graph?.analyser ?? null : null}
          showVisualizer={display.visualizer}
          onToggle={() => run('toggle')}
          onPrev={() => run('prev')}
          onNext={() => run('next')}
          onExit={() => onFullscreen(false)}
        />
      )}

      {sidebarOpen && (
        <aside className="sidebar room-sidebar">
          <header className="sidebar-header">
            <div className="brand">
              <RoomIcon size={22} />
              <span title={prefs.join?.url}>{prefs.join?.name ?? 'Room'}</span>
            </div>
            <div className="sidebar-header-actions">
              <button className="icon-button" onClick={() => onSidebar(false)} title="Seitenleiste ausblenden">
                <CloseIcon size={18} />
              </button>
            </div>
          </header>
          <div className="room-panels" role="tablist">
            <button className={panel === 'stations' ? 'active' : ''} onClick={() => setPanel('stations')}>
              Sender
            </button>
            <button className={panel === 'youtube' ? 'active' : ''} onClick={() => setPanel('youtube')}>
              YouTube{host?.wishes?.length ? ` (${host.wishes.length})` : ''}
            </button>
            {receivers && (
              <button className={panel === 'receivers' ? 'active' : ''} onClick={() => setPanel('receivers')}>
                Empfang
              </button>
            )}
          </div>
          <div className="sidebar-scroll">
            {panel === 'stations' && (
              <ul className="station-list flush">
                {(host?.stations ?? []).map((st) => (
                  <li key={st.id} className={`station-item${st.id === host?.currentStationId ? ' active' : ''}`}>
                    <button
                      className="station-select"
                      disabled={!may(rules?.guestStations)}
                      onClick={() => run('station', st.id)}
                    >
                      <StationLogo station={{ name: st.name, logo: st.logo ?? undefined }} className="small" />
                      <span className="station-name">{st.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {panel === 'youtube' && <WishPanel room={room} clientId={prefs.clientId} canPlay={may(rules?.guestStations)} onMessage={setMessage} />}
            {panel === 'receivers' && receivers && (
              <div className="room-receivers">
                <p className="side-note">Empfang am Host – nur für Admins.</p>
                <ReceiverToggle
                  label="Spotify Connect"
                  receiver={receivers.spotify}
                  onChange={(enabled) => run('receiver', { kind: 'spotify', enabled })}
                />
                <ReceiverToggle
                  label="AirPlay"
                  receiver={receivers.airplay}
                  onChange={(enabled) => run('receiver', { kind: 'airplay', enabled })}
                />
              </div>
            )}
          </div>
        </aside>
      )}

      <main className="stage">
        <div className="stage-backdrop">{host?.cover && <img key={host.cover} src={host.cover} alt="" />}</div>
        <header className="stage-top">
          <div className="stage-top-left">
            <button
              className={`icon-button${sidebarOpen ? ' active' : ''}`}
              onClick={() => onSidebar(!sidebarOpen)}
              title={sidebarOpen ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden'}
            >
              <SidebarIcon size={20} />
            </button>
            <div className={`status-chip ${chipClass}`}>
              <span className={`live-dot ${chipClass}`} />
              {connection}
            </div>
          </div>
          <div className="tabs stage-tabs" role="tablist">
            <button role="tab" className={listening ? 'active' : ''} onClick={() => onChange({ mode: 'listen' })}>
              <HeadphonesIcon size={15} /> Mithören
            </button>
            <button role="tab" className={!listening ? 'active' : ''} onClick={() => onChange({ mode: 'remote' })}>
              Nur Fernbedienung
            </button>
          </div>
          <div className="stage-actions">
            <button className="icon-button active" onClick={onOpenDialog} title="Room">
              <RoomIcon size={20} />
            </button>
            <button className="icon-button" onClick={onOpenSettings} title="Einstellungen">
              <SettingsIcon size={20} />
            </button>
            <button className="icon-button" onClick={() => onFullscreen(true)} title="Vollbild (F11)">
              <ExpandIcon size={20} />
            </button>
          </div>
        </header>

        <section className="now-playing">
          <Cover cover={host?.cover ?? null} station={station} className="main-cover" />
          <div className="np-text">
            <div className="np-station">
              {station?.name}
              <span className="room-host"> · bei {prefs.join?.name}</span>
            </div>
            {nowPlaying ? (
              <div className="track-info" key={nowPlaying.raw}>
                <div className="track-title" title={nowPlaying.title}>
                  {nowPlaying.title}
                </div>
                <div className="track-artist">{nowPlaying.artist}</div>
                {nowPlaying.album && <div className="track-album">{nowPlaying.album}</div>}
                {host?.wishedBy && <div className="track-album">Gewünscht von {host.wishedBy}</div>}
              </div>
            ) : (
              <div className="track-info">
                <div className="track-title">{host ? (host.playing ? station?.name : 'Gerade läuft nichts') : 'Verbinde …'}</div>
              </div>
            )}
            {host?.progress && <Progress progress={host.progress} playing={!!host.playing} />}
            {message && (
              <p className="room-message" onClick={() => setMessage(null)}>
                {message}
              </p>
            )}
          </div>
        </section>

        <footer className="player-bar">
          <Controls
            isPlaying={!!host?.playing}
            disabled={!host?.canControl || !may(rules?.guestSkip)}
            onToggle={() => run('toggle')}
            onPrev={() => run('prev')}
            onNext={() => run('next')}
          />
          <div className="volume">
            <span className="icon-button" title={listening ? 'Eigene Lautstärke (nur an diesem PC)' : 'Lautstärke am Host'}>
              <VolumeIcon size={20} muted={volume === 0} />
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              style={volumeStyle}
              disabled={volumeDisabled}
              aria-label={listening ? 'Eigene Lautstärke' : 'Lautstärke am Host'}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (listening) onChange({ volume: v });
                else run('volume', v);
              }}
            />
          </div>
        </footer>
      </main>
    </>
  );
}

/** Schalter für Spotify Connect bzw. AirPlay am Host, mit Zustand darunter */
function ReceiverToggle({ label, receiver, onChange }: { label: string; receiver: HostReceiver; onChange(enabled: boolean): void }) {
  const state = !receiver.enabled
    ? 'Aus'
    : receiver.error
      ? receiver.error
      : receiver.client
        ? `Verbunden mit ${receiver.client}`
        : receiver.running
          ? `Bereit als „${receiver.name}“`
          : 'Startet …';
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        <small className={receiver.enabled && receiver.error ? 'error-text' : undefined}>{state}</small>
      </span>
      <input type="checkbox" className="switch" checked={receiver.enabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Fortschritt des Hosts (Millisekunden) – läuft zwischen den Meldungen selbst weiter */
function Progress({ progress, playing }: { progress: { position: number; duration: number; at: number }; playing: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [playing]);
  const position = Math.min(progress.duration, progress.position + (playing ? Date.now() - progress.at : 0));
  const ratio = progress.duration ? position / progress.duration : 0;
  return (
    <div className="room-progress">
      <div className="room-progress-bar">
        <div style={{ width: `${ratio * 100}%` }} />
      </div>
      <span>
        {formatTime(position / 1000)} / {formatTime(progress.duration / 1000)}
      </span>
    </div>
  );
}

function WishPanel({ room, clientId, canPlay, onMessage }: { room: Room; clientId: string; canPlay: boolean; onMessage(text: string): void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [open, setOpen] = useState<{ id: string; entries: SearchResult[] | null } | null>(null);
  const wishes = room.host?.wishes ?? [];
  const saved = room.host?.youtube ?? [];

  const wish = (r: SearchResult, whole = false) =>
    room
      .wish(r.id, whole)
      .then(() => {
        onMessage(`„${r.title}“ ist auf der Wunschliste.`);
        setResults(null);
        setOpen(null);
        setQuery('');
      })
      .catch((err: Error) => onMessage(err.message));

  const toggleOpen = (id: string) => {
    if (open?.id === id) return setOpen(null);
    setOpen({ id, entries: null });
    room
      .playlist(id)
      .then((entries) => setOpen((o) => (o?.id === id ? { id, entries } : o)))
      .catch((err: Error) => {
        setOpen(null);
        onMessage(err.message);
      });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setOpen(null);
    setBusy(true);
    try {
      setResults(await room.search(query.trim()));
    } catch (err) {
      onMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="room-wishes">
      <form className="yt-add" onSubmit={submit}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Song, Playlist oder YouTube-Link …" />
        <button className="icon-button" disabled={busy} title="Suchen">
          <SearchIcon size={16} />
        </button>
      </form>
      {busy && <p className="side-note">Suche …</p>}
      {results && (
        <ul className="station-list flush">
          {results.length === 0 && <p className="side-note">Nichts gefunden.</p>}
          {results.map((r) =>
            r.kind === 'playlist' ? (
              <li key={r.id} className="room-playlist">
                <div className="station-item">
                  <button className="station-select" onClick={() => toggleOpen(r.id)} title="Songs der Playlist zeigen">
                    <span className="room-thumb">{r.thumbnail && <img src={r.thumbnail} alt="" />}</span>
                    <span className="station-name">
                      {r.title}
                      <small>Playlist{r.channel ? ` · ${r.channel}` : ''}</small>
                    </span>
                    <span className="room-playlist-toggle">{open?.id === r.id ? '▾' : '▸'}</span>
                  </button>
                  <button className="mini" onClick={() => wish(r, true)} title="Ganze Playlist als einen Wunsch anhängen">
                    Alle
                  </button>
                </div>
                {open?.id === r.id && (
                  <ul className="station-list flush">
                    {!open.entries && <p className="side-note">Lade Songs …</p>}
                    {open.entries?.map((e) => (
                      <li key={e.id} className="station-item">
                        <button className="station-select" onClick={() => wish(e)}>
                          <span className="station-name">
                            {e.title}
                            <small>{formatTime(e.duration)}</small>
                          </span>
                          <PlusIcon size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ) : (
              <li key={r.id} className="station-item">
                <button className="station-select" disabled={r.live} onClick={() => wish(r)}>
                  <span className="room-thumb">{r.thumbnail && <img src={r.thumbnail} alt="" />}</span>
                  <span className="station-name">
                    {r.title}
                    <small>{r.live ? 'Livestream' : formatTime(r.duration)}</small>
                  </span>
                  <PlusIcon size={16} />
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      <div className="sidebar-label flush yt-wishes-head">
        <span>Queue{wishes.length ? ` (${wishes.length})` : ''}</span>
        {wishes.length > 0 && (!room.host?.wishedBy || (room.host.wishPlaylist && room.admin)) && (room.admin || room.host?.rules?.guestSkip !== false) && (
          <button className="mini" onClick={() => room.command('wishStart').catch((err: Error) => onMessage(err.message))}>
            {room.host?.wishPlaylist ? 'Playlist beenden' : 'Jetzt spielen'}
          </button>
        )}
      </div>
      {wishes.length === 0 ? (
        <p className="side-note">Die Queue ist leer.</p>
      ) : (
        <Queue
          wishes={wishes}
          canMove={room.admin}
          canRemove={(w) => room.admin || w.clientId === clientId}
          onMove={(id, to) => room.command('wishMove', { id, to }).catch((err: Error) => onMessage(err.message))}
          onRemove={(id) => room.command('wishRemove', id).catch((err: Error) => onMessage(err.message))}
          loadEntries={(w) => room.playlist(w.url ? new URL(w.url).searchParams.get('list') ?? '' : w.videoId)}
        />
      )}

      <div className="sidebar-label flush">Gespeichert beim Host</div>
      {saved.length === 0 && <p className="side-note">Beim Host sind keine YouTube-Links gespeichert.</p>}
      <ul className="station-list flush">
        {saved.map((item) => (
          <li key={item.id} className="station-item">
            <button className="station-select" disabled={!canPlay} onClick={() => room.command('youtubeItem', item.id).catch((err: Error) => onMessage(err.message))} title="Jetzt spielen">
              <span className="room-thumb">{item.thumbnail && <img src={item.thumbnail} alt="" />}</span>
              <span className="station-name">
                {item.title}
                <small>{item.kind === 'playlist' ? 'Playlist' : item.kind === 'live' ? 'Livestream' : 'Video'}</small>
              </span>
            </button>
            {item.kind !== 'live' && (
              <button
                className="icon-button"
                title="Hinten an die Queue"
                onClick={() =>
                  room
                    .command('youtubeQueue', item.id)
                    .then(() => onMessage(`„${item.title}“ ist in der Queue.`))
                    .catch((err: Error) => onMessage(err.message))
                }
              >
                <PlusIcon size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {room.host?.rules?.adminPin && (
        <div className="room-admin">
          {room.admin ? (
            <button className="mini" onClick={room.logout}>
              Admin abmelden
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                room
                  .login(pin)
                  .then(() => setPin(''))
                  .catch((err: Error) => onMessage(err.message));
              }}
            >
              <input value={pin} inputMode="numeric" maxLength={8} placeholder="Admin-PIN" onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
              <button className="mini">Anmelden</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
