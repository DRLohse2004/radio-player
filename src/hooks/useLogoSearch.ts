// Sucht fehlende Senderlogos automatisch – ein Sender nach dem anderen.
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { findStationLogo } from '../logo';
import type { Station } from '../types';

export function useLogoSearch(stations: Station[], setStations: Dispatch<SetStateAction<Station[]>>, enabled: boolean) {
  const pending = stations.find((s) => !s.logo && !s.logoChecked) ?? null;
  const pendingKey = pending ? `${pending.id}|${pending.name}|${pending.url}` : null;

  useEffect(() => {
    if (!enabled || !pending) return;
    const { id, name, url } = pending;
    let cancelled = false;
    findStationLogo(name, url).then((logo) => {
      if (cancelled) return;
      setStations((list) => list.map((s) => (s.id === id && !s.logo ? { ...s, logo: logo ?? undefined, logoChecked: true } : s)));
    });
    return () => {
      cancelled = true;
    };
    // nur neu starten, wenn sich der zu prüfende Sender ändert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pendingKey]);
}
