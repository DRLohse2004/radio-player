// Gemeinsam für Chromecast und DLNA: aus dem Mithör-Zustand (HostListen) eine Adresse machen, die ein
// Lautsprecher selbst abrufen kann.

'use strict';

const youtube = require('./youtube.cjs');

function contentType(url, hls, ext) {
  if (hls || /\.m3u8(\?|$)/i.test(url)) return 'application/x-mpegURL';
  if (ext === 'webm') return 'audio/webm';
  if (ext) return 'audio/mp4';
  if (/\.aac(\?|$)/i.test(url)) return 'audio/aac';
  if (/\.ogg(\?|$)/i.test(url)) return 'audio/ogg';
  return 'audio/mpeg';
}

/** Wo die eigene Wiedergabe gerade steht (Sekunden) */
const expectedPosition = (m) => m.position + (Date.now() - m.at) / 1000;

const mediaKey = (m) => (m && m.kind !== 'none' ? `${m.kind}:${m.url}` : null);

/** { url, type, live } – YouTube wird erst hier zur direkten Audio-Adresse */
async function resolveMedia(m) {
  if (m.kind !== 'youtube') return { url: m.url, type: contentType(m.url), live: true };
  const r = await youtube.resolve(m.url);
  return { url: r.url, type: contentType(r.url, r.hls, r.ext), live: m.live || r.live };
}

module.exports = { contentType, expectedPosition, mediaKey, resolveMedia };
