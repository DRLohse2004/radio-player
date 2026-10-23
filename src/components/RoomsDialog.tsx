import { useCallback, useEffect, useState } from 'react';
import { api, isDesktop } from '../api';
import { accessOf, newRemoteKey } from '../remote';
import type { RemoteClient, RemoteInfo, RemotePrefs, RoomHost, RoomPrefs } from '../types';
import { AccessChoice } from './AccessChoice';
import { CloseIcon, RoomIcon } from './Icons';

interface Props {
  remote: RemotePrefs;
  room: RoomPrefs;
  info: RemoteInfo;
  clients: RemoteClient[];
  defaultName: string;
  onRemote(prefs: RemotePrefs): void;
  onRoom(patch: Partial<RoomPrefs>): void;
  onClose(): void;
}

/** Rooms: links fernsteuern lassen (Host), rechts ein anderes Radio fernsteuern oder mithören */
export function RoomsDialog({ remote, room, info, clients, defaultName, onRemote, onRoom, onClose }: Props) {
  const [pinFor, setPinFor] = useState<RoomHost | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (pinFor ? setPinFor(null) : onClose());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pinFor]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings rooms-dialog">
        <header className="modal-header">
          <h2>Rooms</h2>
          <button type="button" className="icon-button" onClick={onClose} title="Schließen">
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="modal-body rooms-grid">
          <HostPane prefs={remote} info={info} clients={clients} name={room.name} defaultName={defaultName} onChange={onRemote} onName={(name) => onRoom({ name })} />
          <JoinPane prefs={room} defaultName={defaultName} onChange={onRoom} onClose={onClose} onSecure={setPinFor} />
        </div>
      </div>
      {pinFor && (
        <JoinPinDialog
          host={pinFor}
          prefs={room}
          myName={room.name.trim() || defaultName}
          onJoined={(key) => {
            onRoom({ join: { url: pinFor.url, key, name: pinFor.name } });
            setPinFor(null);
            onClose();
          }}
          onCancel={() => setPinFor(null)}
        />
      )}
    </div>
  );
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

// --- Links: dieses Radio fernsteuern lassen -----------------------------------------------

interface HostProps {
  prefs: RemotePrefs;
  info: RemoteInfo;
  clients: RemoteClient[];
  name: string;
  defaultName: string;
  onChange(prefs: RemotePrefs): void;
  onName(name: string): void;
}

function HostPane({ prefs, info, clients, name, defaultName, onChange, onName }: HostProps) {
  const set = (patch: Partial<RemotePrefs>) => onChange({ ...prefs, ...patch });
  const [roomName, setRoomName] = useState(name);
  useEffect(() => setRoomName(name), [name]);
  const enable = (enabled: boolean, secure: boolean) =>
    set(enabled && !prefs.key ? { enabled, secure, key: newRemoteKey() } : { enabled, secure: enabled ? secure : prefs.secure });
  const main = info.addresses?.[0];
  const online = clients.filter((c) => c.online);

  return (
    <section className="rooms-pane">
      <h3>Dieses Radio fernsteuern lassen</h3>
      <p className="muted small">Handys (QR-Code, ohne App), andere Radios und Home Assistant – ein Zugang, dieselben Regeln für alle.</p>
      <AccessChoice value={accessOf(prefs.enabled, prefs.secure)} onChange={(mode) => enable(mode !== 'off', mode === 'secure')} />
      {!isDesktop && <p className="muted small">Nur in der Desktop-App verfügbar.</p>}

      {prefs.enabled &&
        (info.error ? (
          <p className="error-text">{info.error}</p>
        ) : info.running && main ? (
          <div className="remote-connect">
            {info.qr && <div className="remote-qr" dangerouslySetInnerHTML={{ __html: info.qr }} />}
            <div className="remote-connect-text">
              <p>
                <strong>Mit dem Handy scannen</strong> – im selben Netzwerk wie dieser PC.
              </p>
              <p className="remote-url">{main.url.replace(/\?k=.*/, '')}</p>
              {info.port !== 80 && <p className="remote-warn">Port 80 ist belegt – das Radio läuft auf Port {info.port}.</p>}
              <p className="muted small">
                {online.length === 0
                  ? 'Gerade ist niemand verbunden.'
                  : `Verbunden: ${online.map((c) => `${c.name} (${c.kind === 'radio' ? 'Radio' : 'Handy'})`).join(', ')}`}
              </p>
            </div>
          </div>
        ) : (
          <p className="muted">Startet …</p>
        ))}

      {prefs.enabled && (
        <details className="rooms-more">
          <summary>Weitere Optionen</summary>
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
          </label>
          {prefs.secure && (
            <PinField
              label="Zugangs-PIN (4–8 Ziffern)"
              value={prefs.joinPin}
              hint="Statt des Einmalcodes. Leer = nur per Einmalcode, der beim Verbinden groß hier erscheint."
              onChange={(joinPin) => set({ joinPin })}
            />
          )}
          <PinField
            label="Admin-PIN (4–8 Ziffern)"
            value={prefs.pin}
            hint="Mit der PIN darf man alles: Wünsche anderer löschen, sortieren, Sender bearbeiten, Empfang schalten."
            onChange={(pin) => set({ pin })}
          />
          <h4 className="remote-section">Was dürfen alle?</h4>
          <Toggle checked={prefs.guestVolume} onChange={(v) => set({ guestVolume: v })} label="Lautstärke ändern" />
          <Toggle checked={prefs.guestSkip} onChange={(v) => set({ guestSkip: v })} label="Pause, Weiter und Zurück" hint="Auch: Queue starten." />
          <Toggle checked={prefs.guestStations} onChange={(v) => set({ guestStations: v })} label="Sender wechseln" />
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
          <Toggle
            checked={prefs.qrInFullscreen}
            onChange={(v) => set({ qrInFullscreen: v })}
            label="QR-Code im Vollbild zeigen"
            hint="Klein unten links am Büro-Bildschirm."
          />
          {(info.addresses?.length ?? 0) > 1 && (
            <p className="muted small">Weitere Adressen: {info.addresses!.slice(1).map((a) => `${a.address} (${a.name})`).join(', ')}</p>
          )}
          <button className="button" onClick={() => set({ key: newRemoteKey() })}>
            Neuen QR-Code erzeugen
          </button>
          <small className="muted">Sperrt alle bisher verbundenen Handys, Radios und Home Assistant aus.</small>
        </details>
      )}
    </section>
  );
}

// --- Rechts: ein anderes Radio fernsteuern ------------------------------------------------

interface JoinProps {
  prefs: RoomPrefs;
  defaultName: string;
  onChange(patch: Partial<RoomPrefs>): void;
  onClose(): void;
  onSecure(host: RoomHost): void;
}

function JoinPane({ prefs, onChange, onClose, onSecure }: JoinProps) {
  const [hosts, setHosts] = useState<RoomHost[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [networks, setNetworks] = useState(prefs.networks);
  useEffect(() => setNetworks(prefs.networks), [prefs.networks]);

  const scan = useCallback((extra: string) => {
    setScanning(true);
    setError(null);
    api
      .roomScan(extra)
      .then(setHosts)
      .finally(() => setScanning(false));
  }, []);

  const saveNetworks = () => {
    const value = networks.trim();
    if (value !== prefs.networks) onChange({ networks: value });
    return value;
  };

  useEffect(() => {
    if (!prefs.join && isDesktop) scan(prefs.networks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = (host: RoomHost) => {
    if (!host.open) return setError(`„${host.name}“ lässt gerade niemanden herein.`);
    setError(null);
    if (host.secure) return onSecure(host);
    onChange({ join: { url: host.url, key: host.key, name: host.name } });
    onClose();
  };

  const joinAddress = async () => {
    setError(null);
    const host = await api.roomProbe(address);
    if (!host) setError('Unter dieser Adresse antwortet kein Radio (Port 80 oder 8080).');
    else join(host);
  };

  if (prefs.join) {
    return (
      <section className="rooms-pane">
        <h3>Verbunden mit {prefs.join.name}</h3>
        <p className="muted small">
          Dieses Radio {prefs.mode === 'listen' ? 'spielt dasselbe wie der Host' : 'steuert den Host, ohne selbst Ton abzuspielen'}. Eigene Sender
          und Einstellungen sind nach dem Verlassen wieder da.
        </p>
        <div className="room-mode">
          <button className={`button${prefs.mode === 'listen' ? ' primary' : ''}`} onClick={() => onChange({ mode: 'listen' })}>
            Mithören
          </button>
          <button className={`button${prefs.mode === 'remote' ? ' primary' : ''}`} onClick={() => onChange({ mode: 'remote' })}>
            Nur Fernbedienung
          </button>
        </div>
        <button
          className="button danger"
          onClick={() => {
            onChange({ join: null });
            onClose();
          }}
        >
          Room verlassen
        </button>
      </section>
    );
  }

  return (
    <section className="rooms-pane">
      <h3>Ein anderes Radio fernsteuern</h3>
      <p className="muted small">Radio anklicken – danach oben zwischen Mithören und Nur Fernbedienung wählen.</p>
      <div className="room-hosts">
        {scanning && <p className="muted small">Suche Radios im Netz …</p>}
        {!scanning && hosts?.length === 0 && <p className="muted small">Kein Radio gefunden. Unter „Weitere Optionen“ lässt sich ein Netz oder eine Adresse eintragen.</p>}
        {hosts?.map((host) => (
          <button key={host.url} className="room-host-row" disabled={!host.open} onClick={() => join(host)}>
            <RoomIcon size={20} />
            <span className="room-host-text">
              <strong>{host.name}</strong>
              <small className="muted">
                {host.address}
                {host.port === 80 ? '' : `:${host.port}`}
                {host.open ? (host.secure ? ' · gesichert' : '') + (host.listeners ? ` · ${host.listeners} verbunden` : '') : ' · geschlossen'}
              </small>
            </span>
          </button>
        ))}
      </div>
      <button className="button" disabled={scanning || !isDesktop} onClick={() => scan(saveNetworks())}>
        {scanning ? 'Suche …' : 'Erneut suchen'}
      </button>
      {error && <p className="error-text">{error}</p>}
      <details className="rooms-more">
        <summary>Weitere Optionen</summary>
        <label className="field">
          <span>Auch in diesen Netzen suchen</span>
          <input
            value={networks}
            placeholder="z. B. 192.168.2.255, 10.0.0.0/24"
            onChange={(e) => setNetworks(e.target.value)}
            onBlur={saveNetworks}
            onKeyDown={(e) => e.key === 'Enter' && !scanning && scan(saveNetworks())}
          />
          <small className="muted">
            Broadcast-Adressen, Netze (…/24) oder einzelne Rechner, mit Komma getrennt. Ein /24-Netz wird zusätzlich Adresse für Adresse
            abgefragt.
          </small>
        </label>
        <div className="room-address">
          <input
            value={address}
            placeholder="Adresse des Radios, z. B. 192.168.1.20"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && address.trim() && joinAddress()}
          />
          <button className="button" disabled={!address.trim()} onClick={joinAddress}>
            Verbinden
          </button>
        </div>
      </details>
    </section>
  );
}

/** Gesichertes Radio: Der Code erscheint sofort groß am Host; alternativ die Zugangs-PIN */
function JoinPinDialog({ host, prefs, myName, onJoined, onCancel }: { host: RoomHost; prefs: RoomPrefs; myName: string; onJoined(key: string): void; onCancel(): void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async () => {
    setError(null);
    const result = await api.roomJoin({ url: host.url, clientId: prefs.clientId, name: myName, request: true });
    if (result.status !== 200) setError(result.body?.error ?? 'Der Host antwortet nicht.');
  }, [host.url, prefs.clientId, myName]);

  useEffect(() => {
    void request();
  }, [request]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    // Die Eingabe kann PIN oder Code sein – der Host prüft beides
    const result = await api.roomJoin({ url: host.url, clientId: prefs.clientId, name: myName, pin: value, code: value });
    setBusy(false);
    if (result.status === 200) onJoined(String(result.body.key));
    else setError(result.body?.error ?? 'Der Host antwortet nicht.');
  };

  return (
    <div className="modal-backdrop join-pin" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal join-pin-box">
        <h2>{host.name}</h2>
        <p className="muted">Den Code eingeben, der jetzt groß an diesem Radio steht – oder seine Zugangs-PIN.</p>
        <input
          autoFocus
          value={value}
          inputMode="numeric"
          maxLength={8}
          placeholder="Code oder PIN"
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && value && !busy && submit()}
        />
        {error && <p className="error-text">{error}</p>}
        <div className="join-pin-actions">
          <button className="mini" onClick={request}>
            Neuen Code anzeigen
          </button>
          <span />
          <button className="button" onClick={onCancel}>
            Abbrechen
          </button>
          <button className="button primary" disabled={!value || busy} onClick={submit}>
            Verbinden
          </button>
        </div>
      </div>
    </div>
  );
}
