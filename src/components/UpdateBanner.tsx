import { useEffect, useState } from 'react';
import { api } from '../api';
import type { UpdateState } from '../types';
import { CloseIcon } from './Icons';

const INITIAL: UpdateState = { status: 'idle', current: '', version: null, notes: '', progress: 0, error: null, portable: false, url: null };

/** Zustand der automatischen Updates (vom Hauptprozess) */
export function useUpdate(enabled: boolean, ready: boolean) {
  const [state, setState] = useState<UpdateState>(INITIAL);
  useEffect(() => {
    api.updateState().then(setState);
    return api.onUpdateState(setState);
  }, []);
  useEffect(() => {
    if (ready) api.updateSetEnabled(enabled);
  }, [enabled, ready]);
  return state;
}

/** Kleiner Hinweis unten links, sobald eine neue Version da ist */
export function UpdateBanner({ state }: { state: UpdateState }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const visible = ['available', 'downloading', 'ready'].includes(state.status) && dismissed !== `${state.status}${state.version}`;
  if (!visible) return null;

  return (
    <div className="update-banner" role="status">
      <div className="update-text">
        <strong>Neue Version {state.version}</strong>
        {state.status === 'downloading' && <span>Wird geladen … {Math.round(state.progress * 100)} %</span>}
        {state.status === 'ready' && <span>Bereit – das Radio startet kurz neu.</span>}
        {state.status === 'available' && !state.portable && <span>Neue .exe auf GitHub herunterladen.</span>}
      </div>
      {state.status === 'downloading' && (
        <div className="update-bar">
          <div style={{ width: `${Math.round(state.progress * 100)}%` }} />
        </div>
      )}
      {state.status === 'ready' && (
        <button
          className="button primary"
          disabled={installing}
          onClick={() => {
            setInstalling(true);
            api.updateInstall().catch(() => setInstalling(false));
          }}
        >
          {installing ? 'Startet neu …' : 'Jetzt neu starten'}
        </button>
      )}
      {state.status === 'available' && !state.portable && state.url && (
        <button className="button" onClick={() => api.openExternal(state.url!)}>
          Zur Download-Seite
        </button>
      )}
      <button className="icon-button tiny" onClick={() => setDismissed(`${state.status}${state.version}`)} title="Später">
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
