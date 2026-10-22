import { useEffect } from 'react';
import type { ThemeId } from './types';

// Schriften liegen in der App (über @fontsource), damit die Designs auch offline gleich aussehen.
// Der Browser lädt eine Schriftdatei erst, wenn ein Design sie wirklich benutzt.
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/vt323/400.css';
import '@fontsource/saira-condensed/400.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/share-tech-mono/400.css';
import '@fontsource/anton/400.css';
import '@fontsource/work-sans/500.css';
import '@fontsource/work-sans/700.css';
import '@fontsource/work-sans/800.css';
import '@fontsource/syne/700.css';
import '@fontsource/syne/800.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/800.css';
import './themes.css';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  hint: string;
  /** Hintergrund, Fläche, Schrift, Akzent – für die Vorschau in den Einstellungen */
  swatch: [string, string, string, string];
  /** Schrift für den Namen in der Vorschau */
  font: string;
}

export const THEMES: ThemeInfo[] = [
  { id: 'standard', name: 'Standard', hint: 'Dunkel mit schwebender Seitenleiste', swatch: ['#0d0f14', '#1c202b', '#eef0f5', '#ff5a5f'], font: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif" },
  { id: 'kofferradio', name: 'Kofferradio', hint: 'Hell und sachlich, mit Senderskala und Stationstasten', swatch: ['#e7e4dc', '#f6f4ef', '#1f1f1d', '#e8590c'], font: "'Archivo', sans-serif" },
  { id: 'phosphor', name: 'Phosphor', hint: 'Bernsteinfarbenes Terminal mit Tastenkürzeln', swatch: ['#0b0c09', '#14150f', '#ffb000', '#ffb000'], font: "'VT323', monospace" },
  { id: 'roehre', name: 'Röhrenempfänger', hint: 'Nussbaum, leuchtende Skala und VU-Meter', swatch: ['#4a2a17', '#23211e', '#7ff5df', '#f2c46d'], font: "'Saira Condensed', sans-serif" },
  { id: 'plakat', name: 'Plakat', hint: 'Knallgelb, dicke Rahmen, riesige Schrift', swatch: ['#ffd23f', '#ffffff', '#111111', '#ff6fb5'], font: "'Anton', sans-serif" },
  { id: 'wohnzimmer', name: 'Wohnzimmer', hint: 'Dunkles Olivgrün mit Senderregal aus Eiche', swatch: ['#1f2a24', '#2a372f', '#efe8dc', '#e08a5c'], font: "'Syne', sans-serif" },
  { id: 'tafel', name: 'Anzeigetafel', hint: 'Fallblattanzeige wie am Bahnhof', swatch: ['#151618', '#26272a', '#f2f0e6', '#f5c400'], font: "'Barlow Condensed', sans-serif" },
  { id: 'terminal', name: 'Terminal', hint: 'Moderne Konsole, jeder Knopf zeigt sein Tastenkürzel', swatch: ['#0c0c0c', '#161616', '#e6e6e6', '#3fd16a'], font: "'JetBrains Mono', monospace" },
];

/** Designs mit eigener Senderleiste unter dem Player (Stationstasten, Regal, Tafel …) */
export const DECK_THEMES: ThemeId[] = ['kofferradio', 'roehre', 'plakat', 'wohnzimmer', 'tafel', 'terminal'];

/** Setzt das Design an <html>, damit auch Dialoge und Vollbild die Farben übernehmen. */
export function useTheme(theme: ThemeId) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'standard') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
}
