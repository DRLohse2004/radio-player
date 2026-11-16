// Neuer Song einer Quelle (Spotify, Bluetooth, AirPlay, YouTube) → in den Verlauf.
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { addToHistory } from '../tracks';
import type { Track } from '../types';

/**
 * `key` kennzeichnet den laufenden Song (null = gerade keiner). Ändert er sich, wird `makeTrack()`
 * einmal aufgerufen und das Ergebnis vorne in den Verlauf gesetzt.
 */
export function useRecordTrack(key: string | null | undefined, makeTrack: () => Track | null, setHistory: Dispatch<SetStateAction<Track[]>>) {
  useEffect(() => {
    if (!key) return;
    const track = makeTrack();
    if (track) setHistory((list) => addToHistory(list, track));
    // nur bei neuem Song
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
