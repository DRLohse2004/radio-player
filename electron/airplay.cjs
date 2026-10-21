// Verwaltet den AirPlay-Empfänger im Hauptprozess und reicht Ereignisse und Ton an die Oberfläche weiter.

'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const { RaopReceiver, pickInterfaces } = require('./airplay/raop.cjs');

let receiver = null;
let send = () => {};
let state = { running: false, port: 0, name: '', interfaces: [], error: null };

/** Stabile, "lokal verwaltete" Hardware-Adresse aus dem Rechnernamen (für den Bonjour-Namen) */
function hardwareAddress() {
  const hash = crypto.createHash('sha1').update(`radio-airplay-${os.hostname()}`).digest();
  const mac = hash.subarray(0, 6);
  mac[0] = (mac[0] & 0xfe) | 0x02;
  return Buffer.from(mac);
}

function publish(patch) {
  state = { ...state, ...patch };
  send('airplay:event', { type: 'state', ...state });
}

async function start(name) {
  await stop();
  const deviceName = (name || `Radio ${os.hostname()}`).slice(0, 50);
  receiver = new RaopReceiver({ name: deviceName, hwAddr: hardwareAddress() });

  receiver.on('session', (s) => send('airplay:event', { type: 'session', client: s.client }));
  receiver.on('play', () => send('airplay:event', { type: 'play' }));
  receiver.on('flush', () => send('airplay:event', { type: 'flush' }));
  receiver.on('volume', (db) => send('airplay:event', { type: 'volume', db }));
  receiver.on('metadata', (m) => send('airplay:event', { type: 'metadata', ...m }));
  receiver.on('cover', (cover) => send('airplay:event', { type: 'cover', cover }));
  receiver.on('progress', (p) => send('airplay:event', { type: 'progress', ...p }));
  receiver.on('end', (e) => send('airplay:event', { type: 'end', reason: e.reason }));
  receiver.on('error', (err) => send('airplay:event', { type: 'warning', message: err.message }));
  // Ton: ca. 125 Pakete pro Sekunde à 352 Stereo-Samples
  receiver.on('audio', ({ pcm }) => send('airplay:audio', pcm));

  try {
    const port = await receiver.start();
    publish({
      running: true,
      port,
      name: deviceName,
      interfaces: (receiver.announcedOn ?? []).map((i) => ({ name: i.name, address: i.address })),
      error: null,
    });
  } catch (err) {
    receiver = null;
    publish({ running: false, port: 0, error: String(err.message || err) });
  }
  return state;
}

async function stop() {
  const r = receiver;
  receiver = null;
  if (r) await r.stop().catch(() => {});
  publish({ running: false, port: 0 });
}

module.exports = {
  start,
  stop,
  getState: () => ({ ...state, available: pickInterfaces().map((i) => ({ name: i.name, address: i.address })) }),
  setSender: (fn) => {
    send = fn;
  },
  isRunning: () => !!receiver,
};
