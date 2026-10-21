import { api, isDesktop } from '../api';
import { isWirelessOutput, type BluetoothState } from '../bluetooth';
import type { BtDevice } from '../types';
import { BluetoothIcon, CloseIcon, MusicIcon } from './Icons';

const STATE_TEXT: Record<BtDevice['state'], string> = {
  closed: 'Bereit',
  connecting: 'Verbinde …',
  connected: 'Verbunden',
};

// --- Seitenleiste: Ein/Aus, Handys, Hilfe ---------------------------------------------------

interface SidebarProps {
  enabled: boolean;
  hostname: string;
  state: BluetoothState;
  connected: BtDevice | null;
  onEnabledChange(enabled: boolean): void;
  onConnect(id: string): void;
  onDisconnect(id: string): void;
  onClose(): void;
}

export function BluetoothSidebar({ enabled, hostname, state, connected, onEnabledChange, onConnect, onDisconnect, onClose }: SidebarProps) {
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="brand bluetooth">
          <BluetoothIcon size={22} />
          <span>Bluetooth</span>
        </div>
        <button className="icon-button" onClick={onClose} title="Seitenleiste ausblenden">
          <CloseIcon size={18} />
        </button>
      </header>
      <div className="sidebar-scroll">
        <label className="toggle-row side-toggle">
          <span className="toggle-label">Bluetooth-Empfang</span>
          <input
            type="checkbox"
            className="switch"
            checked={enabled}
            disabled={!isDesktop}
            onChange={(e) => onEnabledChange(e.target.checked)}
          />
        </label>

        {enabled && (
          <>
            <div className="sidebar-label flush">Handys</div>
            {state.devices.length > 0 ? (
              <ul className="bt-devices">
                {state.devices.map((device) => (
                  <li key={device.id}>
                    <MusicIcon size={18} />
                    <span className="bt-device-name">{device.name}</span>
                    <span className={`bt-device-state ${device.state}`}>{STATE_TEXT[device.state]}</span>
                    {connected?.id === device.id ? (
                      <button className="mini" onClick={() => onDisconnect(device.id)}>
                        Trennen
                      </button>
                    ) : (
                      <button className="mini" disabled={device.state === 'connecting'} onClick={() => onConnect(device.id)}>
                        Verbinden
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="side-note">
                Kein Handy in Reichweite. Gekoppelte Handys erscheinen hier, sobald Bluetooth am Handy an ist – oder am
                Handy unter <strong>Einstellungen → Bluetooth</strong> auf „{hostname}“ tippen.
              </p>
            )}
            <OutputInfo output={state.output} />
            {state.error && <p className="error-text">{state.error}</p>}
          </>
        )}

        <details className="bt-help" open={enabled && state.devices.length === 0}>
          <summary>Neues Handy koppeln</summary>
          <ol>
            <li>
              Am Handy die <strong>Bluetooth-Einstellungen</strong> öffnen und Bluetooth einschalten.
            </li>
            <li>
              Am PC <button className="link-button" onClick={() => api.btOpenSettings()}>Windows-Bluetooth-Einstellungen öffnen</button> →{' '}
              <strong>Gerät hinzufügen → Bluetooth</strong> → das Handy auswählen und den Code auf beiden Geräten
              bestätigen.
            </li>
            <li>Das Handy erscheint dann hier in der Liste.</li>
          </ol>
        </details>
        <StutterTips />
      </div>
    </aside>
  );
}

// --- Mitte: Startbildschirm bzw. laufender Titel -----------------------------------------------

interface StageProps {
  enabled: boolean;
  hostname: string;
  state: BluetoothState;
  connected: BtDevice | null;
  onEnable(): void;
}

export function BluetoothStage({ enabled, hostname, state, connected, onEnable }: StageProps) {
  if (!enabled) {
    return (
      <section className="spotify-panel">
        <div className="spotify-hero">
          <div className="spotify-hero-icon">
            <BluetoothIcon size={60} />
          </div>
          <h2>Musik vom Handy per Bluetooth</h2>
          <p>
            Das Radio wird zum Bluetooth-Lautsprecher: iPhone oder Android-Handy verbinden und Musik aus jeder App
            abspielen – Spotify, Apple Music, YouTube. Funktioniert ohne WLAN und ohne Spotify Premium.
          </p>
          {isDesktop ? (
            <button className="button primary" onClick={onEnable}>
              Bluetooth-Empfang aktivieren
            </button>
          ) : (
            <p className="muted">Nur in der Desktop-App verfügbar.</p>
          )}
        </div>
      </section>
    );
  }

  if (!connected) {
    return (
      <section className="spotify-panel">
        <div className="bt-setup">
          <div className="spotify-hero-icon ready">
            <BluetoothIcon size={56} />
          </div>
          <h2>{state.running ? 'Bereit für Bluetooth' : 'Bluetooth-Empfang startet …'}</h2>
          <p>
            Am Handy unter <strong>Einstellungen → Bluetooth</strong> auf <strong>„{hostname}“</strong> tippen – oder
            links in der Seitenleiste ein gekoppeltes Handy verbinden.
          </p>
        </div>
      </section>
    );
  }

  const media = state.media;
  return (
    <section className="spotify-panel">
      <div className="spotify-now">
        <div className="cover main-cover">
          <div className="cover-fallback">
            <BluetoothIcon size={72} />
          </div>
          {media?.cover && <img key={media.cover.slice(-40)} src={media.cover} alt="" />}
        </div>
        <div className="np-text">
          <div className="np-station">
            Bluetooth · {connected.name}
            {media && !media.playing && <span className="kind-badge">Pausiert</span>}
          </div>
          {media?.title ? (
            <div className="track-info" key={media.title + media.artist}>
              <div className="track-title" title={media.title}>
                {media.title}
              </div>
              <div className="track-artist">{media.artist}</div>
              {media.album && <div className="track-album">{media.album}</div>}
            </div>
          ) : (
            <div className="track-info">
              <div className="track-title">Musik von „{connected.name}“</div>
              <div className="track-artist muted">Das Handy sendet keine Titelinformationen.</div>
            </div>
          )}
          <p className="bt-hint">Lautstärke am Handy regeln.</p>
        </div>
      </div>
    </section>
  );
}

/** Zeigt, wohin Windows den Ton ausgibt – und warnt bei Funk-Headsets (häufige Ursache für Aussetzer). */
function OutputInfo({ output }: { output: string | null }) {
  if (!output) return null;
  const wireless = isWirelessOutput(output);
  return (
    <div className={`bt-output${wireless ? ' warn' : ''}`}>
      <div>
        Wiedergabe über: <strong>{output}</strong>
      </div>
      {wireless && (
        <div className="bt-output-warn">
          Funk-Kopfhörer und -Headsets nutzen dasselbe Funkband wie Bluetooth. Gleichzeitiges Empfangen vom Handy und
          Weitersenden ans Headset führt oft zu Rucklern – für die beste Qualität Lautsprecher oder Monitor mit Kabel
          wählen.
        </div>
      )}
      <button className="link-button" onClick={() => api.openSoundSettings()}>
        Ausgabegerät ändern
      </button>
    </div>
  );
}

/** Hilfe bei Aussetzern: Den Bluetooth-Ton empfängt und spielt Windows selbst – die Qualität hängt vom PC ab. */
function StutterTips() {
  return (
    <details className="bt-help">
      <summary>Musik ruckelt? Tipps bei Aussetzern</summary>
      <p className="bt-help-intro">
        Den Bluetooth-Ton empfängt und spielt Windows selbst ab – wie gut das klappt, hängt vom Bluetooth-Chip und
        -Treiber des PCs ab.
      </p>
      <ol>
        <li>
          <strong>Energiemodus „Beste Leistung“</strong> wählen (Windows-Einstellungen → System → Energie &amp; Akku).
        </li>
        <li>
          Den Ton <strong>nicht über Funk-Kopfhörer oder -Headsets</strong> ausgeben, sondern über Lautsprecher oder
          Monitor mit Kabel.
        </li>
        <li>
          Das Handy <strong>in die Nähe des PCs</strong> legen – nicht in die Hosentasche, Notebook nicht zugeklappt.
        </li>
        <li>
          Hilft das nicht, liegt es meist am eingebauten Bluetooth-Chip: Ein <strong>USB-Bluetooth-Stick</strong>{' '}
          schafft oft Abhilfe.
        </li>
        <li>
          Für Spotify ist <strong>Spotify Connect</strong> die bessere Wahl (volle Qualität, keine Funkstrecke) – bei
          getrennten Netzwerken mit Konto-Kopplung (Spotify-Seitenleiste).
        </li>
      </ol>
    </details>
  );
}
