// Zustand des Bluetooth-Empfangs (PC als Bluetooth-Lautsprecher) für die Oberfläche.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { BtDevice, BtEvent } from './types';

export interface BtMedia {
  source: string;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  cover: string | null;
  updatedAt: number;
}

export interface BluetoothState {
  running: boolean;
  ready: boolean;
  devices: BtDevice[];
  error: string | null;
  /** Gerät, über das Windows den Ton ausgibt */
  output: string | null;
  /** Titelinfos der per Bluetooth verbundenen Quelle, sofern Windows sie meldet */
  media: BtMedia | null;
}

// Eigene Medienquelle (dieses Radio) nie als Bluetooth-Quelle verwenden
const OWN_SOURCE = /radio|electron/i;
// Hinweise im Quellnamen auf eine Bluetooth-Quelle
const BLUETOOTH_HINT = /bluetooth|bth|avrcp|iphone|phone|a2dp/i;

function pickMedia(sessions: Map<string, BtMedia>): BtMedia | null {
  const candidates = [...sessions.values()].filter((m) => !OWN_SOURCE.test(m.source) && (m.title || m.artist));
  const hinted = candidates.filter((m) => BLUETOOTH_HINT.test(m.source));
  const pool = hinted.length ? hinted : candidates;
  return pool.sort((a, b) => Number(b.playing) - Number(a.playing) || b.updatedAt - a.updatedAt)[0] ?? null;
}

/**
 * Funk-Kopfhörer und -Headsets senden im selben 2,4-GHz-Band wie der Bluetooth-Empfang –
 * gleichzeitiges Empfangen (Handy) und Weitersenden (Headset) führt oft zu Aussetzern.
 */
export function isWirelessOutput(name: string | null) {
  return (
    !!name &&
    /bluetooth|jabra|airpods|buds|hands-?free|freisprech|wireless|bose|beats|sennheiser|plantronics|\bpoly\b|\bwh-|\bwf-|link \d{3}/i.test(
      name,
    )
  );
}

export function useBluetooth(enabled: boolean, ready: boolean) {
  const [state, setState] = useState<BluetoothState>({
    running: false,
    ready: false,
    devices: [],
    error: null,
    output: null,
    media: null,
  });
  const sessionsRef = useRef(new Map<string, BtMedia>());

  useEffect(
    () =>
      api.onBtEvent((event: BtEvent) => {
        switch (event.type) {
          case 'running':
            setState((s) => ({ ...s, running: event.running, ready: event.running && s.ready }));
            if (!event.running) sessionsRef.current.clear();
            break;
          case 'ready':
            setState((s) => ({ ...s, ready: true, error: null }));
            break;
          case 'devices':
            setState((s) => ({ ...s, devices: event.devices }));
            break;
          case 'state':
            setState((s) => ({
              ...s,
              devices: s.devices.map((d) => (d.id === event.id ? { ...d, state: event.state } : d)),
              error:
                event.result && event.result !== 'Success'
                  ? `Verbindung mit „${event.name}“ nicht möglich (${event.result}). Ist Bluetooth am Gerät an und ist es in der Nähe?`
                  : s.error,
            }));
            break;
          case 'sessions': {
            const active = new Set(event.sources);
            for (const key of [...sessionsRef.current.keys()]) if (!active.has(key)) sessionsRef.current.delete(key);
            setState((s) => ({ ...s, media: pickMedia(sessionsRef.current) }));
            break;
          }
          case 'media':
            sessionsRef.current.set(event.source, {
              source: event.source,
              title: event.title,
              artist: event.artist,
              album: event.album,
              playing: event.status === 'Playing',
              cover: event.cover,
              updatedAt: Date.now(),
            });
            setState((s) => ({ ...s, media: pickMedia(sessionsRef.current) }));
            break;
          case 'output':
            setState((s) => ({ ...s, output: event.name }));
            break;
          case 'error':
            setState((s) => ({ ...s, error: event.message }));
            break;
        }
      }),
    [],
  );

  useEffect(() => {
    if (!ready) return;
    if (enabled) {
      api.btStart();
    } else {
      api.btStop();
      setState((s) => ({ ...s, devices: [], media: null, error: null }));
    }
  }, [enabled, ready]);

  const connected = state.devices.find((d) => d.state === 'connected') ?? null;

  return {
    state,
    connected,
    connect: useCallback((id: string) => {
      setState((s) => ({ ...s, error: null }));
      api.btSend({ cmd: 'connect', id });
    }, []),
    disconnect: useCallback((id: string) => api.btSend({ cmd: 'disconnect', id }), []),
    mediaAction: useCallback(
      (action: 'playpause' | 'next' | 'prev') => {
        const source = state.media?.source;
        if (source) api.btSend({ cmd: 'media', action, source });
      },
      [state.media?.source],
    ),
  };
}
