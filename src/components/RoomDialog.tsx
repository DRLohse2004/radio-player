import { useCallback, useEffect, useState } from 'react';
import { api, isDesktop } from '../api';
import type { RoomHost, RoomPrefs } from '../types';
import { CloseIcon, RoomIcon } from './Icons';

interface Props {
  prefs: RoomPrefs;
  defaultName: string;
  onChange(patch: Partial<RoomPrefs>): void;
  onClose(): void;
}

export function RoomDialog({ prefs, defaultName, onChange, onClose }: Props) {
  const [hosts, setHosts] = useState<RoomHost[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Gesicherter Host: erst PIN oder Einmalcode, dann beitreten
  const [secureJoin, setSecureJoin] = useState<{ host: RoomHost; mode: RoomPrefs['mode']; value: string; busy: boolean; codeSent: boolean } | null>(null);
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

  // Beim Öffnen gleich suchen – außer man ist schon drin
  useEffect(() => {
    if (!prefs.join && isDesktop) scan(prefs.networks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = (host: RoomHost, mode: RoomPrefs['mode']) => {
    if (!host.open) {
      setError(`„${host.name}“ lässt gerade keine Radios beitreten.`);
      return;
    }
    if (host.secure) {
      setError(null);
      setSecureJoin({ host, mode, value: '', busy: false, codeSent: false });
      // Der Code erscheint gleich am Host – PIN bleibt als Alternative
      requestCode(host);
      return;
    }
    onChange({ join: { url: host.url, key: host.key, name: host.name }, mode });
    onClose();
  };

  const myName = prefs.name.trim() || defaultName;
  const requestCode = async (host: RoomHost) => {
    const result = await api.roomJoin({ url: host.url, clientId: prefs.clientId, name: myName, request: true });
    setSecureJoin((s) => (s && s.host.url === host.url ? { ...s, codeSent: result.status === 200 } : s));
    if (result.status !== 200) setError(result.body?.error ?? 'Der Host antwortet nicht.');
  };
  const sendSecure = async (request: boolean) => {
    if (!secureJoin) return;
    setSecureJoin({ ...secureJoin, busy: true });
    setError(null);
    // Die Eingabe kann PIN oder Code sein – der Host prüft beides
    const value = secureJoin.value.trim();
    const result = await api.roomJoin({
      url: secureJoin.host.url,
      clientId: prefs.clientId,
      name: myName,
      ...(request ? { request: true } : { pin: value, code: value }),
    });
    if (result.status !== 200) {
      setSecureJoin({ ...secureJoin, busy: false });
      setError(result.body?.error ?? 'Der Host antwortet nicht.');
    } else if (request) {
      setSecureJoin({ ...secureJoin, busy: false, codeSent: true });
    } else {
      const { host, mode } = secureJoin;
      onChange({ join: { url: host.url, key: String(result.body.key), name: host.name }, mode });
      onClose();
    }
  };

  const joinAddress = async () => {
    setError(null);
    const host = await api.roomProbe(address);
    if (!host) setError('Unter dieser Adresse antwortet kein Radio (Port 80 oder 8080).');
    else join(host, 'listen');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings room-dialog">
        <header className="modal-header">
          <h2>Room beitreten</h2>
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
                  <p className="muted small">
                    Ein anderes Radio im Netz mithören oder fernsteuern. Damit andere dieses Radio steuern können, oben auf das
                    Handy-Symbol („Fernsteuern lassen“).
                  </p>
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
                            {host.open ? (host.secure ? ' · gesichert' : '') + (host.listeners ? ` · ${host.listeners} verbunden` : '') : ' · nicht freigegeben'}
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
                  {secureJoin && (
                    <div className="room-secure">
                      <p className="muted small">
                        „{secureJoin.host.name}“ ist gesichert. Den Code eingeben, der jetzt groß am Host steht – oder die Zugangs-PIN.
                      </p>
                      <div className="room-address">
                        <input
                          autoFocus
                          value={secureJoin.value}
                          inputMode="numeric"
                          placeholder={secureJoin.codeSent ? 'Code vom Host' : 'PIN oder Code'}
                          onChange={(e) => setSecureJoin({ ...secureJoin, value: e.target.value.replace(/[^0-9]/g, '') })}
                          onKeyDown={(e) => e.key === 'Enter' && secureJoin.value && sendSecure(false)}
                        />
                        <button className="button primary" disabled={!secureJoin.value || secureJoin.busy} onClick={() => sendSecure(false)}>
                          Beitreten
                        </button>
                      </div>
                      <button className="mini" disabled={secureJoin.busy} onClick={() => sendSecure(true)}>
                        {secureJoin.codeSent ? 'Neuen Code anzeigen' : 'Code am Host anzeigen'}
                      </button>
                    </div>
                  )}
                  {error && <p className="error-text">{error}</p>}
                </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
