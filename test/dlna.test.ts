import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const dlna = require('../electron/dlna.cjs');

// Gekürzte Beschreibung, wie sie ein WiiM Mini liefert
const description = (base: string) => `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>
<friendlyName>WiiM Mini-Küche</friendlyName><modelName>WiiM Mini</modelName><UDN>uuid:wiim-1</UDN><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/upnp/control/rendercontrol1</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>${base}/upnp/control/rendertransport1</controlURL></service>
</serviceList></device></root>`;

it('liest die Gerätebeschreibung und steuert einen DLNA-Lautsprecher', async () => {
  const calls: { action: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const action = String(req.headers.soapaction ?? '').replace(/.*#|"/g, '');
      calls.push({ action, body });
      res.end('<s:Envelope><s:Body><RelTime>0:00:00</RelTime></s:Body></s:Envelope>');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const device = dlna.parseDescription(description(base), `${base}/description.xml`);
  expect(device).toMatchObject({
    id: 'uuid:wiim-1',
    name: 'WiiM Mini-Küche',
    kind: 'dlna',
    avTransport: `${base}/upnp/control/rendertransport1`,
    rendering: `${base}/upnp/control/rendercontrol1`,
  });

  const events: string[] = [];
  const emit = (state: string) => events.push(state);
  const target = {
    device,
    media: { kind: 'radio', url: 'https://example.org/stream.mp3?a=1&b=2' },
    playing: true,
    volume: 0.4,
    title: null,
    artist: null,
    cover: null,
    station: 'Testradio',
  };
  const settle = () => new Promise((r) => setTimeout(r, 100));
  dlna.follow(target, emit);
  await settle();
  expect(calls.map((c) => c.action)).toEqual(['SetVolume', 'SetAVTransportURI', 'Play']);
  expect(calls[0].body).toContain('<DesiredVolume>40</DesiredVolume>');
  // Adresse XML-sicher, Metadaten doppelt maskiert (DIDL im SOAP-Text)
  expect(calls[1].body).toContain('<CurrentURI>https://example.org/stream.mp3?a=1&amp;b=2</CurrentURI>');
  expect(calls[1].body).toContain('&lt;dc:title&gt;Testradio&lt;/dc:title&gt;');
  expect(events.at(-1)).toBe('playing');

  dlna.follow({ ...target, playing: false }, emit);
  await settle();
  dlna.follow(null, emit);
  await settle();
  expect(calls.slice(3).map((c) => c.action)).toEqual(['Pause', 'Stop']);
  server.close();
});
