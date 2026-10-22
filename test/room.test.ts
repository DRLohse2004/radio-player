import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const room = require('../electron/room.cjs');

let server: http.Server;
let port = 0;
let lastHeaders: http.IncomingHttpHeaders = {};
const events: unknown[] = [];

beforeAll(async () => {
  // Nachgebauter Host: /api/room, Zustand per Server-Sent Events und ein Befehl
  server = http.createServer((req, res) => {
    lastHeaders = req.headers;
    if (req.url === '/api/room') {
      res.end(JSON.stringify({ app: 'radio', name: 'Radio Test', version: '1.5.0', open: true, key: 'k123', listeners: 2 }));
    } else if (req.url === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('retry: 3000\n\nevent: state\ndata: {"title":"Song","playing":true}\n\n');
    } else if (req.url === '/api/command') {
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  room.setSender((_channel: string, payload: unknown) => events.push(payload));
});

afterAll(() => {
  room.disconnect();
  server.closeAllConnections();
  server.close();
});

describe('Rooms', () => {
  it('findet ein Radio unter einer Adresse und liest den Schlüssel', async () => {
    const host = await room.probeAddress(`127.0.0.1:${port}`);
    expect(host).toMatchObject({ name: 'Radio Test', open: true, key: 'k123', listeners: 2, url: `http://127.0.0.1:${port}` });
  });

  it('ignoriert Adressen ohne Radio', async () => {
    expect(await room.probeAddress('kein host!')).toBeNull();
    expect(await room.probeAddress('127.0.0.1:1')).toBeNull();
  });

  it('empfängt den Zustand des Hosts und schickt Befehle mit Kennung', async () => {
    room.connect({ url: `http://127.0.0.1:${port}`, key: 'k123', clientId: 'r-1', name: 'Radio Kopfhörer' });
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toContainEqual({ type: 'status', status: 'connected', error: null });
    expect(events).toContainEqual({ type: 'state', state: { title: 'Song', playing: true } });

    const result = await room.request({ method: 'POST', path: '/api/command', body: { action: 'toggle' } });
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(lastHeaders['x-key']).toBe('k123');
    expect(lastHeaders['x-kind']).toBe('radio');
    expect(decodeURIComponent(String(lastHeaders['x-name']))).toBe('Radio Kopfhörer');
  });

  it('reicht nur bekannte Pfade an den Host weiter', async () => {
    const result = await room.request({ path: '/api/../geheim' });
    expect(result.status).toBe(400);
  });

  it('reicht Playlist-Abfragen an den Host weiter', async () => {
    const result = await room.request({ path: '/api/playlist?id=PL123' });
    expect(result.status).not.toBe(400);
  });
});
