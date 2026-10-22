import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { isDesktop } from '../api';
import type { AudioGraph } from '../audio';
import { useListen, type useRoom } from '../room';
import type { HostReceiver, PlayerStatus, RoomPrefs, Station, Track } from '../types';
import { FullscreenView } from './FullscreenView';
import { CloseIcon, ExpandIcon, HeadphonesIcon, RoomIcon, SettingsIcon, SidebarIcon, VolumeIcon } from './Icons';
import { Controls, Cover } from './Player';
import { StationEditor } from './StationEditor';
import { StationList } from './StationList';
import { StationStore } from './StationStore';
import { YouTubeSidebar } from './YouTubeSidebar';
import { NowCard, QueueStage } from './YouTubeStage';
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
  const [editing, setEditing] = useState<Station | 'new' | null>(null);
  const [storeOpen, setStoreOpen] = useState(false);
  // Hosts vor 1.10 schicken keine Stream-Adressen mit – der Sender-Store braucht sie aber
  const hostStations = (host?.stations ?? []).map((st) => ({ ...st, url: st.url ?? '' }));
  const roomTabs = (
    <div className="room-head">
      <div className="room-panels" role="tablist">
        <button className={panel === 'stations' ? 'active' : ''} onClick={() => setPanel('stations')} title={`Room „${prefs.join?.name ?? ''}“`}>
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
      <RoomAdmin room={room} onMessage={setMessage} />
    </div>
  );
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

      {sidebarOpen && panel === 'stations' && (
        <StationList
          stations={hostStations}
          currentId={host?.currentStationId ?? null}
          status={host?.source === 'radio' ? (host.status ?? 'idle') : 'idle'}
          canEdit={room.admin}
          canPlay={may(rules?.guestStations)}
          onSelect={(id) => run('station', id)}
          onAdd={() => setEditing('new')}
          onEdit={(station) => setEditing(station)}
          onDelete={(id) => run('stationDelete', id)}
          onMove={(id, to) => run('stationMove', { id, to })}
          onOpenStore={() => setStoreOpen(true)}
          onClose={() => onSidebar(false)}
        >
          {roomTabs}
        </StationList>
      )}
      {sidebarOpen && panel === 'youtube' && (
        <YouTubeSidebar
          items={host?.youtube ?? []}
          rights={{ edit: room.admin, play: may(rules?.guestStations) }}
          search={room.search}
          loadPlaylist={room.playlist}
          onWish={(r, whole, now) => room.wish(r.id, whole, now).then(() => undefined)}
          onSave={(url) => room.command('youtubeAdd', { url }).then(() => undefined)}
          onPlay={(item) => run('youtubeItem', item.id)}
          onQueue={(item) => run('youtubeQueue', item.id)}
          onRename={(id, title) => run('youtubeRename', { id, title })}
          onDelete={(id) => run('youtubeDelete', id)}
          onMove={(id, to) => run('youtubeMove', { id, to })}
          onClose={() => onSidebar(false)}
        >
          {roomTabs}
        </YouTubeSidebar>
      )}
      {sidebarOpen && panel === 'receivers' && receivers && (
        <aside className="sidebar room-sidebar">
          <header className="sidebar-header">
            <div className="brand">
              <RoomIcon size={22} />
              <span title={prefs.join?.url}>{prefs.join?.name ?? 'Room'}</span>
            </div>
            <button className="icon-button" onClick={() => onSidebar(false)} title="Seitenleiste ausblenden">
              <CloseIcon size={18} />
            </button>
          </header>
          {roomTabs}
          <div className="sidebar-scroll room-receivers">
            <p className="side-note">Empfang am Host – nur für Admins.</p>
            <ReceiverToggle
              label="Spotify Connect"
              receiver={receivers.spotify}
              onChange={(enabled) => run('receiver', { kind: 'spotify', enabled })}
            />
            <ReceiverToggle label="AirPlay" receiver={receivers.airplay} onChange={(enabled) => run('receiver', { kind: 'airplay', enabled })} />
          </div>
        </aside>
      )}
      {editing && (
        <StationEditor
          station={editing === 'new' ? null : editing}
          onSave={(values) => {
            run('stationSave', { ...values, id: editing === 'new' ? undefined : editing.id });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {storeOpen && (
        <StationStore
          stations={hostStations}
          volume={prefs.volume}
          onAdd={(station, name) => run('stationSave', { name, url: station.url })}
          onPreviewChange={() => {}}
          onClose={() => setStoreOpen(false)}
        />
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

        {host?.source === 'youtube' ? (
          <>
            {message && (
              <p className="room-message" onClick={() => setMessage(null)}>
                {message}
              </p>
            )}
            <QueueStage
              queue={host.wishes ?? []}
              hero={
                host.wishes?.length && host.title ? (
                  <NowCard
                    cover={host.cover ?? null}
                    title={host.title}
                    channel={host.artist ?? null}
                    from={host.album}
                    playing={!!host.playing}
                    live={host.live}
                    progress={host.progress && <Progress progress={host.progress} playing={!!host.playing} />}
                  />
                ) : null
              }
              canMove={room.admin}
              canRemove={(w) => room.admin || w.clientId === prefs.clientId}
              startLabel={host.wishes?.length && !host.playing && may(rules?.guestSkip) ? 'Jetzt spielen' : null}
              onStart={() => run('wishStart')}
              onMove={(id, to) => run('wishMove', { id, to })}
              onRemove={(id) => run('wishRemove', id)}
              onMoveSong={(wish, song, to, out) => run('songMove', { wish, song, to, out })}
              empty={
                <div className="spotify-hero">
                  <h2>Die Queue ist leer</h2>
                  <p>Links unter „YouTube“ suchen oder einen gespeicherten Eintrag des Hosts wählen.</p>
                </div>
              }
            />
          </>
        ) : (
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
        )}

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

/** Admin-PIN des Hosts: angemeldet sieht und darf man im Room alles wie am Host */
function RoomAdmin({ room, onMessage }: { room: Room; onMessage(text: string): void }) {
  const [pin, setPin] = useState('');
  if (!room.host?.rules?.adminPin) return null;
  return (
    <div className="room-admin">
      {room.admin ? (
        <>
          <span className="muted small">✓ Admin – alles wie am Host</span>
          <button className="mini" onClick={room.logout}>
            Abmelden
          </button>
        </>
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
  );
}
