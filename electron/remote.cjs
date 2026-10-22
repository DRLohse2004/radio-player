// Web-Fernbedienung: kleiner Webserver (bevorzugt Port 80 – in abgeschotteten WLANs oft der einzige offene),
// den Mitarbeiter per QR-Code am Handy öffnen. Die App bleibt die Quelle der Wahrheit: Der Server
// reicht Befehle an die Oberfläche weiter und verteilt deren Zustand per Server-Sent Events.

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const QRCode = require('qrcode');
const youtube = require('./youtube.cjs');
const discovery = require('./discovery.cjs');
const { pickInterfaces } = require('./airplay/raop.cjs');

const PORTS = [80, 8080, 8000];
const PAGE = path.join(__dirname, 'remote', 'index.html');

let server = null;
let options = { key: '', pin: '', roomOpen: false, roomName: '' };
let snapshot = null;
let send = () => {};
const streams = new Set(); // { res, clientId }
const clients = new Map(); // clientId -> { name, ip, seen, kind }
const adminTokens = new Set();
const pinAttempts = new Map(); // ip -> [Zeitstempel]
const pending = new Map(); // Befehls-ID -> resolve
const searchCache = new Map(); // Video-ID -> Eintrag aus einer Suche
let searchesRunning = 0;
let nextCommandId = 1;

// --- Hilfsfunktionen -----------------------------------------------------------------------

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 16 * 1024) {
        reject(new Error('Anfrage zu groß'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Ungültige Anfrage'));
      }
    });
  });
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function cleanName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30) || 'Gast';
}

function identify(req, url) {
  const clientId = String(req.headers['x-client'] || url.searchParams.get('c') || '').slice(0, 40);
  let name = url.searchParams.get('n') || '';
  if (req.headers['x-name']) {
    try {
      name = decodeURIComponent(String(req.headers['x-name']));
    } catch {
      name = '';
    }
  }
  name = cleanName(name);
  const admin = adminTokens.has(String(req.headers['x-admin'] || ''));
  const ip = req.socket.remoteAddress?.replace('::ffff:', '') ?? '';
  const kind = req.headers['x-kind'] === 'radio' ? 'radio' : 'phone';
  if (clientId) {
    const known = clients.get(clientId);
    clients.set(clientId, { name, ip, seen: Date.now(), kind });
    if (!known || known.name !== name || known.kind !== kind) publishClients();
  }
  return { clientId, name, admin, ip };
}

function activeClients() {
  const cutoff = Date.now() - 5 * 60_000;
  const online = new Set([...streams].map((s) => s.clientId));
  return [...clients.entries()]
    .filter(([id, c]) => online.has(id) || c.seen > cutoff)
    .map(([id, c]) => ({ id, name: c.name, ip: c.ip, online: online.has(id), kind: c.kind }));
}

function publishClients() {
  send('remote:clients', activeClients());
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const s of streams) s.res.write(payload);
}

/** Befehl an die Oberfläche geben und auf deren Antwort warten */
function request(command) {
  return new Promise((resolve) => {
    const id = nextCommandId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ error: 'Das Radio antwortet nicht.' });
    }, 8000);
    pending.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    send('remote:command', { id, ...command });
  });
}

function reply(id, result) {
  pending.get(id)?.(result ?? { ok: true });
  pending.delete(id);
}

const rules = () => snapshot?.rules ?? { guestVolume: true, guestSkip: true, guestStations: true, maxWishes: 3, maxMinutes: 15 };

/** Darf dieser Besucher den Befehl ausführen? (Wünsche selbst prüft die Oberfläche) */
function allowed(action, who) {
  if (who.admin) return true;
  const r = rules();
  switch (action) {
    case 'toggle':
    case 'next':
    case 'prev':
    case 'wishStart':
      return r.guestSkip;
    case 'volume':
      return r.guestVolume;
    case 'station':
    case 'youtubeItem':
      return r.guestStations;
    case 'wishRemove':
      return true; // eigene Wünsche – prüft die Oberfläche
    default:
      return false; // wishMove, wishClear, receiver (Spotify/AirPlay schalten), …
  }
}

function addressList() {
  const port = server?.address()?.port;
  return pickInterfaces().map((i) => ({
    name: i.name,
    address: i.address,
    url: `http://${i.address}${port === 80 ? '' : `:${port}`}/?k=${options.key}`,
  }));
}

// --- Anfragen ----------------------------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://radio');
  const route = url.pathname;

  if (req.method === 'GET' && (route === '/' || route === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    fs.createReadStream(PAGE).pipe(res);
    return;
  }
  if (req.method === 'GET' && route === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    res.end(
      JSON.stringify({
        name: 'Radio – Fernbedienung',
        short_name: 'Radio',
        start_url: '/',
        display: 'standalone',
        background_color: '#0d0f14',
        theme_color: '#0d0f14',
        icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }],
      }),
    );
    return;
  }
  if (req.method === 'GET' && route === '/icon.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
    fs.createReadStream(path.join(__dirname, '..', 'build', 'icon.png')).on('error', () => res.end()).pipe(res);
    return;
  }
  // Andere Radios suchen hiernach. Den Schlüssel gibt es nur, wenn der Room freigegeben ist.
  if (req.method === 'GET' && route === '/api/room') {
    const radios = activeClients().filter((c) => c.online && c.kind === 'radio').length;
    return json(res, 200, {
      app: 'radio',
      name: options.roomName,
      version: require('electron').app.getVersion(),
      open: options.roomOpen,
      key: options.roomOpen ? options.key : undefined,
      listeners: radios,
    });
  }
  if (!route.startsWith('/api/')) {
    res.writeHead(404);
    res.end();
    return;
  }

  // Ab hier nur mit gültigem Zugangsschlüssel aus dem QR-Code
  const key = String(req.headers['x-key'] || url.searchParams.get('k') || '');
  if (!options.key || !safeEqual(key, options.key)) return json(res, 403, { error: 'Zugang abgelaufen – bitte den QR-Code am Radio neu scannen.' });
  const who = identify(req, url);

  if (req.method === 'GET' && route === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    if (snapshot) res.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
    const stream = { res, clientId: who.clientId };
    streams.add(stream);
    publishClients();
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      streams.delete(stream);
      publishClients();
    });
    return;
  }

  if (req.method === 'GET' && route === '/api/state') return json(res, 200, snapshot ?? {});

  if (req.method === 'GET' && (route === '/api/search' || route === '/api/playlist')) {
    if (searchesRunning >= 3) return json(res, 429, { error: 'Gerade suchen viele gleichzeitig – bitte kurz warten.' });
    searchesRunning += 1;
    try {
      const now = Date.now();
      // Aufgeklappte Playlists bringen viele Einträge mit – Altes nach einer Stunde vergessen
      if (searchCache.size > 2000) for (const [id, v] of searchCache) if (now - v.at > 3600_000) searchCache.delete(id);
      if (route === '/api/playlist') {
        const list = await youtube.playlist(url.searchParams.get('id') ?? '');
        for (const e of list.entries) searchCache.set(e.id, { ...e, at: now });
        return json(res, 200, list);
      }
      const results = await youtube.search(url.searchParams.get('q') ?? '');
      for (const r of results) if (r.kind !== 'playlist') searchCache.set(r.id, { ...r, at: now });
      return json(res, 200, { results });
    } catch (err) {
      return json(res, 502, { error: `YouTube-Suche fehlgeschlagen: ${err.message}` });
    } finally {
      searchesRunning -= 1;
    }
  }

  if (req.method === 'POST' && route === '/api/admin') {
    const now = Date.now();
    const attempts = (pinAttempts.get(who.ip) ?? []).filter((t) => now - t < 60_000);
    if (attempts.length >= 5) return json(res, 429, { error: 'Zu viele Versuche – bitte eine Minute warten.' });
    const body = await readBody(req).catch(() => ({}));
    if (!options.pin || !safeEqual(String(body.pin ?? ''), options.pin)) {
      pinAttempts.set(who.ip, [...attempts, now]);
      return json(res, 403, { error: options.pin ? 'PIN falsch.' : 'Am Radio ist keine Admin-PIN eingerichtet.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    adminTokens.add(token);
    return json(res, 200, { token });
  }

  if (req.method === 'POST' && route === '/api/wish') {
    const body = await readBody(req).catch(() => ({}));
    const id = String(body.id ?? '');
    try {
      let video = searchCache.get(id);
      if (body.playlist) {
        // Ganze Playlist: ein Wunsch, der beim Host als Playlist läuft
        const list = await youtube.playlist(String(body.playlist));
        const duration = list.entries.reduce((sum, e) => sum + (e.duration || 0), 0);
        video = { id: list.id, title: list.title, channel: list.channel, thumbnail: list.thumbnail, duration, count: list.entries.length };
      } else if (!video || Date.now() - video.at > 3600_000) video = await youtube.video(id);
      if (video.live) return json(res, 400, { error: 'Livestreams können nicht gewünscht werden.' });
      const result = await request({ action: 'wish', video, client: who });
      return json(res, result.error ? 400 : 200, result);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && route === '/api/command') {
    const body = await readBody(req).catch(() => ({}));
    const action = String(body.action ?? '');
    if (!allowed(action, who)) return json(res, 403, { error: 'Das darf nur der Admin.' });
    const result = await request({ action, value: body.value, client: who });
    return json(res, result.error ? 400 : 200, result);
  }

  json(res, 404, { error: 'Unbekannt' });
}

// --- Start/Stopp ---------------------------------------------------------------------------

function listen(port) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      handle(req, res).catch((err) => {
        if (!res.headersSent) json(res, 500, { error: String(err.message || err) });
      });
    });
    s.once('error', () => resolve(null));
    s.listen(port, '0.0.0.0', () => resolve(s));
  });
}

async function start(opts) {
  const pinChanged = options.pin !== String(opts?.pin ?? '');
  options = {
    key: String(opts?.key ?? ''),
    pin: String(opts?.pin ?? ''),
    roomOpen: !!opts?.roomOpen,
    roomName: String(opts?.roomName ?? '').slice(0, 40),
  };
  // PIN geändert: bestehende Admin-Anmeldungen verfallen
  if (pinChanged) adminTokens.clear();
  if (!server) {
    for (const port of PORTS) {
      server = await listen(port);
      if (server) break;
    }
  }
  if (!server) return { running: false, error: 'Kein freier Port für die Fernbedienung (80, 8080, 8000).' };
  // Andere Radios finden diesen Host auch per Broadcast – auch aus Nachbarnetzen
  await discovery.startResponder(() => server?.address()?.port);
  return info();
}

async function info() {
  if (!server) return { running: false };
  const port = server.address().port;
  const addresses = addressList();
  const qr = addresses[0] ? await QRCode.toString(addresses[0].url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null;
  return { running: true, port, addresses, qr, clients: activeClients() };
}

function stop() {
  for (const s of streams) s.res.end();
  streams.clear();
  adminTokens.clear();
  discovery.stopResponder();
  const s = server;
  server = null;
  return new Promise((resolve) => (s ? s.close(() => resolve()) : resolve()));
}

function setState(state) {
  snapshot = state;
  if (streams.size) broadcast('state', state);
}

module.exports = {
  start,
  stop,
  info,
  setState,
  reply,
  setSender: (fn) => {
    send = fn;
  },
  isRunning: () => !!server,
};
