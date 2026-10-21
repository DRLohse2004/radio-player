// Automatische Updates über die GitHub-Releases (öffentliches Repo, kein Token nötig).
//
// Ablauf: Beim Start (nach kurzer Pause) und alle 6 Stunden wird das neueste Release abgefragt. Ist es neuer,
// lädt das Radio die neue Radio-portable.exe neben die laufende (".update"). Auf Knopfdruck wird die alte .exe
// umbenannt (".old"), die neue an ihre Stelle gesetzt und gestartet. Der Starter hat sich zu diesem Zeitpunkt
// längst beendet, die .exe ist also nicht gesperrt.

const { app, net } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const FEED = process.env.RADIO_UPDATE_FEED || 'https://api.github.com/repos/DRLohse2004/radio-player/releases/latest';
const ASSET = 'Radio-portable.exe';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let state = { status: 'idle', current: '', version: null, notes: '', progress: 0, error: null, portable: false, url: null };
let send = () => {};
let timer = null;
let downloading = null;

const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || null;

function publish(patch) {
  state = { ...state, ...patch };
  send('update:state', state);
}

/** "1.10.2" > "1.9.0" */
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function check() {
  if (state.status === 'downloading' || state.status === 'ready') return state;
  publish({ status: 'checking', error: null });
  try {
    const res = await net.fetch(FEED, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Radio-Updater' } });
    if (res.status === 404) return publish({ status: 'idle' }), state; // noch kein Release
    if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}`);
    const release = await res.json();
    const version = String(release.tag_name || '').replace(/^v/, '');
    const asset = (release.assets || []).find((a) => a.name === ASSET);
    if (!version || !asset || !newer(version, state.current)) {
      publish({ status: 'current', version: null });
      return state;
    }
    publish({ status: 'available', version, notes: String(release.body || '').slice(0, 2000), url: release.html_url });
    if (state.portable) download(asset.browser_download_url, asset.size).catch(() => {});
  } catch (err) {
    publish({ status: 'error', error: `Update-Prüfung fehlgeschlagen: ${err.message}` });
  }
  return state;
}

async function download(url, size) {
  if (downloading) return downloading;
  const target = `${exePath()}.update`;
  downloading = (async () => {
    publish({ status: 'downloading', progress: 0 });
    try {
      const res = await net.fetch(url, { headers: { 'User-Agent': 'Radio-Updater' } });
      if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status})`);
      const total = Number(res.headers.get('content-length')) || size || 0;
      const file = fs.createWriteStream(target);
      let done = 0;
      let lastReport = 0;
      for await (const chunk of res.body) {
        file.write(Buffer.from(chunk));
        done += chunk.length;
        if (total && Date.now() - lastReport > 300) {
          lastReport = Date.now();
          publish({ progress: done / total });
        }
      }
      await new Promise((resolve, reject) => file.end((err) => (err ? reject(err) : resolve())));
      if (total && fs.statSync(target).size !== total) throw new Error('Download unvollständig');
      // Muss unsere Kennung am Ende tragen, sonst ist es keine gültige portable Radio.exe
      const fd = fs.openSync(target, 'r');
      const tail = Buffer.alloc(8);
      fs.readSync(fd, tail, 0, 8, fs.statSync(target).size - 8);
      fs.closeSync(fd);
      if (tail.toString('ascii') !== 'RADIOPK1') throw new Error('Heruntergeladene Datei ist keine gültige Radio-Version');
      publish({ status: 'ready', progress: 1 });
    } catch (err) {
      fs.rmSync(target, { force: true });
      publish({ status: 'error', error: err.message });
    } finally {
      downloading = null;
    }
  })();
  return downloading;
}

/** Neue Version einsetzen und neu starten */
function install() {
  const exe = exePath();
  if (state.status !== 'ready' || !exe) return false;
  const update = `${exe}.update`;
  const old = `${exe}.old`;
  fs.rmSync(old, { force: true });
  fs.renameSync(exe, old);
  try {
    fs.renameSync(update, exe);
  } catch (err) {
    fs.renameSync(old, exe); // zurück, falls etwas schiefgeht
    throw err;
  }
  spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) }).unref();
  app.quit();
  return true;
}

function start(sender, enabled) {
  send = sender;
  state.current = app.getVersion();
  state.portable = !!exePath();
  // Reste eines früheren Updates aufräumen
  if (state.portable) fs.rmSync(`${exePath()}.old`, { force: true });
  setEnabled(enabled);
}

function setEnabled(enabled) {
  clearTimeout(timer);
  clearInterval(timer);
  if (!enabled) return;
  timer = setTimeout(() => {
    check();
    timer = setInterval(check, CHECK_EVERY_MS);
  }, 15_000);
}

module.exports = { start, setEnabled, check, install, getState: () => state };
