import { useEffect, useRef, useState } from 'react';
import { CheckIcon } from './Icons';

export interface StartupItem {
  label: string;
  state: 'pending' | 'done' | 'error';
  detail?: string;
}

/** Wie lange nach dem Start der Hinweis überhaupt erscheinen darf (spätere Ein/Aus-Klicks zeigen ihn nicht) */
const WINDOW_MS = 45_000;

/**
 * Ladebildschirm beim Start: deckt die App ab, bis die Einstellungen geladen sind, und zeigt danach
 * unten klein, welche Dienste im Hintergrund noch starten. Verschwindet, sobald alles bereit ist.
 */
export function StartupStatus({ loaded, items }: { loaded: boolean; items: StartupItem[] }) {
  const startedAt = useRef(Date.now());
  const [hidden, setHidden] = useState(false);
  const allDone = items.every((i) => i.state !== 'pending');

  useEffect(() => {
    if (!loaded) return;
    const left = WINDOW_MS - (Date.now() - startedAt.current);
    const timer = window.setTimeout(() => setHidden(true), allDone ? 2200 : Math.max(0, left));
    return () => window.clearTimeout(timer);
  }, [loaded, allDone]);

  return (
    <>
      <div className={`boot-overlay${loaded ? ' gone' : ''}`} aria-hidden={loaded}>
        <img src="./icon.svg" alt="" />
        <div>
          <strong>Radio</strong>
          Einstellungen werden geladen …
        </div>
      </div>

      {loaded && !hidden && items.length > 0 && (
        <div className={`startup-status${allDone ? ' done' : ''}`} role="status">
          <div className="startup-title">{allDone ? 'Alles bereit' : 'Wird gestartet …'}</div>
          <ul>
            {items.map((item) => (
              <li key={item.label} className={item.state}>
                <span className="startup-icon">
                  {item.state === 'done' ? <CheckIcon size={14} /> : item.state === 'error' ? '!' : <span className="spinner" />}
                </span>
                <span>{item.label}</span>
                {item.detail && <small>{item.detail}</small>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
