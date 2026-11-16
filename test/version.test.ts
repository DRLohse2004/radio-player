import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { newer } = require('../electron/version.cjs');

describe('Updater: Versionsvergleich', () => {
  it('vergleicht Zahl für Zahl, nicht als Text', () => {
    expect(newer('1.10.0', '1.9.0')).toBe(true);
    expect(newer('1.9.0', '1.10.0')).toBe(false);
    expect(newer('2.0.0', '1.99.99')).toBe(true);
  });

  it('ignoriert das "v" eines Tags', () => {
    expect(newer('v1.14.0', '1.13.0')).toBe(true);
    expect(newer('v1.13.0', '1.13.0')).toBe(false);
  });

  it('meldet gleiche Versionen nicht als neuer', () => {
    expect(newer('1.13.0', '1.13.0')).toBe(false);
  });

  it('behandelt fehlende Stellen als 0', () => {
    expect(newer('1.14', '1.13.9')).toBe(true);
    expect(newer('1.13', '1.13.0')).toBe(false);
  });
});
