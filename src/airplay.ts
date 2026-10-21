// AirPlay in der Oberfläche: Zustand des Empfängers und Wiedergabe des Tons vom iPhone.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { AirPlayEvent } from './types';

// --- Wiedergabe ------------------------------------------------------------------------------
// Der Ton kommt als 16-Bit-PCM (44,1 kHz, Stereo) in kleinen Paketen. Ein AudioWorklet puffert
// kurz vor (gegen Netzwerk-Schwankungen) und spielt dann lückenlos ab.

const WORKLET = `
class AirPlaySink extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.buffered = 0;
    this.started = false;
    this.prebuffer = 0.35 * sampleRate;
    this.maxBuffer = 3 * sampleRate;
    this.played = 0;
    this.underruns = 0;
    this.lastReport = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        this.queue = [];
        this.offset = 0;
        this.buffered = 0;
        this.started = false;
        return;
      }
      this.queue.push(e.data);
      this.buffered += e.data.length / 2;
      // zu viel gepuffert (z. B. nach einem Hänger): älteste Daten verwerfen
      while (this.buffered > this.maxBuffer && this.queue.length > 1) {
        const dropped = this.queue.shift();
        this.buffered -= (dropped.length - this.offset) / 2;
        this.offset = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || out[0];
    if (!this.started) {
      if (this.buffered < this.prebuffer) return true;
      this.started = true;
    }
    for (let i = 0; i < left.length; i++) {
      const chunk = this.queue[0];
      if (!chunk) {
        // Puffer leer: Stille und neu vorpuffern
        this.started = false;
        break;
      }
      left[i] = chunk[this.offset];
      right[i] = chunk[this.offset + 1];
      this.offset += 2;
      this.buffered -= 1;
      if (this.offset >= chunk.length) {
        this.queue.shift();
        this.offset = 0;
      }
      this.played += 1;
    }
    if (!this.started) this.underruns += 1;
    // Diagnose etwa jede Sekunde an die Oberfläche
    if (currentTime - this.lastReport > 1) {
      this.lastReport = currentTime;
      this.port.postMessage({ played: this.played, buffered: this.buffered, underruns: this.underruns, started: this.started });
    }
    return true;
  }
}
registerProcessor('airplay-sink', AirPlaySink);
`;

/** Diagnosewerte der Wiedergabe (abgespielte Samples, Puffer, Aussetzer) – für Fehlersuche */
export const airplayDiagnostics: { stats: Record<string, unknown> | null } = { stats: null };
(window as unknown as { radioAirplayDiagnostics: typeof airplayDiagnostics }).radioAirplayDiagnostics = airplayDiagnostics;

class AirPlayPlayer {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private ready: Promise<void> | null = null;
  private volume = 1;

  private init() {
    if (!this.ready) {
      this.ready = (async () => {
        const context = new AudioContext({ sampleRate: 44100, latencyHint: 'playback' });
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await context.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(context, 'airplay-sink', { outputChannelCount: [2] });
        node.port.onmessage = (e) => {
          airplayDiagnostics.stats = { ...e.data, contextState: context.state };
        };
        const gain = context.createGain();
        gain.gain.value = this.volume;
        node.connect(gain).connect(context.destination);
        this.context = context;
        this.node = node;
        this.gain = gain;
      })();
    }
    return this.ready;
  }

  push(pcm: Int16Array) {
    const floats = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) floats[i] = pcm[i] / 32768;
    if (this.node) {
      this.node.port.postMessage(floats, [floats.buffer]);
    } else {
      this.init().then(() => this.node?.port.postMessage(floats, [floats.buffer]));
    }
    if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
  }

  flush() {
    this.node?.port.postMessage('flush');
  }

  /** AirPlay-Lautstärke in dB: -30 (leise) … 0 (laut), -144 = stumm */
  setVolumeDb(db: number) {
    this.volume = db <= -144 ? 0 : Math.max(0, Math.min(1, (db + 30) / 30)) ** 2;
    if (this.gain && this.context) this.gain.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.05);
  }

  async close() {
    const context = this.context;
    this.context = null;
    this.node = null;
    this.gain = null;
    this.ready = null;
    await context?.close().catch(() => {});
  }
}

// --- Zustand -----------------------------------------------------------------------------------

export interface AirPlayState {
  running: boolean;
  name: string;
  port: number;
  interfaces: { name: string; address: string }[];
  error: string | null;
  /** verbundenes Gerät (z. B. "iPhone von Dominik"), null = keine Sitzung */
  client: string | null;
  playing: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  cover: string | null;
  /** Fortschritt in ms zum Zeitpunkt progressAt */
  position: number;
  duration: number;
  progressAt: number;
}

const INITIAL: AirPlayState = {
  running: false,
  name: '',
  port: 0,
  interfaces: [],
  error: null,
  client: null,
  playing: false,
  title: null,
  artist: null,
  album: null,
  cover: null,
  position: 0,
  duration: 0,
  progressAt: 0,
};

export function useAirPlay(enabled: boolean, name: string, ready: boolean) {
  const [state, setState] = useState<AirPlayState>(INITIAL);
  const playerRef = useRef<AirPlayPlayer | null>(null);
  const lastAudioRef = useRef(0);

  useEffect(
    () =>
      api.onAirplayEvent((event: AirPlayEvent) => {
        switch (event.type) {
          case 'state':
            setState((s) => ({
              ...s,
              running: event.running,
              name: event.name,
              port: event.port,
              interfaces: event.interfaces,
              error: event.error,
            }));
            break;
          case 'session':
            playerRef.current ??= new AirPlayPlayer();
            setState((s) => ({ ...s, client: event.client, title: null, artist: null, album: null, cover: null, playing: false }));
            break;
          case 'play':
            setState((s) => ({ ...s, playing: true }));
            break;
          case 'flush':
            // Pause oder Titelwechsel am iPhone
            playerRef.current?.flush();
            break;
          case 'volume':
            playerRef.current?.setVolumeDb(event.db);
            break;
          case 'metadata':
            setState((s) => ({ ...s, title: event.title ?? null, artist: event.artist ?? null, album: event.album ?? null }));
            break;
          case 'cover':
            setState((s) => ({ ...s, cover: event.cover }));
            break;
          case 'progress':
            setState((s) => ({ ...s, position: event.position, duration: event.duration, progressAt: Date.now() }));
            break;
          case 'end':
            playerRef.current?.close();
            playerRef.current = null;
            setState((s) => ({ ...s, client: null, playing: false }));
            break;
        }
      }),
    [],
  );

  useEffect(
    () =>
      api.onAirplayAudio((pcm) => {
        lastAudioRef.current = Date.now();
        playerRef.current ??= new AirPlayPlayer();
        playerRef.current.push(pcm);
      }),
    [],
  );

  // "spielt" = in den letzten 1,5 s kam Ton (das iPhone sendet bei Pause nichts)
  useEffect(() => {
    if (!state.client) return;
    const timer = window.setInterval(() => {
      const playing = Date.now() - lastAudioRef.current < 1500;
      setState((s) => (s.playing === playing ? s : { ...s, playing, position: playing ? s.position : s.position }));
    }, 500);
    return () => window.clearInterval(timer);
  }, [state.client]);

  useEffect(() => {
    if (!ready) return;
    if (!enabled) {
      api.airplayStop();
      playerRef.current?.close();
      playerRef.current = null;
      setState((s) => ({ ...INITIAL, interfaces: s.interfaces }));
      return;
    }
    const timer = window.setTimeout(() => api.airplayStart(name), 500);
    return () => window.clearTimeout(timer);
  }, [enabled, name, ready]);

  const position = useCallback(
    () => (state.playing ? state.position + (Date.now() - state.progressAt) : state.position),
    [state.playing, state.position, state.progressAt],
  );

  return { state, position };
}
