const { app, BrowserWindow, ipcMain, Menu, net, session, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { IcyParser } = require('./icy.cjs');
const spotify = require('./spotify.cjs');
const bluetooth = require('./bluetooth.cjs');
const airplay = require('./airplay.cjs');
const youtube = require('./youtube.cjs');
const remote = require('./remote.cjs');
const room = require('./room.cjs');
const updater = require('./updater.cjs');

const SETTINGS_FILE = 'radio-settings.json';

let mainWindow = null;
let proxyPort = 0;
let activeStream = null; // { controller, session }

// --- Speicherort -----------------------------------------------------------
// Als portable .exe liegen die Einstellungen neben der .exe (Ordner "RadioPlayer-Daten"),
// damit sie mitwandern. Ist der Ordner nicht beschreibbar, wird %APPDATA% verwendet.

function settingsCandidates() {
  const dirs = [];
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    dirs.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'RadioPlayer-Daten'));
  }
  dirs.push(app.getPath('userData'));
  return dirs.map((dir) => path.join(dir, SETTINGS_FILE));
}

function loadSettings() {
  for (const file of settingsCandidates()) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // nächster Kandidat
    }
  }
  return null;
}

function saveSettings(settings) {
  const data = JSON.stringify(settings, null, 2);
  for (const file of settingsCandidates()) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data, 'utf8');
      return true;
    } catch {
      // nächster Kandidat
    }
  }
  return false;
}

// Spotify-Zugangsdaten bleiben lokal auf diesem PC (nicht neben der .exe, die evtl. in
// OneDrive liegt und sonst mitsynchronisiert würde).
function spotifyConfigDir() {
  const base = process.env.LOCALAPPDATA || app.getPath('userData');
  return path.join(base, 'RadioPlayer', 'spotify');
}

// --- Stream-Proxy ----------------------------------------------------------
// Das <audio>-Element spielt http://127.0.0.1:<port>/stream?url=...
// Der Proxy holt den Sender mit "Icy-MetaData: 1", filtert die Metadaten heraus
// und meldet Titeländerungen an die Oberfläche.

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function handleStream(req, res, target, session) {
  activeStream?.controller.abort();
  const controller = new AbortController();
  activeStream = { controller, session };
  req.on('close', () => controller.abort());

  let upstream;
  try {
    upstream = await net.fetch(target, {
      headers: { 'Icy-MetaData': '1', 'User-Agent': 'RadioPlayer/1.0' },
      signal: controller.signal,
    });
  } catch (err) {
    if (!controller.signal.aborted) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(String(err));
    }
    return;
  }

  if (!upstream.ok || !upstream.body) {
    res.writeHead(upstream.status || 502, { 'Content-Type': 'text/plain' });
    res.end('Upstream error');
    controller.abort();
    return;
  }

  res.writeHead(200, {
    'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
    'Cache-Control': 'no-cache, no-store',
    // erlaubt der Oberfläche, das Signal für den Visualizer zu analysieren
    'Access-Control-Allow-Origin': '*',
  });

  const stationName = upstream.headers.get('icy-name');
  if (stationName) sendToRenderer('radio:station-info', { session, name: stationName });

  const write = (buf) => {
    if (!res.write(buf)) {
      paused = true;
    }
  };
  let paused = false;
  const metaint = Number(upstream.headers.get('icy-metaint')) || 0;
  const parser = metaint
    ? new IcyParser(metaint, write, (title) => sendToRenderer('radio:title', { session, title }))
    : null;

  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) break;
      const chunk = Buffer.from(value);
      if (parser) parser.push(chunk);
      else write(chunk);
      if (paused) {
        await new Promise((resolve) => {
          // beide Listener wieder entfernen, sonst sammeln sie sich bei jedem Rückstau an
          const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
          };
          res.on('drain', done);
          res.on('close', done);
        });
        paused = false;
      }
    }
  } catch {
    // Abbruch durch Senderwechsel/Pause oder Netzwerkfehler
  } finally {
    controller.abort();
    res.end();
    if (activeStream?.controller === controller) activeStream = null;
  }
}

function startProxy() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const target = url.searchParams.get('url');
      if (url.pathname !== '/stream' || !target || !/^https?:\/\//i.test(target)) {
        res.writeHead(404);
        res.end();
        return;
      }
      handleStream(req, res, target, Number(url.searchParams.get('session')) || 0);
    });
    server.listen(0, '127.0.0.1', () => {
      proxyPort = server.address().port;
      resolve();
    });
  });
}

// --- Cover-Suche über die iTunes Search API ---------------------------------

const coverCache = new Map();

function normalize(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Alle Wörter des kürzeren Namens müssen im längeren vorkommen,
// z. B. "DAVID GUETTA FEAT. SIA" passt zu "David Guetta & Sia".
function artistMatches(query, found) {
  const q = normalize(query).split(' ').filter(Boolean);
  const f = normalize(found).split(' ').filter(Boolean);
  if (q.length === 0 || f.length === 0) return false;
  const [shorter, longer] = q.length <= f.length ? [q, f] : [f, q];
  return shorter.every((word) => longer.includes(word));
}

async function lookupCover(artist, title) {
  const key = `${artist}|${title}`.toLowerCase();
  if (coverCache.has(key)) return coverCache.get(key);

  let result = null;
  try {
    const term = encodeURIComponent(`${artist} ${title}`);
    const data = await fetchWithTimeout(
      `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=5&country=DE`,
      10000,
      (r) => {
        // z. B. 403/429 bei Ratenbegrenzung: nicht als "kein Cover" merken
        if (!r.ok) throw new Error(`iTunes ${r.status}`);
        return r.json();
      },
    );
    const hit = (data.results ?? []).find((r) => artistMatches(artist, r.artistName ?? ''));
    if (hit) {
      result = {
        cover: hit.artworkUrl100?.replace('100x100bb', '600x600bb') ?? null,
        album: hit.collectionName ?? null,
        artist: hit.artistName ?? null,
        title: hit.trackName ?? null,
      };
    }
  } catch {
    return null; // nicht cachen – evtl. nur kurz offline oder gedrosselt
  }
  coverCache.set(key, result);
  return result;
}

// --- Senderlogo-Suche ---------------------------------------------------------
// Liefert eine Liste möglicher Logo-Adressen (beste zuerst). Ob ein Bild taugt
// (lädt, groß genug, quadratisch), prüft die Oberfläche.

const RADIO_BROWSER_HOSTS = ['de1', 'de2', 'fi1'].map((h) => `https://${h}.api.radio-browser.info`);

/**
 * Führt eine Anfrage aus; der Timeout gilt bis read() fertig ist (also auch für den Body),
 * damit ein versehentlich endloser Stream die Suche nicht blockiert.
 */
async function fetchWithTimeout(url, ms, read) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    // Node-fetch statt net.fetch: net.fetch meldet in response.url nach Weiterleitungen
    // die Ausgangsadresse, dann würden relative Icon-Pfade falsch aufgelöst.
    const response = await fetch(url, {
      headers: { 'User-Agent': 'RadioPlayer/1.0' },
      signal: controller.signal,
    });
    return await read(response);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Liest höchstens maxBytes einer Antwort als Text. */
async function readLimited(response, maxBytes) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}

async function radioBrowser(apiPath) {
  for (const host of RADIO_BROWSER_HOSTS) {
    try {
      return await fetchWithTimeout(host + apiPath, 8000, (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      });
    } catch {
      // nächster Server
    }
  }
  return [];
}

// Alle Wörter des Suchnamens müssen im gefundenen Namen vorkommen
function nameMatches(query, found) {
  const q = normalize(query).split(' ').filter(Boolean);
  const f = normalize(found).split(' ').filter(Boolean);
  return q.length > 0 && q.every((word) => f.includes(word));
}

/** Webseite des Senders aus dem Stream-Header "icy-url" */
async function streamWebsite(streamUrl) {
  try {
    const site = await fetchWithTimeout(streamUrl, 6000, (r) => r.headers.get('icy-url'));
    return site && /^https?:///i.test(site) ? site : null;
  } catch {
    return null;
  }
}

/** Icons aus dem HTML einer Webseite: apple-touch-icon, große Favicons, og:image */
async function websiteIcons(site) {
  let page;
  try {
    page = await fetchWithTimeout(site, 8000, async (r) => {
      if (!r.ok || !/html/i.test(r.headers.get('content-type') ?? '')) return null;
      return { base: r.url || site, html: await readLimited(r, 400_000) };
    });
  } catch {
    return [];
  }
  if (!page) return [];
  const { base, html } = page;

  const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1] ?? null;
  const resolve = (href) => {
    try {
      return new URL(href, base).href;
    } catch {
      return null;
    }
  };

  const touch = [];
  const icons = [];
  const og = [];
  for (const tag of html.match(/<(link|meta)\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    const href = attr(tag, 'href');
    const size = Number((attr(tag, 'sizes') ?? '').split('x')[0]) || 0;
    if (href && rel.includes('apple-touch-icon')) touch.push({ url: resolve(href), size: size || 180 });
    else if (href && /\bicon\b/.test(rel) && size >= 64) icons.push({ url: resolve(href), size });
    const property = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    if (property === 'og:image') og.push(resolve(attr(tag, 'content') ?? ''));
  }

  const bySize = (a, b) => b.size - a.size;
  return [
    ...touch.sort(bySize).map((i) => i.url),
    ...icons.sort(bySize).map((i) => i.url),
    resolve('/apple-touch-icon.png'),
    ...og,
  ].filter(Boolean);
}

async function lookupLogos(name, streamUrl) {
  const candidates = [];
  const homepages = [];
  const add = (url) => {
    if (url && /^https?:\/\//i.test(url) && !candidates.includes(url)) candidates.push(url);
  };

  const search = (term, limit) =>
    radioBrowser(
      `/json/stations/search?name=${encodeURIComponent(term)}&limit=${limit}&hidebroken=true&order=clickcount&reverse=true`,
    );

  const [byUrl, byName, icyUrl] = await Promise.all([
    radioBrowser(`/json/stations/byurl?url=${encodeURIComponent(streamUrl)}`),
    search(name, 20),
    streamWebsite(streamUrl),
  ]);

  // Die Datenbank sucht nur nach Teilstrings: "1.FM Deep House" findet "1.FM - Deep House Radio" nicht.
  // Dann nach dem längsten Wort suchen und selbst abgleichen.
  let found = byName.filter((s) => nameMatches(name, s.name ?? ''));
  if (found.length === 0) {
    const words = normalize(name).split(' ').filter((w) => w.length >= 4).sort((a, b) => b.length - a.length);
    for (const word of words.slice(0, 2)) {
      found = (await search(word, 300)).filter((s) => nameMatches(name, s.name ?? ''));
      if (found.length) break;
    }
  }

  // exakte Namensgleichheit vor Teiltreffern (z. B. "Jam FM" vor "Jam FM - Black Label")
  const matches = found.sort(
    (a, b) => Number(normalize(b.name) === normalize(name)) - Number(normalize(a.name) === normalize(name)),
  );

  for (const station of [...byUrl, ...matches]) {
    add(station.favicon);
    if (station.homepage) homepages.push(station.homepage);
  }
  if (icyUrl) homepages.unshift(icyUrl);
  const sites = [...new Set(homepages)].slice(0, 2);
  // letzter Ausweg: Webseite der Stream-Domain (strm112.1.fm -> 1.fm)
  try {
    const domain = new URL(streamUrl).hostname.split('.').slice(-2).join('.');
    const site = `https://${domain}/`;
    if (!sites.includes(site)) sites.push(site);
  } catch {
    // ungültige Adresse
  }
  for (const icons of await Promise.all(sites.map(websiteIcons))) icons.forEach(add);

  return candidates.slice(0, 15);
}

// --- Sender-Store (Radio-Browser-Datenbank) ----------------------------------
// Deutschland: die meistgehörten Sender einmal laden und in der Oberfläche filtern.
// Weltweit: gezielte Suche nach Name/Genre auf dem Server.

const STORE_CACHE_MS = 6 * 60 * 60 * 1000;
let germanStations = null; // { time, list }

function toStoreStation(s) {
  return {
    id: s.stationuuid,
    name: String(s.name ?? '').trim(),
    url: s.url_resolved || s.url,
    favicon: s.favicon || null,
    homepage: s.homepage || null,
    tags: String(s.tags ?? '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
    country: s.country || '',
    countryCode: s.countrycode || '',
    codec: s.codec || '',
    bitrate: Number(s.bitrate) || 0,
    votes: Number(s.votes) || 0,
    clicks: Number(s.clickcount) || 0,
  };
}

// HLS-Streams (.m3u8) kann der Player nicht abspielen
const playable = (s) => !s.hls && /^https?:\/\//i.test(s.url_resolved || s.url || '');

async function storeStations({ scope, query, tag }) {
  if (scope === 'de') {
    if (!germanStations || Date.now() - germanStations.time > STORE_CACHE_MS) {
      const list = await radioBrowser(
        '/json/stations/bycountrycodeexact/DE?order=clickcount&reverse=true&hidebroken=true&limit=2500',
      );
      if (list.length === 0) return germanStations?.list ?? [];
      germanStations = { time: Date.now(), list: list.filter(playable).map(toStoreStation) };
    }
    return germanStations.list;
  }
  const params = new URLSearchParams({ order: 'clickcount', reverse: 'true', hidebroken: 'true', limit: '300' });
  if (query) params.set('name', query);
  if (tag) params.set('tag', tag);
  const list = await radioBrowser(`/json/stations/search?${params}`);
  return list.filter(playable).map(toStoreStation);
}

// --- Wetter über Open-Meteo (kostenlos, ohne Schlüssel) ----------------------

const placeCache = new Map();

async function getWeather(city) {
  const query = String(city ?? '').trim();
  if (!query) return null;
  try {
    let place = placeCache.get(query.toLowerCase());
    if (!place) {
      place = await fetchWithTimeout(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=de`,
        8000,
        (r) => r.json(),
      ).then((data) => data.results?.[0]);
      if (!place) return null;
      placeCache.set(query.toLowerCase(), place);
    }
    const data = await fetchWithTimeout(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        '&current=temperature_2m,weather_code,is_day&timezone=auto',
      8000,
      (r) => r.json(),
    );
    return {
      place: place.name,
      temperature: data.current.temperature_2m,
      code: data.current.weather_code,
      isDay: data.current.is_day === 1,
    };
  } catch {
    return null;
  }
}

// --- Autostart mit Windows -----------------------------------------------------
// Bei der portablen .exe muss der Pfad der .exe selbst eingetragen werden,
// nicht der des entpackten Programms im Temp-Ordner.

function loginItemOptions() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  return { path: exe, args: process.env.PORTABLE_EXECUTABLE_FILE || app.isPackaged ? [] : [app.getAppPath()] };
}

// --- Fenster ----------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0d0f14',
    title: 'Radio',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      // Die App läuft als Dauer-Display (oft auf einem Zweitmonitor ohne Fokus):
      // Uhr, Cover und Visualizer sollen nie gedrosselt werden.
      backgroundThrottling: false,
    },
  });

  // Externe Links im Standardbrowser öffnen, nie im App-Fenster
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// Zeitplan soll auch ohne Klick starten können
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Windows-Verdeckungserkennung abschalten: Chromium hält sonst das Zeichnen an, wenn es das
// Fenster fälschlich für verdeckt hält (häufig bei Vollbild auf einem Zweitmonitor) –
// neue Cover erschienen dann erst, wenn sich das Fenster änderte.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await startProxy();

    // YouTube-Audio kommt direkt von googlevideo.com. Ohne CORS-Freigabe könnte der Ton nicht
    // durch WebAudio (Lautstärke, Visualizer) und hls.js (Livestreams) laufen.
    session.defaultSession.webRequest.onHeadersReceived({ urls: ['*://*.googlevideo.com/*'] }, (details, callback) => {
      const headers = Object.fromEntries(
        Object.entries(details.responseHeaders ?? {}).filter(([k]) => !/^access-control-allow-/i.test(k)),
      );
      headers['Access-Control-Allow-Origin'] = ['*'];
      headers['Access-Control-Allow-Headers'] = ['*'];
      headers['Access-Control-Expose-Headers'] = ['Content-Length, Content-Range'];
      callback({ responseHeaders: headers });
    });
    youtube.setup(app);

    ipcMain.handle('settings:load', () => loadSettings());
    ipcMain.handle('settings:save', (_event, settings) => saveSettings(settings));
    ipcMain.handle('proxy:url', (_event, url, session) =>
      `http://127.0.0.1:${proxyPort}/stream?session=${session}&url=${encodeURIComponent(url)}`,
    );
    ipcMain.handle('cover:lookup', (_event, artist, title) => lookupCover(artist, title));
    ipcMain.handle('logo:lookup', (_event, name, url) => lookupLogos(name, url));
    ipcMain.handle('weather:get', (_event, city) => getWeather(city));
    ipcMain.handle('store:stations', (_event, options) => storeStations(options ?? {}));
    ipcMain.handle('login:get', () => app.getLoginItemSettings(loginItemOptions()).openAtLogin);
    ipcMain.handle('login:set', (_event, value) => {
      app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: Boolean(value) });
      return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
    });
    ipcMain.handle('app:hostname', () => os.hostname());
    spotify.setListener((s) => sendToRenderer('spotify:state', s));
    ipcMain.handle('spotify:start', (_event, options) =>
      spotify.start(app, spotifyConfigDir(), {
        deviceName: String(options?.deviceName || `Radio ${os.hostname()}`).slice(0, 60),
        mode: options?.mode === 'account' ? 'account' : 'network',
      }),
    );
    ipcMain.handle('spotify:stop', () => spotify.stop());
    ipcMain.handle('spotify:forget', () => spotify.forgetAccount(spotifyConfigDir()));
    ipcMain.handle('spotify:state', () => spotify.getState());
    bluetooth.setListener((event) => sendToRenderer('bt:event', event));
    ipcMain.handle('bt:start', () => bluetooth.start(app));
    ipcMain.handle('bt:stop', () => bluetooth.stop());
    ipcMain.handle('bt:send', (_event, command) => bluetooth.send(command));
    ipcMain.handle('bt:state', () => ({ running: bluetooth.isRunning(), log: bluetooth.getLog() }));
    ipcMain.handle('bt:open-settings', () => shell.openExternal('ms-settings:bluetooth'));
    ipcMain.handle('sound:open-settings', () => shell.openExternal('ms-settings:sound'));
    airplay.setSender((channel, payload) => sendToRenderer(channel, payload));
    ipcMain.handle('airplay:start', (_event, name) => airplay.start(name));
    ipcMain.handle('airplay:stop', () => airplay.stop());
    ipcMain.handle('airplay:state', () => airplay.getState());
    ipcMain.handle('youtube:info', (_event, url) => youtube.info(String(url)));
    ipcMain.handle('youtube:resolve', (_event, url) => youtube.resolve(String(url)));
    ipcMain.handle('youtube:update', () => youtube.update());
    ipcMain.handle('youtube:version', () => youtube.getVersion());
    remote.setSender((channel, payload) => sendToRenderer(channel, payload));
    ipcMain.handle('remote:start', (_event, options) => remote.start(options));
    ipcMain.handle('remote:stop', () => remote.stop());
    ipcMain.handle('remote:info', () => remote.info());
    ipcMain.on('remote:state', (_event, state) => remote.setState(state));
    ipcMain.on('remote:reply', (_event, id, result) => remote.reply(id, result));
    room.setSender((channel, payload) => sendToRenderer(channel, payload));
    ipcMain.handle('room:scan', (_event, networks) => room.scan(String(networks ?? '')));
    ipcMain.handle('room:probe', (_event, address) => room.probeAddress(address));
    ipcMain.handle('room:connect', (_event, options) => room.connect(options ?? {}));
    ipcMain.handle('room:disconnect', () => room.disconnect());
    ipcMain.handle('room:request', (_event, options) => room.request(options ?? {}));
    updater.start((channel, payload) => sendToRenderer(channel, payload), false);
    ipcMain.handle('update:state', () => updater.getState());
    ipcMain.handle('update:check', () => updater.check());
    ipcMain.handle('update:install', () => updater.install());
    ipcMain.handle('update:set-enabled', (_event, enabled) => updater.setEnabled(Boolean(enabled)));
    ipcMain.handle('app:version', () => app.getVersion());
    ipcMain.handle('shell:open', (_event, url) => {
      if (/^https?:\/\//i.test(String(url))) return shell.openExternal(url);
    });
    ipcMain.handle('window:set-fullscreen', (_event, value) => mainWindow?.setFullScreen(Boolean(value)));

    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
  // Spotify-Dienst nie verwaist weiterlaufen lassen
  // Beim Beenden AirPlay ordentlich abmelden (sonst behalten Bonjour-Gateways den Eintrag ~75 min)
  let airplayStopped = false;
  app.on('will-quit', (event) => {
    spotify.killSync();
    bluetooth.killSync();
    if (!airplayStopped && airplay.isRunning()) {
      event.preventDefault();
      airplayStopped = true;
      airplay.stop().finally(() => app.quit());
    }
  });
}
