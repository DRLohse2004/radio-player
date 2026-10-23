// Senden an DLNA/UPnP-Lautsprecher (z. B. WiiM Mini, AV-Receiver): Gerät per SSDP finden, dann über
// SOAP die Stream-Adresse übergeben (AVTransport) und die Lautstärke setzen (RenderingControl).
// Wie bei Chromecast holt das Gerät den Stream selbst und folgt der eigenen, stummen Wiedergabe.

'use strict';

const dgram = require('node:dgram');
const { pickInterfaces } = require('./airplay/raop.cjs');
const { expectedPosition, mediaKey, resolveMedia } = require('./cast-media.cjs');

const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';
const RC = 'urn:schemas-upnp-org:service:RenderingControl:1';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const tag = (xml, name) => xml.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([^<]*)<`, 'i'))?.[1]?.trim() ?? '';

/** Gerätebeschreibung (XML) → Gerät mit Steueradressen, oder null ohne AVTransport */
function parseDescription(xml, location) {
  const base = tag(xml, 'URLBase') || location;
  const control = (type) => {
    const service = xml.split(/<service>/i).find((s) => s.includes(type));
    const url = service && tag(service, 'controlURL');
    return url ? new URL(url, base).href : null;
  };
  const avTransport = control(AVT);
  if (!avTransport) return null;
  const host = new URL(location).hostname;
  return {
    id: tag(xml, 'UDN') || location,
    name: tag(xml, 'friendlyName') || host,
    model: tag(xml, 'modelName'),
    host,
    port: 0,
    kind: 'dlna',
    avTransport,
    rendering: control(RC),
  };
}

/** Sucht ca. 2,5 s per SSDP nach Medien-Renderern */
function discover(timeout = 2500) {
  return new Promise((resolve) => {
    const locations = new Set();
    const search = Buffer.from(
      `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${AVT}\r\n\r\n`,
    );
    const sockets = pickInterfaces().map(({ address }) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.on('error', () => {});
      s.on('message', (msg) => {
        const loc = msg.toString().match(/^location:\s*(\S+)/im)?.[1];
        if (loc) locations.add(loc);
      });
      s.bind(0, address, () => {
        s.send(search, 1900, '239.255.255.250');
        setTimeout(() => s.send(search, 1900, '239.255.255.250'), 500);
      });
      return s;
    });
    setTimeout(async () => {
      for (const s of sockets) s.close();
      const devices = await Promise.all(
        [...locations].map((loc) =>
          fetch(loc, { signal: AbortSignal.timeout(2000) })
            .then((r) => r.text())
            .then((xml) => parseDescription(xml, loc))
            .catch(() => null),
        ),
      );
      const byId = new Map(devices.filter(Boolean).map((d) => [d.id, d]));
      resolve([...byId.values()]);
    }, timeout);
  });
}

async function soap(url, service, action, args) {
  const body =
    '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service}">` +
    Object.entries(args)
      .map(([k, v]) => `<${k}>${esc(v)}</${k}>`)
      .join('') +
    `</u:${action}></s:Body></s:Envelope>`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${service}#${action}"` },
    body,
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${action}: ${tag(text, 'errorDescription') || `HTTP ${res.status}`}`);
  return text;
}

const hms = (sec) => new Date(Math.max(0, Math.round(sec)) * 1000).toISOString().slice(11, 19);
const seconds = (t) => t.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);

function didl(w, url, type) {
  return (
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1">' +
    `<dc:title>${esc(w.title || w.station || 'Radio')}</dc:title>` +
    (w.artist ? `<upnp:artist>${esc(w.artist)}</upnp:artist>` : '') +
    (w.cover ? `<upnp:albumArtURI>${esc(w.cover)}</upnp:albumArtURI>` : '') +
    '<upnp:class>object.item.audioItem.musicTrack</upnp:class>' +
    `<res protocolInfo="http-get:*:${type}:*">${esc(url)}</res></item></DIDL-Lite>`
  );
}

// --- Dem Radio folgen --------------------------------------------------------------------

let device = null;
let wanted = null;
let loaded = null; // { key, live }
let lastVolume = -1;
let lastPlaying = null;
let busy = Promise.resolve(); // SOAP-Aufrufe nacheinander, sonst überholen sie sich

function follow(target, emit) {
  wanted = target;
  busy = busy.then(() => sync(emit)).catch((err) => {
    const name = device?.name;
    reset();
    emit('off', { device: name, error: `„${name}“: ${err.message}` });
  });
}

function reset() {
  device = null;
  loaded = null;
  lastVolume = -1;
  lastPlaying = null;
}

async function sync(emit) {
  const w = wanted;
  if (!w) {
    if (device && loaded) await soap(device.avTransport, AVT, 'Stop', { InstanceID: 0 }).catch(() => {});
    return reset();
  }
  if (device?.id !== w.device.id) {
    if (device && loaded) await soap(device.avTransport, AVT, 'Stop', { InstanceID: 0 }).catch(() => {});
    reset();
    device = w.device;
    emit('connecting');
  }
  if (device.rendering && w.volume !== lastVolume) {
    lastVolume = w.volume;
    await soap(device.rendering, RC, 'SetVolume', { InstanceID: 0, Channel: 'Master', DesiredVolume: Math.round(w.volume * 100) });
  }
  const key = mediaKey(w.media);
  if (!key) {
    if (loaded) await soap(device.avTransport, AVT, 'Stop', { InstanceID: 0 });
    loaded = null;
    return emit('idle');
  }
  if (loaded?.key !== key) {
    emit('buffering');
    let m;
    try {
      m = await resolveMedia(w.media);
    } catch {
      return emit('error', { error: 'YouTube-Titel konnte nicht geladen werden.' });
    }
    if (wanted !== w && mediaKey(wanted?.media) !== key) return; // inzwischen etwas anderes gewünscht
    await soap(device.avTransport, AVT, 'SetAVTransportURI', { InstanceID: 0, CurrentURI: m.url, CurrentURIMetaData: didl(w, m.url, m.type) });
    loaded = { key, live: m.live };
    lastPlaying = null;
  }
  if (w.playing !== lastPlaying) {
    lastPlaying = w.playing;
    await soap(device.avTransport, AVT, w.playing ? 'Play' : 'Pause', w.playing ? { InstanceID: 0, Speed: 1 } : { InstanceID: 0 });
  }
  // YouTube: nachziehen, wenn das Gerät mehr als 3 s neben der eigenen Wiedergabe liegt
  if (w.playing && !loaded.live && w.media.kind === 'youtube') {
    const info = await soap(device.avTransport, AVT, 'GetPositionInfo', { InstanceID: 0 }).catch(() => '');
    const rel = tag(info, 'RelTime');
    const target = expectedPosition(w.media);
    if (/^\d+:\d\d:\d\d/.test(rel) && Math.abs(seconds(rel) - target) > 3) {
      await soap(device.avTransport, AVT, 'Seek', { InstanceID: 0, Unit: 'REL_TIME', Target: hms(target + 1) }).catch(() => {});
    }
  }
  emit(w.playing ? 'playing' : 'paused');
}

module.exports = { discover, follow, parseDescription };
