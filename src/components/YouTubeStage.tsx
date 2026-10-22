import { useEffect, useState } from 'react';
import { isDesktop } from '../api';
import type { YouTubeState } from '../youtube';
import { YouTubeIcon } from './Icons';

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

interface Props {
  state: YouTubeState;
  hasItems: boolean;
  sidebarOpen: boolean;
  position(): number;
  onSeek(fraction: number): void;
  onOpenSidebar(): void;
}

export function YouTubeStage({ state, hasItems, sidebarOpen, position, onSeek, onOpenSidebar }: Props) {
  const [, tick] = useState(0);
  const [coverFailed, setCoverFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(timer);
  }, [state.playing]);

  const now = state.now;

  if (!now) {
    return (
      <section className="spotify-panel">
        <div className="spotify-hero">
          <div className="spotify-hero-icon youtube">
            <YouTubeIcon size={64} />
          </div>
          <h2>YouTube</h2>
          {state.error ? (
            <p className="error-text">{state.error}</p>
          ) : (
            <p>
              {hasItems
                ? 'Links in der Seitenleiste einen gespeicherten Eintrag wählen oder etwas in die Queue setzen.'
                : 'Links in der Seitenleiste suchen oder einen YouTube-Link einfügen – Video, Playlist oder Livestream.'}
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
      </section>
    );
  }

  const cover = coverFailed === now.cover ? now.fallbackCover : now.cover;
  const current = position();

  return (
    <section className="spotify-panel">
      <div className="spotify-now">
        <div className="cover main-cover wide">
          <div className="cover-fallback">
            <YouTubeIcon size={64} />
          </div>
          {cover && <img key={cover} src={cover} alt="" onError={() => setCoverFailed(now.cover)} />}
        </div>
        <div className="np-text">
          <div className="np-station">
            {now.item.from ? `YouTube · ${now.item.from}` : 'YouTube'}
            {now.live && <span className="kind-badge live">Live</span>}
            {!state.playing && <span className="kind-badge">Pausiert</span>}
          </div>
          <div className="track-info" key={now.item.id}>
            <div className="track-title" title={now.title}>
              {now.title}
            </div>
            {now.channel && <div className="track-artist">{now.channel}</div>}
            {now.item.wishedBy && <div className="track-album wish-by">Gewünscht von {now.item.wishedBy}</div>}
          </div>
          {!now.live && now.duration > 0 && (
            <div className="progress seekable">
              <div
                className="progress-bar"
                title="Klicken zum Springen"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onSeek((e.clientX - rect.left) / rect.width);
                }}
              >
                <div style={{ width: `${Math.min(100, (current / now.duration) * 100)}%` }} />
              </div>
              <div className="progress-times">
                <span>{formatTime(current)}</span>
                <span>{formatTime(now.duration)}</span>
              </div>
            </div>
          )}
          {state.error && <p className="error-text">{state.error}</p>}
        </div>
      </div>
    </section>
  );
}
