// @vitest-environment jsdom
// (jsdom nur, weil die importierten Module die Oberflächen-API laden)
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, mergePrefs } from './prefs';

describe('Einstellungen zusammenführen', () => {
  it('nimmt ohne gespeicherte Einstellungen die Standardwerte und vergibt eine Kennung', () => {
    const prefs = mergePrefs(undefined);
    expect({ ...prefs, room: { ...prefs.room, clientId: '' } }).toEqual(DEFAULT_PREFS);
    expect(prefs.room.clientId).not.toBe('');
  });

  it('ergänzt fehlende Felder in verschachtelten Einstellungen (ältere Versionen)', () => {
    const prefs = mergePrefs({ autoplay: true, remote: { enabled: true } as never, schedule: { enabled: true } as never });
    expect(prefs.autoplay).toBe(true);
    expect(prefs.remote.enabled).toBe(true);
    expect(prefs.remote.maxWishes).toBe(DEFAULT_PREFS.remote.maxWishes);
    expect(prefs.schedule).toEqual({ ...DEFAULT_PREFS.schedule, enabled: true });
  });

  it('setzt ein unbekanntes Design auf Standard und behält eine vorhandene Kennung', () => {
    const prefs = mergePrefs({ theme: 'gibts-nicht' as never, room: { ...DEFAULT_PREFS.room, clientId: 'abc' } });
    expect(prefs.theme).toBe('standard');
    expect(prefs.room.clientId).toBe('abc');
  });

  it('verändert die Standardwerte nicht', () => {
    mergePrefs({ tabs: { radio: false } as never });
    expect(DEFAULT_PREFS.tabs.radio).toBe(true);
    expect(DEFAULT_PREFS.room.clientId).toBe('');
  });
});
