import { useEffect, useState } from 'react';
import { isDesktop } from '../api';
import { accessOf, newRemoteKey } from '../remote';
import type { RemoteClient, RemoteInfo, RemotePrefs } from '../types';
import { AccessChoice } from './AccessChoice';
import { CloseIcon, PhoneIcon } from './Icons';

interface Props {
  prefs: RemotePrefs;
  info: RemoteInfo;
  clients: RemoteClient[];
  /** Name, unter dem andere Radios und Home Assistant dieses Radio finden */
  name: string;
  defaultName: string;
  onName(name: string): void;
  onChange(prefs: RemotePrefs): void;
  onClose(): void;
}

/** PIN-Feld: übernimmt erst beim Verlassen (sonst startet der Server bei jeder Ziffer neu) */
function PinField({ label, value, hint, onChange }: { label: string; value: string; hint: string; onChange(pin: string): void }) {
  const [pin, setPin] = useState(value);
  useEffect(() => setPin(value), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={pin}
        inputMode="numeric"
        maxLength={8}
        placeholder="z. B. 2468"
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        onBlur={() => {
          const next = pin.length >= 4 ? pin : '';
          setPin(next);
          if (next !== value) onChange(next);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <small>{hint}</small>
    </label>
  );
}

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

export function RemoteDialog({ prefs, info, clients, name, defaultName, onName, onChange, onClose }: Props) {
  const set = (patch: Partial<RemotePrefs>) => onChange({ ...prefs, ...patch });
  const [roomName, setRoomName] = useState(name);
  useEffect(() => setRoomName(name), [name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const enable = (enabled: boolean, secure: boolean) =>
    set(enabled && !prefs.key ? { enabled, secure, key: newRemoteKey() } : { enabled, secure: enabled ? secure : prefs.secure });
  const main = info.addresses?.[0];
  const online = clients.filter((c) => c.online);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings remote-dialog">
        <header className="modal-header">
          <h2>Fernsteuern lassen</h2>
          <button type="button" className="icon-button" onClick={onClose} title="Schließen">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="modal-body">
          <p className="muted small">
            Handys (QR-Code, ohne App), andere Radios (Rooms: mithören oder fernsteuern) und Home Assistant steuern dieses Radio. Für alle
            gelten derselbe Zugang und dieselben Regeln.
          </p>
          <AccessChoice value={accessOf(prefs.enabled, prefs.secure)} onChange={(mode) => enable(mode !== 'off', mode === 'secure')} />
          {prefs.enabled && prefs.secure && (
            <PinField
              label="Zugangs-PIN (4–8 Ziffern)"
              value={prefs.joinPin}
              hint="Gilt für Handys, andere Radios und Home Assistant. Leer = nur per Einmalcode, der beim Verbinden groß hier erscheint."
              onChange={(joinPin) => set({ joinPin })}
            />
          )}
          {!isDesktop && <p className="muted small">Nur in der Desktop-App verfügbar.</p>}

          {prefs.enabled && (
            <>
              <label className="field">
                <span>Name im Netzwerk</span>
                <input
                  value={roomName}
                  maxLength={40}
                  placeholder={defaultName}
                  onChange={(e) => setRoomName(e.target.value)}
                  onBlur={() => roomName.trim() !== name && onName(roomName.trim())}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <small>So finden andere Radios und Home Assistant dieses Radio.</small>
              </label>
              {info.error ? (
                <p className="error-text">{info.error}</p>
              ) : info.running && main ? (
                <div className="remote-connect">
                  {info.qr && <div className="remote-qr" dangerouslySetInnerHTML={{ __html: info.qr }} />}
                  <div className="remote-connect-text">
                    <p>
                      <strong>Mit dem Handy scannen</strong> – Handy und PC müssen im selben Netzwerk sein (WLAN oder Kabel).
                    </p>
                    <p className="remote-url">{main.url.replace(/\?k=.*/, '')}</p>
                    {info.port !== 80 && (
                      <p className="remote-warn">
                        Port 80 ist auf diesem PC belegt – die Fernbedienung läuft auf Port {info.port}. Aus manchen WLANs
                        ist dieser Port nicht erreichbar.
                      </p>
                    )}
                    {(info.addresses?.length ?? 0) > 1 && (
                      <p className="muted small">
                        Weitere Adressen: {info.addresses!.slice(1).map((a) => `${a.address} (${a.name})`).join(', ')}
                      </p>
                    )}
                    <p className="muted small">
                      {online.length === 0
                        ? 'Gerade ist niemand verbunden.'
                        : `Verbunden: ${online.map((c) => `${c.name} (${c.kind === 'radio' ? 'Radio' : 'Handy'})`).join(', ')}`}
                    </p>
                    <button className="button" onClick={() => set({ key: newRemoteKey() })}>
                      Neuen QR-Code erzeugen
                    </button>
                    <small className="muted">Alte QR-Codes und gespeicherte Lesezeichen funktionieren danach nicht mehr.</small>
                  </div>
                </div>
              ) : (
                <p className="muted">Fernbedienung startet …</p>
              )}

              <h3 className="remote-section">Admin</h3>
              <PinField
                label="Admin-PIN (4–8 Ziffern)"
                value={prefs.pin}
                hint="Mit der PIN darf man am Handy alles: fremde Wünsche löschen, sortieren, die Liste leeren. Leer = kein Admin am Handy."
                onChange={(pin) => set({ pin })}
              />

              <h3 className="remote-section">Was dürfen alle?</h3>
              <Toggle checked={prefs.guestVolume} onChange={(v) => set({ guestVolume: v })} label="Lautstärke ändern" />
              <Toggle
                checked={prefs.guestSkip}
                onChange={(v) => set({ guestSkip: v })}
                label="Pause, Weiter und Zurück"
                hint="Auch: Wunschliste sofort starten."
              />
              <Toggle checked={prefs.guestStations} onChange={(v) => set({ guestStations: v })} label="Sender wechseln" />

              <h3 className="remote-section">Wünsche</h3>
              <div className="remote-limits">
                <label className="field">
                  <span>Offene Wünsche pro Person</span>
                  <select value={prefs.maxWishes} onChange={(e) => set({ maxWishes: Number(e.target.value) })}>
                    {[1, 2, 3, 5, 10].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Höchstlänge eines Songs</span>
                  <select value={prefs.maxMinutes} onChange={(e) => set({ maxMinutes: Number(e.target.value) })}>
                    {[5, 8, 10, 15, 30].map((n) => (
                      <option key={n} value={n}>
                        {n} Minuten
                      </option>
                    ))}
                    <option value={0}>beliebig</option>
                  </select>
                </label>
              </div>
              <p className="muted small">
                Wünsche spielen nach dem aktuellen YouTube-Titel. Läuft gar nichts, starten sie sofort; läuft das Radio,
                warten sie, bis jemand „Jetzt spielen“ tippt.
              </p>

              <Toggle
                checked={prefs.qrInFullscreen}
                onChange={(v) => set({ qrInFullscreen: v })}
                label="QR-Code im Vollbild zeigen"
                hint="Klein unten links – so finden Kollegen die Fernbedienung am Büro-Bildschirm."
              />
            </>
          )}

          {!prefs.enabled && (
            <div className="remote-intro">
              <PhoneIcon size={40} />
              <p>
                Nach dem Einschalten zeigt das Radio einen QR-Code. Wer ihn scannt, kann Lautstärke und Wiedergabe steuern,
                Sender wechseln und sich Songs von YouTube wünschen. Andere Radios finden es unter „Room“, Home Assistant über die
                Integration „Radio“.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
