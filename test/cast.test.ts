import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const cast = require('../electron/cast.cjs');

type Msg = { source: string; destination: string; namespace: string; data: Record<string, unknown> };

/** Selbst signiertes Zertifikat wie bei echten Geräten – nur wenn openssl da ist */
function certificate() {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-'));
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=cast'], { stdio: 'ignore' });
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  } catch {
    return null;
  }
}
const creds = certificate();

describe('Chromecast', () => {
  it('kodiert und dekodiert CastMessages', () => {
    const data = { type: 'LOAD', text: 'Grüße'.repeat(40) };
    const frame = cast.encode({ source: 'sender-0', destination: 'receiver-0', namespace: 'urn:x', data });
    expect(frame.readUInt32BE(0)).toBe(frame.length - 4);
    expect(cast.decode(frame.subarray(4))).toEqual({ source: 'sender-0', destination: 'receiver-0', namespace: 'urn:x', data });
  });

  it.skipIf(!creds)('startet den Media Receiver, lädt den Sender und folgt Pause und Stopp', async () => {
    const received: Msg[] = [];
    const waiters: [(m: Msg) => boolean, (m: Msg) => void][] = [];
    let socket: tls.TLSSocket | null = null;
    const reply = (m: Msg, namespace: string, data: object, source = m.destination) =>
      socket!.write(cast.encode({ source, destination: m.source, namespace, data }));

    const server = tls.createServer(creds!, (s) => {
      socket = s;
      let buf = Buffer.alloc(0);
      s.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
          const m: Msg = cast.decode(buf.subarray(4, 4 + buf.readUInt32BE(0)));
          buf = buf.subarray(4 + buf.readUInt32BE(0));
          received.push(m);
          if (m.data.type === 'LAUNCH') {
            reply(m, m.namespace, { type: 'RECEIVER_STATUS', status: { applications: [{ appId: 'CC1AD845', transportId: 'web-1', sessionId: 's-1' }] } });
          }
          if (m.data.type === 'LOAD') reply(m, m.namespace, { type: 'MEDIA_STATUS', status: [{ mediaSessionId: 7, playerState: 'PLAYING' }] });
          for (const w of [...waiters]) if (w[0](m)) waiters.splice(waiters.indexOf(w), 1), w[1](m);
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const next = (type: string) =>
      new Promise<Msg>((resolve) => {
        const hit = received.find((m) => m.data.type === type);
        if (hit) resolve(hit);
        else waiters.push([(m) => m.data.type === type, resolve]);
      });
    const events: { state: string }[] = [];
    cast.setSender((_channel: string, e: { state: string }) => events.push(e));

    const target = {
      device: { id: 'dev', name: 'Küche', model: 'Test', host: '127.0.0.1', port },
      media: { kind: 'radio', url: 'https://example.org/stream.mp3' },
      playing: true,
      volume: 0.4,
      title: null,
      artist: null,
      cover: null,
      station: 'Testradio',
    };
    cast.follow(target);

    expect((await next('SET_VOLUME')).data.volume).toEqual({ level: 0.4 });
    await next('LAUNCH');
    const load = await next('LOAD');
    expect(load.destination).toBe('web-1');
    expect(load.data.media).toMatchObject({ contentId: 'https://example.org/stream.mp3', contentType: 'audio/mpeg', streamType: 'LIVE', metadata: { title: 'Testradio' } });

    await new Promise((r) => setTimeout(r, 50)); // MEDIA_STATUS verarbeiten lassen
    expect(events.at(-1)?.state).toBe('playing');
    cast.follow({ ...target, playing: false });
    expect((await next('PAUSE')).data.mediaSessionId).toBe(7);

    cast.follow(null);
    expect((await next('STOP')).data.sessionId).toBe('s-1');
    server.close();
  });
});
