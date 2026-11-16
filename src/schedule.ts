// Zeitplan: z. B. Montag bis Freitag um 8 Uhr an, um 17 Uhr aus.
import type { Preferences } from './types';

export type Schedule = Preferences['schedule'];

/** "08:05" */
export function hhmm(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Liegt der Zeitpunkt an einem aktiven Tag zwischen Ein- und Ausschaltzeit? */
export function withinSchedule(schedule: Schedule, date: Date) {
  if (!schedule.enabled || !schedule.days.includes(date.getDay())) return false;
  const time = hhmm(date);
  return time >= schedule.start && time < schedule.stop;
}

/**
 * Was ist jetzt zu tun? Genau in der Ein- bzw. Ausschaltminute eines aktiven Tages 'start' bzw. 'stop'.
 * `key` kennzeichnet die Minute, damit dieselbe Minute (Prüfung alle 15 s) nur einmal schaltet.
 */
export function scheduleAction(schedule: Schedule, date: Date): { action: 'start' | 'stop'; key: string } | null {
  if (!schedule.enabled || !schedule.days.includes(date.getDay())) return null;
  const time = hhmm(date);
  const key = `${date.toDateString()} ${time}`;
  if (time === schedule.start) return { action: 'start', key };
  if (time === schedule.stop) return { action: 'stop', key };
  return null;
}
