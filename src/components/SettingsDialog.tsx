import { useEffect, useState } from 'react';
import { api, isDesktop } from '../api';
import type { Preferences, SourceTab, UpdateState } from '../types';
import { CloseIcon } from './Icons';

interface Props {
  prefs: Preferences;
  update: UpdateState;
  onChange(prefs: Preferences): void;
  onClose(): void;
}

// Reihenfolge Mo–So, Werte nach Date.getDay() (0 = Sonntag)
const DAYS: [number, string][] = [
  [1, 'Mo'],
  [2, 'Di'],
  [3, 'Mi'],
  [4, 'Do'],
  [5, 'Fr'],
  [6, 'Sa'],
  [0, 'So'],
];

const SWAP_OPTIONS = [2, 5, 10, 15, 30];

const TAB_OPTIONS: { id: SourceTab; label: string; hint?: string }[] = [
  { id: 'radio', label: 'Radio' },
  { id: 'youtube', label: 'YouTube', hint: 'Wünsche von der Fernbedienung spielen trotzdem.' },
  { id: 'spotify', label: 'Spotify', hint: 'Ausgeblendet ist Spotify Connect aus.' },
  { id: 'airplay', label: 'AirPlay', hint: 'Ausgeblendet ist der AirPlay-Empfang aus.' },
  { id: 'bluetooth', label: 'Bluetooth', hint: 'Ausgeblendet ist der Bluetooth-Empfang aus.' },
];

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange(v: boolean): void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SettingsDialog({ prefs, update, onChange, onClose }: Props) {
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);

  useEffect(() => {
    if (isDesktop) api.getLaunchAtLogin().then(setLaunchAtLogin);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => onChange({ ...prefs, [key]: value });
  const setSchedule = (patch: Partial<Preferences['schedule']>) => set('schedule', { ...prefs.schedule, ...patch });
  const toggleDay = (day: number) =>
    setSchedule({
      days: prefs.schedule.days.includes(day) ? prefs.schedule.days.filter((d) => d !== day) : [...prefs.schedule.days, day],
    });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings">
        <header className="modal-header">
          <h2>Einstellungen</h2>
          <button type="button" className="icon-button" onClick={onClose} title="Schließen">
            <CloseIcon size={18} />
          </button>
        </header>

        <section className="settings-section">
          <h3>Reiter</h3>
          <p className="muted small">Was Sie nicht brauchen, blenden Sie aus – die Einstellungen dazu bleiben erhalten.</p>
          <div className="tab-choices">
            {TAB_OPTIONS.map(({ id, label, hint }) => {
              const last = prefs.tabs[id] && Object.values(prefs.tabs).filter(Boolean).length === 1;
              return (
                <label key={id} className={`tab-choice${last ? ' disabled' : ''}`} title={last ? 'Mindestens ein Reiter bleibt sichtbar.' : hint}>
                  <input
                    type="checkbox"
                    checked={prefs.tabs[id]}
                    disabled={last}
                    onChange={(e) => set('tabs', { ...prefs.tabs, [id]: e.target.checked })}
                  />
                  <span>
                    {label}
                    {hint && <small>{hint}</small>}
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        <section className="settings-section">
          <h3>Updates</h3>
          <Toggle
            label="Automatisch aktualisieren"
            hint="Neue Versionen werden im Hintergrund geladen; Sie entscheiden, wann das Radio neu startet."
            checked={prefs.autoUpdate}
            onChange={(v) => set('autoUpdate', v)}
          />
          <div className="update-row">
            <span className="muted small">
              Version {update.current || '–'}
              {update.status === 'checking' && ' · suche …'}
              {update.status === 'current' && ' · aktuell'}
              {update.status === 'available' && ` · ${update.version} verfügbar`}
              {update.status === 'downloading' && ` · ${update.version} wird geladen (${Math.round(update.progress * 100)} %)`}
              {update.status === 'ready' && ` · ${update.version} bereit`}
              {update.status === 'error' && ` · ${update.error}`}
            </span>
            {isDesktop && (
              <button
                type="button"
                className="mini"
                disabled={update.status === 'checking' || update.status === 'downloading'}
                onClick={() => api.updateCheck()}
              >
                Jetzt prüfen
              </button>
            )}
          </div>
        </section>

        <section className="settings-section">
          <h3>Start</h3>
          <Toggle label="Beim Start automatisch abspielen" checked={prefs.autoplay} onChange={(v) => set('autoplay', v)} />
          <Toggle
            label="Beim Start im Vollbild"
            hint="Gilt auch, wenn der Zeitplan das Radio einschaltet."
            checked={prefs.startFullscreen}
            onChange={(v) => set('startFullscreen', v)}
          />
          {isDesktop && launchAtLogin !== null && (
            <Toggle
              label="Mit Windows starten"
              hint="Startet die App automatisch nach der Anmeldung."
              checked={launchAtLogin}
              onChange={(v) => api.setLaunchAtLogin(v).then(setLaunchAtLogin)}
            />
          )}
        </section>

        <section className="settings-section">
          <h3>Zeitplan</h3>
          <Toggle
            label="Radio automatisch ein- und ausschalten"
            hint="Z. B. zu Bürozeiten. Läuft die App beim Start innerhalb der Zeit, spielt sie sofort."
            checked={prefs.schedule.enabled}
            onChange={(v) => setSchedule({ enabled: v })}
          />
          <div className={`schedule${prefs.schedule.enabled ? '' : ' disabled'}`}>
            <label>
              Ein um
              <input type="time" value={prefs.schedule.start} onChange={(e) => setSchedule({ start: e.target.value })} />
            </label>
            <label>
              Aus um
              <input type="time" value={prefs.schedule.stop} onChange={(e) => setSchedule({ stop: e.target.value })} />
            </label>
            <div className="days">
              {DAYS.map(([day, label]) => (
                <button
                  key={day}
                  type="button"
                  className={prefs.schedule.days.includes(day) ? 'active' : ''}
                  onClick={() => toggleDay(day)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h3>Vollbild</h3>
          <label className="field">
            <span>Wetter für Ort</span>
            <input
              value={prefs.weatherCity}
              onChange={(e) => set('weatherCity', e.target.value)}
              placeholder="z. B. Berlin – leer lassen zum Ausblenden"
            />
          </label>
          <label className="field">
            <span>Cover und Text tauschen die Seiten (Einbrennschutz)</span>
            <select value={prefs.swapMinutes} onChange={(e) => set('swapMinutes', Number(e.target.value))}>
              {SWAP_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  alle {m} Minuten
                </option>
              ))}
              <option value={0}>nie</option>
            </select>
          </label>
          {isDesktop && (
            <Toggle
              label="Musik-Visualisierung"
              hint="Dezente Balken am unteren Bildrand, die sich zur Musik bewegen."
              checked={prefs.visualizer}
              onChange={(v) => set('visualizer', v)}
            />
          )}
        </section>

        <footer className="modal-footer">
          <button type="button" className="button primary" onClick={onClose}>
            Fertig
          </button>
        </footer>
      </div>
    </div>
  );
}
