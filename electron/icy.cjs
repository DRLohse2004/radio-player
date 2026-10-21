// Trennt ICY-Metadaten (StreamTitle) vom Audiodatenstrom eines Shoutcast/Icecast-Streams.
// Aufbau: <metaint Bytes Audio><1 Byte Länge/16><Metadaten>... in Endlosschleife.

function decodeMeta(buf) {
  const utf8 = buf.toString('utf8');
  // Manche Sender schicken Latin-1 statt UTF-8
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

function parseStreamTitle(raw) {
  const match = /StreamTitle='(.*?)';/s.exec(raw);
  return match ? match[1].replace(/\0+$/, '').trim() : null;
}

class IcyParser {
  constructor(metaint, onAudio, onTitle) {
    this.metaint = metaint;
    this.onAudio = onAudio;
    this.onTitle = onTitle;
    this.mode = 'audio';
    this.remaining = metaint;
    this.metaChunks = [];
  }

  push(chunk) {
    let pos = 0;
    while (pos < chunk.length) {
      if (this.mode === 'audio') {
        const n = Math.min(this.remaining, chunk.length - pos);
        this.onAudio(chunk.subarray(pos, pos + n));
        pos += n;
        this.remaining -= n;
        if (this.remaining === 0) this.mode = 'length';
      } else if (this.mode === 'length') {
        const length = chunk[pos] * 16;
        pos += 1;
        if (length === 0) {
          this.mode = 'audio';
          this.remaining = this.metaint;
        } else {
          this.mode = 'meta';
          this.remaining = length;
          this.metaChunks = [];
        }
      } else {
        const n = Math.min(this.remaining, chunk.length - pos);
        this.metaChunks.push(chunk.subarray(pos, pos + n));
        pos += n;
        this.remaining -= n;
        if (this.remaining === 0) {
          const title = parseStreamTitle(decodeMeta(Buffer.concat(this.metaChunks)));
          if (title !== null) this.onTitle(title);
          this.mode = 'audio';
          this.remaining = this.metaint;
        }
      }
    }
  }
}

module.exports = { IcyParser, parseStreamTitle };
