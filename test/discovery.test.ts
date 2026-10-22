import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const discovery = require('../electron/discovery.cjs');

describe('parseNetworks', () => {
  it('erkennt Broadcast-Adressen, Netze und einzelne Rechner', () => {
    const result = discovery.parseNetworks('10.0.11.255, 10.0.255.255; 192.168.5.x 172.16.0.0/24 10.0.11.20 kaputt 10.0.0.0/7');
    expect(result.broadcasts.sort()).toEqual(['10.0.11.255', '10.0.255.255', '172.16.0.255', '192.168.5.255']);
    expect(result.prefixes.sort()).toEqual(['10.0.11', '172.16.0', '192.168.5']);
    expect(result.hosts).toEqual(['10.0.11.20']);
  });

  it('fragt große Netze nicht Adresse für Adresse ab', () => {
    const result = discovery.parseNetworks('10.0.0.0/16');
    expect(result.broadcasts).toEqual(['10.0.255.255']);
    expect(result.prefixes).toEqual([]);
  });
});

describe('ownBroadcasts', () => {
  it('berechnet die Broadcast-Adresse aus Adresse und Netzmaske', () => {
    const interfaces = {
      Ethernet: [{ family: 'IPv4', internal: false, address: '10.0.12.7', netmask: '255.255.255.0' }],
      WLAN: [{ family: 'IPv4', internal: false, address: '172.20.5.9', netmask: '255.255.240.0' }],
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }],
    };
    expect(discovery.ownBroadcasts(interfaces).sort()).toEqual(['10.0.12.255', '172.20.15.255']);
  });
});

describe('UDP-Suche', () => {
  afterAll(() => discovery.stopResponder());

  it('ein Host antwortet mit seinem HTTP-Port', async () => {
    const port = await discovery.startResponder(() => 8080, 0);
    expect(port).toBeGreaterThan(0);
    const answers = await discovery.ask(['127.0.0.1'], { wait: 500, port });
    expect(answers).toEqual([{ address: '127.0.0.1', port: 8080 }]);
  });
});
