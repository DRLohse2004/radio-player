export interface Station {
  id: string;
  name: string;
  url: string;
  logo?: string;
  /** true, sobald die automatische Logo-Suche gelaufen ist (verhindert Wiederholung bei jedem Start) */
  logoChecked?: boolean;
}

export interface Preferences {
  /** beim Start sofort den letzten Sender spielen */
  autoplay: boolean;
  /** beim Start direkt ins Vollbild */
  startFullscreen: boolean;
  /** Zeitplan, z. B. Büro: Mo–Fr 08:00 an, 17:00 aus */
  schedule: { enabled: boolean; start: string; stop: string; days: number[] };
  /** Ort für die Wetteranzeige im Vollbild, leer = aus */
  weatherCity: string;
  /** Cover und Text im Vollbild alle X Minuten tauschen (Einbrennschutz) */
  swapMinutes: number;
  /** Musik-Visualisierung im Vollbild */
  visualizer: boolean;
  /** Spotify-Connect-Empfänger */
  spotify: SpotifyPrefs;
  /** PC als Bluetooth-Lautsprecher (z. B. für ein iPhone) */
  bluetooth: { enabled: boolean };
  /** AirPlay-Empfänger fürs iPhone */
  airplay: { enabled: boolean; name: string };
  /** schwebende Seitenleiste links eingeblendet */
  sidebarOpen: boolean;
  /** Web-Fernbedienung fürs Handy */
  remote: RemotePrefs;
  /** automatisch nach neuen Versionen suchen und sie herunterladen */
  autoUpdate: boolean;
  /** Rooms: mehrere Radios zusammenschließen */
  room: RoomPrefs;
  /** sichtbare Reiter – ausgeblendete Empfänger (Spotify, AirPlay, Bluetooth) laufen nicht */
  tabs: Record<SourceTab, boolean>;
  /** Design der Oberfläche – 'standard' ist das ursprüngliche dunkle Design */
  theme: ThemeId;
}

export type ThemeId = 'standard' | 'kofferradio' | 'phosphor' | 'roehre' | 'plakat' | 'wohnzimmer' | 'tafel' | 'terminal';

export type SourceTab = 'radio' | 'youtube' | 'spotify' | 'airplay' | 'bluetooth';

export interface RoomPrefs {
  /** dieses Radio ist Host und lässt andere Radios beitreten */
  open: boolean;
  /** Sicher: andere Radios brauchen die Zugangs-PIN oder einen Einmalcode */
  secure: boolean;
  /** Name, unter dem andere Radios den Room finden (leer = Rechnername) */
  name: string;
  /** beigetretener Room (null = eigenständig) */
  join: { url: string; key: string; name: string } | null;
  /** mithören oder nur fernbedienen */
  mode: 'listen' | 'remote';
  /** eigene Lautstärke beim Mithören */
  volume: number;
  /** Kennung dieses Radios beim Host (für eigene Wünsche) */
  clientId: string;
  /** weitere Netze für die Suche, z. B. „10.0.11.255, 10.0.255.255“ */
  networks: string;
}

/** Ein gefundenes Radio im Netz */
export interface RoomHost {
  name: string;
  address: string;
  port: number;
  url: string;
  open: boolean;
  secure?: boolean;
  key: string;
  version: string;
  listeners: number;
}

export type RoomEvent =
  | { type: 'status'; status: 'connecting' | 'connected' | 'error'; error: string | null }
  | { type: 'state'; state: HostState };

/** Was der Host gerade spielt – derselbe Zustand, den auch die Handys bekommen */
export interface HostState {
  source?: string;
  sourceName?: string;
  status?: PlayerStatus;
  playing?: boolean;
  canControl?: boolean;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  cover?: string | null;
  wishedBy?: string | null;
  live?: boolean;
  volume?: number;
  volumeEnabled?: boolean;
  progress?: { position: number; duration: number; at: number } | null;
  stations?: Station[];
  currentStationId?: string | null;
  youtube?: YouTubeItem[];
  wishes?: Wish[];
  rules?: { guestVolume: boolean; guestSkip: boolean; guestStations: boolean; maxWishes: number; maxMinutes: number; adminPin: boolean };
  /** Zum Mithören: was ein anderes Radio selbst abspielen muss */
  listen?: HostListen;
  /** Empfang am Host – Admins im Room schalten ihn ein und aus */
  receivers?: { spotify: HostReceiver; airplay: HostReceiver };
}

export interface HostReceiver {
  enabled: boolean;
  /** Name, unter dem das Radio im Netzwerk erscheint */
  name: string;
  /** Dienst läuft und ist im Netzwerk sichtbar */
  running: boolean;
  /** verbundenes Gerät bzw. Konto, sonst null */
  client: string | null;
  error: string | null;
}

export type HostListen =
  | { kind: 'radio'; url: string }
  | { kind: 'youtube'; url: string; live: boolean; position: number; at: number }
  | { kind: 'none'; reason: string };

export interface CastDevice {
  id: string;
  name: string;
  model: string;
  host: string;
  port: number;
  kind: 'cast' | 'dlna';
  /** DLNA: Steueradressen für AVTransport und RenderingControl */
  avTransport?: string;
  rendering?: string | null;
}

/** Was auf dem Cast-Gerät laufen soll – es folgt der eigenen Wiedergabe */
export interface CastTarget {
  device: CastDevice;
  media: HostListen;
  playing: boolean;
  volume: number;
  title: string | null;
  artist: string | null;
  cover: string | null;
  station: string;
}

export interface CastEvent {
  state: 'connecting' | 'buffering' | 'playing' | 'paused' | 'idle' | 'error' | 'off';
  device: string | null;
  error?: string;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
  current: string;
  version: string | null;
  notes: string;
  progress: number;
  error: string | null;
  /** läuft als portable .exe (nur dann kann sich das Radio selbst ersetzen) */
  portable: boolean;
  url: string | null;
}

export type AccessMode = 'off' | 'public' | 'secure';

export interface RemotePrefs {
  enabled: boolean;
  /** Sicher: Handys brauchen die Zugangs-PIN oder einen Einmalcode vom Radio (sonst öffentlich) */
  secure: boolean;
  /** Zugangs-PIN für den sicheren Modus (Handys und Rooms) */
  joinPin: string;
  /** Zugangsschlüssel im QR-Code */
  key: string;
  /** Admin-PIN (leer = kein Admin-Zugang vom Handy) */
  pin: string;
  guestVolume: boolean;
  guestSkip: boolean;
  guestStations: boolean;
  /** offene Wünsche pro Person */
  maxWishes: number;
  /** maximale Länge eines Wunsches in Minuten (0 = egal) */
  maxMinutes: number;
  /** QR-Code klein im Vollbild zeigen */
  qrInFullscreen: boolean;
}

/** Musikwunsch von der Fernbedienung */
export interface Wish {
  id: string;
  videoId: string;
  title: string;
  channel: string | null;
  duration: number;
  thumbnail: string | null;
  by: string;
  clientId: string;
  /** Ganze Playlist (videoId ist dann die Playlist-ID): Anzahl Songs */
  count?: number;
  /** Link eines gespeicherten Eintrags des Hosts (sonst aus videoId gebildet) */
  url?: string;
  /** Songs der Playlist in Spielreihenfolge (der erste läuft, wenn sie oben steht) */
  entries?: YouTubeEntry[];
  /** Livestream (nur vom Host bzw. Admin) */
  live?: boolean;
}

export interface RemoteClient {
  id: string;
  name: string;
  ip: string;
  online: boolean;
  kind?: 'radio' | 'phone';
}

export interface RemoteInfo {
  running: boolean;
  port?: number;
  addresses?: { name: string; address: string; url: string }[];
  qr?: string | null;
  clients?: RemoteClient[];
  error?: string;
}

/** Was auf die Queue soll: Video, Playlist (count) oder gespeicherter Eintrag des Hosts (url) */
export interface WishVideo {
  id: string;
  title: string;
  channel: string | null;
  duration: number;
  thumbnail: string | null;
  count?: number;
  url?: string;
  /** Songs einer gewünschten Playlist (vom Server schon geladen) */
  entries?: YouTubeEntry[];
  live?: boolean;
}

export interface RemoteCommand {
  id: number;
  action: string;
  value?: unknown;
  video?: WishVideo;
  /** Wunsch ganz oben einreihen und sofort spielen */
  now?: boolean;
  client: { clientId: string; name: string; admin: boolean };
}

/** Ereignisse des AirPlay-Empfängers */
export type AirPlayEvent =
  | { type: 'state'; running: boolean; port: number; name: string; interfaces: { name: string; address: string }[]; error: string | null }
  | { type: 'session'; client: string }
  | { type: 'play' }
  | { type: 'flush' }
  | { type: 'volume'; db: number }
  | { type: 'metadata'; title?: string; artist?: string; album?: string }
  | { type: 'cover'; cover: string | null }
  | { type: 'progress'; position: number; duration: number }
  | { type: 'end'; reason: string }
  | { type: 'warning'; message: string };

/** Ereignisse des Bluetooth-Hilfsprogramms (bt-receiver.exe) */
export type BtEvent =
  | { type: 'running'; running: boolean }
  | { type: 'ready' }
  | { type: 'devices'; devices: BtDevice[] }
  | { type: 'state'; id: string; name: string; state: BtDevice['state']; result?: string }
  | { type: 'sessions'; sources: string[] }
  | { type: 'media'; source: string; title: string; artist: string; album: string; status: string; cover: string | null }
  | { type: 'output'; name: string }
  | { type: 'error'; message: string }
  | { type: 'log'; message: string };

export interface BtDevice {
  id: string;
  name: string;
  state: 'closed' | 'connecting' | 'connected';
}

export interface SpotifyPrefs {
  enabled: boolean;
  /** network = im Netzwerk sichtbar (Zeroconf), account = zusätzlich mit einem Konto gekoppelt */
  mode: 'network' | 'account';
  deviceName: string;
}

/** Zustand des go-librespot-Prozesses (vom Hauptprozess) */
export interface SpotifyProcessState {
  running: boolean;
  port: number;
  error: string | null;
  log?: string[];
}

export interface Track {
  id: string;
  artist: string;
  title: string;
  album: string | null;
  cover: string | null;
  station: string;
  /** ISO-Zeitstempel */
  time: string;
}

/** Gespeicherter YouTube-Link (Video, Playlist oder Livestream) */
export interface YouTubeItem {
  id: string;
  url: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  kind: 'video' | 'playlist' | 'live';
  /** Anzahl Titel bei Playlists */
  count?: number;
  /** Wunsch über die Fernbedienung: von wem */
  wishedBy?: string;
  /** Song aus einer Playlist der Queue: deren Titel */
  from?: string;
}

/** Treffer der YouTube-Suche (Video oder Playlist) */
export interface YouTubeResult {
  id: string;
  title: string;
  channel: string | null;
  duration: number;
  thumbnail: string | null;
  live?: boolean;
  kind?: 'playlist';
}

export interface YouTubeEntry {
  id: string;
  title: string;
  channel: string | null;
  duration: number;
  thumbnail: string | null;
}

export interface YouTubeInfo {
  kind: YouTubeItem['kind'];
  title: string;
  channel: string | null;
  thumbnail: string | null;
  duration?: number;
  entries: YouTubeEntry[];
}

export interface YouTubeStream {
  url: string;
  hls: boolean;
  live: boolean;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  fallbackThumbnail: string | null;
  duration: number;
}

export interface Settings {
  stations: Station[];
  volume: number;
  lastStationId: string | null;
  prefs?: Partial<Preferences>;
  history?: Track[];
  favorites?: Track[];
  youtube?: YouTubeItem[];
}

export interface CoverInfo {
  cover: string | null;
  album: string | null;
  /** Schreibweise laut iTunes, z. B. "Jason Mraz" statt "JASON MRAZ" */
  artist: string | null;
  title: string | null;
}

/** Was gerade läuft – erraten aus den Stream-Metadaten */
export type ContentKind = 'music' | 'news' | 'traffic' | 'ad' | 'talk' | 'program';

export interface NowPlaying {
  /** Rohtext aus den Stream-Metadaten */
  raw: string;
  kind: ContentKind;
  artist: string | null;
  title: string | null;
  album: string | null;
  cover: string | null;
}

export interface Weather {
  place: string;
  temperature: number;
  code: number;
  isDay: boolean;
}

/** Sender aus der Radio-Browser-Datenbank (Sender-Store) */
export interface StoreStation {
  id: string;
  name: string;
  url: string;
  favicon: string | null;
  homepage: string | null;
  tags: string[];
  country: string;
  countryCode: string;
  codec: string;
  bitrate: number;
  votes: number;
  clicks: number;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'error';

export interface RadioApi {
  loadSettings(): Promise<Settings | null>;
  saveSettings(settings: Settings): Promise<boolean>;
  getStreamUrl(url: string, session: number): Promise<string>;
  lookupCover(artist: string, title: string): Promise<CoverInfo | null>;
  /** mögliche Logo-Adressen, beste zuerst */
  lookupLogos(name: string, url: string): Promise<string[]>;
  setFullScreen(value: boolean): Promise<void>;
  getWeather(city: string): Promise<Weather | null>;
  getStoreStations(options: { scope: 'de' | 'world'; query?: string; tag?: string }): Promise<StoreStation[]>;
  getLaunchAtLogin(): Promise<boolean>;
  setLaunchAtLogin(value: boolean): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  getHostname(): Promise<string>;
  spotifyStart(options: { deviceName: string; mode: SpotifyPrefs['mode'] }): Promise<SpotifyProcessState>;
  spotifyStop(): Promise<void>;
  spotifyForget(): Promise<void>;
  spotifyState(): Promise<SpotifyProcessState>;
  onSpotifyState(callback: (state: SpotifyProcessState) => void): () => void;
  btStart(): Promise<boolean>;
  btStop(): Promise<void>;
  btSend(command: Record<string, string>): Promise<boolean>;
  btState(): Promise<{ running: boolean; log: string[] }>;
  btOpenSettings(): Promise<void>;
  openSoundSettings(): Promise<void>;
  onBtEvent(callback: (event: BtEvent) => void): () => void;
  airplayStart(name: string): Promise<unknown>;
  airplayStop(): Promise<void>;
  airplayState(): Promise<{ running: boolean; name: string; interfaces: { name: string; address: string }[]; error: string | null }>;
  onAirplayEvent(callback: (event: AirPlayEvent) => void): () => void;
  onAirplayAudio(callback: (pcm: Int16Array) => void): () => void;
  castDiscover(): Promise<CastDevice[]>;
  castFollow(target: CastTarget | null): Promise<void>;
  onCastEvent(callback: (event: CastEvent) => void): () => void;
  updateState(): Promise<UpdateState>;
  updateCheck(): Promise<UpdateState>;
  updateInstall(): Promise<boolean>;
  updateSetEnabled(enabled: boolean): Promise<void>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
  remoteStart(options: { key: string; pin: string; roomName: string; phone: AccessMode; room: AccessMode; joinPin: string }): Promise<RemoteInfo>;
  remoteStop(): Promise<void>;
  remoteInfo(): Promise<RemoteInfo>;
  remoteState(state: unknown): void;
  remoteReply(id: number, result: { ok?: boolean; error?: string }): void;
  onRemoteCommand(callback: (command: RemoteCommand) => void): () => void;
  onRemoteClients(callback: (clients: RemoteClient[]) => void): () => void;
  /** Einmalcode, den der Host groß zeigt (null = ausblenden) */
  onRemoteCode(callback: (code: { code: string; name: string; kind: 'phone' | 'radio' } | null) => void): () => void;
  roomScan(networks?: string): Promise<RoomHost[]>;
  roomProbe(address: string): Promise<RoomHost | null>;
  roomConnect(options: { url: string; key: string; clientId: string; name: string }): Promise<void>;
  roomDisconnect(): Promise<void>;
  roomRequest(options: { method?: 'GET' | 'POST'; path: string; body?: unknown; admin?: string }): Promise<{ status: number; body: any }>;
  roomJoin(options: { url: string; clientId: string; name: string; pin?: string; code?: string; request?: boolean }): Promise<{ status: number; body: any }>;
  onRoomEvent(callback: (event: RoomEvent) => void): () => void;
  youtubeInfo(url: string): Promise<YouTubeInfo>;
  /** Suche wie bei den Wünschen: Videos und Playlists (bzw. ein eingefügter Link) */
  youtubeSearch(query: string): Promise<YouTubeResult[]>;
  youtubePlaylist(id: string): Promise<YouTubeResult[]>;
  youtubeResolve(url: string): Promise<YouTubeStream>;
  youtubeUpdate(): Promise<{ output: string; version: string | null }>;
  youtubeVersion(): Promise<string | null>;
  onTitle(callback: (payload: { session: number; title: string }) => void): () => void;
  onStationInfo(callback: (payload: { session: number; name: string }) => void): () => void;
}

declare global {
  interface Window {
    radioApi?: RadioApi;
  }
}
