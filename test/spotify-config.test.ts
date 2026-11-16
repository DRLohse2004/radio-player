import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { writeConfig } = require('../electron/spotify.cjs');

const dirs: string[] = [];
const write = (options: { port: number; deviceName: string; mode: string }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-spotify-'));
  dirs.push(dir);
  writeConfig(path.join(dir, 'sub'), options);
  return fs.readFileSync(path.join(dir, 'sub', 'config.yml'), 'utf8');
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Spotify: Konfiguration für go-librespot', () => {
  it('schreibt Name, Port und Zeroconf-Anmeldung', () => {
    const yml = write({ port: 3678, deviceName: 'Radio Büro', mode: 'zeroconf' });
    expect(yml).toContain("device_name: 'Radio Büro'");
    expect(yml).toContain('  port: 3678');
    expect(yml).toContain('  type: zeroconf');
    expect(yml).toContain('zeroconf_enabled: true');
  });

  it('nutzt mit gekoppeltem Konto die Geräte-Anmeldung', () => {
    expect(write({ port: 1, deviceName: 'R', mode: 'account' })).toContain('  type: device_auth');
  });

  it('maskiert Apostrophe im Namen, damit das YAML gültig bleibt', () => {
    const yml = write({ port: 1, deviceName: "Jo's Radio", mode: 'zeroconf' });
    expect(yml).toContain("device_name: 'Jo''s Radio'");
  });
});
