import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { CastDevice, CastEvent, CastTarget } from './types';

/** Senden an Chromecast: Das Gerät folgt der eigenen Wiedergabe, die solange stumm läuft. */
export function useCast(wish: Omit<CastTarget, 'device'>) {
  const [device, setDevice] = useState<CastDevice | null>(null);
  const [status, setStatus] = useState<CastEvent | null>(null);
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(
    () =>
      api.onCastEvent((e) => {
        setStatus(e);
        if (e.state === 'off') setDevice(null);
      }),
    [],
  );

  const wishRef = useRef(wish);
  wishRef.current = wish;
  const m = wish.media;
  const key = [device?.id, m.kind, m.kind === 'none' ? '' : m.url, wish.playing, wish.volume, wish.title, wish.artist, wish.cover].join('|');
  useEffect(() => {
    if (!device) return void api.castFollow(null);
    const send = () => void api.castFollow({ ...wishRef.current, device });
    send();
    // YouTube: regelmäßig die Position mitschicken, damit das Gerät nach Spulen oder Aussetzern nachzieht
    const timer = m.kind === 'youtube' && !m.live ? window.setInterval(send, 5000) : undefined;
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const search = () => {
    setSearching(true);
    api
      .castDiscover()
      .then(setDevices)
      .catch(() => setDevices([]))
      .finally(() => setSearching(false));
  };

  const choose = (d: CastDevice | null) => {
    setStatus(null);
    setDevice(d);
  };

  return { device, status, devices, searching, search, choose };
}

export type Cast = ReturnType<typeof useCast>;
