// Web-Fernbedienung: führt Befehle vom Handy aus, verwaltet die Wunschliste und schickt den
// aktuellen Zustand an den Webserver im Hauptprozess (der ihn an alle Handys verteilt).

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { RemoteClient, RemoteCommand, RemoteInfo, RemotePrefs, Wish, YouTubeItem } from './types';
import { watchUrl } from './youtube';

export function newRemoteKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

export function wishToItem(wish: Wish): YouTubeItem {
  return {
    id: `wish-${wish.id}`,
    url: watchUrl(wish.videoId),
    title: wish.title,
    channel: wish.channel,
    thumbnail: wish.thumbnail,
    kind: 'video',
    wishedBy: wish.by,
  };
}

export interface RemoteHandlers {
  toggle(): void;
  next(): void;
  prev(): void;
  setVolume(volume: number): void;
  selectStation(id: string): boolean;
  /** gespeicherten YouTube-Eintrag spielen */
  playYoutube(id: string): boolean;
  /** Wunschliste starten (läuft gerade etwas anderes, wird es unterbrochen) */
  startWishes(): void;
  /** Ein Wunsch kam dazu – die App entscheidet, ob er sofort startet */
  wishAdded(): void;
  /** Spotify Connect bzw. AirPlay-Empfang ein- oder ausschalten (nur Admins, prüft der Server) */
  setReceiver(kind: 'spotify' | 'airplay', enabled: boolean): void;
}

/** Zustand fürs Handy (ohne Wünsche und Regeln, die ergänzt der Hook) */
export type RemoteSnapshot = Record<string, unknown>;

export function useRemote(
  prefs: RemotePrefs,
  room: { open: boolean; name: string },
  ready: boolean,
  snapshot: RemoteSnapshot,
  handlers: RemoteHandlers,
) {
  const [info, setInfo] = useState<RemoteInfo>({ running: false });
  const [clients, setClients] = useState<RemoteClient[]>([]);
  const [wishes, setWishes] = useState<Wish[]>([]);
  const wishesRef = useRef(wishes);
  wishesRef.current = wishes;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // Server starten/stoppen – er läuft auch, wenn dieses Radio nur Host eines Rooms ist
  const serving = prefs.enabled || room.open;
  useEffect(() => {
    if (!ready) return;
    if (!serving || !prefs.key) {
      api.remoteStop().then(() => setInfo({ running: false }));
      return;
    }
    let cancelled = false;
    api.remoteStart({ key: prefs.key, pin: prefs.pin, roomOpen: room.open, roomName: room.name }).then((result) => {
      if (!cancelled) {
        setInfo(result);
        setClients(result.clients ?? []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, serving, prefs.key, prefs.pin, room.open, room.name]);

  useEffect(() => api.onRemoteClients(setClients), []);

  /** Ersten Wunsch aus der Liste nehmen */
  const takeWish = useCallback((): YouTubeItem | null => {
    const [first, ...rest] = wishesRef.current;
    if (!first) return null;
    wishesRef.current = rest;
    setWishes(rest);
    return wishToItem(first);
  }, []);

  const removeWish = useCallback((id: string) => setWishes((list) => list.filter((w) => w.id !== id)), []);
  const moveWish = useCallback(
    (id: string, delta: number) =>
      setWishes((list) => {
        const from = list.findIndex((w) => w.id === id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= list.length) return list;
        const next = [...list];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      }),
    [],
  );
  const clearWishes = useCallback(() => setWishes([]), []);

  // Befehle vom Handy
  useEffect(
    () =>
      api.onRemoteCommand((command: RemoteCommand) => {
        const h = handlersRef.current;
        const p = prefsRef.current;
        const { client } = command;
        const done = (result: { ok?: boolean; error?: string } = { ok: true }) => api.remoteReply(command.id, result);
        switch (command.action) {
          case 'toggle':
            h.toggle();
            return done();
          case 'next':
            h.next();
            return done();
          case 'prev':
            h.prev();
            return done();
          case 'volume': {
            const v = Number(command.value);
            if (!Number.isFinite(v)) return done({ error: 'Ungültige Lautstärke.' });
            h.setVolume(Math.max(0, Math.min(1, v)));
            return done();
          }
          case 'station':
            return done(h.selectStation(String(command.value)) ? { ok: true } : { error: 'Sender nicht gefunden.' });
          case 'youtubeItem':
            return done(h.playYoutube(String(command.value)) ? { ok: true } : { error: 'Eintrag nicht gefunden.' });
          case 'wishStart':
            if (!wishesRef.current.length) return done({ error: 'Die Wunschliste ist leer.' });
            h.startWishes();
            return done();
          case 'wish': {
            const video = command.video;
            if (!video) return done({ error: 'Kein Video.' });
            const list = wishesRef.current;
            if (list.some((w) => w.videoId === video.id)) return done({ error: 'Steht schon auf der Wunschliste.' });
            if (!client.admin) {
              if (p.maxMinutes > 0 && video.duration > p.maxMinutes * 60)
                return done({ error: `Zu lang – Wünsche dürfen höchstens ${p.maxMinutes} Minuten lang sein.` });
              const own = list.filter((w) => w.clientId === client.clientId).length;
              if (own >= p.maxWishes)
                return done({ error: `Du hast schon ${own} offene Wünsche – warte, bis einer gespielt wurde.` });
            }
            const wish: Wish = {
              id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
              videoId: video.id,
              title: video.title,
              channel: video.channel,
              duration: video.duration,
              thumbnail: video.thumbnail,
              by: client.name,
              clientId: client.clientId,
            };
            const next = [...list, wish];
            wishesRef.current = next;
            setWishes(next);
            h.wishAdded();
            return done({ ok: true });
          }
          case 'wishRemove': {
            const wish = wishesRef.current.find((w) => w.id === String(command.value));
            if (!wish) return done({ error: 'Wunsch nicht gefunden.' });
            if (!client.admin && wish.clientId !== client.clientId) return done({ error: 'Nur eigene Wünsche löschen.' });
            removeWish(wish.id);
            return done();
          }
          case 'wishMove': {
            const { id, delta } = (command.value ?? {}) as { id?: string; delta?: number };
            moveWish(String(id), delta === -1 ? -1 : 1);
            return done();
          }
          case 'wishClear':
            clearWishes();
            return done();
          case 'receiver': {
            const { kind, enabled } = (command.value ?? {}) as { kind?: string; enabled?: unknown };
            if (kind !== 'spotify' && kind !== 'airplay') return done({ error: 'Unbekannter Empfang.' });
            h.setReceiver(kind, !!enabled);
            return done();
          }
          default:
            return done({ error: 'Unbekannter Befehl.' });
        }
      }),
    [removeWish, moveWish, clearWishes],
  );

  // Zustand an die Handys – nur wenn sich etwas geändert hat
  const rules = {
    guestVolume: prefs.guestVolume,
    guestSkip: prefs.guestSkip,
    guestStations: prefs.guestStations,
    maxWishes: prefs.maxWishes,
    maxMinutes: prefs.maxMinutes,
    adminPin: !!prefs.pin,
  };
  const payload = JSON.stringify({ ...snapshot, wishes, rules });
  useEffect(() => {
    if (info.running) api.remoteState(JSON.parse(payload));
  }, [payload, info.running]);

  const refreshInfo = useCallback(() => api.remoteInfo().then(setInfo), []);

  return { info, clients, wishes, takeWish, removeWish, moveWish, clearWishes, refreshInfo };
}
