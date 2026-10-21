import { useState } from 'react';
import { initials, stationHue } from '../metadata';
import type { Station } from '../types';

interface Props {
  station: Pick<Station, 'name' | 'logo'>;
  className?: string;
}

export function StationLogo({ station, className = '' }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = station.logo && failedUrl !== station.logo;
  const hue = stationHue(station.name);

  return (
    <div
      className={`station-logo ${className}`}
      style={{ background: showImage ? undefined : `linear-gradient(135deg, hsl(${hue} 60% 42%), hsl(${(hue + 40) % 360} 55% 28%))` }}
    >
      {showImage ? (
        <img src={station.logo} alt="" onError={() => setFailedUrl(station.logo ?? null)} />
      ) : (
        <span>{initials(station.name)}</span>
      )}
    </div>
  );
}
