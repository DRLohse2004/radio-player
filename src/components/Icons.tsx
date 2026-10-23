import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />
  </Icon>
);

export const PauseIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
  </Icon>
);

export const StopIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
);

export const PrevIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 5v14L8 12z" fill="currentColor" stroke="none" />
    <path d="M6 5v14" />
  </Icon>
);

export const NextIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 5v14l10-7z" fill="currentColor" stroke="none" />
    <path d="M18 5v14" />
  </Icon>
);

export const VolumeIcon = (p: IconProps & { muted?: boolean }) => {
  const { muted, ...rest } = p;
  return (
    <Icon {...rest}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M16 9.5l5 5M21 9.5l-5 5" />
      ) : (
        <>
          <path d="M15.5 9a4 4 0 0 1 0 6" />
          <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      )}
    </Icon>
  );
};

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const EditIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);

export const ExpandIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);

export const CollapseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const MusicIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </Icon>
);

export const RadioIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="8" width="18" height="12" rx="2.5" />
    <path d="M7 8l10-4.5" />
    <circle cx="15.5" cy="14" r="2.5" />
    <path d="M6.5 12.5h4M6.5 15.5h4" />
  </Icon>
);

export const NewsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5h13v14H6a2 2 0 0 1-2-2z" />
    <path d="M17 9h3v8a2 2 0 0 1-2 2h-1" />
    <path d="M7.5 9h6M7.5 12.5h6M7.5 16h4" />
  </Icon>
);

export const TrafficIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 16V11l2-5h10l2 5v5" />
    <path d="M4 16h16v2.5H4z" />
    <path d="M5 11h14" />
    <circle cx="8" cy="13.5" r="0.6" fill="currentColor" />
    <circle cx="16" cy="13.5" r="0.6" fill="currentColor" />
  </Icon>
);

export const MegaphoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10v4h3l8 4.5V5.5L7 10z" />
    <path d="M7 14l1.5 5h2.5l-1.2-4" />
    <path d="M18.5 9.5a3.5 3.5 0 0 1 0 5" />
  </Icon>
);

export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21M8.5 21h7" />
  </Icon>
);

export const HeartIcon = (p: IconProps & { filled?: boolean }) => {
  const { filled, ...rest } = p;
  return (
    <Icon {...rest}>
      <path
        d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </Icon>
  );
};

export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
    <path d="M3 4v4h4" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
);

export const GripIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={0}>
    {[7, 12, 17].map((y) => (
      <g key={y} fill="currentColor">
        <circle cx="9" cy={y} r="1.4" />
        <circle cx="15" cy={y} r="1.4" />
      </g>
    ))}
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Icon>
);

/** Wettersymbol nach WMO-Code (Open-Meteo) */
export const WeatherIcon = (p: IconProps & { code: number; isDay: boolean }) => {
  const { code, isDay, ...rest } = p;
  const sun = (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  );
  const moon = <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />;
  const cloud = <path d="M7 18.5h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 9.5a4.5 4.5 0 0 0 0 9z" />;
  if (code <= 1) return <Icon {...rest}>{isDay ? sun : moon}</Icon>;
  if (code <= 3)
    return (
      <Icon {...rest}>
        <path d="M8 8.5a4 4 0 0 1 7.6-1.3" opacity={0.7} />
        {cloud}
      </Icon>
    );
  if (code <= 48)
    return (
      <Icon {...rest}>
        <path d="M4 9h16M3 13h18M5 17h14" />
      </Icon>
    );
  if (code >= 95)
    return (
      <Icon {...rest}>
        <path d="M7 15h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 6a4.5 4.5 0 0 0 0 9z" />
        <path d="M12.5 15l-2 3.5h3l-2 3.5" />
      </Icon>
    );
  const snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
  return (
    <Icon {...rest}>
      <path d="M7 14.5h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 5.5a4.5 4.5 0 0 0 0 9z" />
      {snow ? (
        <path d="M8 18h.01M12 19.5h.01M16 18h.01M10 21.5h.01M14 21.5h.01" strokeWidth={2.6} />
      ) : (
        <path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5" />
      )}
    </Icon>
  );
};

export const StoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9.5l1.5-5h13l1.5 5" />
    <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
    <path d="M5.5 12v7.5h13V12" />
    <path d="M10 19.5v-4h4v4" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

/** Lautsprecher mit Funkwellen (Connect) */
export const ConnectIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7" y="9" width="10" height="13" rx="2" />
    <circle cx="12" cy="17" r="2" />
    <circle cx="12" cy="12.2" r="0.6" fill="currentColor" />
    <path d="M8.5 5.5a5 5 0 0 1 7 0" />
    <path d="M6 3a8.5 8.5 0 0 1 12 0" />
  </Icon>
);

export const BluetoothIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 7l10 10-5 4.5V2.5l5 4.5L7 17" />
  </Icon>
);

/** AirPlay-Symbol (Bildschirm mit Dreieck) */
export const AirPlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 17H4.5A1.5 1.5 0 0 1 3 15.5v-10A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v10a1.5 1.5 0 0 1-1.5 1.5H18" />
    <path d="M12 14l5 6H7z" fill="currentColor" stroke="none" />
  </Icon>
);

export const YouTubeIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
    <path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none" />
  </Icon>
);

export const SidebarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9.5 4v16" />
  </Icon>
);

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
  </Icon>
);

export const PhoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M10.5 18h3" />
  </Icon>
);

export const RoomIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="7" width="8" height="13" rx="2" />
    <rect x="13" y="4" width="8" height="16" rx="2" />
    <circle cx="7" cy="15" r="2" />
    <circle cx="17" cy="14" r="3" />
    <path d="M17 7.5h.01M7 10.5h.01" />
  </Icon>
);

export const HeadphonesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </Icon>
);

export const CastIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
    <path d="M3 12a8 8 0 0 1 8 8M3 16a4 4 0 0 1 4 4" />
    <path d="M3 20h.01" />
  </Icon>
);
