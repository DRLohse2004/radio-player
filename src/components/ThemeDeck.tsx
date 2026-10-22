import { useEffect, useRef, type CSSProperties } from 'react';
import type { NowPlaying, Station, ThemeId } from '../types';
import { hasSegmentArt, KIND_LABEL } from './Segment';
import { StationLogo } from './StationLogo';

/** So viele Sender passen auf Skala, Tasten und Tafel */
const DECK_SIZE = 8;
const FRAME_MS = 1000 / 30;

/** Die ersten Sender – der laufende ist immer dabei, notfalls auf dem letzten Platz. */
export function deckStations(stations: Station[], currentId: string | null): Station[] {
  const list = stations.slice(0, DECK_SIZE);
  const current = stations.find((s) => s.id === currentId);
  if (current && !list.includes(current) && list.length) list[list.length - 1] = current;
  return list;
}

/** Pegel aus dem Analyser, 30-mal pro Sekunde, ohne React neu zu rendern. */
function useLevels(analyser: AnalyserNode | null, active: boolean, bands: number, onFrame: (levels: Float32Array) => void) {
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;

  useEffect(() => {
    const levels = new Float32Array(bands);
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let frame = 0;
    let last = 0;
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - last < FRAME_MS) return;
      last = time;
      if (analyser && data) analyser.getByteFrequencyData(data);
      const usable = data ? Math.floor(data.length * 0.5) : 0;
      for (let i = 0; i < bands; i++) {
        let target = 0;
        if (active && data && usable) {
          const start = Math.floor(Math.pow(i / bands, 1.6) * usable);
          const end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / bands, 1.6) * usable));
          let sum = 0;
          for (let j = start; j < end; j++) sum += data[j];
          target = sum / (end - start) / 255;
        }
        levels[i] += (target - levels[i]) * (target > levels[i] ? 0.35 : 0.1);
      }
      frameRef.current(levels);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser, active, bands]);
}

interface ScaleProps {
  theme: ThemeId;
  stations: Station[];
  currentId: string | null;
  onSelect(id: string): void;
}

/** Senderskala mit Zeiger (Kofferradio, Röhrenempfänger) */
export function TuningScale({ theme, stations, currentId, onSelect }: ScaleProps) {
  const index = stations.findIndex((s) => s.id === currentId);
  const needle = index < 0 ? 0 : ((index + 0.5) / stations.length) * 100;
  return (
    <div className="tuning-scale">
      <div className="scale-track">
        {theme === 'roehre' && (
          <div className="scale-mhz" aria-hidden="true">
            {[88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108].map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        )}
        <div className="scale-ticks" aria-hidden="true" />
        <div className="scale-names">
          {stations.map((s) => (
            <button key={s.id} className={s.id === currentId ? 'active' : ''} onClick={() => onSelect(s.id)} title={s.name}>
              {s.name}
            </button>
          ))}
        </div>
        {index >= 0 && <div className="scale-needle" style={{ left: `${needle}%` }} aria-hidden="true" />}
      </div>
    </div>
  );
}

interface DeckProps extends ScaleProps {
  playing: boolean;
}

/** Senderwahl unter dem Player – je nach Design als Tasten, Kacheln, Regal oder Tafel */
export function StationDeck({ theme, stations, currentId, playing, onSelect }: DeckProps) {
  if (theme === 'tafel') {
    return (
      <div className="station-board">
        <div className="board-head" aria-hidden="true">
          <span>Nr</span>
          <span>Sender</span>
          <span>Status</span>
          <span>Nr</span>
          <span>Sender</span>
          <span>Status</span>
        </div>
        <div className="board-rows" style={{ '--rows': Math.ceil(stations.length / 2) } as CSSProperties}>
          {stations.map((s, i) => {
            const active = s.id === currentId;
            return (
              <button key={s.id} className={`board-row${active ? ' active' : ''}`} onClick={() => onSelect(s.id)}>
                <span className="board-nr">{String(i + 1).padStart(2, '0')}</span>
                <span className="board-name">
                  <StationLogo station={s} className="board-logo" />
                  {s.name}
                </span>
                <span className="board-status">{active ? (playing ? 'Läuft' : 'Pause') : 'Bereit'}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const withLogo = theme === 'wohnzimmer' || theme === 'plakat';
  return (
    <div className={`station-deck deck-${theme}`}>
      {theme === 'wohnzimmer' && <div className="deck-shelf" aria-hidden="true" />}
      <div className="deck-keys">
        {stations.map((s, i) => (
          <button key={s.id} className={`deck-key${s.id === currentId ? ' active' : ''}`} onClick={() => onSelect(s.id)} title={s.name}>
            {withLogo ? <StationLogo station={s} className="deck-logo" /> : <span className="deck-nr">{String(i + 1).padStart(2, '0')}</span>}
            <span className="deck-name">{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Zeigerinstrument, das zur Musik ausschlägt (Röhrenempfänger) */
export function VuMeter({ analyser, active, side }: { analyser: AnalyserNode | null; active: boolean; side: 'left' | 'right' }) {
  const needleRef = useRef<HTMLDivElement>(null);
  useLevels(analyser, active, 6, (levels) => {
    // links eher Bässe, rechts eher Höhen – so bewegen sich die Zeiger nicht im Gleichschritt
    const from = side === 'left' ? 0 : 2;
    const level = Math.min(1, (levels[from] + levels[from + 1] + levels[from + 2]) / 2.2);
    if (needleRef.current) needleRef.current.style.transform = `rotate(${-45 + level * 90}deg)`;
  });
  return (
    <div className="vu-meter" aria-hidden="true">
      <div className="vu-arc" />
      <div className="vu-red" />
      <span className="vu-label">VU</span>
      <div className="vu-needle" ref={needleRef} />
    </div>
  );
}

const SPECTRUM_BARS = 28;

/** Balken in Terminal-Optik (Phosphor) */
export function Spectrum({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const barsRef = useRef<HTMLDivElement>(null);
  useLevels(analyser, active, SPECTRUM_BARS, (levels) => {
    const bars = barsRef.current?.children;
    if (!bars) return;
    for (let i = 0; i < bars.length; i++) (bars[i] as HTMLElement).style.height = `${Math.max(4, Math.min(100, levels[i] * 120))}%`;
  });
  return (
    <div className="spectrum" ref={barsRef} aria-hidden="true">
      {Array.from({ length: SPECTRUM_BARS }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Text aus einzelnen Fallblättern; geänderte Zeichen klappen neu um */
function Flaps({ text, className }: { text: string; className: string }) {
  return (
    <div className={`flaps ${className}`} aria-label={text} role="img">
      {Array.from(text.toUpperCase()).map((c, i) => (
        <span key={`${i}-${c}`} className="flap" style={{ animationDelay: `${i * 25}ms` }} aria-hidden="true">
          {c === ' ' ? ' ' : c}
        </span>
      ))}
    </div>
  );
}

/** Titel und Interpret als Fallblattanzeige (Anzeigetafel) */
export function FlapTrack({ nowPlaying, station }: { nowPlaying: NowPlaying | null; station: Station | null }) {
  // gleiche Reihenfolge wie TrackInfo: Titel, sonst Nachrichten/Werbung …, sonst Sendername
  const segment = !nowPlaying?.title && nowPlaying && hasSegmentArt(nowPlaying.kind) ? KIND_LABEL[nowPlaying.kind] : null;
  const title = nowPlaying?.title ?? segment ?? station?.name ?? 'Kein Sender';
  const artist = nowPlaying?.title ? nowPlaying.artist ?? '' : segment ? station?.name ?? '' : nowPlaying?.raw ?? '';
  return (
    <div className="track-info flap-track">
      <Flaps text={clip(title, 20)} className="flaps-title" />
      {artist && <Flaps text={clip(artist, 28)} className="flaps-artist" />}
      {nowPlaying?.album && <div className="track-album">{nowPlaying.album}</div>}
    </div>
  );
}
