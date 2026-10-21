// Startet und überwacht go-librespot (Spotify-Connect-Empfänger).
// Die Oberfläche spricht danach direkt mit dessen lokaler API (REST + WebSocket);
// hier geht es nur um Konfiguration, Prozess und Zustand.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

let child = null;
let state = { running: false, port: 0, error: null, log: [] };
let onChange = () => {};
let stopping = false;

function binaryPath(app) {
  // gepackt: resources/go-librespot, Entwicklung: vendor/go-librespot im Projekt
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'go-librespot')
    : path.join(__dirname, '..', 'vendor', 'go-librespot');
  return path.join(base, 'go-librespot.exe');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// YAML-Strings sicher in einfache Anführungszeichen setzen
const yamlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

function writeConfig(dir, { port, deviceName, mode }) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    `device_name: ${yamlString(deviceName)}`,
    'device_type: speaker',
    'log_level: info',
    'log_disable_timestamp: true',
    'bitrate: 320',
    'volume_steps: 100',
    // Manche Netzwerke lassen nur 443/80 nach außen zu
    'prefer_firewall_friendly_ports: true',
    // im Netzwerk immer sichtbar – auch wenn zusätzlich ein Konto gekoppelt ist
    'zeroconf_enabled: true',
    'credentials:',
    `  type: ${mode === 'account' ? 'device_auth' : 'zeroconf'}`,
    '  zeroconf:',
    '    persist_credentials: false',
    'server:',
    '  enabled: true',
    '  address: localhost',
    `  port: ${port}`,
    "  allow_origin: '*'",
    '  image_size: large',
  ];
  fs.writeFileSync(path.join(dir, 'config.yml'), `${lines.join('\n')}\n`, 'utf8');
}

function update(patch) {
  state = { ...state, ...patch };
  onChange(publicState());
}

function publicState() {
  return { running: state.running, port: state.port, error: state.error };
}

function appendLog(chunk) {
  const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
  state.log.push(...lines);
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

async function start(app, configDir, options) {
  await stop();
  // Nur für Tests in der Entwicklung: statt go-librespot einen Test-Dienst auf diesem Port verwenden
  if (!app.isPackaged && process.env.RADIO_SPOTIFY_FAKE_PORT) {
    update({ running: true, port: Number(process.env.RADIO_SPOTIFY_FAKE_PORT), error: null });
    return publicState();
  }
  const exe = binaryPath(app);
  if (!fs.existsSync(exe)) {
    update({ running: false, error: 'go-librespot wurde nicht gefunden.' });
    return publicState();
  }

  const port = await freePort();
  writeConfig(configDir, { port, deviceName: options.deviceName, mode: options.mode });

  stopping = false;
  state.log = [];
  child = spawn(exe, ['--config_dir', configDir], {
    cwd: path.dirname(exe), // dort liegen die DLLs
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  child.on('error', (err) => update({ running: false, error: String(err.message || err) }));
  child.on('exit', (code) => {
    child = null;
    if (stopping) return;
    const lastError = [...state.log].reverse().find((l) => /level=(error|fatal)|panic/i.test(l));
    update({ running: false, error: lastError ?? `Spotify-Dienst beendet (Code ${code}).` });
  });

  update({ running: true, port, error: null });
  return publicState();
}

function stop() {
  return new Promise((resolve) => {
    if (!child) {
      update({ running: false });
      resolve();
      return;
    }
    stopping = true;
    const proc = child;
    const timer = setTimeout(() => proc.kill('SIGKILL'), 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      child = null;
      update({ running: false, port: 0 });
      resolve();
    });
    proc.kill();
  });
}

/** Kopplung lösen: gespeicherte Zugangsdaten löschen (state.json enthält sie). */
async function forgetAccount(configDir) {
  await stop();
  try {
    fs.rmSync(path.join(configDir, 'state.json'), { force: true });
  } catch {
    // nichts zu löschen
  }
}

module.exports = {
  start,
  stop,
  forgetAccount,
  getState: () => ({ ...publicState(), log: state.log.slice(-40) }),
  setListener: (listener) => {
    onChange = listener;
  },
  killSync: () => child?.kill(),
};
