import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const remote = require('../electron/remote.cjs');

let server: http.Server;
let base = '';
const sent: { channel: string; payload: unknown }[] = [];

beforeAll(async () => {
  remote.setSender((channel: string, payload: unknown) => sent.push({ channel, payload }));
  server = http.createServer((req, res) => remote.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const setup = (phone: string, room: string) => remote.configure({ key: 'master', pin: '', roomName: 'Test', phone, room, joinPin: '2468' });

async function call(path: string, { key = '', client = '', kind = 'phone', body }: { key?: string; client?: string; kind?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-key': key, 'x-client': client, 'x-kind': kind, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

describe('Zugang zur Fernbedienung', () => {
  it('öffentlich: der Schlüssel aus dem QR-Code genügt, aus: niemand kommt herein', async () => {
    setup('public', 'off');
    expect((await call('/api/state', { key: 'master' })).status).toBe(200);
    expect((await call('/api/state', { key: 'master', kind: 'radio' })).status).toBe(403);
    setup('off', 'off');
    expect((await call('/api/state', { key: 'master' })).status).toBe(403);
    expect((await call('/api/join', { body: { clientId: 'c1', pin: '2468' } })).status).toBe(403);
  });

  it('sicher: QR-Schlüssel reicht nicht, die PIN liefert einen eigenen Schlüssel nur für dieses Gerät', async () => {
    setup('secure', 'off');
    const denied = await call('/api/state', { key: 'master', client: 'c1' });
    expect(denied).toMatchObject({ status: 403, body: { join: true } });
    expect((await call('/api/join', { body: { clientId: 'c1', pin: '0000' } })).status).toBe(403);
    const ok = await call('/api/join', { body: { clientId: 'c1', pin: '2468' } });
    expect(ok.status).toBe(200);
    expect((await call('/api/state', { key: ok.body.key, client: 'c1' })).status).toBe(200);
    expect((await call('/api/state', { key: ok.body.key, client: 'c2' })).status).toBe(403);
  });

  it('sicher: Einmalcode erscheint am Host, gilt nur für das anfragende Gerät und verschwindet danach', async () => {
    setup('off', 'secure');
    sent.length = 0;
    await call('/api/join', { kind: 'radio', body: { clientId: 'r1', name: 'Radio Küche', request: true } });
    const shown = sent.find((m) => m.channel === 'remote:code')?.payload as { code: string; name: string; kind: string };
    expect(shown).toMatchObject({ name: 'Radio Küche', kind: 'radio' });
    expect((await call('/api/join', { kind: 'radio', body: { clientId: 'r2', code: shown.code } })).status).toBe(403);
    const ok = await call('/api/join', { kind: 'radio', body: { clientId: 'r1', code: shown.code } });
    expect(ok.status).toBe(200);
    expect(sent.at(-1)).toEqual({ channel: 'remote:code', payload: null });
    expect((await call('/api/join', { kind: 'radio', body: { clientId: 'r1', code: shown.code } })).status).toBe(403);
    expect((await call('/api/state', { key: ok.body.key, client: 'r1', kind: 'radio' })).status).toBe(200);
  });
});
