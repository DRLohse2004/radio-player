import { describe, expect, it } from 'vitest';
import { hhmm, scheduleAction, withinSchedule, type Schedule } from './schedule';

const weekdays: Schedule = { enabled: true, start: '08:00', stop: '17:00', days: [1, 2, 3, 4, 5] };
// 16.11.2026 ist ein Montag, 21.11.2026 ein Samstag
const at = (day: number, time: string, seconds = 0) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(2026, 10, day, h, m, seconds);
};

describe('Zeitplan', () => {
  it('formatiert Uhrzeiten zweistellig', () => {
    expect(hhmm(at(16, '8:05'))).toBe('08:05');
  });

  it('erkennt das Zeitfenster an aktiven Tagen', () => {
    expect(withinSchedule(weekdays, at(16, '07:59'))).toBe(false);
    expect(withinSchedule(weekdays, at(16, '08:00'))).toBe(true);
    expect(withinSchedule(weekdays, at(16, '16:59'))).toBe(true);
    expect(withinSchedule(weekdays, at(16, '17:00'))).toBe(false);
    expect(withinSchedule(weekdays, at(21, '10:00'))).toBe(false);
  });

  it('ist abgeschaltet nie aktiv', () => {
    const off = { ...weekdays, enabled: false };
    expect(withinSchedule(off, at(16, '10:00'))).toBe(false);
    expect(scheduleAction(off, at(16, '08:00'))).toBeNull();
  });

  it('schaltet genau in der Ein- und Ausschaltminute', () => {
    expect(scheduleAction(weekdays, at(16, '08:00', 40))?.action).toBe('start');
    expect(scheduleAction(weekdays, at(16, '17:00'))?.action).toBe('stop');
    expect(scheduleAction(weekdays, at(16, '08:01'))).toBeNull();
    expect(scheduleAction(weekdays, at(21, '08:00'))).toBeNull();
  });

  it('liefert pro Minute denselben Schlüssel, damit nur einmal geschaltet wird', () => {
    const a = scheduleAction(weekdays, at(16, '08:00', 5))!;
    const b = scheduleAction(weekdays, at(16, '08:00', 50))!;
    const nextDay = scheduleAction(weekdays, at(17, '08:00'))!;
    expect(a.key).toBe(b.key);
    expect(nextDay.key).not.toBe(a.key);
  });
});
