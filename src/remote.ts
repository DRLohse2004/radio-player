// Web-Fernbedienung: führt Befehle vom Handy aus, verwaltet die Wunschliste und schickt den
// aktuellen Zustand an den Webserver im Hauptprozess (der ihn an alle Handys verteilt).

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { AccessMode, RemoteClient, RemoteCommand, RemoteInfo, RemotePrefs, RoomPrefs, Wish, WishVideo, YouTubeEntry, YouTubeItem } from './types';
import { moveTo } from './list';
import { consumeTop, extractSong, moveSong, setSongs } from './queue';

export function newRemoteKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

/** Zugang aus den beiden Schaltern: an/aus und sicher */
/** Bis 1.13 hatte der Room-Host einen eigenen Zugang. War nur er an, übernimmt ihn jetzt die Fernbedienung. */
export function migrateRemote(remote: RemotePrefs, room?: Partial<RoomPrefs>): RemotePrefs {
  if (!room?.open || remote.enabled) return remote;
  return { ...remote, enabled: true, secure: !!room.secure, key: remote.key || newRemoteKey() };
}

export const accessOf = (on: boolean, secure: boolean): AccessMode => (on ? (secure ? 'secure' : 'public') : 'off');

const newWishId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface RemoteHandlers {
  toggle(): void;
  next(): void;
  prev(): void;
  setVolume(volume: number): void;
  selectStation(id: string): boolean;
  /** gespeicherten YouTube-Eintrag suchen (Abspielen = ganz oben in die Queue, „+“ = hinten an) */
  findYoutube(id: string): YouTubeItem | undefined;
  /** Queue abspielen (läuft gerade etwas anderes, wird es unterbrochen) */
  startQueue(): void;
  /** Etwas kam in die Queue – die App entscheidet, ob es startet */
  wishAdded(): void;
  /** Sender bzw. gespeicherte YouTube-Einträge bearbeiten – liefert eine Fehlermeldung oder null */
  edit(action: string, value: unknown): string | null | Promise<string | null>;
  /** Spotify Connect bzw. AirPlay-Empfang ein- oder ausschalten (nur Admins, prüft der Server) */
  setReceiver(kind: 'spotify' | 'airplay', enabled: boolean): void;
}

/** Zustand fürs Handy (ohne Wünsche und Regeln, die ergänzt der Hook) */
export type RemoteSnapshot = Record<string, unknown>;

export function useRemote(
  prefs: RemotePrefs,
  roomName: string,
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

  // Ein Zugang für alle: Handys, andere Radios (Rooms) und Home Assistant
  const serving = prefs.enabled;
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
        roomName,
        phone: accessOf(prefs.enabled, prefs.secure),
        room: accessOf(prefs.enabled, prefs.secure),
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
  }, [ready, serving, prefs.key, prefs.pin, prefs.enabled, prefs.secure, prefs.joinPin, roomName]);

  useEffect(() => api.onRemoteClients(setClients), []);

  /** Queue ändern – der Ref ist sofort aktuell, damit mehrere Befehle hintereinander richtig rechnen */
  const update = useCallback((change: (queue: Wish[]) => Wish[]) => {
    const next = change(wishesRef.current);
    if (next === wishesRef.current) return;
    wishesRef.current = next;
    setWishes(next);
  }, []);

  const removeWish = useCallback((id: string) => update((q) => q.filter((w) => w.id !== id)), [update]);
  const moveWish = useCallback((id: string, toIndex: number) => update((q) => moveTo(q, id, toIndex)), [update]);
  const clearWishes = useCallback(() => update(() => []), [update]);
  const consume = useCallback(() => update(consumeTop), [update]);
  const setEntries = useCallback((id: string, songs: YouTubeEntry[]) => update((q) => setSongs(q, id, songs)), [update]);
  /** Song verschieben: in seiner Playlist oder (out) als eigenen Eintrag in die Queue */
  const moveSongTo = useCallback(
    (wishId: string, songId: string, toIndex: number, out: boolean) =>
      update((q) => (out ? extractSong(q, wishId, songId, toIndex, newWishId()) : moveSong(q, wishId, songId, toIndex))),
    [update],
  );

  /** In die Queue setzen (top = ganz oben, spielt sofort) – liefert eine Fehlermeldung, wenn die Regeln es nicht erlauben */
  const addWish = useCallback(
    (video: WishVideo, client: RemoteCommand['client'], top = false): string | null => {
      const p = prefsRef.current;
      const list = wishesRef.current;
      if (!top && list.some((w) => w.videoId === video.id)) return 'Steht schon in der Queue.';
      if (!client.admin) {
        if (video.live) return 'Livestreams können nicht gewünscht werden.';
        // shortcut: Playlists und gespeicherte Einträge des Hosts (Länge unbekannt) sind von der Längenbegrenzung ausgenommen und zählen als ein Wunsch – bei Missbrauch Admin-Pflicht einführen
        if (p.maxMinutes > 0 && video.count === undefined && video.duration > p.maxMinutes * 60)
          return `Zu lang – Wünsche dürfen höchstens ${p.maxMinutes} Minuten lang sein.`;
        const own = list.filter((w) => w.clientId === client.clientId).length;
        if (own >= p.maxWishes) return `Du hast schon ${own} offene Wünsche – warte, bis einer gespielt wurde.`;
      }
      const wish: Wish = {
        id: newWishId(),
        videoId: video.id,
        title: video.title,
        channel: video.channel,
        duration: video.duration,
        thumbnail: video.thumbnail,
        by: client.name,
        clientId: client.clientId,
        count: video.count,
        url: video.url,
        live: video.live || undefined,
      };
      update((q) => {
        const next = top ? [wish, ...q] : [...q, wish];
        return video.entries ? setSongs(next, wish.id, video.entries) : next;
      });
      handlersRef.current.wishAdded();
      return null;
    },
    [update],
  );

  /** Gespeicherten Eintrag des Hosts in die Queue (top = ganz oben, spielt sofort) */
  const queueItem = useCallback(
    (item: YouTubeItem, client: RemoteCommand['client'], top = false) =>
      addWish(
        {
          id: item.url,
          url: item.url,
          title: item.title,
          channel: item.channel,
          thumbnail: item.thumbnail,
          duration: 0,
          count: item.kind === 'playlist' ? item.count ?? 0 : undefined,
          live: item.kind === 'live',
        },
        client,
        top,
      ),
    [addWish],
  );

  // Befehle vom Handy und aus dem Room
  useEffect(
    () =>
      api.onRemoteCommand((command: RemoteCommand) => {
        const h = handlersRef.current;
        const { client } = command;
        const done = (result: { ok?: boolean; error?: string } = { ok: true }) => api.remoteReply(command.id, result);
        const answer = (error: string | null) => done(error ? { error } : { ok: true });
        const value = (command.value ?? {}) as Record<string, unknown>;
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
          case 'youtubeItem': {
            const item = h.findYoutube(String(command.value));
            if (!item) return done({ error: 'Eintrag nicht gefunden.' });
            const error = queueItem(item, client, true);
            if (!error) h.startQueue();
            return answer(error);
          }
          case 'youtubeQueue': {
            const item = h.findYoutube(String(command.value));
            if (!item) return done({ error: 'Eintrag nicht gefunden.' });
            return answer(queueItem(item, client));
          }
          case 'wishStart':
            if (!wishesRef.current.length) return done({ error: 'Die Queue ist leer.' });
            h.startQueue();
            return done();
          case 'wish': {
            if (!command.video) return done({ error: 'Kein Video.' });
            const error = addWish(command.video, client, command.now);
            if (!error && command.now) h.startQueue();
            return answer(error);
          }
          case 'wishRemove': {
            const wish = wishesRef.current.find((w) => w.id === String(command.value));
            if (!wish) return done({ error: 'Nicht mehr in der Queue.' });
            if (!client.admin && wish.clientId !== client.clientId) return done({ error: 'Nur eigene Wünsche löschen.' });
            removeWish(wish.id);
            return done();
          }
          case 'wishMove':
            moveWish(String(value.id), Number(value.to));
            return done();
          case 'songMove':
            moveSongTo(String(value.wish), String(value.song), Number(value.to), !!value.out);
            return done();
          case 'wishClear':
            clearWishes();
            return done();
          case 'receiver': {
            const { kind, enabled } = value;
            if (kind !== 'spotify' && kind !== 'airplay') return done({ error: 'Unbekannter Empfang.' });
            h.setReceiver(kind, !!enabled);
            return done();
          }
          default:
            // Sender und gespeicherte YouTube-Einträge bearbeiten (nur Admins, prüft der Server)
            return void Promise.resolve(h.edit(command.action, command.value)).then(answer);
        }
      }),
    [removeWish, moveWish, moveSongTo, clearWishes, addWish, queueItem],
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

  return { info, clients, wishes, removeWish, moveWish, moveSongTo, clearWishes, consume, setEntries, addWish, queueItem, refreshInfo };
}
