// YouTube ohne Anmeldung und ohne Werbung: yt-dlp liefert Titel, Playlists und die direkte
// Audio-Adresse, die Oberfläche spielt sie im normalen Player ab.
// Als JavaScript-Laufzeit für yt-dlp dient die App selbst (ELECTRON_RUN_AS_NODE).

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let paths = null; // { bundled, local }
let activeBinary = null;

function setup(app) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'yt-dlp')
    : path.join(__dirname, '..', 'vendor', 'yt-dlp');
  // Aktualisierbare Kopie lokal auf dem PC (die portable .exe entpackt sich bei jedem Start neu)
  const localDir = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'RadioPlayer', 'yt-dlp');
  paths = { bundled: path.join(base, 'yt-dlp.exe'), local: path.join(localDir, 'yt-dlp.exe') };
}

function run(binary, args, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        windowsHide: true,
        timeout,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
      (err, stdout, stderr) => {
        if (err) {
          const message = String(stderr || err.message)
            .split(/\r?\n/)
            .filter((l) => l.startsWith('ERROR'))
            .join(' ')
            .replace(/^ERROR:\s*(\[[^\]]+\]\s*)?(\S+:\s*)?/, '');
          reject(new Error(message || err.message));
        } else resolve(String(stdout));
      },
    );
  });
}

async function version(binary) {
  try {
    return (await run(binary, ['--version'], 15_000)).trim();
  } catch {
    return null;
  }
}

/** Neuere der beiden Fassungen (mitgeliefert oder lokal aktualisiert) verwenden */
async function binary() {
  if (activeBinary) return activeBinary;
  const [bundled, local] = await Promise.all([version(paths.bundled), version(paths.local)]);
  if (bundled && (!local || bundled > local)) {
    try {
      fs.mkdirSync(path.dirname(paths.local), { recursive: true });
      fs.copyFileSync(paths.bundled, paths.local);
      activeBinary = paths.local;
    } catch {
      activeBinary = paths.bundled;
    }
  } else {
    activeBinary = local ? paths.local : paths.bundled;
  }
  return activeBinary;
}

const baseArgs = () => ['--js-runtimes', `node:${process.execPath}`, '--no-warnings', '--no-check-certificates'];

function bestThumbnail(info) {
  if (info.thumbnail) return info.thumbnail;
  const list = (info.thumbnails ?? []).filter((t) => t.url);
  return list.length ? list[list.length - 1].url : null;
}

/** yt-dlp hängt bei Livestreams Datum und Uhrzeit an den Titel */
function cleanTitle(j) {
  const title = j.title ?? '';
  return j.is_live ? title.replace(/\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '') : title;
}

function videoThumbnail(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Infos zu einem Link: Video, Livestream oder Playlist (mit Titelliste) */
async function info(url) {
  const raw = await run(await binary(), [...baseArgs(), '--flat-playlist', '-J', url]);
  const j = JSON.parse(raw);
  if (j._type === 'playlist') {
    const entries = (j.entries ?? [])
      .filter((e) => e && e.id && e.title !== '[Private video]' && e.title !== '[Deleted video]')
      .map((e) => ({
        id: e.id,
        title: e.title ?? e.id,
        channel: e.channel ?? e.uploader ?? null,
        duration: e.duration ?? 0,
        thumbnail: videoThumbnail(e.id),
      }));
    return {
      kind: 'playlist',
      title: j.title ?? 'Playlist',
      channel: j.channel ?? j.uploader ?? null,
      thumbnail: entries[0]?.thumbnail ?? bestThumbnail(j),
      entries,
    };
  }
  return {
    kind: j.is_live ? 'live' : 'video',
    title: cleanTitle(j) || url,
    channel: j.channel ?? j.uploader ?? null,
    thumbnail: j.id ? videoThumbnail(j.id) : bestThumbnail(j),
    duration: j.duration ?? 0,
    entries: [],
  };
}

/** Abspielbare Audio-Adresse (direkte Datei oder HLS bei Livestreams) */
async function resolve(url) {
  const raw = await run(await binary(), [...baseArgs(), '--no-playlist', '-f', 'bestaudio/best', '-J', url]);
  const j = JSON.parse(raw);
  const format = j.requested_formats?.[0] ?? j;
  return {
    url: format.url ?? j.url,
    hls: /m3u8/.test(format.protocol ?? '') || /\.m3u8|hls_playlist/.test(format.url ?? ''),
    live: !!j.is_live,
    title: cleanTitle(j) || url,
    channel: j.channel ?? j.uploader ?? null,
    thumbnail: j.id ? `https://i.ytimg.com/vi/${j.id}/maxresdefault.jpg` : bestThumbnail(j),
    fallbackThumbnail: j.id ? videoThumbnail(j.id) : null,
    duration: j.duration ?? 0,
  };
}

/** YouTube-Suche (oder ein eingefügter Video-Link) – liefert bis zu 12 Videos */
async function search(query) {
  const q = String(query).trim().slice(0, 200);
  if (!q) return [];
  const target = /^https?:\/\//i.test(q) ? q : `ytsearch12:${q}`;
  const raw = await run(await binary(), [...baseArgs(), '--flat-playlist', '--no-playlist', '-J', target]);
  const j = JSON.parse(raw);
  const list = j._type === 'playlist' ? j.entries ?? [] : [j];
  return list
    .filter((e) => e && e.id && /^[\w-]{11}$/.test(e.id) && !e.is_live && e.live_status !== 'is_live')
    .map((e) => ({
      id: e.id,
      title: e.title ?? e.id,
      channel: e.channel ?? e.uploader ?? null,
      duration: e.duration ?? 0,
      thumbnail: videoThumbnail(e.id),
    }));
}

/** Infos zu genau einem Video (für Wünsche: Titel und Länge prüfen) */
async function video(videoId) {
  if (!/^[\w-]{11}$/.test(String(videoId))) throw new Error('Ungültiges Video.');
  const raw = await run(await binary(), [...baseArgs(), '--no-playlist', '--skip-download', '-J', `https://www.youtube.com/watch?v=${videoId}`]);
  const j = JSON.parse(raw);
  return {
    id: j.id,
    title: j.title ?? videoId,
    channel: j.channel ?? j.uploader ?? null,
    duration: j.duration ?? 0,
    live: !!j.is_live,
    thumbnail: videoThumbnail(j.id),
  };
}

/** yt-dlp auf den neuesten Stand bringen (YouTube ändert öfter etwas) */
async function update() {
  const bin = await binary();
  if (bin !== paths.local) throw new Error('Keine beschreibbare Kopie von yt-dlp vorhanden.');
  const out = await run(bin, ['-U'], 120_000);
  return { output: out.trim().split(/\r?\n/).pop(), version: await version(bin) };
}

async function getVersion() {
  return version(await binary());
}

module.exports = { setup, info, resolve, search, video, update, getVersion };
