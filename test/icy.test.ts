import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { IcyParser, parseStreamTitle } = require('../electron/icy.cjs');

/** Baut einen Metadatenblock: 1 Byte Länge/16, danach mit Nullbytes aufgefüllter Text */
function metaBlock(text: string, encoding: BufferEncoding = 'utf8') {
  const body = Buffer.from(text, encoding);
  const blocks = Math.ceil(body.length / 16);
  const padded = Buffer.alloc(blocks * 16);
  body.copy(padded);
  return Buffer.concat([Buffer.from([blocks]), padded]);
}

function collect(metaint: number) {
  const audio: Buffer[] = [];
  const titles: string[] = [];
  const parser = new IcyParser(
    metaint,
    (chunk: Buffer) => audio.push(Buffer.from(chunk)),
    (title: string) => titles.push(title),
  );
  return { parser, titles, audio: () => Buffer.concat(audio) };
}

describe('parseStreamTitle (ICY)', () => {
  it('liest den StreamTitle', () => {
    expect(parseStreamTitle("StreamTitle='Coldplay - Yellow';StreamUrl='';")).toBe('Coldplay - Yellow');
  });

  it('erlaubt Apostrophe im Titel', () => {
    expect(parseStreamTitle("StreamTitle='Guns N' Roses - Don't Cry';")).toBe("Guns N' Roses - Don't Cry");
  });

  it('liefert null ohne StreamTitle', () => {
    expect(parseStreamTitle("StreamUrl='x';")).toBeNull();
  });
});

describe('IcyParser', () => {
  const audioA = Buffer.from('AAAAAAAA');
  const audioB = Buffer.from('BBBBBBBB');

  it('trennt Audio und Metadaten', () => {
    const { parser, titles, audio } = collect(8);
    parser.push(Buffer.concat([audioA, metaBlock("StreamTitle='Interpret - Titel';"), audioB, Buffer.from([0]), audioA]));
    expect(titles).toEqual(['Interpret - Titel']);
    expect(audio().toString()).toBe('AAAAAAAABBBBBBBBAAAAAAAA');
  });

  it('kommt mit beliebig zerstückelten Chunks zurecht', () => {
    const stream = Buffer.concat([audioA, metaBlock("StreamTitle='Eins';"), audioB, metaBlock("StreamTitle='Zwei';"), audioA]);
    const { parser, titles, audio } = collect(8);
    for (let i = 0; i < stream.length; i += 3) parser.push(stream.subarray(i, i + 3));
    expect(titles).toEqual(['Eins', 'Zwei']);
    expect(audio().toString()).toBe('AAAAAAAABBBBBBBBAAAAAAAA');
  });

  it('fällt bei ungültigem UTF-8 auf Latin-1 zurück', () => {
    const { parser, titles } = collect(8);
    parser.push(Buffer.concat([audioA, metaBlock("StreamTitle='Die Ärzte - Schrei nach Liebe';", 'latin1')]));
    expect(titles).toEqual(['Die Ärzte - Schrei nach Liebe']);
  });
});
