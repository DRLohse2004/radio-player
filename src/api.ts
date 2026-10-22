import type { RadioApi, Settings, Station } from './types';

const DESKTOP_ONLY = 'YouTube gibt es nur in der Desktop-App.';

export const DEFAULT_STATIONS: Station[] = [
  { id: '1live', name: '1LIVE', url: 'https://wdr-1live-live.icecastssl.wdr.de/wdr/1live/live/mp3/128/stream.mp3' },
  { id: 'absolut-2000er', name: 'Absolut 2000er', url: 'https://absolut-top.live-sm.absolutradio.de/absolut-top/stream/aacp' },
  { id: 'absolut-ai', name: 'Absolut AI', url: 'https://absolut-ai.live-sm.absolutradio.de/absolut-ai/stream/aacp' },
  { id: 'swr3', name: 'SWR3', url: 'https://liveradio.swr.de/sw282p3/swr3/play.mp3' },
  { id: 'antenne-chillout', name: 'Antenne Chillout', url: 'https://s4-webradio.antenne.de/chillout' },
  { id: '1fm-deep-house', name: '1.FM Deep House', url: 'https://strm112.1.fm/deephouse_mobile_mp3' },
  { id: '1fm-chillout-lounge', name: '1.FM Chillout Lounge', url: 'https://strm112.1.fm/chilloutlounge_mobile_mp3' },
  { id: 'jam-fm', name: 'JAM FM', url: 'https://stream.jam.fm/jamfm-live/mp3-128/' },
];

const STORAGE_KEY = 'radio-settings';

// Ersatz, wenn die Oberfläche ohne Electron im Browser läuft (npm run dev):
// Einstellungen im localStorage, Streams direkt, keine Titel-Metadaten.
const browserApi: RadioApi = {
  async loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Settings) : null;
    } catch {
      return null;
    }
  },
  async saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      return true;
    } catch {
      return false;
    }
  },
  async getStreamUrl(url) {
    return url;
  },
  async lookupCover() {
    return null;
  },
  async lookupLogos() {
    return [];
  },
  async getWeather() {
    return null;
  },
  async getStoreStations() {
    return [];
  },
  async getLaunchAtLogin() {
    return false;
  },
  async setLaunchAtLogin() {
    return false;
  },
  async getHostname() {
    return 'Browser';
  },
  async spotifyStart() {
    return { running: false, port: 0, error: 'Spotify Connect gibt es nur in der Desktop-App.' };
  },
  async spotifyStop() {},
  async spotifyForget() {},
  async spotifyState() {
    return { running: false, port: 0, error: null };
  },
  onSpotifyState() {
    return () => {};
  },
  async btStart() {
    return false;
  },
  async btStop() {},
  async btSend() {
    return false;
  },
  async btState() {
    return { running: false, log: [] };
  },
  async btOpenSettings() {},
  async openSoundSettings() {},
  async airplayStart() {
    return null;
  },
  async airplayStop() {},
  async airplayState() {
    return { running: false, name: '', interfaces: [], error: null };
  },
  onAirplayEvent() {
    return () => {};
  },
  onAirplayAudio() {
    return () => {};
  },
  onBtEvent() {
    return () => {};
  },
  async openExternal(url) {
    window.open(url, '_blank', 'noopener');
  },
  async setFullScreen(value) {
    if (value && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    if (!value && document.fullscreenElement) await document.exitFullscreen();
  },
  async updateState() {
    return { status: 'idle', current: '', version: null, notes: '', progress: 0, error: null, portable: false, url: null };
  },
  async updateCheck() {
    return { status: 'idle', current: '', version: null, notes: '', progress: 0, error: null, portable: false, url: null };
  },
  async updateInstall() {
    return false;
  },
  async updateSetEnabled() {},
  onUpdateState() {
    return () => {};
  },
  async remoteStart() {
    return { running: false, error: 'Die Fernbedienung gibt es nur in der Desktop-App.' };
  },
  async remoteStop() {},
  async remoteInfo() {
    return { running: false };
  },
  remoteState() {},
  remoteReply() {},
  onRemoteCommand() {
    return () => {};
  },
  onRemoteClients() {
    return () => {};
  },
  onRemoteCode() {
    return () => {};
  },
  async roomScan() {
    return [];
  },
  async roomProbe() {
    return null;
  },
  async roomConnect() {},
  async roomDisconnect() {},
  async roomRequest() {
    return { status: 0, body: { error: DESKTOP_ONLY } };
  },
  async roomJoin() {
    return { status: 0, body: { error: DESKTOP_ONLY } };
  },
  onRoomEvent() {
    return () => {};
  },
  async youtubeInfo() {
    throw new Error(DESKTOP_ONLY);
  },
  async youtubeResolve() {
    throw new Error(DESKTOP_ONLY);
  },
  async youtubeUpdate() {
    throw new Error(DESKTOP_ONLY);
  },
  async youtubeVersion() {
    return null;
  },
  onTitle() {
    return () => {};
  },
  onStationInfo() {
    return () => {};
  },
};

export const api: RadioApi = window.radioApi ?? browserApi;
export const isDesktop = Boolean(window.radioApi);

export function newStationId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
