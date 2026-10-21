// Startet das Hilfsprogramm bt-receiver.exe (PC als Bluetooth-Lautsprecher) und reicht
// dessen JSON-Ereignisse an die Oberfläche weiter.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

let child = null;
let onEvent = () => {};
let log = [];
let stopping = false;

function binaryPath(app) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'bt-receiver')
    : path.join(__dirname, '..', 'vendor', 'bt-receiver');
  return path.join(base, 'bt-receiver.exe');
}

function remember(line) {
  log.push(line);
  if (log.length > 200) log.splice(0, log.length - 200);
}

function start(app) {
  if (child) return true;
  const exe = binaryPath(app);
  if (!fs.existsSync(exe)) {
    onEvent({ type: 'error', message: 'Bluetooth-Empfänger wurde nicht gefunden.' });
    return false;
  }
  stopping = false;
  child = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  onEvent({ type: 'running', running: true });

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    // Cover nicht ins Protokoll schreiben
    remember(event.type === 'media' ? JSON.stringify({ ...event, cover: event.cover ? '(Bild)' : null }) : line);
    onEvent(event);
  });
  child.stderr.on('data', (chunk) => remember(chunk.toString('utf8').trim()));
  child.on('error', (err) => onEvent({ type: 'error', message: String(err.message || err) }));
  child.on('exit', (code) => {
    child = null;
    onEvent({ type: 'running', running: false });
    if (!stopping) onEvent({ type: 'error', message: `Bluetooth-Empfänger beendet (Code ${code}).` });
  });
  return true;
}

function send(command) {
  if (!child) return false;
  child.stdin.write(`${JSON.stringify(command)}\n`);
  return true;
}

function stop() {
  if (!child) return;
  stopping = true;
  const proc = child;
  send({ cmd: 'quit' });
  setTimeout(() => proc.exitCode === null && proc.kill(), 2000);
}

module.exports = {
  start,
  stop,
  send,
  isRunning: () => !!child,
  getLog: () => log.slice(-60),
  setListener: (listener) => {
    onEvent = listener;
  },
  killSync: () => child?.kill(),
};
