import { useEffect, useState } from 'react';
import { isDesktop } from '../api';
import type { AirPlayState } from '../airplay';
import { AirPlayIcon, CloseIcon, MusicIcon } from './Icons';

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// --- Seitenleiste: Ein/Aus, Name, Hilfe -------------------------------------------------------

interface SidebarProps {
  enabled: boolean;
  name: string;
  defaultName: string;
  state: AirPlayState;
  onEnabledChange(enabled: boolean): void;
  onNameChange(name: string): void;
  onClose(): void;
}

export function AirPlaySidebar({ enabled, name, defaultName, state, onEnabledChange, onNameChange, onClose }: SidebarProps) {
  // Name erst übernehmen, wenn das Feld verlassen wird – jeder Neustart erzeugt sonst einen
  // Zwischen-Eintrag ("Rad", "Radi", …) in Bonjour-Gateways
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commitName = () => {
    const value = draft.trim();
    if (value !== name.trim()) onNameChange(value);
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="brand airplay">
          <AirPlayIcon size={22} />
          <span>AirPlay</span>
        </div>
        <button className="icon-button" onClick={onClose} title="Seitenleiste ausblenden">
          <CloseIcon size={18} />
        </button>
      </header>
      <div className="sidebar-scroll">
        <label className="toggle-row side-toggle">
          <span className="toggle-label">AirPlay-Empfang</span>
          <input
            type="checkbox"
            className="switch"
            checked={enabled}
            disabled={!isDesktop}
            onChange={(e) => onEnabledChange(e.target.checked)}
          />
        </label>

        <div className="side-section">
          <label className="field">
            <span>Name im AirPlay-Menü</span>
            <input
              value={draft}
              placeholder={defaultName}
              maxLength={50}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <small>Wird übernommen, sobald Sie das Feld verlassen oder Enter drücken.</small>
          </label>
          {enabled && state.interfaces.length > 0 && (
            <p className="muted small">
              Angekündigt über: {state.interfaces.map((i) => `${i.name} (${i.address})`).join(', ')}, Port {state.port}
            </p>
          )}
        </div>

        <details className="bt-help">
          <summary>Das Radio taucht am iPhone nicht auf?</summary>
          <ol>
            <li>iPhone und PC müssen im <strong>selben Netzwerk</strong> sein (bzw. das Netzwerk muss AirPlay weiterleiten).</li>
            <li>
              Beim ersten Start fragt Windows nach einer <strong>Firewall-Freigabe</strong> für „Radio“ – für das
              Netzwerk erlauben, in dem auch das iPhone ist.
            </li>
            <li>AirPlay am PC kurz aus- und wieder einschalten.</li>
            <li>
              Klappt es im Netzwerk nicht: <strong>Bluetooth</strong> (ohne Netzwerk) oder für Spotify{' '}
              <strong>Spotify Connect</strong> mit Konto-Kopplung nutzen.
            </li>
          </ol>
        </details>
      </div>
    </aside>
  );
}

// --- Mitte: Startbildschirm bzw. laufender Titel -----------------------------------------------

interface StageProps {
  enabled: boolean;
  deviceName: string;
  state: AirPlayState;
  position(): number;
  onEnable(): void;
}

export function AirPlayStage({ enabled, deviceName, state, position, onEnable }: StageProps) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state.playing]);

  if (!enabled) {
    return (
      <section className="spotify-panel">
        <div className="spotify-hero">
          <div className="spotify-hero-icon">
            <AirPlayIcon size={60} />
          </div>
          <h2>AirPlay vom iPhone</h2>
          <p>
            Das Radio erscheint auf iPhone, iPad und Mac als AirPlay-Lautsprecher. Musik aus jeder App – Apple Music,
            Spotify, YouTube, Podcasts – läuft dann in bester Qualität über diesen PC.
          </p>
          <p className="muted">iPhone und PC müssen im selben Netzwerk sein (oder das Netzwerk leitet AirPlay weiter).</p>
          {isDesktop ? (
            <button className="button primary" onClick={onEnable}>
              AirPlay aktivieren
            </button>
          ) : (
            <p className="muted">Nur in der Desktop-App verfügbar.</p>
          )}
        </div>
      </section>
    );
  }

  if (state.error) {
    return (
      <section className="spotify-panel">
        <div className="spotify-hero">
          <h2>AirPlay läuft nicht</h2>
          <p className="error-text">{state.error}</p>
        </div>
      </section>
    );
  }

  if (!state.client) {
    return (
      <section className="spotify-panel">
        <div className="bt-setup">
          <div className={`spotify-hero-icon${state.running ? ' ready airplay' : ''}`}>
            <AirPlayIcon size={56} />
          </div>
          <h2>{state.running ? 'Bereit für AirPlay' : 'AirPlay startet …'}</h2>
          <p>
            Am iPhone: <strong>Kontrollzentrum</strong> öffnen → in der Musik-Kachel auf das <strong>AirPlay-Symbol</strong>{' '}
            tippen → <strong>„{deviceName}“</strong> wählen.
          </p>
        </div>
      </section>
    );
  }

  const current = position();
  return (
    <section className="spotify-panel">
      <div className="spotify-now">
        <div className="cover main-cover">
          <div className="cover-fallback">
            <MusicIcon size={64} />
          </div>
          {state.cover && <img key={state.cover.slice(-40)} src={state.cover} alt="" />}
        </div>
        <div className="np-text">
          <div className="np-station">
            AirPlay · {state.client}
            {!state.playing && <span className="kind-badge">Pausiert</span>}
          </div>
          {state.title ? (
            <div className="track-info" key={`${state.title}|${state.artist}`}>
              <div className="track-title" title={state.title}>
                {state.title}
              </div>
              {state.artist && <div className="track-artist">{state.artist}</div>}
              {state.album && <div className="track-album">{state.album}</div>}
            </div>
          ) : (
            <div className="track-info">
              <div className="track-title">Musik von „{state.client}“</div>
              <div className="track-artist muted">Keine Titelinformationen</div>
            </div>
          )}
          {state.duration > 0 && (
            <div className="progress">
              <div className="progress-bar">
                <div style={{ width: `${Math.min(100, (current / state.duration) * 100)}%` }} />
              </div>
              <div className="progress-times">
                <span>{formatTime(current)}</span>
                <span>{formatTime(state.duration)}</span>
              </div>
            </div>
          )}
          <p className="bt-hint">Steuerung und Lautstärke am iPhone.</p>
        </div>
      </div>
    </section>
  );
}
