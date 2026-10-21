import { describe, expect, it } from 'vitest';
import {
  cleanName,
  dedupe,
  displayName,
  genreRank,
  matchesGenre,
  matchesQuery,
  normalizeUrl,
  operatorLabel,
  operatorOf,
} from './store';
import type { StoreStation } from './types';

let nextId = 0;
function station(overrides: Partial<StoreStation> = {}): StoreStation {
  nextId += 1;
  return {
    id: `id-${nextId}`,
    name: 'Testradio',
    url: 'https://stream.example.com/live.mp3',
    favicon: null,
    homepage: null,
    tags: [],
    country: 'Germany',
    countryCode: 'DE',
    codec: 'MP3',
    bitrate: 128,
    votes: 0,
    clicks: 0,
    ...overrides,
  };
}

describe('cleanName', () => {
  it('entfernt Codec-Angaben am Ende', () => {
    expect(cleanName('Deutschlandfunk | DLF | MP3 128k')).toBe('Deutschlandfunk | DLF');
    expect(cleanName('SWR3 (AAC 96k)')).toBe('SWR3');
    expect(cleanName('Radio Bob - mp3')).toBe('Radio Bob');
  });

  it('fasst Leerzeichen zusammen', () => {
    expect(cleanName('  Radio   Bob  ')).toBe('Radio Bob');
  });
});

describe('displayName', () => {
  it('kürzt überlange Schlagwort-Namen am ersten Trenner', () => {
    const name = '# TOP 100 CLUB CHARTS - DANCE & DJ MIX RADIO - 24 HOURS @ TikTok Hits, Party';
    expect(displayName(name)).toBe('TOP 100 CLUB CHARTS');
  });

  it('begrenzt ohne Trenner auf 60 Zeichen mit Auslassungszeichen', () => {
    const result = displayName('A'.repeat(80));
    expect(result.endsWith(' …')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it('lässt normale Namen unverändert', () => {
    expect(displayName('1LIVE')).toBe('1LIVE');
  });
});

describe('dedupe', () => {
  it('behält pro Sender nur den ersten Eintrag', () => {
    const first = station({ name: 'SWR3 | MP3 128k' });
    const second = station({ name: 'swr3 (AAC 48k)' });
    const other = station({ name: 'Radio Bob' });
    expect(dedupe([first, second, other])).toEqual([first, other]);
  });

  it('verwirft Einträge ohne verwertbaren Namen', () => {
    expect(dedupe([station({ name: '---' })])).toEqual([]);
  });
});

describe('Genres', () => {
  it('ordnet Sender über ihre Tags zu', () => {
    const rock = station({ tags: ['classic', 'hard rock'] });
    expect(matchesGenre(rock, 'rock')).toBe(true);
    expect(matchesGenre(rock, 'jazz')).toBe(false);
    expect(matchesGenre(rock, 'unbekannt')).toBe(false);
  });

  it('sortiert Sender mit dem Genre in den ersten Tags nach vorn', () => {
    const primary = station({ tags: ['rock', 'pop'] });
    const secondary = station({ tags: ['news', 'talk', 'pop', 'rock'] });
    const spammy = station({ tags: ['rock', ...Array.from({ length: 12 }, (_, i) => `tag${i}`)] });
    expect(genreRank(primary, 'rock')).toBe(0);
    expect(genreRank(secondary, 'rock')).toBe(1);
    expect(genreRank(spammy, 'rock')).toBe(2);
  });
});

describe('Betreiber', () => {
  it('erkennt Betreiber über die Domain, auch bei Subdomains', () => {
    expect(operatorOf(station({ url: 'https://liveradio.swr.de/sw282p3/swr3/' }))).toBe('ard');
    expect(operatorOf(station({ homepage: 'https://www.deutschlandfunk.de' }))).toBe('dlr');
  });

  it('verwechselt ähnliche Domains nicht', () => {
    expect(operatorOf(station({ url: 'https://notswr.de/stream' }))).toBeNull();
  });

  it('erkennt Betreiber über den Namen', () => {
    expect(operatorOf(station({ name: '1LIVE diggi' }))).toBe('ard');
  });

  it('kommt mit ungültigen URLs zurecht', () => {
    expect(operatorOf(station({ url: 'kein link', homepage: null }))).toBeNull();
  });

  it('liefert das Label zur Betreiber-ID', () => {
    expect(operatorLabel('dlr')).toBe('Deutschlandradio');
    expect(operatorLabel(null)).toBeNull();
  });
});

describe('matchesQuery', () => {
  const swr3 = station({ name: 'SWR3', url: 'https://liveradio.swr.de/swr3', tags: ['pop', 'charts'] });

  it('verlangt, dass alle Suchwörter vorkommen', () => {
    expect(matchesQuery(swr3, 'swr3 pop')).toBe(true);
    expect(matchesQuery(swr3, 'swr3 jazz')).toBe(false);
  });

  it('findet Sender über den Betreiber', () => {
    expect(matchesQuery(swr3, 'ard')).toBe(true);
  });

  it('akzeptiert eine leere Suche', () => {
    expect(matchesQuery(swr3, '   ')).toBe(true);
  });
});

describe('normalizeUrl', () => {
  it('ignoriert Protokoll, Groß-/Kleinschreibung und Schrägstriche am Ende', () => {
    expect(normalizeUrl(' HTTPS://Stream.Example.com/live// ')).toBe('stream.example.com/live');
    expect(normalizeUrl('http://stream.example.com/live')).toBe(normalizeUrl('https://stream.example.com/live/'));
  });
});
