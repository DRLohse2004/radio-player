// Rooms: Dieses Radio verbindet sich mit einem anderen Radio (dem Host) – als Mithörer oder nur als
// Fernbedienung. Gesprochen wird dieselbe HTTP-Schnittstelle wie die Handy-Fernbedienung (Port 80),
// denn die kommt auch durch abgeschottete Netze. Die Verbindung läuft im Hauptprozess, damit der
// Browser-Teil keine CORS-Probleme hat.

const http = require('node:http');
const { pickInterfaces } = require('./airplay/raop.cjs');
const discovery = require('./discovery.cjs');

const PROBE_PORTS = [80, 8080];
let send = () => {};
let link = null; // { base, key, clientId, name, req, timer, closed }

// --- Finden ------------------------------------------------------------------------------------

/** GET mit Zeitlimit, liefert geparstes JSON oder null */
function getJson(url, timeout = 1500, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        data += c;
        if (data.length > 64 * 1024) req.destroy();
      });
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 ? JSON.parse(data) : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function baseUrl(address, port) {
  return `http://${address}${port === 80 ? '' : `:${port}`}`;
}

async function probe(address, port, timeout = 1500) {
  const info = await getJson(`${baseUrl(address, port)}/api/room`, timeout);
  if (!info || info.app !== 'radio') return null;
  return {
    name: String(info.name || address).slice(0, 40),
    address,
    port,
    url: baseUrl(address, port),
    open: !!info.open,
    key: info.open ? String(info.key || '') : '',
    version: String(info.version || ''),
    listeners: Number(info.listeners) || 0,
  };
}

/** Adresse von Hand: „10.0.0.5“, „10.0.0.5:8080“ oder eine URL */
async function probeAddress(input) {
  const text = String(input || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const match = /^([\w.-]+)(?::(\d{1,5}))?$/.exec(text);
  if (!match) return null;
  const ports = match[2] ? [Number(match[2])] : PROBE_PORTS;
  for (const port of ports) {
    const found = await probe(match[1], port);
    if (found) return found;
  }
  return null;
}

/**
 * Radios suchen: das eigene /24-Netz jeder Netzwerkkarte Adresse für Adresse, dazu eine UDP-Frage an
 * die Broadcast-Adressen der eigenen Netze. `networks` sind zusätzlich eingetragene Netze oder Rechner
 * (z. B. „10.0.11.255, 10.0.255.255“), siehe discovery.parseNetworks.
 */
async function scan(networks = '') {
  const own = pickInterfaces().map((i) => i.address);
  const extra = discovery.parseNetworks(networks);
  const answers = discovery.ask([...new Set([...discovery.ownBroadcasts(), '255.255.255.255', ...extra.broadcasts, ...extra.hosts])]);

  const prefixes = new Set([...own.map((address) => address.split('.').slice(0, 3).join('.')), ...extra.prefixes]);
  const targets = [];
  for (const prefix of prefixes) {
    for (let i = 1; i < 255; i++) {
      const candidate = `${prefix}.${i}`;
      if (!own.includes(candidate)) for (const port of PROBE_PORTS) targets.push([candidate, port]);
    }
  }
  for (const host of extra.hosts) {
    if (!own.includes(host) && !prefixes.has(host.split('.').slice(0, 3).join('.'))) {
      for (const port of PROBE_PORTS) targets.push([host, port]);
    }
  }

  const found = [];
  const add = (result) => {
    if (result && !found.some((f) => f.address === result.address)) found.push(result);
  };
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const [address, port] = targets[next++];
      add(await probe(address, port, 800));
    }
  };
  const viaBroadcast = answers.then((list) =>
    Promise.all(list.filter((a) => !own.includes(a.address)).map(async (a) => add(await probe(a.address, a.port)))),
  );
  await Promise.all([...Array.from({ length: 160 }, worker), viaBroadcast]);
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Verbindung zum Host ----------------------------------------------------------------------

function headers(extra = {}) {
  return {
    'x-key': link.key,
    'x-client': link.clientId,
    'x-name': encodeURIComponent(link.name),
    'x-kind': 'radio',
    ...extra,
  };
}

function status(state, error = null) {
  send('room:event', { type: 'status', status: state, error });
}

function openStream() {
  if (!link || link.closed) return;
  const current = link;
  status('connecting');
  const req = http.get(`${current.base}/api/events`, { headers: headers() }, (res) => {
    if (res.statusCode === 403) {
      status('error', 'Der Host hat den Zugang geändert – bitte neu beitreten.');
      res.resume();
      return;
    }
    if (res.statusCode !== 200) {
      res.resume();
      return retry(current, `Host antwortet mit ${res.statusCode}`);
    }
    status('connected');
    res.setEncoding('utf8');
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (event === 'state' && data) {
          try {
            send('room:event', { type: 'state', state: JSON.parse(data) });
          } catch {
            // kaputtes Paket – das nächste kommt gleich
          }
        }
      }
    });
    res.on('end', () => retry(current, 'Verbindung zum Host getrennt'));
    res.on('error', () => retry(current, 'Verbindung zum Host getrennt'));
  });
  req.on('error', (err) => retry(current, `Host nicht erreichbar (${err.code || err.message})`));
  current.req = req;
}

function retry(current, message) {
  if (current !== link || current.closed) return;
  status('error', message);
  clearTimeout(current.timer);
  current.timer = setTimeout(openStream, 3000);
}

function connect(options) {
  disconnect();
  link = {
    base: String(options.url).replace(/\/+$/, ''),
    key: String(options.key || ''),
    clientId: String(options.clientId || ''),
    name: String(options.name || 'Radio').slice(0, 30),
    req: null,
    timer: null,
    closed: false,
  };
  openStream();
}

function disconnect() {
  if (!link) return;
  link.closed = true;
  clearTimeout(link.timer);
  link.req?.destroy();
  link = null;
}

/** Anfrage an den Host weiterreichen (Befehle, Suche, Wünsche, Admin-PIN) */
function request({ method = 'GET', path = '/', body, admin } = {}) {
  if (!link) return Promise.resolve({ status: 0, body: { error: 'Nicht verbunden.' } });
  if (!/^\/api\/(command|search|wish|admin|state)(\?|$)/.test(path)) return Promise.resolve({ status: 400, body: { error: 'Unbekannt' } });
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve) => {
    const req = http.request(
      `${link.base}${path}`,
      {
        method,
        timeout: 20_000,
        headers: headers({
          ...(admin ? { 'x-admin': String(admin) } : {}),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        }),
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            parsed = { error: 'Ungültige Antwort vom Host.' };
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', (err) => resolve({ status: 0, body: { error: `Host nicht erreichbar: ${err.message}` } }));
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = {
  scan,
  probeAddress,
  connect,
  disconnect,
  request,
  setSender: (fn) => {
    send = fn;
  },
};
