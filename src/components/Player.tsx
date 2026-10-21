import { useEffect, useState } from 'react';
import type { ContentKind, NowPlaying, PlayerStatus, Station } from '../types';
import { MusicIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from './Icons';
import { hasSegmentArt, KIND_LABEL, SegmentArt } from './Segment';
import { StationLogo } from './StationLogo';

export const STATUS_TEXT: Record<PlayerStatus, string> = {
  idle: 'Bereit',
  loading: 'Verbinde …',
  playing: 'Live',
  error: 'Stream nicht erreichbar',
};

interface CoverProps {
  cover: string | null;
  station: Station | null;
  kind?: ContentKind;
  className?: string;
}

/**
 * Album-Cover mit Überblendung. Ohne Cover: bei Nachrichten/Werbung usw. eine Symbol-Kachel,
 * sonst das Senderlogo bzw. ein Notensymbol.
 */
export function Cover({ cover, station, kind, className = '' }: CoverProps) {
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    setFailed(null);
  }, [cover]);

  const showCover = cover && failed !== cover;

  return (
    <div className={`cover ${className}`}>
      <div className="cover-fallback">
        {hasSegmentArt(kind) ? (
          <SegmentArt key={kind} kind={kind} station={station} />
        ) : station ? (
          <StationLogo station={station} className="fill" />
        ) : (
          <MusicIcon size={64} />
        )}
      </div>
      {/* Kein Warten auf onLoad: bis das Bild da ist, scheint der Platzhalter durch.
          Die Einblendung ist eine reine CSS-Animation, deren Endzustand immer sichtbar ist. */}
      {showCover && <img key={cover} src={cover} alt="" onError={() => setFailed(cover)} />}
    </div>
  );
}

/** Titel/Interpret/Album – ohne Musik die erkannte Inhaltsart bzw. der Sendername. */
export function TrackInfo({ nowPlaying, station }: { nowPlaying: NowPlaying | null; station: Station | null }) {
  // key sorgt beim Titelwechsel für eine kurze Einblend-Animation
  const key = nowPlaying?.raw ?? station?.id ?? '';

  if (nowPlaying?.title) {
    return (
      <div className="track-info" key={key}>
        <div className="track-title" title={nowPlaying.title}>
          {nowPlaying.title}
        </div>
        <div className="track-artist" title={nowPlaying.artist ?? ''}>
          {nowPlaying.artist}
        </div>
        {nowPlaying.album && <div className="track-album">{nowPlaying.album}</div>}
      </div>
    );
  }

  if (nowPlaying && hasSegmentArt(nowPlaying.kind)) {
    const label = KIND_LABEL[nowPlaying.kind];
    const detail = nowPlaying.raw && nowPlaying.raw.toLowerCase() !== label.toLowerCase() ? nowPlaying.raw : station?.name;
    return (
      <div className="track-info" key={key}>
        <div className="track-title">{label}</div>
        <div className="track-artist muted">{detail}</div>
      </div>
    );
  }

  return (
    <div className="track-info" key={key}>
      <div className="track-title">{station?.name ?? 'Kein Sender ausgewählt'}</div>
      <div className="track-artist muted">{nowPlaying?.raw || 'Keine Titelinformationen'}</div>
    </div>
  );
}

interface ControlsProps {
  isPlaying: boolean;
  disabled: boolean;
  onToggle(): void;
  onPrev(): void;
  onNext(): void;
  large?: boolean;
}

export function Controls({ isPlaying, disabled, onToggle, onPrev, onNext, large }: ControlsProps) {
  const size = large ? 30 : 22;
  return (
    <div className={`controls${large ? ' large' : ''}`}>
      <button className="control" onClick={onPrev} disabled={disabled} title="Vorheriger Sender">
        <PrevIcon size={size} />
      </button>
      <button
        className="control play"
        onClick={onToggle}
        disabled={disabled}
        title={isPlaying ? 'Pause (Leertaste)' : 'Abspielen (Leertaste)'}
      >
        {isPlaying ? <PauseIcon size={size + 6} /> : <PlayIcon size={size + 6} />}
      </button>
      <button className="control" onClick={onNext} disabled={disabled} title="Nächster Sender">
        <NextIcon size={size} />
      </button>
    </div>
  );
}
