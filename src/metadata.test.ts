import { describe, expect, it } from 'vitest';
import { initials, parseStreamTitle, stationHue, tidyCase } from './metadata';

describe('tidyCase', () => {
  it('wandelt reine Großschreibung in Titelschreibung um', () => {
    expect(tidyCase('JASON MRAZ')).toBe('Jason Mraz');
    expect(tidyCase('AC/DC - HIGHWAY TO HELL')).toBe('Ac/Dc - Highway To Hell');
  });

  it('lässt gemischte Schreibweise und kurze Texte unverändert', () => {
    expect(tidyCase('Jason Mraz')).toBe('Jason Mraz');
    expect(tidyCase('ABBA feat. x')).toBe('ABBA feat. x');
    expect(tidyCase('U2')).toBe('U2');
  });
});

describe('parseStreamTitle', () => {
  const stations = ['SWR3', 'Radio Bob'];

  it('zerlegt "Interpret - Titel" als Musik', () => {
    expect(parseStreamTitle('Coldplay - Yellow', stations)).toMatchObject({
      kind: 'music',
      artist: 'Coldplay',
      title: 'Yellow',
      raw: 'Coldplay - Yellow',
    });
  });

  it('korrigiert Großschreibung bei Interpret und Titel', () => {
    const result = parseStreamTitle('JASON MRAZ - I WON\'T GIVE UP', stations);
    expect(result.artist).toBe('Jason Mraz');
    expect(result.title).toBe("I Won't Give Up");
  });

  it('liefert für leeren Text "program" ohne Interpret', () => {
    expect(parseStreamTitle('   ', stations)).toMatchObject({ kind: 'program', artist: null, title: null, raw: '' });
  });

  it('blendet den reinen Sendernamen aus', () => {
    expect(parseStreamTitle('swr3', stations)).toMatchObject({ kind: 'program', raw: '', artist: null });
  });

  it('erkennt eindeutige Begriffe auch im Format "Interpret - Titel"', () => {
    expect(parseStreamTitle('SWR3 - Nachrichten', stations).kind).toBe('news');
    expect(parseStreamTitle('Verkehrsinfo - A8 Stau', stations).kind).toBe('traffic');
    expect(parseStreamTitle('Jetzt anrufen - 0800 123456', stations).kind).toBe('ad');
    expect(parseStreamTitle('Mehr unter www.example.de', stations).kind).toBe('talk');
  });

  it('wertet mehrdeutige Wörter nur ohne Songformat', () => {
    expect(parseStreamTitle('News', stations).kind).toBe('news');
    expect(parseStreamTitle('Good News - Mac Miller', stations).kind).toBe('music');
  });

  it('behandelt Eigenwerbung mit Sendernamen als Programm', () => {
    expect(parseStreamTitle('Radio Bob - Der beste Rock', stations)).toMatchObject({ kind: 'program', artist: null });
  });

  it('ordnet sonstigen Infotext als Programm ein', () => {
    expect(parseStreamTitle('Guten Morgen Baden-Württemberg', stations).kind).toBe('program');
  });
});

describe('initials', () => {
  it('nimmt die Anfangsbuchstaben der ersten beiden Wörter', () => {
    expect(initials('Radio Bob Rock')).toBe('RB');
    expect(initials('  deutschlandfunk ')).toBe('DE');
    expect(initials('')).toBe('?');
  });
});

describe('stationHue', () => {
  it('ist stabil und liegt im Farbkreis', () => {
    expect(stationHue('SWR3')).toBe(stationHue('SWR3'));
    for (const name of ['', 'SWR3', 'Deutschlandfunk', 'ÄÖÜ']) {
      const hue = stationHue(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
