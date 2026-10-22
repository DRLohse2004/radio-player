// Rooms über Netzgrenzen finden: Ein Host beantwortet eine kleine UDP-Frage („radio-room?“) mit seinem
// HTTP-Port. Die Suche schickt die Frage an die Broadcast-Adresse jedes eigenen Netzes und an
// Adressen, die man selbst einträgt – etwa 10.0.11.255 für das Nachbarnetz oder 10.0.255.255 für alle
// 10.0.x.x-Netze. Viele Router leiten solche gerichteten Broadcasts nicht weiter; deshalb kann ein
// eingetragenes /24-Netz zusätzlich Adresse für Adresse per HTTP abgefragt werden (siehe room.cjs).

const dgram = require('node:dgram');
const os = require('node:os');
const { pickInterfaces } = require('./airplay/raop.cjs');

const PORT = 47811;
const ASK = 'radio-room?';

// --- Adressen ----------------------------------------------------------------------------------

const toInt = (ip) => ip.split('.').reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);
const toIp = (n) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');
const isIp = (text) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(text) && text.split('.').every((p) => Number(p) <= 255);
const maskOf = (bits) => (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);

/** Broadcast-Adressen der eigenen Netzwerkkarten (z. B. 10.0.12.255 bei 10.0.12.7/24) */
function ownBroadcasts(networkInterfaces = os.networkInterfaces()) {
  const wanted = new Set(pickInterfaces(networkInterfaces).map((i) => i.address));
  const result = new Set();
  for (const addresses of Object.values(networkInterfaces)) {
    for (const a of addresses ?? []) {
      if (a.family !== 'IPv4' || !wanted.has(a.address) || !isIp(a.netmask || '')) continue;
      result.add(toIp((toInt(a.address) | ~toInt(a.netmask)) >>> 0));
    }
  }
  return [...result];
}

/**
 * Eingetragene Netze auslesen. Erlaubt sind, durch Komma, Semikolon oder Leerzeichen getrennt:
 *   10.0.11.255 / 10.0.255.255   Broadcast-Adresse (bei x.y.z.255 wird auch das /24-Netz abgefragt)
 *   10.0.11.0/24, 10.0.11.x      ein Netz (bis /24 wird es auch Adresse für Adresse abgefragt)
 *   10.0.11.20                   ein einzelner Rechner
 * Liefert Broadcast-Ziele, /24-Präfixe zum Abfragen und einzelne Rechner.
 */
function parseNetworks(text) {
  const broadcasts = new Set();
  const prefixes = new Set();
  const hosts = new Set();
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    let address = entry;
    let bits = null;
    const wildcard = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.[x*]$/.exec(entry);
    const cidr = /^([\d.]+)\/(\d{1,2})$/.exec(entry);
    if (wildcard) {
      address = `${wildcard[1]}.0`;
      bits = 24;
    } else if (cidr) {
      address = cidr[1];
      bits = Number(cidr[2]);
      if (bits < 8 || bits > 32) continue;
    }
    if (!isIp(address)) continue;
    const parts = address.split('.').map(Number);
    if (bits === null) {
      // ohne Maske: …255 am Ende ist ein Broadcast, alles andere ein einzelner Rechner
      if (parts[3] !== 255) {
        hosts.add(address);
        continue;
      }
      bits = parts[2] === 255 ? (parts[1] === 255 ? 8 : 16) : 24;
    }
    const net = (toInt(address) & maskOf(bits)) >>> 0;
    if (bits >= 31) {
      hosts.add(address);
      continue;
    }
    broadcasts.add(toIp((net | ~maskOf(bits)) >>> 0));
    // Kleine Netze zusätzlich direkt abfragen – das klappt auch, wenn der Router Broadcasts verwirft
    if (bits >= 24) prefixes.add(toIp(net).split('.').slice(0, 3).join('.'));
  }
  return { broadcasts: [...broadcasts], prefixes: [...prefixes], hosts: [...hosts] };
}

// --- Host: antworten ---------------------------------------------------------------------------

let responder = null;

/** Auf Suchanfragen antworten, solange die Fernbedienung (HTTP) läuft */
function startResponder(getHttpPort, port = PORT) {
  if (responder) return Promise.resolve(responder.address().port);
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (message, rinfo) => {
      if (message.toString('utf8').trim() !== ASK) return;
      const httpPort = getHttpPort();
      if (!httpPort) return;
      socket.send(JSON.stringify({ app: 'radio', port: httpPort }), rinfo.port, rinfo.address, () => {});
    });
    socket.once('error', () => {
      // Port belegt o. ä. – dann eben nur über die HTTP-Suche auffindbar
      if (responder === socket) responder = null;
      socket.close();
      resolve(null);
    });
    socket.bind(port, () => {
      responder = socket;
      resolve(socket.address().port);
    });
  });
}

function stopResponder() {
  const socket = responder;
  responder = null;
  socket?.close();
}

// --- Suche: fragen -----------------------------------------------------------------------------

/** Frage an alle Ziele schicken und Antworten einsammeln: [{ address, port }] */
function ask(targets, { wait = 1200, port = PORT } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const socket = dgram.createSocket('udp4');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // schon zu
      }
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, wait);
    socket.on('message', (message, rinfo) => {
      try {
        const answer = JSON.parse(message.toString('utf8'));
        const httpPort = Number(answer?.port);
        if (answer?.app === 'radio' && httpPort > 0 && httpPort < 65536) {
          found.set(`${rinfo.address}:${httpPort}`, { address: rinfo.address, port: httpPort });
        }
      } catch {
        // keine Antwort von uns
      }
    });
    socket.on('error', finish);
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // ohne Broadcast klappen wenigstens einzelne Rechner
      }
      const question = Buffer.from(ASK);
      const sendAll = () => {
        if (finished) return;
        // Ein Ziel, das nicht erreichbar ist (falsche Adresse, kein Weg), darf die anderen nicht aufhalten
        for (const target of targets) socket.send(question, port, target, () => {});
      };
      sendAll();
      // UDP kann verloren gehen – einmal nachfragen
      setTimeout(sendAll, Math.min(400, wait / 3));
    });
  });
}

module.exports = { PORT, ownBroadcasts, parseNetworks, startResponder, stopResponder, ask };
