// AirPlay-1-Audioempfänger (RAOP – "Remote Audio Output Protocol").
//
// Ablauf (vereinfacht, wie bei shairport-sync im klassischen Modus):
//   1. Bonjour-Anmeldung als "_raop._tcp" – das iPhone zeigt den Empfänger im AirPlay-Menü.
//   2. RTSP-Steuerung über TCP: OPTIONS (Apple-Challenge), ANNOUNCE (SDP mit Codec und
//      RSA-verschlüsseltem AES-Schlüssel), SETUP (UDP-Ports), RECORD, SET_PARAMETER (Lautstärke,
//      Titel, Cover, Fortschritt), FLUSH, TEARDOWN.
//   3. Audio als RTP über UDP: pro Paket AES-128-CBC-verschlüsselter ALAC-Frame (352 Samples).
//
// Ereignisse: session, play, audio (Int16-PCM), flush, volume, metadata, cover, progress, end, error

'use strict';

const crypto = require('node:crypto');
const dgram = require('node:dgram');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { AlacDecoder } = require('./alac.cjs');
const AIRPORT_KEY = require('./airport-key.cjs');
const { ServiceAnnouncer } = require('./mdns.cjs');

const privateKey = crypto.createPrivateKey(AIRPORT_KEY);

// Bonjour-TXT-Record wie bei shairport-sync (klassisches AirPlay, Metadaten inkl. Cover)
const TXT_RECORD = {
  txtvers: '1',
  ch: '2',
  cn: '0,1', // Codecs: PCM, ALAC
  et: '0,1', // Verschlüsselung: keine, RSA
  ek: '1',
  sv: 'false',
  da: 'true',
  sr: '44100',
  ss: '16',
  pw: 'false',
  vn: '65537',
  tp: 'UDP',
  md: '0,1,2', // Metadaten: Text, Cover, Fortschritt
  vs: '105.1',
  am: 'RadioPlayer',
  sf: '0x4',
};

/** Apple-Challenge: Challenge + eigene IP + Hardware-Adresse, mit dem AirPort-Schlüssel signiert */
function appleResponse(challengeB64, localAddress, hwAddr) {
  const challenge = Buffer.from(challengeB64, 'base64');
  let ip;
  const v4 = localAddress.replace(/^::ffff:/, '');
  if (net.isIPv4(v4)) ip = Buffer.from(v4.split('.').map(Number));
  else ip = ipv6ToBuffer(localAddress);
  let data = Buffer.concat([challenge, ip, hwAddr]);
  if (data.length < 32) data = Buffer.concat([data, Buffer.alloc(32 - data.length)]);
  const signed = crypto.privateEncrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, data);
  return signed.toString('base64').replace(/=+$/, '');
}

function ipv6ToBuffer(address) {
  const clean = address.split('%')[0];
  const [head, tail = ''] = clean.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  const buf = Buffer.alloc(16);
  groups.forEach((g, i) => buf.writeUInt16BE(parseInt(g || '0', 16), i * 2));
  return buf;
}

// --- Netzwerkkarten für die Bonjour-Anmeldung --------------------------------------------
// Angekündigt wird über alle echten Netzwerkkarten (Kabel und WLAN), nicht über virtuelle Adapter
// (VMware, Hyper-V, …) und nicht über Adressen ohne Netz (169.254.x.x). Über das WLAN erreicht die
// Ankündigung Handys im selben Funknetz direkt.

const VIRTUAL_ADAPTER = /vethernet|hyper-v|vmware|virtualbox|vbox|npcap|loopback|wsl|docker|tailscale|zerotier|bluetooth|teredo|isatap/i;

/** Liefert die Netzwerkkarten, über die der Empfänger angekündigt werden soll. */
function pickInterfaces(networkInterfaces = require('node:os').networkInterfaces()) {
  const candidates = [];
  for (const [name, addresses] of Object.entries(networkInterfaces)) {
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const a of addresses ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      candidates.push({ name, address: a.address });
    }
  }
  return candidates;
}

// --- RTSP-Nachrichten ------------------------------------------------------------------

function parseRequest(buffer) {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd < 0) return null;
  const head = buffer.subarray(0, headerEnd).toString('utf8').split('\r\n');
  const [method, uri] = head[0].split(' ');
  const headers = {};
  for (const line of head.slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const length = Number(headers['content-length'] || 0);
  if (buffer.length < headerEnd + 4 + length) return null;
  const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length);
  return { method, uri, headers, body, consumed: headerEnd + 4 + length };
}

function respond(socket, request, status = 200, headers = {}, body = null) {
  const text = status === 200 ? 'OK' : status === 404 ? 'Not Found' : status === 501 ? 'Not Implemented' : 'Error';
  const lines = [`RTSP/1.0 ${status} ${text}`, `CSeq: ${request.headers.cseq ?? '0'}`, 'Server: AirTunes/105.1'];
  for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
  if (body) lines.push(`Content-Length: ${body.length}`);
  socket.write(`${lines.join('\r\n')}\r\n\r\n`);
  if (body) socket.write(body);
}

// --- DMAP (Titelinfos von iTunes/iOS) -------------------------------------------------------

function parseDmap(buffer) {
  const result = {};
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const tag = buffer.toString('latin1', offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (tag === 'mlit') Object.assign(result, parseDmap(data));
    else if (tag === 'minm') result.title = data.toString('utf8');
    else if (tag === 'asar') result.artist = data.toString('utf8');
    else if (tag === 'asal') result.album = data.toString('utf8');
    offset += 8 + length;
  }
  return result;
}

const TCP_PORTS = [7000, 5000, 0];
const UDP_PORTS = [6001, 6002, 6003];

/** Bindet an den Wunsch-Port, bei Belegung an einen freien; liefert den Port */
function bindUdp(socket, preferred) {
  return new Promise((resolve) => {
    const fallback = () => socket.bind(0, '0.0.0.0', () => resolve(socket.address().port));
    socket.once('error', fallback);
    socket.bind(preferred, '0.0.0.0', () => {
      socket.removeListener('error', fallback);
      resolve(socket.address().port);
    });
  });
}

// --- Empfänger ---------------------------------------------------------------------------------

class RaopReceiver extends EventEmitter {
  /**
   * @param {{ name: string, hwAddr: Buffer, interfaces?: string[] }} options
   */
  constructor(options) {
    super();
    this.name = options.name;
    this.hwAddr = options.hwAddr;
    this.interfaces = options.interfaces;
    this.server = null;
    this.announcer = null;
    this.session = null; // { socket, aesKey, aesIv, decoder, udp: {audio, control, timing}, client }
  }

  async start() {
    this.server = net.createServer((socket) => this.handleConnection(socket));
    // Standard-Ports wie echte AirPlay-Geräte: Größere Netzwerke lassen zwischen WLAN und LAN oft nur diese durch
    for (const port of TCP_PORTS) {
      const ok = await new Promise((resolve) => {
        this.server.once('error', () => resolve(false));
        // nur IPv4: die Apple-Challenge muss die Adresse enthalten, über die das iPhone verbunden ist
        this.server.listen(port, '0.0.0.0', () => resolve(true));
      });
      if (ok) break;
      if (port === 0) throw new Error('Kein freier Port für AirPlay');
    }
    this.port = this.server.address().port;

    const chosen = pickInterfaces();
    const wanted = this.interfaces?.length ? chosen.filter((i) => this.interfaces.includes(i.name)) : chosen;
    this.announcedOn = wanted;
    const hex = this.hwAddr.toString('hex').toUpperCase();
    this.announcer = new ServiceAnnouncer({
      type: '_raop._tcp.local',
      instance: `${hex}@${this.name}`,
      port: this.port,
      txt: TXT_RECORD,
      host: `radio-${hex.toLowerCase()}.local`,
      addresses: wanted.map((i) => i.address),
    });
    this.announcer.start();
    return this.port;
  }

  async stop() {
    this.endSession('stopped');
    // auf die Abmeldung warten, damit kein verwaister Eintrag in Gateways zurückbleibt
    await this.announcer?.stop();
    this.announcer = null;
    await new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }

  handleConnection(socket) {
    let buffer = Buffer.alloc(0);
    socket.setNoDelay(true);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const request = parseRequest(buffer);
        if (!request) break;
        buffer = buffer.subarray(request.consumed);
        try {
          this.handleRequest(socket, request);
        } catch (err) {
          this.emit('error', err);
          respond(socket, request, 500);
        }
      }
    });
    socket.on('close', () => {
      if (this.session?.socket === socket) this.endSession('disconnected');
    });
    socket.on('error', () => {});
  }

  handleRequest(socket, request) {
    const headers = {};
    if (request.headers['apple-challenge']) {
      headers['Apple-Response'] = appleResponse(request.headers['apple-challenge'], socket.localAddress, this.hwAddr);
    }

    switch (request.method) {
      case 'OPTIONS':
        headers.Public = 'ANNOUNCE, SETUP, RECORD, PAUSE, FLUSH, TEARDOWN, OPTIONS, GET_PARAMETER, SET_PARAMETER';
        respond(socket, request, 200, headers);
        break;

      case 'ANNOUNCE':
        this.handleAnnounce(socket, request);
        respond(socket, request, 200, headers);
        break;

      case 'SETUP':
        this.handleSetup(socket, request, headers);
        break;

      case 'RECORD':
        headers['Audio-Latency'] = '11025';
        respond(socket, request, 200, headers);
        this.emit('play');
        break;

      case 'FLUSH':
        this.emit('flush');
        respond(socket, request, 200, headers);
        break;

      case 'TEARDOWN':
        respond(socket, request, 200, headers);
        this.endSession('teardown');
        break;

      case 'SET_PARAMETER':
        this.handleSetParameter(request);
        respond(socket, request, 200, headers);
        break;

      case 'GET_PARAMETER':
        respond(socket, request, 200, { ...headers, 'Content-Type': 'text/parameters' }, Buffer.from('volume: 0.000000\r\n'));
        break;

      default:
        // AirPlay-2-Abfragen wie "GET /info" gibt es bei klassischem AirPlay nicht: mit 404 antworten,
        // dann fällt der Sender auf AirPlay 1 zurück. "POST /feedback" (Lebenszeichen) einfach bestätigen.
        respond(socket, request, request.method === 'POST' ? 200 : 404, headers);
    }
  }

  handleAnnounce(socket, request) {
    // eine neue Verbindung übernimmt (wie ein AirPort Express)
    if (this.session && this.session.socket !== socket) this.endSession('replaced');

    const sdp = request.body.toString('utf8');
    const attr = (name) => {
      const m = new RegExp(`^a=${name}:(.*)$`, 'm').exec(sdp);
      return m ? m[1].trim() : null;
    };
    const rtpmap = attr('rtpmap') ?? '';
    const fmtp = attr('fmtp');
    const rsaKey = attr('rsaaeskey');
    const iv = attr('aesiv');
    const deviceName = /^i=(.*)$/m.exec(sdp)?.[1]?.trim();

    let aesKey = null;
    if (rsaKey) {
      aesKey = crypto.privateDecrypt(
        { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(rsaKey, 'base64'),
      );
    }

    let decoder = null;
    let codec = 'pcm';
    if (/AppleLossless/i.test(rtpmap) && fmtp) {
      decoder = AlacDecoder.fromFmtp(fmtp);
      codec = 'alac';
    } else if (!/L16/i.test(rtpmap)) {
      throw new Error(`Nicht unterstütztes Audioformat: ${rtpmap}`);
    }

    this.session = {
      socket,
      aesKey,
      aesIv: iv ? Buffer.from(iv, 'base64') : null,
      decoder,
      codec,
      udp: [],
      client: deviceName || request.headers['x-apple-client-name'] || 'iPhone',
    };
    this.emit('session', { client: this.session.client, codec });
  }

  handleSetup(socket, request, headers) {
    const session = this.session;
    if (!session) {
      respond(socket, request, 455, headers);
      return;
    }
    const transport = request.headers.transport ?? '';
    const audio = dgram.createSocket('udp4');
    const control = dgram.createSocket('udp4');
    const timing = dgram.createSocket('udp4');
    session.udp = [audio, control, timing];

    audio.on('message', (msg) => this.handleRtp(msg));
    // Nachgesendete Pakete kommen über den Control-Port (Typ 0x56, RTP ab Byte 4)
    control.on('message', (msg) => {
      if ((msg[1] & 0x7f) === 0x56 && msg.length > 4) this.handleRtp(msg.subarray(4));
    });
    for (const s of session.udp) s.on('error', () => {});

    Promise.all(session.udp.map((s, i) => bindUdp(s, UDP_PORTS[i]))).then((ports) => {
      headers.Transport = `${transport.split(';').filter((p) => !/_port=/.test(p)).join(';')};server_port=${ports[0]};control_port=${ports[1]};timing_port=${ports[2]}`;
      headers.Session = '1';
      headers['Audio-Jack-Status'] = 'connected; type=analog';
      respond(socket, request, 200, headers);
    });
  }

  handleRtp(packet) {
    const session = this.session;
    if (!session || packet.length < 12) return;
    const payloadType = packet[1] & 0x7f;
    if (payloadType !== 0x60) return; // nur Audiodaten
    const seq = packet.readUInt16BE(2);
    const timestamp = packet.readUInt32BE(4);
    let payload = packet.subarray(12);

    if (session.aesKey && session.aesIv) {
      const full = payload.length - (payload.length % 16);
      const decipher = crypto.createDecipheriv('aes-128-cbc', session.aesKey, session.aesIv);
      decipher.setAutoPadding(false);
      const decrypted = Buffer.concat([decipher.update(payload.subarray(0, full)), decipher.final()]);
      payload = Buffer.concat([decrypted, payload.subarray(full)]);
    }

    let pcm;
    try {
      if (session.decoder) {
        pcm = session.decoder.decode(payload);
      } else {
        // L16: Big-Endian-PCM
        pcm = new Int16Array(payload.length >> 1);
        for (let i = 0; i < pcm.length; i++) pcm[i] = payload.readInt16BE(i * 2);
      }
    } catch (err) {
      this.emit('error', err);
      return;
    }
    this.emit('audio', { seq, timestamp, pcm });
  }

  handleSetParameter(request) {
    const type = (request.headers['content-type'] ?? '').toLowerCase();
    const body = request.body;
    if (type.startsWith('text/parameters')) {
      const text = body.toString('utf8');
      const volume = /volume:\s*(-?[\d.]+)/i.exec(text);
      if (volume) this.emit('volume', Number(volume[1]));
      const progress = /progress:\s*(\d+)\/(\d+)\/(\d+)/i.exec(text);
      if (progress) {
        const [start, current, end] = progress.slice(1).map(Number);
        // RTP-Zeitstempel (44,1 kHz) in Millisekunden umrechnen, Überlauf berücksichtigen
        const diff = (a, b) => ((a - b + 2 ** 32) % 2 ** 32) / 44.1;
        this.emit('progress', { position: diff(current, start), duration: diff(end, start) });
      }
    } else if (type.startsWith('application/x-dmap-tagged')) {
      this.emit('metadata', parseDmap(body));
    } else if (type.startsWith('image/')) {
      this.emit('cover', body.length ? `data:${type.split(';')[0]};base64,${body.toString('base64')}` : null);
    }
  }

  endSession(reason) {
    const session = this.session;
    if (!session) return;
    this.session = null;
    for (const s of session.udp) {
      try {
        s.close();
      } catch {
        // schon zu
      }
    }
    if (reason !== 'disconnected') session.socket.end();
    this.emit('end', { reason });
  }
}

module.exports = { RaopReceiver, appleResponse, parseDmap, pickInterfaces };
