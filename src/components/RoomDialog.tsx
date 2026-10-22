import { useCallback, useEffect, useState } from 'react';
import { api, isDesktop } from '../api';
import type { RemoteClient, RemoteInfo, RoomHost, RoomPrefs } from '../types';
import { CloseIcon, RoomIcon } from './Icons';

interface Props {
  prefs: RoomPrefs;
  defaultName: string;
  info: RemoteInfo;
  clients: RemoteClient[];
  onChange(patch: Partial<RoomPrefs>): void;
  onClose(): void;
}

export function RoomDialog({ prefs, defaultName, info, clients, onChange, onClose }: Props) {
  const [hosts, setHosts] = useState<RoomHost[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(prefs.name);
  useEffect(() => setName(prefs.name), [prefs.name]);
  const [networks, setNetworks] = useState(prefs.networks);
  useEffect(() => setNetworks(prefs.networks), [prefs.networks]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  // Beim Öffnen gleich suchen – außer man ist selbst Host oder schon drin
  useEffect(() => {
    if (!prefs.open && !prefs.join && isDesktop) scan(prefs.networks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = (host: RoomHost, mode: RoomPrefs['mode']) => {
    if (!host.open) {
      setError(`„${host.name}“ lässt gerade keine Radios beitreten.`);
      return;
    }
    onChange({ join: { url: host.url, key: host.key, name: host.name }, mode, open: false });
    onClose();
  };

  const joinAddress = async () => {
    setError(null);
    const host = await api.roomProbe(address);
    if (!host) setError('Unter dieser Adresse antwortet kein Radio (Port 80 oder 8080).');
    else join(host, 'listen');
  };

  const radios = clients.filter((c) => c.online && c.kind === 'radio');

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings room-dialog">
        <header className="modal-header">
          <h2>Room</h2>
          <button type="button" className="icon-button" onClick={onClose} title="Schließen">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="modal-body">
          {!isDesktop && <p className="muted small">Nur in der Desktop-App verfügbar.</p>}

          {prefs.join ? (
            <section className="settings-section">
              <h3>Verbunden mit {prefs.join.name}</h3>
              <p className="muted small">
                Dieses Radio {prefs.mode === 'listen' ? 'spielt dasselbe wie der Host' : 'steuert den Host, ohne selbst Ton abzuspielen'}.
                Eigene Sender und Einstellungen bleiben erhalten und sind nach dem Verlassen wieder da.
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
          ) : (
            <>
              <section className="settings-section">
                <h3>Dieses Radio ist der Host</h3>
                <label className="toggle-row">
                  <span>
                    <span className="toggle-label">Andere Radios dürfen beitreten</span>
                    <small>
                      Kollegen finden dieses Radio dann im Netz und können mithören oder es fernsteuern. Gut für den PC, an
                      dem die Lautsprecher hängen.
                    </small>
                  </span>
                  <input type="checkbox" className="switch" checked={prefs.open} onChange={(e) => onChange({ open: e.target.checked })} />
                </label>
                {prefs.open && (
                  <>
                    <label className="field">
                      <span>Name des Rooms</span>
                      <input
                        value={name}
                        maxLength={40}
                        placeholder={defaultName}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={() => name !== prefs.name && onChange({ name: name.trim() })}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      />
                    </label>
                    {info.error ? (
                      <p className="error-text">{info.error}</p>
                    ) : (
                      <p className="muted small">
                        {info.running
                          ? `Erreichbar unter ${info.addresses?.map((a) => a.address + (info.port === 80 ? '' : `:${info.port}`)).join(', ')}. `
                          : 'Startet … '}
                        {radios.length === 0 ? 'Noch kein Radio verbunden.' : `Verbunden: ${radios.map((c) => c.name).join(', ')}`}
                      </p>
                    )}
                    <p className="muted small">
                      Was Gäste dürfen (Lautstärke, Weiter, Sender, Wünsche), stellen Sie unter „Fernbedienung übers Handy“ ein – es gilt für
                      Handys und Radios gleich.
                    </p>
                  </>
                )}
              </section>

              {!prefs.open && (
                <section className="settings-section">
                  <h3>Einem Room beitreten</h3>
                  <div className="room-hosts">
                    {scanning && <p className="muted small">Suche Radios im Netz …</p>}
                    {!scanning && hosts?.length === 0 && (
                      <p className="muted small">
                        Kein Radio gefunden. Steht der Host in einem anderen Netz, tragen Sie unten das Netz ein oder geben Sie seine
                        Adresse direkt ein.
                      </p>
                    )}
                    {hosts?.map((host) => (
                      <div key={host.url} className="room-host-row">
                        <RoomIcon size={20} />
                        <div className="room-host-text">
                          <strong>{host.name}</strong>
                          <small className="muted">
                            {host.address}
                            {host.port === 80 ? '' : `:${host.port}`}
                            {host.open ? (host.listeners ? ` · ${host.listeners} verbunden` : '') : ' · nicht freigegeben'}
                          </small>
                        </div>
                        <button className="mini" disabled={!host.open} onClick={() => join(host, 'listen')}>
                          Mithören
                        </button>
                        <button className="mini" disabled={!host.open} onClick={() => join(host, 'remote')}>
                          Fernbedienen
                        </button>
                      </div>
                    ))}
                  </div>
                  <button className="button" disabled={scanning || !isDesktop} onClick={() => scan(saveNetworks())}>
                    {scanning ? 'Suche …' : 'Erneut suchen'}
                  </button>
                  <label className="field">
                    <span>Auch in diesen Netzen suchen</span>
                    <input
                      value={networks}
                      placeholder="z. B. 10.0.11.255, 10.0.255.255"
                      onChange={(e) => setNetworks(e.target.value)}
                      onBlur={saveNetworks}
                      onKeyDown={(e) => e.key === 'Enter' && !scanning && scan(saveNetworks())}
                    />
                    <small className="muted">
                      Broadcast-Adressen (10.0.11.255), Netze (10.0.11.0/24) oder einzelne Rechner, mit Komma getrennt. Ein /24-Netz
                      wird zusätzlich Adresse für Adresse abgefragt – das klappt auch, wenn der Router Broadcasts nicht weiterleitet.
                    </small>
                  </label>
                  <div className="room-address">
                    <input
                      value={address}
                      placeholder="Adresse des Hosts, z. B. 192.168.1.20"
                      onChange={(e) => setAddress(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && address.trim() && joinAddress()}
                    />
                    <button className="button" disabled={!address.trim()} onClick={joinAddress}>
                      Verbinden
                    </button>
                  </div>
                  {error && <p className="error-text">{error}</p>}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
