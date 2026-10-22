import { useEffect, useState, type ReactNode } from 'react';
import { isDesktop } from '../api';
import type { Wish } from '../types';
import type { YouTubeState } from '../youtube';
import { YouTubeIcon } from './Icons';
import { Queue } from './Queue';

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Was die Queue in der Mitte braucht – am Host und im Room gleich */
export interface QueueStageProps {
  queue: Wish[];
  /** Karte für den laufenden Eintrag (null = Queue ruht) */
  hero: ReactNode | null;
  canMove: boolean;
  canRemove(wish: Wish): boolean;
  /** „Jetzt spielen“ bzw. „Weiter“ zeigen (null = ausblenden) */
  startLabel: string | null;
  onStart(): void;
  onMove(id: string, toIndex: number): void;
  onRemove(id: string): void;
  onMoveSong(wishId: string, songId: string, toIndex: number, out: boolean): void;
  /** Anzeige, solange die Queue leer ist */
  empty: ReactNode;
}

/** Mitte des YouTube-Reiters: die Queue, oben als Karte was gerade läuft */
export function QueueStage({ queue, hero, startLabel, onStart, empty, ...rest }: QueueStageProps) {
  if (queue.length === 0) return <section className="spotify-panel">{empty}</section>;
  return (
    <section className="queue-stage">
      <header className="queue-stage-head">
        <h2>Queue</h2>
        <span className="muted small">
          {queue.length} {queue.length === 1 ? 'Eintrag' : 'Einträge'}
        </span>
        {startLabel && (
          <button className="button primary" onClick={onStart}>
            {startLabel}
          </button>
        )}
      </header>
      <div className="queue-stage-scroll">
        <Queue wishes={queue} hero={hero} {...rest} />
      </div>
    </section>
  );
}

/** Karte „Läuft gerade“ – Fortschritt bringt der Aufrufer mit (am Host zum Springen, im Room nur zum Ansehen) */
export function NowCard(props: {
  cover: string | null;
  fallbackCover?: string | null;
  title: string;
  channel: string | null;
  from?: string | null;
  playing: boolean;
  live?: boolean;
  progress?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const cover = failed === props.cover ? props.fallbackCover : props.cover;
  return (
    <div className="q-hero">
      <div className="q-hero-cover">
        <YouTubeIcon size={40} />
        {cover && <img key={cover} src={cover} alt="" onError={() => setFailed(props.cover)} />}
      </div>
      <div className="q-hero-text">
        <div className="q-hero-state">
          <span className={`q-pill${props.playing ? ' playing' : ''}`}>{props.playing ? '▶ Läuft gerade' : '❚❚ Pausiert'}</span>
          {props.live && <span className="kind-badge live">Live</span>}
          {props.from && <span className="muted small">aus „{props.from}“</span>}
        </div>
        <div className="q-hero-title" title={props.title}>
          {props.title}
        </div>
        {props.channel && <div className="q-hero-channel">{props.channel}</div>}
        {props.progress}
      </div>
    </div>
  );
}

interface Props extends Omit<QueueStageProps, 'hero' | 'empty'> {
  state: YouTubeState;
  /** läuft gerade der oberste Eintrag der Queue? */
  current: boolean;
  hasItems: boolean;
  sidebarOpen: boolean;
  position(): number;
  onSeek(fraction: number): void;
  onOpenSidebar(): void;
}

export function YouTubeStage({ state, current, hasItems, sidebarOpen, position, onSeek, onOpenSidebar, ...queue }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(timer);
  }, [state.playing]);

  const now = state.now;
  const at = position();
  const hero =
    current && now ? (
      <NowCard
        cover={now.cover}
        fallbackCover={now.fallbackCover}
        title={now.title}
        channel={now.channel}
        from={now.item.from}
        playing={state.playing}
        live={now.live}
        progress={
          !now.live && now.duration > 0 ? (
            <div className="progress seekable">
              <div
                className="progress-bar"
                title="Klicken zum Springen"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onSeek((e.clientX - rect.left) / rect.width);
                }}
              >
                <div style={{ width: `${Math.min(100, (at / now.duration) * 100)}%` }} />
              </div>
              <div className="progress-times">
                <span>{formatTime(at)}</span>
                <span>{formatTime(now.duration)}</span>
              </div>
            </div>
          ) : null
        }
      />
    ) : null;

  return (
    <QueueStage
      {...queue}
      hero={hero}
      empty={
        <div className="spotify-hero">
          <div className="spotify-hero-icon youtube">
            <YouTubeIcon size={64} />
          </div>
          <h2>Die Queue ist leer</h2>
          {state.error ? (
            <p className="error-text">{state.error}</p>
          ) : (
            <p>
              {hasItems
                ? 'Links suchen oder einen gespeicherten Eintrag anklicken – er landet hier und spielt.'
                : 'Links nach Songs oder Playlists suchen oder einen YouTube-Link einfügen.'}
            </p>
          )}
          <p className="muted">Nur der Ton, ohne Anmeldung und ohne Werbung.</p>
          {!isDesktop && <p className="muted">Nur in der Desktop-App verfügbar.</p>}
          {!sidebarOpen && (
            <button className="button primary" onClick={onOpenSidebar}>
              Seitenleiste einblenden
            </button>
          )}
        </div>
      }
    />
  );
}
