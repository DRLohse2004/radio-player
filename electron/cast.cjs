// Senden an Chromecast (Google Cast, Protokoll CASTV2): Das Radio übergibt dem Gerät nur die Adresse
// des Senders bzw. des YouTube-Tons, das Gerät holt den Stream selbst. Gespielt wird im
// „Default Media Receiver“ von Google. Die eigene Wiedergabe läuft stumm weiter und bleibt der Taktgeber
// (Titel, Queue, Position) – Cast folgt ihr.
//
// Protokoll: TLS auf Port 8009, jede Nachricht ist ein CastMessage-Protobuf mit 4-Byte-Längenpräfix,
// der Inhalt JSON. Das Gerät nutzt ein selbst signiertes Zertifikat.

'use strict';

const tls = require('node:tls');
const multicastDns = require('multicast-dns');
const { pickInterfaces } = require('./airplay/raop.cjs');
const { expectedPosition, mediaKey, resolveMedia } = require('./cast-media.cjs');
const dlna = require('./dlna.cjs');

const APP_ID = 'CC1AD845'; // Default Media Receiver
const NS = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
};

// --- CastMessage (Protobuf, nur die Felder, die wir brauchen) ----------------------------

function varint(n) {
  const out = [];
  while (n > 0x7f) out.push((n & 0x7f) | 0x80), (n >>>= 7);
  out.push(n);
  return Buffer.from(out);
}

const field = (num, value) =>
  typeof value === 'number'
    ? Buffer.concat([varint(num << 3), varint(value)])
    : Buffer.concat([varint((num << 3) | 2), varint(Buffer.byteLength(value)), Buffer.from(value)]);

/** Eine Nachricht samt Längenpräfix */
function encode({ source, destination, namespace, data }) {
  const body = Buffer.concat([
    field(1, 0), // CASTV2_1_0
    field(2, source),
    field(3, destination),
    field(4, namespace),
    field(5, 0), // STRING
    field(6, JSON.stringify(data)),
  ]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}

/** Protobuf-Körper ohne Längenpräfix → { source, destination, namespace, data } */
function decode(buf) {
  const msg = {};
  let i = 0;
  const readVarint = () => {
    let n = 0;
    let shift = 0;
    let b;
    do {
      b = buf[i++];
      n += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return n;
  };
  while (i < buf.length) {
    const tag = readVarint();
    const num = tag >>> 3;
    if ((tag & 7) === 0) {
      readVarint();
      continue;
    }
    const len = readVarint();
    const value = buf.subarray(i, i + len).toString('utf8');
    i += len;
    if (num === 2) msg.source = value;
    if (num === 3) msg.destination = value;
    if (num === 4) msg.namespace = value;
    if (num === 6) msg.data = JSON.parse(value);
  }
  return msg;
}

// --- Geräte finden (mDNS _googlecast._tcp) -----------------------------------------------

/** Sucht ca. 2,5 s nach Cast-Geräten: [{ id, name, model, host, port, kind: 'cast' }] */
function discoverCast(timeout = 2500) {
  return new Promise((resolve) => {
    const found = new Map();
    const hosts = new Map(); // Rechnername → IPv4
    const services = new Map(); // Dienstname → { target, port, txt }
    const collect = (records) => {
      for (const r of records) {
        if (r.type === 'A') hosts.set(r.name, r.data);
        if (r.type === 'SRV') services.set(r.name, { ...services.get(r.name), target: r.data.target, port: r.data.port });
        if (r.type === 'TXT') {
          const txt = {};
          for (const b of [].concat(r.data)) {
            const s = b.toString();
            const eq = s.indexOf('=');
            if (eq > 0) txt[s.slice(0, eq)] = s.slice(eq + 1);
          }
          services.set(r.name, { ...services.get(r.name), txt });
        }
      }
      for (const s of services.values()) {
        const host = hosts.get(s.target);
        if (!host || !s.port || !s.txt?.id || s.txt.ca === undefined) continue;
        // Gruppen (Multiroom) haben eigene Ports und funktionieren genauso
        found.set(s.txt.id, { id: s.txt.id, name: s.txt.fn || s.txt.md || host, model: s.txt.md || '', host, port: s.port, kind: 'cast' });
      }
    };
    const sockets = pickInterfaces().map(({ address }) => {
      const mdns = multicastDns({ interface: address, reuseAddr: true, loopback: false });
      mdns.on('error', () => {});
      mdns.on('response', (r) => collect([...r.answers, ...r.additionals]));
      mdns.query({ questions: [{ name: '_googlecast._tcp.local', type: 'PTR' }] });
      return mdns;
    });
    setTimeout(() => {
      for (const s of sockets) s.destroy();
      resolve([...found.values()]);
    }, timeout);
  });
}

/** Chromecast- und DLNA-Geräte zusammen; kann ein Gerät beides (z. B. WiiM Pro), bleibt Chromecast */
async function discover() {
  const [cast, upnp] = await Promise.all([discoverCast(), dlna.discover().catch(() => [])]);
  const castHosts = new Set(cast.map((d) => d.host));
  return [...cast, ...upnp.filter((d) => !castHosts.has(d.host))].sort((a, b) => a.name.localeCompare(b.name));
}

// --- Verbindung zu einem Gerät -----------------------------------------------------------

class CastClient {
  constructor(device, onMessage, onClose) {
    this.requestId = 1;
    this.pending = Buffer.alloc(0);
    this.socket = tls.connect({ host: device.host, port: device.port, rejectUnauthorized: false });
    this.socket.setTimeout(20_000);
    this.socket.on('timeout', () => this.socket.destroy(new Error('Das Gerät antwortet nicht.')));
    this.socket.on('data', (chunk) => {
      this.pending = Buffer.concat([this.pending, chunk]);
      while (this.pending.length >= 4) {
        const len = this.pending.readUInt32BE(0);
        if (this.pending.length < 4 + len) break;
        const msg = decode(this.pending.subarray(4, 4 + len));
        this.pending = this.pending.subarray(4 + len);
        if (msg.namespace === NS.heartbeat && msg.data?.type === 'PING') this.send(NS.heartbeat, { type: 'PONG' }, msg.source);
        else onMessage(msg);
      }
    });
    this.socket.on('error', (err) => (this.error = err));
    this.socket.on('close', () => onClose(this.error));
    this.ready = new Promise((resolve, reject) => {
      this.socket.once('secureConnect', resolve);
      this.socket.once('error', reject);
    });
    this.send(NS.connection, { type: 'CONNECT' });
    this.heartbeat = setInterval(() => this.send(NS.heartbeat, { type: 'PING' }), 5000);
  }

  send(namespace, data, destination = 'receiver-0') {
    if (this.socket.destroyed) return;
    const withId = data.type === 'PING' || data.type === 'PONG' || data.type === 'CONNECT' ? data : { requestId: this.requestId++, ...data };
    this.socket.write(encode({ source: 'sender-0', destination, namespace, data: withId }));
  }

  close() {
    clearInterval(this.heartbeat);
    this.socket.destroy();
  }
}

// --- Dem Radio folgen --------------------------------------------------------------------

let sendToRenderer = () => {};
let client = null;
let device = null; // { id, host, port, name }
let app = null; // { transportId, sessionId } des Media Receivers
let media = null; // { key, mediaSessionId, state }
let wanted = null; // letzter Wunsch der Oberfläche
let launching = false;
let lastVolume = -1;
let lastPlaying = null;

const emit = (state, extra = {}) => sendToRenderer('cast:event', { state, device: device?.name ?? null, ...extra });

function reset() {
  client?.close();
  client = null;
  device = null;
  app = null;
  media = null;
  launching = false;
  lastVolume = -1;
  lastPlaying = null;
}

function onMessage(msg) {
  const data = msg.data ?? {};
  if (msg.namespace === NS.receiver && data.type === 'RECEIVER_STATUS') {
    const running = data.status?.applications?.find((a) => a.appId === APP_ID);
    if (running && !app) {
      app = { transportId: running.transportId, sessionId: running.sessionId };
      launching = false;
      client.send(NS.connection, { type: 'CONNECT' }, app.transportId);
      sync();
    } else if (!running && app) {
      // Jemand anderes hat übernommen (oder die App wurde am Gerät beendet)
      const name = device?.name;
      reset();
      sendToRenderer('cast:event', { state: 'off', device: name, error: `Auf „${name}“ spielt jetzt etwas anderes.` });
    }
  }
  if (msg.namespace === NS.receiver && data.type === 'LAUNCH_ERROR') {
    launching = false;
    fail(new Error('Das Gerät konnte den Player nicht starten.'));
  }
  if (msg.namespace === NS.media && data.type === 'MEDIA_STATUS' && media) {
    const status = data.status?.[0];
    if (!status) return;
    media.mediaSessionId = status.mediaSessionId;
    media.state = status.playerState;
    if (status.playerState === 'IDLE' && status.idleReason === 'ERROR') {
      media = null;
      return emit('error', { error: 'Das Gerät kann diesen Stream nicht abspielen.' });
    }
    emit(status.playerState === 'BUFFERING' ? 'buffering' : status.playerState === 'PAUSED' ? 'paused' : 'playing');
    // YouTube: nachziehen, wenn das Gerät mehr als 3 s neben der eigenen Wiedergabe liegt
    const m = wanted?.media;
    if (status.playerState === 'PLAYING' && m?.kind === 'youtube' && !m.live && wanted.playing) {
      const target = expectedPosition(m);
      if (Math.abs(status.currentTime - target) > 3) {
        client.send(NS.media, { type: 'SEEK', mediaSessionId: media.mediaSessionId, currentTime: target + 1 }, app.transportId);
      }
    }
  }
  if (msg.namespace === NS.media && (data.type === 'LOAD_FAILED' || data.type === 'INVALID_REQUEST')) {
    media = null;
    emit('error', { error: 'Das Gerät kann diesen Stream nicht abspielen.' });
  }
}

function fail(err) {
  const name = device?.name;
  reset();
  sendToRenderer('cast:event', { state: 'off', device: name, error: err?.message || 'Verbindung zum Gerät verloren.' });
}

async function load(m) {
  const key = mediaKey(m);
  media = { key, mediaSessionId: null, state: 'LOADING' };
  emit('buffering');
  let resolved;
  try {
    resolved = await resolveMedia(m);
  } catch {
    if (media?.key === key) media = null;
    return emit('error', { error: 'YouTube-Titel konnte nicht geladen werden.' });
  }
  const { url, live } = resolved;
  // Inzwischen etwas anderes gewünscht oder Verbindung weg?
  if (!app || media?.key !== key) return;
  const w = wanted;
  client.send(
    NS.media,
    {
      type: 'LOAD',
      autoplay: w.playing,
      currentTime: live ? 0 : Math.max(0, expectedPosition(m)),
      media: {
        contentId: url,
        contentType: resolved.type,
        streamType: live ? 'LIVE' : 'BUFFERED',
        metadata: {
          metadataType: 3, // MUSIC_TRACK
          title: w.title || w.station || 'Radio',
          artist: w.artist || '',
          images: w.cover ? [{ url: w.cover }] : [],
        },
      },
    },
    app.transportId,
  );
  lastPlaying = w.playing;
}

/** Bringt das Gerät auf den Stand von `wanted` */
function sync() {
  const w = wanted;
  if (!client || !w) return;
  if (w.volume !== lastVolume) {
    lastVolume = w.volume;
    client.send(NS.receiver, { type: 'SET_VOLUME', volume: { level: w.volume } });
  }
  const key = mediaKey(w.media);
  if (!key) {
    // Spotify, AirPlay oder Bluetooth: Das Gerät schweigt, bleibt aber ausgewählt
    if (app) client.send(NS.receiver, { type: 'STOP', sessionId: app.sessionId });
    app = null;
    media = null;
    return emit('idle');
  }
  if (!app) {
    if (!launching) {
      launching = true;
      emit('connecting');
      client.send(NS.receiver, { type: 'LAUNCH', appId: APP_ID });
    }
    return;
  }
  if (media?.key !== key) return void load(w.media);
  // YouTube: Stand abfragen, die Antwort zieht bei Abweichung nach (siehe onMessage)
  if (media.mediaSessionId && w.media.kind === 'youtube' && !w.media.live) {
    client.send(NS.media, { type: 'GET_STATUS', mediaSessionId: media.mediaSessionId }, app.transportId);
  }
  if (media.mediaSessionId && w.playing !== lastPlaying) {
    lastPlaying = w.playing;
    client.send(NS.media, { type: w.playing ? 'PLAY' : 'PAUSE', mediaSessionId: media.mediaSessionId }, app.transportId);
  }
}

/**
 * Wunsch der Oberfläche: target = null (nichts senden) oder
 * { device: { id, name, host, port }, media: HostListen, playing, volume, title, artist, cover, station }
 */
function follow(target) {
  // DLNA-Geräte steuert dlna.cjs; das jeweils andere Verfahren gibt sein Gerät frei
  const upnp = target?.device.kind === 'dlna';
  dlna.follow(upnp ? target : null, (state, extra) => sendToRenderer('cast:event', { state, device: target?.device.name ?? null, ...extra }));
  if (upnp) target = null;
  wanted = target;
  if (!target) {
    if (client) {
      if (app) client.send(NS.receiver, { type: 'STOP', sessionId: app.sessionId });
      const c = client;
      setTimeout(() => c.close(), 300); // STOP noch rausschicken
      client = null;
      reset();
    }
    return;
  }
  if (device?.id !== target.device.id) {
    reset();
    device = target.device;
    emit('connecting');
    const c = new CastClient(device, onMessage, (err) => client === c && fail(err));
    client = c;
    c.ready.then(() => client === c && sync(), () => {});
    return;
  }
  sync();
}

function setSender(send) {
  sendToRenderer = send;
}

module.exports = { discover, follow, setSender, encode, decode };
