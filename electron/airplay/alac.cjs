// Apple-Lossless-Decoder (ALAC) für AirPlay-Audio.
//
// Portiert aus alac.js (https://github.com/audiocogs/alac.js), das wiederum Apples
// Referenzimplementierung (http://alac.macosforge.org) nach JavaScript überträgt.
// Original: Copyright Apple Inc.; JS-Port: Jens Nockert und Devon Govett (OFMLabs).
// Lizenz: Apache License 2.0 – http://www.apache.org/licenses/LICENSE-2.0
//
// Änderungen gegenüber alac.js: eigenständig ohne Aurora.js (eigener Bit-Leser),
// nur 16 Bit / bis 2 Kanäle (das sendet AirPlay), Prädiktor ohne ausgerollte Sonderfälle.

'use strict';

// --- Bit-Leser (MSB zuerst) -----------------------------------------------------------

class BitReader {
  constructor(buffer) {
    this.data = buffer;
    this.length = buffer.length;
    this.offset = 0; // Byte
    this.bitPosition = 0; // Bit innerhalb des Bytes (0–7)
  }

  /** nächste n Bits (n ≤ 32) als vorzeichenlose Zahl, ohne weiterzurücken */
  peek(n) {
    if (n === 0) return 0;
    const d = this.data;
    const o = this.offset;
    // 5 Bytes reichen für bis zu 32 Bits bei beliebigem Bitversatz
    const value =
      (d[o] ?? 0) * 4294967296 +
      (d[o + 1] ?? 0) * 16777216 +
      (d[o + 2] ?? 0) * 65536 +
      (d[o + 3] ?? 0) * 256 +
      (d[o + 4] ?? 0);
    const shift = 40 - this.bitPosition - n;
    return Math.floor(value / 2 ** shift) % 2 ** n;
  }

  read(n) {
    const value = this.peek(n);
    this.advance(n);
    return value;
  }

  advance(n) {
    const pos = this.bitPosition + n;
    this.offset += pos >> 3;
    this.bitPosition = pos & 7;
  }

  align() {
    if (this.bitPosition !== 0) {
      this.bitPosition = 0;
      this.offset += 1;
    }
  }

  copy() {
    const clone = new BitReader(this.data);
    clone.offset = this.offset;
    clone.bitPosition = this.bitPosition;
    return clone;
  }
}

// --- Adaptive-Golomb-Dekodierung (ag_dec) ----------------------------------------------

const MAX_PREFIX_16 = 9;
const MAX_PREFIX_32 = 9;
const QBSHIFT = 9;
const QB = 1 << QBSHIFT;
const MMULSHIFT = 2;
const MDENSHIFT = QBSHIFT - MMULSHIFT - 1;
const MOFF = 1 << (MDENSHIFT - 2);
const N_MAX_MEAN_CLAMP = 0xffff;
const N_MEAN_CLAMP_VAL = 0xffff;
const BITOFF = 24;
const MAX_DATATYPE_BITS_16 = 16;

/** Anzahl führender Nullbits eines 32-Bit-Werts */
const lead = (input) => Math.clz32(input);

function dynGet16(data, m, k) {
  const offs = data.bitPosition;
  let stream = data.peek(32 - offs) << offs;
  const bitsInPrefix = lead(~stream);
  let result;
  if (bitsInPrefix >= MAX_PREFIX_16) {
    data.advance(MAX_PREFIX_16 + MAX_DATATYPE_BITS_16);
    stream <<= MAX_PREFIX_16;
    result = stream >>> (32 - MAX_DATATYPE_BITS_16);
  } else {
    data.advance(bitsInPrefix + k);
    stream <<= bitsInPrefix + 1;
    const v = stream >>> (32 - k);
    result = bitsInPrefix * m + v - 1;
    if (v < 2) result -= v - 1;
    else data.advance(1);
  }
  return result;
}

function dynGet32(data, m, k, maxbits) {
  const offs = data.bitPosition;
  let stream = data.peek(32 - offs) << offs;
  let result = lead(~stream);
  if (result >= MAX_PREFIX_32) {
    data.advance(MAX_PREFIX_32);
    return data.read(maxbits);
  }
  data.advance(result + 1);
  if (k !== 1) {
    stream <<= result + 1;
    result *= m;
    const v = stream >>> (32 - k);
    data.advance(k - 1);
    if (v > 1) {
      result += v - 1;
      data.advance(1);
    }
  }
  return result;
}

function dynDecomp(params, data, pc, samples, maxSize) {
  const { pb, kb, wb } = params;
  let mb = params.mb0;
  let zmode = 0;
  let c = 0;
  while (c < samples) {
    let m = mb >>> QBSHIFT;
    let k = Math.min(31 - lead(m + 3), kb);
    m = (1 << k) - 1;
    let n = dynGet32(data, m, k, maxSize);
    const ndecode = n + zmode;
    const multiplier = -(ndecode & 1) | 1;
    pc[c++] = ((ndecode + 1) >>> 1) * multiplier;
    mb = pb * (n + zmode) + mb - ((pb * mb) >> QBSHIFT);
    if (n > N_MAX_MEAN_CLAMP) mb = N_MEAN_CLAMP_VAL;
    zmode = 0;
    if (mb << MMULSHIFT < QB && c < samples) {
      zmode = 1;
      k = lead(mb) - BITOFF + ((mb + MOFF) >> MDENSHIFT);
      const mz = ((1 << k) - 1) & wb;
      n = dynGet16(data, mz, k);
      if (c + n > samples) return false;
      for (let j = 0; j < n; j++) pc[c++] = 0;
      if (n >= 65535) zmode = 0;
      mb = 0;
    }
  }
  return true;
}

// --- Dynamischer Prädiktor (dp_dec) -----------------------------------------------------

function unpcBlock(pc1, out, num, coefs, active, chanbits, denshift) {
  const chanshift = 32 - chanbits;
  const denhalf = 1 << (denshift - 1);
  out[0] = pc1[0];
  if (active === 0) {
    if (out !== pc1) out.set(pc1.subarray(0, num));
    return;
  }
  if (active === 31) {
    let prev = out[0];
    for (let i = 1; i < num; i++) {
      const del = pc1[i] + prev;
      prev = (del << chanshift) >> chanshift;
      out[i] = prev;
    }
    return;
  }
  for (let i = 1; i <= active; i++) {
    const del = pc1[i] + out[i - 1];
    out[i] = (del << chanshift) >> chanshift;
  }
  const lim = active + 1;
  for (let i = lim; i < num; i++) {
    let sum1 = 0;
    const top = out[i - lim];
    const offset = i - 1;
    for (let j = 0; j < active; j++) sum1 += coefs[j] * (out[offset - j] - top);
    let del = pc1[i];
    let del0 = del;
    const sg = (-del >>> 31) | (del >> 31);
    del += top + ((sum1 + denhalf) >> denshift);
    out[i] = (del << chanshift) >> chanshift;
    if (sg > 0) {
      for (let j = active - 1; j >= 0; j--) {
        const dd = top - out[offset - j];
        const sgn = (-dd >>> 31) | (dd >> 31);
        coefs[j] -= sgn;
        del0 -= (active - j) * ((sgn * dd) >> denshift);
        if (del0 <= 0) break;
      }
    } else if (sg < 0) {
      for (let j = active - 1; j >= 0; j--) {
        const dd = top - out[offset - j];
        const sgn = (-dd >>> 31) | (dd >> 31);
        coefs[j] += sgn;
        del0 -= (active - j) * ((-sgn * dd) >> denshift);
        if (del0 >= 0) break;
      }
    }
  }
}

// --- Kanäle zusammenführen (matrix_dec) -------------------------------------------------

function unmix16(u, v, out, offset, stride, samples, mixbits, mixres) {
  if (mixres === 0) {
    for (let i = 0; i < samples; i++) {
      out[offset + i * stride] = u[i];
      out[offset + i * stride + 1] = v[i];
    }
  } else {
    for (let i = 0; i < samples; i++) {
      const l = u[i] + v[i] - ((mixres * v[i]) >> mixbits);
      out[offset + i * stride] = l;
      out[offset + i * stride + 1] = l - v[i];
    }
  }
}

// --- Decoder ------------------------------------------------------------------------------

const ID_SCE = 0;
const ID_CPE = 1;
const ID_CCE = 2;
const ID_LFE = 3;
const ID_DSE = 4;
const ID_PCE = 5;
const ID_FIL = 6;
const ID_END = 7;

class AlacDecoder {
  /**
   * @param {object} config ALACSpecificConfig, z. B. aus dem SDP-fmtp von AirPlay:
   *   "96 352 0 16 40 10 14 2 255 0 0 44100" -> frameLength 352, bitDepth 16, pb 40, mb 10, kb 14, …
   */
  constructor(config) {
    this.config = config;
    if (config.bitDepth !== 16) throw new Error('Nur 16-Bit-ALAC wird unterstützt');
    this.mixBuffers = [new Int32Array(config.frameLength), new Int32Array(config.frameLength)];
    this.predictor = new Int32Array(config.frameLength);
    this.shiftBuffer = new Int16Array(config.frameLength * 2);
  }

  static fromFmtp(fmtp) {
    const p = fmtp.trim().split(/\s+/).map(Number);
    // fmtp: <payload> frameLength compatibleVersion bitDepth pb mb kb numChannels maxRun maxFrameBytes avgBitRate sampleRate
    return new AlacDecoder({
      frameLength: p[1],
      compatibleVersion: p[2],
      bitDepth: p[3],
      pb: p[4],
      mb: p[5],
      kb: p[6],
      numChannels: p[7],
      maxRun: p[8],
      maxFrameBytes: p[9],
      avgBitRate: p[10],
      sampleRate: p[11],
    });
  }

  /** Dekodiert einen ALAC-Frame zu verschachteltem 16-Bit-PCM. */
  decode(buffer) {
    const data = new BitReader(buffer);
    const { numChannels, bitDepth } = this.config;
    let samples = this.config.frameLength;
    let output = new Int16Array(samples * numChannels);
    let channelIndex = 0;

    for (;;) {
      if (data.offset >= data.length) break;
      const tag = data.read(3);

      if (tag === ID_SCE || tag === ID_LFE || tag === ID_CPE) {
        const channels = tag === ID_CPE ? 2 : 1;
        if (channelIndex + channels > numChannels) throw new Error('Zu viele Kanäle');
        data.read(4); // elementInstanceTag
        if (data.read(12) !== 0) throw new Error('Ungültiger ALAC-Header');
        const partialFrame = data.read(1);
        let bytesShifted = data.read(2);
        const escapeFlag = data.read(1);
        if (bytesShifted === 3) throw new Error('Ungültiger Bit-Shift');

        if (partialFrame) {
          samples = data.read(32);
          if (output.length < samples * numChannels) output = new Int16Array(samples * numChannels);
        }

        let mixBits = 0;
        let mixRes = 0;
        let shiftbits = null;

        if (escapeFlag === 0) {
          const shift = bytesShifted * 8;
          const chanBits = bitDepth - shift + channels - 1;
          mixBits = data.read(8);
          mixRes = (data.read(8) << 24) >> 24; // vorzeichenbehaftet (int8)

          const mode = [];
          const denShift = [];
          const pbFactor = [];
          const num = [];
          const coefs = [];
          for (let ch = 0; ch < channels; ch++) {
            mode[ch] = data.read(4);
            denShift[ch] = data.read(4);
            pbFactor[ch] = data.read(3);
            num[ch] = data.read(5);
            const table = (coefs[ch] = new Int16Array(32));
            for (let i = 0; i < num[ch]; i++) table[i] = data.read(16);
          }

          if (bytesShifted) {
            shiftbits = data.copy();
            data.advance(shift * channels * samples);
          }

          const { mb, pb, kb, maxRun } = this.config;
          for (let ch = 0; ch < channels; ch++) {
            // ganzzahlige Division wie im C-Original
            const params = { mb0: mb, pb: ((pb * pbFactor[ch]) / 4) | 0, kb, wb: (1 << kb) - 1, maxrun: maxRun };
            if (!dynDecomp(params, data, this.predictor, samples, chanBits)) throw new Error('ALAC-Dekodierfehler');
            if (mode[ch] === 0) {
              unpcBlock(this.predictor, this.mixBuffers[ch], samples, coefs[ch], num[ch], chanBits, denShift[ch]);
            } else {
              unpcBlock(this.predictor, this.predictor, samples, null, 31, chanBits, 0);
              unpcBlock(this.predictor, this.mixBuffers[ch], samples, coefs[ch], num[ch], chanBits, denShift[ch]);
            }
          }
        } else {
          // unkomprimierter Frame
          const chanBits = bitDepth;
          const shift = 32 - chanBits;
          for (let i = 0; i < samples; i++) {
            for (let ch = 0; ch < channels; ch++) {
              this.mixBuffers[ch][i] = (data.read(chanBits) << shift) >> shift;
            }
          }
          bytesShifted = 0;
        }

        if (bytesShifted && shiftbits) {
          const shift = bytesShifted * 8;
          for (let i = 0; i < samples * channels; i++) this.shiftBuffer[i] = shiftbits.read(shift);
        }

        if (channels === 2) {
          unmix16(this.mixBuffers[0], this.mixBuffers[1], output, channelIndex, numChannels, samples, mixBits, mixRes);
        } else {
          const buf = this.mixBuffers[0];
          for (let i = 0, j = channelIndex; i < samples; i++, j += numChannels) output[j] = buf[i];
        }
        channelIndex += channels;
      } else if (tag === ID_DSE) {
        data.read(4);
        const align = data.read(1);
        let count = data.read(8);
        if (count === 255) count += data.read(8);
        if (align) data.align();
        data.advance(count * 8);
      } else if (tag === ID_FIL) {
        let count = data.read(4);
        if (count === 15) count += data.read(8) - 1;
        data.advance(count * 8);
      } else if (tag === ID_END) {
        data.align();
        break;
      } else if (tag === ID_CCE || tag === ID_PCE) {
        throw new Error(`Nicht unterstütztes ALAC-Element ${tag}`);
      } else {
        throw new Error(`Unbekanntes ALAC-Element ${tag}`);
      }
    }
    return samples * numChannels === output.length ? output : output.subarray(0, samples * numChannels);
  }
}

module.exports = { AlacDecoder, BitReader };
