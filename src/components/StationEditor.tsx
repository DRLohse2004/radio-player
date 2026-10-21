import { useEffect, useRef, useState, type FormEvent } from 'react';
import { findStationLogo } from '../logo';
import type { Station } from '../types';
import { CloseIcon } from './Icons';
import { StationLogo } from './StationLogo';

interface Props {
  /** null = neuer Sender */
  station: Station | null;
  onSave(values: Omit<Station, 'id'>): void;
  onCancel(): void;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function StationEditor({ station, onSave, onCancel }: Props) {
  const [name, setName] = useState(station?.name ?? '');
  const [url, setUrl] = useState(station?.url ?? '');
  const [logo, setLogo] = useState(station?.logo ?? '');
  const [touched, setTouched] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const errors = {
    name: name.trim() ? null : 'Bitte einen Namen angeben.',
    url: isHttpUrl(url.trim()) ? null : 'Bitte eine gültige http(s)-Adresse angeben.',
    logo: !logo.trim() || isHttpUrl(logo.trim()) ? null : 'Bitte eine gültige Bild-Adresse angeben oder leer lassen.',
  };
  const valid = !errors.name && !errors.url && !errors.logo;

  const [logoSearch, setLogoSearch] = useState<'idle' | 'searching' | 'notfound'>('idle');
  const searchLogo = async () => {
    setLogoSearch('searching');
    const found = await findStationLogo(name.trim(), url.trim());
    if (found) {
      setLogo(found);
      setLogoSearch('idle');
    } else {
      setLogoSearch('notfound');
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    onSave({ name: name.trim(), url: url.trim(), logo: logo.trim() || undefined });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal" onSubmit={submit} noValidate>
        <header className="modal-header">
          <h2>{station ? 'Sender bearbeiten' : 'Sender hinzufügen'}</h2>
          <button type="button" className="icon-button" onClick={onCancel} title="Schließen">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="modal-preview">
          <StationLogo station={{ name: name || '?', logo: logo.trim() || undefined }} className="medium" />
          <div>
            <div className="preview-name">{name || 'Neuer Sender'}</div>
            <div className="preview-url">{url || 'Stream-Adresse'}</div>
          </div>
        </div>

        <label className="field">
          <span>Name</span>
          <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. WDR 2" />
          {touched && errors.name && <small className="error">{errors.name}</small>}
        </label>

        <label className="field">
          <span>Stream-Adresse</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/stream.mp3"
            spellCheck={false}
          />
          {touched && errors.url ? (
            <small className="error">{errors.url}</small>
          ) : (
            <small>Direkter Audio-Stream (MP3/AAC), keine Webseite.</small>
          )}
        </label>

        <label className="field">
          <span>Logo-Adresse (optional)</span>
          <div className="field-row">
            <input
              value={logo}
              onChange={(e) => {
                setLogo(e.target.value);
                setLogoSearch('idle');
              }}
              placeholder="leer lassen = automatisch suchen"
              spellCheck={false}
            />
            <button
              type="button"
              className="button"
              onClick={searchLogo}
              disabled={logoSearch === 'searching' || !name.trim() || !isHttpUrl(url.trim())}
              title="Logo anhand von Name und Stream-Adresse im Internet suchen"
            >
              {logoSearch === 'searching' ? 'Suche …' : 'Logo suchen'}
            </button>
          </div>
          {touched && errors.logo ? (
            <small className="error">{errors.logo}</small>
          ) : logoSearch === 'notfound' ? (
            <small className="error">Kein passendes Logo gefunden.</small>
          ) : (
            <small>Ohne Angabe wird das Logo nach dem Speichern automatisch gesucht.</small>
          )}
        </label>

        <footer className="modal-footer">
          <button type="button" className="button" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" className="button primary">
            Speichern
          </button>
        </footer>
      </form>
    </div>
  );
}
