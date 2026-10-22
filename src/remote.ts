// Web-Fernbedienung: führt Befehle vom Handy aus, verwaltet die Wunschliste und schickt den
// aktuellen Zustand an den Webserver im Hauptprozess (der ihn an alle Handys verteilt).

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { AccessMode, RemoteClient, RemoteCommand, RemoteInfo, RemotePrefs, Wish, WishVideo, YouTubeItem } from './types';
import { moveTo } from './list';
import { watchUrl } from './youtube';

export function newRemoteKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

/** Zugang aus den beiden Schaltern: an/aus und sicher */
export const accessOf = (on: boolean, secure: boolean): AccessMode => (on ? (secure ? 'secure' : 'public') : 'off');

export function wishToItem(wish: Wish): YouTubeItem {
  const playlist = wish.count !== undefined;
  return {
    id: `wish-${wish.id}`,
    url: wish.url ?? (playlist ? `https://www.youtube.com/playlist?list=${wish.videoId}` : watchUrl(wish.videoId)),
    title: wish.title,
    channel: wish.channel,
    thumbnail: wish.thumbnail,
    kind: playlist ? 'playlist' : 'video',
    count: wish.count,
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
  /** gespeicherten YouTube-Eintrag suchen (für „+ Queue“) */
  findYoutube(id: string): YouTubeItem | undefined;
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
  room: { open: boolean; secure: boolean; name: string },
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
    api
      .remoteStart({
        key: prefs.key,
        pin: prefs.pin,
        roomName: room.name,
        phone: accessOf(prefs.enabled, prefs.secure),
        room: accessOf(room.open, room.secure),
        joinPin: prefs.joinPin,
      })
      .then((result) => {
      if (!cancelled) {
        setInfo(result);
        setClients(result.clients ?? []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, serving, prefs.key, prefs.pin, prefs.enabled, prefs.secure, prefs.joinPin, room.open, room.secure, room.name]);

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
  const moveWish = useCallback((id: string, toIndex: number) => setWishes((list) => moveTo(list, id, toIndex)), []);
  const clearWishes = useCallback(() => setWishes([]), []);

  /** Auf die Queue setzen – liefert eine Fehlermeldung, wenn die Regeln es nicht erlauben */
  const addWish = useCallback((video: WishVideo, client: RemoteCommand['client']): string | null => {
    const p = prefsRef.current;
    const list = wishesRef.current;
    if (list.some((w) => w.videoId === video.id)) return 'Steht schon auf der Wunschliste.';
    if (!client.admin) {
      // shortcut: Playlists und gespeicherte Einträge des Hosts (Länge unbekannt) sind von der Längenbegrenzung ausgenommen und zählen als ein Wunsch – bei Missbrauch Admin-Pflicht einführen
      if (p.maxMinutes > 0 && video.count === undefined && video.duration > p.maxMinutes * 60)
        return `Zu lang – Wünsche dürfen höchstens ${p.maxMinutes} Minuten lang sein.`;
      const own = list.filter((w) => w.clientId === client.clientId).length;
      if (own >= p.maxWishes) return `Du hast schon ${own} offene Wünsche – warte, bis einer gespielt wurde.`;
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
      count: video.count,
      url: video.url,
    };
    const next = [...list, wish];
    wishesRef.current = next;
    setWishes(next);
    handlersRef.current.wishAdded();
    return null;
  }, []);

  /** Gespeicherten Eintrag des Hosts hinten an die Queue hängen (Livestreams nicht – die enden nie) */
  const queueItem = useCallback(
    (item: YouTubeItem, client: RemoteCommand['client']) =>
      item.kind === 'live'
        ? 'Livestreams können nicht in die Queue.'
        : addWish(
            { id: item.url, url: item.url, title: item.title, channel: item.channel, thumbnail: item.thumbnail, duration: 0, count: item.kind === 'playlist' ? item.count ?? 0 : undefined },
            client,
          ),
    [addWish],
  );

  // Befehle vom Handy
  useEffect(
    () =>
      api.onRemoteCommand((command: RemoteCommand) => {
        const h = handlersRef.current;
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
            if (!command.video) return done({ error: 'Kein Video.' });
            const error = addWish(command.video, client);
            return done(error ? { error } : { ok: true });
          }
          case 'youtubeQueue': {
            const item = h.findYoutube(String(command.value));
            if (!item) return done({ error: 'Eintrag nicht gefunden.' });
            const error = queueItem(item, client);
            return done(error ? { error } : { ok: true });
          }
          case 'wishRemove': {
            const wish = wishesRef.current.find((w) => w.id === String(command.value));
            if (!wish) return done({ error: 'Wunsch nicht gefunden.' });
            if (!client.admin && wish.clientId !== client.clientId) return done({ error: 'Nur eigene Wünsche löschen.' });
            removeWish(wish.id);
            return done();
          }
          case 'wishMove': {
            const { id, to } = (command.value ?? {}) as { id?: string; to?: number };
            moveWish(String(id), Number(to));
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
    [removeWish, moveWish, clearWishes, addWish, queueItem],
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

  return { info, clients, wishes, takeWish, removeWish, moveWish, clearWishes, queueItem, refreshInfo };
}
