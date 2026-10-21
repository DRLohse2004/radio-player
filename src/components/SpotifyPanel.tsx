import { api, isDesktop } from '../api';
import { isSpotifyPlaying, useSpotifyPosition, type SpotifyState } from '../spotify';
import type { SpotifyPrefs } from '../types';
import { CloseIcon, ConnectIcon, MusicIcon } from './Icons';

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// --- Seitenleiste: Ein/Aus und Optionen ------------------------------------------------------

interface SidebarProps {
  prefs: SpotifyPrefs;
  defaultName: string;
  state: SpotifyState;
  onPrefsChange(prefs: SpotifyPrefs): void;
  onForgetAccount(): void;
  onClose(): void;
}

export function SpotifySidebar({ prefs, defaultName, state, onPrefsChange, onForgetAccount, onClose }: SidebarProps) {
  const set = (patch: Partial<SpotifyPrefs>) => onPrefsChange({ ...prefs, ...patch });

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="brand spotify">
          <ConnectIcon size={22} />
          <span>Spotify</span>
        </div>
        <button className="icon-button" onClick={onClose} title="Seitenleiste ausblenden">
          <CloseIcon size={18} />
        </button>
      </header>
      <div className="sidebar-scroll">
        <label className="toggle-row side-toggle">
          <span className="toggle-label">Spotify Connect</span>
          <input
            type="checkbox"
            className="switch"
            checked={prefs.enabled}
            disabled={!isDesktop}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
        </label>

        <div className="side-section">
          <label className="field">
            <span>Gerätename in der Spotify-App</span>
            <input
              value={prefs.deviceName}
              placeholder={defaultName}
              maxLength={60}
              onChange={(e) => set({ deviceName: e.target.value })}
            />
          </label>
          <div className="field">
            <span>Verbindung</span>
            <label className="radio-row">
              <input type="radio" checked={prefs.mode === 'network'} onChange={() => set({ mode: 'network' })} />
              <span>
                <strong>Im Netzwerk sichtbar</strong>
                <small>Jeder mit Spotify Premium im selben Netzwerk kann das Radio als Lautsprecher wählen.</small>
              </span>
            </label>
            <label className="radio-row">
              <input type="radio" checked={prefs.mode === 'account'} onChange={() => set({ mode: 'account' })} />
              <span>
                <strong>Zusätzlich mit einem Spotify-Konto koppeln</strong>
                <small>
                  Das Radio erscheint für dieses Konto überall – auch wenn Handy und PC in getrennten Netzen sind (z. B.
                  Gäste-WLAN).
                </small>
              </span>
            </label>
          </div>
          {prefs.mode === 'account' && state.username && (
            <button className="button" onClick={onForgetAccount}>
              Kopplung mit „{state.username}“ lösen
            </button>
          )}
        </div>
        <p className="side-note">Benötigt Spotify Premium. Sobald jemand das Radio in Spotify auswählt, schaltet es automatisch um.</p>
      </div>
    </aside>
  );
}

// --- Mitte: Startbildschirm bzw. laufender Titel -----------------------------------------------

interface StageProps {
  prefs: SpotifyPrefs;
  defaultName: string;
  state: SpotifyState;
  onEnable(): void;
}

export function SpotifyStage({ prefs, defaultName, state, onEnable }: StageProps) {
  const deviceName = prefs.deviceName.trim() || defaultName;

  if (!prefs.enabled) {
    return (
      <section className="spotify-panel">
        <div className="spotify-hero">
          <div className="spotify-hero-icon">
            <ConnectIcon size={64} />
          </div>
          <h2>Spotify Connect</h2>
          <p>
            Spielen Sie Musik aus der Spotify-App (Handy oder PC) über dieses Radio ab. Sobald jemand das Radio in
            Spotify auswählt, schaltet es automatisch um.
          </p>
          <p className="muted">Benötigt Spotify Premium.</p>
          {isDesktop ? (
            <button className="button primary" onClick={onEnable}>
              Spotify Connect aktivieren
            </button>
          ) : (
            <p className="muted">Nur in der Desktop-App verfügbar.</p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="spotify-panel">
      {state.process.error && !state.process.running ? (
        <div className="spotify-hero">
          <h2>Spotify Connect läuft nicht</h2>
          <p className="error-text">{state.process.error}</p>
        </div>
      ) : state.active && state.track ? (
        <NowPlayingSpotify state={state} />
      ) : (
        <div className="spotify-hero">
          <div className={`spotify-hero-icon${state.connected ? ' ready' : ''}`}>
            <ConnectIcon size={64} />
          </div>
          {!state.connected ? (
            <h2>Spotify Connect startet …</h2>
          ) : state.authCode ? (
            <>
              <h2>Mit Spotify-Konto koppeln</h2>
              <p>
                Öffnen Sie <strong>spotify.com/pair</strong> auf dem Handy oder PC und geben Sie diesen Code ein:
              </p>
              <div className="pair-code">{state.authCode.code}</div>
              <button className="button" onClick={() => api.openExternal(state.authCode!.url)}>
                Kopplungsseite hier öffnen
              </button>
              <p className="muted">Sie können das Radio auch ohne Kopplung im selben Netzwerk auswählen.</p>
            </>
          ) : (
            <>
              <h2>Bereit für Spotify</h2>
              <p>
                In der Spotify-App auf das Lautsprecher-Symbol tippen und <strong>„{deviceName}“</strong> wählen.
              </p>
              {state.username && <p className="muted">Gekoppelt mit „{state.username}“</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function NowPlayingSpotify({ state }: { state: SpotifyState }) {
  const position = useSpotifyPosition(state);
  const track = state.track!;
  const duration = track.duration || 1;
  return (
    <div className="spotify-now">
      <div className="cover main-cover">
        <div className="cover-fallback">
          <MusicIcon size={64} />
        </div>
        {track.cover && <img key={track.cover} src={track.cover} alt="" />}
      </div>
      <div className="np-text">
        <div className="np-station">
          Spotify Connect
          {state.username && <span className="spotify-user">· {state.username}</span>}
          {!isSpotifyPlaying(state) && <span className="kind-badge">Pausiert</span>}
        </div>
        <div className="track-info" key={track.uri}>
          <div className="track-title" title={track.name}>
            {track.name}
          </div>
          <div className="track-artist">{track.artists.join(', ')}</div>
          {track.album && <div className="track-album">{track.album}</div>}
        </div>
        <div className="progress">
          <div className="progress-bar">
            <div style={{ width: `${Math.min(100, (position / duration) * 100)}%` }} />
          </div>
          <div className="progress-times">
            <span>{formatTime(position)}</span>
            <span>{formatTime(track.duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
