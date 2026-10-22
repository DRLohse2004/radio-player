/** Tastenkürzel im Hauptfenster – gelten in allen Designs, die Übersicht steht in den Einstellungen. */
export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Leertaste'], label: 'Wiedergabe / Pause' },
  { keys: ['←', '→'], label: 'Vorheriger / nächster Sender' },
  { keys: ['↑', '↓'], label: 'Lauter / leiser' },
  { keys: ['T'], label: 'Ton aus / an' },
  { keys: ['1', '…', '9'], label: 'Sender 1 bis 9 spielen' },
  { keys: ['F1', '…', 'F5'], label: 'Bereich wählen (Radio, YouTube …)' },
  { keys: ['M'], label: 'Song merken' },
  { keys: ['V'], label: 'Verlauf & gemerkte Songs' },
  { keys: ['S'], label: 'Seitenleiste ein / aus' },
  { keys: ['/'], label: 'Sender suchen (Sender-Store)' },
  { keys: [','], label: 'Einstellungen' },
  { keys: ['F11'], label: 'Vollbild' },
  { keys: ['Esc'], label: 'Vollbild oder Dialog schließen' },
];

/** Lautstärkeschritt für ↑ / ↓ */
export const VOLUME_STEP = 0.05;
