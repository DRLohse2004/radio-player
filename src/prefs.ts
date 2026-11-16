// Standard-Einstellungen und das Zusammenführen mit gespeicherten (älteren) Einstellungen.
import { newClientId } from './room';
import { THEMES } from './themes';
import type { Preferences } from './types';

export const DEFAULT_PREFS: Preferences = {
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
    secure: false,
    joinPin: '',
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
  room: { open: false, secure: false, name: '', join: null, mode: 'listen', volume: 0.7, clientId: '', networks: '' },
  tabs: { radio: true, youtube: true, spotify: true, airplay: true, bluetooth: true },
  theme: 'standard',
};

/**
 * Gespeicherte Einstellungen auf den aktuellen Stand bringen: Fehlende Felder (z. B. aus älteren Versionen)
 * kommen aus den Standardwerten, ein unbekanntes Design wird zu „Standard“, jedes Radio bekommt eine Kennung.
 */
export function mergePrefs(saved: Partial<Preferences> | undefined): Preferences {
  const prefs: Preferences = {
    ...DEFAULT_PREFS,
    ...saved,
    schedule: { ...DEFAULT_PREFS.schedule, ...saved?.schedule },
    spotify: { ...DEFAULT_PREFS.spotify, ...saved?.spotify },
    bluetooth: { ...DEFAULT_PREFS.bluetooth, ...saved?.bluetooth },
    airplay: { ...DEFAULT_PREFS.airplay, ...saved?.airplay },
    remote: { ...DEFAULT_PREFS.remote, ...saved?.remote },
    room: { ...DEFAULT_PREFS.room, ...saved?.room },
    tabs: { ...DEFAULT_PREFS.tabs, ...saved?.tabs },
  };
  if (!THEMES.some((t) => t.id === prefs.theme)) prefs.theme = 'standard';
  if (!prefs.room.clientId) prefs.room.clientId = newClientId();
  return prefs;
}
