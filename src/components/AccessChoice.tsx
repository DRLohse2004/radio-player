import type { AccessMode } from '../types';

const HINTS: Record<AccessMode, string> = {
  off: 'Niemand kann sich verbinden.',
  public: 'Jeder im Netzwerk kann sich verbinden.',
  secure: 'Nur mit Zugangs-PIN oder mit dem Einmalcode, der beim Verbinden groß auf diesem Radio erscheint.',
};

/** Zugang für Handys bzw. andere Radios: Aus, Öffentlich oder Sicher */
export function AccessChoice({ value, onChange }: { value: AccessMode; onChange(mode: AccessMode): void }) {
  return (
    <div className="access-choice">
      <div className="room-mode" role="radiogroup">
        {(['off', 'public', 'secure'] as const).map((mode) => (
          <button
            key={mode}
            role="radio"
            aria-checked={value === mode}
            className={`button${value === mode ? ' primary' : ''}`}
            onClick={() => onChange(mode)}
          >
            {mode === 'off' ? 'Aus' : mode === 'public' ? 'Öffentlich' : 'Sicher'}
          </button>
        ))}
      </div>
      <small className="muted">{HINTS[value]}</small>
    </div>
  );
}
