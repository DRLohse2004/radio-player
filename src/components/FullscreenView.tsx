import { useEffect, useState } from 'react';
import { useAlternating, useIdle, useNow, usePixelShift, useWeather } from '../hooks';
import type { NowPlaying, PlayerStatus, Station, Track } from '../types';
import { CollapseIcon, WeatherIcon } from './Icons';
import { Controls, Cover, STATUS_TEXT, TrackInfo } from './Player';
import { KindBadge } from './Segment';
import { Visualizer } from './Visualizer';

interface Props {
  station: Station | null;
  nowPlaying: NowPlaying | null;
  status: PlayerStatus;
  isPlaying: boolean;
  history: Track[];
  weatherCity: string;
  swapMinutes: number;
  analyser: AnalyserNode | null;
  showVisualizer: boolean;
  /** QR-Code der Fernbedienung (SVG), null = ausblenden */
  qr?: string | null;
  onToggle(): void;
  onPrev(): void;
  onNext(): void;
  onExit(): void;
}

const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const SWAP_FADE_MS = 900;

export function FullscreenView(props: Props) {
  const { station, nowPlaying, status, isPlaying, history, weatherCity, swapMinutes, analyser, showVisualizer } = props;
  const now = useNow();
  const idle = useIdle(3000);
  const weather = useWeather(weatherCity);
  const shift = usePixelShift(14);

  // Cover und Text tauschen regelmäßig die Seiten – mit kurzem Ausblenden dazwischen
  const swapTarget = useAlternating(swapMinutes);
  const [swapped, setSwapped] = useState(swapTarget);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (swapTarget === swapped) return;
    setFading(true);
    const timer = window.setTimeout(() => {
      setSwapped(swapTarget);
      setFading(false);
    }, SWAP_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [swapTarget, swapped]);

  const [hours, minutes] = timeFormat.format(now).split(':');
  const cover = nowPlaying?.cover ?? null;
  const kind = nowPlaying?.kind;
  const recent = history.filter((t) => !(nowPlaying?.title === t.title && nowPlaying.artist === t.artist)).slice(0, 3);

  return (
    <div className={`fullscreen${idle ? ' idle' : ''}`}>
      <div className="fs-backdrop">
        {cover ? <img key={cover} src={cover} alt="" /> : <div className={`fs-gradient kind-${kind ?? 'program'}`} />}
      </div>

      {showVisualizer && analyser && <Visualizer analyser={analyser} active={status === 'playing'} />}

      <div className="fs-content" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>
        <header className="fs-top">
          <div className="fs-station">
            <span className={`live-dot ${status}`} />
            <span>{station?.name}</span>
            <span className="fs-status">{STATUS_TEXT[status]}</span>
            {kind && kind !== 'program' && status === 'playing' && <KindBadge kind={kind} />}
          </div>
          {weather && (
            <div className="fs-weather" title={weather.place}>
              <WeatherIcon code={weather.code} isDay={weather.isDay} size={30} />
              <span className="fs-temp">{Math.round(weather.temperature)}°</span>
              <span className="fs-place">{weather.place}</span>
            </div>
          )}
        </header>

        <main className={`fs-main${swapped ? ' swapped' : ''}${fading ? ' fading' : ''}`}>
          <div className="fs-cover-wrap">
            <Cover cover={cover} station={station} kind={kind} className="fs-cover" />
          </div>
          <div className="fs-side">
            <div className="fs-clock">
              {hours}
              <span className="colon">:</span>
              {minutes}
            </div>
            <div className="fs-date">{dateFormat.format(now)}</div>
            <div className="fs-divider" />
            <TrackInfo nowPlaying={nowPlaying} station={station} />
            {recent.length > 0 && (
              <div className="fs-recent">
                <div className="fs-recent-label">Zuvor</div>
                {recent.map((t) => (
                  <div className="fs-recent-item" key={t.id}>
                    <span className="fs-recent-time">{timeFormat.format(new Date(t.time))}</span>
                    <span className="fs-recent-text">
                      {t.title} <span>· {t.artist}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      <button className="icon-button fs-exit" onClick={props.onExit} title="Vollbild beenden (Esc)">
        <CollapseIcon size={22} />
      </button>

      <footer className="fs-bottom">
        {/* QR-Code in der unteren Zeile neben den Tasten, damit er nie über Cover oder Text liegt */}
        {props.qr && (
          <div className="fs-qr" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}>
            {/* SVG stammt aus der qrcode-Bibliothek im Hauptprozess */}
            <div className="fs-qr-code" dangerouslySetInnerHTML={{ __html: props.qr }} />
            <div className="fs-qr-text">
              <strong>Musik wünschen</strong>
              <span>QR-Code im WLAN scannen</span>
            </div>
          </div>
        )}
        <Controls
          isPlaying={isPlaying}
          disabled={!station}
          onToggle={props.onToggle}
          onPrev={props.onPrev}
          onNext={props.onNext}
          large
        />
      </footer>
    </div>
  );
}
