import { useEffect, useRef, useState } from 'react';
import type { Cast } from '../cast';
import { CastIcon } from './Icons';

const STATE_TEXT = {
  connecting: 'verbindet …',
  buffering: 'lädt …',
  playing: 'spielt',
  paused: 'pausiert',
  idle: 'bereit',
  error: 'Fehler',
  off: '',
} as const;

/** Knopf in der Leiste unten: Ton auf einen Chromecast- oder DLNA-Lautsprecher schicken */
export function CastButton({ cast }: { cast: Cast }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { device, status, devices, searching } = cast;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const toggle = () => {
    if (!open) cast.search();
    setOpen(!open);
  };
  const state = device && status?.state ? STATE_TEXT[status.state] : '';
  const title = device ? `Spielt auf „${device.name}“` : 'Auf Lautsprecher abspielen (Chromecast, DLNA)';

  return (
    <div className="cast" ref={ref}>
      <button className={`icon-button${device ? ' active' : ''}`} onClick={toggle} title={title} aria-label={title} aria-expanded={open}>
        <CastIcon size={20} />
      </button>
      {open && (
        <div className="cast-menu" role="menu">
          <div className="cast-head">
            Abspielen auf
            <button className="link-button" onClick={cast.search} disabled={searching}>
              {searching ? 'Sucht …' : 'Neu suchen'}
            </button>
          </div>
          <button className={`cast-item${device ? '' : ' active'}`} role="menuitemradio" aria-checked={!device} onClick={() => cast.choose(null)}>
            Diesem PC
          </button>
          {devices.map((d) => (
            <button
              key={d.id}
              className={`cast-item${device?.id === d.id ? ' active' : ''}`}
              role="menuitemradio"
              aria-checked={device?.id === d.id}
              onClick={() => cast.choose(d)}
            >
              {d.name}
              <small>{device?.id === d.id && state ? state : d.model}</small>
            </button>
          ))}
          {!searching && devices.length === 0 && <p className="cast-note">Kein Lautsprecher im Netzwerk gefunden.</p>}
          {status?.error && <p className="cast-note cast-error">{status.error}</p>}
          <p className="cast-note">Radio und YouTube. Der Lautsprecher holt den Stream selbst, der PC bleibt stumm.</p>
        </div>
      )}
    </div>
  );
}
