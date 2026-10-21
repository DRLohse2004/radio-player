import type { ContentKind, Station } from '../types';
import { MegaphoneIcon, MicIcon, MusicIcon, NewsIcon, RadioIcon, TrafficIcon } from './Icons';
import { StationLogo } from './StationLogo';

export const KIND_LABEL: Record<ContentKind, string> = {
  music: 'Musik',
  news: 'Nachrichten',
  traffic: 'Verkehr & Wetter',
  ad: 'Werbung',
  talk: 'Moderation & Info',
  program: 'Live-Programm',
};

/** Inhaltsarten, für die statt eines Covers eine Symbol-Kachel erscheint */
export function hasSegmentArt(kind: ContentKind | undefined): kind is 'news' | 'traffic' | 'ad' | 'talk' {
  return kind === 'news' || kind === 'traffic' || kind === 'ad' || kind === 'talk';
}

export function KindIcon({ kind, size = 18 }: { kind: ContentKind; size?: number }) {
  switch (kind) {
    case 'music':
      return <MusicIcon size={size} />;
    case 'news':
      return <NewsIcon size={size} />;
    case 'traffic':
      return <TrafficIcon size={size} />;
    case 'ad':
      return <MegaphoneIcon size={size} />;
    case 'talk':
      return <MicIcon size={size} />;
    default:
      return <RadioIcon size={size} />;
  }
}

/** Kleines Etikett "♪ Musik" / "Nachrichten" usw. */
export function KindBadge({ kind }: { kind: ContentKind }) {
  return (
    <span className={`kind-badge kind-${kind}`}>
      <KindIcon kind={kind} size={14} />
      {KIND_LABEL[kind]}
    </span>
  );
}

/** Ersatz für das Cover, wenn gerade keine Musik läuft */
export function SegmentArt({ kind, station }: { kind: ContentKind; station: Station | null }) {
  return (
    <div className={`segment-art kind-${kind}`}>
      <div className="segment-icon">
        <KindIcon kind={kind} size={96} />
      </div>
      <div className="segment-label">{KIND_LABEL[kind]}</div>
      {station && <StationLogo station={station} className="segment-logo" />}
    </div>
  );
}
